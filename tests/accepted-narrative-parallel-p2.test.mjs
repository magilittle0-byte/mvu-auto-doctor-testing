import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const lifecycleVmStubs = `
let generationLifecycleTrace = [];
let foregroundGenerationStarting = null;
let pendingAcceptedFinalSession = null;
let acceptedFinalDispatchInFlight = null;
let acceptedFinalDispatchChain = Promise.resolve();
const acceptedFinalDispatchPromises = new Map();
const acceptedFinalLaunchPromises = new Map();
function acceptedFinalDispatchKey(generation) {
    return generation ? [generation.chatId, generation.id, generation.epoch, generation.serial]
        .map((value) => String(value ?? '')).join(':') : '';
}
function acceptedFinalLaunchPromise(generation) {
    const key = acceptedFinalDispatchKey(generation);
    return key ? acceptedFinalLaunchPromises.get(key) || null : null;
}
function acceptedFinalContinuityStartBarrier(_session, task) { return task; }
function acceptedFinalSessionIsCurrent(generation) {
    const context = getContext();
    return !!generation
        && Number(generation.epoch) === Number(currentGenerationEpoch)
        && Number(generation.operationEpoch) === Number(operationEpoch)
        && String(context?.chatId || '') === String(generation.chatId || '')
        && String(lastGeneration?.id || '') === String(generation.id || '');
}
async function flushAcceptedFinalBeforeForegroundStart() {}
function fixedGenerationLifecycleReason(value) { return String(value || 'other'); }
function recordGenerationLifecycleTrace() {}
function runtimeGenerationSerialFloor() { return -1; }
function recordNextTurnConsumerInspection() {}
function preemptHostBackgroundModelControllersForForegroundGeneration() { return 0; }
function recordModelDiagnostic(entry) { globalThis.__doctorDiagnostics?.push(entry); }
function hydrateVariableRepairCenterStatus() {}
function hydrateDoctorRepairCenterStatus() {}
`;

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

const acceptedFinalFlushSource = sourceSection(
    'async function flushAcceptedFinalBeforeForegroundStart()',
    'function bindEvents()',
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function acceptedFinalQueueSandboxState() {
    const queue = {
        acceptedFinalDispatchInFlight: null,
        acceptedFinalDispatchChain: Promise.resolve(),
        acceptedFinalDispatchPromises: new Map(),
        acceptedFinalLaunchPromises: new Map(),
        pendingAcceptedFinalSession: null,
        foregroundGenerationStarting: null,
    };
    queue.acceptedFinalDispatchKey = (generation) => generation
        ? [generation.chatId, generation.id, generation.epoch, generation.serial]
            .map((value) => String(value ?? '')).join(':')
        : '';
    queue.acceptedFinalLaunchPromise = (generation) => {
        const key = queue.acceptedFinalDispatchKey(generation);
        return key ? queue.acceptedFinalLaunchPromises.get(key) || null : null;
    };
    queue.flushAcceptedFinalBeforeForegroundStart = async () => undefined;
    return queue;
}

function loadActorProfileRecoveryOutcomeFinalizer() {
    const code = sourceSection(
        'async function finalizeActorProfileRecoveryOutcome',
        'function compactActorProfileFailureCode',
    );
    const sandbox = {};
    vm.runInNewContext(`${code}\nthis.finalize = finalizeActorProfileRecoveryOutcome;`, sandbox);
    return sandbox.finalize;
}

function loadAcceptedContentFunctions() {
    const code = sourceSection(
        'function stripMechanism(text)',
        'function recentTranscript(context, targetIndex, limit)',
    );
    const sandbox = {
        STATUS_PLACEHOLDER: '<StatusPlaceHolderImpl/>',
        fingerprint: (value) => String(value),
        stripClosedProposals: (value) => String(value),
    };
    vm.runInNewContext(`${code}\nthis.acceptedContentText = acceptedContentText;\nthis.acceptedContentFingerprint = acceptedContentFingerprint;\nthis.sovereigntyNarrativeEligible = sovereigntyNarrativeEligible;`, sandbox);
    return sandbox;
}

function loadAcceptedFinalScopeDecision() {
    const code = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'function recordAcceptedFinalRejection(generation, reason)',
    );
    const sandbox = {};
    vm.runInNewContext(`${code}\nthis.acceptedFinalScopeDecision = acceptedFinalScopeDecision;`, sandbox);
    return sandbox.acceptedFinalScopeDecision;
}

function loadGenerationCandidateAllowed() {
    const code = sourceSection(
        'function generationCandidateAllowed(type, params, dryRun)',
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
    );
    const sandbox = {};
    vm.runInNewContext(`${code}\nthis.generationCandidateAllowed = generationCandidateAllowed;`, sandbox);
    return sandbox.generationCandidateAllowed;
}

test('R10 generation candidate rejection kinds remain precise and only host dry-run blocks', () => {
    const candidate = loadGenerationCandidateAllowed();
    const cases = [
        [null, {}, false, 'missing_type'],
        ['   ', {}, false, 'missing_type'],
        [{ type: 'normal' }, {}, false, 'unknown_type'],
        [[], {}, false, 'unknown_type'],
        [false, {}, false, 'unknown_type'],
        ['tool', {}, false, 'unknown_type'],
        ['normal', {}, true, 'dry_run'],
        ['normal', { quiet_prompt: 'silent' }, false, 'quiet_prompt'],
        ['normal', { is_impersonate: true }, false, 'impersonate'],
    ];
    for (const [type, params, dryRun, rejectionKind] of cases) {
        const result = candidate(type, params, dryRun);
        assert.equal(result.allowed, false, rejectionKind);
        assert.equal(result.rejectionKind, rejectionKind);
    }
    for (const type of ['normal', 'regenerate', 'swipe', 'continue']) {
        const result = candidate(type, {}, false);
        assert.equal(result.allowed, true, type);
        assert.equal(result.rejectionKind, '');
        assert.equal(result.generationType, type);
    }
    const missing = candidate(undefined, {}, false);
    assert.equal(missing.allowed, true);
    assert.equal(missing.rejectionKind, '');
    assert.equal(missing.generationType, 'normal');
    for (const params of [{ dryRun: true }, { dry_run: true }, { dryRun: true, dry_run: true }]) {
        const result = candidate('normal', params, false);
        assert.equal(result.allowed, true);
        assert.equal(result.rejectionKind, '');
        assert.equal(result.eventDryRun, false);
        assert.equal(result.optionDryRun, true);
    }
    const hostDryRun = candidate('normal', { dryRun: true }, true);
    assert.equal(hostDryRun.allowed, false);
    assert.equal(hostDryRun.rejectionKind, 'dry_run');
    assert.equal(hostDryRun.eventDryRun, true);
    assert.equal(hostDryRun.optionDryRun, true);
});

test('R10 rejected lifecycle starts remain ignored and create zero Doctor state', async () => {
    const candidate = sourceSection(
        'function generationCandidateAllowed(type, params, dryRun)',
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
    );
    const rejection = sourceSection(
        'function recordAcceptedFinalRejection(generation, reason)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const cases = [
        [null, {}, false, 'missing_type'],
        ['   ', {}, false, 'missing_type'],
        [{ type: 'normal' }, {}, false, 'unknown_type'],
        ['tool', {}, false, 'unknown_type'],
        ['normal', {}, true, 'dry_run'],
        ['normal', { quiet_prompt: 'silent' }, false, 'quiet_prompt'],
        ['normal', { is_impersonate: true }, false, 'impersonate'],
    ];
    for (const [type, params, dryRun, reason] of cases) {
        const state = {
            callbacks: new Map(), p4: 0, model: 0, identity: 0, tasks: 0, busy: 0,
            statuses: 0, namespaceWrites: 0,
        };
        const sandbox = {
            currentGenerationEpoch: 0, operationEpoch: 0, generationSerial: 0,
            activeGenerationSession: null, activeNextTurnConsumer: null,
            lastGeneration: { id: '', type: 'normal', dryRun: false },
            pendingAcceptedFinalTimer: null, lastInjectionInspection: {}, continuationIdentityHint: null,
            getContext: () => ({
                chatId: 'chat-a', chat: [],
                eventTypes: { GENERATION_STARTED: 'generation_started' },
                eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
            }),
            acceptedFinalSessionIsCurrent: (generation) => generation === sandbox.activeGenerationSession,
            acceptedFinalSnapshot: () => ({ contentFingerprint: 'before' }),
            invalidateOperations: () => { sandbox.operationEpoch += 1; },
            resetCurrentModelCallStats: () => { state.model += 1; },
            precomposeNextTurnConsumer: async () => { state.p4 += 1; },
            ensureAcceptedFinalTargetIdentity: () => { state.identity += 1; },
            enqueueActorProfiles: () => { state.tasks += 1; },
            enqueueContinuity: () => { state.tasks += 1; },
            writeChatNamespace: () => { state.namespaceWrites += 1; },
            setStatus: () => { state.statuses += 1; },
            setBusy: () => { state.busy += 1; },
            setTimeout: () => 1, clearTimeout: () => undefined,
            Date: { now: () => 7 }, Math,
        };
        vm.runInNewContext(
            `${lifecycleVmStubs}\n${candidate}\n${rejection}\n${bind}\nthis.bindEvents = bindEvents;`,
            sandbox,
        );
        sandbox.bindEvents();
        await state.callbacks.get('generation_started')(type, params, dryRun);
        assert.equal(sandbox.activeGenerationSession, null, reason);
        assert.equal(sandbox.lastGeneration.id, '', reason);
        assert.equal(sandbox.currentGenerationEpoch, 0, reason);
        assert.equal(state.p4, 0, reason);
        assert.equal(state.model, 0, reason);
        assert.equal(state.identity, 0, reason);
        assert.equal(state.tasks, 0, reason);
        assert.equal(state.busy, 0, reason);
        assert.equal(state.statuses, 0, reason);
        assert.equal(state.namespaceWrites, 0, reason);
    }
});

test('R10 host preflight cannot consume the following real generation session', async () => {
    await runCleanupFailedAcceptedFinalLifecycle({
        type: 'normal', useProductionCandidate: true, hostPreflight: true,
    });
});

