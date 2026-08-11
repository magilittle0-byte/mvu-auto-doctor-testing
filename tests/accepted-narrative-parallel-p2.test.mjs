import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function loadAcceptedContentFunctions() {
    const code = sourceSection(
        'function stripMechanism(text)',
        'function sovereigntyNarrativeEligible(text)',
    );
    const sandbox = {
        STATUS_PLACEHOLDER: '<StatusPlaceHolderImpl/>',
        fingerprint: (value) => String(value),
        stripClosedProposals: (value) => String(value),
    };
    vm.runInNewContext(`${code}\nthis.acceptedContentText = acceptedContentText;\nthis.acceptedContentFingerprint = acceptedContentFingerprint;`, sandbox);
    return sandbox;
}

function loadAcceptedTargetMatcher(operationEpoch = 7) {
    const code = sourceSection(
        'function sameTargetExceptContent(left, right)',
        'function continuityTargetIsCurrent(captured, token)',
    );
    const sandbox = { operationEpoch };
    vm.runInNewContext(`${code}\nthis.sameAcceptedNarrativeTarget = sameAcceptedNarrativeTarget;`, sandbox);
    return sandbox.sameAcceptedNarrativeTarget;
}

function loadAutomaticWaitHarness() {
    const code = sourceSection(
        'async function waitAutomaticTargetSettled(initialCaptured)',
        'function sourceRefOf(captured)',
    );
    const firstSleep = deferred();
    const state = {
        now: 10_000,
        holdFirstSleep: true,
        busyReads: 0,
        fingerprintReads: 0,
        statuses: [],
    };
    const sandbox = {
        Date: { now: () => state.now },
        DEFAULTS: { delayMs: 300, mvuStableTimeoutMs: 1_000 },
        getSettings: () => ({ delayMs: 300, mvuStableTimeoutMs: 1_000 }),
        getMvu: async () => ({
            isDuringExtraAnalysis: () => {
                state.busyReads += 1;
                return true;
            },
            getMvuData: async () => ({ stat_data: { revision: ++state.fingerprintReads } }),
        }),
        mvuDataAt: async (Mvu) => Mvu.getMvuData(),
        statDataOf: (value) => value.stat_data,
        safeJson: (value) => JSON.stringify(value),
        fingerprint: (value) => String(value),
        targetBranchIsCurrent: (captured) => ({ ok: true, captured }),
        setStatus: (message) => state.statuses.push(message),
        recordOperation: () => undefined,
        sleep: async (ms) => {
            state.now += ms;
            if (state.holdFirstSleep) {
                state.holdFirstSleep = false;
                await firstSleep.promise;
            }
        },
    };
    vm.runInNewContext(`${code}\nthis.waitAutomaticTargetSettled = waitAutomaticTargetSettled;`, sandbox);
    return {
        wait: sandbox.waitAutomaticTargetSettled,
        release: firstSleep.resolve,
        state,
    };
}

function makeTarget(overrides = {}) {
    return {
        chatId: 'chat-a',
        index: 2,
        messageId: 'message-2',
        swipeId: 0,
        fingerprint: 'whole-message-a',
        contentFingerprint: 'accepted-a',
        generationId: 'generation-a',
        branchId: 'branch-a',
        epoch: 7,
        ...overrides,
    };
}

function loadContinuityQueueHarness({ expected, fresh = expected, worldResult = null }) {
    const code = sourceSection(
        'function sameTargetExceptContent(left, right)',
        'async function confirmDangerousAction(message)',
    );
    const gate = deferred();
    const state = {
        fresh,
        starts: 0,
        writes: 0,
        autoRetries: 0,
    };
    const sandbox = {
        operationEpoch: 7,
        continuityChain: Promise.resolve(),
        continuityPendingKeys: new Set(),
        continuityCompletedKeys: new Set(),
        console,
        getContext: () => ({ chatId: state.fresh.chatId }),
        latestAiMessage: () => ({ index: state.fresh.index }),
        captureTarget: () => ({ ...state.fresh }),
        capturedTargetKey: (target) => [
            target?.chatId,
            target?.index,
            target?.messageId,
            target?.swipeId,
            target?.generationId,
            target?.branchId,
            target?.contentFingerprint,
        ].join(':'),
        runContinuityTarget: async () => {
            state.starts += 1;
            if (worldResult) return worldResult;
            await gate.promise;
            state.writes += 1;
            return { status: 'applied' };
        },
        setContinuityStatus: () => undefined,
        scheduleSovereigntyAutoRetry: () => {
            state.autoRetries += 1;
        },
        sovereigntyRuntimeFromNamespace: () => ({}),
        readChatNamespace: () => ({}),
        renderSovereigntyHealth: () => undefined,
        syncTaskCancelButtons: () => undefined,
    };
    vm.runInNewContext(`${code}\nthis.enqueueContinuity = enqueueContinuity;`, sandbox);
    return {
        enqueue: (options = {}) => sandbox.enqueueContinuity(expected.index, {
            expectedTarget: expected,
            ...options,
        }),
        gate,
        state,
    };
}

