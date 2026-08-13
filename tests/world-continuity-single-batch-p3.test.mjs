import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    advanceContinuityClocks,
    applyWorldUpdate,
    mergeMarkerRecords,
    normalizeContinuityState,
    normalizeSourceRef,
    parseContinuityOutput,
} from '../continuity-core.mjs';
import {
    extractFirstBalancedJsonObject,
    sovereigntySourceKey,
} from '../sovereignty-runtime-core.mjs';
import {
    actorProfileNoCandidatesTerminalProofMatches,
    actorProfileRecoverySourceMatches,
    createActorProfileNoCandidatesTerminalProof,
} from '../actor-profile-v6-core.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

function loadStage3RecallSelection() {
    const code = sourceSection(
        'function stage3RecallSelection(output, {',
        'function buildWorldRecallMessages({',
    );
    const sandbox = {
        extractFirstBalancedJsonObject,
        fingerprint: (value) => `test-digest:${String(value).length}`,
    };
    vm.runInNewContext(`${code}\nthis.selectRecall = stage3RecallSelection;`, sandbox);
    return sandbox.selectRecall;
}

function loadStage3PreparedPhase1RevisionGate() {
    const fieldState = sourceSection(
        'function stage3FieldState(namespace, field) {',
        'function stage3PreparedWorldCheckpoint({',
    );
    const revisionGate = sourceSection(
        'function stage3PreparedPhase1StatesMatch(checkpoint, namespace, ledger, captured) {',
        'async function commitPreparedWorldCandidate(captured, {',
    );
    const sandbox = {
        actorLedgerDigest: (ledger) => String(ledger?.digest || ''),
        fingerprint: (value) => `field:${String(value)}`,
        safeJson: (value) => JSON.stringify(value),
        stage3PreparedWorldCheckpointMatches: () => true,
    };
    vm.runInNewContext(
        `${fieldState}${revisionGate}\nthis.fieldState = stage3FieldState;`
        + 'this.matches = stage3PreparedPhase1StatesMatch;',
        sandbox,
    );
    return sandbox;
}

function loadStage3AcceptedTargetHelpers(overrides = {}) {
    const code = sourceSection(
        'function stage3AcceptedTarget(captured) {',
        'function stage3TaskOwnsCurrent(captured, token) {',
    );
    const sandbox = { ...overrides };
    vm.runInNewContext(
        `${code}\nthis.stage3AcceptedTarget = stage3AcceptedTarget;`
        + 'this.stage3AcceptedTargetsMatch = stage3AcceptedTargetsMatch;'
        + 'this.stage3AcceptedTargetKey = stage3AcceptedTargetKey;'
        + 'this.stage3LegacyTargetNeedsManualReconciliation = stage3LegacyTargetNeedsManualReconciliation;',
        sandbox,
    );
    return sandbox;
}

function loadStage3LegacyManualReconciliationRunner(state) {
    const code = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    const sandbox = {
        operationEpoch: 4,
        stage3AcceptedTarget: (target) => target?.generationId && target?.generationType ? target : null,
        operationToken: () => ({ epoch: 4 }),
        stage3TaskOwnsCurrent: () => true,
        stage3TargetIsCurrent: () => ({ ok: true }),
        sovereigntyNarrativeEligible: () => true,
        stage3LedgerReadbackGate: () => ({ ok: true, actorLedger: {} }),
        getSettings: () => ({}),
        getContext: () => ({ chatId: state.captured.chatId, chat: [{ mes: 'natural narrative' }] }),
        readChatNamespace: () => state.namespace,
        stage3LegacyTargetNeedsManualReconciliation: (stored, captured) => (
            stored === state.legacyTarget && captured === state.captured
        ),
        ...state.spies,
    };
    vm.runInNewContext(`${code}\nthis.run = runContinuityTarget;`, sandbox);
    return sandbox.run;
}

function loadStage3PersistedPackageValidator({ normalizer = (value) => value } = {}) {
    const code = sourceSection(
        'function stage3ContinuityDigestWithoutInjection(state) {',
        'function stage3NoActorPermitMatches(permit, captured) {',
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        continuityContentDigest: (value) => JSON.stringify(value),
        normalizeContinuityState: normalizer,
        getSettings: () => ({ continuityMaxThreads: 4 }),
        actorLedgerDigest: (ledger) => {
            const result = ledger?.actionAttempts?.[0]?.worldAdjudicationResult || {};
            return [
                'actor-ledger',
                String(result.attemptId || ''),
                String(result.id || ''),
                String(result.actorRef?.actorId || ''),
                String(result.outcome || ''),
            ].join(':');
        },
        fingerprint: (value) => {
            const text = String(value);
            let hash = 0;
            for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
            return `hash:${text.length}:${hash}`;
        },
        actorActionTargetOf: (captured) => ({ ...captured }),
        actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        actorActionSettlementsMatchLedger: (ledger, { target, results }) => {
            const settled = (ledger?.actionAttempts || [])
                .filter((attempt) => (
                    JSON.stringify(attempt?.target) === JSON.stringify(target)
                    && attempt?.worldAdjudicationResult
                ))
                .map((attempt) => attempt.worldAdjudicationResult);
            return { ok: JSON.stringify(settled) === JSON.stringify(results) };
        },
        pendingActorActionAttempts: (ledger, { target }) => ({
            attempts: (ledger?.actionAttempts || []).filter((attempt) => (
                JSON.stringify(attempt?.target) === JSON.stringify(target)
                && !attempt?.worldAdjudicationResult
            )),
        }),
    };
    vm.runInNewContext(
        `${sourceSection('function stage3AcceptedTarget(captured) {', 'function stage3ContinuityDigestWithoutInjection(state) {')}`
        + `${code}\nthis.stage3CanonicalSettlementProof = stage3CanonicalSettlementProof;`
        + 'this.stage3SettlementProofMatchesLedger = stage3SettlementProofMatchesLedger;'
        + 'this.stage3PersistedPackageForTarget = stage3PersistedPackageForTarget;'
        + 'this.stage3ContinuityDigestWithoutInjection = stage3ContinuityDigestWithoutInjection;',
        sandbox,
    );
    return sandbox;
}

function loadStage3NoActorPermitGate({
    namespace = { actorLedger: {} },
    currentSourceRef = {},
    ledger = { actorRegistry: { registered: {} } },
    readiness = {},
} = {}) {
    const code = sourceSection(
        'function stage3NoActorPermitMatches(permit, captured) {',
        'async function runContinuityTarget(captured, {',
    );
    const sandbox = {
        readChatNamespace: () => structuredClone(namespace),
        normalizeActorLedger: () => structuredClone(ledger),
        sourceRefOf: () => structuredClone(currentSourceRef),
        actorProfileReadinessInLedger: (_value, actorId) => ({
            ready: readiness[actorId] === true,
        }),
        actorProfileRecoverySourceMatches,
        actorProfileNoCandidatesTerminalProofMatches,
    };
    vm.runInNewContext(
        `${sourceSection('function stage3AcceptedTarget(captured) {', 'function stage3ContinuityDigestWithoutInjection(state) {')}`
        + `${sourceSection('function actorProfileNoCandidatesTerminalReadbackMatches(namespace, currentSourceRef, {', 'async function persistActorProfileRecoveryState')}`
        + `${code}\nthis.stage3LedgerReadbackGate = stage3LedgerReadbackGate;`,
        sandbox,
    );
    return sandbox.stage3LedgerReadbackGate;
}