test('R9 default opening keeps Doctor inert and rejection traces stay diagnostic-only', () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const trace = sourceSection(
        'function recordGenerationLifecycleTrace(code, {',
        'function generationLifecycleTraceDiagnosticProjection(context = getContext())',
    );
    const rejection = sourceSection(
        'function recordAcceptedFinalRejection(generation, reason)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    assert.match(bind, /GENERATION_STARTED/u);
    assert.doesNotMatch(bind, /MESSAGE_RECEIVED|MESSAGE_SWIPED/u);
    assert.match(rejection, /recordGenerationLifecycleTrace\('rejected'/u);
    assert.match(rejection, /record:\s*false/u);
    assert.doesNotMatch(
        `${trace}\n${rejection}`,
        /writeChatNamespace|recordOperation|scheduleOperationLogSave|\.mes|secret|credential/iu,
    );
});

test('R9 rejection status and trace expose the exact fixed rejection kind', () => {
    const rejection = sourceSection(
        'function recordAcceptedFinalRejection(generation, reason)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const state = { statuses: [], traces: [], writes: 0, operations: 0 };
    const generation = {
        chatId: 'chat-a', epoch: 3, operationEpoch: 5, serial: 7, type: '', id: 'generation-a',
    };
    const sandbox = {
        acceptedFinalSessionIsCurrent: (value) => value === generation,
        fixedGenerationLifecycleReason: (value) => value,
        setStatus: (...args) => state.statuses.push(args),
        recordGenerationLifecycleTrace: (...args) => state.traces.push(args),
        writeChatNamespace: () => { state.writes += 1; },
        recordOperation: () => { state.operations += 1; },
    };
    vm.runInNewContext(`${rejection}\nthis.record = recordAcceptedFinalRejection;`, sandbox);
    sandbox.record(generation, 'missing_type');
    assert.equal(state.statuses.length, 1);
    assert.match(state.statuses[0][0], /missing_type$/u);
    assert.deepEqual({ ...state.statuses[0][2] }, { record: false });
    assert.equal(state.traces.length, 1);
    assert.equal(state.traces[0][0], 'rejected');
    assert.equal(state.traces[0][1].reason, 'missing_type');
    assert.equal(state.writes, 0);
    assert.equal(state.operations, 0);
});

test('R9 default opening without a generation lifecycle does zero Doctor work', () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = {
        callbacks: new Map(), p4: 0, accepted: 0, writes: 0, operations: 0, statuses: 0, modelStats: 0,
    };
    const sandbox = {
        activeGenerationSession: null,
        activeNextTurnConsumer: null,
        currentGenerationEpoch: 0,
        operationEpoch: 0,
        generationSerial: 0,
        lastGeneration: { id: '', type: 'normal', dryRun: false },
        pendingAcceptedFinalTimer: null,
        pendingChatSaveTimer: null,
        pendingOperationLogSaveTimer: null,
        getContext: () => ({
            chatId: 'new-chat',
            eventTypes: {
                GENERATION_STARTED: 'generation_started',
                GENERATION_STOPPED: 'generation_stopped',
                GENERATION_ENDED: 'generation_ended',
                CHAT_CHANGED: 'chat_changed',
            },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        precomposeNextTurnConsumer: async () => { state.p4 += 1; },
        acceptFinalGeneration: async () => { state.accepted += 1; },
        writeChatNamespace: async () => { state.writes += 1; },
        recordOperation: () => { state.operations += 1; },
        setStatus: () => { state.statuses += 1; },
        resetCurrentModelCallStats: () => { state.modelStats += 1; },
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${bind}\nthis.bindEvents = bindEvents;`, sandbox);
    sandbox.bindEvents();
    assert.equal(sandbox.activeGenerationSession, null);
    assert.equal(state.p4, 0);
    assert.equal(state.accepted, 0);
    assert.equal(state.writes, 0);
    assert.equal(state.operations, 0);
    assert.equal(state.statuses, 0);
    assert.equal(state.modelStats, 0);
});

function loadAcceptedFinalRuntimeHarness({
    placementScope = '',
    scopeChangesAfterCommit = false,
    generationEligible = true,
    currentEpoch = 7,
    currentOperationEpoch = 11,
    chatId = 'chat-a',
    narrativeEligible = true,
    dispatchGate = null,
} = {}) {
    const identity = sourceSection(
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
        'function acceptedFinalEnvelopeMatchesContext(context, envelope, session)',
    );
    const support = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    const state = {
        scope: { chatId, cardId: 'character:card-a', runtimeVersion: 'rc14' },
        currentChatId: chatId,
        identitySaves: 0,
        dispatches: [],
        releases: [],
        statuses: [],
        operationWrites: 0,
        committed: false,
        commitCalls: 0,
        dispatchEntered: false,
    };
    const message = {
        mes: '<content>真实自然正文：林舟把钥匙放在桌上，转身等候答复。</content>',
        swipe_id: 0,
    };
    state.message = message;
    const generation = {
        id: 'generation-a',
        serial: 3,
        type: 'normal',
        epoch: currentEpoch,
        operationEpoch: currentOperationEpoch,
        chatId,
        start: { contentFingerprint: 'before' },
        stopped: false,
        acceptedFinalEligible: generationEligible,
        p4PlacementScopeDigest: placementScope,
        frozenScopeDigest: placementScope,
    };
    const sandbox = {
        currentGenerationEpoch: currentEpoch,
        operationEpoch: currentOperationEpoch,
        lastGeneration: generation,
        getContext: () => ({ chatId: state.currentChatId, chat: [message] }),
        document: { body: { dataset: {} } },
        currentFinalAssistant: () => ({ index: 0, message }),
        sovereigntyNarrativeEligible: () => narrativeEligible,
        acceptedContentFingerprint: () => 'after',
        resolveCurrentActorSovereigntyScope: async () => {
            return { resolved: true, scope: state.scope };
        },
        currentActorSovereigntyScope: () => state.scope,
        actorSovereigntyScopeDigest: (scope) => `${scope.chatId}|${scope.cardId}|${scope.runtimeVersion}`,
        actorSovereigntyScopesMatch: (left, right) => (
            left.chatId === right.chatId
            && left.cardId === right.cardId
            && left.runtimeVersion === right.runtimeVersion
        ),
        createActorSovereigntyScope: (scope) => ({ ...scope }),
        ensureMessageStableId: () => 'message-0',
        currentSwipeInfo: () => null,
        isPlainObject: (value) => !!value && typeof value === 'object'
            && !Array.isArray(value),
        scheduleSafeChatSave: () => { state.identitySaves += 1; },
        commitNextTurnConsumer: async () => {
            state.commitCalls += 1;
            state.committed = true;
            if (scopeChangesAfterCommit) {
                state.scope = { ...state.scope, runtimeVersion: 'rc14-changed' };
            }
            return true;
        },
        acceptedFinalContinuityStartBarrier: (_session, task) => task,
        releaseNextTurnConsumer: async (_session, reason, options) => {
            state.releases.push({ reason, options });
            return true;
        },
        dispatchAcceptedFinal: async (envelope) => {
            state.dispatchEntered = true;
            if (dispatchGate) await dispatchGate.promise;
            state.dispatches.push(envelope);
        },
        setStatus: (text, kind, options) => state.statuses.push({ text, kind, options }),
        recordOperation: () => { state.operationWrites += 1; },
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${identity}\n${support}\n${accept}\nthis.acceptFinalGeneration = acceptFinalGeneration;\nthis.getAcceptedFinalDispatchInFlight = () => acceptedFinalDispatchInFlight;`, sandbox);
    return { state, generation, accept: sandbox.acceptFinalGeneration, sandbox };
}

function loadAcceptedFinalFullDispatchHarness({
    profileResult = { status: 'not_completed' },
    realCleanupFailed = false,
    zeroWriteWorldRace = false,
    settledZeroWriteWorldStaleStarts = 0,
    otherModuleResult = { status: 'not_completed' },
    ticketOnlyP4Pending = false,
} = {}) {
    const support = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'function dispatchAcceptedFinal(envelope)',
    );
    const dispatch = sourceSection(
        'function dispatchAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    const barrierChoice = sourceSection(
        'function acceptedFinalContinuityStartBarrier(session, p4SettleTask)',
        'function continuityStateForInjection(namespace, { isReroll = false } = {})',
    );
    const ensureCleanup = realCleanupFailed ? sourceSection(
        'async function ensureNextTurnConsumerSlotCleaned(session, active, reason)',
        'async function releaseNextTurnConsumer(session, reason = \'released\'',
    ) : '';
    const commitConsumer = realCleanupFailed ? sourceSection(
        'async function commitNextTurnConsumer(session, envelope)',
        'function continuityStateForInjection(namespace, { isReroll = false } = {})',
    ) : '';
    const state = {
        scope: { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
        dispatchedTargets: [],
        errors: [],
        profileTargets: [],
        continuityCalls: [],
        worldModelCalls: 0,
        worldWrites: 0,
        continuityProfileRetrySignals: new Map(),
        worldLaunched: false,
        diagnostics: [],
        worldStarts: 0,
        releaseInitialWorld: null,
        settledZeroWriteWorldStaleStarts,
        releaseTicketOnlyP4: null,
    };
    const continuityPendingKeys = new Map();
    let initialWorldTask = null;
    const message = {
        mes: '<content>真实自然正文：林舟把钥匙放在桌上，转身等候答复。</content>',
        swipe_id: 0,
    };
    const generation = {
        id: 'generation-a', serial: 3, type: 'normal', epoch: 7, operationEpoch: 11,
        chatId: 'chat-a', start: { contentFingerprint: 'before' },
        acceptedFinalEligible: true, stopped: false,
    };
    const capture = (_context, index, { frozenScope } = {}) => ({
        chatId: 'chat-a', index, messageId: 'message-0', swipeId: 0,
        generationId: 'generation-a', generationSerial: 3,
        contentFingerprint: 'after', scopeDigest: 'chat-a|character:card-a|rc14',
        actorSovereigntyScope: { ...(frozenScope || state.scope) }, epoch: 11,
    });
    const captureUse = (target) => {
        state.dispatchedTargets.push(target);
        return Promise.resolve(otherModuleResult);
    };
    const sandbox = {
        currentGenerationEpoch: 7, operationEpoch: 11, lastGeneration: generation,
        getContext: () => ({ chatId: 'chat-a', chat: [message] }),
        document: { body: { dataset: {} } },
        currentFinalAssistant: () => ({ index: 0, message }),
        latestAiMessage: () => ({ index: 0, message }),
        sovereigntyNarrativeEligible: () => true,
        acceptedContentFingerprint: () => 'after',
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: state.scope }),
        currentActorSovereigntyScope: () => state.scope,
        actorSovereigntyScopeDigest: (scope) => `${scope.chatId}|${scope.cardId}|${scope.runtimeVersion}`,
        actorSovereigntyScopesMatch: (left, right) => left.chatId === right.chatId
            && left.cardId === right.cardId && left.runtimeVersion === right.runtimeVersion,
        createActorSovereigntyScope: (scope) => ({ ...scope }),
        captureTarget: capture,
        ensureAcceptedFinalTargetIdentity: (_context, _message, index, _session, options) => ({
            chatId: 'chat-a', index, messageId: 'message-0', swipeId: 0,
            generationId: 'generation-a', generationSerial: 3, generationType: 'normal',
            contentFingerprint: 'after', epoch: 7, operationEpoch: 11, ...options,
        }),
        releaseNextTurnConsumer: async () => true,
        enqueue: (_index, options) => captureUse(options.queuedTarget),
        enqueueOpeningResourceSync: (_index, options) => captureUse(options.expectedTarget),
        runSocialAuditTarget: captureUse,
        enqueueForum: (_index, options) => captureUse(options.expectedTarget),
        enqueueActorProfiles: (_index, options) => {
            state.dispatchedTargets.push(options.expectedTarget);
            state.profileTargets.push(options.expectedTarget);
            return settledZeroWriteWorldStaleStarts > 0
                ? new Promise((resolve) => setImmediate(() => resolve(profileResult)))
                : Promise.resolve(profileResult);
        },
        enqueueContinuity: (_index, options) => {
            state.dispatchedTargets.push(options.expectedTarget);
            state.continuityCalls.push({
                target: options.expectedTarget,
                noActorPermit: options.noActorPermit || null,
                startBarrier: options.startBarrier || null,
            });
            if (state.settledZeroWriteWorldStaleStarts > 0) {
                const key = 'stage3-key';
                if (continuityPendingKeys.has(key)) return continuityPendingKeys.get(key);
                state.worldStarts += 1;
                state.settledZeroWriteWorldStaleStarts -= 1;
                const settled = Promise.resolve({
                    status: 'stale',
                    reason: 'world_phase1_actor_ledger_changed',
                    validationCode: 'world.stale.actor_ledger_changed',
                    module: 'world',
                    zeroWrite: true,
                    worldModelCalls: 0,
                }).finally(() => continuityPendingKeys.delete(key));
                continuityPendingKeys.set(key, settled);
                return settled;
            }
            if (zeroWriteWorldRace) {
                const key = 'stage3-key';
                if (continuityPendingKeys.has(key)) return continuityPendingKeys.get(key);
                state.worldStarts += 1;
                if (!initialWorldTask) {
                    initialWorldTask = new Promise((resolve) => {
                        state.releaseInitialWorld = () => resolve({
                            status: 'stale',
                            reason: 'world_task_owner_changed',
                            validationCode: 'world.stale.owner_changed',
                            module: 'world',
                            zeroWrite: true,
                            worldModelCalls: 0,
                        });
                    }).finally(() => continuityPendingKeys.delete(key));
                    continuityPendingKeys.set(key, initialWorldTask);
                    return initialWorldTask;
                }
                state.worldModelCalls += 1;
                state.worldWrites += 1;
                return Promise.resolve({
                    status: 'applied', module: 'world', readbackVerified: true,
                });
            }
            if (state.worldLaunched) return Promise.resolve({ status: 'duplicate' });
            state.worldLaunched = true;
            state.worldStarts += 1;
            state.worldModelCalls += 1;
            state.worldWrites += 1;
            return Promise.resolve({ status: 'applied' });
        },
        continuityPendingKeys,
        continuityProfileRetrySignals: state.continuityProfileRetrySignals,
        stage3AcceptedTargetKey: () => 'stage3-key',
        stage3TargetIsCurrent: () => ({ ok: true }),
        operationToken: () => ({ epoch: 11 }),
        safeDiagnosticReason: (value) => String(value || ''),
        recordStage3WorldFinalDiagnostic: () => undefined,
        recordOperation: (...args) => state.errors.push(args),
        setStatus: () => undefined,
        __doctorDiagnostics: state.diagnostics,
        activeNextTurnConsumer: {
            generationId: generation.id,
            worldPackage: !ticketOnlyP4Pending,
        },
        ...(realCleanupFailed ? {
            activeGenerationSession: generation,
            activeNextTurnConsumer: { generationId: generation.id, cleanupConfirmed: false },
            lastInjectionInspection: {},
            readChatNamespace: () => ({
                continuity: {
                    nextTurnInjection: {
                        consumerLease: { state: 'cleanup_failed', generationId: generation.id },
                    },
                },
            }),
            nextTurnLeaseCleanupBlocked: () => true,
        } : {
            commitNextTurnConsumer: () => {
                if (!ticketOnlyP4Pending) return Promise.resolve(true);
                return new Promise((resolve) => {
                    state.releaseTicketOnlyP4 = (value = true) => resolve(value);
                });
            },
        }),
    };
    vm.runInNewContext(
        `${lifecycleVmStubs}\n${support}\n${dispatch}\n${barrierChoice}\n${accept}\n${ensureCleanup}\n${commitConsumer}\nthis.acceptFinalGeneration = acceptFinalGeneration;`,
        sandbox,
    );
    return { state, generation, accept: sandbox.acceptFinalGeneration };
}

test('actual accepted-final path freezes scope before identity and dispatches only while that scope remains current', async () => {
    const fresh = loadAcceptedFinalRuntimeHarness();
    assert.equal(await fresh.accept(fresh.generation), true);
    assert.equal(fresh.state.identitySaves, 1);
    assert.equal(fresh.state.dispatches.length, 1);
    assert.equal(
        fresh.state.dispatches[0].scopeDigest,
        'chat-a|character:card-a|rc14',
    );
    assert.deepEqual(
        { ...fresh.state.dispatches[0].actorSovereigntyScope },
        { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
    );
    assert.equal(fresh.generation.acceptedFinalEligible, false);
    assert.equal(
        fresh.sandbox.lastGeneration?.id,
        'generation-a',
    );
    assert.equal(
        fresh.state.message.extra?.mvu_auto_doctor_generation_id,
        'generation-a',
    );
    assert.equal(
        fresh.state.message.extra?.mvu_auto_doctor_generation_serial,
        3,
    );
    assert.equal(
        fresh.state.message.extra?.mvu_auto_doctor_generation_type,
        'normal',
    );

    const p4Stale = loadAcceptedFinalRuntimeHarness({ placementScope: 'other-scope' });
    assert.equal(await p4Stale.accept(p4Stale.generation), false);
    assert.equal(p4Stale.state.identitySaves, 0);
    assert.equal(p4Stale.state.dispatches.length, 0);

    const scopeChanged = loadAcceptedFinalRuntimeHarness({ scopeChangesAfterCommit: true });
    assert.equal(await scopeChanged.accept(scopeChanged.generation), true);
    assert.equal(scopeChanged.state.identitySaves, 1);
    assert.equal(scopeChanged.state.dispatches.length, 1);
});

test('accepted-final keeps its management exclusion through the post-P4 scope gap until P1/P3 dispatch', async () => {
    const gate = deferred();
    const runtime = loadAcceptedFinalRuntimeHarness({ dispatchGate: gate });
    const accepting = runtime.accept(runtime.generation);
    for (let attempt = 0; attempt < 20 && !runtime.state.dispatchEntered; attempt += 1) {
        await Promise.resolve();
    }
    assert.equal(runtime.state.dispatchEntered, true, 'accepted-final must reach its module launch barrier');
    const inFlight = runtime.sandbox.getAcceptedFinalDispatchInFlight();
    assert.equal(inFlight?.chatId, 'chat-a');
    assert.equal(inFlight?.generationId, 'generation-a');
    assert.equal(runtime.state.dispatches.length, 0, 'dispatch is still waiting on the fresh scope');
    gate.resolve();
    assert.equal(await accepting, true);
    assert.equal(runtime.state.dispatches.length, 1);
    assert.equal(runtime.sandbox.getAcceptedFinalDispatchInFlight(), null);
});

test('accepted-final serializes a new chat behind a stale in-flight session without dropping it', async () => {
    const gate = deferred();
    const runtime = loadAcceptedFinalRuntimeHarness({ dispatchGate: gate });
    const acceptingA = runtime.accept(runtime.generation);
    for (let attempt = 0; attempt < 20 && !runtime.state.dispatchEntered; attempt += 1) {
        await Promise.resolve();
    }
    assert.equal(runtime.state.dispatchEntered, true);

    const generationB = {
        ...runtime.generation,
        id: 'generation-b',
        serial: 4,
        epoch: 8,
        operationEpoch: 12,
        chatId: 'chat-b',
        acceptedFinalEligible: true,
    };
    runtime.state.currentChatId = 'chat-b';
    runtime.state.scope = {
        chatId: 'chat-b',
        cardId: 'character:card-b',
        runtimeVersion: 'rc14',
    };
    runtime.sandbox.currentGenerationEpoch = generationB.epoch;
    runtime.sandbox.operationEpoch = generationB.operationEpoch;
    runtime.sandbox.lastGeneration = generationB;
    const acceptingB = runtime.accept(generationB);

    let bSettled = false;
    void acceptingB.finally(() => { bSettled = true; });
    await Promise.resolve();
    assert.equal(bSettled, false, 'the new chat must queue instead of being dropped');
    gate.resolve();

    assert.equal(await acceptingA, true, 'the already-launched old dispatch settles before the queue advances');
    assert.equal(await acceptingB, true, 'the queued current chat is revalidated and dispatched');
    assert.equal(runtime.state.commitCalls, 2);
    assert.deepEqual(
        runtime.state.dispatches.map((entry) => entry.generationId),
        ['generation-a', 'generation-b'],
    );
});

test('accepted-final serializes the next same-chat generation and dispatches it once', async () => {
    const gate = deferred();
    const runtime = loadAcceptedFinalRuntimeHarness({ dispatchGate: gate });
    const acceptingA = runtime.accept(runtime.generation);
    for (let attempt = 0; attempt < 20 && !runtime.state.dispatchEntered; attempt += 1) {
        await Promise.resolve();
    }
    assert.equal(runtime.state.dispatchEntered, true);

    const generationB = {
        ...runtime.generation,
        id: 'generation-a-next',
        serial: 4,
        epoch: 8,
        operationEpoch: 12,
        acceptedFinalEligible: true,
    };
    runtime.sandbox.currentGenerationEpoch = generationB.epoch;
    runtime.sandbox.operationEpoch = generationB.operationEpoch;
    runtime.sandbox.lastGeneration = generationB;
    const acceptingB = runtime.accept(generationB);
    gate.resolve();

    assert.equal(await acceptingA, true);
    assert.equal(await acceptingB, true);
    assert.equal(runtime.state.commitCalls, 2);
    assert.deepEqual(
        runtime.state.dispatches.map((entry) => entry.generationId),
        ['generation-a', 'generation-a-next'],
    );
});

test('accepted-final joins duplicate delivery of the same generation', async () => {
    const gate = deferred();
    const runtime = loadAcceptedFinalRuntimeHarness({ dispatchGate: gate });
    const first = runtime.accept(runtime.generation);
    const duplicate = runtime.accept(runtime.generation);
    for (let attempt = 0; attempt < 20 && !runtime.state.dispatchEntered; attempt += 1) {
        await Promise.resolve();
    }
    assert.equal(runtime.state.dispatchEntered, true);
    gate.resolve();

    assert.equal(await first, true);
    assert.equal(await duplicate, true);
    assert.equal(runtime.state.commitCalls, 1);
    assert.equal(runtime.state.dispatches.length, 1);
});

test('runtime fingerprint binds accepted-final keying, foreground flush, and unlocked authority gates', () => {
    const runtimeSource = sourceSection(
        'function doctorRuntimeCriticalFingerprint()',
        'function diagnosticPayload()',
    );
    const critical = [
        'acceptedFinalDispatchKey',
        'acceptedFinalLaunchPromise',
        'acceptedFinalContinuityStartBarrier',
        'flushAcceptedFinalBeforeForegroundStart',
        'acceptFinalGenerationUnlocked',
        'stage3AwaitAcceptedFinalP4Barrier',
        'wakeContinuityAfterProfileTerminal',
        'stage3StaleValidationCode',
        'stage3ZeroWriteStaleResult',
    ];
    for (const helper of critical) {
        assert.match(runtimeSource, new RegExp(`${helper}\\.toString\\(\\)`, 'u'));
    }
    const helperNames = [...new Set([
        ...runtimeSource.matchAll(/\b([A-Za-z_$][\w$]*)\.toString\(\)/gu),
    ].map((match) => match[1]))];
    const digest = (value) => {
        let hash = 2166136261;
        for (const char of String(value)) {
            hash ^= char.codePointAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    };
    const runtimeFor = (overrides = {}) => Function(
        'VERSION',
        'fingerprint',
        'actorProfileRecoveryCriticalFingerprint',
        'actorProfileGenerationCriticalFingerprint',
        'actorProfileBatchSemanticFingerprint',
        'actorAuthorityAdjudicationSemanticFingerprint',
        'continuityCoreSemanticFingerprint',
        'variableRepairCenterSemanticFingerprint',
        'doctorRepairCenterSemanticFingerprint',
        ...helperNames,
        `${runtimeSource}; return doctorRuntimeCriticalFingerprint;`,
    )(
        'test-version', digest,
        () => 'recovery', () => 'generation', () => 'batch', () => 'authority',
        () => 'continuity', () => 'variable-repair', () => 'doctor-repair',
        ...helperNames.map((name) => overrides[name]
            || Function(`return function ${name}(){}`)()),
    )();
    const baseline = runtimeFor();
    for (const helper of critical) {
        assert.notEqual(runtimeFor({
            [helper]: Function(`return function ${helper}Changed(){ return 'changed'; }`)(),
        }), baseline, helper);
    }
});

test('P3 production start barrier waits for accepted-final P4 settlement before world work can run', async () => {
    const barrierSource = sourceSection(
        'async function stage3AwaitAcceptedFinalP4Barrier(startBarrier)',
        'async function enqueueContinuity(targetId, {',
    );
    const sandbox = {};
    vm.runInNewContext(
        `${barrierSource}\nthis.waitForP4 = stage3AwaitAcceptedFinalP4Barrier;`,
        sandbox,
    );
    const gate = deferred();
    let passed = false;
    const waiting = sandbox.waitForP4(gate.promise).then(() => { passed = true; });
    await Promise.resolve();
    assert.equal(passed, false);
    gate.resolve(false);
    await waiting;
    assert.equal(passed, true, 'P3 proceeds after either P4 success or isolated P4 failure settles');
});

test('accepted-final P3 barrier is required only for a verified prior world package', () => {
    const helperSource = sourceSection(
        'function acceptedFinalContinuityStartBarrier(session, p4SettleTask)',
        'function continuityStateForInjection(namespace, { isReroll = false } = {})',
    );
    const settle = Promise.resolve(true);
    const sandbox = {
        activeNextTurnConsumer: {
            generationId: 'generation-a',
            worldPackage: false,
        },
    };
    vm.runInNewContext(
        `${helperSource}\nthis.choose = acceptedFinalContinuityStartBarrier;`,
        sandbox,
    );
    assert.equal(
        sandbox.choose({ id: 'generation-a' }, settle),
        null,
        'ticket-only cleanup cannot block P3',
    );
    sandbox.activeNextTurnConsumer.worldPackage = true;
    assert.equal(
        sandbox.choose({ id: 'generation-a' }, settle),
        settle,
        'a verified prior world package keeps the consume-before-produce barrier',
    );
    assert.equal(
        sandbox.choose({ id: 'generation-b' }, settle),
        null,
        'a foreign generation never owns the current P3 barrier',
    );
});

test('provider error placeholders release P4 and never become accepted narrative', async () => {
    const { sovereigntyNarrativeEligible } = loadAcceptedContentFunctions();
    const providerError = [
        '[API 错误]',
        'Custom OpenAI endpoint failed with status 502: Resource has been exhausted.',
        '',
        '<StatusPlaceHolderImpl/>',
    ].join('\n');
    assert.equal(sovereigntyNarrativeEligible(providerError), false);
    assert.equal(
        sovereigntyNarrativeEligible('<content>她说明刚才的 API 错误已经恢复，随后继续前行。</content>'),
        true,
        'ordinary narrative may discuss an API error without becoming a provider placeholder',
    );

    const rejected = loadAcceptedFinalRuntimeHarness({
        narrativeEligible: false,
        placementScope: 'chat-a|character:card-a|rc14',
    });
    assert.equal(await rejected.accept(rejected.generation), false);
    assert.equal(rejected.state.identitySaves, 0);
    assert.equal(rejected.state.dispatches.length, 0);
    assert.deepEqual(
        rejected.state.releases.map((entry) => entry.reason),
        ['narrative_ineligible'],
        'the reserved P4 consumer is released instead of consumed by an error placeholder',
    );
});

test('accepted-final dispatch gives variables, P3, and P1 the same frozen target', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness();
    assert.equal(await runtime.accept(runtime.generation), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.state.dispatchedTargets.length, 4);
    assert.equal(runtime.state.continuityCalls.length, 2);
    assert.equal(
        typeof runtime.state.continuityCalls[0].startBarrier?.then,
        'function',
        'P3 is attached immediately but receives the exact P4 settlement barrier',
    );
    for (const target of runtime.state.dispatchedTargets) {
        assert.equal(target.scopeDigest, 'chat-a|character:card-a|rc14');
        assert.deepEqual(
            { ...target.actorSovereigntyScope },
            { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
        );
    }
    assert.deepEqual(runtime.state.errors, []);
});

test('real P4 cleanup_failed commit returns false but accepted-final still dispatches variable P1 and P3', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness({ realCleanupFailed: true });
    assert.equal(await runtime.accept(runtime.generation), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.state.dispatchedTargets.length, 4);
    assert.equal(runtime.state.profileTargets.length, 1);
    assert.equal(runtime.state.continuityCalls.length, 2);
    assert.equal(runtime.state.worldModelCalls, 1);
    assert.equal(runtime.state.worldWrites, 1);
    assert.ok(runtime.state.dispatchedTargets.every((target) => (
        target.scopeDigest === 'chat-a|character:card-a|rc14'
    )));
});

test('a P1 not-completed result grants no retry permit but cannot block independent P3', async () => {
    const flushDispatch = async (runtime) => {
        assert.equal(await runtime.accept(runtime.generation), true);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
    };

    const incomplete = loadAcceptedFinalFullDispatchHarness({
        profileResult: {
            status: 'not_completed',
            persistenceStatus: 'not_completed',
            readbackVerified: true,
            accepted: [{ actorId: 'NPC-successful-peer' }],
        },
    });
    await flushDispatch(incomplete);
    assert.equal(incomplete.state.profileTargets.length, 1);
    assert.equal(incomplete.state.continuityCalls.length, 2);
    assert.equal(incomplete.state.worldModelCalls, 1);
    assert.equal(incomplete.state.worldWrites, 1);
    assert.equal(incomplete.state.continuityCalls.every((call) => call.noActorPermit === null), true);
    assert.equal(incomplete.state.errors.length, 0);
    assert.equal(incomplete.state.continuityProfileRetrySignals.size, 0);

    const atomic = loadAcceptedFinalFullDispatchHarness({
        profileResult: { status: 'atomic_readback' },
    });
    await flushDispatch(atomic);
    assert.equal(atomic.state.continuityCalls.length, 2);
    assert.equal(atomic.state.continuityProfileRetrySignals.size, 0);
    assert.equal(atomic.state.continuityCalls.every((call) => call.noActorPermit === null), true);

    const noCandidates = loadAcceptedFinalFullDispatchHarness({
        profileResult: { status: 'no_candidates' },
    });
    await flushDispatch(noCandidates);
    assert.equal(noCandidates.state.continuityCalls.length, 2);
    assert.equal(noCandidates.state.continuityProfileRetrySignals.size, 0);
    assert.equal(noCandidates.state.continuityCalls.filter((call) => (
        call.noActorPermit?.status === 'no_candidates'
    )).length, 1);
    assert.equal(noCandidates.state.worldModelCalls, 1);
    assert.equal(noCandidates.state.worldWrites, 1);
});

test('ticket-only P4 cleanup may remain pending while a not-completed P1 still launches structural P3', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness({
        profileResult: {
            status: 'not_completed',
            persistenceStatus: 'not_completed',
            readbackVerified: false,
            reason: 'profile_block_missing',
        },
        ticketOnlyP4Pending: true,
        otherModuleResult: { status: 'applied' },
    });
    let acceptedSettled = false;
    const accepting = runtime.accept(runtime.generation)
        .finally(() => { acceptedSettled = true; });
    for (let attempt = 0; attempt < 20 && runtime.state.worldModelCalls === 0; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(acceptedSettled, false, 'the synthetic ticket-only cleanup is intentionally still pending');
    assert.equal(runtime.state.continuityCalls[0].startBarrier, null);
    assert.equal(runtime.state.worldModelCalls, 1);
    assert.equal(runtime.state.worldWrites, 1);
    assert.equal(typeof runtime.state.releaseTicketOnlyP4, 'function');
    runtime.state.releaseTicketOnlyP4(true);
    assert.equal(await accepting, true);
});

test('a durable no-candidates P1 wake reacquires P3 once after joining a zero-write stale owner', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness({
        profileResult: {
            status: 'no_candidates',
            eligible: true,
            profileBatch: { readbackVerified: true },
        },
        zeroWriteWorldRace: true,
        otherModuleResult: { status: 'applied' },
    });
    assert.equal(await runtime.accept(runtime.generation), true);
    for (let attempt = 0; attempt < 20 && !runtime.state.releaseInitialWorld; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(typeof runtime.state.releaseInitialWorld, 'function');
    assert.equal(runtime.state.worldStarts, 1);
    assert.equal(runtime.state.worldModelCalls, 0);
    assert.equal(runtime.state.worldWrites, 0);

    runtime.state.releaseInitialWorld();
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtime.state.continuityCalls.length, 3, 'launch, join, then one fresh owner');
    assert.equal(runtime.state.worldStarts, 2);
    assert.equal(runtime.state.worldModelCalls, 1);
    assert.equal(runtime.state.worldWrites, 1);
    assert.equal(runtime.state.continuityCalls.at(-1).noActorPermit.status, 'no_candidates');
    assert.notEqual(
        runtime.state.continuityCalls.at(-1).target,
        runtime.state.continuityCalls[1].target,
        'the one fresh owner must use a newly captured exact accepted target',
    );
    assert.equal(runtime.state.diagnostics.at(-1).task, 'doctor_total');
    assert.equal(runtime.state.diagnostics.at(-1).status, 'succeeded');
});

test('P1 wake reacquires once when both the launch owner and the settled-before-wake owner are zero-write stale', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness({
        profileResult: {
            status: 'not_completed',
            eligible: true,
            profileBatch: { readbackVerified: false },
        },
        settledZeroWriteWorldStaleStarts: 2,
        otherModuleResult: { status: 'applied' },
    });
    assert.equal(await runtime.accept(runtime.generation), true);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtime.state.continuityCalls.length, 3, 'launch, settled wake owner, one fresh owner');
    assert.equal(runtime.state.worldStarts, 3);
    assert.equal(runtime.state.worldModelCalls, 1);
    assert.equal(runtime.state.worldWrites, 1);
    assert.equal(runtime.state.continuityCalls.at(-1).noActorPermit, null);
    assert.equal(runtime.state.diagnostics.at(-1).task, 'doctor_total');
    assert.equal(runtime.state.diagnostics.at(-1).status, 'failed');
});