async function startP2Branches({
    observe,
    settleContinuityReceipt,
    settleActorReceipt,
    enqueueContinuity,
    waitAutomaticTargetSettled,
    enqueueVariable,
}) {
    const observation = await observe();
    await settleContinuityReceipt();
    await settleActorReceipt();
    const continuity = observation.persisted
        ? enqueueContinuity()
        : Promise.resolve({ status: 'failed' });
    const variable = waitAutomaticTargetSettled().then((settled) => (
        settled.status === 'settled' ? enqueueVariable() : settled
    ));
    return { continuity, variable };
}

async function startP2AfterSettlementDedupe({
    existingSettlement,
    waitExistingSettlement,
    createSettlementRecord,
    enqueueContinuity,
}) {
    const existing = existingSettlement();
    if (existing) return waitExistingSettlement(existing);
    const record = await createSettlementRecord();
    if (record.recoveredTerminal) return record.result;
    return { status: 'started', continuity: enqueueContinuity() };
}

test('MESSAGE_RECEIVED starts continuity after settlement registration without waiting for barrier or MVU stability', async () => {
    const handler = sourceSection(
        "types.MESSAGE_RECEIVED || 'message_received'",
        "types.MESSAGE_SWIPED || 'message_swiped'",
    );
    const observationAt = handler.indexOf('await observeSovereigntyTarget(captured)');
    const continuityReceiptAt = handler.indexOf('await settleContinuityInjectionReceipts(captured)');
    const actorReceiptAt = handler.indexOf('await settleActorLedgerInjectionReceipts(captured)');
    const continuityAt = handler.indexOf('const continuity =');
    const existingAt = handler.indexOf('const existingSettlement =');
    const createBarrierAt = handler.indexOf('const barrierRecord =');
    const recoveredTerminalAt = handler.indexOf('if (barrierRecord.recoveredTerminal)');
    const mvuWaitAt = handler.indexOf('waitAutomaticTargetSettled(captured)');
    assert.ok(observationAt < continuityReceiptAt);
    assert.ok(continuityReceiptAt < actorReceiptAt);
    assert.ok(actorReceiptAt < existingAt);
    assert.ok(existingAt < createBarrierAt);
    assert.ok(createBarrierAt < recoveredTerminalAt);
    assert.ok(recoveredTerminalAt < continuityAt);
    assert.ok(continuityAt < mvuWaitAt);
    assert.match(
        handler.slice(createBarrierAt, recoveredTerminalAt),
        /await createTargetSettlementRecord\(captured\)/u,
    );
    assert.doesNotMatch(
        handler.slice(createBarrierAt, continuityAt),
        /await barrierRecord\.ready/u,
    );
    assert.doesNotMatch(
        handler.slice(continuityAt, mvuWaitAt),
        /stateCommitting|waitAutomaticTargetSettled|isDuringExtraAnalysis|getMvuData/u,
    );

    const variableStable = deferred();
    const trace = [];
    const branches = await startP2Branches({
        observe: async () => {
            trace.push('observation-persisted');
            return { persisted: true };
        },
        settleContinuityReceipt: async () => trace.push('continuity-receipt-settled'),
        settleActorReceipt: async () => trace.push('actor-receipt-settled'),
        enqueueContinuity: async () => {
            trace.push('world-started');
            return { status: 'applied' };
        },
        waitAutomaticTargetSettled: () => {
            trace.push('mvu-stability-waiting-busy-and-changing');
            return variableStable.promise;
        },
        enqueueVariable: async () => {
            trace.push('variable-started');
            return { status: 'applied' };
        },
    });
    await branches.continuity;
    assert.deepEqual(trace, [
        'observation-persisted',
        'continuity-receipt-settled',
        'actor-receipt-settled',
        'world-started',
        'mvu-stability-waiting-busy-and-changing',
    ]);
    assert.equal(trace.includes('variable-started'), false);
    variableStable.resolve({ status: 'settled' });
    await branches.variable;
    assert.equal(trace.at(-1), 'variable-started');
});

