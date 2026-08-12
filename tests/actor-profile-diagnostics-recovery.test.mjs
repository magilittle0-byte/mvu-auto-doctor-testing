import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDoctorRuntimePresentation, createPrivacySafeDiagnosticProjection } from '../v2/surface/diagnostics.mjs';
import {
    actorProfileRecoverySourceMatches,
    actorProfileRetryReceiptMatches,
    actorProfileTicketBatchPersistenceMatches,
    createActorProfileRetryReceipt,
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
    assert.match(indexSource, /fields:\s*\['characterCreationTicketBatches', 'actorProfileRetryReceipt'\]/u);
    assert.match(indexSource, /requireReadback:\s*true/u);
    assert.match(indexSource, /actorProfileRetryReceiptMatches\(receipt, \{ currentSourceRef, ticketBatch \}\)/u);
    assert.match(indexSource, /persistNpcDesignTicketBatch\(preGenerationTicket, captured\)/u);
    assert.match(indexSource, /precondition: sourceStillCurrent/u);
    assert.match(indexSource, /contentValidator: \(persisted\) =>/u);
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

test('recovery target comparison is complete and receipt status fails closed', () => {
    const source = recoverySource();
    assert.equal(actorProfileRecoverySourceMatches(source, structuredClone(source)), true);
    for (const [field, changed] of [
        ['chatId', 'other-chat'], ['messageId', 'other-message'], ['logicalIndex', 9],
        ['swipeId', 2], ['generationSerial', 5], ['generationId', 'other-generation'],
        ['generationType', 'regenerate'], ['identityScopeId', 'other-scope'],
        ['scopeDigest', 'other-digest'], ['hash', 'other-raw'],
        ['contentFingerprint', 'other-content'],
    ]) {
        assert.equal(actorProfileRecoverySourceMatches(source, recoverySource({
            [field]: changed,
            ...(field === 'logicalIndex' ? { index: changed } : {}),
            ...(field === 'generationSerial' ? { generation: changed } : {}),
            ...(field === 'generationType' ? { type: changed } : {}),
            ...(field === 'contentFingerprint' ? { contentHash: changed } : {}),
        })), false, field);
    }
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
    assert.match(diagnosticsSource, /profileCanRetry === true/u);
    assert.match(diagnosticsSource, /actorScheduling:\s*\{/u);
    assert.match(diagnosticsSource, /actorShards:\s*\{ deprecated: true \}/u);
});

test('privacy-safe diagnostic behavior preserves controlled profile recovery fields', () => {
    const projected = createPrivacySafeDiagnosticProjection({
        statuses: {
            profile: {
                kind: 'error', status: 'not_completed',
                failingModules: ['personality'],
                lastFailureCodes: ['actor_profile.module_missing'], canRetry: true,
            },
        },
        actorShards: {
            status: 'failed', failed: 2,
            failureCodes: [
                'actor_scheduling.advance_parse_failed',
                'actor_shard.json_missing',
                'world.private_payload',
            ],
        },
    });
    assert.deepEqual(projected.latestStatuses.profile, {
        kind: 'error', status: 'not_completed', failingModules: ['personality'],
        lastFailureCodes: ['actor_profile.module_missing'], canRetry: true,
    });
    assert.deepEqual(projected.actorScheduling.advanceFailureCodes, [
        'actor_scheduling.advance_parse_failed',
        'actor_scheduling.json_missing',
    ]);
    assert.equal(projected.actorScheduling.failed, 2);
    assert.deepEqual(projected.actorShards, { deprecated: true });
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