test('strict no-candidates proof controls only the P1 wake while accepted-final P3 stays independent', async () => {
    const finalize = loadActorProfileRecoveryOutcomeFinalizer();
    const captured = { chatId: 'chat-a', generationId: 'generation-a' };
    const raw = {
        status: 'no_candidates',
        eligible: true,
        target: { chatId: 'chat-a' },
        profileBatch: { readbackVerified: false, failed: [] },
    };
    const successCalls = [];
    const success = await finalize(captured, structuredClone(raw), {
        persistRecoveryState: async (_target, result) => {
            successCalls.push(result.status);
            return true;
        },
    });
    assert.deepEqual(successCalls, ['no_candidates']);
    assert.equal(success.result.status, 'no_candidates');
    assert.equal(success.result.profileBatch.readbackVerified, true);
    const successfulDispatch = loadAcceptedFinalFullDispatchHarness({
        profileResult: success.result,
    });
    assert.equal(await successfulDispatch.accept(successfulDispatch.generation), true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(successfulDispatch.state.continuityCalls.length, 2);
    assert.equal(successfulDispatch.state.continuityCalls.find((call) => call.noActorPermit)
        .noActorPermit.profileBatch.readbackVerified, true);
    assert.equal(successfulDispatch.state.worldModelCalls, 1);

    const failureCalls = [];
    const failure = await finalize(captured, structuredClone(raw), {
        persistRecoveryState: async (_target, result) => {
            failureCalls.push(result.status);
            return result.status === 'not_completed';
        },
    });
    assert.deepEqual(failureCalls, ['no_candidates', 'not_completed']);
    assert.equal(failure.result.status, 'not_completed');
    assert.equal(failure.result.profileBatch.readbackVerified, false);
    assert.equal(failure.result.reason, 'actor_profile.no_candidates_readback_failed');
    assert.ok(failure.result.profileBatch.failed.some((entry) => (
        entry.reason === 'actor_profile.no_candidates_readback_failed'
    )));
    assert.ok(failure.result.profileBatch.validationDiagnostic.failingGroups.includes('identity_bootstrap'));
    assert.equal(failure.recoverySaved, true, 'recovery material is saved as retry evidence, not completion');
    const failedDispatch = loadAcceptedFinalFullDispatchHarness({
        profileResult: failure.result,
    });
    assert.equal(await failedDispatch.accept(failedDispatch.generation), true);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(failedDispatch.state.continuityCalls.length, 2);
    assert.equal(failedDispatch.state.continuityCalls.every((call) => call.noActorPermit === null), true);
    assert.equal(failedDispatch.state.worldModelCalls, 1);
    assert.equal(failedDispatch.state.worldWrites, 1);
});

test('accepted-final rejection is ephemeral and an old epoch cannot touch the new chat', async () => {
    const rejected = loadAcceptedFinalRuntimeHarness({ generationEligible: false });
    assert.equal(await rejected.accept(rejected.generation), false);
    assert.equal(rejected.state.operationWrites, 0);
    assert.equal(rejected.state.statuses.length, 1);
    assert.deepEqual({ ...rejected.state.statuses[0].options }, { record: false });
    // No P4 slot was ever reserved for this rejected session, so there is
    // nothing that may be released or persisted from the rejection path.
    assert.equal(rejected.state.releases.length, 0);

    const stale = loadAcceptedFinalRuntimeHarness({ currentEpoch: 8, chatId: 'chat-b' });
    stale.generation.epoch = 7;
    stale.generation.chatId = 'chat-a';
    assert.equal(await stale.accept(stale.generation), false);
    assert.equal(stale.state.operationWrites, 0);
    assert.equal(stale.state.statuses.length, 0);
    assert.equal(stale.state.releases.length, 0);
});

test('late P4 precompose session executes the real release guard before any cleanup or namespace write', async () => {
    const sessionSupport = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const release = sourceSection(
        "async function releaseNextTurnConsumer(session, reason = 'released', {",
        'function persistedStaleWorldLeaseOwnership(context, namespace)',
    );
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    const state = { writes: 0, cleanup: 0, reads: 0 };
    const staleSession = {
        id: 'generation-old', serial: 1, type: 'normal', epoch: 7,
        operationEpoch: 11, chatId: 'chat-a', frozenScopeDigest: 'scope-a',
        acceptedFinalEligible: true,
    };
    const newerSession = { ...staleSession, id: 'generation-new', epoch: 8 };
    const sandbox = {
        currentGenerationEpoch: 8,
        operationEpoch: 11,
        lastGeneration: newerSession,
        activeGenerationSession: newerSession,
        activeNextTurnConsumer: null,
        getContext: () => ({ chatId: 'chat-a' }),
        currentActorSovereigntyScope: () => ({ id: 'scope-a' }),
        actorSovereigntyScopeDigest: (scope) => scope.id || '',
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: { id: 'scope-a' } }),
        createActorSovereigntyScope: (scope) => ({ ...scope }),
        clearLegacyNextTurnSlots: () => true,
        nextTurnConsumerTombstoneForChat: () => null,
        readChatNamespace: () => { state.reads += 1; return {}; },
        writeChatNamespace: async () => { state.writes += 1; return true; },
        cleanupNextTurnProvider: async () => { state.cleanup += 1; return true; },
        nextTurnLeaseCleanupBlocked: () => false,
        nextTurnLeaseBelongsToSession: () => false,
        persistedNextTurnConsumerCleanup: () => null,
        ensureNextTurnConsumerSlotCleaned: async () => true,
        clearNextTurnProviderCleanupFlight: () => undefined,
        retireNpcDesignTicketInjection: () => undefined,
        npcDesignTicketBatches: new Map(),
        lastInjectionInspection: {},
        setNextTurnConsumerFallback: () => true,
    };
    vm.runInNewContext(
        `${sessionSupport}\n${release}\n${precompose}\nthis.precomposeNextTurnConsumer = precomposeNextTurnConsumer;`,
        sandbox,
    );
    await sandbox.precomposeNextTurnConsumer(staleSession);
    assert.equal(state.reads, 0);
    assert.equal(state.writes, 0);
    assert.equal(state.cleanup, 0);
});

