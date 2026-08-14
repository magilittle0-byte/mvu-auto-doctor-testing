import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

const restoreSource = sourceSection(
    'async function restoreLatestSovereigntyCheckpoint()',
    'function resetCurrentModelCallStats',
);
const clearSource = sourceSection(
    'async function clearContinuityState()',
    'function forumBase(namespace, captured)',
);
const managementBlockerSource = sourceSection(
    'function actorWorldManagementBlockedByForeground()',
    'async function quiesceActorWorldWritersForManagement',
);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function sourceRef(id = 'target-old') {
    return {
        chatId: 'chat-a', index: 2, messageId: id, swipeId: 0,
        generationId: `generation-${id}`, generationSerial: 2,
        contentFingerprint: `content-${id}`, scopeDigest: 'scope-a',
    };
}

function liveNamespace() {
    const ref = sourceRef('target-live');
    return {
        fieldRevisions: {},
        sovereigntyRuntime: { id: 'runtime-live' },
        continuity: { marker: 'continuity-live', nextTurnInjection: { id: 'p4-live' } },
        continuityCheckpoint: { stage3Phase: 'world_committed', marker: 'checkpoint-live' },
        actorLedger: { marker: 'actor-live' },
        actorLedgerCheckpoint: { marker: 'actor-branch-live' },
        actorLedgerCheckpointBlobs: { live: true },
        worldPressure: { marker: 'pressure-live' },
        continuityWorldLaneReceipts: [{ id: 'world-receipt-live' }],
        continuityInjectionQueue: [{ id: 'queue-live' }],
        continuityInjectionBatches: [{ id: 'batch-live' }],
        continuityDirector: 'doctor',
        continuityDetected: true,
        characterCreationTicketBatches: [{ acceptedTarget: ref, marker: 'ticket-live' }],
        actorProfileRetryReceipt: { sourceRef: ref, marker: 'retry-live' },
        actorProfileNoCandidatesTerminalProof: { sourceRef: ref, marker: 'proof-live' },
    };
}

function restoreHarness({ payload = {}, checkpointAvailable = true, blockAfterQuiesce = false } = {}) {
    const state = {
        live: liveNamespace(),
        writes: 0,
        quiesces: 0,
        profileCacheClears: 0,
        worldCacheClears: 0,
        shadowClears: 0,
        actorRenders: 0,
        continuityRenders: 0,
        blocked: false,
    };
    const token = { id: 'management-token' };
    const checkpointRef = sourceRef('target-old');
    const restored = checkpointAvailable ? {
        restored: true,
        runtime: { id: 'runtime-restored' },
        checkpoint: { id: 'checkpoint-old', sourceRef: checkpointRef },
        payload: clone(payload),
    } : { restored: false, runtime: state.live.sovereigntyRuntime, payload: null };
    const sandbox = {
        getContext: () => ({ chatId: 'chat-a' }),
        readChatNamespace: () => clone(state.live),
        sovereigntyRuntimeFromNamespace: (namespace) => namespace.sovereigntyRuntime,
        restoreSovereigntyCheckpoint: () => clone(restored),
        quiesceActorWorldWritersForManagement: async () => {
            state.quiesces += 1;
            if (blockAfterQuiesce) state.blocked = true;
            return { ok: true, operationEpoch: 5, managementToken: token };
        },
        ensureActorSovereigntyMigrationPersisted: async () => ({
            ok: true, namespace: clone(state.live),
        }),
        replayPendingSovereigntyObservations: async (namespace) => ({
            ok: true, namespace: clone(namespace),
        }),
        actorWorldManagementBlockedByForeground: () => state.blocked,
        deepClone: clone,
        actorProfileRecoverySourceMatches: (left, right) => (
            !!left && !!right && left.messageId === right.messageId
        ),
        actorProfileNoCandidatesTerminalProofMatches: (proof, { currentSourceRef }) => (
            !!proof?.sourceRef && proof.sourceRef.messageId === currentSourceRef?.messageId
        ),
        selectedFieldStatesFromNamespace: () => ({}),
        selectedChatNamespaceFieldsMatch: () => true,
        writeChatNamespace: async (candidate, _chatId, options) => {
            state.writes += 1;
            assert.equal(options.precondition(), true);
            state.fields = [...options.fields];
            state.candidate = clone(candidate);
            state.live = clone(candidate);
            options.successSink.readbackNamespace = clone(candidate);
            return true;
        },
        renderSovereigntyHealth: () => undefined,
        renderActorProfiles: () => { state.actorRenders += 1; },
        renderContinuityLedger: () => { state.continuityRenders += 1; },
        actorProfileCompletedKeys: { clear: () => { state.profileCacheClears += 1; } },
        continuityCompletedKeys: { clear: () => { state.worldCacheClears += 1; } },
        clearActorProfileReadShadow: () => { state.shadowClears += 1; },
        npcDesignTicketBatches: new Map(),
        pendingNpcDesignTicketBatch: null,
        actorWorldManagementWrite: token,
        operationEpoch: 5,
        toast: () => undefined,
        releaseActorWorldManagementWrite: () => undefined,
    };
    vm.runInNewContext(`${restoreSource}\nthis.restore = restoreLatestSovereigntyCheckpoint;`, sandbox);
    return { restore: sandbox.restore, state };
}

test('restore preflight is a zero-cancel zero-write no-op when no checkpoint exists', async () => {
    const run = restoreHarness({ checkpointAvailable: false });
    const result = await run.restore();
    assert.equal(result.status, 'nochange');
    assert.equal(run.state.quiesces, 0);
    assert.equal(run.state.writes, 0);
});