test('pending and persisted-terminal settlement identities short-circuit before world launch', async () => {
    let starts = 0;
    const pending = await startP2AfterSettlementDedupe({
        existingSettlement: () => ({ state: 'captured', pending: true }),
        waitExistingSettlement: async () => ({ status: 'busy' }),
        createSettlementRecord: async () => {
            throw new Error('must not create a second settlement record');
        },
        enqueueContinuity: () => {
            starts += 1;
        },
    });
    assert.equal(pending.status, 'busy');
    assert.equal(starts, 0);

    const reloadedTerminal = await startP2AfterSettlementDedupe({
        existingSettlement: () => null,
        waitExistingSettlement: async () => ({ status: 'unexpected' }),
        createSettlementRecord: async () => ({
            recoveredTerminal: true,
            result: { status: 'settled', workflowStatus: 'recovered-terminal' },
        }),
        enqueueContinuity: () => {
            starts += 1;
        },
    });
    assert.equal(reloadedTerminal.status, 'settled');
    assert.equal(reloadedTerminal.workflowStatus, 'recovered-terminal');
    assert.equal(starts, 0);

    const capturedBarrier = deferred();
    let barrierPersisted = false;
    void capturedBarrier.promise.then(() => {
        barrierPersisted = true;
    });
    const fresh = await startP2AfterSettlementDedupe({
        existingSettlement: () => null,
        waitExistingSettlement: async () => ({ status: 'unexpected' }),
        createSettlementRecord: async () => ({
            recoveredTerminal: false,
            ready: capturedBarrier.promise,
        }),
        enqueueContinuity: () => {
            starts += 1;
            return Promise.resolve({ status: 'applied' });
        },
    });
    assert.equal(fresh.status, 'started');
    assert.equal(starts, 1);
    assert.equal((await fresh.continuity).status, 'applied');
    assert.equal(barrierPersisted, false);
    capturedBarrier.resolve();
    await capturedBarrier.promise;
});