function loadP4StaleLeasePrecomposeHarness({
    externalProvider = false,
    cleanupFailed = false,
    currentSessionLease = false,
} = {}) {
    const sessionSupport = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const ownership = sourceSection(
        'function persistedStaleWorldLeaseOwnership(context, namespace)',
        'function verifiedNextTurnWorldPackage(context, namespace, packet, frozenScope, decisionSink = null)',
    );
    const leaseOwnership = sourceSection(
        'function doctorOwnsNextTurnConsumerLease(lease)',
        'async function markNextTurnConsumerCleanupFailed(session, lease, reason)',
    );
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    const state = {
        writes: 0,
        fallbackClears: 0,
        ticketBatches: 0,
        fallbackText: '',
        externalCallbacks: 0,
        injectionInspection: {},
    };
    const session = {
        id: 'generation-current', serial: 5, type: 'normal', epoch: 9,
        operationEpoch: 11, chatId: 'chat-a', frozenScopeDigest: 'scope-current',
        acceptedFinalEligible: true,
    };
    const lease = {
        state: cleanupFailed ? 'cleanup_failed' : 'reserved',
        chatId: 'chat-a', generationId: currentSessionLease ? session.id : 'generation-old',
        generationSerial: currentSessionLease ? session.serial : 4,
        generationType: 'normal',
        scopeDigest: currentSessionLease ? session.frozenScopeDigest : 'scope-old',
        expectedScopeDigest: currentSessionLease ? session.frozenScopeDigest : 'scope-old',
        consumerPayloadDigest: 'old-payload',
        providerId: externalProvider ? 'unknown-provider' : 'sillytavern-fallback',
        slotId: externalProvider ? 'unknown-provider' : 'mvu-auto-doctor-next-turn-consumer',
        providerCleanupToken: externalProvider ? 'unknown-token' : '',
    };
    state.namespace = {
        continuity: {
            nextTurnInjection: {
                producerTarget: {
                    chatId: 'chat-a', index: 2, messageId: 'old-message', swipeId: 0,
                    generationSerial: 4, scopeDigest: 'scope-old', contentFingerprint: 'old-content',
                },
                consumerLease: lease,
            },
        },
    };
    const digest = (value) => JSON.stringify(value);
    const sandbox = {
        currentGenerationEpoch: 9, operationEpoch: 11, lastGeneration: session,
        activeGenerationSession: session, activeNextTurnConsumer: null,
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        getContext: () => ({ chatId: 'chat-a' }),
        currentActorSovereigntyScope: () => ({ id: 'scope-current' }),
        actorSovereigntyScopeDigest: (scope) => scope.id || '',
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: { id: 'scope-current' } }),
        createActorSovereigntyScope: (scope) => ({ ...scope }),
        fingerprint: digest,
        deepClone: (value) => structuredClone(value),
        stage3AcceptedTarget: (target) => target?.chatId && target?.messageId
            && target?.scopeDigest && target?.contentFingerprint ? { ...target } : null,
        readChatNamespace: () => state.namespace,
        writeChatNamespace: async (next, _chatId, options) => {
            if (!options.precondition()) return false;
            state.writes += 1;
            state.namespace = structuredClone(next);
            return options.contentValidator(state.namespace);
        },
        clearNextTurnConsumerFallback: () => { state.fallbackClears += 1; return true; },
        cleanupNextTurnProvider: async () => { state.externalCallbacks += 1; return true; },
        clearLegacyNextTurnSlots: () => true,
        verifiedNextTurnWorldPackage: (_context, namespace) => ({
            packet: namespace.continuity.nextTurnInjection,
            captured: null,
        }),
        buildContinuityConsumerPayload: () => ({ ok: true, text: 'old world' }),
        prepareNpcDesignTicketBatch: () => {
            state.ticketBatches += 1;
            return { generationId: 'generation-current', tickets: [] };
        },
        npcDesignTicketPrompt: () => 'current ticket',
        immutableNextTurnConsumerPayload: (worldText, ticketText) => ({
            text: [worldText, ticketText].filter(Boolean).join('\n'),
            digest: 'new-payload',
        }),
        setNextTurnConsumerFallback: (text) => { state.fallbackText = text; return true; },
        lastInjectionInspection: state.injectionInspection,
        recordNextTurnConsumerInspection: () => undefined,
        Date: { now: () => 1 },
    };
    vm.runInNewContext(`${sessionSupport}\n${leaseOwnership}\n${ownership}\n${precompose}\nthis.precomposeNextTurnConsumer = precomposeNextTurnConsumer;`, sandbox);
    return { state, session, precompose: sandbox.precomposeNextTurnConsumer };
}

test('production P4 lease matchers require Doctor ownership even when every session field collides', () => {
    const leaseChecks = sourceSection(
        'function nextTurnLeaseMatches(lease, session)',
        'async function writeNextTurnConsumerLease(session, scopeDigest, payload)',
    );
    const leaseOwnership = sourceSection(
        'function doctorOwnsNextTurnConsumerLease(lease)',
        'async function markNextTurnConsumerCleanupFailed(session, lease, reason)',
    );
    const sandbox = {
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
    };
    vm.runInNewContext(
        `${leaseChecks}\n${leaseOwnership}\nthis.belongs = nextTurnLeaseBelongsToSession; this.blocked = nextTurnLeaseCleanupBlocked;`,
        sandbox,
    );
    const session = {
        chatId: 'chat-a', id: 'generation-current', serial: 5, type: 'normal',
        frozenScopeDigest: 'scope-current',
    };
    const lease = (providerId, state, providerCleanupToken = '') => ({
        state, chatId: session.chatId, generationId: session.id,
        generationSerial: session.serial, generationType: session.type,
        scopeDigest: session.frozenScopeDigest,
        expectedScopeDigest: session.frozenScopeDigest,
        providerId, slotId: 'mvu-auto-doctor-next-turn-consumer', providerCleanupToken,
    });
    for (const providerId of ['doctor-extension-prompt', 'sillytavern-fallback']) {
        assert.equal(sandbox.belongs(lease(providerId, 'reserved'), session), true);
        assert.equal(sandbox.blocked(lease(providerId, 'cleanup_failed'), session), true);
    }
    assert.equal(sandbox.belongs(lease('external-provider', 'reserved', 'foreign-token'), session), false);
    assert.equal(sandbox.blocked(lease('external-provider', 'cleanup_failed', 'foreign-token'), session), false);
});

test('fresh persisted old P3 fallback lease converges without blocking current ticket-only precompose', async () => {
    const runtime = loadP4StaleLeasePrecomposeHarness();
    await runtime.precompose(runtime.session);
    assert.equal(runtime.state.writes, 1);
    assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumerLease.state, 'released');
    assert.equal(runtime.state.ticketBatches, 1);
    assert.equal(runtime.state.fallbackText, 'current ticket');
});

test('unowned persisted lease never cleans a provider and still degrades current precompose to ticket-only', async () => {
    const runtime = loadP4StaleLeasePrecomposeHarness({ externalProvider: true });
    await runtime.precompose(runtime.session);
    assert.equal(runtime.state.writes, 0);
    assert.equal(runtime.state.fallbackClears, 0);
    assert.equal(runtime.state.ticketBatches, 1);
    assert.equal(runtime.state.fallbackText, 'current ticket');
    assert.equal(runtime.state.externalCallbacks, 0);
    assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumeProof, undefined);
});

test('unowned cleanup-failed persisted lease cannot block the Doctor ticket slot or invoke a callback', async () => {
    const runtime = loadP4StaleLeasePrecomposeHarness({
        externalProvider: true, cleanupFailed: true, currentSessionLease: true,
    });
    await runtime.precompose(runtime.session);
    assert.equal(runtime.state.writes, 0);
    assert.equal(runtime.state.fallbackClears, 0);
    assert.equal(runtime.state.ticketBatches, 1);
    assert.equal(runtime.state.fallbackText, 'current ticket');
    assert.equal(runtime.state.externalCallbacks, 0);
    assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumerLease.state, 'cleanup_failed');
    assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumeProof, undefined);
});

test('a cleanup-failed P4 lease blocks placement only', async () => {
    const runtime = loadP4StaleLeasePrecomposeHarness({ cleanupFailed: true });
    await runtime.precompose(runtime.session);
    assert.equal(runtime.state.writes, 0);
    assert.equal(runtime.state.fallbackClears, 0);
    assert.equal(runtime.state.ticketBatches, 0);
    assert.equal(runtime.state.fallbackText, '');
    assert.equal(runtime.state.injectionInspection.status, 'blocked');
});

async function runProductionP4CommitLeaseGate({ externalProvider, cleanupFailed }) {
    const leaseChecks = sourceSection(
        'function nextTurnLeaseMatches(lease, session)',
        'async function writeNextTurnConsumerLease(session, scopeDigest, payload)',
    );
    const leaseOwnership = sourceSection(
        'function doctorOwnsNextTurnConsumerLease(lease)',
        'async function markNextTurnConsumerCleanupFailed(session, lease, reason)',
    );
    const cleanupGate = sourceSection(
        'async function ensureNextTurnConsumerSlotCleaned(session, active, reason)',
        "async function releaseNextTurnConsumer(session, reason = 'released', {",
    );
    const commit = sourceSection(
        'async function commitNextTurnConsumer(session, envelope)',
        'function continuityStateForInjection(namespace, { isReroll = false } = {})',
    );
    const session = {
        id: 'generation-current', serial: 5, type: 'normal', chatId: 'chat-a',
        frozenScopeDigest: 'scope-current',
    };
    const envelope = {
        chatId: 'chat-a', index: 5, messageId: 'message-current', swipeId: 0,
        scopeDigest: 'scope-current', contentFingerprint: 'content-current',
    };
    const lease = {
        state: cleanupFailed ? 'cleanup_failed' : 'reserved',
        chatId: session.chatId, generationId: session.id,
        generationSerial: session.serial, generationType: session.type,
        scopeDigest: session.frozenScopeDigest,
        expectedScopeDigest: session.frozenScopeDigest,
        providerId: externalProvider ? 'unknown-provider' : 'doctor-extension-prompt',
        slotId: externalProvider ? 'unknown-slot' : 'mvu-auto-doctor-next-turn-consumer',
        providerCleanupToken: externalProvider ? 'unknown-token' : '',
    };
    const state = {
        clears: 0, externalCallbacks: 0, namespaceWrites: 0, releases: 0,
        namespace: { continuity: { nextTurnInjection: { consumerLease: lease } } },
    };
    const sandbox = {
        activeNextTurnConsumer: {
            generationId: session.id, digest: 'ticket-only-digest',
            providerId: 'doctor-extension-prompt',
            slotId: 'mvu-auto-doctor-next-turn-consumer', fallback: true,
        },
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        lastInjectionInspection: {},
        getContext: () => ({ chatId: session.chatId }),
        readChatNamespace: () => state.namespace,
        clearNextTurnConsumerFallback: () => { state.clears += 1; return true; },
        cleanupNextTurnProvider: async () => { state.externalCallbacks += 1; return true; },
        acceptedFinalEnvelopeMatchesContext: () => true,
        resolveCurrentActorSovereigntyScope: async () => ({
            resolved: true, scope: { digest: envelope.scopeDigest },
        }),
        actorSovereigntyScopeDigest: (scope) => scope.digest,
        releaseNextTurnConsumer: async () => { state.releases += 1; return true; },
        markNextTurnConsumerCleanupFailed: async () => {
            throw new Error('foreign lease must not be rewritten');
        },
        confirmNextTurnConsumerCleanup: async () => {
            throw new Error('foreign lease must not be confirmed');
        },
        writeChatNamespace: async () => { state.namespaceWrites += 1; return true; },
        deepClone: (value) => structuredClone(value),
        Date,
    };
    vm.runInNewContext(
        `${leaseChecks}\n${leaseOwnership}\n${cleanupGate}\n${commit}\nthis.commit = commitNextTurnConsumer;`,
        sandbox,
    );
    const result = await sandbox.commit(session, envelope);
    return { result, state, active: sandbox.activeNextTurnConsumer };
}

for (const cleanupFailed of [false, true]) {
    test(`production P4 commit ignores an external ${cleanupFailed ? 'cleanup_failed' : 'reserved'} lease without callback or consume`, async () => {
        const runtime = await runProductionP4CommitLeaseGate({ externalProvider: true, cleanupFailed });
        assert.equal(runtime.result, true);
        assert.equal(runtime.state.clears, 1);
        assert.equal(runtime.state.externalCallbacks, 0);
        assert.equal(runtime.state.namespaceWrites, 0);
        assert.equal(runtime.state.releases, 0);
        assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumeProof, undefined);
        assert.equal(runtime.active, null);
    });
}

test('production P4 commit keeps Doctor-owned cleanup_failed fail-closed', async () => {
    const runtime = await runProductionP4CommitLeaseGate({ externalProvider: false, cleanupFailed: true });
    assert.equal(runtime.result, false);
    assert.equal(runtime.state.clears, 0);
    assert.equal(runtime.state.externalCallbacks, 0);
    assert.equal(runtime.state.namespaceWrites, 0);
    assert.equal(runtime.active?.generationId, 'generation-current');
    assert.equal(runtime.state.namespace.continuity.nextTurnInjection.consumeProof, undefined);
});

