import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    applyWorldUpdate,
    mergeMarkerRecords,
    normalizeContinuityState,
    parseContinuityOutput,
} from '../continuity-core.mjs';
import { sovereigntySourceKey } from '../sovereignty-runtime-core.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

function loadWorldGenerator(callModel) {
    const code = sourceSection(
        'async function generateWorldContinuitySingleBatch(messages, {',
        'function actorShardLeaseFingerprint(captured)',
    );
    const sandbox = {
        callModel,
        parseContinuityOutput,
        validateWorldAdjudicationBatch: () => ({ valid: true, errors: [] }),
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
const captured = { chatId: 'chat-p3', index: 6 };

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
        'const provisionalWorldLaneSchedule = scheduleWorldLanes(scheduledBase, {',
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
    const makeHarness = ({ staleOnSave = false, staleOnReadback = false, mismatch = false } = {}) => {
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
                const value = mismatch ? oldNamespace : persisted;
                if (staleOnReadback) current = false;
                return structuredClone(value);
            },
        };
        const writer = loadNamespaceWriter(() => context);
        const next = {
            ...structuredClone(oldNamespace),
            continuity: { turn: 1, lastSource: 'target-6' },
        };
        const run = (precondition = () => current) => writer.write(next, 'chat-p3', {
            fields: ['continuity'],
            durable: true,
            force: true,
            requireReadback: true,
            readbackAttempts: 1,
            contentValidator: (value) => value?.continuity?.turn === 1,
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
        branchId: 'branch-main',
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
        ['branchId', 'branch-other'],
        ['contentFingerprint', 'different-accepted-content'],
    ]) {
        assert.equal(
            exact.detect(runtime, null, { ...capturedTarget, [field]: value }),
            false,
            `${field} drift must not reuse a committed world result`,
        );
    }
    const otherCardScope = loadCommittedWorldDetector('scope-other-card');
    assert.equal(otherCardScope.detect(runtime, null, capturedTarget), false);

    const run = sourceSection(
        'async function runContinuityTarget(captured, { force = false } = {})',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(run, /const maxAttempts = worldTaskAlreadyCommitted \? 0 : 1/u);
    assert.match(run, /let worldStateCommitted = worldTaskAlreadyCommitted/u);
    assert.match(
        run,
        /remainingSovereigntyTasks = worldTaskAlreadyCommitted[\s\S]*?world: null/u,
    );
    assert.match(run, /if \(modelValidated && !worldTaskAlreadyCommitted\)/u);
    assert.match(
        run,
        /if \(worldStateCommitted\) await applyContinuityInjection\(\)/u,
        'recovery may idempotently finish prompt injection but cannot reopen world persistence',
    );
});

test('6.1 regression wiring keeps one world batch and removes world fields from actor/profile commit', () => {
    const run = sourceSection(
        'async function runContinuityTarget(captured, { force = false } = {})',
        'function sameTargetExceptContent(left, right)',
    );
    assert.doesNotMatch(run, /callModel\(/u);
    assert.doesNotMatch(run, /buildContinuityRepairMessages/u);
    assert.match(run, /const maxAttempts = worldTaskAlreadyCommitted \? 0 : 1/u);
    assert.match(run, /worldPrefetchAttempted/u);
    assert.match(run, /remainingSovereigntyTasks = \{ \.\.\.sovereigntyTasks, world: null \}/u);
    const actorCycleFields = run.match(/const cycleFields = \[([\s\S]*?)\];/u)?.[1] || '';
    assert.doesNotMatch(actorCycleFields, /continuity|worldPressure|continuityWorldLaneReceipts/u);
    assert.match(run, /requireReadback: true,[\s\S]*?readbackAttempts: 1/u);
    assert.match(
        run,
        /if \(modelValidated && !worldTaskAlreadyCommitted\) \{[\s\S]*?writeChatNamespace\(namespace, captured\.chatId/u,
    );
    assert.match(
        run,
        /if \(!worldStateCommitted\) \{[\s\S]*?settleWorldSovereigntyTask/u,
    );
    assert.match(source, /const dedupeKey = capturedTargetKey\(expected\)/u);
});