test('restore applies only checkpoint payload domains and invalidates dependent transactions', async () => {
    const cases = [
        {
            name: 'runtime-only', payload: {},
            fields: ['sovereigntyRuntime'], profileClears: 0, worldClears: 0,
        },
        {
            name: 'actor', payload: { actorLedger: { marker: 'actor-old' } },
            includes: ['actorLedger', 'actorLedgerCheckpoint', 'continuity', 'continuityCheckpoint'],
            profileClears: 1, worldClears: 1,
        },
        {
            name: 'continuity', payload: { continuity: { marker: 'continuity-old', nextTurnInjection: { id: 'old' } } },
            includes: ['continuity', 'continuityCheckpoint'],
            excludes: ['actorLedger', 'actorProfileRetryReceipt'],
            profileClears: 0, worldClears: 1,
        },
        {
            name: 'pressure', payload: { worldPressure: { marker: 'pressure-old' } },
            includes: ['worldPressure'], excludes: ['continuity', 'actorLedger'],
            profileClears: 0, worldClears: 1,
        },
    ];
    for (const item of cases) {
        const run = restoreHarness({ payload: item.payload });
        const before = clone(run.state.live);
        const result = await run.restore();
        assert.equal(result.status, 'completed', item.name);
        assert.equal(run.state.writes, 1, item.name);
        if (item.fields) assert.deepEqual(run.state.fields, item.fields);
        for (const field of item.includes || []) assert.ok(run.state.fields.includes(field), `${item.name}:${field}`);
        for (const field of item.excludes || []) assert.equal(run.state.fields.includes(field), false, `${item.name}:${field}`);
        assert.equal(run.state.profileCacheClears, item.profileClears, item.name);
        assert.equal(run.state.worldCacheClears, item.worldClears, item.name);
        if (item.name === 'runtime-only') {
            assert.deepEqual(run.state.candidate.continuity, before.continuity);
            assert.deepEqual(run.state.candidate.actorLedger, before.actorLedger);
            assert.deepEqual(run.state.candidate.actorProfileRetryReceipt, before.actorProfileRetryReceipt);
        }
        if (['actor', 'continuity'].includes(item.name)) {
            assert.equal(run.state.candidate.continuity.nextTurnInjection, null, item.name);
            assert.equal(run.state.candidate.continuityCheckpoint, null, item.name);
        }
    }
});

test('foreground or P4 state blocks restore after quiesce and clear before any namespace write', async () => {
    const restoreRun = restoreHarness({ payload: { actorLedger: { marker: 'actor-old' } }, blockAfterQuiesce: true });
    const restoreResult = await restoreRun.restore();
    assert.equal(restoreResult.status, 'blocked');
    assert.equal(restoreRun.state.writes, 0);

    const state = { blocked: false, writes: 0 };
    const token = { id: 'management-token' };
    const sandbox = {
        getContext: () => ({ chatId: 'chat-a' }),
        getSettings: () => ({ continuityMaxThreads: 8 }),
        readChatNamespace: () => ({ continuity: {}, actorLedger: {} }),
        continuityLedgerView: () => ({ activeCount: 0, resolvedCount: 0 }),
        actorLedgerView: () => ({ actorCount: 0 }),
        confirmDangerousAction: async () => true,
        quiesceActorWorldWritersForManagement: async () => {
            state.blocked = true;
            return { ok: true, operationEpoch: 5, managementToken: token };
        },
        actorWorldManagementBlockedByForeground: () => state.blocked,
        writeChatNamespace: async () => { state.writes += 1; return true; },
        releaseActorWorldManagementWrite: () => undefined,
    };
    vm.runInNewContext(`${clearSource}\nthis.clear = clearContinuityState;`, sandbox);
    assert.equal(await sandbox.clear(), false);
    assert.equal(state.writes, 0);
});

test('management blocker includes foreground, P4 consumer, timer, and accepted-final dispatch gap', () => {
    for (const active of [
        'foregroundGenerationStarting',
        'activeGenerationSession',
        'activeNextTurnConsumer',
        'pendingAcceptedFinalTimer',
        'pendingAcceptedFinalSession',
        'acceptedFinalDispatchInFlight',
    ]) {
        const sandbox = {
            foregroundGenerationStarting: null,
            activeGenerationSession: null,
            activeNextTurnConsumer: null,
            pendingAcceptedFinalTimer: null,
            pendingAcceptedFinalSession: null,
            acceptedFinalDispatchInFlight: null,
            acceptedFinalDispatchPromises: new Map(),
            [active]: { active: true },
        };
        vm.runInNewContext(`${managementBlockerSource}\nthis.blocked = actorWorldManagementBlockedByForeground();`, sandbox);
        assert.equal(sandbox.blocked, true, active);
    }
    const queuedAcceptedFinal = {
        foregroundGenerationStarting: null,
        activeGenerationSession: null,
        activeNextTurnConsumer: null,
        pendingAcceptedFinalTimer: null,
        pendingAcceptedFinalSession: null,
        acceptedFinalDispatchInFlight: null,
        acceptedFinalDispatchPromises: new Map([['generation-b', Promise.resolve(true)]]),
    };
    vm.runInNewContext(
        `${managementBlockerSource}\nthis.blocked = actorWorldManagementBlockedByForeground();`,
        queuedAcceptedFinal,
    );
    assert.equal(queuedAcceptedFinal.blocked, true, 'queued accepted-final work also excludes management writes');
});