test('a completed old P4 commit cannot clear the newly precomposed active consumer', async () => {
    const leaseChecks = sourceSection(
        'function nextTurnLeaseMatches(lease, session)',
        'async function writeNextTurnConsumerLease(session, scopeDigest, payload)',
    );
    const leaseOwnership = sourceSection(
        'function doctorOwnsNextTurnConsumerLease(lease)',
        'async function markNextTurnConsumerCleanupFailed(session, lease, reason)',
    );
    const commitSource = sourceSection(
        'async function commitNextTurnConsumer(session, envelope)',
        'function continuityStateForInjection(namespace, { isReroll = false } = {})',
    );
    const makeSession = (id, serial) => ({
        id, serial, type: 'normal', chatId: 'chat-a', frozenScopeDigest: 'scope-a',
    });
    const makeEnvelope = (session) => ({
        chatId: 'chat-a', index: serialToIndex(session.serial),
        messageId: `message-${session.id}`, swipeId: 0,
        scopeDigest: 'scope-a', contentFingerprint: `content-${session.id}`,
    });
    const serialToIndex = (serial) => Number(serial);
    const makeLease = (session) => ({
        state: 'reserved', chatId: session.chatId, generationId: session.id,
        generationSerial: session.serial, generationType: session.type,
        scopeDigest: session.frozenScopeDigest, expectedScopeDigest: session.frozenScopeDigest,
        providerId: 'doctor-extension-prompt', slotId: 'mvu-auto-doctor-next-turn-consumer',
    });
    const oldSession = makeSession('generation-old', 1);
    const newSession = makeSession('generation-new', 2);
    const oldActive = {
        generationId: oldSession.id, digest: 'digest-old',
        providerId: 'doctor-extension-prompt', slotId: 'mvu-auto-doctor-next-turn-consumer',
    };
    const newActive = {
        generationId: newSession.id, digest: 'digest-new',
        providerId: 'doctor-extension-prompt', slotId: 'mvu-auto-doctor-next-turn-consumer',
    };
    const state = {
        writes: 0,
        namespace: {
            continuity: {
                nextTurnInjection: {
                    consumerLease: makeLease(oldSession),
                    producerTarget: { scopeDigest: 'scope-a' },
                },
            },
        },
    };
    const sandbox = {
        activeNextTurnConsumer: oldActive,
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        getContext: () => ({ chatId: 'chat-a' }),
        ensureNextTurnConsumerSlotCleaned: async () => true,
        acceptedFinalEnvelopeMatchesContext: () => true,
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: { digest: 'scope-a' } }),
        actorSovereigntyScopeDigest: (scope) => scope.digest,
        readChatNamespace: () => state.namespace,
        releaseNextTurnConsumer: async () => true,
        deepClone: (value) => structuredClone(value),
        Date,
        writeChatNamespace: async (candidate) => {
            state.writes += 1;
            state.namespace = structuredClone(candidate);
            if (state.writes === 1) sandbox.activeNextTurnConsumer = newActive;
            return true;
        },
    };
    vm.runInNewContext(
        `${leaseChecks}\n${leaseOwnership}\n${commitSource}\nthis.commit = commitNextTurnConsumer;`,
        sandbox,
    );
    assert.equal(await sandbox.commit(oldSession, makeEnvelope(oldSession)), true);
    assert.equal(sandbox.activeNextTurnConsumer, newActive);

    state.namespace.continuity.nextTurnInjection = {
        consumerLease: makeLease(newSession),
        producerTarget: { scopeDigest: 'scope-a' },
    };
    assert.equal(await sandbox.commit(newSession, makeEnvelope(newSession)), true);
    assert.equal(sandbox.activeNextTurnConsumer, null);
    assert.equal(state.writes, 2);
});

test('production P4 release ignores a fully current external cleanup_failed packet after clearing only the Doctor slot', async () => {
    const leaseChecks = sourceSection(
        'function nextTurnLeaseMatches(lease, session)',
        'async function writeNextTurnConsumerLease(session, scopeDigest, payload)',
    );
    const leaseOwnership = sourceSection(
        'function doctorOwnsNextTurnConsumerLease(lease)',
        'async function markNextTurnConsumerCleanupFailed(session, lease, reason)',
    );
    const cleanupGate = sourceSection(
        'async function ensureNextTurnConsumerSlotCleaned(session, active, reason)',
        "async function releaseNextTurnConsumer(session, reason = 'released', {",
    );
    const release = sourceSection(
        "async function releaseNextTurnConsumer(session, reason = 'released', {",
        'function persistedStaleWorldLeaseOwnership(context, namespace)',
    );
    const session = {
        id: 'generation-current', serial: 5, type: 'normal', epoch: 9,
        operationEpoch: 11, chatId: 'chat-a', frozenScopeDigest: 'scope-current',
    };
    const packet = {
        consumerLease: {
            state: 'cleanup_failed', chatId: session.chatId, generationId: session.id,
            generationSerial: session.serial, generationType: session.type,
            scopeDigest: session.frozenScopeDigest,
            expectedScopeDigest: session.frozenScopeDigest,
            providerId: 'external-provider', slotId: 'external-slot',
            providerCleanupToken: 'external-token',
        },
    };
    const state = {
        clears: 0, writes: 0, externalCallbacks: 0, retiredTickets: 0,
        namespace: { continuity: { nextTurnInjection: packet } },
    };
    const sandbox = {
        currentGenerationEpoch: 9, operationEpoch: 11, lastGeneration: session,
        activeNextTurnConsumer: {
            generationId: session.id, digest: 'ticket-only-digest', fallback: true,
            providerId: 'doctor-extension-prompt',
            slotId: 'mvu-auto-doctor-next-turn-consumer',
        },
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        lastInjectionInspection: {},
        getContext: () => ({ chatId: session.chatId }),
        readChatNamespace: () => state.namespace,
        acceptedFinalReleaseIsCurrent: async () => true,
        clearNextTurnConsumerFallback: () => { state.clears += 1; return true; },
        cleanupNextTurnProvider: async () => { state.externalCallbacks += 1; return true; },
        writeChatNamespace: async () => { state.writes += 1; return true; },
        retireNpcDesignTicketInjection: () => { state.retiredTickets += 1; },
        npcDesignTicketBatches: new Map([[session.id, {}]]),
        markNextTurnConsumerCleanupFailed: async () => {
            throw new Error('foreign packet must not be marked');
        },
        confirmNextTurnConsumerCleanup: async () => {
            throw new Error('foreign packet must not be confirmed');
        },
        persistedNextTurnConsumerCleanup: () => {
            throw new Error('foreign packet must not be decoded as Doctor cleanup');
        },
        deepClone: (value) => structuredClone(value),
    };
    vm.runInNewContext(
        `${leaseChecks}\n${leaseOwnership}\n${cleanupGate}\n${release}\nthis.release = releaseNextTurnConsumer;`,
        sandbox,
    );
    assert.equal(await sandbox.release(session, 'upgrade_cleanup', { preserveTickets: true }), true);
    assert.equal(state.clears, 1);
    assert.equal(state.writes, 0);
    assert.equal(state.externalCallbacks, 0);
    assert.equal(state.retiredTickets, 0);
    assert.equal(state.namespace.continuity.nextTurnInjection, packet);
    assert.equal(state.namespace.continuity.nextTurnInjection.consumeProof, undefined);
    assert.equal(sandbox.activeNextTurnConsumer, null);
});