function loadNoCandidatesPersistenceHarness(initialNamespace = {}) {
    const code = sourceSection(
        'async function persistActorProfileRecoveryState',
        'async function finalizeActorProfileRecoveryOutcome',
    );
    const state = { namespace: structuredClone(initialNamespace), persisted: null, writes: 0 };
    const sandbox = {
        readChatNamespace: () => structuredClone(state.namespace),
        sourceRefOf: (value) => structuredClone(value),
        captureTarget: () => structuredClone(state.captured),
        getContext: () => ({ chatId: state.captured?.chatId || '' }),
        actorProfileRecoverySourceMatches,
        npcDesignTicketBatches: new Map(),
        actorProfileTicketBatchPersistenceMatches: () => false,
        sealActorProfileTicketBatchForPersistence: () => null,
        createActorProfileNoCandidatesTerminalProof,
        actorProfileNoCandidatesTerminalProofMatches,
        deepClone: (value) => structuredClone(value),
        writeChatNamespace: async (candidate, _chatId, options) => {
            state.writes += 1;
            const persisted = structuredClone(candidate);
            if (options.contentValidator(persisted) !== true) return false;
            state.namespace = persisted;
            state.persisted = structuredClone(persisted);
            return true;
        },
    };
    vm.runInNewContext(
        `${sourceSection('function actorProfileNoCandidatesTerminalReadbackMatches(namespace, currentSourceRef, {', 'async function persistActorProfileRecoveryState')}`
        + `${code}\nthis.persist = persistActorProfileRecoveryState;`,
        sandbox,
    );
    return {
        state,
        persist(captured, result) {
            state.captured = structuredClone(captured);
            return sandbox.persist(captured, result);
        },
    };
}

function loadWorldGenerator(callModel) {
    const code = sourceSection(
        'async function generateWorldContinuitySingleBatch(messages, {',
        'async function persistActorRegistryForTurn(captured, {',
    );
    const sandbox = {
        callModel,
        parseContinuityOutput,
        validateWorldAdjudicationBatch: () => ({ valid: true, errors: [] }),
        freshFrozenScopeGuard: async (captured) => (
            captured?.scopeDigest
                ? { ok: true }
                : { ok: false, reason: 'scope_digest_missing' }
        ),
    };
    vm.runInNewContext(
        `${code}\nthis.generateWorldContinuitySingleBatch = generateWorldContinuitySingleBatch;`,
        sandbox,
    );
    return sandbox.generateWorldContinuitySingleBatch;
}

function loadPersistenceOutcome() {
    const code = sourceSection(
        'function worldContinuityPersistenceOutcome({',
        'async function completeSovereigntyCycle({',
    );
    const sandbox = {};
    vm.runInNewContext(
        `${code}\nthis.worldContinuityPersistenceOutcome = worldContinuityPersistenceOutcome;`,
        sandbox,
    );
    return sandbox.worldContinuityPersistenceOutcome;
}

function loadCommittedWorldDetector(scopeDigest = 'scope-p3') {
    const sourceRef = sourceSection(
        'function sovereigntySourceRefOf(captured) {',
        'function sovereigntyObservationRecord(',
    );
    const detector = sourceSection(
        'function worldSovereigntyTaskAlreadyCommitted(runtime, claimedWorldTask, captured) {',
        'function worldContinuityPersistenceOutcome({',
    );
    const sandbox = {
        sovereigntySourceKey,
        actorSovereigntyScopeDigest: () => scopeDigest,
        currentActorSovereigntyScope: () => ({ scopeDigest }),
        getContext: () => ({ chatId: 'chat-p3' }),
    };
    vm.runInNewContext(
        `${sourceRef}\n${detector}\n`
        + 'this.worldSovereigntyTaskAlreadyCommitted = worldSovereigntyTaskAlreadyCommitted;'
        + 'this.sovereigntySourceRefOf = sovereigntySourceRefOf;',
        sandbox,
    );
    return {
        detect: sandbox.worldSovereigntyTaskAlreadyCommitted,
        sourceRefOf: sandbox.sovereigntySourceRefOf,
    };
}

function loadNamespaceWriter(getContext) {
    const readback = sourceSection(
        'async function readPersistedChatNamespace(context, expectedChatId)',
        'function persistedNamespaceMatches(candidate, persisted, selectedFields)',
    );
    const matches = sourceSection(
        'function persistedNamespaceMatches(candidate, persisted, selectedFields)',
        'async function verifyPersistedChatNamespace(',
    );
    const verify = sourceSection(
        'async function verifyPersistedChatNamespace(',
        'const modelConnectionScheduler =',
    );
    const writer = sourceSection(
        'async function performChatNamespaceWrite(next, expectedChatId, {',
        'async function enqueueChatNamespaceWrite(next, expectedChatId, options = {})',
    );
    const sandbox = {
        PLUGIN_ID: 'mvu_auto_doctor',
        CHAT_NAMESPACE_VERSION: 13,
        chatNamespacePersistenceMetrics: {
            writeAttempts: 0,
            durableAttempts: 0,
            skippedUnchanged: 0,
            comparisonMs: 0,
            rejectedStale: 0,
            hostSaveCalls: 0,
            hostSaveMs: 0,
            failedWrites: 0,
            rolledBackWrites: 0,
            readbackAttempts: 0,
            readbackFailures: 0,
            readbackMs: 0,
        },
        lastChatNamespaceWriteFailureCode: '',
        getContext,
        persistenceClock: () => 0,
        isPlainObject: (value) => Boolean(
            value && typeof value === 'object' && !Array.isArray(value)
        ),
        fingerprint: (value) => JSON.stringify(value),
        safeJson: (value) => JSON.stringify(value),
        safeDiagnosticReason: (value) => String(value),
        deepClone: (value) => structuredClone(value),
        structuredClone,
        setTimeout,
        console: { warn: () => undefined },
    };
    vm.runInNewContext(
        `${readback}\n${matches}\n${verify}\n${writer}\n`
        + 'this.performChatNamespaceWrite = performChatNamespaceWrite;',
        sandbox,
    );
    return {
        write: sandbox.performChatNamespaceWrite,
        metrics: sandbox.chatNamespacePersistenceMetrics,
    };
}

function validWorldOutput(turn = 1) {
    return JSON.stringify({
        turn,
        lastTick: {
            turn,
            action: 'held',
            threadId: 'WORLD',
            reason: '本回合没有足够依据制造新的世界变化',
        },
        threads: [],
        scenarioPlan: { amendments: [] },
        world: {},
    });
}

const generatorSettings = {
    continuityMaxTokens: 4096,
    continuityMaxThreads: 24,
    sovereigntyHardTimeoutMs: 120000,
};
const captured = {
    chatId: 'chat-p3',
    index: 6,
    messageId: 'message-6',
    swipeId: 0,
    generationSerial: 6,
    generationId: 'generation-6',
    generationType: 'normal',
    identityScopeId: 'chat-p3|character:card-main',
    scopeDigest: 'scope:chat-p3|character:card-main',
    contentFingerprint: 'accepted-p3-6',
    fingerprint: 'accepted-p3-6',
};

test('0/1/3/6 world events each use exactly one production world-model call', async () => {
    const calls = [];
    const generate = loadWorldGenerator(async (messages, options) => {
        calls.push({ messages, options });
        assert.equal(options.failover, false);
        assert.equal(options.maxFailovers, 0);
        assert.equal(options.timeoutMs, 0);
        const output = validWorldOutput();
        assert.equal(options.validateOutput(output), true);
        return output;
    });
    for (const count of [0, 1, 3, 6]) {
        const before = calls.length;
        const events = Array.from({ length: count }, (_, index) => ({
            id: `EVENT-${index + 1}`,
        }));
        await generate([{ role: 'user', content: JSON.stringify({ events }) }], {
            captured,
            settings: generatorSettings,
            runUntilCancelled: true,
            isCurrent: () => true,
        });
        assert.equal(calls.length - before, 1, `${count} events must remain one batch`);
    }
});

