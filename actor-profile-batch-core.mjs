import { fingerprint } from './core.mjs';
import {
    actorProfileBaselineDigest,
    buildActorProfileCompletionMessages,
    discardActorProfileDiscoveryProofBatches,
    materializeActorProfileBaseline,
    parseActorProfileCompletionBatchOutput,
    validateActorProfileInsertCandidate,
} from './actor-profile-v6-core.mjs';
import {
    actorProfileCommitMatchesLedger,
    actorProfilePendingWriteSetDigest,
    actorProfileTransactionId,
    finalizeActorProfileBaselinesInLedger,
    normalizeActorLedger,
    replaceActorProfileBaselineInLedger,
    sealActorProfilePendingTransactionInLedger,
} from './actor-ledger-core.mjs';

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 500) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function candidateActorId(candidate) {
    return cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120);
}

function candidateName(candidate) {
    return cleanText(candidate?.actorRef?.name || candidate?.name, 160);
}

function failureFor(candidate, reason, extras = {}) {
    return {
        actorId: candidateActorId(candidate),
        name: candidateName(candidate),
        reason,
        missingFields: [],
        ...extras,
    };
}

const PROFILE_BATCH_FAILURE_CATEGORIES = new Set([
    'scope_stale',
    'target_stale',
    'cancelled',
    'http',
    'timeout',
    'empty',
    'protocol',
    'transport',
]);

const PROFILE_BATCH_LENGTH_BUCKETS = new Set([
    'empty',
    'tiny',
    'small',
    'medium',
    'large',
    'oversize',
]);

function profileBatchRouteDiagnostic(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.requestKind && value.requestKind !== 'actor_profile_batch') return null;
    const channel = value.channel === 'fast' ? 'fast'
        : value.channel === 'strict' ? 'strict' : '';
    const requestKind = value.requestKind === 'actor_profile_batch'
        ? 'actor_profile_batch'
        : '';
    if (!channel && !requestKind) return null;
    return {
        channel,
        slot: Math.max(0, Math.floor(Number(value.slot) || 0)),
        model: cleanText(value.model, 120),
        failover: value.failover === true,
        jsonMode: value.jsonMode === true,
        requestStarted: value.requestStarted === true,
        inputLengthBucket: PROFILE_BATCH_LENGTH_BUCKETS.has(value.inputLengthBucket)
            ? value.inputLengthBucket
            : 'empty',
        httpStatus: Math.max(0, Math.floor(Number(value.httpStatus) || 0)),
        failureKind: PROFILE_BATCH_FAILURE_CATEGORIES.has(value.failureKind)
            ? value.failureKind
            : 'transport',
    };
}

function profileBatchRequestFailure(error) {
    const requested = String(error?.profileBatchFailureCategory || error?.failureKind || '');
    const category = PROFILE_BATCH_FAILURE_CATEGORIES.has(requested)
        ? requested
        : error?.name === 'AbortError'
            ? 'cancelled'
            : Number(error?.status) > 0
                ? 'http'
                : 'transport';
    return {
        category,
        routeDiagnostic: profileBatchRouteDiagnostic(error?.routeDiagnostic),
    };
}

function persistenceFailureReason(reason) {
    if (reason === 'host_save_readback_unsupported') {
        return 'actor_profile.readback_unsupported';
    }
    if (reason === 'host_save_readback_mismatch') {
        return 'actor_profile.readback_mismatch';
    }
    if ([
        'chat_context_changed',
        'chat_context_changed_after_save',
        'write_precondition_failed',
        'field_state_mismatch',
        'stale_namespace_revision',
        'actor_profile.target_stale',
    ].includes(reason)) return 'actor_profile.target_stale';
    return 'actor_profile.commit_rejected';
}