async function runCleanupFailedAcceptedFinalLifecycle({ type, useProductionCandidate, hostPreflight = false }) {
    const candidate = useProductionCandidate
        ? sourceSection(
            'function generationCandidateAllowed(type, params, dryRun)',
            'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
        )
        : '';
    const identity = sourceSection(
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
        'function acceptedFinalEnvelopeMatchesContext(context, envelope, session)',
    );
    const support = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const dispatch = sourceSection(
        'async function moduleTargetForAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const trace = sourceSection(
        'const GENERATION_LIFECYCLE_TRACE_LIMIT = 12;',
        'let pendingChatSaveTimer',
    );
    const state = {
        callbacks: new Map(),
        acceptedEnvelopes: [],
        dispatches: [],
        identitySaves: 0,
        namespaceReads: 0,
        namespaceWrites: 0,
        providerCleanup: 0,
        releases: 0,
        diagnostics: [],
    };
    const message = { mes: '<content>Natural final text.</content>', swipe_id: 1 };
    const scope = { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' };
    const sandbox = {
        ...acceptedFinalQueueSandboxState(),
        currentGenerationEpoch: 4,
        generationSerial: 8,
        operationEpoch: 12,
        runtimeGenerationSerialFloor: () => -1,
        activeGenerationSession: null,
        foregroundGenerationStarting: null,
        activeNextTurnConsumer: null,
        document: { body: { dataset: {} } },
        lastGeneration: {
            id: 'generation-old', chatId: 'chat-a', epoch: 4, operationEpoch: 12,
        },
        pendingAcceptedFinalTimer: null,
        pendingChatSaveTimer: null,
        pendingOperationLogSaveTimer: null,
        lastInjectionInspection: {},
        continuationIdentityHint: null,
        getContext: () => ({
            chatId: 'chat-a',
            chat: [message],
            eventTypes: {
                GENERATION_STARTED: 'generation_started',
                GENERATION_STOPPED: 'generation_stopped',
                GENERATION_ENDED: 'generation_ended',
                CHAT_CHANGED: 'chat_changed',
            },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        readChatNamespace: () => ({
            continuity: { nextTurnInjection: { consumerLease: { state: 'cleanup_failed' } } },
        }),
        writeChatNamespace: async () => { state.namespaceWrites += 1; return true; },
        generationCandidateAllowed: useProductionCandidate
            ? undefined
            : () => ({ allowed: true, generationType: 'regenerate' }),
        acceptedFinalSnapshot: () => ({ index: 0, swipeId: 1, contentFingerprint: 'before' }),
        invalidateOperations: () => { sandbox.operationEpoch += 1; },
        resetCurrentModelCallStats: () => undefined,
        preemptHostBackgroundModelControllersForForegroundGeneration: () => 0,
        currentActorSovereigntyScope: () => scope,
        actorSovereigntyScopeDigest: (value) => `${value.chatId}|${value.cardId}|${value.runtimeVersion}`,
        actorSovereigntyScopesMatch: (left, right) => left.chatId === right.chatId
            && left.cardId === right.cardId && left.runtimeVersion === right.runtimeVersion,
        createActorSovereigntyScope: (value) => ({ ...value }),
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope }),
        nextTurnConsumerTombstoneForChat: () => null,
        clearLegacyNextTurnSlots: () => true,
        lastInjectionInspection: {},
        currentFinalAssistant: () => ({ index: 0, message }),
        latestAiMessage: () => ({ index: 0, message }),
        sovereigntyNarrativeEligible: () => true,
        acceptedContentFingerprint: () => 'after',
        ensureMessageStableId: () => 'message-0',
        currentSwipeInfo: () => null,
        isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
        scheduleSafeChatSave: () => { state.identitySaves += 1; },
        commitNextTurnConsumer: async (_session, envelope) => {
            state.acceptedEnvelopes.push(envelope);
            return true;
        },
        releaseNextTurnConsumer: async () => { state.releases += 1; return false; },
        cleanupNextTurnProvider: async () => { state.providerCleanup += 1; return false; },
        captureTarget: (_context, index, { frozenScope } = {}) => ({
            chatId: 'chat-a', index, messageId: 'message-0', swipeId: 1,
            generationId: sandbox.lastGeneration.id,
            generationSerial: sandbox.lastGeneration.serial,
            generationType: sandbox.lastGeneration.type,
            contentFingerprint: 'after',
            scopeDigest: sandbox.actorSovereigntyScopeDigest(frozenScope || scope),
            actorSovereigntyScope: { ...(frozenScope || scope) },
            epoch: sandbox.operationEpoch,
        }),
        enqueue: (_index, options) => { state.dispatches.push({ kind: 'variable', target: options.queuedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueOpeningResourceSync: (_index, options) => { state.dispatches.push({ kind: 'opening', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        runSocialAuditTarget: (target) => { state.dispatches.push({ kind: 'social', target }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueForum: (_index, options) => { state.dispatches.push({ kind: 'forum', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueActorProfiles: (_index, options) => { state.dispatches.push({ kind: 'p1', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueContinuity: (_index, options) => { state.dispatches.push({ kind: 'p3', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        continuityProfileRetrySignals: new Map(),
        stage3AcceptedTargetKey: () => 'p3',
        safeDiagnosticReason: (value) => String(value || ''),
        recordOperation: () => undefined,
        recordModelDiagnostic: (entry) => state.diagnostics.push(entry),
        setStatus: () => undefined,
        setTimeout: (callback) => { state.timer = callback; return 1; },
        clearTimeout: () => undefined,
        Date: { now: () => 7 },
        Math,
        __doctorDiagnostics: state.diagnostics,
    };
    vm.runInNewContext(
        `${trace}\n${candidate}\n${identity}\n${support}\n${dispatch}\n${accept}\n${precompose}\n${bind}\nthis.bindEvents = bindEvents; this.readTrace = () => generationLifecycleTraceDiagnosticProjection(getContext());`,
        sandbox,
    );
    sandbox.bindEvents();

    if (hostPreflight) {
        const priorEpoch = sandbox.currentGenerationEpoch;
        const priorOperationEpoch = sandbox.operationEpoch;
        const priorGenerationId = sandbox.lastGeneration.id;
        await state.callbacks.get('generation_started')('normal', {}, true);
        assert.equal(sandbox.activeGenerationSession, null);
        assert.equal(sandbox.currentGenerationEpoch, priorEpoch);
        assert.equal(sandbox.operationEpoch, priorOperationEpoch);
        assert.equal(sandbox.lastGeneration.id, priorGenerationId);
        assert.equal(state.namespaceWrites, 0);
        assert.equal(state.providerCleanup, 0);
        assert.equal(state.releases, 0);
        const preflightTrace = sandbox.readTrace().at(-1);
        assert.equal(preflightTrace.code, 'ignored_start');
        assert.equal(preflightTrace.reason, 'dry_run');
        assert.equal(preflightTrace.eventDryRun, true);
    }
    await state.callbacks.get('generation_started')(type, {}, false);
    const session = sandbox.lastGeneration;
    assert.equal(session.chatId, 'chat-a');
    assert.equal(session.type, useProductionCandidate ? 'normal' : 'regenerate');
    assert.equal(session.operationEpoch, useProductionCandidate ? 12 : 13);
    assert.equal(sandbox.operationEpoch, useProductionCandidate ? 12 : 13);
    assert.equal(session.start.contentFingerprint, 'before');
    assert.equal(sandbox.activeGenerationSession, session);
    assert.equal(session.p4PlacementScopeDigest, undefined);
    assert.equal(sandbox.lastInjectionInspection.status, 'blocked');
    assert.equal(state.releases, 0);
    assert.equal(state.namespaceWrites, 0);
    assert.equal(state.providerCleanup, 0);

    state.callbacks.get('generation_ended')();
    state.timer();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.identitySaves, 1);
    assert.equal(message.extra.mvu_auto_doctor_generation_id, session.id);
    assert.equal(state.acceptedEnvelopes.length, 1);
    assert.equal(state.acceptedEnvelopes[0].generationId, session.id);
    assert.equal(state.acceptedEnvelopes[0].contentFingerprint, 'after');
    assert.equal(state.acceptedEnvelopes[0].scopeDigest, 'chat-a|character:card-a|rc14');
    assert.equal(state.diagnostics.length, 1);
    assert.equal(state.diagnostics[0].task, 'doctor_total');
    assert.equal(state.diagnostics[0].targetIndex, 0);
    assert.equal(state.diagnostics[0].targetCount, 3);
    assert.ok(state.diagnostics[0].doctorTotalMs >= 0);
    const p1 = state.dispatches.find(({ kind }) => kind === 'p1')?.target;
    const p3 = state.dispatches.find(({ kind }) => kind === 'p3')?.target;
    assert.ok(p1);
    assert.ok(p3, 'accepted-final launches P3 independently of P1 completion');
    for (const target of [p1, p3]) {
        assert.equal(target.chatId, 'chat-a');
        assert.equal(target.scopeDigest, 'chat-a|character:card-a|rc14');
        assert.deepEqual(
            { ...target.actorSovereigntyScope },
            { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
        );
    }
}

test('R7 cleanup_failed blocks only P4 placement; ENDED still performs real accepted-final dispatch', async () => {
    await runCleanupFailedAcceptedFinalLifecycle({ type: 'regenerate', useProductionCandidate: false });
});

test('R9 undefined lifecycle type defaults normal and still performs real accepted-final dispatch', async () => {
    await runCleanupFailedAcceptedFinalLifecycle({ type: undefined, useProductionCandidate: true });
});

test('R8 keeps the P0 session when P4 precompose throws', async () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = { callbacks: new Map(), traces: [], writes: 0 };
    const sandbox = {
        currentGenerationEpoch: 4, operationEpoch: 12, generationSerial: 8,
        activeGenerationSession: null, activeNextTurnConsumer: null,
        lastGeneration: { id: 'generation-old', chatId: 'chat-a', epoch: 4, operationEpoch: 12 },
        pendingAcceptedFinalTimer: null, lastInjectionInspection: {}, continuationIdentityHint: null,
        getContext: () => ({
            chatId: 'chat-a', chat: [],
            eventTypes: { GENERATION_STARTED: 'generation_started' },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        generationCandidateAllowed: () => ({ allowed: true, generationType: 'normal' }),
        acceptedFinalSnapshot: () => ({ contentFingerprint: 'before' }),
        invalidateOperations: () => { throw new Error('normal must not invalidate'); },
        resetCurrentModelCallStats: () => undefined,
        precomposeNextTurnConsumer: async () => { throw new Error('p4 only'); },
        recordGenerationLifecycleTrace: (code, detail) => state.traces.push({ code, detail }),
        setTimeout: () => 1, clearTimeout: () => undefined,
        Date: { now: () => 7 }, Math,
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${bind}\nthis.bindEvents = bindEvents;`, sandbox);
    sandbox.recordGenerationLifecycleTrace = (code, detail) => state.traces.push({ code, detail });
    sandbox.bindEvents();
    await state.callbacks.get('generation_started')('normal', {}, false);
    assert.ok(sandbox.activeGenerationSession);
    assert.equal(sandbox.lastGeneration.acceptedFinalEligible, true);
    assert.equal(sandbox.lastInjectionInspection.status, 'blocked');
    assert.equal(state.writes, 0);
});

test('R8 chat switch isolates a late deferred P4 rejection from chat B', async () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const lateP4 = deferred();
    const state = { chatId: 'chat-a', callbacks: new Map(), statuses: [], writes: 0, cleanup: 0 };
    const traceVm = lifecycleVmStubs.replace(
        'function recordGenerationLifecycleTrace() {}',
        'function recordGenerationLifecycleTrace(code, detail) { generationLifecycleTrace.push({ code, detail }); }',
    );
    const sandbox = {
        currentGenerationEpoch: 4, operationEpoch: 12, generationSerial: 8,
        activeGenerationSession: null, activeNextTurnConsumer: null,
        lastGeneration: { id: '', type: 'normal', dryRun: false },
        pendingAcceptedFinalTimer: null, pendingChatSaveTimer: null, pendingOperationLogSaveTimer: null,
        lastInjectionInspection: {}, continuationIdentityHint: null,
        ui: {}, window: {}, document: {},
        automaticPendingKeys: new Set(), automaticCompletedKeys: new Set(),
        openingSyncPendingKeys: new Set(), openingSyncCompletedKeys: new Set(),
        actorProfilePendingKeys: new Set(), actorProfileCompletedKeys: new Set(),
        forumPendingKeys: new Set(), forumCompletedKeys: new Set(),
        npcDesignTicketBatches: new Map(), pendingSerendipityOpportunities: new Map(),
        actorSovereigntyScopeSelectorCache: new Map(), presetContinuityCache: {},
        pendingSerendipityDraft: null, pendingSerendipityBaseline: null, pendingNpcDesignTicketBatch: null,
        downstreamBarrierProtocol: null, downstreamBarrierProtocolChatId: '',
        getContext: () => ({
            chatId: state.chatId, chat: [],
            eventTypes: { GENERATION_STARTED: 'generation_started', CHAT_CHANGED: 'chat_changed' },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        generationCandidateAllowed: () => ({ allowed: true, generationType: 'normal' }),
        acceptedFinalSnapshot: () => ({ contentFingerprint: 'before' }),
        invalidateOperations: () => { sandbox.operationEpoch += 1; },
        resetCurrentModelCallStats: () => undefined,
        precomposeNextTurnConsumer: async (session) => {
            if (session.chatId === 'chat-a') await lateP4.promise;
        },
        clearActorProfileReadShadow: () => undefined, clearTimeout: () => undefined,
        resetChatScopedRuntimeDiagnostics: () => undefined,
        currentPendingSovereigntyObservationRecords: () => undefined,
        latestUndoRecord: () => null, readChatNamespace: () => ({}),
        loadOperationLogFromChat: () => undefined, renderForum: () => undefined,
        clearNextTurnConsumerFallback: () => true,
        retireNextTurnConsumerForChat: () => { state.cleanup += 1; return true; },
        setStatus: (...args) => state.statuses.push(args), setSocialStatus: (...args) => state.statuses.push(args),
        setActorProfileStatus: (...args) => state.statuses.push(args), setContinuityStatus: (...args) => state.statuses.push(args),
        setForumStatus: (...args) => state.statuses.push(args),
        writeChatNamespace: async () => { state.writes += 1; return true; },
        Date: { now: () => 7 }, Math, setTimeout: () => 1,
    };
    vm.runInNewContext(`${traceVm}\n${bind}\nthis.bindEvents = bindEvents; this.getTrace = () => generationLifecycleTrace;`, sandbox);
    sandbox.bindEvents();
    const startA = state.callbacks.get('generation_started')('normal', {}, false);
    await new Promise((resolve) => setImmediate(resolve));
    state.chatId = 'chat-b';
    await state.callbacks.get('chat_changed')();
    await state.callbacks.get('generation_started')('normal', {}, false);
    const bInspection = sandbox.lastInjectionInspection;
    const bStatuses = state.statuses.length;
    const bTrace = sandbox.getTrace().map((entry) => entry.detail?.chatId || '');
    lateP4.reject(new Error('late A P4'));
    await startA;
    assert.equal(sandbox.lastGeneration.chatId, 'chat-b');
    assert.equal(sandbox.lastInjectionInspection, bInspection);
    assert.equal(state.statuses.length, bStatuses);
    assert.ok(bTrace.every((chatId) => chatId !== 'chat-a'));
    assert.ok(sandbox.getTrace().every((entry) => entry.detail?.chatId !== 'chat-a'));
    assert.equal(state.writes, 0);
    assert.equal(state.cleanup, 0);
});

test('R8 lifecycle trace is bounded, privacy-safe, and diagnostic-only', () => {
    const trace = sourceSection(
        'function recordGenerationLifecycleTrace(code, {',
        'function generationLifecycleTraceDiagnosticProjection(context = getContext())',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    assert.match(trace, /slice\(-GENERATION_LIFECYCLE_TRACE_LIMIT\)/u);
    assert.doesNotMatch(trace, /writeChatNamespace|recordOperation|scheduleOperationLogSave|\.mes|secret|credential/iu);
    assert.match(source, /generationLifecycleTrace: generationLifecycleTraceDiagnosticProjection\(context\)/u);
    assert.match(bind, /generationLifecycleTrace = \[\]/u);
    assert.match(bind, /recordGenerationLifecycleTrace\('started'/u);
    assert.match(bind, /recordGenerationLifecycleTrace\('session_created'/u);
    assert.match(bind, /recordGenerationLifecycleTrace\('p4'/u);
    assert.match(bind, /recordGenerationLifecycleTrace\('ended'/u);
    assert.match(bind, /recordGenerationLifecycleTrace\('timer'/u);
});

test('R7 ENDED without a session is an ephemeral diagnostic with zero release or persistence', () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = { callbacks: new Map(), statuses: [], releases: 0, writes: 0 };
    const sandbox = {
        activeGenerationSession: null,
        activeNextTurnConsumer: { providerId: 'external-provider', fallback: false },
        currentGenerationEpoch: 4,
        operationEpoch: 11,
        lastGeneration: {
            id: 'generation-known', chatId: 'chat-a', epoch: 4, operationEpoch: 11,
        },
        pendingAcceptedFinalTimer: null,
        getContext: () => ({
            chatId: 'chat-a',
            eventTypes: { GENERATION_ENDED: 'generation_ended' },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        setStatus: (...args) => state.statuses.push(args),
        releaseNextTurnConsumer: async () => { state.releases += 1; return true; },
        writeChatNamespace: async () => { state.writes += 1; return true; },
        setTimeout: () => { throw new Error('no accepted-final timer is expected'); },
        clearTimeout: () => undefined,
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${bind}\nthis.bindEvents = bindEvents;`, sandbox);
    sandbox.bindEvents();
    state.callbacks.get('generation_ended')();
    assert.equal(state.statuses.length, 1);
    assert.match(state.statuses[0][0], /no_generation_session/u);
    assert.deepEqual({ ...state.statuses[0][2] }, { record: false });
    assert.equal(state.releases, 0);
    assert.equal(state.writes, 0);
});

test('actual chat-change handler clears the old Doctor slot so the new chat can start and accept normally', async () => {
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = {
        writes: 0, releases: 0, invalidates: 0, clears: 0,
        callbacks: new Map(), status: [], precomposed: [], accepted: [],
    };
    const oldSession = {
        id: 'generation-old', chatId: 'chat-old', epoch: 7, operationEpoch: 11,
    };
    const sandbox = {
        ui: {}, window: {}, document: {},
        activeGenerationSession: oldSession,
        activeNextTurnConsumer: { generationId: 'generation-old', fallback: true },
        lastGeneration: oldSession,
        currentGenerationEpoch: 7,
        generationSerial: 1,
        operationEpoch: 11,
        pendingChatSaveTimer: null, pendingOperationLogSaveTimer: null, pendingAcceptedFinalTimer: null,
        automaticPendingKeys: new Set(['old']), automaticCompletedKeys: new Set(['old']),
        openingSyncPendingKeys: new Set(['old']), openingSyncCompletedKeys: new Set(['old']),
        actorProfilePendingKeys: new Set(['old']), actorProfileCompletedKeys: new Set(['old']),
        forumPendingKeys: new Set(['old']), forumCompletedKeys: new Set(['old']),
        npcDesignTicketBatches: new Map([['old', {}]]), pendingSerendipityOpportunities: new Map([['old', {}]]),
        actorSovereigntyScopeSelectorCache: new Map(),
        getContext: () => ({
            chatId: 'chat-new', eventTypes: {
                CHAT_CHANGED: 'chat_changed', GENERATION_STARTED: 'generation_started',
                GENERATION_ENDED: 'generation_ended',
            },
            eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
        }),
        clearActorProfileReadShadow: () => undefined,
        clearTimeout: () => undefined,
        invalidateOperations: () => { state.invalidates += 1; },
        resetChatScopedRuntimeDiagnostics: () => undefined,
        currentPendingSovereigntyObservationRecords: () => undefined,
        pendingSerendipityDraft: null, pendingSerendipityBaseline: null, pendingNpcDesignTicketBatch: null,
        downstreamBarrierProtocol: null, downstreamBarrierProtocolChatId: '', continuationIdentityHint: null,
        presetContinuityCache: {}, latestUndoRecord: () => null, readChatNamespace: () => ({}),
        writeChatNamespace: async () => { state.writes += 1; return true; },
        releaseNextTurnConsumer: async () => { state.releases += 1; return true; },
        setStatus: (...args) => state.status.push(args), setSocialStatus: (...args) => state.status.push(args),
        setActorProfileStatus: (...args) => state.status.push(args), setContinuityStatus: (...args) => state.status.push(args),
        setForumStatus: (...args) => state.status.push(args), loadOperationLogFromChat: () => undefined,
        renderForum: () => undefined,
        clearNextTurnConsumerFallback: () => { state.clears += 1; return true; },
        readChatNamespace: () => ({}),
        generationCandidateAllowed: () => ({ allowed: true, generationType: 'normal' }),
        acceptedFinalSnapshot: () => ({ index: -1, swipeId: 0, contentFingerprint: '' }),
        resetCurrentModelCallStats: () => undefined,
        precomposeNextTurnConsumer: async (session) => { state.precomposed.push(session); },
        acceptFinalGeneration: async (session) => { state.accepted.push(session); },
        Date: { now: () => 1 }, Math,
        bindEvents: undefined,
        setTimeout: (callback) => { state.timer = callback; return 1; },
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${bind}\nthis.bindEvents = bindEvents;`, sandbox);
    sandbox.bindEvents();
    await state.callbacks.get('chat_changed')();
    assert.equal(sandbox.currentGenerationEpoch, 8);
    assert.equal(sandbox.automaticPendingKeys.size, 0);
    assert.equal(sandbox.actorProfilePendingKeys.size, 0);
    assert.equal(sandbox.forumPendingKeys.size, 0);
    assert.equal(sandbox.lastGeneration.id, '');
    assert.equal(sandbox.activeNextTurnConsumer, null);
    assert.equal(state.clears, 1);
    assert.equal(state.writes, 0);
    const statusBeforeLateEnded = state.status.length;
    state.callbacks.get('generation_ended')();
    assert.equal(state.status.length, statusBeforeLateEnded);
    assert.equal(state.writes, 0);
    assert.equal(state.releases, 0);
    const invalidatesBeforeNormalStart = state.invalidates;
    await state.callbacks.get('generation_started')('normal', {}, false);
    assert.equal(state.invalidates, invalidatesBeforeNormalStart);
    assert.equal(sandbox.lastGeneration.chatId, 'chat-new');
    assert.notEqual(sandbox.lastGeneration.id, '');
    assert.equal(state.precomposed.length, 1);
    state.callbacks.get('generation_ended')();
    state.timer();
    assert.equal(state.accepted.length, 1);
    assert.equal(state.accepted[0].chatId, 'chat-new');
});

test('event lifecycle runs real current-chat precompose and accept after clearing an old Doctor slot', async () => {
    const commitGate = deferred();
    const identity = sourceSection(
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
        'function acceptedFinalEnvelopeMatchesContext(context, envelope, session)',
    );
    const support = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const dispatch = sourceSection(
        'async function moduleTargetForAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    const ownership = sourceSection(
        'function persistedStaleWorldLeaseOwnership(context, namespace)',
        'function verifiedNextTurnWorldPackage(context, namespace, packet, frozenScope, decisionSink = null)',
    );
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = {
        chatId: 'chat-b', callbacks: new Map(), timers: [], precomposed: 0,
        dispatches: [], identitySaves: 0, writes: 0, providerCleanup: 0,
        fallbackText: '', statuses: [], commitCalls: 0, releases: [],
    };
    const messages = {
        'chat-a': { mes: '<content>A 的自然正文</content>', swipe_id: 0 },
        'chat-b': { mes: '<content>B 的自然正文</content>', swipe_id: 0 },
    };
    const oldActive = {
        generationId: 'generation-a', providerId: 'doctor-extension-prompt', fallback: true,
    };
    const context = () => ({
        chatId: state.chatId,
        chat: [messages[state.chatId]],
        eventTypes: {
            CHAT_CHANGED: 'chat_changed', GENERATION_STARTED: 'generation_started',
            GENERATION_ENDED: 'generation_ended',
        },
        eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
    });
    const scope = () => ({ id: `scope-${state.chatId}` });
    const sandbox = {
        currentGenerationEpoch: 7, operationEpoch: 11, generationSerial: 1,
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
        lastGeneration: { id: 'generation-a', chatId: 'chat-a', epoch: 7, operationEpoch: 11 },
        activeGenerationSession: null, activeNextTurnConsumer: oldActive,
        pendingChatSaveTimer: null, pendingOperationLogSaveTimer: null, pendingAcceptedFinalTimer: null,
        automaticPendingKeys: new Set(['a']), automaticCompletedKeys: new Set(['a']),
        openingSyncPendingKeys: new Set(['a']), openingSyncCompletedKeys: new Set(['a']),
        actorProfilePendingKeys: new Set(['a']), actorProfileCompletedKeys: new Set(['a']),
        forumPendingKeys: new Set(['a']), forumCompletedKeys: new Set(['a']),
        npcDesignTicketBatches: new Map(), pendingSerendipityOpportunities: new Map(),
        actorSovereigntyScopeSelectorCache: new Map(), ui: {}, window: {}, document: { body: { dataset: {} } },
        getContext: context,
        currentActorSovereigntyScope: scope,
        actorSovereigntyScopeDigest: (value) => value.id || '',
        actorSovereigntyScopesMatch: (left, right) => left.id === right.id,
        createActorSovereigntyScope: (value) => ({ ...value }),
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: scope() }),
        currentFinalAssistant: () => ({ index: 0, message: messages[state.chatId] }),
        latestAiMessage: () => ({ index: 0, message: messages[state.chatId] }),
        acceptedFinalSnapshot: () => ({ index: -1, swipeId: 0, contentFingerprint: 'before' }),
        acceptedContentFingerprint: () => 'after', sovereigntyNarrativeEligible: () => true,
        generationCandidateAllowed: () => ({ allowed: true, generationType: 'normal' }),
        ensureMessageStableId: () => `message-${state.chatId}`,
        currentSwipeInfo: () => null, isPlainObject: (value) => !!value && typeof value === 'object',
        scheduleSafeChatSave: () => { state.identitySaves += 1; },
        captureTarget: (_context, index, { frozenScope } = {}) => ({
            chatId: state.chatId, index, messageId: `message-${state.chatId}`, swipeId: 0,
            generationId: sandbox.lastGeneration.id, generationSerial: sandbox.lastGeneration.serial,
            contentFingerprint: 'after', scopeDigest: `scope-${state.chatId}`,
            actorSovereigntyScope: { ...(frozenScope || scope()) }, epoch: 11,
        }),
        commitNextTurnConsumer: async () => true,
        releaseNextTurnConsumer: async (_session, reason) => {
            state.releases.push(reason);
            return true;
        },
        clearLegacyNextTurnSlots: () => true,
        readChatNamespace: () => ({}),
        prepareNpcDesignTicketBatch: () => { state.precomposed += 1; return { tickets: [] }; },
        npcDesignTicketPrompt: () => 'ticket',
        immutableNextTurnConsumerPayload: (_world, ticket) => ({ text: ticket, digest: 'ticket-digest' }),
        setNextTurnConsumerFallback: (text) => { state.fallbackText = text; return true; },
        lastInjectionInspection: {},
        Date: { now: () => 1 }, Math,
        enqueue: (_index, options) => { state.dispatches.push({ kind: 'variable', target: options.queuedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueOpeningResourceSync: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
        runSocialAuditTarget: (target) => { state.dispatches.push(target); return Promise.resolve({ status: 'not_completed' }); },
        enqueueForum: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
        enqueueActorProfiles: (_index, options) => { state.dispatches.push({ kind: 'p1', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        enqueueContinuity: (_index, options) => { state.dispatches.push({ kind: 'p3', target: options.expectedTarget }); return Promise.resolve({ status: 'not_completed' }); },
        continuityProfileRetrySignals: new Map(), stage3AcceptedTargetKey: () => 'p3',
        safeDiagnosticReason: (value) => String(value || ''), recordOperation: () => { state.writes += 1; },
        setStatus: (...args) => state.statuses.push(args), setSocialStatus: () => undefined,
        setActorProfileStatus: () => undefined, setContinuityStatus: () => undefined, setForumStatus: () => undefined,
        clearActorProfileReadShadow: () => undefined, clearTimeout: () => undefined,
        invalidateOperations: () => undefined, resetChatScopedRuntimeDiagnostics: () => undefined,
        currentPendingSovereigntyObservationRecords: () => undefined,
        pendingSerendipityDraft: null, pendingSerendipityBaseline: null, pendingNpcDesignTicketBatch: null,
        downstreamBarrierProtocol: null, downstreamBarrierProtocolChatId: '', continuationIdentityHint: null,
        presetContinuityCache: {}, latestUndoRecord: () => null, loadOperationLogFromChat: () => undefined,
        renderForum: () => undefined, clearNextTurnConsumerFallback: () => true,
        resetCurrentModelCallStats: () => undefined,
        setTimeout: (callback) => { state.timers.push(callback); return state.timers.length; },
    };
    vm.runInNewContext(
        `${lifecycleVmStubs}\n${acceptedFinalFlushSource}\n${identity}\n${support}\n${dispatch}\n${accept}\n${ownership}\n${precompose}\n${bind}\nthis.bindEvents = bindEvents;`,
        sandbox,
    );
    const realCommitNextTurnConsumer = sandbox.commitNextTurnConsumer;
    sandbox.commitNextTurnConsumer = async (...args) => {
        state.commitCalls += 1;
        await commitGate.promise;
        return realCommitNextTurnConsumer(...args);
    };
    sandbox.bindEvents();
    await state.callbacks.get('chat_changed')();
    assert.equal(sandbox.activeNextTurnConsumer, null);
    assert.equal(state.writes, 0);
    assert.equal(state.providerCleanup, 0);

    await state.callbacks.get('generation_started')('normal', {}, false);
    assert.equal(state.precomposed, 1);
    assert.equal(state.fallbackText, 'ticket');
    const bSession = sandbox.lastGeneration;
    state.callbacks.get('generation_ended')();
    const oldTimer = state.timers.at(-1);
    sandbox.document.body.dataset.generating = '';
    await state.callbacks.get('generation_started')('normal', {}, false);
    delete sandbox.document.body.dataset.generating;
    const nextBSession = sandbox.lastGeneration;
    assert.notEqual(nextBSession.id, bSession.id);
    assert.equal(state.precomposed, 2, 'the next generation starts after the old dispatch hand-off');
    assert.equal(state.identitySaves, 1);
    assert.equal(messages['chat-b'].extra.mvu_auto_doctor_generation_id, bSession.id);
    assert.equal(state.dispatches.length, 4);
    assert.equal(state.commitCalls, 1);
    assert.deepEqual(state.dispatches.map((entry) => entry.kind).sort(), ['p1', 'p3', 'p3', 'variable']);
    assert.ok(state.dispatches.every((entry) => entry.target.scopeDigest === 'scope-chat-b'));
    commitGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    oldTimer();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.dispatches.length, 4, 'the cancelled old timer joins/no-ops instead of dispatching twice');
    assert.equal(state.commitCalls, 1);

    state.callbacks.get('generation_ended')();
    state.timers.at(-1)();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.identitySaves, 2);
    assert.equal(messages['chat-b'].extra.mvu_auto_doctor_generation_id, nextBSession.id);
    assert.equal(state.dispatches.length, 8, 'the new generation accepts normally after the flush');
    assert.equal(state.commitCalls, 2);

    await state.callbacks.get('generation_started')('normal', {}, false);
    state.callbacks.get('generation_ended')();
    sandbox.document.body.dataset.generating = '';
    state.timers.at(-1)();
    await new Promise((resolve) => setImmediate(resolve));
    delete sandbox.document.body.dataset.generating;
    assert.equal(state.dispatches.length, 8, 'an ordinary ENDED timer cannot bypass a still-generating host');
    assert.equal(state.commitCalls, 2);

    state.chatId = 'chat-a';
    sandbox.lastGeneration = {
        id: 'generation-return-a', serial: 99, type: 'normal', epoch: sandbox.currentGenerationEpoch,
        operationEpoch: 11, chatId: 'chat-a', frozenScopeDigest: 'scope-chat-a',
        acceptedFinalEligible: true, start: { contentFingerprint: 'before' },
    };
    sandbox.activeGenerationSession = sandbox.lastGeneration;
    await sandbox.precomposeNextTurnConsumer(sandbox.lastGeneration);
    assert.equal(state.providerCleanup, 0);
    assert.equal(state.fallbackText, 'ticket');
    assert.equal(await sandbox.acceptFinalGeneration(sandbox.lastGeneration), true);
    assert.equal(messages['chat-a'].extra.mvu_auto_doctor_generation_id, 'generation-return-a');
});

test('P4 reads the prior producer without rewriting identity and three accepted replies stay unique across refresh', async () => {
    const runtimeIdentity = sourceSection(
        'function runtimeGenerationSerialFloor(context) {',
        'function cardScopeIdentity(context, character) {',
    );
    const candidate = sourceSection(
        'function generationCandidateAllowed(type, params, dryRun)',
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
    );
    const acceptedIdentity = sourceSection(
        'function ensureAcceptedFinalTargetIdentity(context, message, index, generation, {',
        'function acceptedFinalEnvelopeMatchesContext(context, envelope, session)',
    );
    const support = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'async function mutateActorProfileV6',
    );
    const state = {
        callbacks: new Map(), timers: [], dispatches: [], leases: [], consumeProofs: [],
        p4Captures: [], saves: 0,
    };
    const chat = [{ mes: 'opening', is_user: false, is_system: false, swipe_id: 0 }];
    const context = {
        chatId: 'chat-sequence',
        chat,
        eventTypes: {
            GENERATION_STARTED: 'generation_started',
            GENERATION_ENDED: 'generation_ended',
            GENERATION_STOPPED: 'generation_stopped',
        },
        eventSource: { on: (name, callback) => state.callbacks.set(name, callback) },
    };
    const scope = { id: 'scope-sequence' };
    const sandbox = {
        ...acceptedFinalQueueSandboxState(),
        currentGenerationEpoch: 0, operationEpoch: 3, generationSerial: 0,
        activeGenerationSession: null, activeNextTurnConsumer: null,
        foregroundGenerationStarting: null,
        lastGeneration: { id: '', serial: 0, type: 'normal' },
        pendingAcceptedFinalTimer: null, lastInjectionInspection: {}, continuationIdentityHint: null,
        document: { body: { dataset: {} } }, ui: {}, window: {},
        getContext: () => context,
        currentSwipeInfo: (message) => {
            const swipeId = Number(message?.swipe_id) || 0;
            return Array.isArray(message?.swipe_info) ? message.swipe_info[swipeId] || null : null;
        },
        currentFinalAssistant: (value) => {
            const index = value.chat.length - 1;
            const message = value.chat[index];
            return message && !message.is_user && !message.is_system && String(message.mes || '').trim()
                ? { index, message } : { index: -1, message: null };
        },
        isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
        fingerprint: (value) => `fp:${String(value)}`,
        scheduleSafeChatSave: () => { state.saves += 1; },
        ensureMessageStableId: (_context, message, index) => {
            if (!message.extra) message.extra = {};
            if (!message.extra.mvu_auto_doctor_source_id) {
                message.extra.mvu_auto_doctor_source_id = `message-${index}`;
            }
            return message.extra.mvu_auto_doctor_source_id;
        },
        generationCandidateAllowed: undefined,
        acceptedFinalSnapshot: () => {
            const latest = sandbox.currentFinalAssistant(context);
            return {
                index: latest.index,
                swipeId: Number(latest.message?.swipe_id) || 0,
                contentFingerprint: latest.message ? `content:${latest.message.mes}` : '',
            };
        },
        acceptedContentFingerprint: (text) => `content:${text}`,
        sovereigntyNarrativeEligible: (text) => Boolean(String(text || '').trim()),
        currentActorSovereigntyScope: () => scope,
        actorSovereigntyScopeDigest: (value) => value.id,
        actorSovereigntyScopesMatch: (left, right) => left.id === right.id,
        createActorSovereigntyScope: (value) => ({ ...value }),
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope }),
        precomposeNextTurnConsumer: async (session) => {
            const producer = chat.filter((message) => !message.is_user).at(-1);
            const producerIndex = chat.indexOf(producer);
            const before = structuredClone(producer.extra || {});
            const capturedIdentity = sandbox.ensureRuntimeTargetIdentity(
                context,
                producer,
                producerIndex,
                `message-${producerIndex}`,
            );
            assert.deepEqual(producer.extra || {}, before);
            state.p4Captures.push(capturedIdentity);
            const lease = {
                generationId: session.id,
                generationSerial: session.serial,
                generationType: session.type,
                state: 'reserved',
            };
            state.leases.push(lease);
            sandbox.activeNextTurnConsumer = { generationId: session.id, lease };
            session.frozenScopeDigest = scope.id;
            session.p4PlacementScopeDigest = scope.id;
        },
        commitNextTurnConsumer: async (session, envelope) => {
            const active = sandbox.activeNextTurnConsumer;
            assert.equal(active?.generationId, session.id);
            const proof = {
                generationId: session.id,
                generationSerial: session.serial,
                index: envelope.index,
                messageId: envelope.messageId,
                contentFingerprint: envelope.contentFingerprint,
            };
            state.consumeProofs.push(proof);
            sandbox.activeNextTurnConsumer = null;
            return true;
        },
        releaseNextTurnConsumer: async () => true,
        dispatchAcceptedFinal: (envelope) => state.dispatches.push(envelope),
        invalidateOperations: () => undefined,
        resetCurrentModelCallStats: () => undefined,
        preemptHostBackgroundModelControllersForForegroundGeneration: () => 0,
        recordModelDiagnostic: () => undefined,
        recordGenerationLifecycleTrace: () => undefined,
        fixedGenerationLifecycleReason: (value) => String(value || 'other'),
        setStatus: () => undefined,
        clearTimeout: () => undefined,
        setTimeout: (callback) => { state.timers.push(callback); return state.timers.length; },
        Date, Math,
    };
    vm.runInNewContext(
        `${runtimeIdentity}\n${candidate}\n${acceptedIdentity}\n${support}\n${accept}\n${bind}`
        + '\nthis.bindEvents = bindEvents; this.ensureRuntimeTargetIdentity = ensureRuntimeTargetIdentity;',
        sandbox,
    );
    sandbox.bindEvents();
    const openingIdentity = sandbox.ensureRuntimeTargetIdentity(context, chat[0], 0, 'message-0');

    for (let turn = 1; turn <= 3; turn += 1) {
        chat.push({ mes: `player-${turn}`, is_user: true, is_system: false });
        await state.callbacks.get('generation_started')('normal', {}, false);
        const rootSessionId = sandbox.lastGeneration.id;
        await state.callbacks.get('generation_started')('normal', {}, false);
        assert.equal(sandbox.lastGeneration.id, rootSessionId, 'nested allowed STARTED keeps one root session');
        assert.equal(state.leases.length, turn, 'nested STARTED must not place a second lease');
        const previousReply = chat.filter((message) => !message.is_user).at(-1);
        const previousIndex = chat.indexOf(previousReply);
        const previousExtra = structuredClone(previousReply.extra || {});
        const previousIdentity = sandbox.ensureRuntimeTargetIdentity(
            context,
            previousReply,
            previousIndex,
            `message-${previousIndex}`,
        );
        assert.deepEqual(previousReply.extra || {}, previousExtra, 'P4 capture must not rewrite old identity');
        if (turn > 1) {
            assert.equal(previousIdentity.generationId, state.consumeProofs.at(-1).generationId);
        }
        const priorExtra = structuredClone(previousReply.extra || {});
        const reply = {
            mes: `natural-reply-${turn}`, is_user: false, is_system: false, swipe_id: 0,
            extra: priorExtra,
        };
        chat.push(reply);
        const index = chat.length - 1;
        sandbox.ensureRuntimeTargetIdentity(context, reply, index, `message-${index}`);
        state.callbacks.get('generation_ended')();
        assert.equal(state.timers.length, turn, 'ENDED schedules exactly one 500ms final read');
        const sessionBeforeTailDryRun = sandbox.lastGeneration.id;
        await state.callbacks.get('generation_started')('normal', {}, true);
        assert.equal(sandbox.lastGeneration.id, sessionBeforeTailDryRun);
        assert.equal(state.timers.length, turn, 'tail dryRun STARTED remains ignored');
        state.timers.at(-1)();
        await new Promise((resolve) => setImmediate(resolve));
    }

    const assistants = chat.filter((message) => !message.is_user);
    const identities = [openingIdentity.generationId, ...assistants.slice(1)
        .map((message) => message.extra.mvu_auto_doctor_generation_id)];
    const serials = [openingIdentity.generationSerial, ...assistants.slice(1)
        .map((message) => message.extra.mvu_auto_doctor_generation_serial)];
    assert.equal(new Set(identities).size, 4);
    assert.deepEqual(serials, [0, 1, 2, 3]);
    assert.equal(state.leases.length, 3);
    assert.equal(state.p4Captures.length, 3);
    assert.equal(state.p4Captures[0].generationId, openingIdentity.generationId);
    assert.equal(state.p4Captures[1].generationId, state.consumeProofs[0].generationId);
    assert.equal(state.p4Captures[2].generationId, state.consumeProofs[1].generationId);
    assert.equal(state.consumeProofs.length, 3);
    assert.equal(state.dispatches.length, 3);
    const thirdReply = assistants.at(-1);
    const thirdProof = state.consumeProofs.at(-1);
    assert.equal(thirdProof.generationId, thirdReply.extra.mvu_auto_doctor_generation_id);
    assert.equal(thirdProof.generationSerial, 3);
    assert.equal(thirdProof.index, chat.length - 1);
    assert.equal(thirdProof.messageId, thirdReply.extra.mvu_auto_doctor_source_id);

    const beforeRefresh = structuredClone({ identities, serials, proofs: state.consumeProofs });
    sandbox.generationSerial = 0;
    sandbox.lastGeneration = { id: '', serial: 0, type: 'normal' };
    sandbox.activeGenerationSession = null;
    const refreshed = assistants.map((message) => {
        const index = chat.indexOf(message);
        return sandbox.ensureRuntimeTargetIdentity(context, message, index, `message-${index}`);
    });
    assert.deepEqual(
        refreshed.map((identity) => identity.generationId),
        beforeRefresh.identities,
    );
    assert.deepEqual(
        refreshed.map((identity) => identity.generationSerial),
        beforeRefresh.serials,
    );
    assert.deepEqual(state.consumeProofs, beforeRefresh.proofs);
    assert.equal(state.dispatches.length, 3, 'refresh must not redispatch or consume again');
});

test('fresh accepted scope is authoritative when P4 did not place a slot', () => {
    const decide = loadAcceptedFinalScopeDecision();
    assert.deepEqual(
        { ...decide({ frozenScopeDigest: 'p4-attempt-only' }, 'fresh-final-scope') },
        { ok: true, reason: '', scopeDigest: 'fresh-final-scope' },
    );
    assert.deepEqual(
        { ...decide({ frozenScopeDigest: 'ticket-only-attempt' }, 'fresh-final-scope') },
        { ok: true, reason: '', scopeDigest: 'fresh-final-scope' },
    );
    assert.deepEqual(
        { ...decide({ p4PlacementScopeDigest: 'fresh-final-scope' }, 'fresh-final-scope') },
        { ok: true, reason: '', scopeDigest: 'fresh-final-scope' },
    );
    assert.deepEqual(
        { ...decide({ p4PlacementScopeDigest: 'p4-placed-scope' }, 'fresh-final-scope') },
        { ok: false, reason: 'p4_scope_stale', scopeDigest: '' },
    );
    assert.deepEqual(
        { ...decide({}, '') },
        { ok: false, reason: 'scope_unavailable', scopeDigest: '' },
    );

    const accept = sourceSection(
        'async function acceptFinalGeneration(generation)',
        'function frozenIdentityScopeId(scope)',
    );
    assert.match(accept, /recordAcceptedFinalRejection\(generation, reason\)/u);
    assert.match(
        accept,
        /acceptedFinalScopeDecision\([\s\S]*?actorSovereigntyScopeDigest\(scopeResolution\.scope\)/u,
    );
    assert.match(accept, /generation\.frozenScopeDigest = scopeDigest/u);
    assert.match(accept, /return reject\(scopeDecision\.reason\)/u);
    assert.match(accept, /dispatchAcceptedFinal\(envelope,\s*\{/u);
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    assert.match(precompose, /if \(packet\) session\.p4PlacementScopeDigest = scopeDigest/u);
});

function loadAcceptedTargetMatcher(operationEpoch = 7) {
    const code = sourceSection(
        'function sameTargetExceptContent(left, right)',
        'function continuityTargetIsCurrent(captured, token)',
    );
    const sandbox = { operationEpoch };
    vm.runInNewContext(`${code}\nthis.sameAcceptedNarrativeTarget = sameAcceptedNarrativeTarget;`, sandbox);
    return sandbox.sameAcceptedNarrativeTarget;
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
        generationSerial: 2,
        generationType: 'normal',
        identityScopeId: 'chat-a|character:card-main',
        scopeDigest: 'scope:chat-a|character:card-main',
        epoch: 7,
        ...overrides,
    };
}

function loadContinuityQueueHarness({ expected, fresh = expected, worldResult = null }) {
    const staleSupport = sourceSection(
        'function stage3StaleValidationCode(reason)',
        'function stage3AcceptedTargetIsStrictlyNewer(currentValue, priorValue)',
    );
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
        statuses: [],
    };
    const sandbox = {
        operationEpoch: 7,
        actorWorldManagementWrite: null,
        continuityChain: Promise.resolve(),
        continuityPendingKeys: new Map(),
        continuityCompletedKeys: new Set(),
        continuityProfileRetrySignals: new Map(),
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
            target?.contentFingerprint,
        ].join(':'),
        stage3AcceptedTarget: (target) => {
            if (!target) return null;
            const accepted = {
                chatId: String(target.chatId || ''),
                index: Math.max(0, Number(target.index) || 0),
                messageId: String(target.messageId || ''),
                swipeId: Math.max(0, Number(target.swipeId) || 0),
                generationSerial: Math.max(0, Number(target.generationSerial) || 0),
                generationId: String(target.generationId || ''),
                generationType: String(target.generationType || ''),
                scopeDigest: String(target.scopeDigest || ''),
                contentFingerprint: String(target.contentFingerprint || target.fingerprint || ''),
            };
            return accepted.chatId && accepted.messageId && accepted.generationId
                && accepted.generationType && accepted.scopeDigest
                && accepted.contentFingerprint ? accepted : null;
        },
        stage3AcceptedTargetsMatch: (left, right) => !!(
            left
            && right
            && left.chatId === right.chatId
            && left.index === right.index
            && left.messageId === right.messageId
            && left.swipeId === right.swipeId
            && left.generationSerial === right.generationSerial
            && left.generationId === right.generationId
            && left.generationType === right.generationType
            && left.scopeDigest === right.scopeDigest
            && left.contentFingerprint === right.contentFingerprint
        ),
        stage3AcceptedTargetKey: (target) => {
            if (!target?.chatId || !target?.messageId || !target?.scopeDigest
                || !(target?.contentFingerprint || target?.fingerprint)) return '';
            return [
                target.chatId,
                target.index,
                target.messageId,
                target.swipeId,
                target.generationSerial,
                target.generationId,
                target.generationType,
                target.scopeDigest,
                target.contentFingerprint || target.fingerprint,
            ].join(':');
        },
        runContinuityTarget: async () => {
            state.starts += 1;
            if (worldResult) return worldResult;
            await gate.promise;
            state.writes += 1;
            return { status: 'applied' };
        },
        recordStage3WorldFinalDiagnostic: () => undefined,
        safeDiagnosticReason: (value) => String(value || ''),
        setContinuityStatus: (...args) => state.statuses.push(args),
        scheduleSovereigntyAutoRetry: () => {
            state.autoRetries += 1;
        },
        sovereigntyRuntimeFromNamespace: () => ({}),
        readChatNamespace: () => ({}),
        renderSovereigntyHealth: () => undefined,
        syncTaskCancelButtons: () => undefined,
    };
    vm.runInNewContext(`${staleSupport}\n${code}\nthis.enqueueContinuity = enqueueContinuity;`, sandbox);
    return {
        enqueue: (options = {}) => sandbox.enqueueContinuity(expected.index, {
            expectedTarget: expected,
            ...options,
        }),
        gate,
        state,
    };
}

test('accepted-final dispatch starts P3 independently and lets P1 readback issue an idempotent wake', async () => {
    const handler = sourceSection(
        'function dispatchAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    const profileAt = handler.indexOf("launchScoped('人物档案'");
    const profileEnqueueAt = handler.indexOf('const profileTask = enqueueActorProfiles', profileAt);
    const profileReadbackAt = handler.indexOf("['atomic_readback', 'no_candidates', 'not_completed']", profileEnqueueAt);
    const profileRetryAt = handler.indexOf('await wakeContinuityAfterProfileTerminal(', profileReadbackAt);
    assert.ok(profileAt >= 0 && profileEnqueueAt > profileAt);
    assert.ok(profileReadbackAt > profileEnqueueAt);
    assert.ok(profileRetryAt > profileReadbackAt);
    assert.match(
        handler.slice(profileAt),
        /\['atomic_readback', 'no_candidates', 'not_completed'\][\s\S]*?await wakeContinuityAfterProfileTerminal\(/u,
    );
    assert.match(handler, /launchScoped\('世界连续性'[\s\S]*?enqueueContinuity/u);
    assert.doesNotMatch(
        handler,
        /createTargetSettlementRecord|barrierRecord|waitAutomaticTargetSettled|isDuringExtraAnalysis|getMvuData/u,
    );
    assert.match(handler, /Promise\.allSettled\(\[variableTask, \.\.\.moduleTasks\]\)/u);
    assert.match(handler, /doctorTotalMs: Date\.now\(\) - acceptedAt/u);

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
    assert.equal(
        matches(target, makeTarget({ branchId: 'legacy-branch-only' })),
        true,
        'a persisted legacy branch marker does not become a canonical identity field',
    );
    for (const changed of [
        { contentFingerprint: 'accepted-b' },
        { generationId: 'generation-b' },
        { chatId: 'chat-b' },
        { messageId: 'message-b' },
        { swipeId: 1 },
    ]) {
        assert.equal(matches(target, makeTarget(changed)), false, JSON.stringify(changed));
    }
    const changedEpochMatches = loadAcceptedTargetMatcher(8);
    assert.equal(changedEpochMatches(target, makeTarget({ epoch: 8 })), false);
});

test('pre-model P3 stale receipts are fixed-code zero-write evidence for safe P1 handoff', () => {
    const code = sourceSection(
        'function stage3StaleValidationCode(reason)',
        'function stage3AcceptedTargetIsStrictlyNewer(currentValue, priorValue)',
    );
    const sandbox = {};
    vm.runInNewContext(
        `${code}\nthis.makeStale = stage3ZeroWriteStaleResult;`,
        sandbox,
    );
    const owner = sandbox.makeStale('world_task_owner_changed');
    assert.deepEqual(JSON.parse(JSON.stringify(owner)), {
        status: 'stale',
        reason: 'world_task_owner_changed',
        validationCode: 'world.stale.owner_changed',
        module: 'world',
        zeroWrite: true,
        worldModelCalls: 0,
    });
    const drift = sandbox.makeStale('人物主权作用域已经变化');
    assert.equal(drift.validationCode, 'world.stale.target_changed');
    assert.equal(drift.zeroWrite, true);
    assert.equal(drift.worldModelCalls, 0);
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
    assert.deepEqual(
        storm.state.statuses.at(-1),
        ['世界连续性：本回合因果已整理并保存，终态为已提交。', 'ok'],
    );

    const mechanism = loadContinuityQueueHarness({
        expected: target,
        fresh: makeTarget({ fingerprint: 'whole-message-after-mechanism-refresh' }),
        worldResult: { status: 'applied' },
    });
    assert.equal((await mechanism.enqueue()).status, 'applied');
    assert.equal(mechanism.state.starts, 1);

    const recovered = loadContinuityQueueHarness({
        expected: target,
        worldResult: { status: 'applied', recovered: true, worldModelCalls: 0 },
    });
    assert.equal((await recovered.enqueue()).status, 'applied');
    assert.deepEqual(
        recovered.state.statuses.at(-1),
        ['世界连续性：本回合已完成，终态为已提交，持久记录已确认。', 'ok'],
    );

    for (const changed of [
        { contentFingerprint: 'accepted-b' },
        { generationSerial: 3 },
        { scopeDigest: 'scope:chat-a|character:card-other' },
        { chatId: 'chat-b' },
        { messageId: 'message-b' },
        { swipeId: 1 },
    ]) {
        const stale = loadContinuityQueueHarness({
            expected: target,
            fresh: makeTarget(changed),
            worldResult: { status: 'applied' },
        });
        const result = await stale.enqueue();
        assert.equal(result.status, 'stale', JSON.stringify(changed));
        assert.equal(result.module, 'world', JSON.stringify(changed));
        assert.equal(result.zeroWrite, true, JSON.stringify(changed));
        assert.equal(result.worldModelCalls, 0, JSON.stringify(changed));
        assert.match(result.validationCode, /^world\.stale\./u, JSON.stringify(changed));
        assert.equal(stale.state.starts, 0, JSON.stringify(changed));
        assert.equal(stale.state.writes, 0, JSON.stringify(changed));
    }
});

test('P1 wake coalesces behind an in-flight accepted-final P3 without a duplicate world run', async () => {
    const target = makeTarget();
    const queue = loadContinuityQueueHarness({ expected: target });
    const first = queue.enqueue();
    const wake = queue.enqueue({
        afterPending: true,
        noActorPermit: { status: 'no_candidates' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.state.starts, 1);
    queue.gate.resolve();
    assert.equal((await first).status, 'applied');
    assert.equal((await wake).status, 'applied');
    assert.equal(queue.state.starts, 1);
    assert.equal(queue.state.writes, 1);
});

test('P1 wake does not resend a failed accepted target, while explicit force can retry it', async () => {
    const target = makeTarget();
    const queue = loadContinuityQueueHarness({
        expected: target,
        worldResult: {
            status: 'failed',
            reason: 'world_targeted_repair_invalid',
            validationCode: 'world.semantic_progress_missing',
        },
    });
    assert.equal((await queue.enqueue()).status, 'failed');
    assert.equal(queue.state.starts, 1);
    const wake = await queue.enqueue({ afterPending: true });
    assert.equal(wake.status, 'duplicate');
    assert.equal(queue.state.starts, 1, 'P1 idempotent wake cannot issue a second full P3 run');
    assert.equal((await queue.enqueue({ force: true })).status, 'failed');
    assert.equal(queue.state.starts, 2, 'the existing explicit recovery control remains available');
});

test('an in-flight failed P3 is joined verbatim by P1 without recursive enqueue', async () => {
    const target = makeTarget();
    const queue = loadContinuityQueueHarness({
        expected: target,
        worldResult: {
            status: 'failed',
            reason: 'world_targeted_repair_invalid',
            validationCode: 'world.actor.adjudication_contract_invalid',
        },
    });
    const first = queue.enqueue();
    const wake = queue.enqueue({ afterPending: true });
    assert.equal((await first).status, 'failed');
    const joined = await wake;
    assert.equal(joined.status, 'failed');
    assert.equal(joined.validationCode, 'world.actor.adjudication_contract_invalid');
    assert.equal(queue.state.starts, 1);
    const queueSource = sourceSection(
        'async function enqueueContinuity(targetId, {',
        'function stage3AttemptProjection(ledger, target)',
    );
    const afterPendingBranch = queueSource.slice(
        queueSource.indexOf('if (afterPending)'),
        queueSource.indexOf("return { status: 'duplicate', reason: 'world_target_pending' }"),
    );
    assert.doesNotMatch(afterPendingBranch, /enqueueContinuity\(/u);
});

test('Doctor keeps the external database outside its event and promise ownership', () => {
    const handler = sourceSection(
        'function dispatchAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    assert.doesNotMatch(handler, /AutoCardUpdater|TavernDB|database-final-reply-bridge|thirdParty.*CRUD/iu);
    assert.doesNotMatch(handler, /waitForTargetSettled\([^)]*database|runAfterTargetSettled\([^)]*database/iu);
    assert.doesNotMatch(source, /integrations\/database-final-reply-bridge\.js/u);
});
