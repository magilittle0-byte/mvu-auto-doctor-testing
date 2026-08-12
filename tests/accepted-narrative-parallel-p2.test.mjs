import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const lifecycleVmStubs = `
let generationLifecycleTrace = [];
function fixedGenerationLifecycleReason(value) { return String(value || 'other'); }
function recordGenerationLifecycleTrace() {}
`;

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

test('R9 generation candidate rejection kinds remain precise and fail-closed', () => {
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
});

test('R9 explicit invalid lifecycle types stay diagnostic-only at the event gate', async () => {
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
        'function dualSurfaceRollbackSummary()',
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
        const state = { callbacks: new Map(), p4: 0, model: 0, identity: 0, tasks: 0, busy: 0, statuses: 0 };
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
        assert.equal(sandbox.lastGeneration.acceptedFinalEligible, false, reason);
        assert.equal(sandbox.lastGeneration.rejectionKind, reason, reason);
        assert.equal(state.p4, 0, reason);
        assert.equal(state.model, 0, reason);
        assert.equal(state.identity, 0, reason);
        assert.equal(state.tasks, 0, reason);
        assert.equal(state.busy, 0, reason);
        assert.equal(state.statuses, 1, reason);
    }
});

test('R9 default opening keeps Doctor inert and rejection traces stay diagnostic-only', () => {
    const bind = sourceSection(
        'function bindEvents()',
        'function dualSurfaceRollbackSummary()',
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
        'function dualSurfaceRollbackSummary()',
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
        identitySaves: 0,
        dispatches: [],
        releases: [],
        statuses: [],
        operationWrites: 0,
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
    };
    const sandbox = {
        currentGenerationEpoch: currentEpoch,
        operationEpoch: currentOperationEpoch,
        lastGeneration: generation,
        getContext: () => ({ chatId, chat: [message] }),
        document: { body: { dataset: {} } },
        currentFinalAssistant: () => ({ index: 0, message }),
        sovereigntyNarrativeEligible: () => true,
        acceptedContentFingerprint: () => 'after',
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: state.scope }),
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
            if (scopeChangesAfterCommit) {
                state.scope = { ...state.scope, runtimeVersion: 'rc14-changed' };
            }
            return true;
        },
        releaseNextTurnConsumer: async (_session, reason, options) => {
            state.releases.push({ reason, options });
            return true;
        },
        dispatchAcceptedFinal: (envelope) => state.dispatches.push(envelope),
        setStatus: (text, kind, options) => state.statuses.push({ text, kind, options }),
        recordOperation: () => { state.operationWrites += 1; },
    };
    vm.runInNewContext(`${lifecycleVmStubs}\n${identity}\n${support}\n${accept}\nthis.acceptFinalGeneration = acceptFinalGeneration;`, sandbox);
    return { state, generation, accept: sandbox.acceptFinalGeneration, sandbox };
}

function loadAcceptedFinalFullDispatchHarness() {
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
    const state = {
        scope: { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
        dispatchedTargets: [],
        errors: [],
    };
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
        return Promise.resolve({ status: 'not_completed' });
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
        commitNextTurnConsumer: async () => true,
        releaseNextTurnConsumer: async () => true,
        enqueue: (_index, options) => captureUse(options.queuedTarget),
        enqueueOpeningResourceSync: (_index, options) => captureUse(options.expectedTarget),
        runSocialAuditTarget: captureUse,
        enqueueForum: (_index, options) => captureUse(options.expectedTarget),
        enqueueActorProfiles: (_index, options) => captureUse(options.expectedTarget),
        enqueueContinuity: (_index, options) => captureUse(options.expectedTarget),
        continuityProfileRetrySignals: new Map(),
        stage3AcceptedTargetKey: () => 'stage3-key',
        safeDiagnosticReason: (value) => String(value || ''),
        recordOperation: (...args) => state.errors.push(args),
        setStatus: () => undefined,
    };
    vm.runInNewContext(
        `${lifecycleVmStubs}\n${support}\n${dispatch}\n${accept}\nthis.acceptFinalGeneration = acceptFinalGeneration;`,
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
    assert.equal(await scopeChanged.accept(scopeChanged.generation), false);
    assert.equal(scopeChanged.state.identitySaves, 1);
    assert.equal(scopeChanged.state.dispatches.length, 0);
});