test('world and variable branches remain parallel and failure-isolated', async () => {
    const worldGate = deferred();
    const repairGate = deferred();
    const trace = [];
    const branches = await startP2Branches({
        observe: async () => ({ persisted: true }),
        settleContinuityReceipt: async () => undefined,
        settleActorReceipt: async () => undefined,
        enqueueContinuity: async () => {
            trace.push('world-started');
            return worldGate.promise;
        },
        waitAutomaticTargetSettled: async () => ({ status: 'settled' }),
        enqueueVariable: async () => {
            trace.push('variable-started');
            return repairGate.promise;
        },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(trace, ['world-started', 'variable-started']);

    repairGate.resolve({ status: 'failed', reason: 'synthetic-variable-failure' });
    assert.equal((await branches.variable).status, 'failed');
    assert.deepEqual(trace, ['world-started', 'variable-started']);
    worldGate.resolve({ status: 'applied' });
    assert.equal((await branches.continuity).status, 'applied');

    const failedWorld = await startP2Branches({
        observe: async () => ({ persisted: true }),
        settleContinuityReceipt: async () => undefined,
        settleActorReceipt: async () => undefined,
        enqueueContinuity: async () => ({ status: 'failed', reason: 'synthetic-world-failure' }),
        waitAutomaticTargetSettled: async () => ({ status: 'settled' }),
        enqueueVariable: async () => ({ status: 'applied' }),
    });
    assert.equal((await failedWorld.continuity).status, 'failed');
    assert.equal((await failedWorld.variable).status, 'applied');
});

test('actual MVU busy and changing-fingerprint wait remains unresolved after world starts', async () => {
    const waitHarness = loadAutomaticWaitHarness();
    const target = makeTarget();
    let worldStarted = false;
    let variableStarted = false;
    const branches = await startP2Branches({
        observe: async () => ({ persisted: true }),
        settleContinuityReceipt: async () => undefined,
        settleActorReceipt: async () => undefined,
        enqueueContinuity: async () => {
            worldStarted = true;
            return { status: 'applied' };
        },
        waitAutomaticTargetSettled: () => waitHarness.wait(target),
        enqueueVariable: async () => {
            variableStarted = true;
            return { status: 'applied' };
        },
    });
    await branches.continuity;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(worldStarted, true);
    assert.equal(variableStarted, false);
    assert.ok(waitHarness.state.busyReads >= 1);
    assert.ok(waitHarness.state.fingerprintReads >= 1);

    waitHarness.release();
    const variableResult = await branches.variable;
    assert.equal(variableResult.status, 'busy');
    assert.equal(variableStarted, false);
    assert.ok(waitHarness.state.fingerprintReads >= 2);
});

test('mechanism-only edits preserve accepted fingerprint while narrative edits do not', () => {
    const { acceptedContentFingerprint } = loadAcceptedContentFunctions();
    const original = [
        '<content>北港守卫完成公开交接。</content>',
        '<UpdateVariable><Analysis>旧</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>',
        '<StatusPlaceHolderImpl/>',
    ].join('\n');
    const mechanismEdit = [
        '<content>北港守卫完成公开交接。</content>',
        '<UpdateVariable><Analysis>新</Analysis><JSONPatch>[{"op":"add","path":"/x","value":1}]</JSONPatch></UpdateVariable>',
        '<StatusPlaceHolderImpl/>',
    ].join('\n');
    const narrativeEdit = mechanismEdit.replace('完成公开交接', '取消公开交接');
    assert.equal(
        acceptedContentFingerprint(original),
        acceptedContentFingerprint(mechanismEdit),
    );
    assert.notEqual(
        acceptedContentFingerprint(original),
        acceptedContentFingerprint(narrativeEdit),
    );
});

test('accepted target matcher allows mechanism refresh but fails closed on narrative or identity drift', () => {
    const matches = loadAcceptedTargetMatcher();
    const target = makeTarget();
    assert.equal(matches(target, makeTarget({ fingerprint: 'whole-message-b' })), true);
    for (const changed of [
        { contentFingerprint: 'accepted-b' },
        { generationId: 'generation-b' },
        { branchId: 'branch-b' },
        { chatId: 'chat-b' },
        { messageId: 'message-b' },
        { swipeId: 1 },
    ]) {
        assert.equal(matches(target, makeTarget(changed)), false, JSON.stringify(changed));
    }
    const changedEpochMatches = loadAcceptedTargetMatcher(8);
    assert.equal(changedEpochMatches(target, makeTarget({ epoch: 8 })), false);
});

test('existing continuity queue dedupes event storms and performs zero writes for stale targets', async () => {
    const target = makeTarget();
    const storm = loadContinuityQueueHarness({ expected: target });
    const first = storm.enqueue();
    const duplicate = await storm.enqueue();
    assert.equal(duplicate.status, 'duplicate');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(storm.state.starts, 1);
    storm.gate.resolve();
    assert.equal((await first).status, 'applied');
    assert.equal(storm.state.writes, 1);

    const mechanism = loadContinuityQueueHarness({
        expected: target,
        fresh: makeTarget({ fingerprint: 'whole-message-after-mechanism-refresh' }),
        worldResult: { status: 'applied' },
    });
    assert.equal((await mechanism.enqueue()).status, 'applied');
    assert.equal(mechanism.state.starts, 1);

    for (const changed of [
        { contentFingerprint: 'accepted-b' },
        { generationId: 'generation-b' },
        { branchId: 'branch-b' },
        { chatId: 'chat-b' },
        { messageId: 'message-b' },
        { swipeId: 1 },
    ]) {
        const stale = loadContinuityQueueHarness({
            expected: target,
            fresh: makeTarget(changed),
        });
        const result = await stale.enqueue();
        assert.equal(result.status, 'stale', JSON.stringify(changed));
        assert.equal(stale.state.starts, 0, JSON.stringify(changed));
        assert.equal(stale.state.writes, 0, JSON.stringify(changed));
    }
});

test('Doctor keeps the external database outside its event and promise ownership', () => {
    const handler = sourceSection(
        "types.MESSAGE_RECEIVED || 'message_received'",
        "types.MESSAGE_SWIPED || 'message_swiped'",
    );
    assert.doesNotMatch(handler, /AutoCardUpdater|TavernDB|database-final-reply-bridge|thirdParty.*CRUD/iu);
    assert.doesNotMatch(handler, /waitForTargetSettled\([^)]*database|runAfterTargetSettled\([^)]*database/iu);
    assert.doesNotMatch(source, /integrations\/database-final-reply-bridge\.js/u);
});