test('transport failure, validation failure, and stale targets never trigger hidden failover', async () => {
    let calls = 0;
    const transportFailure = loadWorldGenerator(async (_messages, options) => {
        calls += 1;
        assert.equal(options.failover, false);
        assert.equal(options.maxFailovers, 0);
        throw new Error('transport down');
    });
    await assert.rejects(
        transportFailure([], {
            captured,
            settings: generatorSettings,
            isCurrent: () => true,
        }),
        /transport down/u,
    );
    assert.equal(calls, 1);

    let current = false;
    const staleBefore = loadWorldGenerator(async () => {
        calls += 1;
        return validWorldOutput();
    });
    await assert.rejects(
        staleBefore([], {
            captured,
            settings: generatorSettings,
            isCurrent: () => current,
        }),
        /world\.target_stale_before_call/u,
    );
    assert.equal(calls, 1, 'stale before call must make zero additional requests');

    current = true;
    const staleAfter = loadWorldGenerator(async () => {
        calls += 1;
        current = false;
        return validWorldOutput();
    });
    await assert.rejects(
        staleAfter([], {
            captured,
            settings: generatorSettings,
            isCurrent: () => current,
        }),
        /world\.target_stale_after_call/u,
    );
    assert.equal(calls, 2, 'stale after response still performs only its original call');
});

test('a mixed six-character P1 profile batch cannot fan out the world call', async () => {
    let worldCalls = 0;
    const generate = loadWorldGenerator(async (_messages, options) => {
        worldCalls += 1;
        const output = validWorldOutput();
        assert.equal(options.validateOutput(output), true);
        return output;
    });
    const profiles = Array.from({ length: 6 }, (_, index) => ({
        actorId: `NPC-${index + 1}`,
        status: 'profile_pending',
    }));
    await generate([{ role: 'user', content: JSON.stringify({ profiles, events: [] }) }], {
        captured,
        settings: generatorSettings,
        isCurrent: () => true,
    });
    assert.equal(worldCalls, 1);
    const profileSection = sourceSection(
        'const profileCompletion = await completeActorProfilesForTurn(captured, {',
        'function stage3AcceptedTarget(captured) {',
    );
    assert.doesNotMatch(profileSection, /generateWorldContinuitySingleBatch|callModel\(/u);
});

test('recoverable punctuation and truncation are repaired locally; unrecoverable output stays invalid', () => {
    const punctuation = parseContinuityOutput(`说明文字\n{
        "turn"：1，
        "lastTick"：{"turn"：1，"action":"held"，"threadId":"WORLD"，"reason":"当前证据不足，保持既有世界状态"}，
        "threads"：[]，
        "world"：{}，
    }`);
    assert.ok(punctuation.state);
    assert.equal(punctuation.repairedLocally, true);

    const truncated = parseContinuityOutput(
        '{"turn":1,"threads":[],"world":{"winds":[]}, trailing text',
    );
    assert.ok(truncated.state);
    assert.equal(truncated.repairedLocally, true);

    const invalid = parseContinuityOutput('no JSON and no recoverable state');
    assert.equal(invalid.state, undefined);
    assert.match(invalid.error, /无法在本地恢复/u);
});

test('stable IDs update and add deterministically without array-position duplication', () => {
    const base = normalizeContinuityState({
        chatId: 'chat-p3',
        turn: 3,
        threads: [{
            id: 'THREAD-001',
            title: '既有线程',
            stage: 'seeded',
            summary: '既有状态',
        }],
        world: {
            winds: [{
                id: 'WIND-01',
                topic: '港口消息',
                type: 'report',
                strength: 2,
                content: '旧消息',
                source: '公告',
                scope: '港口',
                basis: '公开公告',
                knowledge: 'observed',
            }],
        },
    });
    const mergedWorld = applyWorldUpdate(base.world, {
        winds: [
            { id: 'WIND-01', content: '同一消息已更新', basis: '后续公开公告' },
            {
                id: null,
                topic: '车队改道',
                type: 'notice',
                strength: 1,
                content: '新增消息',
                source: '车队',
                scope: '港区',
                basis: '现场可见',
                knowledge: 'observed',
            },
        ],
    }, { turn: 4 });
    assert.equal(mergedWorld.winds.length, 2);
    const updatedWind = mergedWorld.winds.find((item) => item.id === 'WIND-01');
    const addedWind = mergedWorld.winds.find((item) => item.id === 'WIND-02');
    assert.ok(updatedWind);
    assert.ok(addedWind);
    assert.match(updatedWind.content, /已更新/u);

    const mergedThreads = mergeMarkerRecords(base, [
        { id: 'THREAD-001', title: '既有线程', summary: '按稳定 ID 更新' },
        { id: 'THREAD-002', title: '新增线程', summary: '新增状态' },
    ]);
    assert.equal(mergedThreads.threads.length, 2);
    assert.equal(new Set(mergedThreads.threads.map((item) => item.id)).size, 2);
});

test('production namespace writer requires one save/readback and fails closed at each stale boundary', async () => {
    const makeHarness = ({
        staleOnSave = false,
        staleOnReadback = false,
        mismatch = false,
        oldReadbacks = 0,
        readbackAttempts = 1,
        nextContinuity = { turn: 1, lastSource: 'target-6' },
    } = {}) => {
        let current = true;
        let saves = 0;
        let readbacks = 0;
        const oldNamespace = {
            version: 13,
            chatId: 'chat-p3',
            rev: 1,
            fieldRevisions: { continuity: 1 },
            continuity: { turn: 0 },
        };
        let persisted = structuredClone(oldNamespace);
        const context = {
            chatId: 'chat-p3',
            chatMetadata: { mvu_auto_doctor: structuredClone(oldNamespace) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...patch };
            },
            async saveMetadata() {
                saves += 1;
                persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
                if (staleOnSave) current = false;
            },
            async readPersistedChatMetadata() {
                readbacks += 1;
                const value = mismatch || readbacks <= oldReadbacks ? oldNamespace : persisted;
                if (staleOnReadback) current = false;
                return structuredClone(value);
            },
        };
        const writer = loadNamespaceWriter(() => context);
        const next = {
            ...structuredClone(oldNamespace),
            continuity: structuredClone(nextContinuity),
        };
        const run = (precondition = () => current) => writer.write(next, 'chat-p3', {
            fields: ['continuity'],
            durable: true,
            force: true,
            requireReadback: true,
            readbackAttempts,
            contentValidator: (value) => JSON.stringify(value?.continuity) === JSON.stringify(nextContinuity),
            precondition,
        });
        return { context, oldNamespace, run, counts: () => ({ saves, readbacks }) };
    };

    const success = makeHarness();
    assert.equal(await success.run(), true);
    assert.deepEqual(success.counts(), { saves: 1, readbacks: 1 });

    const staleBeforeSave = makeHarness();
    assert.equal(await staleBeforeSave.run(() => false), false);
    assert.deepEqual(staleBeforeSave.counts(), { saves: 0, readbacks: 0 });

    const staleAfterSave = makeHarness({ staleOnSave: true });
    assert.equal(await staleAfterSave.run(), false);
    assert.deepEqual(staleAfterSave.counts(), { saves: 1, readbacks: 0 });
    assert.equal(
        staleAfterSave.context.chatMetadata.mvu_auto_doctor.continuity.turn,
        0,
        'failed commit restores the old in-memory state',
    );

    const staleAfterReadback = makeHarness({ staleOnReadback: true });
    assert.equal(await staleAfterReadback.run(), false);
    assert.deepEqual(staleAfterReadback.counts(), { saves: 1, readbacks: 1 });
    assert.equal(staleAfterReadback.context.chatMetadata.mvu_auto_doctor.continuity.turn, 0);

    const mismatch = makeHarness({ mismatch: true });
    assert.equal(await mismatch.run(), false);
    assert.deepEqual(mismatch.counts(), { saves: 1, readbacks: 1 });
    assert.equal(mismatch.context.chatMetadata.mvu_auto_doctor.continuity.turn, 0);

    const eventuallyVisible = makeHarness({ oldReadbacks: 1, readbackAttempts: 3 });
    assert.equal(await eventuallyVisible.run(), true);
    assert.deepEqual(eventuallyVisible.counts(), { saves: 1, readbacks: 2 });

    const boundedMismatch = makeHarness({ mismatch: true, readbackAttempts: 3 });
    assert.equal(await boundedMismatch.run(), false);
    assert.deepEqual(boundedMismatch.counts(), { saves: 1, readbacks: 3 });
    assert.equal(boundedMismatch.context.chatMetadata.mvu_auto_doctor.continuity.turn, 0);

    const fullThreads = Array.from({ length: 72 }, (_, index) => ({
        id: `PERSISTED-OFFSCREEN-${index + 1}`,
        stage: index < 30 ? 'resolved' : 'advancing',
        title: `persistent thread ${index + 1}`,
    }));
    const fullHistory = makeHarness({
        nextContinuity: normalizeContinuityState({ chatId: 'chat-p3', threads: fullThreads }, {
            chatId: 'chat-p3', maxThreads: 12, maxResolved: 12,
        }),
    });
    assert.equal(await fullHistory.run(), true);
    assert.deepEqual(fullHistory.counts(), { saves: 1, readbacks: 1 });
    assert.deepEqual(
        fullHistory.context.chatMetadata.mvu_auto_doctor.continuity.threads.map((thread) => thread.id),
        fullThreads.map((thread) => thread.id),
        'the namespace save/readback path must preserve every persistent thread ID',
    );
});