test('actual dispatch gives every accepted-final consumer the same frozen target', async () => {
    const runtime = loadAcceptedFinalFullDispatchHarness();
    assert.equal(await runtime.accept(runtime.generation), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(runtime.state.dispatchedTargets.length >= 6);
    for (const target of runtime.state.dispatchedTargets) {
        assert.equal(target.scopeDigest, 'chat-a|character:card-a|rc14');
        assert.deepEqual(
            { ...target.actorSovereigntyScope },
            { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' },
        );
    }
    assert.deepEqual(runtime.state.errors, []);
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
    tombstoned = false,
    cleanupFailed = false,
} = {}) {
    const sessionSupport = sourceSection(
        'function acceptedFinalScopeDecision(generation, scopeDigest)',
        'async function moduleTargetForAcceptedFinal(envelope)',
    );
    const ownership = sourceSection(
        'function persistedStaleWorldLeaseOwnership(context, namespace)',
        'function verifiedNextTurnWorldPackage(context, namespace, packet, frozenScope)',
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
        injectionInspection: {},
    };
    const session = {
        id: 'generation-current', serial: 5, type: 'normal', epoch: 9,
        operationEpoch: 11, chatId: 'chat-a', frozenScopeDigest: 'scope-current',
        acceptedFinalEligible: true,
    };
    const lease = {
        state: cleanupFailed ? 'cleanup_failed' : 'reserved',
        chatId: 'chat-a', generationId: 'generation-old',
        generationSerial: 4, generationType: 'normal', scopeDigest: 'scope-old',
        expectedScopeDigest: 'scope-old', consumerPayloadDigest: 'old-payload',
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
        clearLegacyNextTurnSlots: () => true,
        nextTurnConsumerTombstoneForChat: () => (tombstoned ? { chatId: 'chat-a' } : null),
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
        nextTurnConsumerLeaseToken: () => 'new-lease',
        selectNextTurnConsumerProvider: () => ({ provider: null, conflict: false }),
        setNextTurnConsumerFallback: (text) => { state.fallbackText = text; return true; },
        lastInjectionInspection: state.injectionInspection,
        Date: { now: () => 1 },
    };
    vm.runInNewContext(`${sessionSupport}\n${ownership}\n${precompose}\nthis.precomposeNextTurnConsumer = precomposeNextTurnConsumer;`, sandbox);
    return { state, session, precompose: sandbox.precomposeNextTurnConsumer };
}

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
});

