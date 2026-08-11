import { fingerprint } from './core.mjs';
import {
    actorProfileBaselineDigest,
    buildActorProfileCompletionMessages,
    materializeActorProfileBaseline,
    parseActorProfileCompletionBatchOutput,
} from './actor-profile-v6-core.mjs';
import {
    actorProfileCommitMatchesLedger,
    normalizeActorLedger,
    replaceActorProfileBaselineInLedger,
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
        'actor_profile.target_stale',
    ].includes(reason)) return 'actor_profile.target_stale';
    return 'actor_profile.commit_rejected';
}

export async function completeActorProfileBatchTransaction({
    ledger,
    candidates = [],
    evidenceText = '',
    customPrompt = '',
    turn = 0,
    target = {},
    semanticRetry = true,
    requestBatch,
    persistBatch,
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
    const originalLedger = normalizeActorLedger(ledger, { chatId: ledger?.chatId });
    const base = {
        ledger: originalLedger,
        candidates: supplied,
        accepted: [],
        rejected: [],
        failures: inputFailures,
        persistenceMeta: null,
        modelCalls: 0,
    };
    if (!selected.length) return base;
    if (typeof requestBatch !== 'function' || typeof persistBatch !== 'function') {
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
    let modelCalls = 0;
    const collect = async (subset, validationFeedback, attempt) => {
        const messages = buildActorProfileCompletionMessages(subset, {
            evidenceText,
            customPrompt,
            validationFeedback,
        });
        let output;
        try {
            modelCalls += 1;
            output = await requestBatch({
                candidates: clone(subset),
                messages,
                attempt,
            });
        } catch (error) {
            return {
                transportFailure: cleanText(
                    error?.validationReason || error?.message || error,
                    500,
                ),
            };
        }
        if (!await current()) return { stale: true };
        return parseActorProfileCompletionBatchOutput(output, { candidates: subset });
    };

    const first = await collect(selected, [], 0);
    if (first.transportFailure) {
        return {
            ...base,
            modelCalls,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.transport_failed',
                { detail: first.transportFailure },
            ))],
        };
    }
    if (first.stale) {
        return {
            ...base,
            modelCalls,
            failures: [...inputFailures, ...selected.map((candidate) => failureFor(
                candidate,
                'actor_profile.target_stale',
            ))],
        };
    }
    for (const entry of first.entries || []) acceptedById.set(entry.actorId, entry);
    for (const failure of first.failures || []) failureById.set(failure.actorId, failure);
    rejected.push(...(first.unexpected || []));

    const retryCandidates = semanticRetry
        ? selected.filter((candidate) => failureById.get(candidateActorId(candidate))?.retryable)
        : [];
    if (retryCandidates.length) {
        const feedback = retryCandidates.map((candidate) => {
            const failure = failureById.get(candidateActorId(candidate));
            const detail = failure?.missingFields?.length
                ? failure.missingFields.join(',')
                : failure?.reason || 'actor_profile.missing_candidate';
            return `${candidateActorId(candidate)}:${detail}`;
        });
        const retry = await collect(retryCandidates, feedback, 1);
        if (retry.stale) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    'actor_profile.target_stale',
                ));
            }
        } else if (retry.transportFailure) {
            for (const candidate of retryCandidates) {
                failureById.set(candidateActorId(candidate), failureFor(
                    candidate,
                    'actor_profile.transport_failed',
                    { detail: retry.transportFailure },
                ));
            }
        } else {
            for (const entry of retry.entries || []) {
                acceptedById.set(entry.actorId, entry);
                failureById.delete(entry.actorId);
            }
            for (const failure of retry.failures || []) {
                failureById.set(failure.actorId, failure);
            }
            rejected.push(...(retry.unexpected || []));
        }
    }

    let workingLedger = clone(originalLedger);
    const prepared = [];
    for (const candidate of selected) {
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
        };
        const replaced = replaceActorProfileBaselineInLedger(
            workingLedger,
            expectedCommit.actorRef,
            baseline,
            {
                ...expectedCommit,
                sourceRef: clone(target.sourceRef || null),
                committedTurn: turn,
                readbackVerified: true,
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
            expectedCommit,
            repairs: completion.repairs || [],
            resolutions: completion.resolutions || [],
        });
    }
    if (!prepared.length) {
        return {
            ...base,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...selected
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean)],
        };
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

    let persisted;
    try {
        persisted = await persistBatch({
            ledger: workingLedger,
            expectedCommits: prepared.map((entry) => clone(entry.expectedCommit)),
        });
    } catch (error) {
        persisted = {
            ok: false,
            reason: cleanText(error?.message || error, 200) || 'host_save_rejected',
        };
    }
    const persistedLedger = persisted?.ok === true
        ? normalizeActorLedger(persisted.ledger, { chatId: originalLedger.chatId })
        : null;
    const readbackOk = persistedLedger && prepared.every((entry) => (
        actorProfileCommitMatchesLedger(persistedLedger, entry.expectedCommit).ok
    ));
    if (!persisted?.ok || !readbackOk) {
        const reason = persistenceFailureReason(
            persisted?.reason || 'host_save_readback_mismatch',
        );
        for (const entry of prepared) {
            failureById.set(entry.actorId, failureFor(entry, reason));
        }
        return {
            ...base,
            modelCalls,
            rejected,
            failures: [...inputFailures, ...selected
                .map((candidate) => failureById.get(candidateActorId(candidate)))
                .filter(Boolean)],
        };
    }
    return {
        ledger: persistedLedger,
        candidates: supplied,
        accepted: prepared.map(({ expectedCommit: _expectedCommit, ...entry }) => entry),
        rejected,
        failures: [...inputFailures, ...selected
            .map((candidate) => failureById.get(candidateActorId(candidate)))
            .filter(Boolean)],
        persistenceMeta: clone(persisted.persistenceMeta || null),
        modelCalls,
    };
}