test('world and actor/profile persistence outcomes remain independent', () => {
    const outcome = loadPersistenceOutcome();
    const worldSucceeded = outcome({
        worldCommitted: true,
        actorProfileCommitted: false,
        actorProfileFailureCode: 'profile.content_incomplete',
    });
    assert.equal(worldSucceeded.status, 'applied');
    assert.equal(worldSucceeded.persistenceCommitted, true);
    assert.equal(worldSucceeded.worldRetryRequired, false);
    assert.equal(worldSucceeded.actorProfileRecoveryRequired, true);
    assert.equal(worldSucceeded.persistenceFailureStage, 'actor_profile_commit');

    const worldFailed = outcome({
        worldCommitted: false,
        actorProfileCommitted: true,
        worldFailureCode: 'host_save_readback_mismatch',
    });
    assert.equal(worldFailed.status, 'failed');
    assert.equal(worldFailed.persistenceCommitted, false);
    assert.equal(worldFailed.worldRetryRequired, true);
    assert.equal(worldFailed.actorProfileRecoveryRequired, false);
    assert.equal(worldFailed.persistenceFailureStage, 'world_commit');
});

test('an exact committed world target skips recovery generation and world-domain persistence', () => {
    const capturedTarget = {
        chatId: 'chat-p3',
        index: 6,
        messageId: 'message-6',
        swipeId: 2,
        generationSerial: 9,
        generationId: 'generation-9',
        generationType: 'normal',
        identityScopeId: 'chat-p3|character:card-main',
        scopeDigest: 'scope:chat-p3|character:card-main',
        contentFingerprint: 'accepted-content-fingerprint',
    };
    const exact = loadCommittedWorldDetector();
    const sourceRef = exact.sourceRefOf(capturedTarget);
    const runtime = {
        backlog: [{
            id: 'WORLD-TASK-6',
            module: 'world',
            status: 'committed',
            sourceKey: sovereigntySourceKey(sourceRef),
        }],
    };
    assert.equal(exact.detect(runtime, null, capturedTarget), true);
    assert.equal(
        exact.detect(runtime, { id: 'unexpected-current-world-claim' }, capturedTarget),
        false,
        'a live claim must never be hidden by historical success',
    );
    for (const [field, value] of [
        ['chatId', 'another-chat'],
        ['index', 7],
        ['messageId', 'message-7'],
        ['swipeId', 3],
        ['generationSerial', 10],
        ['generationId', 'generation-10'],
        ['generationType', 'regenerate'],
        ['scopeDigest', 'scope:another-card'],
        ['contentFingerprint', 'different-accepted-content'],
    ]) {
        assert.equal(
            exact.detect(runtime, null, { ...capturedTarget, [field]: value }),
            false,
            `${field} drift must not reuse a committed world result`,
        );
    }
    const otherCardScope = loadCommittedWorldDetector('scope-other-card');
    assert.equal(
        otherCardScope.detect(runtime, null, capturedTarget),
        true,
        'the frozen captured scope, not ambient state, owns committed-target matching',
    );

    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(
        run,
        /const existingPacket = stage3PersistedPackageForTarget\([\s\S]*?namespace\?\.continuity,[\s\S]*?profileGate\.actorLedger,[\s\S]*?captured,/u,
    );
    assert.match(
        run,
        /if \(existingPacket\) \{[\s\S]*?status: 'applied',[\s\S]*?recovered: true,[\s\S]*?worldModelCalls: 0,[\s\S]*?worldWrites: 0,[\s\S]*?nextTurnInjection: deepClone\(existingPacket\)/u,
        'an exact persisted package recovers without a second world call or write',
    );
    assert.doesNotMatch(run, /worldTaskAlreadyCommitted|applyContinuityInjection|maxAttempts/u);
});

test('committed checkpoint authority cannot be bypassed by an exact persisted world package', async () => {
    const captured = {
        chatId: 'chat-committed-gate', index: 0, messageId: 'message-committed', swipeId: 0,
        generationSerial: 7, generationId: 'generation-committed', generationType: 'normal',
        scopeDigest: 'scope-committed', contentFingerprint: 'content-committed',
    };
    const actionTarget = {
        chatId: captured.chatId, logicalIndex: captured.index,
        messageId: captured.messageId, swipeId: captured.swipeId,
        generation: captured.generationSerial, generationId: captured.generationId,
        generationType: captured.generationType, scopeDigest: captured.scopeDigest,
        contentHash: captured.contentFingerprint,
    };
    const producerTarget = structuredClone(captured);
    const packet = { status: 'pending', settlementProof: { orderedResults: [] } };
    const runCase = async (checkpoint, { packetAvailable = true } = {}) => {
        let recallCalls = 0;
        let modelCalls = 0;
        let writes = 0;
        const runner = loadStage3LegacyManualReconciliationRunner({
            captured,
            namespace: { continuityCheckpoint: checkpoint, continuity: { nextTurnInjection: packet } },
            spies: {
                stage3AcceptedTarget: () => structuredClone(producerTarget),
                stage3AcceptedTargetsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
                actorActionTargetOf: () => structuredClone(actionTarget),
                actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
                stage3PersistedPackageForTarget: () => packetAvailable ? packet : null,
                stage3LegacyTargetNeedsManualReconciliation: () => false,
                markActorSchedulingSettled: () => {},
                deepClone: (value) => structuredClone(value),
                generateWorldRecallPacket: () => { recallCalls += 1; },
                generateWorldContinuitySingleBatch: () => { modelCalls += 1; },
                writeChatNamespace: () => { writes += 1; },
            },
        });
        return { result: await runner(captured), recallCalls, modelCalls, writes };
    };
    const exactCheckpoint = {
        stage3Phase: 'world_committed',
        target: structuredClone(actionTarget),
        stage3ProducerTarget: structuredClone(producerTarget),
    };
    const exact = await runCase(exactCheckpoint);
    assert.equal(exact.result.status, 'applied');
    assert.equal(exact.result.recovered, true);
    assert.equal(exact.result.worldModelCalls, 0);
    assert.equal(exact.recallCalls, 0);
    assert.equal(exact.modelCalls, 0);
    assert.equal(exact.writes, 0);

    for (const [checkpoint, expectedReason] of [
        [{ ...structuredClone(exactCheckpoint), target: { ...actionTarget, generationId: 'drift' } },
            'world_committed_manual_reconciliation'],
        [{
            ...structuredClone(exactCheckpoint),
            stage3ProducerTarget: { ...producerTarget, generationId: 'producer-drift' },
        }, 'world_committed_manual_reconciliation'],
        [{
            stage3Phase: 'world_call_reserved',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: { ...producerTarget, generationId: 'reserved-drift' },
        }, 'world_call_reserved_manual_reconciliation'],
        [{
            stage3Phase: 'world_candidate_prepared',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: { ...producerTarget, generationId: 'prepared-drift' },
        }, 'world_candidate_manual_reconciliation'],
        [{
            stage3Phase: 'unknown_phase',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: structuredClone(producerTarget),
        }, 'world_committed_manual_reconciliation'],
        [undefined, 'world_committed_manual_reconciliation'],
    ]) {
        const rejected = await runCase(checkpoint);
        assert.equal(rejected.result.status, 'failed');
        assert.equal(rejected.result.reason, expectedReason);
        assert.equal(rejected.recallCalls, 0);
        assert.equal(rejected.modelCalls, 0);
        assert.equal(rejected.writes, 0);
    }

    for (const [checkpoint, expectedReason] of [
        [{
            stage3Phase: 'world_call_reserved',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: { ...producerTarget, generationId: 'reserved-drift-no-packet' },
        }, 'world_call_reserved_manual_reconciliation'],
        [{
            stage3Phase: 'world_candidate_prepared',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: { ...producerTarget, generationId: 'prepared-drift-no-packet' },
        }, 'world_candidate_manual_reconciliation'],
        [{
            stage3Phase: 'unknown_active_phase',
            target: structuredClone(actionTarget),
            stage3ProducerTarget: structuredClone(producerTarget),
        }, 'world_committed_manual_reconciliation'],
    ]) {
        const rejected = await runCase(checkpoint, { packetAvailable: false });
        assert.equal(rejected.result.status, 'failed');
        assert.equal(rejected.result.reason, expectedReason);
        assert.equal(rejected.recallCalls, 0);
        assert.equal(rejected.modelCalls, 0);
        assert.equal(rejected.writes, 0);
    }
});

test('P3 target, recovery key, and legacy reconciliation require generation ID and type', () => {
    const stage3 = loadStage3AcceptedTargetHelpers();
    const current = {
        chatId: 'chat-stage3',
        index: 4,
        messageId: 'message-4',
        swipeId: 1,
        generationSerial: 12,
        generationId: 'generation-12',
        generationType: 'regenerate',
        scopeDigest: 'scope-stage3',
        contentFingerprint: 'fingerprint-stage3',
    };
    const target = stage3.stage3AcceptedTarget(current);
    assert.equal(target.generationId, 'generation-12');
    assert.equal(target.generationType, 'regenerate');
    assert.equal(
        stage3.stage3AcceptedTargetsMatch(target, stage3.stage3AcceptedTarget({
            ...current,
            generationId: 'generation-13',
        })),
        false,
        'a generation ID drift must not reuse a persisted stage-3 package',
    );
    assert.equal(
        stage3.stage3AcceptedTargetsMatch(target, stage3.stage3AcceptedTarget({
            ...current,
            generationType: 'swipe',
        })),
        false,
        'a generation type drift must not reuse a persisted stage-3 package',
    );
    assert.equal(
        stage3.stage3AcceptedTarget({ ...current, generationId: '' }),
        null,
        'new work without a generation ID is fail-closed',
    );
    assert.equal(
        stage3.stage3AcceptedTarget({ ...current, generationType: '' }),
        null,
        'new work without a generation type is fail-closed',
    );
    assert.equal(
        stage3.stage3LegacyTargetNeedsManualReconciliation({
            ...target,
            generationId: '',
        }, current),
        true,
        'a matching old package without generation ID is compatibility-only',
    );
    assert.match(stage3.stage3AcceptedTargetKey(current), /generation-12:regenerate/u);

    const settlement = sourceSection(
        'function stage3CanonicalSettlementProof(ledger, results = [], captured) {',
        'function stage3PersistedPackageForTarget(state, ledger, captured) {',
    );
    assert.match(settlement, /producerTarget,/u);
    assert.match(settlement, /stage3AcceptedTargetsMatch\(proof\.producerTarget, producerTarget\)/u);
});

test('P3 current guard, permit gate, old package reconciliation, and settlement proof are all generation-bound', async () => {
    const current = {
        chatId: 'chat-stage3', index: 0, messageId: 'message-stage3', swipeId: 0,
        generationSerial: 4, generationId: 'generation-4', generationType: 'normal',
        scopeDigest: 'scope-stage3', contentFingerprint: 'fingerprint-stage3',
    };
    const currentGuard = loadStage3AcceptedTargetHelpers({
        operationEpoch: 4,
        targetIsCurrent: () => ({ ok: true }),
        getContext: () => ({ chatId: current.chatId }),
        captureTarget: () => ({ ...current, generationType: 'swipe' }),
    });
    const changedType = currentGuard.stage3TargetIsCurrent(current, { epoch: 4 });
    assert.equal(changedType.ok, false, 'a same-ID type drift cannot bypass the generic current guard');
    assert.equal(changedType.reason, 'stage3_generation_target_changed');

    let modelCalls = 0;
    let writes = 0;
    const legacyTarget = { ...current, generationType: '' };
    const run = loadStage3LegacyManualReconciliationRunner({
        captured: current,
        legacyTarget,
        namespace: { continuity: { nextTurnInjection: { producerTarget: legacyTarget } } },
        spies: {
            generateWorldContinuitySingleBatch: () => { modelCalls += 1; },
            writeChatNamespace: () => { writes += 1; },
        },
    });
    const manual = await run(current);
    assert.equal(manual.reason, 'world_target_generation_identity_manual_reconciliation');
    assert.equal(manual.compatibilityOnly, true);
    assert.equal(modelCalls, 0);
    assert.equal(writes, 0);

    const noActorGate = loadStage3NoActorPermitGate();
    const permitTarget = {
        ...current,
        logicalIndex: current.index,
        contentHash: current.contentFingerprint,
    };
    const permit = {
        status: 'no_candidates', eligible: true,
        profileBatch: { readbackVerified: true }, target: permitTarget,
    };
    assert.equal(noActorGate(current, permit).reason, 'no_candidates');
    assert.equal(noActorGate(current, { ...permit, target: { ...permitTarget, generationType: 'swipe' } }).reason,
        'actor_registry_awaiting_p2');
    assert.equal(noActorGate(current, { ...permit, profileBatch: { readbackVerified: false } }).reason,
        'actor_registry_awaiting_p2');

    const persisted = loadStage3PersistedPackageValidator();
    const actionTarget = { ...current };
    const result = {
        attemptId: 'attempt-stage3',
        status: 'settled',
        id: 'receipt-stage3',
        actorRef: { actorId: 'actor-stage3', canonicalName: 'NPC' },
        outcome: 'world-confirmed',
    };
    const ledger = {
        actionAttempts: [{
            id: 'attempt-stage3',
            target: actionTarget,
            worldAdjudicationResult: result,
        }],
    };
    const proof = persisted.stage3CanonicalSettlementProof(ledger, [result], current);
    const continuity = {
        nextTurnInjection: {
            producerTarget: { ...current },
            sourceContinuityDigest: '',
            settlementProof: proof,
        },
    };
    continuity.nextTurnInjection.sourceContinuityDigest = persisted.stage3ContinuityDigestWithoutInjection(continuity);
    assert.ok(persisted.stage3PersistedPackageForTarget(continuity, ledger, current));
    assert.equal(
        persisted.stage3PersistedPackageForTarget(continuity, ledger, { ...current, generationType: 'swipe' }),
        null,
    );
    assert.equal(
        persisted.stage3PersistedPackageForTarget(continuity, {
            actionAttempts: [{ ...ledger.actionAttempts[0], worldAdjudicationResult: {
                ...result,
                id: 'receipt-tampered',
            } }],
        }, current),
        null,
        'a receipt/settlement mismatch cannot pass a persisted package readback',
    );
    const proofAttemptTampered = structuredClone(continuity);
    proofAttemptTampered.nextTurnInjection.settlementProof.orderedResults[0].attemptId = 'attempt-tampered';
    assert.equal(
        persisted.stage3PersistedPackageForTarget(proofAttemptTampered, ledger, current),
        null,
        'a proof attempt ID mismatch cannot pass readback',
    );
    const proofActorTampered = structuredClone(continuity);
    proofActorTampered.nextTurnInjection.settlementProof
        .orderedResults[0].worldAdjudicationResult.actorRef.actorId = 'actor-tampered';
    assert.equal(
        persisted.stage3PersistedPackageForTarget(proofActorTampered, ledger, current),
        null,
        'a proof ActorRef mismatch cannot pass readback',
    );
});

test('saved no-candidates proof survives refresh and reopens P3 without rerunning P1', async () => {
    const captured = {
        chatId: 'chat-proof', index: 4, logicalIndex: 4,
        messageId: 'message-proof', swipeId: 0,
        generation: 9, generationSerial: 9,
        generationId: 'generation-proof', generationType: 'normal', type: 'normal',
        identityScope: { cardId: 'card-proof' },
        identityScopeId: 'chat-proof|card-proof', scope: { cardId: 'card-proof' },
        scopeDigest: 'scope-proof', hash: 'host-proof',
        contentHash: 'content-proof', contentFingerprint: 'content-proof',
    };
    const persistence = loadNoCandidatesPersistenceHarness({
        actorLedger: {},
        actorProfileRetryReceipt: null,
        characterCreationTicketBatches: [],
        actorProfileNoCandidatesTerminalProof: null,
    });
    assert.equal(await persistence.persist(captured, {
        status: 'no_candidates', profileBatch: { readbackVerified: false },
    }), true);
    assert.equal(persistence.state.writes, 1);
    const savedNamespace = JSON.parse(JSON.stringify(persistence.state.persisted));
    assert.ok(savedNamespace.actorProfileNoCandidatesTerminalProof);
    assert.equal(savedNamespace.actorProfileRetryReceipt, null);
    assert.deepEqual(savedNamespace.characterCreationTicketBatches, []);
    let p1CallsAfterRefresh = 0;
    const refreshedP3Gate = loadStage3NoActorPermitGate({
        namespace: savedNamespace,
        currentSourceRef: captured,
    });
    const reopened = refreshedP3Gate(captured, null);
    assert.equal(p1CallsAfterRefresh, 0);
    assert.equal(reopened.ok, true);
    assert.equal(reopened.reason, 'no_candidates');
    assert.equal(reopened.noActorPermit, false);
    assert.equal(reopened.persistedNoCandidatesProof, true);

    const damagedNamespace = structuredClone(savedNamespace);
    damagedNamespace.actorProfileNoCandidatesTerminalProof.proofDigest = 'tampered';
    assert.equal(loadStage3NoActorPermitGate({
        namespace: damagedNamespace,
        currentSourceRef: captured,
    })(captured, null).reason, 'actor_registry_awaiting_p2');

    for (const staleCleanup of [
        { actorProfileRetryReceipt: { status: 'not_completed' } },
        { characterCreationTicketBatches: [{ acceptedTarget: structuredClone(captured) }] },
    ]) {
        const incompleteCleanup = { ...structuredClone(savedNamespace), ...staleCleanup };
        assert.equal(loadStage3NoActorPermitGate({
            namespace: incompleteCleanup,
            currentSourceRef: captured,
        })(captured, null).reason, 'actor_registry_awaiting_p2');
    }

    for (const drift of [
        { contentHash: 'changed', contentFingerprint: 'changed' },
        { scopeDigest: 'scope-changed' },
        { identityScopeId: 'chat-proof|card-changed' },
        { generationId: 'generation-changed' },
    ]) {
        const changed = { ...captured, ...drift };
        assert.equal(loadStage3NoActorPermitGate({
            namespace: savedNamespace,
            currentSourceRef: changed,
        })(changed, null).reason, 'actor_registry_awaiting_p2');
    }
});

test('P3 Registry lookup tolerates only mechanism full-hash drift for a ready actor', () => {
    const currentSourceRef = {
        chatId: 'chat-registry-recovery', messageId: 'message-8',
        logicalIndex: 8, index: 8, swipeId: 1,
        generation: 12, generationSerial: 12,
        generationId: 'generation-12', generationType: 'normal', type: 'normal',
        identityScope: { cardId: 'card-current' },
        identityScopeId: 'chat-registry-recovery|card-current',
        scope: { cardId: 'card-current' }, scopeDigest: 'scope-current',
        hash: 'host-hash-after-mvu-writeback',
        contentHash: 'accepted-narrative-fingerprint',
        contentFingerprint: 'accepted-narrative-fingerprint',
    };
    const persistedRegistrySource = {
        ...currentSourceRef,
        identityScope: undefined,
        scope: undefined,
        hash: 'host-hash-before-mvu-writeback',
    };
    const ledger = {
        actorRegistry: {
            registered: {
                'actor-ready': {
                    actorRef: { actorId: 'actor-ready', displayName: 'Ready NPC' },
                    sourceRefs: [persistedRegistrySource],
                },
            },
        },
    };
    const runGate = (source, ready = true) => loadStage3NoActorPermitGate({
        namespace: { actorLedger: ledger },
        currentSourceRef: source,
        ledger,
        readiness: { 'actor-ready': ready },
    })(source, null);

    assert.equal(runGate(currentSourceRef).reason, 'atomic_readback');
    for (const drift of [
        {
            contentHash: 'different-narrative',
            contentFingerprint: 'different-narrative',
        },
        { generation: 13, generationSerial: 13 },
        { scopeDigest: 'different-scope' },
    ]) {
        assert.equal(
            runGate({ ...currentSourceRef, ...drift }).reason,
            'actor_registry_awaiting_p2',
        );
    }
    assert.equal(
        runGate(currentSourceRef, false).reason,
        'actor_profile.not_ready:actor-ready',
    );
});

test('P3 normalize and durable readback retain the complete packet and settlement generation identity', async () => {
    const current = {
        chatId: 'chat-stage3-roundtrip', index: 3, messageId: 'message-roundtrip', swipeId: 1,
        generationSerial: 9, generationId: 'generation-roundtrip', generationType: 'regenerate',
        scopeDigest: 'scope-roundtrip', contentFingerprint: 'fingerprint-roundtrip',
    };
    const persisted = loadStage3PersistedPackageValidator({
        normalizer: (value, options) => normalizeContinuityState(value, options),
    });
    const result = {
        attemptId: 'attempt-roundtrip', status: 'settled', id: 'receipt-roundtrip',
        actorRef: {
            kind: 'actor_ref', actorId: 'actor-roundtrip', displayName: 'NPC', aliases: [],
        },
        outcome: 'confirmed',
    };
    const ledger = {
        actionAttempts: [{
            id: result.attemptId,
            target: { ...current },
            worldAdjudicationResult: result,
        }],
    };
    const proof = persisted.stage3CanonicalSettlementProof(ledger, [result], current);
    let continuity = normalizeContinuityState({
        chatId: current.chatId,
        nextTurnInjection: {
            version: 1,
            status: 'pending',
            producerTarget: { ...current },
            sourceContinuityDigest: '',
            payload: { text: 'world package', visibleThreadIds: [] },
            settlementProof: proof,
            createdAt: 1,
        },
    }, { chatId: current.chatId });
    continuity.nextTurnInjection.sourceContinuityDigest = persisted.stage3ContinuityDigestWithoutInjection(continuity);
    continuity = normalizeContinuityState(continuity, { chatId: current.chatId });
    const packet = continuity.nextTurnInjection;
    assert.equal(packet.producerTarget.generationId, current.generationId);
    assert.equal(packet.producerTarget.generationType, current.generationType);
    assert.equal(packet.settlementProof.producerTarget.generationId, current.generationId);
    assert.equal(packet.settlementProof.producerTarget.generationType, current.generationType);
    assert.equal(
        packet.sourceContinuityDigest,
        persisted.stage3ContinuityDigestWithoutInjection(continuity),
        'the normalized packet retains the exact source-state digest used for readback',
    );
    assert.equal(
        persisted.stage3SettlementProofMatchesLedger(packet.settlementProof, ledger, current),
        true,
        'a normalized proof must remain bound to its exact ledger receipt',
    );
    assert.ok(persisted.stage3PersistedPackageForTarget(continuity, ledger, current));

    const stored = { namespace: null };
    const context = {
        chatId: current.chatId,
        chatMetadata: {
            mvu_auto_doctor: {
                version: 13,
                chatId: current.chatId,
                rev: 0,
                fieldRevisions: {},
                continuity: null,
            },
        },
        updateChatMetadata(update) {
            Object.assign(this.chatMetadata, structuredClone(update));
        },
        async saveMetadata() {
            stored.namespace = structuredClone(this.chatMetadata.mvu_auto_doctor);
            stored.namespace.continuity = normalizeContinuityState(
                stored.namespace.continuity,
                { chatId: current.chatId },
            );
        },
        async readPersistedChatMetadata() {
            return structuredClone(stored.namespace);
        },
    };
    const writer = loadNamespaceWriter(() => context);
    const success = {};
    const saved = await writer.write({
        ...context.chatMetadata.mvu_auto_doctor,
        continuity,
    }, current.chatId, {
        fields: ['continuity'],
        durable: true,
        requireReadback: true,
        successSink: success,
        contentValidator: (readback) => !!persisted.stage3PersistedPackageForTarget(
            readback.continuity,
            ledger,
            current,
        ),
    });
    assert.equal(saved, true);
    assert.equal(success.readbackNamespace.continuity.nextTurnInjection.producerTarget.generationId,
        current.generationId);
    assert.equal(success.readbackNamespace.continuity.nextTurnInjection.settlementProof
        .producerTarget.generationType, current.generationType);

    const tampered = structuredClone(success.readbackNamespace.continuity);
    tampered.nextTurnInjection.settlementProof.producerTarget.generationType = 'swipe';
    assert.equal(persisted.stage3PersistedPackageForTarget(tampered, ledger, current), null);
    const legacy = normalizeContinuityState({
        chatId: current.chatId,
        nextTurnInjection: {
            ...packet,
            producerTarget: { ...packet.producerTarget, generationType: '' },
        },
    }, { chatId: current.chatId });
    assert.equal(legacy.nextTurnInjection, null, 'legacy packet without generation type is non-restorable');
});

test('P3 Phase1 readback requires one shared advanced transaction revision', () => {
    const gate = loadStage3PreparedPhase1RevisionGate();
    const ledger = { digest: 'actor-ledger-after-phase1', actionAttempts: [] };
    const continuity = { turn: 4, threads: [] };
    const continuityDigest = gate.fieldState({ continuity }, 'continuity').digest;
    const checkpoint = {
        preparedWorld: {
            phase1ActorLedgerDigest: ledger.digest,
            phase1Expected: {
                actorLedger: { revision: 1, digest: 'actor-before' },
                continuityCheckpoint: { revision: 5, digest: 'checkpoint-before' },
                continuity: { revision: 4, digest: continuityDigest },
            },
        },
    };
    const namespaceAt = ({ actorRevision = 6, checkpointRevision = 6,
        continuityRevision = 4, actorDigest = ledger.digest,
        actorLedgerValue = { ...ledger, digest: actorDigest },
        continuityValue = continuity } = {}) => ({
        actorLedger: actorLedgerValue,
        continuity: continuityValue,
        continuityCheckpoint: checkpoint,
        fieldRevisions: {
            actorLedger: actorRevision,
            continuityCheckpoint: checkpointRevision,
            continuity: continuityRevision,
        },
    });

    assert.equal(
        gate.matches(checkpoint, namespaceAt(), ledger, {}),
        true,
        'global revision 6 is one atomic commit after actor S0=1 and checkpoint S0=5',
    );
    assert.equal(gate.matches(checkpoint, namespaceAt({ actorRevision: 6, checkpointRevision: 7 }), ledger, {}), false);
    assert.equal(gate.matches(checkpoint, namespaceAt({ actorRevision: 1, checkpointRevision: 6 }), ledger, {}), false);
    assert.equal(gate.matches(checkpoint, namespaceAt({ actorRevision: 6, checkpointRevision: 5 }), ledger, {}), false);
    assert.equal(gate.matches(checkpoint, namespaceAt({ actorDigest: 'actor-digest-drift' }), ledger, {}), false);
    assert.equal(gate.matches(checkpoint, namespaceAt({ continuityRevision: 5 }), ledger, {}), false);
    assert.equal(gate.matches(checkpoint, namespaceAt({ continuityValue: { turn: 5 } }), ledger, {}), false);

    const attemptLedger = {
        digest: ledger.digest,
        actionAttempts: [{ id: 'attempt-1', status: 'pending_world' }],
    };
    const ordinaryCheckpoint = structuredClone(checkpoint);
    ordinaryCheckpoint.preparedWorld.phase1Expected.actorLedger.revision = 5;
    assert.equal(
        gate.matches(
            ordinaryCheckpoint,
            namespaceAt({ actorLedgerValue: attemptLedger }),
            attemptLedger,
            {},
        ),
        true,
        'ordinary attempt Phase1 also advances both selected fields from 5 to shared revision 6',
    );
});

test('P3 wiring uses Recall then one Advance call, with ATT plus prepared checkpoint before Phase2', () => {
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.doesNotMatch(run, /callModel\(/u);
    assert.doesNotMatch(run, /buildContinuityRepairMessages/u);
    const recallAt = run.indexOf('await generateWorldRecallPacket');
    const reserveAt = run.indexOf("stage3Phase: 'world_call_reserved'");
    const worldAt = run.indexOf('await generateWorldContinuitySingleBatch', reserveAt);
    const proposalAt = run.indexOf('actorActionCandidatesFromShard', worldAt);
    const prepareAt = run.indexOf('prepareActorActionAttempts', proposalAt);
    const recordAt = run.indexOf('recordActorActionAttempts', prepareAt);
    const persistAt = run.indexOf('await persistActorActionAttemptsForTurn', recordAt);
    const preparedAt = run.indexOf("stage3Phase: 'world_candidate_prepared'", persistAt);
    assert.ok(recallAt >= 0 && reserveAt > recallAt && worldAt > reserveAt);
    assert.ok(proposalAt > worldAt && prepareAt > proposalAt && recordAt > prepareAt && persistAt > recordAt);
    assert.ok(preparedAt < 0, 'checkpoint state is created by the pure helper, not duplicated in the runner');
    assert.match(run, /return commitPreparedWorldCandidate\(captured/u);
    assert.match(run, /stage3PreparedWorldCheckpoint\(/u);
    assert.match(run, /stage3PreparedWorldCheckpointMatches\(/u);
    assert.match(run, /target: deepClone\(actionTarget\),[\s\S]*?stage3Phase: 'world_call_reserved'/u);
    const preparedCheckpoint = sourceSection(
        'function stage3PreparedWorldCheckpoint({',
        'function stage3PreparedWorldCheckpointMatches(',
    );
    assert.match(preparedCheckpoint, /target: deepClone\(actionTarget\),[\s\S]*?stage3Phase: 'world_candidate_prepared'/u);
    const commit = sourceSection(
        'async function commitPreparedWorldCandidate(captured, {',
        'async function enqueueActorProfiles(targetId, {',
    );
    assert.match(commit, /target: deepClone\(actionTarget\),[\s\S]*?stage3Phase: 'world_committed'/u);
    assert.match(
        commit,
        /contentValidator:[\s\S]*?stage3AcceptedTargetsMatch\([\s\S]*?continuityCheckpoint\?\.stage3ProducerTarget,[\s\S]*?stage3AcceptedTarget\(captured\)/u,
    );
    assert.match(source, /async function commitPreparedWorldCandidate/u);
    assert.match(source, /expectedFieldStates/u);
    assert.doesNotMatch(source, /collectActorShardProposals/u);
});

test('P3 keeps full persistent thread history while P4 remains a separate visible projection', () => {
    const sourceRef = (index) => ({
        chatId: 'chat-full-history', messageId: `message-${index}`,
        logicalIndex: index, index, swipeId: index % 2,
        generation: index + 10, generationSerial: index + 10,
        generationId: `generation-${index}`, generationType: 'normal', type: 'normal',
        identityScope: { cardId: 'card-a' }, identityScopeId: 'scope-a',
        scope: { cardId: 'card-a' }, scopeDigest: 'scope-digest-a',
        hash: `hash-${index}`, contentHash: `hash-${index}`,
        contentFingerprint: `hash-${index}`,
    });
    const threads = Array.from({ length: 72 }, (_, index) => ({
        id: `OFFSCREEN-${index + 1}`,
        title: `offscreen continuity ${index + 1}`,
        stage: index < 30 ? 'resolved' : 'advancing',
        eventType: 'progress',
        relation: 'independent',
        knowledge: 'hidden',
        urgency: 1,
        createdTurn: index + 1,
        lastAdvancedTurn: index + 1,
        sourceRefs: [sourceRef(index + 1)],
    }));
    const normalized = normalizeContinuityState({ chatId: 'chat-full-history', threads }, {
        chatId: 'chat-full-history', maxThreads: 12, maxResolved: 12,
    });
    const expectedIds = threads.map((thread) => thread.id);
    assert.equal(normalized.threads.length, 72);
    assert.deepEqual(normalized.threads.map((thread) => thread.id), expectedIds);
    assert.equal(normalized.threads.at(-1).id, 'OFFSCREEN-72');
    assert.equal(normalized.threads.filter((thread) => thread.stage === 'resolved').length, 30);
    assert.equal(normalized.threads.filter((thread) => thread.stage === 'advancing').length, 42);
    const expectedSourceRefs = threads.map((thread) => normalizeSourceRef(thread.sourceRefs[0]));
    assert.deepEqual(normalized.threads.map((thread) => thread.sourceRefs[0]), expectedSourceRefs);
    assert.equal(JSON.stringify(normalized).includes('branch'), false);
    const clocked = advanceContinuityClocks(normalized, {
        chatId: 'chat-full-history', random: () => 0.9,
    }).state;
    assert.equal(clocked.threads.length, 72);
    assert.deepEqual(clocked.threads.map((thread) => thread.id), expectedIds);
    assert.deepEqual(clocked.threads.map((thread) => thread.sourceRefs[0]), expectedSourceRefs);
    const merged = mergeMarkerRecords(clocked, [], { chatId: 'chat-full-history', maxThreads: 12 });
    assert.equal(merged.threads.length, 72);
    assert.deepEqual(merged.threads.map((thread) => thread.id), expectedIds);
    assert.deepEqual(merged.threads.map((thread) => thread.sourceRefs[0]), expectedSourceRefs);
    const parsed = parseContinuityOutput(JSON.stringify(merged), { chatId: 'chat-full-history', maxThreads: 12 });
    assert.ok(parsed.state);
    assert.deepEqual(parsed.state.threads.map((thread) => thread.id), expectedIds);
    assert.deepEqual(parsed.state.threads.map((thread) => thread.sourceRefs[0]), expectedSourceRefs);
    const namespaceReadback = JSON.parse(JSON.stringify({ continuity: parsed.state }));
    assert.deepEqual(
        namespaceReadback.continuity.threads.map((thread) => thread.sourceRefs[0]),
        expectedSourceRefs,
    );
});

test('P3 source retains every scheduled ActorRef atomically and fails capacity before a model call', () => {
    const advance = sourceSection('function buildContinuityMessages({', 'async function generateWorldContinuitySingleBatch(');
    const recall = sourceSection('function buildWorldRecallMessages({', 'async function generateWorldRecallPacket(');
    assert.match(advance, /recalledActors = \[\.\.\.\(actorLedger\?\.actors \|\| \[\]\)\]/u);
    assert.match(advance, /world_recall_missing_scheduled_actor_material/u);
    assert.match(advance, /world_recall_capacity_unavailable/u);
    assert.doesNotMatch(advance, /recalledActors\.slice\(/u);
    assert.match(recall, /world_recall_capacity_unavailable/u);
    assert.doesNotMatch(recall, /cropText\(user/u);
    const runner = sourceSection('async function runContinuityTarget(captured, {', 'function sameTargetExceptContent(left, right)');
    assert.match(runner, /actorSchedule\.selected\.map\(\(actor\) => actor\.actorId\)/u);
    assert.doesNotMatch(runner, /actor_schedule_empty/u);
});

test('P3 Recall consumes the production balanced-object extractor result', () => {
    const selectRecall = loadStage3RecallSelection();
    const options = {
        mustActorIds: ['actor-must'],
        mustThreadIds: ['thread-must'],
        mustLaneIds: ['lane-must'],
        availableActorIds: ['actor-must', 'actor-known'],
        availableThreadIds: ['thread-must', 'thread-known'],
        availableLaneIds: ['lane-must', 'lane-known'],
        worldbookKeys: ['world-b', 'world-a', 'world-a'],
    };
    const valid = JSON.stringify({
        actorIds: ['actor-known', 'unknown-actor', 'actor-must', 'actor-must'],
        threadIds: ['unknown-thread', 'thread-must'],
        laneIds: ['lane-must', 'unknown-lane'],
        reasons: ['must retain', 'known only'],
    });
    const extracted = extractFirstBalancedJsonObject(valid);
    assert.deepEqual(Object.keys(extracted).sort(), ['end', 'source', 'start', 'value']);
    assert.deepEqual(extracted.value.actorIds, [
        'actor-known', 'unknown-actor', 'actor-must', 'actor-must',
    ]);

    for (const output of [valid, `\`\`\`json\n${valid}\n\`\`\``, `前文\n${valid}\n后文`]) {
        const packet = selectRecall(output, options);
        assert.ok(packet);
        assert.deepEqual(Array.from(packet.actorIds), ['actor-known', 'actor-must']);
        assert.deepEqual(Array.from(packet.threadIds), ['thread-must']);
        assert.deepEqual(Array.from(packet.laneIds), ['lane-must']);
        assert.deepEqual(Array.from(packet.mustActorIds), ['actor-must']);
        assert.deepEqual(Array.from(packet.worldbookKeys), ['world-a', 'world-b']);
    }

    assert.deepEqual(extractFirstBalancedJsonObject('{bad json}'), {
        error: 'json_object_missing',
    });
    assert.equal(selectRecall('{bad json}', options), null);
    assert.equal(selectRecall(JSON.stringify({
        actorIds: ['actor-known'], threadIds: ['thread-must'], laneIds: ['lane-must'],
    }), options), null, 'must actor omission remains fail-closed');
});

test('P3 Advance prompt distinguishes new actor drafts from existing ATT adjudications', () => {
    const prompt = sourceSection('function buildContinuityMessages({', 'async function generateWorldContinuitySingleBatch(');
    assert.match(prompt, /newly scheduled actors there is no actionAttempt yet/u);
    assert.match(prompt, /Do not invent attemptId, actorRef, or target/u);
    assert.match(prompt, /For existing persisted actionAttempts/u);
});