test('returning to a chat with an external-provider tombstone never retries cleanup', async () => {
    const runtime = loadP4StaleLeasePrecomposeHarness({ tombstoned: true, externalProvider: true });
    await runtime.precompose(runtime.session);
    assert.equal(runtime.state.writes, 0);
    assert.equal(runtime.state.fallbackClears, 0);
    assert.equal(runtime.state.ticketBatches, 0);
    assert.equal(runtime.state.fallbackText, '');
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

async function runCleanupFailedAcceptedFinalLifecycle({ type, useProductionCandidate }) {
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
        'function dualSurfaceRollbackSummary()',
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
    };
    const message = { mes: '<content>Natural final text.</content>', swipe_id: 1 };
    const scope = { chatId: 'chat-a', cardId: 'character:card-a', runtimeVersion: 'rc14' };
    const sandbox = {
        currentGenerationEpoch: 4,
        generationSerial: 8,
        operationEpoch: 12,
        activeGenerationSession: null,
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
        setStatus: () => undefined,
        setTimeout: (callback) => { state.timer = callback; return 1; },
        clearTimeout: () => undefined,
        Date: { now: () => 7 },
        Math,
    };
    vm.runInNewContext(
        `${lifecycleVmStubs}\n${candidate}\n${identity}\n${support}\n${dispatch}\n${accept}\n${precompose}\n${bind}\nthis.bindEvents = bindEvents;`,
        sandbox,
    );
    sandbox.bindEvents();

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
    const p1 = state.dispatches.find(({ kind }) => kind === 'p1')?.target;
    const p3 = state.dispatches.find(({ kind }) => kind === 'p3')?.target;
    assert.ok(p1);
    assert.ok(p3);
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
        'function dualSurfaceRollbackSummary()',
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
        'function dualSurfaceRollbackSummary()',
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
        'function dualSurfaceRollbackSummary()',
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
        'function dualSurfaceRollbackSummary()',
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

test('actual chat-change handler isolates old provider state so the new chat can start and accept normally', async () => {
    const bind = sourceSection(
        'function bindEvents()',
        'function dualSurfaceRollbackSummary()',
    );
    const state = {
        writes: 0, releases: 0, invalidates: 0, callbacks: new Map(), status: [], precomposed: [], accepted: [],
    };
    const oldSession = {
        id: 'generation-old', chatId: 'chat-old', epoch: 7, operationEpoch: 11,
        providerLease: { chatId: 'chat-old' },
    };
    const sandbox = {
        ui: {}, window: {}, document: {},
        activeGenerationSession: oldSession,
        activeNextTurnConsumer: { generationId: 'generation-old', fallback: false },
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
        renderForum: () => undefined, clearNextTurnConsumerFallback: () => { throw new Error('must not clear provider'); },
        retireNextTurnConsumerForChat: (active) => {
            state.retired = active;
            return true;
        },
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
    assert.equal(state.retired.generationId, 'generation-old');
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

test('event lifecycle runs real current-chat precompose and accept after an old-chat provider tombstone', async () => {
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
    const tombstones = sourceSection(
        'function retireNextTurnConsumerForChat(active, reason = \'chat_changed\')',
        'async function writeNextTurnConsumerLease(session, scopeDigest, payload, provider, leaseToken = \'\')',
    );
    const precompose = sourceSection(
        'async function precomposeNextTurnConsumer(session)',
        'async function commitNextTurnConsumer(session, envelope)',
    );
    const bind = sourceSection(
        'function bindEvents()',
        'function dualSurfaceRollbackSummary()',
    );
    const state = {
        chatId: 'chat-b', callbacks: new Map(), timers: [], precomposed: 0,
        dispatches: [], identitySaves: 0, writes: 0, providerCleanup: 0,
        fallbackText: '', statuses: [],
    };
    const messages = {
        'chat-a': { mes: '<content>A 的自然正文</content>', swipe_id: 0 },
        'chat-b': { mes: '<content>B 的自然正文</content>', swipe_id: 0 },
    };
    const oldActive = {
        generationId: 'generation-a', providerId: 'external-provider', fallback: false,
        providerLease: { chatId: 'chat-a' },
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
        lastGeneration: { id: 'generation-a', chatId: 'chat-a', epoch: 7, operationEpoch: 11 },
        activeGenerationSession: null, activeNextTurnConsumer: oldActive,
        retiredNextTurnConsumerTombstones: new Map(),
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
        releaseNextTurnConsumer: async () => { throw new Error('no release is expected'); },
        clearLegacyNextTurnSlots: () => true,
        nextTurnConsumerTombstoneForChat: (chatId) => sandbox.retiredNextTurnConsumerTombstones.get(chatId) || null,
        readChatNamespace: () => ({}),
        prepareNpcDesignTicketBatch: () => { state.precomposed += 1; return { tickets: [] }; },
        npcDesignTicketPrompt: () => 'ticket',
        immutableNextTurnConsumerPayload: (_world, ticket) => ({ text: ticket, digest: 'ticket-digest' }),
        nextTurnConsumerLeaseToken: () => 'lease-token',
        selectNextTurnConsumerProvider: () => ({ provider: null, conflict: false }),
        setNextTurnConsumerFallback: (text) => { state.fallbackText = text; return true; },
        lastInjectionInspection: {},
        Date: { now: () => 1 }, Math,
        enqueue: (_index, options) => { state.dispatches.push(options.queuedTarget); return Promise.resolve({ status: 'not_completed' }); },
        enqueueOpeningResourceSync: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
        runSocialAuditTarget: (target) => { state.dispatches.push(target); return Promise.resolve({ status: 'not_completed' }); },
        enqueueForum: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
        enqueueActorProfiles: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
        enqueueContinuity: (_index, options) => { state.dispatches.push(options.expectedTarget); return Promise.resolve({ status: 'not_completed' }); },
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
        `${lifecycleVmStubs}\n${identity}\n${support}\n${dispatch}\n${accept}\n${tombstones}\n${precompose}\n${bind}\nthis.bindEvents = bindEvents;`,
        sandbox,
    );
    sandbox.bindEvents();
    await state.callbacks.get('chat_changed')();
    assert.equal(sandbox.activeNextTurnConsumer, null);
    assert.equal(sandbox.retiredNextTurnConsumerTombstones.get('chat-a').providerId, 'external-provider');
    assert.equal(state.writes, 0);
    assert.equal(state.providerCleanup, 0);

    await state.callbacks.get('generation_started')('normal', {}, false);
    assert.equal(state.precomposed, 1);
    assert.equal(state.fallbackText, 'ticket');
    const bSession = sandbox.lastGeneration;
    state.callbacks.get('generation_ended')();
    state.timers.at(-1)();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.identitySaves, 1);
    assert.equal(messages['chat-b'].extra.mvu_auto_doctor_generation_id, bSession.id);
    assert.ok(state.dispatches.length >= 6);
    assert.ok(state.dispatches.every((target) => target.scopeDigest === 'scope-chat-b'));

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
    assert.match(accept, /dispatchAcceptedFinal\(envelope\)/u);
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
        generationSerial: 2,
        branchId: 'branch-a',
        identityScopeId: 'chat-a|character:card-main',
        scopeDigest: 'scope:chat-a|character:card-main',
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
            target?.branchId,
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
                scopeDigest: String(target.scopeDigest || ''),
                contentFingerprint: String(target.contentFingerprint || target.fingerprint || ''),
            };
            return accepted.chatId && accepted.messageId && accepted.scopeDigest
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
        safeDiagnosticReason: (value) => String(value || ''),
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

test('accepted-final dispatch starts P1 and P3 without a barrier or MVU-stability wait', async () => {
    const handler = sourceSection(
        'function dispatchAcceptedFinal(envelope)',
        'async function acceptFinalGeneration(generation)',
    );
    const profileAt = handler.indexOf("launchScoped('人物档案'");
    const profileEnqueueAt = handler.indexOf('const profileTask = enqueueActorProfiles', profileAt);
    const profileReadbackAt = handler.indexOf("['atomic_readback', 'no_candidates']", profileEnqueueAt);
    const profileRetryAt = handler.indexOf('void enqueueContinuity(envelope.index', profileReadbackAt);
    const worldAt = handler.indexOf("launchScoped('世界连续性'", profileRetryAt);
    const worldEnqueueAt = handler.indexOf('enqueueContinuity(envelope.index', worldAt);
    assert.ok(profileAt >= 0 && profileEnqueueAt > profileAt);
    assert.ok(profileReadbackAt > profileEnqueueAt);
    assert.ok(profileRetryAt > profileReadbackAt);
    assert.ok(worldAt > profileRetryAt && worldEnqueueAt > worldAt);
    assert.match(
        handler.slice(profileAt, worldAt),
        /continuityProfileRetrySignals\.set[\s\S]*?void enqueueContinuity\(envelope\.index/u,
    );
    assert.doesNotMatch(
        handler,
        /createTargetSettlementRecord|barrierRecord|waitAutomaticTargetSettled|isDuringExtraAnalysis|getMvuData/u,
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
        assert.equal(stale.state.starts, 0, JSON.stringify(changed));
        assert.equal(stale.state.writes, 0, JSON.stringify(changed));
    }
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