export async function completeActorProfileBatchTransaction({
    ledger,
    persistenceBaseLedger = ledger,
    candidates = [],
    evidenceText = '',
    customPrompt = '',
    turn = 0,
    target = {},
    semanticRetry = true,
    allowDiscovery = false,
    discoveryContext = null,
    requestBatch,
    resolveDiscoveries,
    persistPendingBatch,
    persistFinalizedBatch,
    isTargetCurrent = () => true,
} = {}) {
    const supplied = (Array.isArray(candidates) ? candidates : [])
        .filter((candidate) => candidateActorId(candidate) && candidateName(candidate));
    const candidateCounts = new Map();
    for (const candidate of supplied) {
        const actorId = candidateActorId(candidate);
        candidateCounts.set(actorId, (candidateCounts.get(actorId) || 0) + 1);
    }
    const duplicateInputIds = new Set([...candidateCounts]
        .filter(([, count]) => count > 1)
        .map(([actorId]) => actorId));
    const inputFailures = [...duplicateInputIds].map((actorId) => failureFor(
        supplied.find((candidate) => candidateActorId(candidate) === actorId),
        'actor_profile.input_actor_ref_duplicate',
    ));
    const selected = supplied.filter((candidate) => !duplicateInputIds.has(
        candidateActorId(candidate),
    ));
    // Candidate preparation may create in-memory scaffolds. Atomic persistence
    // always starts from the pre-preparation ledger so a rejected actor remains
    // byte-for-byte untouched while successful peers commit together.
    const originalLedger = normalizeActorLedger(persistenceBaseLedger, {
        chatId: persistenceBaseLedger?.chatId || ledger?.chatId,
    });
    const base = {
        ledger: originalLedger,
        candidates: supplied,
        accepted: [],
        rejected: [],
        failures: inputFailures,
        persistenceMeta: null,
        modelCalls: 0,
        persistenceStatus: 'not_completed',
        readbackVerified: false,
        batchMeta: null,
        batchFormatReplacementAttempted: false,
    };
    if (!selected.length && !allowDiscovery) return base;
    if (
        typeof requestBatch !== 'function'
        || typeof resolveDiscoveries !== 'function'
        || typeof persistPendingBatch !== 'function'
        || typeof persistFinalizedBatch !== 'function'
    ) {
        return {
            ...base,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.batch_adapter_unavailable',
            ))],
        };
    }
    const current = async () => {
        try {
            return await Promise.resolve(isTargetCurrent()) === true;
        } catch {
            return false;
        }
    };
    if (!await current()) {
        return {
            ...base,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
        };
    }

    const acceptedById = new Map();
    const failureById = new Map();
    const rejected = [];
    const narrativeProofBatchIds = new Set();
    let modelCalls = 0;
    const collect = async (
        subset,
        validationFeedback,
        attempt,
        discoveryRetryTargets = [],
        forceDiscoveryRetry = false,
    ) => {
        const attemptDiscoveryContext = attempt === 0
            ? discoveryContext
            : {
                ...(discoveryContext || {}),
                discoveryEnabled: discoveryRetryTargets.length > 0 || forceDiscoveryRetry,
                discoveryRetryOnly: discoveryRetryTargets.length > 0,
            };
        const messages = buildActorProfileCompletionMessages(subset, {
            evidenceText,
            customPrompt,
            validationFeedback,
            discoveryContext: attemptDiscoveryContext,
            discoveryRetryTargets,
        });
        let output;
        try {
            output = await requestBatch({
                candidates: clone(subset),
                messages,
                attempt,
            });
            modelCalls += 1;
        } catch (error) {
            const failure = profileBatchRequestFailure(error);
            if (failure.routeDiagnostic?.requestStarted === true) modelCalls += 1;
            return {
                requestFailure: failure,
            };
        }
        if (!await current()) return { stale: true };
        const parsed = parseActorProfileCompletionBatchOutput(output, {
            candidates: subset,
            discoveryContext: attemptDiscoveryContext,
        });
        if (parsed.narrativeProofBatchId) narrativeProofBatchIds.add(parsed.narrativeProofBatchId);
        return parsed;
    };

    let batchMeta = null;
    let batchFormatReplacementAttempted = false;
    const withBatchMeta = (result) => ({
        ...result,
        batchMeta: clone(batchMeta),
        batchFormatReplacementAttempted,
    });
    try {
    let first = await collect(selected, [], 0);
    if (first.requestFailure) {
        return withBatchMeta({
            ...base,
            modelCalls,
            failures: [
                ...inputFailures,
                ...(selected.length ? selected.map((candidate) => failureFor(
                    candidate,
                    `actor_profile.${first.requestFailure.category}`,
                    { routeDiagnostic: first.requestFailure.routeDiagnostic },
                )) : [{
                    reason: `actor_profile.${first.requestFailure.category}`,
                    routeDiagnostic: first.requestFailure.routeDiagnostic,
                }]),
            ],
        });
    }
    if (first.stale) {
        return withBatchMeta({
            ...base,
            modelCalls,
            failures: [
                ...inputFailures,
                ...(selected.length ? selected.map((candidate) => failureFor(
                    candidate,
                    'actor_profile.target_stale',
                )) : [{ reason: 'actor_profile.target_stale' }]),
            ],
        });
    }
    batchMeta = clone(first.batchMeta || null);
    base.batchMeta = clone(batchMeta);
    const needsDiscoveryFormatReplacement = allowDiscovery === true
        && selected.length === 0
        && batchMeta?.emptyOutput !== true
        && batchMeta?.explicitEmpty !== true
        && batchMeta?.formatUnrecoverable === true;
    if (needsDiscoveryFormatReplacement) {
        batchFormatReplacementAttempted = true;
        base.batchFormatReplacementAttempted = true;
        const replacement = await collect([], [], 1, [], true);
        if (replacement.requestFailure) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{
                    reason: `actor_profile.${replacement.requestFailure.category}`,
                    routeDiagnostic: replacement.requestFailure.routeDiagnostic,
                }],
            });
        }
        if (replacement.stale) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{ reason: 'actor_profile.target_stale' }],
            });
        }
        batchMeta = clone(replacement.batchMeta || null);
        base.batchMeta = clone(batchMeta);
        if (
            batchMeta?.formatUnrecoverable === true
            || batchMeta?.parsedRowCount === 0
        ) {
            return withBatchMeta({
                ...base,
                modelCalls,
                failures: [{ reason: 'actor_profile.format_unrecoverable' }],
            });
        }
        first = replacement;
    }
    for (const entry of first.entries || []) acceptedById.set(entry.actorId, entry);
    for (const failure of first.failures || []) failureById.set(failure.actorId, failure);
    rejected.push(...(first.unexpected || []));
    let discoveries = [...(first.discoveries || [])];
    let unresolved = [...(first.unresolved || [])];
    const explicitEmpty = first.explicitEmpty === true;
    const retryCandidates = semanticRetry && !batchFormatReplacementAttempted
        ? selected.filter((candidate) => (
            failureById.get(candidateActorId(candidate))?.retryable
        ))
        : [];
    const retryDiscoveryTargets = semanticRetry && !batchFormatReplacementAttempted
        ? unresolved
            .filter((entry) => (
                entry.retryable === true
                && entry.candidateRef?.name
                && entry.candidateRef?.sourceAnchor
            ))
            .map((entry) => clone(entry.candidateRef))
        : [];
    if (retryCandidates.length || retryDiscoveryTargets.length) {
        const feedback = retryCandidates.map((candidate) => {
            const failure = failureById.get(candidateActorId(candidate));
            const detail = failure?.missingFields?.length
                ? failure.missingFields.join(',')
                : failure?.reason || 'actor_profile.missing_candidate';
            return `${candidateActorId(candidate)}:${detail}`;
        });
        feedback.push(...unresolved.map((entry) => (
            `${entry.candidateRef?.name || 'candidateRef'}:${entry.reason}`
        )));
        const retry = await collect(
            retryCandidates,
            feedback,
            1,
            retryDiscoveryTargets,
        );
        if (retry.stale) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    'actor_profile.target_stale',
                ));
            }
            unresolved = unresolved.map((entry) => ({
                ...entry,
                reason: 'actor_profile.target_stale',
                retryable: false,
            }));
        } else if (retry.requestFailure) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    `actor_profile.${retry.requestFailure.category}`,
                    { routeDiagnostic: retry.requestFailure.routeDiagnostic },
                ));
            }
            unresolved = unresolved.map((entry) => ({
                ...entry,
                reason: `actor_profile.${retry.requestFailure.category}`,
                routeDiagnostic: retry.requestFailure.routeDiagnostic,
                retryable: false,
            }));
        } else {
            for (const entry of retry.entries || []) {
                acceptedById.set(entry.actorId, entry);
                failureById.delete(entry.actorId);
            }
            for (const failure of retry.failures || []) {
                failureById.set(failure.actorId, failure);
            }
            rejected.push(...(retry.unexpected || []));
            const retriedKeys = new Set(retryDiscoveryTargets.map((entry) => (
                `${entry.name}\u0000${entry.sourceAnchor}`
            )));
            const retryByKey = new Map();
            for (const entry of retry.discoveries || []) {
                const key = `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`;
                if (retriedKeys.has(key)) retryByKey.set(key, entry);
                else rejected.push({
                    candidateRef: clone(entry.candidateRef),
                    reason: 'actor_profile.discovery_retry_unexpected',
                });
            }
            discoveries = discoveries.filter((entry) => !retriedKeys.has(
                `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`,
            ));
            discoveries.push(...retryByKey.values());
            const untouchedUnresolved = unresolved.filter((entry) => !retriedKeys.has(
                `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}`,
            ));
            const retryUnresolved = [...(retry.unresolved || [])];
            for (const targetRef of retryDiscoveryTargets) {
                const key = `${targetRef.name}\u0000${targetRef.sourceAnchor}`;
                if (
                    retryByKey.has(key)
                    || retryUnresolved.some((entry) => (
                        `${entry.candidateRef?.name}\u0000${entry.candidateRef?.sourceAnchor}` === key
                    ))
                ) continue;
                retryUnresolved.push({
                    candidateRef: clone(targetRef),
                    reason: 'actor_profile.discovery_retry_missing',
                    missingFields: [],
                    retryable: false,
                });
            }
            unresolved = [...untouchedUnresolved, ...retryUnresolved];
        }
    }

    if (!await current()) {
        return {
            ...base,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
        };
    }

    let resolved;
    try {
        resolved = await resolveDiscoveries({
            discoveries: clone(discoveries),
            unresolved: clone(unresolved),
            unexpected: clone(rejected),
            explicitEmpty,
        });
    } catch (error) {
        resolved = {
            ok: false,
            ledger: originalLedger,
            reason: cleanText(error?.message || error, 240) || 'actor_profile.discovery_failed',
        };
    }
    const resolvedLedger = normalizeActorLedger(
        resolved?.ledger || originalLedger,
        { chatId: originalLedger.chatId },
    );
    rejected.push(...(resolved?.rejected || []));
    const discoveryFailures = [
        ...unresolved,
        ...(resolved?.failures || []),
    ];
    if (resolved?.ok !== true) {
        return {
            ...base,
            ledger: resolvedLedger,
            modelCalls,
            rejected,
            failures: [
                ...inputFailures,
                ...selected
                    .map((candidate) => failureById.get(candidateActorId(candidate)))
                    .filter(Boolean),
                ...discoveryFailures,
                { reason: resolved?.reason || 'actor_profile.discovery_failed' },
            ],
            explicitEmpty,
            registry: clone(resolved?.registry || null),
        };
    }

    const resolvedCandidates = Array.isArray(resolved.candidates)
        ? resolved.candidates
        : [];
    const resolvedCandidateById = new Map(resolvedCandidates.map((candidate) => [
        candidateActorId(candidate),
        candidate,
    ]));
    for (const entry of Array.isArray(resolved.entries) ? resolved.entries : []) {
        const actorId = cleanText(entry?.actorRef?.actorId, 120);
        const context = resolvedCandidateById.get(actorId);
        const profileCandidate = clone(entry?.candidate);
        if (!actorId || !context || !profileCandidate) {
            discoveryFailures.push({
                candidateId: cleanText(entry?.candidateId, 120),
                reason: 'actor_profile.discovery_promotion_mapping_missing',
            });
            continue;
        }
        profileCandidate.actorRef = clone(context.actorRef);
        delete profileCandidate.candidateRef;
        const validation = validateActorProfileInsertCandidate(profileCandidate, context);
        if (!validation.ok) {
            discoveryFailures.push({
                actorId,
                name: candidateName(context),
                reason: validation.errorCode || 'actor_profile.schema_incomplete',
                missingFields: validation.missingFields || [],
            });
            continue;
        }
        acceptedById.set(actorId, {
            actorId,
            name: candidateName(context),
            candidate: validation.candidate,
            repairs: entry.repairs || [],
            resolutions: validation.resolutions || [],
        });
    }

    const allCandidates = [...selected, ...resolvedCandidates]
        .filter((candidate, index, list) => (
            candidateActorId(candidate)
            && list.findIndex((item) => candidateActorId(item) === candidateActorId(candidate)) === index
        ));
    if (!allCandidates.length) {
        return {
            ...base,
            ledger: resolvedLedger,
            candidates: [],
            modelCalls,
            rejected,
            failures: [...inputFailures, ...discoveryFailures],
            persistenceStatus: explicitEmpty
                && !rejected.length
                && !discoveryFailures.length
                ? 'no_candidates'
                : 'not_completed',
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }

    let workingLedger = clone(resolvedLedger);
    const prepared = [];
    for (const candidate of allCandidates) {
        const actorId = candidateActorId(candidate);
        const completion = acceptedById.get(actorId);
        if (!completion) continue;
        const actor = workingLedger.actors.find((entry) => entry.id === actorId);
        if (!actor || actor.name !== candidateName(candidate)) {
            failureById.set(actorId, failureFor(candidate, 'actor_profile.target_stale'));
            acceptedById.delete(actorId);
            continue;
        }
        const baseline = materializeActorProfileBaseline(
            actor.profileV6,
            completion.candidate,
            { turn, completionMode: candidate.completionMode },
        );
        const digest = actorProfileBaselineDigest(baseline);
        const commitId = `PBI-${fingerprint(JSON.stringify([
            target.chatId,
            target.messageId,
            target.swipeId,
            target.generationId,
            actorId,
            digest,
        ])).slice(0, 24)}`;
        const expectedCommit = {
            actorRef: { actorId, name: candidateName(candidate) },
            schemaVersion: baseline.version,
            commitId,
            digest,
            profileDigest: digest,
            sourceRef: clone(target.sourceRef || null),
            scopeDigest: cleanText(target.sourceRef?.scopeDigest, 180),
            locks: clone(actor.profileV6?.locks || {}),
            manualOverrides: clone(actor.profileV6?.manualOverrides || {}),
        };
        const replaced = replaceActorProfileBaselineInLedger(
            workingLedger,
            expectedCommit.actorRef,
            baseline,
            {
                ...expectedCommit,
                sourceRef: clone(target.sourceRef || null),
                committedTurn: turn,
                readbackVerified: false,
                phase: 'pending',
            },
        );
        if (!replaced.committed) {
            failureById.set(actorId, failureFor(
                candidate,
                replaced.reason || 'actor_profile.commit_rejected',
            ));
            acceptedById.delete(actorId);
            continue;
        }
        workingLedger = replaced.ledger;
        prepared.push({
            actorId,
            name: candidateName(candidate),
            commitId,
            digest,
            expectedCommit: { ...expectedCommit, profileDigest: digest, phase: 'pending' },
            repairs: completion.repairs || [],
            resolutions: completion.resolutions || [],
        });
    }
    if (!prepared.length) {
        return {
            ...base,
            ledger: resolvedLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }
    if (!await current()) {
        return {
            ...base,
            ledger: resolvedLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }

    const preparedFieldRevision = Math.max(
        0,
        Number(resolved?.snapshot?.fieldRevision) || 0,
    );
    const expectedCommits = prepared.map((entry) => clone(entry.expectedCommit));
    const transactionId = actorProfileTransactionId({
        chatId: target.chatId,
        sourceRef: target.sourceRef,
        preparedFieldRevision,
        expectedCommits,
    });
    const sealed = sealActorProfilePendingTransactionInLedger(workingLedger, expectedCommits, {
        transactionId,
        preparedFieldRevision,
    });
    if (!sealed.sealed) {
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, sealed.reason || 'actor_profile.pending_transaction_mismatch'));
        }
        return {
            ...base,
            ledger: resolvedLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }
    workingLedger = sealed.ledger;
    const { preparedLedgerDigest, writeSetDigest } = sealed;
    let pendingPersisted;
    try {
        pendingPersisted = await persistPendingBatch({
            ledger: workingLedger,
            expectedCommits,
            expectedState: clone(resolved.snapshot || null),
            preparedLedgerDigest,
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        });
    } catch (error) {
        pendingPersisted = {
            ok: false,
            reason: cleanText(error?.message || error, 200) || 'host_save_rejected',
        };
    }
    const pendingLedger = pendingPersisted?.ok === true
        ? normalizeActorLedger(pendingPersisted.ledger, { chatId: originalLedger.chatId })
        : null;
    const pendingReadbackOk = pendingLedger
        && expectedCommits.every((expected) => actorProfileCommitMatchesLedger(
            pendingLedger,
            {
                ...expected,
                transactionId,
                writeSetDigest,
                preparedLedgerDigest,
                preparedFieldRevision,
                phase: 'pending',
            },
        ).ok)
        && actorProfilePendingWriteSetDigest(pendingLedger, expectedCommits, {
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        }) === preparedLedgerDigest;
    if (!pendingPersisted?.ok || !pendingReadbackOk) {
        const reason = persistenceFailureReason(
            pendingPersisted?.reason || 'host_save_readback_mismatch',
        );
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, reason));
        }
        return {
            ...base,
            ledger: resolvedLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }

    const finalized = finalizeActorProfileBaselinesInLedger(
        pendingLedger,
        expectedCommits,
        { preparedLedgerDigest, preparedFieldRevision, transactionId, writeSetDigest },
    );
    if (!finalized.finalized) {
        return {
            ...base,
            ledger: pendingLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [
                ...inputFailures,
                ...discoveryFailures,
                ...prepared.map((entry) => failureFor(
                    entry,
                    finalized.reason || 'actor_profile.finalize_rejected',
                )),
            ],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }

    let finalPersisted;
    try {
        finalPersisted = await persistFinalizedBatch({
            ledger: finalized.ledger,
            readShadowLedger: pendingLedger,
            expectedCommits: expectedCommits.map((expected) => ({
                ...expected,
                phase: 'final',
            })),
            expectedState: clone(pendingPersisted.snapshot || null),
            preparedLedgerDigest,
            preparedFieldRevision,
            transactionId,
            writeSetDigest,
        });
    } catch (error) {
        finalPersisted = {
            ok: false,
            reason: cleanText(error?.message || error, 200) || 'host_save_rejected',
        };
    }
    const persistedLedger = finalPersisted?.ok === true
        ? normalizeActorLedger(finalPersisted.ledger, { chatId: originalLedger.chatId })
        : null;
    const finalReadbackOk = persistedLedger && expectedCommits.every((expected) => (
        actorProfileCommitMatchesLedger(
            persistedLedger,
            {
                ...expected,
                transactionId,
                writeSetDigest,
                preparedLedgerDigest,
                preparedFieldRevision,
                phase: 'final',
            },
        ).ok
    ));
    if (!finalPersisted?.ok || !finalReadbackOk) {
        const reason = persistenceFailureReason(
            finalPersisted?.reason || 'host_save_readback_mismatch',
        );
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, reason));
        }
        return {
            ...base,
            ledger: pendingLedger,
            candidates: allCandidates,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...allCandidates
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean), ...discoveryFailures],
            explicitEmpty,
            registry: clone(resolved.registry || null),
        };
    }
    return {
        ledger: persistedLedger,
        candidates: allCandidates,
        accepted: prepared.map(({ expectedCommit: _expectedCommit, ...entry }) => entry),
        rejected,
        failures: [...inputFailures, ...allCandidates
            .map((candidate) => failureById.get(candidateActorId(candidate)))
            .filter(Boolean), ...discoveryFailures],
        persistenceMeta: clone(finalPersisted.persistenceMeta || null),
        modelCalls,
        persistenceStatus: 'atomic_readback',
        readbackVerified: true,
        explicitEmpty,
        registry: clone(resolved.registry || null),
        batchMeta: clone(batchMeta),
        batchFormatReplacementAttempted,
    };
    } finally {
        discardActorProfileDiscoveryProofBatches([...narrativeProofBatchIds]);
    }
}
