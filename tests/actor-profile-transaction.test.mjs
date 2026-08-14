import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseContinuityOutput } from '../continuity-core.mjs';

const indexUrl = new URL('../index.js', import.meta.url);
const source = await readFile(indexUrl, 'utf8');
const batchSource = await readFile(new URL('../actor-profile-batch-core.mjs', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('../actor-profile-v6-core.mjs', import.meta.url), 'utf8');

function sourceBetween(startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(start, -1, startNeedle);
    assert.notEqual(end, -1, endNeedle);
    return source.slice(start, end);
}

test('profile runtime delegates one grouped transaction and contains no per-actor model lane or repair model', () => {
    const completion = sourceBetween(
        'async function completeActorProfilesForTurn',
        'async function runContinuityTarget',
    );
    assert.doesNotMatch(source, /buildActorProfileRepairMessages/u);
    assert.doesNotMatch(source, /mergeActorProfileCompletionPatches/u);
    assert.match(completion, /completeActorProfileBatchTransaction/u);
    assert.match(completion, /maxTokens: 0/u);
    assert.doesNotMatch(completion, /minimumOutputTokens|requestedTokens|PROMPT_CHAR_LIMIT/u);
    assert.match(completion, /channel: 'fast'/u);
    assert.match(completion, /jsonMode: false/u);
    assert.match(completion, /requestKind: 'actor_profile_batch'/u);
    assert.match(completion, /maxFailovers: 1/u);
    assert.match(completion, /noTimeout: true/u);
    assert.match(source, /const CONNECTION_PROBE_TIMEOUT_MS = 120_000/u);
    const probe = sourceBetween(
        'async function probeModelChannelConnections',
        'function combineSocialUsage',
    );
    assert.match(probe, /timeoutMs: CONNECTION_PROBE_TIMEOUT_MS/u);
    const multiSlotProbe = sourceBetween(
        'const bindTest = (channel, button, status) =>',
        'function bindModelProviderCard',
    );
    assert.match(multiSlotProbe, /routeSlotIndex: slotIndex,\s*timeoutMs: CONNECTION_PROBE_TIMEOUT_MS,/su);
    const singleSlotProbe = sourceBetween(
        'function bindModelProviderCard',
        'function buildSettingsPanel',
    );
    assert.match(singleSlotProbe, /task: .*?通道测试`,\s*timeoutMs: CONNECTION_PROBE_TIMEOUT_MS,/su);
    assert.match(source, /Math\.min\(\s*35000,\s*Math\.max\(25000,\s*Math\.floor\(Number\(settings\.modelTimeoutMs\) \|\| 30000\)\),\s*\)/su);
    assert.match(completion, /freshFrozenScopeGuard\(captured\).*?localBatchFailure\('scope_stale'\)/su);
    assert.match(completion, /continuityTargetIsCurrent\(captured, token\).*?localBatchFailure\('target_stale'\)/su);
    assert.doesNotMatch(
        completion,
        /Promise\.all\(candidates\.map|parallelLane|actorShardMaxTokens|sovereigntyHardTimeoutMs/u,
    );
    assert.match(batchSource, /let first = await collect\(selected, \[\], 0\)/u);
    assert.match(batchSource, /needsDiscoveryFormatReplacement.*?selected\.length === 0.*?formatUnrecoverable === true/su);
    assert.match(batchSource, /const replacement = await collect\(\[\], \[\], 1, \[\], true\)/u);
    assert.match(batchSource, /batchFormatReplacementAttempted = true/u);
    assert.match(batchSource, /PROFILE_BATCH_FAILURE_CATEGORIES/u);
    assert.match(batchSource, /profileBatchRouteDiagnostic/u);
    assert.doesNotMatch(batchSource, /transportFailure/u);
    assert.match(batchSource, /const retryCandidates = semanticRetry/u);
    assert.match(batchSource, /actorProfileCompletionGroupPlan/u);
    assert.match(batchSource, /buildActorProfileModuleGroupMessages/u);
    assert.match(batchSource, /parseActorProfileModuleGroupOutput/u);
    assert.match(batchSource, /for \(const scheduledGroup of plan\)/u);
    assert.match(batchSource, /actorProfileCompletionGroupPlan\(workingCandidates\(\), \{ allowDiscovery: false \}\)/u);
    assert.doesNotMatch(batchSource, /Promise\.all\(plan\.map/u);
    assert.doesNotMatch(
        batchSource,
        /Promise\.all\((?:subset|candidates)\.map/u,
        'dependency-ordered module groups and actors never get independent model lanes',
    );
    assert.match(batchSource, /groupCandidates.*?requestBatch\(\{/su);
    assert.match(batchSource, /if \(parsed\.stale \|\| parsed\.requestFailure \|\| parsed\.formatUnrecoverable \|\| preparedApply\?\.failures\.length\) break;\s*commitGroupApply\(preparedApply\)/u);
    assert.match(batchSource, /retryFeedbackFor\(preparedApply, parsed, group\)/u);
    assert.match(batchSource, /actor_profile\.format_unrecoverable/u);
    assert.doesNotMatch(completion, /\bpatch(?:es)?\b/u);
    const worldGate = sourceBetween(
        'function stage3LedgerReadbackGate',
        'async function runContinuityTarget',
    );
    assert.doesNotMatch(worldGate, /actor_registry_awaiting_p2/u);
    assert.match(worldGate, /actorProfileReadinessInLedger/u);
    assert.match(worldGate, /ready_subset/u);
    assert.match(worldGate, /structure_only/u);
    assert.match(source, /requestKind: 'connection_probe'/u);
    assert.match(source, /仅连通/u);
    const callModel = sourceBetween(
        'async function callModel(messages, options = {})',
        'async function probeModelChannelConnections',
    );
    assert.match(callModel, /const noTimeout = options\.noTimeout === true/u);
    assert.match(callModel, /const timeoutMs = noTimeout \? 0 : Math\.min\(/u);
    assert.match(callModel, /Number\(options\.timeoutMs \?\? settings\.modelTimeoutMs\) \|\| 120000/u);
    assert.match(callModel, /const deadlineAt = !noTimeout && Number\.isFinite\(Number\(options\.deadlineAt\)\)/u);
    assert.match(callModel, /const attemptTimeoutMs = noTimeout \|\| runUntilCancelled\s*\? 0/u);
    assert.match(source, /if \(timeout > 0\) \{/u);
    assert.match(source, /function modelFailureKind\(error, controller = null\).*?controller\?\.signal\?\.aborted.*AbortError/su);
    assert.match(callModel, /'validation-error', 'cancelled', 'foreground_preempted'/u);
    assert.match(callModel, /\.includes\(outerFailureKind\)/u);
    assert.match(callModel, /\.includes\(failureKind\)/u);
    assert.match(
        callModel,
        /if \(backgroundLane && \(foregroundGenerationStarting \|\| activeGenerationSession\)\)[\s\S]*?FOREGROUND_PREEMPTED[\s\S]*?requestStarted = true/u,
        'a late host background transport must not start while foreground generation is active',
    );
    assert.match(
        callModel,
        /controller\.mvuadUsesHostGenerateRaw === true[\s\S]*?foregroundGenerationStarting \|\| activeGenerationSession[\s\S]*?modelConnectionScheduler\.enqueue/u,
        'host background work must also be rejected before it enters the scheduler queue',
    );
});

test('profile commit is durable, content-verified, fail-closed, and accepted only after readback', () => {
    const completion = sourceBetween(
        'async function completeActorProfilesForTurn',
        'async function runActorProfileTarget',
    );
    const profileWriter = sourceBetween(
        'async function persistActorProfilePhaseWithWorldRebase',
        'async function completeActorProfilesForTurn',
    );
    assert.equal(
        (source.match(/chatScope: fingerprint\(String\(captured\.chatId \|\| ''\)\)/gu) || []).length,
        3,
        'all asynchronous P1 summary and terminal diagnostics must retain the captured chat scope',
    );
    const pendingWriteAt = batchSource.indexOf('pendingPersisted = await persistPendingBatch');
    const pendingReadbackAt = batchSource.indexOf('const pendingReadbackOk');
    const finalWriteAt = batchSource.indexOf('finalPersisted = await persistFinalizedBatch');
    const finalReadbackAt = batchSource.indexOf('const finalReadbackOk');
    const acceptAt = batchSource.indexOf('accepted: prepared.map');
    assert.ok(
        pendingWriteAt >= 0
        && pendingReadbackAt > pendingWriteAt
        && finalWriteAt > pendingReadbackAt
        && finalReadbackAt > finalWriteAt
        && acceptAt > finalReadbackAt,
    );
    assert.match(profileWriter, /fields: \['actorLedger'\]/u);
    assert.match(profileWriter, /durable: true/u);
    assert.match(profileWriter, /requireReadback: true/u);
    assert.match(profileWriter, /readbackAttempts: 3/u);
    assert.match(profileWriter, /contentValidator: \(persisted\) => expectedCommits\.every/u);
    assert.match(profileWriter, /precondition: \(\) =>/u);
    assert.match(profileWriter, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/u);
    assert.match(profileWriter, /actorProfileActorLedgerCasCanRebase\(failureSink\)/u);
    assert.match(profileWriter, /actorProfileRebaseOnWorldOnlyLedgerDrift/u);
    for (const code of [
        'actor_profile.target_stale',
        'actor_profile.commit_rejected',
        'actor_profile.readback_unsupported',
        'actor_profile.readback_mismatch',
    ]) assert.match(`${completion}\n${profileWriter}\n${batchSource}`, new RegExp(code.replace('.', '\\.')));
    for (const code of [
        'actor_profile.format_unrecoverable',
        'actor_profile.actor_ref_mismatch',
    ]) assert.match(profileSource, new RegExp(code.replace('.', '\\.')));
});

test('namespace writer rejects stale targets and revisions before mutation and rolls back save failures', () => {
    const writer = sourceBetween(
        'async function performChatNamespaceWrite',
        'async function writeChatNamespace',
    );
    const mutationAt = writer.indexOf('context.updateChatMetadata');
    assert.ok(writer.indexOf("fail('chat_context_changed')") < mutationAt);
    assert.ok(writer.indexOf("fail('stale_namespace_revision')") < mutationAt);
    assert.ok(writer.indexOf("fail('write_precondition_failed')") < mutationAt);
    assert.match(writer, /if \(durable && !durableSaver\)/u);
    assert.match(writer, /host_save_readback_unsupported/u);
    assert.match(writer, /host_save_readback_mismatch/u);
    assert.match(writer, /host_save_target_stale/u);
    assert.match(
        writer,
        /applied[\s\S]*?!retainOnFailure[\s\S]*?selectedTransactionRecovery[\s\S]*?selectedFields\?\.length[\s\S]*?durableSaveStarted[\s\S]*?context\.chatId === expectedChatId/u,
    );
    assert.match(writer, /const applyNamespaceSnapshot = \(namespace\)/u);
    assert.match(writer, /applyNamespaceSnapshot\(current\)/u);
});

test('stale swipe checks precede materialization and scheduling follows persisted completion', () => {
    const completion = sourceBetween(
        'async function completeActorProfilesForTurn',
        'async function runActorProfileTarget',
    );
    assert.ok(
        batchSource.indexOf('if (!await current())')
            < batchSource.indexOf('const baseline = materializeActorProfileBaseline'),
    );
    const profileRuntime = sourceBetween(
        'async function runActorProfileTarget',
        'async function runContinuityTarget',
    );
    assert.ok(
        profileRuntime.indexOf('await completeActorProfilesForTurn') >= 0,
        'P1 completion has exactly one automatic P1 entry',
    );
    const runtime = sourceBetween(
        'async function runContinuityTarget',
        'async function enqueueContinuity(targetId',
    );
    assert.doesNotMatch(runtime, /completeActorProfilesForTurn\(|enqueueActorProfiles\(/u);
});

test('continuity has no profile macro write entrance and rejects the retired root field', async () => {
    const continuitySource = await readFile(
        new URL('../continuity-core.mjs', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /parsed\.raw\?\.actorProfiles/u);
    assert.doesNotMatch(source, /actor-profile-macro-write-disabled/u);
    assert.doesNotMatch(source, /"actorProfiles":\[/u);
    assert.doesNotMatch(continuitySource, /actorProfiles、threads必须/u);
    assert.doesNotMatch(continuitySource, /actorProfiles:\s*\[\]/u);
    const parsed = parseContinuityOutput(JSON.stringify({
        turn: 1,
        lastTick: { turn: 1, action: 'held', threadId: 'WORLD', reason: '没有新增世界变化' },
        actorProfiles: [],
        threads: [],
        scenarioPlan: {},
        world: {},
    }), { chatId: 'chat-stage6' });
    assert.match(parsed.error, /已停用的人物档案写字段/u);
});
