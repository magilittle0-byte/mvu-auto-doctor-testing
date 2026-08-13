import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDoctorRuntimePresentation, createPrivacySafeDiagnosticProjection } from '../v2/surface/diagnostics.mjs';
import {
    actorProfileNoCandidatesTerminalProofMatches,
    actorProfileRecoveryCriticalFingerprint,
    actorProfileRecoverySourceMatches,
    actorProfileRetryReceiptMatches,
    actorProfileTicketBatchPersistenceMatches,
    createActorProfileRetryReceipt,
    createActorProfileNoCandidatesTerminalProof,
    issueCharacterCreationTicket,
    sealActorProfileTicketBatchForPersistence,
} from '../actor-profile-v6-core.mjs';

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const diagnosticsSource = await readFile(new URL('../v2/surface/diagnostics.mjs', import.meta.url), 'utf8');

function sourceBetween(text, startNeedle, endNeedle) {
    const start = text.indexOf(startNeedle);
    const end = text.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(start, -1, startNeedle);
    assert.notEqual(end, -1, endNeedle);
    return text.slice(start, end);
}

test('diagnostic export includes profile failures, missing modules and retry control', () => {
    assert.match(indexSource, /statuses:\s*\{[\s\S]*?profile:\s*\{/u);
    assert.match(indexSource, /failingModules:\s*deepClone\(profileDiagnostic\.failingModules\)/u);
    assert.match(indexSource, /lastFailureCodes:\s*deepClone\(profileDiagnostic\.lastFailureCodes\)/u);
    assert.match(indexSource, /canRetry:\s*profileDiagnostic\.canRetry/u);
    assert.match(indexSource, /noCandidatesTerminalProof,/u);
    assert.match(indexSource, /validationDiagnostic\?\.missingModules|validation\.missingModules/u);
    assert.doesNotMatch(indexSource, /validationDiagnostic\?\.missingSections/u);
});

test('chat-scoped reset clears ephemeral profile failure before new-chat hydration', () => {
    const reset = sourceBetween(
        indexSource,
        'function resetChatScopedRuntimeDiagnostics()',
        'let activeTaskProgress',
    );
    assert.match(reset, /latestActorProfileDiagnostic = \{\s*status: 'waiting', failingModules: \[\], lastFailureCodes: \[\], canRetry: false,?\s*\}/u);
    assert.ok(
        reset.indexOf('latestActorProfileDiagnostic =')
            < reset.indexOf('latestActorShardDiagnostics ='),
        'profile memory must reset as part of the same chat-scoped diagnostic reset',
    );
});

test('profile recovery uses the existing namespace with durable readback and survives refresh hydration', () => {
    assert.match(indexSource, /characterCreationTicketBatches:\s*\[\]/u);
    assert.match(indexSource, /actorProfileRetryReceipt:\s*null/u);
    assert.match(indexSource, /'characterCreationTicketBatches',[\s\S]*?'actorProfileRetryReceipt',[\s\S]*?'actorProfileNoCandidatesTerminalProof'/u);
    assert.match(indexSource, /requireReadback:\s*true/u);
    assert.match(indexSource, /actorProfileRetryReceiptMatches\(receipt, \{ currentSourceRef, ticketBatch \}\)/u);
    assert.match(indexSource, /persistNpcDesignTicketBatch\(\s*preGenerationTicket,\s*captured,\s*ticketPersistenceFailure/u);
    const ticketPersistence = sourceBetween(
        indexSource,
        'async function persistNpcDesignTicketBatch',
        'function retireNpcDesignTicketInjection',
    );
    const recoveryPersistence = sourceBetween(
        indexSource,
        'async function persistActorProfileRecoveryState',
        'function compactActorProfileFailureCode',
    );
    assert.match(ticketPersistence, /readbackAttempts:\s*3/u);
    assert.match(recoveryPersistence, /readbackAttempts:\s*3/u);
    assert.match(recoveryPersistence, /validationDiagnostic\?\.failingGroups/u);
    assert.match(recoveryPersistence, /validationDiagnostic\?\.missingModules/u);
    assert.match(recoveryPersistence, /expectedReceipt: namespace\.actorProfileRetryReceipt/u);
    assert.match(ticketPersistence, /contentValidator:\s*\(persistedNamespace\) =>/u);
    assert.match(indexSource, /precondition: sourceStillCurrent/u);
    assert.match(indexSource, /contentValidator: \(persisted\) =>/u);
    assert.match(indexSource, /actorProfileTicketPersistenceFailureCode\(\s*ticketPersistenceFailure/u);
});

function recoverySource(overrides = {}) {
    return {
        chatId: 'chat-recovery', messageId: 'message-8', logicalIndex: 8, index: 8,
        swipeId: 1, generation: 4, generationSerial: 4, generationId: 'generation-4',
        generationType: 'normal', type: 'normal', identityScope: { cardId: 'card-a' },
        identityScopeId: 'chat-recovery|card-a', scope: { cardId: 'card-a' },
        scopeDigest: 'scope-digest', hash: 'raw-hash', contentHash: 'accepted-hash',
        contentFingerprint: 'accepted-hash', ...overrides,
    };
}

function ticketBatchFor(source) {
    const ticket = issueCharacterCreationTicket({ id: 'roll-1', name: 'candidate-1' }, {
        entropy: 'fixed-recovery-test', target: source, order: 1,
    });
    return {
        chatId: source.chatId,
        generation: source.generation,
        generationSerial: source.generationSerial,
        generationId: source.generationId,
        generationType: source.generationType,
        capacity: 1,
        tickets: [ticket],
    };
}

test('recovery receipt survives refresh only for the exact accepted target and intact ticket digest', () => {
    const current = recoverySource();
    const sealedTicket = sealActorProfileTicketBatchForPersistence(ticketBatchFor(current), current);
    assert.ok(sealedTicket);
    assert.equal(actorProfileTicketBatchPersistenceMatches(sealedTicket, { acceptedTarget: current }), true);
    const receipt = createActorProfileRetryReceipt({
        sourceRef: current,
        ticketBatch: sealedTicket,
        outcomeStatus: 'not_completed',
        failingModules: ['personality'],
        failureCodes: ['actor_profile.module_content_incomplete'],
        updatedAt: 123,
    });
    const savedNamespace = JSON.parse(JSON.stringify({
        characterCreationTicketBatches: [sealedTicket],
        actorProfileRetryReceipt: receipt,
    }));
    assert.equal(actorProfileRetryReceiptMatches(savedNamespace.actorProfileRetryReceipt, {
        currentSourceRef: current,
        ticketBatch: savedNamespace.characterCreationTicketBatches[0],
    }), true);
    const generationDrift = recoverySource({ generation: 99 });
    assert.equal(actorProfileRecoverySourceMatches(current, generationDrift), false);
    assert.equal(sealActorProfileTicketBatchForPersistence(ticketBatchFor(current), generationDrift), null);
    assert.equal(actorProfileTicketBatchPersistenceMatches(sealedTicket, {
        acceptedTarget: generationDrift,
    }), false);
    assert.equal(actorProfileRetryReceiptMatches(receipt, {
        currentSourceRef: generationDrift,
        ticketBatch: sealedTicket,
    }), false);
    const mechanismOnlyRefresh = recoverySource({ hash: 'mechanism-block-rewritten' });
    assert.equal(actorProfileRecoverySourceMatches(current, mechanismOnlyRefresh), true);
    assert.equal(actorProfileRetryReceiptMatches(savedNamespace.actorProfileRetryReceipt, {
        currentSourceRef: mechanismOnlyRefresh,
        ticketBatch: savedNamespace.characterCreationTicketBatches[0],
    }), true);
    assert.equal(actorProfileRetryReceiptMatches(receipt, {
        currentSourceRef: recoverySource({ contentFingerprint: 'changed', contentHash: 'changed' }),
        ticketBatch: sealedTicket,
    }), false);
    const damaged = structuredClone(sealedTicket);
    damaged.tickets[0].ticketId = 'tampered';
    assert.equal(actorProfileTicketBatchPersistenceMatches(damaged, { acceptedTarget: current }), false);
    assert.equal(actorProfileRetryReceiptMatches(receipt, {
        currentSourceRef: current, ticketBatch: damaged,
    }), false);
});

test('current retry receipt seals diagnostic arrays while bounded V2 compatibility rejects missing fields', () => {
    const current = recoverySource();
    const receipt = createActorProfileRetryReceipt({
        sourceRef: current,
        failingModules: ['identity_bootstrap', 'person', 'identity_bootstrap'],
        failureCodes: [
            'actor_candidate.identity_excluded',
            'actor_profile.module_content_incomplete',
            'actor_candidate.identity_excluded',
        ],
        updatedAt: 456,
    });
    assert.equal(receipt.version, 3);
    assert.deepEqual(receipt.failingModules, ['identity_bootstrap', 'person']);
    assert.deepEqual(receipt.failureCodes, [
        'actor_candidate.identity_excluded',
        'actor_profile.module_content_incomplete',
    ]);
    assert.equal(actorProfileRetryReceiptMatches(receipt, {
        currentSourceRef: current,
        ticketBatch: null,
        expectedReceipt: structuredClone(receipt),
    }), true);
    for (const field of ['failingModules', 'failureCodes']) {
        const deleted = structuredClone(receipt);
        delete deleted[field];
        assert.equal(actorProfileRetryReceiptMatches(deleted, {
            currentSourceRef: current, ticketBatch: null,
        }), false, `${field}:deleted`);
        const truncated = structuredClone(receipt);
        truncated[field] = truncated[field].slice(1);
        assert.equal(actorProfileRetryReceiptMatches(truncated, {
            currentSourceRef: current, ticketBatch: null,
        }), false, `${field}:truncated`);
        const changed = structuredClone(receipt);
        changed[field][0] = `${changed[field][0]}.tampered`;
        assert.equal(actorProfileRetryReceiptMatches(changed, {
            currentSourceRef: current, ticketBatch: null,
        }), false, `${field}:changed`);
        const reordered = structuredClone(receipt);
        reordered[field].reverse();
        assert.equal(actorProfileRetryReceiptMatches(reordered, {
            currentSourceRef: current, ticketBatch: null,
        }), false, `${field}:reordered`);
    }
    const oldified = structuredClone(receipt);
    oldified.version = 2;
    delete oldified.receiptDigest;
    assert.equal(actorProfileRetryReceiptMatches(oldified, {
        currentSourceRef: current, ticketBatch: null,
    }), true, 'canonical V2 receipt remains refresh-compatible');
    assert.equal(actorProfileRetryReceiptMatches(oldified, {
        currentSourceRef: current, ticketBatch: null, expectedReceipt: receipt,
    }), false, 'host oldification cannot satisfy a current V3 write readback');
    for (const field of ['failingModules', 'failureCodes']) {
        const incompleteV2 = structuredClone(oldified);
        delete incompleteV2[field];
        assert.equal(actorProfileRetryReceiptMatches(incompleteV2, {
            currentSourceRef: current, ticketBatch: null,
        }), false, `legacy V2 missing ${field} cannot hydrate`);
    }
});

test('no-candidates terminal receipt reuses recovery source identity and seals its payload', () => {
    const current = recoverySource();
    const proof = createActorProfileNoCandidatesTerminalProof({ sourceRef: current });
    assert.ok(proof);
    assert.equal(actorProfileNoCandidatesTerminalProofMatches(proof, {
        currentSourceRef: structuredClone(current), expectedProof: structuredClone(proof),
    }), true);
    for (const [field, changed] of [
        ['generationId', 'generation-other'],
        ['generationType', 'swipe'],
        ['scopeDigest', 'scope-other'],
        ['identityScopeId', 'chat-recovery|card-other'],
        ['contentFingerprint', 'accepted-other'],
    ]) {
        const target = recoverySource({ [field]: changed });
        if (field === 'generationType') target.type = changed;
        if (field === 'contentFingerprint') target.contentHash = changed;
        assert.equal(actorProfileNoCandidatesTerminalProofMatches(proof, {
            currentSourceRef: target,
        }), false, field);
    }
    assert.equal(actorProfileNoCandidatesTerminalProofMatches(proof, {
        currentSourceRef: recoverySource({ hash: 'mechanism-refresh' }),
    }), true, 'the shared recovery matcher permits mechanism-only host hash refresh');
    for (const mutate of [
        (value) => { value.kind = 'parallel_state_machine'; },
        (value) => { value.status = 'not_completed'; },
        (value) => { value.proofDigest = 'tampered'; },
        (value) => { value.sourceRef.contentFingerprint = 'tampered'; },
    ]) {
        const damaged = structuredClone(proof);
        mutate(damaged);
        assert.equal(actorProfileNoCandidatesTerminalProofMatches(damaged, {
            currentSourceRef: current,
        }), false);
    }
});

test('recovery target comparison is complete and receipt status fails closed', () => {
    const source = recoverySource();
    assert.equal(actorProfileRecoverySourceMatches(source, structuredClone(source)), true);
    for (const [field, changed] of [
        ['chatId', 'other-chat'], ['messageId', 'other-message'], ['logicalIndex', 9],
        ['swipeId', 2], ['generation', 99], ['generationSerial', 5], ['generationId', 'other-generation'],
        ['generationType', 'regenerate'], ['identityScopeId', 'other-scope'],
        ['scopeDigest', 'other-digest'],
        ['contentFingerprint', 'other-content'],
    ]) {
        assert.equal(actorProfileRecoverySourceMatches(source, recoverySource({
            [field]: changed,
            ...(field === 'logicalIndex' ? { index: changed } : {}),
            ...(field === 'generationType' ? { type: changed } : {}),
            ...(field === 'contentFingerprint' ? { contentHash: changed } : {}),
        })), false, field);
    }
    assert.equal(actorProfileRecoverySourceMatches(
        source,
        recoverySource({ hash: 'mechanism-only-change' }),
    ), true, 'full host hash may change while accepted narrative identity stays exact');
    const noTicketReceipt = createActorProfileRetryReceipt({ sourceRef: source });
    assert.equal(actorProfileRetryReceiptMatches(noTicketReceipt, {
        currentSourceRef: source, ticketBatch: null,
    }), true);
    assert.equal(actorProfileRetryReceiptMatches({ ...noTicketReceipt, status: 'no_candidates' }, {
        currentSourceRef: source, ticketBatch: null,
    }), false);
});

test('failed profile is described plainly and cannot be hidden by busy presentation', () => {
    assert.match(indexSource, /人物档案没有生成。影响：人物暂未行动就绪/u);
    assert.match(indexSource, /零人物结论保存后无法回读验证，已转为可重试状态/u);
    assert.match(diagnosticsSource, /profileCanRetry === true/u);
    assert.match(diagnosticsSource, /actorScheduling:\s*\{/u);
    assert.match(diagnosticsSource, /actorShards:\s*\{ deprecated: true \}/u);
});

test('privacy-safe diagnostic behavior preserves controlled profile recovery fields', () => {
    const projected = createPrivacySafeDiagnosticProjection({
        plugin: {
            id: 'mvu-auto-doctor', version: '2.0.0-rc.14',
            runtimeCriticalFingerprint: 'runtime-critical:12345:abcdef12',
        },
        statuses: {
            profile: {
                kind: 'error', status: 'not_completed',
                failingModules: ['personality'],
                lastFailureCodes: ['actor_profile.module_missing'], canRetry: true,
            },
        },
        actorShards: {
            status: 'not_reached_by_p1', failed: 0,
            failureCodes: [
                'actor_scheduling.advance_parse_failed',
                'actor_shard.json_missing',
                'world.private_payload',
            ],
            upstreamFailureCodes: [
                'actor_profile.host_save_readback_mismatch',
                'actor_candidate.identity_excluded',
                'actor_candidate.private_runtime_text',
                'private text',
            ],
        },
    });
    assert.equal(projected.plugin.runtimeCriticalFingerprint, 'runtime-critical:12345:abcdef12');
    assert.deepEqual(projected.latestStatuses.profile, {
        kind: 'error', status: 'not_completed', failingModules: ['personality'],
        lastFailureCodes: ['actor_profile.module_missing'], canRetry: true,
        noCandidatesTerminalProof: false,
    });
    assert.deepEqual(projected.actorScheduling.advanceFailureCodes, [
        'actor_scheduling.advance_parse_failed',
        'actor_scheduling.json_missing',
    ]);
    assert.equal(projected.actorScheduling.status, 'not_reached_by_p1');
    assert.equal(projected.actorScheduling.failed, 0);
    assert.deepEqual(projected.actorScheduling.upstreamFailureCodes, [
        'actor_profile.host_save_readback_mismatch',
        'actor_candidate.identity_excluded',
    ]);
    assert.deepEqual(projected.actorShards, { deprecated: true });
});

test('privacy projection admits only the bounded actor identity failure whitelist', () => {
    const allowed = [
        'actor_candidate.identity_missing_or_short',
        'actor_candidate.identity_system',
        'actor_candidate.identity_group',
        'actor_candidate.identity_excluded',
        'actor_candidate.identity_internal_id',
        'actor_candidate.identity_registry_conflict',
        'actor_candidate.identity_quarantined',
    ];
    const projected = createPrivacySafeDiagnosticProjection({
        actorShards: {
            upstreamFailureCodes: [
                ...allowed,
                'actor_candidate.identity_private_extension',
                'actor_candidate.alias_conflict',
                'actor_candidate.private_payload',
            ],
        },
    });
    assert.deepEqual(projected.actorScheduling.upstreamFailureCodes, allowed.slice(0, 4));
    const second = createPrivacySafeDiagnosticProjection({
        actorShards: { upstreamFailureCodes: allowed.slice(4) },
    });
    assert.deepEqual(second.actorScheduling.upstreamFailureCodes, allowed.slice(4));
});

test('opening greeting never becomes a Doctor target before a real player input', () => {
    const helperSource = sourceBetween(
        indexSource,
        'function assistantTargetHasPriorRealPlayerInput',
        'function captureTarget',
    );
    const helper = Function(`${helperSource}; return assistantTargetHasPriorRealPlayerInput;`)();
    const opening = { is_user: false, mes: '默认开场', swipe_info: [{ extra: {} }] };
    const context = { chat: [opening] };
    assert.equal(helper(context, 0), false);
    assert.deepEqual(opening.swipe_info[0].extra, {});
    context.chat.push({ is_user: true, mes: '真实玩家输入' });
    context.chat.push({ is_user: false, mes: '第一条自然回复' });
    assert.equal(helper(context, 2), true);
    const capture = sourceBetween(indexSource, 'function captureTarget', 'async function freshFrozenScopeGuard');
    assert.ok(
        capture.indexOf('assistantTargetHasPriorRealPlayerInput')
            < capture.indexOf('ensureMessageStableId'),
        'opening must be rejected before message/swipe identity mutation',
    );
});

test('diagnostic critical fingerprint is runtime-derived and covers the accepted-final chain', () => {
    const fingerprintSource = sourceBetween(
        indexSource,
        'function doctorRuntimeCriticalFingerprint',
        'function diagnosticPayload',
    );
    assert.match(fingerprintSource, /actorProfileRecoveryCriticalFingerprint\(\)/u);
    assert.match(fingerprintSource, /finalizeActorProfileRecoveryOutcome\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3NoActorPermitMatches\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3LedgerReadbackGate\.toString\(\)/u);
    assert.match(fingerprintSource, /writeChatNamespace\.toString\(\)/u);
    assert.match(fingerprintSource, /rebaseActorSovereigntyFieldWriteAfterMigration\.toString\(\)/u);
    assert.match(fingerprintSource, /persistNpcDesignTicketBatch\.toString\(\)/u);
    assert.match(fingerprintSource, /assistantTargetHasPriorRealPlayerInput\.toString\(\)/u);
    assert.match(fingerprintSource, /captureTarget\.toString\(\)/u);
    assert.match(fingerprintSource, /actorProfileNoCandidatesTerminalReadbackMatches\.toString\(\)/u);
    assert.match(fingerprintSource, /runActorProfileTarget\.toString\(\)/u);
    assert.match(fingerprintSource, /actorActionTargetOf\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3PreparedWorldCheckpoint\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3PreparedWorldCheckpointMatches\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3PreparedPhase1StatesMatch\.toString\(\)/u);
    assert.match(fingerprintSource, /extractFirstBalancedJsonObject\.toString\(\)/u);
    assert.match(fingerprintSource, /stage3RecallSelection\.toString\(\)/u);
    assert.match(fingerprintSource, /generateWorldRecallPacket\.toString\(\)/u);
    assert.match(fingerprintSource, /actorActionCandidatesFromShard\.toString\(\)/u);
    assert.match(fingerprintSource, /markActorSchedulingNotReachedByProfile\.toString\(\)/u);
    assert.match(fingerprintSource, /createPrivacySafeDiagnosticProjection\.toString\(\)/u);
    assert.match(fingerprintSource, /acceptFinalGeneration\.toString\(\)/u);
    assert.match(fingerprintSource, /runContinuityTarget\.toString\(\)/u);
    assert.match(fingerprintSource, /commitPreparedWorldCandidate\.toString\(\)/u);
    assert.match(fingerprintSource, /precomposeNextTurnConsumer\.toString\(\)/u);
    assert.match(fingerprintSource, /commitNextTurnConsumer\.toString\(\)/u);
    assert.doesNotMatch(fingerprintSource, /[0-9a-f]{7,40}/u);
});

test('changing any recovery helper implementation changes the critical manifest fingerprint', () => {
    const names = [
        'normalizeActorProfileRecoverySourceRef',
        'actorProfileRecoverySourceDigest',
        'actorProfileRecoverySourceMatches',
        'actorProfileTicketBatchDigestPayload',
        'actorProfileTicketBatchShapeValid',
        'actorProfileTicketBatchPersistenceDigest',
        'sealActorProfileTicketBatchForPersistence',
        'actorProfileTicketBatchPersistenceMatches',
        'normalizeActorProfileRetryDiagnosticList',
        'actorProfileRetryDiagnosticListsMatch',
        'actorProfileRetryReceiptDigestPayload',
        'actorProfileRetryReceiptDigest',
        'createActorProfileRetryReceipt',
        'actorProfileRetryReceiptMatches',
        'actorProfileNoCandidatesTerminalProofPayload',
        'actorProfileNoCandidatesTerminalProofDigest',
        'createActorProfileNoCandidatesTerminalProof',
        'actorProfileNoCandidatesTerminalProofMatches',
    ];
    const baseline = actorProfileRecoveryCriticalFingerprint();
    for (const name of names) {
        assert.notEqual(
            actorProfileRecoveryCriticalFingerprint({ [name]: `function ${name}(){return 'changed'}` }),
            baseline,
            name,
        );
    }
});

test('ticket persistence errors become bounded privacy-safe P1 and P3 upstream codes', () => {
    const helperSource = sourceBetween(
        indexSource,
        'function actorProfileTicketPersistenceFailureCode',
        'async function runActorProfileTarget',
    );
    const normalize = Function(`${helperSource}; return actorProfileTicketPersistenceFailureCode;`)();
    for (const raw of [
        'host_save_readback_mismatch',
        'write_precondition_failed',
        'migration.write_rebase_field_changed',
    ]) {
        const code = normalize({ migrationReason: raw });
        assert.equal(code, `actor_profile.ticket_persistence.${raw}`);
        const projected = createPrivacySafeDiagnosticProjection({
            statuses: { profile: { lastFailureCodes: [code] } },
            actorShards: {
                status: 'not_reached_by_p1',
                failureCodes: ['actor_scheduling.not_reached_by_p1'],
                upstreamFailureCodes: [code],
            },
        });
        assert.deepEqual(projected.latestStatuses.profile.lastFailureCodes, [code]);
        assert.deepEqual(projected.actorScheduling.upstreamFailureCodes, [code]);
    }
    assert.equal(normalize({ migrationReason: 'private text / payload' }),
        'actor_profile.ticket_persistence.unknown');
});

test('namespace writer rebases the selected field after first migration and before CAS preparation', () => {
    const writer = sourceBetween(
        indexSource,
        'async function writeChatNamespace',
        'function rebaseIdenticalNamespaceFields',
    );
    const before = writer.indexOf('const beforeMigrationNamespace = readChatNamespace(context)');
    const migrate = writer.indexOf('ensureActorSovereigntyMigrationPersisted');
    const replay = writer.indexOf('rebaseActorSovereigntyFieldWriteAfterMigration');
    const prepare = writer.indexOf('prepareActorSovereigntyFieldWriteCandidate');
    assert.ok(before >= 0 && before < migrate && migrate < replay && replay < prepare);
    assert.match(writer, /migration\.write_rebase_field_changed[\s\S]*?'stale_namespace_revision'/u);
});

test('P1 failure explicitly marks P3 actor scheduling as not reached', () => {
    const marker = sourceBetween(
        indexSource,
        'function markActorSchedulingNotReachedByProfile',
        'function markActorSchedulingSettled',
    );
    assert.match(marker, /status:\s*'not_reached_by_p1'/u);
    assert.match(marker, /actor_scheduling\.not_reached_by_p1/u);
    const enqueue = sourceBetween(indexSource, 'async function enqueueActorProfiles', 'async function confirmDangerousAction');
    assert.match(enqueue, /!\['atomic_readback', 'no_candidates'\]\.includes\(result\?\.status\)[\s\S]*?markActorSchedulingNotReachedByProfile/u);
});

test('profile recovery merges with world failures and outranks blue busy', () => {
    const view = createDoctorRuntimePresentation({
        sovereignty: {
            color: 'red', failingModules: ['world', 'profile'],
            lastFailureCodes: ['world.persistence_failed', 'actor_profile.module_missing'],
        },
        profileReadiness: { actorCount: 1, ready: 0, incomplete: 1 },
        backgroundActive: true,
        profileCanRetry: true,
    });
    assert.equal(view.color, 'red');
    assert.deepEqual(view.work.failingModules, ['world', 'profile']);
    assert.equal(view.controls.canRetry, true);
});

test('production actor scheduling diagnostics records schedule and pending ATT recovery', () => {
    const run = sourceBetween(
        indexSource,
        'async function runContinuityTarget',
        'function sameTargetExceptContent',
    );
    const phase2 = sourceBetween(
        indexSource,
        'async function commitPreparedWorldCandidate',
        'async function enqueueActorProfiles',
    );
    assert.match(run, /if \(pendingActions\.attempts\.length\) \{[\s\S]*?status: 'attempts_prepared'/u);
    assert.match(run, /status: scheduledActorIds\.length \? 'scheduled' : 'idle'/u);
    assert.match(run, /catch \(error\) \{[\s\S]*?markActorSchedulingFailure\('actor_scheduling\.advance_transport_failed'[^]*?return \{ status: 'failed'/u);
    assert.match(run, /if \(!parsed\.state\) \{[\s\S]*?actor_scheduling\.advance_parse_failed[^]*?continuity_output_invalid/u);
    assert.match(run, /if \(!persisted\.ok\) \{[\s\S]*?actor_scheduling\.phase1_persistence_failed[^]*?return \{ status: 'failed'/u);
    assert.match(run, /actor_scheduling\.phase1_attempt_readback_incomplete/u);
    assert.match(phase2, /status: 'attempts_prepared'[^]*?stage3PreparedPhase1StatesMatch/u);
    assert.match(phase2, /actor_scheduling\.phase2_persistence_readback_failed[^]*?return \{ status: 'failed'/u);
    assert.ok(
        phase2.indexOf('if (!saved)') < phase2.indexOf('markActorSchedulingSettled('),
        'Phase2 may only report settlement after durable save/readback succeeds',
    );
    assert.match(phase2, /markActorSchedulingSettled\(settlement\?\.results \|\| \[\], \{ recovered: worldModelCalls === 0 \}\)/u);
});

test('P3 settings expose the real exploration budget and inject actor addon only into Advance', () => {
    const settingsPanel = sourceBetween(indexSource, 'function buildSettingsPanel', "wrapper.querySelector('.mvuad-health-refresh')");
    const recall = sourceBetween(indexSource, 'function buildWorldRecallMessages', 'async function generateWorldRecallPacket');
    const advance = sourceBetween(indexSource, 'function buildContinuityMessages', 'async function generateWorldContinuitySingleBatch');
    const profile = sourceBetween(indexSource, 'async function completeActorProfilesForTurn', 'async function runActorProfileTarget');
    assert.doesNotMatch(settingsPanel, /mvuad-actor-shard-mode|关闭（0 次额外调用）|每名入选人物最多增加一次轻量调用/u);
    assert.match(settingsPanel, /mvuad-actor-scheduling-budget/u);
    assert.match(settingsPanel, /到期、逾期与饥饿人物全部进入调度，不受人数预算截断/u);
    assert.match(advance, /customActorAdvanceInstruction[\s\S]*?settings\.actorShardPromptAddon/u);
    assert.equal((advance.match(/customActorAdvanceInstruction \? \[customActorAdvanceInstruction\] : \[\]/gu) || []).length, 1);
    assert.doesNotMatch(recall, /actorShardPromptAddon|customActorAdvanceInstruction/u);
    assert.doesNotMatch(profile, /actorShardPromptAddon|customActorAdvanceInstruction/u);
    assert.match(indexSource, /actorActionAdvance: userPromptSlotMetadata\(settings\.actorShardPromptAddon\)/u);
    assert.match(indexSource, /actorShard: \{ deprecated: true \}/u);
});
