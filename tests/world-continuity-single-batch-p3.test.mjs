import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    advanceContinuityClocks,
    applyWorldUpdate,
    continuityGlobalHoldIsVerifiable,
    continuityLifecycleStats,
    continuityScenarioDigest,
    continuityWorldDigest,
    enforceContinuityPolicy,
    mergeMarkerRecords,
    normalizeContinuityState,
    normalizeSourceRef,
    parseContinuityOutput,
} from '../continuity-core.mjs';
import {
    actorLedgerDigest,
    emptyActorLedger,
    normalizeActorLedger,
} from '../actor-ledger-core.mjs';
import {
    actorActionTargetMatches,
    validateWorldAdjudicationBatch,
} from '../actor-authority-core.mjs';
import { parseActorShardProposal } from '../actor-shard-core.mjs';
import {
    extractFirstBalancedJsonObject,
    sovereigntySourceKey,
} from '../sovereignty-runtime-core.mjs';
import {
    actorProfileNoCandidatesTerminalProofMatches,
    actorProfileDiscoveryCoveragePlan,
    actorProfileRecoverySourceMatches,
    createActorProfileNoCandidatesTerminalProof,
} from '../actor-profile-v6-core.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('world prompts use a bounded semantic profile projection and expose a separate recovery control', () => {
    const promptView = sourceSection(
        'function stage3WorldProfilePromptView(',
        'function stage3WorldThreadPromptView(',
    );
    assert.match(promptView, /const profile = actorProfileV6View\(actor\)/u);
    assert.match(promptView, /narrativeSections: Object\.fromEntries/u);
    assert.doesNotMatch(promptView, /moduleStatuses|historyCount|fieldSourceCount|designRolls/u);
    assert.match(source, /mvuad-floating-continuity-run[^>]*>继续\/恢复世界连续性</u);
    assert.match(source, /mvuad-world-run[^>]*>继续\/恢复世界连续性</u);
    assert.match(source, /mvuad-floating-continuity-run'[\s\S]*?enqueueContinuity\(null, \{ force: true, manualRecovery: true \}\)/u);
    assert.match(source, /mvuad-world-run'[\s\S]*?enqueueContinuity\(null, \{ force: true, manualRecovery: true \}\)/u);
});

test('world prompt sends one recalled material block and the compact ownership/output contract', () => {
    const messages = sourceSection(
        'function buildContinuityMessages({',
        'async function generateWorldContinuitySingleBatch',
    );
    assert.match(messages, /const compactSystem = \[/u);
    assert.match(messages, /const buildCompactUser = \(worldbookEvidence = ''\) => \[/u);
    assert.match(messages, /content: compactSystem/u);
    assert.match(messages, /content: compactUser/u);
    assert.doesNotMatch(messages, /content: system \}/u);
    assert.doesNotMatch(messages, /requiredPrefix \+ optionalUser/u);
    assert.match(messages, /Identity Confirmation.*MVU自动医生.*世界连续性医师/u);
    assert.match(messages, /人物尝试不等于世界结果/u);
    assert.match(messages, /未ready或未召回人物不得获得本轮自主行动/u);
    assert.match(messages, /技术身份、尝试编号、账本字段/u);
    assert.match(messages, /本地把它规范为安全的held\/delayed收据/u);
    assert.match(messages, /输出最小形状/u);
    assert.match(messages, /STAGE3_WORLD_MODEL_INPUT_MAX_CHARS/u);
    assert.doesNotMatch(messages, /world_prompt_projection_budget_exceeded/u);
    const runtimeFingerprint = sourceSection(
        'function doctorRuntimeCriticalFingerprint()',
        'function diagnosticPayload()',
    );
    [
        'stage3WorldPromptText',
        'stage3WorldPromptValue',
        'stage3WorldProfilePromptView',
        'stage3WorldActorPromptView',
        'stage3WorldThreadPromptView',
        'stage3WorldRecallPromptView',
        'stage3WorldActorShardPromptView',
        'stage3WorldPromptInputChars',
    ].forEach((helper) => assert.match(runtimeFingerprint, new RegExp(`${helper}\\.toString\\(\\)`, 'u')));
    assert.match(runtimeFingerprint, /stage3-world-model-input-max:40000/u);
});

test('world prompt asks only for semantic actor rows and leaves persistence authority to local code', () => {
    const messages = sourceSection(
        'function buildContinuityMessages({',
        'async function generateWorldContinuitySingleBatch',
    );
    const activeShape = messages.slice(
        messages.indexOf('const actionOutputShape = worldCreatesAttempts'),
        messages.indexOf('/* Historical verbose payload'),
    );
    assert.match(activeShape, /actorId.*intent.*candidateAction.*stateChanges/us);
    assert.match(activeShape, /actorId.*status.*resultSummary.*observableConsequence/us);
    assert.doesNotMatch(activeShape, /"actorRef"|"target"|"actualResourceCosts"|"visibility"/u);
    assert.match(messages, /model owns prose semantics|模型/u);
});

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

function loadStage3WorldCandidateValidator({
    pendingAttempts = [],
    settlement = null,
} = {}) {
    const code = sourceSection(
        'function stage3NoSemanticDeltaHeldTerminal(',
        'function stage3ValidateWorldDraftInMemory(',
    );
    const sandbox = {
        actorActionTargetOf: () => ({ chatId: 'chat-world-hold' }),
        pendingActorActionAttempts: () => ({
            attempts: structuredClone(pendingAttempts),
            candidates: [],
        }),
        validateWorldAdjudicationBatch: () => ({ valid: true, decisions: [] }),
        settleActorActionCandidates: () => structuredClone(settlement),
        actorActionSettlementsMatchLedger: () => ({ ok: true }),
        deepClone: (value) => structuredClone(value),
        normalizeContinuityState,
        preserveMissingThreads: (_previous, next) => structuredClone(next),
        applyWorldUpdate,
        mergeActorWorldEventsIntoContinuity: (next) => structuredClone(next),
        enforceContinuityPolicy,
        continuityLifecycleStats,
        continuityGlobalHoldIsVerifiable,
        continuityScenarioDigest,
        continuityWorldDigest,
    };
    vm.runInNewContext(
        `${code}\nthis.validateWorldCandidate = stage3ValidateWorldCandidateInMemory;`
        + '\nthis.normalizeAdjudication = stage3NormalizeWorldAdjudicationShape;'
        + '\nthis.adjudicationsForAttempts = stage3WorldAdjudicationsForAttempts;'
        + '\nthis.heldProposal = stage3HeldActorProposal;'
        + '\nthis.noSemanticDeltaHeldTerminal = stage3NoSemanticDeltaHeldTerminal;',
        sandbox,
    );
    const validator = sandbox.validateWorldCandidate;
    validator.normalizeAdjudication = sandbox.normalizeAdjudication;
    validator.adjudicationsForAttempts = sandbox.adjudicationsForAttempts;
    validator.heldProposal = sandbox.heldProposal;
    validator.noSemanticDeltaHeldTerminal = sandbox.noSemanticDeltaHeldTerminal;
    return validator;
}

function loadStage3SafeHeldDraftAfterParseFailure() {
    const code = sourceSection(
        'function stage3SafeHeldDraftAfterParseFailure(',
        'function stage3ValidateWorldCandidateInMemory(',
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        normalizeContinuityState,
    };
    vm.runInNewContext(
        `${code}\nthis.safeHeldDraft = stage3SafeHeldDraftAfterParseFailure;`,
        sandbox,
    );
    return sandbox.safeHeldDraft;
}

function loadActorSchedulingSettlementDiagnostics() {
    const code = sourceSection(
        'function markActorSchedulingSettled(',
        'let latestWorldLaneDiagnostics',
    );
    const sandbox = { structuredClone };
    vm.runInNewContext(
        `let latestActorShardDiagnostics = {};\n${code}`
        + '\nthis.markSettled = markActorSchedulingSettled;'
        + '\nthis.readDiagnostics = () => structuredClone(latestActorShardDiagnostics);',
        sandbox,
    );
    return sandbox;
}

function loadStage3LocalRecallPacket() {
    const code = sourceSection(
        'function stage3WorldbookRegexKey(value) {',
        'function stage3WorldbookPromptMaterial(',
    );
    const sandbox = {
        fingerprint: (value) => `test-digest:${String(value).length}`,
    };
    vm.runInNewContext(`${code}\nthis.buildRecall = stage3LocalRecallPacket;`, sandbox);
    return sandbox.buildRecall;
}

function loadStage3WorldbookPromptMaterial() {
    const code = sourceSection(
        'function stage3WorldbookPromptMaterial(',
        'function buildContinuityMessages({',
    );
    const sandbox = {
        cropText: (value, maxChars) => String(value || '').slice(0, maxChars),
    };
    vm.runInNewContext(`${code}\nthis.buildMaterial = stage3WorldbookPromptMaterial;`, sandbox);
    return sandbox.buildMaterial;
}

function loadBuildContinuityMessages() {
    const code = sourceSection(
        'function stage3WorldbookPromptMaterial(',
        'async function generateWorldContinuitySingleBatch(',
    );
    const settings = {
        continuityAutonomy: 'normal', continuityPromptAddon: '', actorShardPromptAddon: '',
        continuityContextMessages: 8, forumMaxPosts: 20, forumMaxComments: 20,
        fastApiJsonMode: true,
    };
    const sandbox = {
        actorActionAttemptWorldView: (value) => structuredClone(value),
        actorProfileV6View: (actor) => structuredClone(actor.profileV6View),
        constrainForumCausalSignals: (value) => value,
        cropText: (value, maxChars) => String(value || '').slice(0, maxChars),
        directProfile: () => ({ provider: 'direct' }),
        formatUserNarrativeInstruction: () => '',
        forumView: () => ({ active: [] }),
        getSettings: () => settings,
        publicContinuityRecordsForForum: () => [],
        readChatNamespace: () => ({ forum: {} }),
        recentTranscriptThrough: () => '最近剧情'.repeat(18000),
        safeJson: (value, indent = 2) => JSON.stringify(value, null, indent),
    };
    vm.runInNewContext(`${code}\nthis.buildMessages = buildContinuityMessages;`, sandbox);
    return sandbox.buildMessages;
}

function loadStage3ProfileEvolutionGate() {
    const code = sourceSection(
        'function stage3WorldOwnedActorProjection(',
        'function stage3FieldState(',
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        normalizeActorLedger,
        actorActionTargetMatches,
        stage3TargetActionAuthorityProjection: (ledger, target) => ({
            target,
            attempts: ledger?.actionAttempts || [],
            receipts: ledger?.actionReceipts || [],
        }),
    };
    vm.runInNewContext(
        `${code}\nthis.profileEvolutionGate = stage3ActorLedgerAfterProfileOnlyEvolution;`,
        sandbox,
    );
    return sandbox.profileEvolutionGate;
}

test('P3 binds a brand-new empty ActorRegistry to the verified scope before drift comparison', () => {
    const gate = loadStage3ProfileEvolutionGate();
    const target = {
        chatId: 'chat-empty-ledger', index: 2, messageId: 'message-2', swipeId: 6,
        generationSerial: 7, generationId: 'generation-7', generationType: 'swipe',
        scopeDigest: 'scope-current', contentFingerprint: 'content-current',
    };
    const result = gate({
        baseLedger: {},
        freshLedger: {},
        actionTarget: target,
        chatId: target.chatId,
        scopeDigest: target.scopeDigest,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.ledger.actorRegistry.scopeDigest, target.scopeDigest);
    assert.equal(result.ledger.actors.length, 0);
    assert.equal(result.ledger.actionAttempts.length, 0);
    assert.equal(result.ledger.actionReceipts.length, 0);
});

function loadContinuityWorldEntryCanonicalizer() {
    const code = sourceSection(
        'function usableContinuityWorldEntry(entry)',
        'function usableForumWorldEntry(entry)',
    );
    const sandbox = {
        fingerprint: (value) => `digest:${String(value).length}:${String(value)}`,
        deepClone: (value) => structuredClone(value),
    };
    vm.runInNewContext(
        `${code}\nthis.usable = usableContinuityWorldEntry;`
        + '\nthis.canonical = canonicalContinuityWorldEntries;',
        sandbox,
    );
    return sandbox;
}

function loadCancelledWorldReservationHarness({ checkpointPhase = 'world_call_reserved' } = {}) {
    const target = {
        chatId: 'chat-cancel-reserved', index: 4, logicalIndex: 4,
        messageId: 'message-4', swipeId: 0, generationSerial: 4, generation: 4,
        generationId: 'generation-4', generationType: 'normal',
        identityScopeId: 'scope-id', scopeDigest: 'scope-cancel',
        contentFingerprint: 'content-4', contentHash: 'content-4',
    };
    const actionTarget = { ...target };
    const state = {
        writes: 0,
        context: { chatId: target.chatId },
        currentTarget: structuredClone(target),
        namespace: {
            fieldRevisions: { continuityCheckpoint: 7 },
            actorLedger: { actionAttempts: [], actionReceipts: [] },
            continuity: { nextTurnInjection: null },
            continuityCheckpoint: {
                stage3Phase: checkpointPhase,
                target: structuredClone(actionTarget),
                stage3ProducerTarget: structuredClone(target),
            },
        },
    };
    const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const sandbox = {
        getContext: () => state.context,
        captureTarget: () => structuredClone(state.currentTarget),
        readChatNamespace: () => structuredClone(state.namespace),
        deepClone: (value) => structuredClone(value),
        normalizeActorLedger: (value) => structuredClone(value || { actionAttempts: [] }),
        actorActionTargetOf: () => structuredClone(actionTarget),
        stage3AcceptedTarget: (value) => value ? structuredClone(value) : null,
        actorActionTargetMatches: exact,
        stage3AcceptedTargetsMatch: exact,
        stage3FieldState: (namespace, field) => ({
            revision: namespace.fieldRevisions[field],
            digest: JSON.stringify(namespace[field]),
        }),
        writeChatNamespace: async (candidate, chatId, options) => {
            if (chatId !== state.context.chatId || options.precondition() !== true) return false;
            if (JSON.stringify(state.namespace.continuityCheckpoint)
                !== options.expectedFieldStates.continuityCheckpoint.digest) return false;
            state.writes += 1;
            state.namespace = structuredClone(candidate);
            return options.contentValidator(state.namespace) === true;
        },
    };
    const code = sourceSection(
        'function worldCallReservedForUserCancellation(namespace, captured) {',
        "async function cancelRunningSovereigntyTasks(reason = 'user_cancelled') {",
    );
    vm.runInNewContext(
        `${code}\nthis.matches = worldCallReservedForUserCancellation;`
        + 'this.clear = clearUserCancelledWorldCallReservation;',
        sandbox,
    );
    return { state, target, actionTarget, matches: sandbox.matches, clear: sandbox.clear };
}

function loadPriorReservedManualHarness() {
    const prior = {
        chatId: 'chat-prior-reserved', index: 1, messageId: 'message-1', swipeId: 0,
        generationSerial: 1, generationId: 'generation-1', generationType: 'normal',
        scopeDigest: 'scope-prior-reserved', contentFingerprint: 'content-1',
    };
    const current = {
        ...prior,
        index: 3,
        messageId: 'message-3',
        generationSerial: 3,
        generationId: 'generation-3',
        contentFingerprint: 'content-3',
    };
    const actionTargetOf = (value) => ({
        chatId: value.chatId,
        logicalIndex: value.index,
        index: value.index,
        messageId: value.messageId,
        swipeId: value.swipeId,
        generation: value.generationSerial,
        generationId: value.generationId,
        generationType: value.generationType,
        scopeDigest: value.scopeDigest,
        contentHash: value.contentFingerprint,
        hash: value.contentFingerprint,
    });
    const baseContinuity = {
        chatId: prior.chatId,
        turn: 0,
        lastSource: null,
        nextTurnInjection: null,
    };
    const state = {
        writes: 0,
        context: { chatId: current.chatId },
        currentTarget: structuredClone(current),
        namespace: {
            fieldRevisions: { continuityCheckpoint: 9 },
            actorLedger: { actionAttempts: [], actionReceipts: [] },
            continuity: structuredClone(baseContinuity),
            continuityCheckpoint: {
                stage3Phase: 'world_call_reserved',
                target: actionTargetOf(prior),
                stage3ProducerTarget: structuredClone(prior),
                state: structuredClone(baseContinuity),
            },
        },
    };
    const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const sandbox = {
        getContext: () => state.context,
        captureTarget: () => structuredClone(state.currentTarget),
        readChatNamespace: () => structuredClone(state.namespace),
        deepClone: (value) => structuredClone(value),
        normalizeActorLedger: (value) => structuredClone(value || { actionAttempts: [] }),
        actorActionTargetOf: actionTargetOf,
        actorActionTargetMatches: exact,
        continuityContentDigest: (value) => JSON.stringify(value || {}),
        stage3FieldState: (namespace, field) => ({
            revision: namespace.fieldRevisions[field],
            digest: JSON.stringify(namespace[field]),
        }),
        writeChatNamespace: async (candidate, chatId, options) => {
            if (chatId !== state.context.chatId || options.precondition() !== true) return false;
            if (JSON.stringify(state.namespace.continuityCheckpoint)
                !== options.expectedFieldStates.continuityCheckpoint.digest) return false;
            state.writes += 1;
            state.namespace = structuredClone(candidate);
            return options.contentValidator(state.namespace) === true;
        },
    };
    const targetHelpers = sourceSection(
        'function stage3AcceptedTarget(captured) {',
        'function stage3AcceptedTargetKey(captured) {',
    );
    const continuityHelpers = sourceSection(
        'function stage3ContinuityDigestWithoutInjection(state) {',
        'function stage3CanonicalSettlementProof(ledger, results = [], captured) {',
    );
    const clearHelpers = sourceSection(
        'async function clearWorldCallReservationWithReadback(captured, reservationMatches) {',
        'function markUserCancelledActorProfileControllers(',
    );
    vm.runInNewContext(
        `${targetHelpers}\n${continuityHelpers}\n${clearHelpers}`
        + '\nthis.matches = stage3PriorReservedCallCanRetire;'
        + 'this.retire = retirePriorReservedWorldCallForManualRecovery;',
        sandbox,
    );
    return {
        prior,
        current,
        actionTargetOf,
        state,
        matches: sandbox.matches,
        retire: sandbox.retire,
    };
}

function loadProductionCallModel(callDirectModel, {
    routeCount = 1,
    foregroundStarting = false,
    duplicateRouteKeys = false,
} = {}) {
    const activeModelControllers = new Set();
    const profiles = Array.from({ length: routeCount }, (_, slotIndex) => ({
        slotIndex,
        profile: {
            provider: 'direct', viaBackend: false, maxTokens: 4096,
            model: `synthetic-local-model-${duplicateRouteKeys ? 0 : slotIndex}`,
            name: `synthetic-local-route-${duplicateRouteKeys ? 0 : slotIndex}`,
        },
    }));
    const health = [];
    const diagnostics = [];
    const schedulerKeys = [];
    const sandbox = {
        AbortController,
        setTimeout,
        clearTimeout,
        MAX_MODEL_TIMEOUT_MS: 1000,
        MIN_MODEL_TIMEOUT_MS: 1,
        DEFAULTS: { maxTokens: 4096 },
        generationSerial: 1,
        lastPromptSnapshot: null,
        activeModelControllers,
        getSettings: () => ({ modelTimeoutMs: 10, maxTokens: 4096 }),
        getContext: () => ({ chatId: 'synthetic-call-model' }),
        foregroundGenerationStarting: foregroundStarting,
        activeGenerationSession: null,
        selectChannelConnectionProfile: (_settings, _channel, requestedSlot) => (
            profiles.find((entry) => entry.slotIndex === Number(requestedSlot)) || profiles[0]
        ),
        modelConnectionKey: (profile) => `${profile.provider}:${profile.model}:${profile.name}`,
        syncTaskCancelButtons: () => {},
        scopedModelMessages: (messages) => messages,
        modelInstructionModule: () => 'world',
        normalizeConnectionMaxTokens: (value) => value,
        modelInputLengthBucket: () => 'tiny',
        renderPromptSnapshot: () => {},
        modelConnectionScheduler: { enqueue: async (key, run) => { schedulerKeys.push(key); return run(); } },
        modelTaskPriority: () => 0,
        isRateLimitError: (error) => Number(error?.status) === 429,
        safeRouteDiagnostic: ({ failureKind }) => ({ failureKind }),
        structuredOutputShape: () => ({}),
        channelConnectionProfiles: () => profiles,
        countDistinctFailoverReservations: ({ maxFailovers, attemptedCount }) => (
            Math.max(0, maxFailovers - attemptedCount)
        ),
        modelRouteHealthRecord: () => ({ openedUntil: 0 }),
        recordModelCall: () => {},
        markModelRouteHealth: (_channel, slotIndex, profile, ok, detail) => {
            health.push({ slotIndex, model: profile.model, ok, failureKind: detail?.failureKind || '' });
        },
        recordModelDiagnostic: (entry) => diagnostics.push(structuredClone(entry)),
        normalizedProviderUsage: () => ({}),
        callDirectModel,
        extractFirstBalancedJsonObject,
        deepClone: (value) => structuredClone(value),
        renderSovereigntyHealth: () => {},
        updateFloatingOrb: () => {},
        recordOperation: () => {},
        fingerprint: (value) => `test:${String(value).length}`,
        doctorRepairTargetIdentityDigest: () => 'synthetic-target-digest',
    };
    const withTimeoutSource = sourceSection(
        'async function withTimeout(promise, milliseconds, label, {',
        'function modelInputLengthBucket(messages) {',
    );
    const callSource = sourceSection(
        'function assertUsableModelOutput(output, options = {}) {',
        'async function probeModelChannelConnections(channel =',
    );
    const failureClassifierSource = sourceSection(
        'function modelFailureKind(error, controller = null) {',
        'function safeRouteDiagnostic({',
    );
    vm.runInNewContext(
        `${withTimeoutSource}\n${failureClassifierSource}\n${callSource}`
        + '\nthis.callModelUnderTest = callModel;',
        sandbox,
    );
    return {
        callModel: sandbox.callModelUnderTest,
        activeModelControllers,
        health,
        diagnostics,
        schedulerKeys,
    };
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

function loadStage3PreparedAuthorityMatcher() {
    const authority = sourceSection(
        'function stage3CanonicalTargetActionReceipt(value, captured) {',
        'function stage3CanonicalSettlementProof(ledger, results = [], captured) {',
    );
    const prepared = sourceSection(
        'function stage3AttemptProjection(ledger, target) {',
        'function stage3ValidateWorldCandidateInMemory(captured, settings, ledger, {',
    );
    const acceptedTarget = (value) => value ? {
        chatId: String(value.chatId || ''),
        index: Math.max(0, Number(value.index) || 0),
        messageId: String(value.messageId || ''),
        swipeId: Math.max(0, Number(value.swipeId) || 0),
        generationSerial: Math.max(0, Number(value.generationSerial) || 0),
        generationId: String(value.generationId || ''),
        generationType: String(value.generationType || ''),
        scopeDigest: String(value.scopeDigest || ''),
        contentFingerprint: String(value.contentFingerprint || value.fingerprint || ''),
    } : null;
    const actionTarget = (value) => value ? {
        chatId: value.chatId,
        logicalIndex: value.logicalIndex ?? value.index,
        index: value.logicalIndex ?? value.index,
        messageId: value.messageId,
        swipeId: value.swipeId,
        generation: value.generation ?? value.generationSerial,
        generationId: value.generationId,
        generationType: value.generationType,
        scopeDigest: value.scopeDigest,
        contentHash: value.contentHash || value.hash || value.contentFingerprint || value.fingerprint,
        hash: value.contentHash || value.hash || value.contentFingerprint || value.fingerprint,
    } : null;
    const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        fingerprint: (value) => JSON.stringify(value),
        safeJson: (value) => JSON.stringify(value),
        actorActionTargetOf: actionTarget,
        normalizeActorActionTarget: actionTarget,
        actorActionTargetMatches: (left, right) => exact(actionTarget(left), actionTarget(right)),
        stage3AcceptedTarget: acceptedTarget,
        stage3AcceptedTargetsMatch: (left, right) => exact(acceptedTarget(left), acceptedTarget(right)),
        actorLedgerDigest: (value) => JSON.stringify(value),
        normalizeActorLedger: (value) => normalizeActorLedger(value),
    };
    vm.runInNewContext(
        `${authority}\n${prepared}\nthis.build = stage3PreparedWorldCheckpoint;`
        + 'this.matches = stage3PreparedWorldCheckpointMatches;',
        sandbox,
    );
    return sandbox;
}

function loadStage3UnchangedFieldRebaseGate() {
    const code = sourceSection(
        'function stage3FieldStateCanRebaseUnchanged(expected, actual) {',
        'function stage3PreparedWorldCheckpoint({',
    );
    const sandbox = {};
    vm.runInNewContext(`${code}\nthis.matches = stage3FieldStateCanRebaseUnchanged;`, sandbox);
    return sandbox.matches;
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
        stage3LocalRecallPacket: () => ({
            version: 2, actorIds: [], threadIds: [], laneIds: [],
            mustActorIds: [], mustThreadIds: [], mustLaneIds: [], digest: 'local-recall',
        }),
        continuityTickPlan: () => ({ ticksDue: 1 }),
        getSettings: () => ({}),
        getContext: () => ({ chatId: state.captured.chatId, chat: [{ mes: 'natural narrative' }] }),
        readChatNamespace: () => state.namespace,
        stage3LegacyTargetNeedsManualReconciliation: (stored, captured) => (
            stored === state.legacyTarget && captured === state.captured
        ),
        stage3CommittedCheckpointIsPriorTerminal: () => false,
        stage3CommittedCheckpointIsRerollBaseline: () => false,
        stage3AcceptedTargetIsStrictlyNewer: () => false,
        stage3PersistedPackageDecision: () => ({ ok: false, code: 'proof_invalid', packet: null }),
        stage3WorldFailureValidationCode: () => 'world.operation.failed',
        stage3ExistingCommittedPackageReadback: async () => ({
            ok: true,
            packet: structuredClone(state.namespace?.continuity?.nextTurnInjection || {}),
        }),
        stage3ActorLedgerAfterProfileOnlyEvolution: ({ freshLedger }) => ({
            ok: true,
            ledger: structuredClone(freshLedger || {}),
        }),
        capturedTargetKey: () => 'world-test-target',
        actorProfilePendingKeys: new Map(),
        actorProfileChain: Promise.resolve(),
        ...state.spies,
    };
    sandbox.stage3PersistAttemptlessPreparedWorldCandidate = async (captured, args) => {
        const preparedCheckpoint = sandbox.stage3PreparedWorldCheckpoint?.({
            captured,
            checkpointBase: args.checkpointBase,
            scheduledBase: args.scheduledBase,
            parsed: args.parsed,
            director: args.director,
            nextTurn: args.nextTurn,
            actionTarget: args.actionTarget,
            ledger: args.actionLedger,
            recall: args.recallPacket,
            worldContext: args.worldContext,
            phase1Expected: args.phase1Expected,
        });
        const persisted = await sandbox.persistActorActionAttemptsForTurn?.(captured, {
            previousLedger: args.actionLedger,
            nextLedger: args.actionLedger,
            attempts: [],
            target: args.actionTarget,
            token: args.token,
            preparedCheckpoint,
            expectedFieldStates: args.phase1Expected,
        });
        return persisted?.ok ? { ok: true, persisted } : {
            ok: false,
            reason: persisted?.reason || 'world_candidate_readback_mismatch',
        };
    };
    vm.runInNewContext(`${code}\nthis.run = runContinuityTarget;`, sandbox);
    return sandbox.run;
}

function loadStage3PersistedPackageValidator({
    normalizer = (value) => value,
    ledgerDigest = null,
} = {}) {
    const code = sourceSection(
        'function stage3ContinuityDigestWithoutInjection(state) {',
        'function stage3NoActorPermitMatches(permit, captured) {',
    );
    const canonicalTarget = (value) => value ? {
        chatId: String(value.chatId || ''),
        logicalIndex: Number(value.logicalIndex ?? value.index) || 0,
        messageId: String(value.messageId || ''),
        swipeId: Number(value.swipeId) || 0,
        generation: Number(value.generation ?? value.generationSerial) || 0,
        generationId: String(value.generationId || ''),
        generationType: String(value.generationType || ''),
        scopeDigest: String(value.scopeDigest || ''),
        contentHash: String(value.contentHash || value.hash || value.contentFingerprint || ''),
    } : null;
    const targetMatches = (left, right) => (
        JSON.stringify(canonicalTarget(left)) === JSON.stringify(canonicalTarget(right))
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        continuityContentDigest: (value) => JSON.stringify(value),
        normalizeContinuityState: normalizer,
        getSettings: () => ({ continuityMaxThreads: 4 }),
        actorLedgerDigest: ledgerDigest || ((ledger) => {
            const result = ledger?.actionAttempts?.[0]?.worldAdjudicationResult || {};
            return [
                'actor-ledger',
                String(result.attemptId || ''),
                String(result.id || ''),
                String(result.actorRef?.actorId || ''),
                String(result.outcome || ''),
            ].join(':');
        }),
        normalizeActorLedger: (value) => normalizeActorLedger(value),
        fingerprint: (value) => {
            const text = String(value);
            let hash = 0;
            for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
            return `hash:${text.length}:${hash}`;
        },
        actorActionTargetOf: (captured) => ({ ...captured }),
        normalizeActorActionTarget: canonicalTarget,
        actorActionTargetMatches: targetMatches,
        actorActionSettlementsMatchLedger: (ledger, { target, results }) => {
            const settled = (ledger?.actionAttempts || [])
                .filter((attempt) => (
                    targetMatches(attempt?.target, target)
                    && attempt?.worldAdjudicationResult
                ))
                .map((attempt) => attempt.worldAdjudicationResult);
            return { ok: JSON.stringify(settled) === JSON.stringify(results) };
        },
        pendingActorActionAttempts: (ledger, { target }) => ({
            attempts: (ledger?.actionAttempts || []).filter((attempt) => (
                targetMatches(attempt?.target, target)
                && !attempt?.worldAdjudicationResult
            )),
        }),
    };
    vm.runInNewContext(
        `${sourceSection('function stage3AcceptedTarget(captured) {', 'function stage3ContinuityDigestWithoutInjection(state) {')}`
        + `${code}\nthis.stage3CanonicalSettlementProof = stage3CanonicalSettlementProof;`
        + 'this.stage3SettlementProofMatchesTarget = stage3SettlementProofMatchesTarget;'
        + 'this.stage3SettlementProofMatchesLedger = stage3SettlementProofMatchesLedger;'
        + 'this.stage3PersistedPackageDecision = stage3PersistedPackageDecision;'
        + 'this.stage3PersistedPackageForTarget = stage3PersistedPackageForTarget;'
        + 'this.stage3CommittedCheckpointIsPriorTerminal = stage3CommittedCheckpointIsPriorTerminal;'
        + 'this.stage3CommittedCheckpointIsRerollBaseline = stage3CommittedCheckpointIsRerollBaseline;'
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
    const repairHelpers = sourceSection(
        'function stage3WorldAdjudicationRepairFields(validationCodes = [])',
        'async function commitPreparedWorldCandidate(captured, {',
    );
    const sandbox = {
        callModel,
        parseContinuityOutput,
        deepClone: (value) => structuredClone(value),
        stage3AcceptedTarget: (value) => value ? structuredClone(value) : null,
        validateWorldAdjudicationBatch: () => ({ valid: true, errors: [] }),
        freshFrozenScopeGuard: async (captured) => (
            captured?.scopeDigest
                ? { ok: true }
                : { ok: false, reason: 'scope_digest_missing' }
        ),
    };
    vm.runInNewContext(
        `${repairHelpers}\n${code}\nthis.generateWorldContinuitySingleBatch = generateWorldContinuitySingleBatch;`,
        sandbox,
    );
    return sandbox.generateWorldContinuitySingleBatch;
}

function loadStage3AdjudicationFailureMapper() {
    const code = sourceSection(
        'function stage3WorldAdjudicationRepairFields(validationCodes = [])',
        'function stage3WorldValidationExpectedShape(validationCode, repairContext = null)',
    );
    const sandbox = {};
    vm.runInNewContext(
        `${code}\nthis.mapFailure = stage3WorldAdjudicationValidationFailure;`,
        sandbox,
    );
    return sandbox.mapFailure;
}

function loadAttemptlessPhase1RebaseHarness({
    alwaysReject = false,
    failureCode = 'field_state_mismatch',
    failureReason = 'action_attempt.commit_rejected',
    continuity = { turn: 1 },
    continuityCheckpoint = null,
    freshActionAttempts = [],
    freshActionReceipts = [],
} = {}) {
    const unchangedGate = sourceSection(
        'function stage3FieldStateCanRebaseUnchanged(expected, actual) {',
        'function stage3PreparedWorldCheckpoint({',
    );
    const code = sourceSection(
        'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
        'function stage3PreparedWorldCheckpointMatches(',
    );
    const readbackCode = sourceSection(
        'function stage3Phase1ReadbackValidationCode(persisted) {',
        'async function runContinuityTarget(captured, {',
    );
    const profileEvolutionCode = sourceSection(
        'function stage3WorldOwnedActorProjection(actor) {',
        'function stage3FieldState(namespace, field) {',
    );
    const target = { chatId: 'chat-rebase', index: 2, scopeDigest: 'scope-rebase' };
    const actionTarget = { chatId: 'chat-rebase', index: 2, generationId: 'generation-2' };
    let actorRevision = 2;
    let persistCalls = 0;
    const latestLedger = () => ({
        chatId: target.chatId,
        actorRegistry: { scopeDigest: target.scopeDigest, registered: {} },
        actors: [{ id: 'actor-new-ready', profileV6: { status: 'complete' } }],
        actionAttempts: structuredClone(freshActionAttempts),
        actionReceipts: structuredClone(freshActionReceipts),
        actionAttemptBacklog: [],
        observationReceipts: [],
        profileRevision: actorRevision,
    });
    const namespace = () => ({
        actorLedger: latestLedger(),
        continuity: structuredClone(continuity),
        continuityCheckpoint: structuredClone(continuityCheckpoint),
        fieldRevisions: { actorLedger: actorRevision, continuity: 1, continuityCheckpoint: 1 },
    });
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        stage3AttemptProjection: (ledger) => structuredClone(ledger.actionAttempts || []),
        stage3TargetActionAuthorityProjection: (ledger) => ({
            attempts: structuredClone(ledger.actionAttempts || []),
            receipts: structuredClone(ledger.actionReceipts || []),
        }),
        fingerprint: (value) => JSON.stringify(value),
        actorLedgerDigest: (value) => JSON.stringify(value),
        normalizeActorLedger: (value) => normalizeActorLedger(value),
        stage3TaskOwnsCurrent: () => true,
        capturedTargetKey: () => 'attemptless-world-target',
        actorProfilePendingKeys: new Map(),
        actorProfileChain: Promise.resolve(),
        actorProfileReadinessInLedger: (ledger, actorId) => ({
            ready: ledger?.actors?.find((actor) => actor.id === actorId)?.profileV6?.status === 'complete',
        }),
        getContext: () => ({ chatId: target.chatId }),
        readChatNamespace: () => namespace(),
        stage3FieldState: (value, field) => ({
            revision: value.fieldRevisions[field],
            digest: JSON.stringify(value[field]),
        }),
        normalizeActorLedger: (value) => structuredClone(value),
        stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
        stage3WorldFailureValidationCode: () => 'world.operation.failed',
        stage3PreparedWorldCheckpoint: ({ ledger, phase1Expected }) => ({
            stage3Phase: 'world_candidate_prepared',
            preparedWorld: {
                ledger: structuredClone(ledger),
                phase1Expected: structuredClone(phase1Expected),
            },
        }),
        persistActorActionAttemptsForTurn: async (_captured, options) => {
            persistCalls += 1;
            assert.equal(options.attempts.length, 0);
            assert.equal(options.nextLedger.actors[0].profileV6.status, 'complete');
            if (alwaysReject || persistCalls === 1) {
                actorRevision += 1;
                return {
                    ok: false,
                    reason: failureReason,
                    failureCode,
                    concurrentFields: ['actorLedger'],
                };
            }
            return {
                ok: true,
                ledger: structuredClone(options.nextLedger),
                checkpoint: structuredClone(options.preparedCheckpoint),
            };
        },
        stage3PreparedWorldCheckpointMatches: () => true,
    };
    vm.runInNewContext(
        `${unchangedGate}\n${readbackCode}\n${profileEvolutionCode}\n${code}\n`
        + 'this.rebase = stage3PersistAttemptlessPreparedWorldCandidate;',
        sandbox,
    );
    return {
        run: () => sandbox.rebase(target, {
            token: {}, settings: {}, actionLedger: {
                chatId: target.chatId,
                actorRegistry: { scopeDigest: target.scopeDigest, registered: {} },
                actors: [],
                actionAttempts: [],
                actionReceipts: [],
                actionAttemptBacklog: [],
                observationReceipts: [],
            },
            parsed: { state: { turn: 2 }, raw: { world: {} } },
            checkpointBase: { turn: 1 }, scheduledBase: { turn: 2 },
            director: 'standalone', nextTurn: 2, actionTarget,
            recallPacket: {}, worldContext: { hasSetting: true },
            phase1Expected: {
                actorLedger: { revision: 1, digest: 'old-ledger' },
                continuity: { revision: 0, digest: JSON.stringify({ turn: 1 }) },
                continuityCheckpoint: { revision: 0, digest: JSON.stringify(null) },
            },
        }),
        persistCalls: () => persistCalls,
    };
}

function loadScheduledPhase1RebaseHarness({ rejectPreparedAttempt = false } = {}) {
    const unchangedGate = sourceSection(
        'function stage3FieldStateCanRebaseUnchanged(expected, actual) {',
        'function stage3PreparedWorldCheckpoint({',
    );
    const code = sourceSection(
        'async function stage3PersistPreparedActorAttemptsOnFreshLedger(captured, {',
        'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
    );
    const adjudicationCode = sourceSection(
        'function stage3HeldActorProposal(',
        'function stage3ValidateWorldDraftInMemory(',
    );
    const readbackCode = sourceSection(
        'function stage3Phase1ReadbackValidationCode(persisted) {',
        'async function runContinuityTarget(captured, {',
    );
    const profileEvolutionCode = sourceSection(
        'function stage3WorldOwnedActorProjection(actor) {',
        'function stage3FieldState(namespace, field) {',
    );
    const target = { chatId: 'chat-scheduled-rebase', index: 2, scopeDigest: 'scope-scheduled' };
    const actionTarget = {
        chatId: target.chatId,
        logicalIndex: 2,
        index: 2,
        messageId: 'message-2',
        swipeId: 0,
        generation: 2,
        generationId: 'generation-2',
        generationType: 'normal',
        scopeDigest: target.scopeDigest,
        contentHash: 'content-2',
    };
    const scheduledRef = { actorId: 'actor-old', identityHash: 'stable-ref' };
    let actorRevision = 2;
    let persistCalls = 0;
    let attemptlessCalls = 0;
    const freshLedger = () => ({
        chatId: target.chatId,
        actorRegistry: { scopeDigest: target.scopeDigest, registered: {} },
        actors: [
            { id: 'actor-old', actorRef: scheduledRef, profileV6: { status: 'complete' } },
            { id: 'actor-new-ready', actorRef: { actorId: 'actor-new-ready' }, profileV6: { status: 'complete' } },
        ],
        actionAttempts: [],
        actionReceipts: [],
        actionAttemptBacklog: [],
        observationReceipts: [{
            receiptId: 'actor-registration:new-ready',
            kind: 'actor-registration',
            sourceRef: structuredClone(actionTarget),
            actorIds: ['actor-new-ready'],
            settledAt: 2,
        }],
        profileRevision: actorRevision,
    });
    const namespace = () => ({
        actorLedger: freshLedger(), continuity: { turn: 1 }, continuityCheckpoint: null,
        fieldRevisions: { actorLedger: actorRevision, continuity: 1, continuityCheckpoint: 1 },
    });
    const sandbox = {
        fingerprint: (value) => JSON.stringify(value),
        safeJson: (value) => JSON.stringify(value),
        deepClone: (value) => structuredClone(value),
        actorActionTargetMatches,
        stage3AttemptProjection: (ledger) => structuredClone(ledger.actionAttempts || []),
        stage3TargetActionAuthorityProjection: (ledger) => ({
            attempts: structuredClone(ledger.actionAttempts || []), receipts: [],
        }),
        stage3TaskOwnsCurrent: () => true,
        capturedTargetKey: () => 'scheduled-world-target',
        actorProfilePendingKeys: new Map(),
        actorProfileChain: Promise.resolve(),
        actorProfileReadinessInLedger: (ledger, actorId) => ({
            ready: ledger?.actors?.find((actor) => actor.id === actorId)?.profileV6?.status === 'complete',
        }),
        getContext: () => ({ chatId: target.chatId }),
        readChatNamespace: () => namespace(),
        stage3FieldState: (value, field) => ({
            revision: value.fieldRevisions[field], digest: JSON.stringify(value[field]),
        }),
        normalizeActorLedger: (value) => structuredClone(value),
        actorActionCandidatesFromShard: (_ledger, proposals) => structuredClone(proposals),
        prepareActorActionAttempts: (ledger, candidates) => rejectPreparedAttempt
            ? {
                ledger: structuredClone(ledger), attempts: [],
                rejected: [{ actorId: 'actor-old', reasons: ['capability-out-of-bounds'] }],
            }
            : ({
                ledger: structuredClone(ledger), rejected: [],
                attempts: candidates.map((candidate) => ({
                    id: `attempt-${candidate.actorId}`,
                    actorId: candidate.actorId,
                    actorRef: structuredClone(scheduledRef),
                    target: structuredClone(actionTarget),
                })),
            }),
        recordActorActionAttempts: (ledger, attempts) => ({
            ledger: { ...structuredClone(ledger), actionAttempts: structuredClone(attempts) },
            recorded: structuredClone(attempts), rejected: [],
        }),
        stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
        stage3WorldFailureValidationCode: () => 'world.operation.failed',
        stage3PreparedWorldCheckpoint: ({ ledger, phase1Expected, phase1WriteMode }) => ({
            stage3Phase: 'world_candidate_prepared',
            preparedWorld: {
                ledger: structuredClone(ledger), phase1Expected: structuredClone(phase1Expected),
                phase1WriteMode,
            },
        }),
        persistActorActionAttemptsForTurn: async (_captured, options) => {
            persistCalls += 1;
            assert.equal(options.phase1WriteMode, 'actor_attempts');
            assert.deepEqual(options.attempts.map((entry) => entry.actorId), ['actor-old']);
            assert.equal(options.nextLedger.actors.length, 2, 'fresh P1 actor survives local ATT replay');
            if (persistCalls === 1) {
                actorRevision += 1;
                return {
                    ok: false, reason: 'action_attempt.commit_rejected',
                    failureCode: 'stale_namespace_revision', concurrentFields: ['actorLedger'],
                };
            }
            return {
                ok: true,
                ledger: structuredClone(options.nextLedger),
                checkpoint: structuredClone(options.preparedCheckpoint),
            };
        },
        stage3PreparedWorldCheckpointMatches: () => true,
        stage3SafeHeldDraftAfterParseFailure: (scheduledState, { nextTurn }) => ({
            ...structuredClone(scheduledState),
            turn: nextTurn,
            lastTick: {
                turn: nextTurn, action: 'held', threadId: 'WORLD',
                reason: '模型输出格式无法安全恢复，本回合保留既有世界状态',
            },
            threads: [], scenarioPlan: {}, world: {},
        }),
        stage3PersistAttemptlessPreparedWorldCandidate: async (_captured, options) => {
            attemptlessCalls += 1;
            assert.deepEqual(Array.from(options.parsed.raw.actionProposals), []);
            assert.deepEqual(Array.from(options.parsed.raw.actionAdjudications), []);
            assert.equal(JSON.stringify(options.parsed.raw.world), '{}');
            assert.match(options.parsed.state.lastTick.reason, /本地权威校验/u);
            return {
                ok: true,
                persisted: {
                    ledger: structuredClone(options.actionLedger),
                    checkpoint: { stage3Phase: 'world_candidate_prepared' },
                },
            };
        },
    };
    vm.runInNewContext(
        `${unchangedGate}\n${readbackCode}\n${profileEvolutionCode}\n${adjudicationCode}\n${code}\n`
        + 'this.rebase = stage3PersistPreparedActorAttemptsOnFreshLedger;',
        sandbox,
    );
    return {
        run: () => sandbox.rebase(target, {
            token: {}, settings: {},
            actionLedger: {
                chatId: target.chatId,
                actorRegistry: { scopeDigest: target.scopeDigest, registered: {} },
                actors: [{ id: 'actor-old', actorRef: scheduledRef, profileV6: { status: 'complete' } }],
                actionAttempts: [],
                actionReceipts: [],
                actionAttemptBacklog: [],
                observationReceipts: [],
            },
            parsed: {
                state: { turn: 2 },
                raw: {
                    world: {},
                    actionAdjudications: [{ actorId: 'actor-old', status: 'held' }],
                },
            },
            checkpointBase: { turn: 1 }, scheduledBase: { turn: 2 },
            director: 'standalone', nextTurn: 2, actionTarget,
            recallPacket: {}, worldContext: { hasSetting: true },
            phase1Expected: {
                actorLedger: { revision: 1, digest: 'old' },
                continuity: { revision: 0, digest: JSON.stringify({ turn: 1 }) },
                continuityCheckpoint: { revision: 0, digest: JSON.stringify(null) },
            },
            scheduledActorIds: ['actor-old'],
            validatedProposals: [{ actorId: 'actor-old', action: 'wait' }],
            playerNames: [],
        }),
        persistCalls: () => persistCalls,
        attemptlessCalls: () => attemptlessCalls,
    };
}

function loadProductionActionAttemptWriter(
    getContext,
    writeOverride = null,
    checkpointMatcher = null,
) {
    const code = sourceSection(
        'async function persistActorActionAttemptsForTurn(captured, {',
        'async function completeActorProfilesForTurn(captured, {',
    );
    const namespaceWriter = loadNamespaceWriter(getContext);
    const sandbox = {
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        getContext,
        readChatNamespace: (context) => structuredClone(
            context.chatMetadata.mvu_auto_doctor,
        ),
        writeChatNamespace: (...args) => writeOverride
            ? writeOverride(...args)
            : namespaceWriter.write(...args),
        normalizeActorLedger: (value) => structuredClone(value),
        actorActionAttemptsMatchLedger: () => ({ ok: true }),
        stage3PreparedWorldCheckpointMatches: checkpointMatcher || ((checkpoint) => (
            checkpoint?.preparedWorld?.phase1WriteMode === 'checkpoint_only'
        )),
        stage3FieldState: (namespace, field) => ({
            revision: Math.max(0, Number(namespace?.fieldRevisions?.[field]) || 0),
            digest: field === 'actorLedger'
                ? JSON.stringify(namespace?.[field])
                : JSON.stringify(namespace?.[field]),
        }),
        deepClone: (value) => structuredClone(value),
    };
    vm.runInNewContext(`${code}\nthis.persist = persistActorActionAttemptsForTurn;`, sandbox);
    return { persist: sandbox.persist, metrics: namespaceWriter.metrics };
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
        'function persistedNamespaceMatches(candidate, persisted, selectedFields, {',
    );
    const matches = sourceSection(
        'function persistedNamespaceMatches(candidate, persisted, selectedFields, {',
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
        actorLedgerDigest: (value) => JSON.stringify(value),
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
        matches: sandbox.persistedNamespaceMatches,
        metrics: sandbox.chatNamespacePersistenceMetrics,
        failureCode: () => sandbox.lastChatNamespaceWriteFailureCode,
    };
}

function loadNamespaceWriteWrapperRaceHarness(state) {
    const code = sourceSection(
        'function rejectChatNamespaceWrite(options, code, detail = \'\') {',
        'function rebaseIdenticalNamespaceFields(next, current, fields) {',
    );
    const sandbox = {
        PLUGIN_ID: 'mvu_auto_doctor',
        lastChatNamespaceWriteFailureCode: '',
        chatNamespacePersistenceMetrics: { migrationGuardBlocked: 0 },
        getContext: () => state.context,
        readChatNamespace: () => structuredClone(state.context.chatMetadata.mvu_auto_doctor),
        actorSovereigntyScopeDigest: () => 'scope-digest',
        actorSovereigntyScopesMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        actorSovereigntyMigrationIsCurrent: () => true,
        ensureActorSovereigntyMigrationPersisted: async () => ({
            ok: true,
            current: true,
            namespace: structuredClone(state.context.chatMetadata.mvu_auto_doctor),
        }),
        resolveCurrentActorSovereigntyScope: async () => {
            await state.concurrentP1Write();
            return { resolved: true, scope: structuredClone(state.scope) };
        },
        prepareActorSovereigntyFieldWriteCandidate: (candidate, current, { fields }) => {
            const staleFields = fields.filter((field) => (
                Number(current.fieldRevisions?.[field] || 0)
                    > Number(candidate.fieldRevisions?.[field] || candidate.rev || 0)
                && JSON.stringify(current[field]) !== JSON.stringify(candidate[field])
            ));
            return staleFields.length
                ? {
                    allowed: false,
                    reason: 'migration.write_field_revision_stale',
                    staleFields,
                }
                : { allowed: true, candidate: structuredClone(candidate), staleFields: [] };
        },
        rebaseActorSovereigntyFieldWriteAfterMigration: () => ({ allowed: false }),
        currentActorSovereigntyScope: () => structuredClone(state.scope),
        enqueueChatNamespaceWrite: async () => {
            throw new Error('stale wrapper candidate must not reach the writer queue');
        },
    };
    vm.runInNewContext(`${code}\nthis.write = writeChatNamespace;`, sandbox);
    return sandbox.write;
}

function loadProductionPriorReservedRetirementHarness(postApplyMutation = null) {
    const fixture = loadPriorReservedManualHarness();
    let persisted = structuredClone(fixture.state.namespace);
    let appliedCandidate = false;
    const currentTarget = structuredClone(fixture.current);
    const context = {
        chatId: fixture.current.chatId,
        chatMetadata: { mvu_auto_doctor: structuredClone(fixture.state.namespace) },
        updateChatMetadata(patch) {
            this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            if (!appliedCandidate && this.chatMetadata.mvu_auto_doctor?.continuityCheckpoint == null) {
                appliedCandidate = true;
            }
        },
        async saveMetadata() {
            postApplyMutation?.({ context: this, currentTarget, fixture });
            persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
        },
        async readPersistedChatMetadata() {
            return structuredClone(persisted);
        },
    };
    const writer = loadNamespaceWriter(() => context);
    const sandbox = {
        getContext: () => context,
        captureTarget: () => currentTarget,
        readChatNamespace: () => structuredClone(context.chatMetadata.mvu_auto_doctor),
        deepClone: (value) => structuredClone(value),
        normalizeActorLedger: (value) => structuredClone(value || {
            actionAttempts: [], actionReceipts: [],
        }),
        actorActionTargetOf: fixture.actionTargetOf,
        actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        continuityContentDigest: (value) => JSON.stringify(value || {}),
        stage3FieldState: (namespace, field) => ({
            revision: namespace.fieldRevisions[field],
            digest: JSON.stringify(JSON.stringify(namespace[field])),
        }),
        writeChatNamespace: (candidate, chatId, options) => writer.write(
            candidate,
            chatId,
            options,
        ),
    };
    const targetHelpers = sourceSection(
        'function stage3AcceptedTarget(captured) {',
        'function stage3AcceptedTargetKey(captured) {',
    );
    const continuityHelpers = sourceSection(
        'function stage3ContinuityDigestWithoutInjection(state) {',
        'function stage3CanonicalSettlementProof(ledger, results = [], captured) {',
    );
    const clearHelpers = sourceSection(
        'async function clearWorldCallReservationWithReadback(captured, reservationMatches) {',
        'function markUserCancelledActorProfileControllers(',
    );
    vm.runInNewContext(
        `${targetHelpers}\n${continuityHelpers}\n${clearHelpers}`
        + '\nthis.retire = retirePriorReservedWorldCallForManualRecovery;',
        sandbox,
    );
    return {
        fixture,
        context,
        currentTarget,
        writer,
        retire: sandbox.retire,
        persisted: () => structuredClone(persisted),
        failureCode: () => writer.failureCode(),
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

test('zero-thread WORLD-held is a verifiable no-change terminal, not fabricated progress', () => {
    const before = normalizeContinuityState({
        chatId: 'chat-world-hold',
        turn: 1,
        threads: [],
        world: {},
        scenarioPlan: {},
        lastTick: {},
    }, { chatId: 'chat-world-hold' });
    const requested = normalizeContinuityState({
        ...structuredClone(before),
        lastTick: {
            turn: 1,
            action: 'held',
            threadId: 'WORLD',
            reason: '没有足够权威依据形成可持久化的世界变化',
        },
    }, { chatId: 'chat-world-hold' });
    const enforced = enforceContinuityPolicy(before, requested, {
        autonomy: 'living',
        allowAutonomous: true,
        maxThreads: 24,
    });
    assert.equal(enforced.lastTick.action, 'held');
    assert.equal(enforced.lastTick.threadId, 'WORLD');
    assert.equal(continuityGlobalHoldIsVerifiable(before, enforced), true);
    assert.equal(continuityWorldDigest(before), continuityWorldDigest(enforced));
    assert.equal(continuityLifecycleStats(before, enforced).changedExisting, 0);
});

test('WORLD-held cannot bypass an active thread or repair an unknown target', () => {
    const activeBefore = normalizeContinuityState({
        chatId: 'chat-world-hold',
        turn: 1,
        threads: [{
            id: 'THREAD-ACTIVE', title: 'active', summary: 'active state',
            stage: 'seeded', seedBasis: 'stable basis',
        }],
        world: {},
        scenarioPlan: {},
    }, { chatId: 'chat-world-hold' });
    const worldHeld = normalizeContinuityState({
        ...structuredClone(activeBefore),
        lastTick: {
            turn: 1, action: 'held', threadId: 'WORLD',
            reason: '现有活动线程尚未满足继续推进所需条件',
        },
    }, { chatId: 'chat-world-hold' });
    assert.equal(continuityGlobalHoldIsVerifiable(activeBefore, worldHeld), false);
    assert.notEqual(
        enforceContinuityPolicy(activeBefore, worldHeld).lastTick.threadId,
        'WORLD',
    );
    const activeHeld = normalizeContinuityState({
        ...structuredClone(activeBefore),
        lastTick: {
            turn: 1, action: 'held', threadId: 'THREAD-ACTIVE',
            reason: '现有活动线程尚未满足继续推进所需条件',
        },
    }, { chatId: 'chat-world-hold' });
    const activeEnforced = enforceContinuityPolicy(activeBefore, activeHeld);
    assert.equal(activeEnforced.lastTick.turn, 1);
    assert.equal(activeEnforced.lastTick.threadId, 'THREAD-ACTIVE');

    for (const threadId of ['', 'UNKNOWN']) {
        const emptyBefore = normalizeContinuityState({
            chatId: 'chat-world-hold', turn: 1, threads: [], world: {}, scenarioPlan: {},
        }, { chatId: 'chat-world-hold' });
        const unknown = normalizeContinuityState({
            ...structuredClone(emptyBefore),
            lastTick: {
                turn: 1, action: 'held', threadId,
                reason: '没有足够权威依据形成可持久化的世界变化',
            },
        }, { chatId: 'chat-world-hold' });
        const enforced = enforceContinuityPolicy(emptyBefore, unknown);
        assert.equal(enforced.lastTick.action, '');
        assert.equal(continuityGlobalHoldIsVerifiable(emptyBefore, enforced), false);
    }
});

test('production P3 validator accepts WORLD-held only after all ATT are adjudicated', () => {
    const before = normalizeContinuityState({
        chatId: 'chat-world-hold', turn: 1, threads: [], world: {}, scenarioPlan: {},
    }, { chatId: 'chat-world-hold' });
    const held = normalizeContinuityState({
        ...structuredClone(before),
        lastTick: {
            turn: 1,
            action: 'held',
            threadId: 'WORLD',
            reason: '没有足够权威依据形成可持久化的世界变化',
        },
    }, { chatId: 'chat-world-hold' });
    const args = {
        scheduledState: before,
        continuityState: held,
        world: {},
        actionAdjudications: [],
        nextTurn: 1,
        worldContextAvailable: true,
    };
    const noAttempts = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        args,
    );
    assert.equal(noAttempts.ok, true);
    assert.equal(noAttempts.next.lastTick.threadId, 'WORLD');
    for (const driftedTurn of [0, 99]) {
        const drifted = normalizeContinuityState({
            ...structuredClone(held),
            turn: driftedTurn,
            lastTick: structuredClone(held.lastTick),
        }, { chatId: 'chat-world-hold' });
        const normalizedClock = loadStage3WorldCandidateValidator()(
            { chatId: 'chat-world-hold' },
            { continuityMaxThreads: 24, continuityAutonomy: 'living' },
            {},
            { ...args, continuityState: drifted },
        );
        assert.equal(normalizedClock.ok, true);
        assert.equal(normalizedClock.next.turn, 1);
        assert.equal(normalizedClock.next.lastTick.threadId, 'WORLD');
    }

    const pendingAttempt = { id: 'ATT-WORLD-HOLD', actorId: 'actor-test' };
    const unadjudicated = loadStage3WorldCandidateValidator({
        pendingAttempts: [pendingAttempt],
        settlement: {
            ledger: {}, pendingWorld: [pendingAttempt], results: [], worldEvents: [],
        },
    })(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        args,
    );
    assert.equal(unadjudicated.ok, false);
    assert.equal(unadjudicated.reason, 'world_candidate_settlement_failed');

    const adjudicatedWithoutWorldDelta = loadStage3WorldCandidateValidator({
        pendingAttempts: [pendingAttempt],
        settlement: {
            ledger: {}, pendingWorld: [],
            results: [{ attemptId: pendingAttempt.id, status: 'held', worldAdjudicated: true, appliedStateChanges: [] }],
            worldEvents: [],
        },
    })(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        args,
    );
    assert.equal(adjudicatedWithoutWorldDelta.ok, true);
    assert.equal(adjudicatedWithoutWorldDelta.next.lastTick.action, 'held');
    assert.equal(adjudicatedWithoutWorldDelta.next.lastTick.threadId, 'WORLD');

    const activeBefore = normalizeContinuityState({
        chatId: 'chat-world-hold',
        turn: 1,
        threads: [{
            id: 'THREAD-ACTIVE', title: 'active', summary: 'active state',
            stage: 'seeded', seedBasis: 'stable basis',
        }],
        world: {},
        scenarioPlan: {},
    }, { chatId: 'chat-world-hold' });
    const locallyHeldActive = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        {
            ...args,
            scheduledState: activeBefore,
            continuityState: activeBefore,
        },
    );
    assert.equal(locallyHeldActive.ok, true);
    assert.equal(locallyHeldActive.next.lastTick.action, 'held');
    assert.equal(locallyHeldActive.next.lastTick.threadId, 'THREAD-ACTIVE');
    assert.ok(locallyHeldActive.next.lastTick.reason.length >= 8);
    const adjudicatedActiveHold = loadStage3WorldCandidateValidator({
        pendingAttempts: [pendingAttempt],
        settlement: {
            ledger: {}, pendingWorld: [],
            results: [{
                attemptId: pendingAttempt.id,
                status: 'held',
                worldAdjudicated: true,
                appliedStateChanges: [],
            }],
            worldEvents: [],
        },
    })(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        {
            ...args,
            scheduledState: activeBefore,
            continuityState: activeBefore,
        },
    );
    assert.equal(adjudicatedActiveHold.ok, true);
    assert.equal(adjudicatedActiveHold.next.lastTick.threadId, 'THREAD-ACTIVE');
    const activeHeld = normalizeContinuityState({
        ...structuredClone(activeBefore),
        lastTick: {
            turn: 1, action: 'held', threadId: 'THREAD-ACTIVE',
            reason: '现有活动线程尚未满足继续推进所需条件',
        },
    }, { chatId: 'chat-world-hold' });
    const acceptedActiveHold = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        { ...args, scheduledState: activeBefore, continuityState: activeHeld },
    );
    assert.equal(acceptedActiveHold.ok, true);
    assert.equal(acceptedActiveHold.next.lastTick.threadId, 'THREAD-ACTIVE');
    const driftedActive = normalizeContinuityState({
        ...structuredClone(activeHeld),
        turn: 99,
        lastTick: structuredClone(activeHeld.lastTick),
    }, { chatId: 'chat-world-hold' });
    const normalizedActiveClock = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        { ...args, scheduledState: activeBefore, continuityState: driftedActive },
    );
    assert.equal(normalizedActiveClock.ok, true);
    assert.equal(normalizedActiveClock.next.turn, 1);
    assert.equal(normalizedActiveClock.next.lastTick.threadId, 'THREAD-ACTIVE');
    const unknownActive = normalizeContinuityState({
        ...structuredClone(activeHeld),
        turn: 99,
        lastTick: {
            turn: 1, action: 'held', threadId: 'UNKNOWN',
            reason: '未知目标不应被本地时钟规范化放行',
        },
    }, { chatId: 'chat-world-hold' });
    const locallyReboundUnknown = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        { ...args, scheduledState: activeBefore, continuityState: unknownActive },
    );
    assert.equal(locallyReboundUnknown.ok, true);
    assert.equal(locallyReboundUnknown.next.lastTick.threadId, 'THREAD-ACTIVE');
    assert.notEqual(locallyReboundUnknown.next.lastTick.reason, unknownActive.lastTick.reason);

    const adjacentBefore = normalizeContinuityState({
        ...structuredClone(activeBefore),
        lastTick: {
            turn: 1, action: 'advanced', threadId: 'THREAD-ACTIVE',
            reason: '上一轮已经记录了同一目标回合的调度收据',
        },
    }, { chatId: 'chat-world-hold' });
    const adjacentHeld = normalizeContinuityState({
        ...structuredClone(adjacentBefore),
        lastTick: {
            turn: 1, action: 'held', threadId: 'THREAD-ACTIVE',
            reason: '本轮仍未满足该活动线程继续推进所需条件',
        },
    }, { chatId: 'chat-world-hold' });
    const acceptedAdjacentHold = loadStage3WorldCandidateValidator()(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        { ...args, scheduledState: adjacentBefore, continuityState: adjacentHeld },
    );
    assert.equal(acceptedAdjacentHold.ok, true);
    assert.equal(
        continuityLifecycleStats(adjacentBefore, acceptedAdjacentHold.next).schedulerAdvanced,
        false,
    );
    assert.equal(acceptedAdjacentHold.next.lastTick.threadId, 'THREAD-ACTIVE');
});

test('fresh-chat mechanical nextTurn drift can settle as a validator-proven local WORLD hold', () => {
    const before = normalizeContinuityState({
        chatId: 'chat-fresh-hold', turn: 0, threads: [], world: {}, scenarioPlan: {},
    }, { chatId: 'chat-fresh-hold' });
    const modelCandidate = normalizeContinuityState({
        ...structuredClone(before),
        turn: 1,
        lastTick: {
            turn: 1,
            action: 'held',
            threadId: 'WORLD',
            reason: '本回合没有足够权威依据形成可持久化的世界变化',
        },
    }, { chatId: 'chat-fresh-hold' });
    const validator = loadStage3WorldCandidateValidator();
    const directHold = validator.noSemanticDeltaHeldTerminal(before, modelCandidate, {
        actionAttemptsFullyAdjudicated: true,
        nextTurn: 1,
    });
    assert.ok(directHold, JSON.stringify({ before, modelCandidate }));
    const result = validator(
        { chatId: 'chat-fresh-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'living' },
        {},
        {
            scheduledState: before,
            continuityState: modelCandidate,
            world: {},
            actionAdjudications: [],
            nextTurn: 1,
            worldContextAvailable: true,
        },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.next.turn, 0, 'a safe hold must not fabricate a world-turn advance');
    assert.equal(result.next.lastTick.turn, 1);
    assert.equal(result.next.lastTick.action, 'held');
    assert.equal(result.next.lastTick.threadId, 'WORLD');
    assert.equal(continuityWorldDigest(result.next), continuityWorldDigest(before));
    assert.equal(continuityScenarioDigest(result.next), continuityScenarioDigest(before));
});

test('world local adapter supplies technical defaults and safely holds omitted actor rows', () => {
    const validator = loadStage3WorldCandidateValidator();
    const attempt = {
        id: 'ATT-A', actorId: 'actor-a', intent: 'execute', route: 'foreground_attempt',
        expectedRisk: '输入尝试中的有界风险', resourceCosts: [],
        actorRef: { kind: 'actor_ref', actorId: 'actor-a', displayName: 'Actor A', aliases: [] },
        target: { chatId: 'chat-world-hold', index: 2, logicalIndex: 2 },
    };
    const normalized = validator.normalizeAdjudication({
        actorId: 'actor-a', status: 'success',
        resultSummary: '取得了可验证的新结果',
        observableConsequence: '留下了可观察的新痕迹',
        appliedStateChanges: [{ kind: 'plan', summary: '形成了一项新的后续计划' }],
    }, attempt);
    assert.equal(normalized.attemptId, 'ATT-A');
    assert.equal(normalized.actorRef.actorId, 'actor-a');
    assert.equal(normalized.risk, '输入尝试中的有界风险');
    assert.deepEqual(Array.from(normalized.costs), []);
    assert.deepEqual(Array.from(normalized.actualResourceCosts), []);
    assert.equal(normalized.durationTurns, 1);
    assert.equal(normalized.visibility, 'private');
    assert.equal(validateWorldAdjudicationBatch([normalized], [attempt]).valid, true);

    const downgraded = validator.normalizeAdjudication({
        actorId: 'actor-a', status: 'success', resultSummary: '声称成功',
        observableConsequence: '但没有具体状态变化',
    }, attempt);
    assert.equal(downgraded.status, 'delayed');
    assert.deepEqual(Array.from(downgraded.appliedStateChanges), []);
    assert.equal(validateWorldAdjudicationBatch([downgraded], [attempt]).valid, true);

    const missing = validator.adjudicationsForAttempts([], [attempt]);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].status, 'delayed');
    assert.equal(validateWorldAdjudicationBatch(missing, [attempt]).valid, true);
    const normalizedAgain = validator.normalizeAdjudication(normalized, attempt);
    assert.equal(validateWorldAdjudicationBatch([normalizedAgain], [attempt]).valid, true);
    assert.deepEqual(
        JSON.parse(JSON.stringify(normalizedAgain)),
        JSON.parse(JSON.stringify(normalized)),
        'the Phase 1 persistence boundary may safely normalize the proven row again',
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(validator.heldProposal('actor-a'))),
        {
            actorId: 'actor-a', intent: 'wait',
            candidateAction: '本轮没有形成可验证的自主行动，保持当前计划并等待后续条件',
            stateChanges: [],
        },
    );
});

test('runContinuity carries the proven normalized draft into both Phase 1 persistence paths', () => {
    const run = sourceSection(
        'async function runContinuityTarget(',
        'function sameTargetExceptContent(',
    );
    assert.match(run, /const validatedParsed = draftValidation\.parsed/u);
    assert.match(
        run,
        /stage3PersistPreparedActorAttemptsOnFreshLedger[\s\S]*?parsed: validatedParsed/u,
    );
    assert.match(
        run,
        /stage3PersistAttemptlessPreparedWorldCandidate[\s\S]*?parsed: validatedParsed/u,
    );
    const persist = sourceSection(
        'async function stage3PersistPreparedActorAttemptsOnFreshLedger(',
        'async function stage3PersistAttemptlessPreparedWorldCandidate(',
    );
    assert.match(
        persist,
        /return stage3NormalizeWorldAdjudicationShape\(entry, attempt\)/u,
    );
});

test('P3 settlement diagnostics distinguish semantic, held, and pending attempts', () => {
    const diagnostics = loadActorSchedulingSettlementDiagnostics();
    diagnostics.markSettled([
        { status: 'settled', appliedStateChanges: [{ kind: 'plan', summary: 'delta' }] },
        { worldAdjudicationResult: {
            status: 'partial',
            appliedStateChanges: [{ kind: 'knowledge', summary: 'bounded delta' }],
        } },
        { status: 'partial', appliedStateChanges: [] },
        { status: 'held', appliedStateChanges: [] },
        { status: 'blocked', appliedStateChanges: [] },
        { status: 'rejected', appliedStateChanges: [] },
        { status: 'pending_player', appliedStateChanges: [] },
    ]);
    assert.deepEqual(diagnostics.readDiagnostics(), {
        status: 'settled',
        selected: 7,
        completed: 7,
        succeeded: 2,
        failed: 1,
        semanticActions: 2,
        heldActions: 4,
        scheduledWithoutSemanticAction: 5,
        failureCodes: ['actor_scheduling.world_rejected'],
    });
    const attemptsPrepared = [...source.matchAll(/status: 'attempts_prepared'[\s\S]{0,360}?failureCodes: \[\]/gu)]
        .map((match) => match[0]);
    assert.equal(attemptsPrepared.length, 2);
    for (const block of attemptsPrepared) {
        assert.match(block, /completed: 0, succeeded: 0, failed: 0, semanticActions: 0/u);
        assert.match(block, /scheduledWithoutSemanticAction: pending(?:Actions)?\.attempts\.length/u);
    }
});

test('0/1/3/6 world events each use exactly one production world-model call', async () => {
    const calls = [];
    const generate = loadWorldGenerator(async (messages, options) => {
        calls.push({ messages, options });
        assert.equal(options.failover, true);
        assert.equal(options.maxFailovers, 1);
        assert.equal(options.transportFailoverOnly, true);
        assert.equal(options.noTimeout, true);
        assert.equal(options.runUntilCancelled, true);
        assert.equal(options.timeoutMs, undefined);
        assert.equal(options.validateOutput, undefined);
        const output = validWorldOutput();
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

test('an invalid world draft gets one compact targeted repair before any caller can persist it', async () => {
    const calls = [];
    const generate = loadWorldGenerator(async (messages, options) => {
        calls.push({ messages, options });
        const output = calls.length === 1
            ? validWorldOutput(1)
            : JSON.stringify({ world: { digest: 'repaired semantic delta' } });
        assert.equal(options.validateOutput, undefined);
        return output;
    });
    const output = await generate([{ role: 'user', content: 'large original prompt' }], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).raw?.world?.digest
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.semantic_progress_missing' }
        ),
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.task, '活世界定向补缺');
    assert.equal(calls[1].options.failover, true);
    assert.equal(calls[1].options.maxFailovers, 1);
    assert.equal(calls[1].options.transportFailoverOnly, true);
    assert.match(calls[1].messages[0].content, /world\.semantic_progress_missing/u);
    assert.match(calls[1].messages[0].content, /"repairPatch"/u);
    assert.match(calls[1].messages[0].content, /"threadId":"WORLD"/u);
    assert.doesNotMatch(calls[1].messages[0].content, /"threadId":"\.\.\."/u);
    assert.doesNotMatch(calls[1].messages[0].content, /large original prompt/u);
    assert.equal(parseContinuityOutput(output).raw.world.digest, 'repaired semantic delta');
    assert.equal(parseContinuityOutput(output).raw.lastTick.action, 'held');
});

test('semantic repair targets an active stable thread instead of teaching WORLD', async () => {
    const calls = [];
    const generate = loadWorldGenerator(async (messages) => {
        calls.push(messages);
        return calls.length === 1
            ? validWorldOutput(1)
            : JSON.stringify({
                repairPatch: {
                    lastTick: {
                        turn: 1,
                        action: 'held',
                        threadId: 'THREAD-ACTIVE',
                        reason: '现有活动线程尚未满足继续推进所需条件',
                    },
                },
            });
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).raw?.lastTick?.threadId === 'THREAD-ACTIVE'
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : {
                    ok: false,
                    validationCode: 'world.semantic_progress_missing',
                    repairContext: {
                        family: 'semantic_progress',
                        targetTurn: 1,
                        allowedThreadIds: ['THREAD-ACTIVE'],
                    },
                }
        ),
    });
    assert.equal(calls.length, 2);
    assert.match(calls[1][0].content, /"threadId":"THREAD-ACTIVE"/u);
    assert.match(calls[1][0].content, /threadId must be one of \["THREAD-ACTIVE"\]/u);
    assert.doesNotMatch(calls[1][0].content, /threadId must be WORLD/u);
    assert.equal(parseContinuityOutput(output).raw.lastTick.threadId, 'THREAD-ACTIVE');
});

test('a still-invalid targeted repair stops at two calls and preserves its privacy-safe code', async () => {
    let calls = 0;
    const generate = loadWorldGenerator(async (_messages, options) => {
        calls += 1;
        assert.equal(options.validateOutput, undefined);
        return calls === 1 ? validWorldOutput(1) : JSON.stringify({ world: {} });
    });
    await assert.rejects(
        generate([{ role: 'user', content: 'synthetic prompt' }], {
            captured,
            settings: generatorSettings,
            validateCandidateInMemory: () => ({
                ok: false,
                validationCode: 'world.semantic_progress_missing',
            }),
        }),
        (error) => (
            error?.failureKind === 'validation-error'
            && error?.validationReason === 'world.semantic_progress_missing'
        ),
    );
    assert.equal(calls, 2, 'Advance plus one exact repair is the hard call boundary');
});

test('targeted repair projects allowed fields and ignores unrelated siblings', async () => {
    let calls = 0;
    const generate = loadWorldGenerator(async () => {
        calls += 1;
        const original = JSON.parse(validWorldOutput(7));
        original.threads = [{ id: 'THREAD-KEEP', stage: 'seeded' }];
        return calls === 1
            ? JSON.stringify(original)
            : JSON.stringify({
                actionAdjudications: [],
                threads: [],
                turn: 999,
            });
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => {
            const raw = parseContinuityOutput(candidateOutput).raw;
            return raw?.actionAdjudications
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.actor.adjudication_contract_invalid' };
        },
    });
    const raw = parseContinuityOutput(output).raw;
    assert.equal(raw.turn, 7, 'unrelated turn cannot overwrite the original');
    assert.equal(raw.threads.length, 1, 'unrelated threads cannot clear the original');
    assert.deepEqual(raw.actionAdjudications, []);
    assert.equal(calls, 2);
});

test('targeted repair patch accepts only the exact field family named by its code', async () => {
    let calls = 0;
    const generate = loadWorldGenerator(async () => {
        calls += 1;
        return calls === 1
            ? validWorldOutput(7)
            : JSON.stringify({
                actionProposals: [{ actorId: 'actor-ready', intent: 'wait' }],
            });
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).raw?.actionProposals?.length === 1
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.actor.proposals_incomplete' }
        ),
    });
    const parsed = parseContinuityOutput(output);
    assert.equal(parsed.raw.turn, 7);
    assert.equal(parsed.raw.lastTick.action, 'held');
    assert.equal(parsed.raw.actionProposals.length, 1);
    assert.equal(calls, 2);
});

test('proposal repair replaces only invalid ActorId rows with the production parser minimal shape', async () => {
    const candidate = (actorId, name) => ({
        id: actorId,
        name,
        narrativeProfile: true,
        goals: ['核验本回合新出现的具体线索'],
        knowledgeBasis: ['knowledge-bound'],
        sourceThreads: ['thread-bound'],
        evidence: ['evidence-bound'],
        causalChain: ['cause-bound'],
        knownInteractionTargets: [],
        stimuli: [],
        actorState: {
            location: { name: 'current-location' }, resources: [], capabilities: [],
            actionHistory: [], stateFacts: [], plan: null, lastAction: null,
        },
    });
    const repairedRow = {
        actorId: 'actor-b',
        intent: 'execute',
        candidateAction: '检查本回合新出现的门锁划痕并记录其方向',
        stateChanges: [{ kind: 'plan', summary: '形成一条核验门锁划痕来源的新计划' }],
    };
    assert.ok(
        parseActorShardProposal(JSON.stringify(repairedRow), {
            candidate: candidate('actor-b', 'Actor B'),
        }).proposal,
        'the exact repair shape is completed only from parser-owned safe authority defaults',
    );
    const original = JSON.parse(validWorldOutput(7));
    original.actionProposals = [{
        actorId: 'actor-a', intent: 'execute', candidateAction: 'keep-valid-row',
        stateChanges: [{ kind: 'plan', summary: 'keep-valid-change' }],
        marker: 'must-survive-byte-for-byte',
    }, {
        actorId: 'actor-b', intent: 'execute', candidateAction: 'invalid-old-row',
        stateChanges: [], capabilityUsed: 'invented-capability',
    }];
    let calls = 0;
    const callMessages = [];
    const generate = loadWorldGenerator(async (messages) => {
        calls += 1;
        callMessages.push(messages);
        return calls === 1
            ? JSON.stringify(original)
            : JSON.stringify({
                repairPatch: {
                    actionProposals: [{
                        ...original.actionProposals[0],
                        marker: 'must-not-overwrite-valid-row',
                    }, repairedRow],
                    actionAdjudications: [{ actorId: 'actor-b', status: 'success' }],
                },
                turn: 999,
            });
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        scheduledActorIds: ['actor-a', 'actor-b'],
        validateCandidateInMemory: (candidateOutput) => {
            const rows = parseContinuityOutput(candidateOutput).raw?.actionProposals || [];
            const repaired = rows.find((row) => row.actorId === 'actor-b');
            return repaired?.candidateAction === repairedRow.candidateAction
                && rows.find((row) => row.actorId === 'actor-a')?.marker
                === 'must-survive-byte-for-byte'
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : {
                    ok: false,
                    validationCode: 'world.actor.proposal_invalid',
                    repairContext: {
                        family: 'proposal',
                        allowedActorIds: ['actor-a', 'actor-b'],
                        targetActorIds: ['actor-b'],
                        targets: [{
                            actorId: 'actor-b',
                            validationCode: 'actor_shard.capability_invalid',
                        }],
                    },
                };
        },
    });
    const finalRows = parseContinuityOutput(output).raw.actionProposals;
    assert.equal(calls, 2);
    assert.deepEqual(finalRows[0], original.actionProposals[0]);
    assert.deepEqual(finalRows[1], repairedRow);
    assert.match(callMessages[1][0].content, /actor_shard\.capability_invalid/u);
    assert.match(callMessages[1][0].content, /仅修复这些ActorId行/u);
    assert.doesNotMatch(callMessages[1][0].content, /actor-a/u);
    assert.equal(parseContinuityOutput(output).raw.turn, 7);
    assert.equal(parseContinuityOutput(output).raw.actionAdjudications, undefined);
});

test('production draft validator exposes only fixed invalid proposal ActorId subcodes to repair', () => {
    const code = sourceSection(
        'function stage3ValidateWorldDraftInMemory(captured, settings, actionLedger, parsed, {',
        'function stage3WorldAdjudicationRepairFields(validationCodes = [])',
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        actorActionTargetOf: (value) => structuredClone(value),
        parseActorShardProposal,
    };
    vm.runInNewContext(`${code}\nthis.validateDraft = stage3ValidateWorldDraftInMemory;`, sandbox);
    const baseCandidate = (id, name) => ({
        id, name, narrativeProfile: true,
        goals: ['核验当前新线索'], knowledgeBasis: ['knowledge'],
        sourceThreads: ['thread'], evidence: ['evidence'], causalChain: ['cause'],
        knownInteractionTargets: [], stimuli: [],
        actorState: {
            location: { name: 'current-location' }, resources: [],
            capabilities: ['known-capability'], actionHistory: [], stateFacts: [],
        },
    });
    const validRow = (actorId) => ({
        actorId, intent: 'execute',
        candidateAction: `检查${actorId}对应的新痕迹并记录方向`,
        stateChanges: [{ kind: 'plan', summary: `建立${actorId}的新核验计划` }],
    });
    const candidates = new Map([
        ['actor-a', baseCandidate('actor-a', 'Actor A')],
        ['actor-b', baseCandidate('actor-b', 'Actor B')],
    ]);
    const invalid = validRow('actor-b');
    invalid.capabilityUsed = 'invented-capability';
    const result = sandbox.validateDraft(
        captured,
        generatorSettings,
        {},
        {
            state: { turn: 1 },
            raw: { actionProposals: [validRow('actor-a'), invalid] },
        },
        {
            scheduledActorIds: ['actor-a', 'actor-b'],
            proposalValidationCandidates: candidates,
            scheduledState: { turn: 0 }, nextTurn: 1,
        },
    );
    assert.equal(result.ok, false);
    assert.equal(result.validationCode, 'world.actor.proposal_invalid');
    assert.deepEqual(Array.from(result.repairContext.targetActorIds), ['actor-b']);
    assert.deepEqual(Array.from(result.repairContext.allowedActorIds), ['actor-a', 'actor-b']);
    assert.equal(result.repairContext.targets[0].validationCode, 'actor_shard.capability_invalid');
    assert.equal(JSON.stringify(result.repairContext).includes('Actor B'), false);
});

test('production draft validator locally defers an unadmitted actor batch without keeping model outcomes', () => {
    const code = sourceSection(
        'function stage3HeldActorProposal(',
        'function stage3WorldAdjudicationRepairFields(validationCodes = [])',
    );
    let validatedEnvelope = null;
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        actorActionTargetOf: () => ({ chatId: 'chat-safe-hold', index: 2 }),
        parseActorShardProposal: (value, { candidate }) => ({
            proposal: { ...JSON.parse(value), actorId: candidate.id, actorName: candidate.name },
        }),
        actorActionCandidatesFromShard: (_ledger, proposals) => structuredClone(proposals),
        prepareActorActionAttempts: (ledger) => ({
            ledger: structuredClone(ledger), attempts: [],
            rejected: [{ actorId: 'actor-a', reasons: ['capability-out-of-bounds'] }],
        }),
        recordActorActionAttempts: () => {
            throw new Error('an unadmitted proposal must never be recorded');
        },
        validateWorldAdjudicationBatch: () => {
            throw new Error('model adjudications must be discarded with the rejected proposal batch');
        },
        stage3ValidateWorldCandidateInMemory: (_captured, _settings, ledger, envelope) => {
            validatedEnvelope = structuredClone(envelope);
            return { ok: true, ledger };
        },
        stage3SafeHeldDraftAfterParseFailure: (scheduledState, { nextTurn }) => ({
            ...structuredClone(scheduledState),
            turn: nextTurn,
            lastTick: {
                turn: nextTurn, action: 'held', threadId: 'THREAD-1',
                reason: '模型输出格式无法安全恢复，本回合保留既有世界状态',
            },
            world: {},
        }),
    };
    vm.runInNewContext(`${code}\nthis.validateDraft = stage3ValidateWorldDraftInMemory;`, sandbox);
    const parsed = {
        state: {
            turn: 3,
            threads: [{ id: 'MODEL-SMUGGLED', stage: 'advanced' }],
            world: { modelOutcome: 'must be discarded' },
        },
        raw: {
            world: { modelOutcome: 'must be discarded' },
            actionProposals: [{
                actorId: 'actor-a', intent: 'execute',
                candidateAction: '使用不存在的能力完成行动',
                stateChanges: [{ kind: 'plan', summary: '伪造完成结果' }],
            }],
            actionAdjudications: [{
                actorId: 'actor-a', status: 'success',
                appliedStateChanges: [{ kind: 'plan', summary: '伪造完成结果' }],
            }],
        },
    };
    const result = sandbox.validateDraft(
        { chatId: 'chat-safe-hold', index: 2 },
        { continuityMaxThreads: 24 },
        { actors: [{ id: 'actor-a' }] },
        parsed,
        {
            scheduledActorIds: ['actor-a'],
            proposalValidationCandidates: new Map([[
                'actor-a',
                {
                    id: 'actor-a', name: 'Actor A', narrativeProfile: true,
                    actorState: { location: { name: '原地' } },
                },
            ]]),
            pendingActorAttempts: [],
            scheduledState: {
                turn: 2,
                threads: [{ id: 'THREAD-1', stage: 'advancing' }],
                scenarioPlan: {}, world: { stable: true },
            },
            nextTurn: 3,
        },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(result.deferredActorIds), ['actor-a']);
    assert.deepEqual(Array.from(result.parsed.raw.actionProposals), []);
    assert.deepEqual(Array.from(result.parsed.raw.actionAdjudications), []);
    assert.equal(JSON.stringify(result.parsed.raw.world), '{}');
    assert.match(result.parsed.state.lastTick.reason, /本地权威校验/u);
    assert.deepEqual(Array.from(validatedEnvelope.actionAdjudications), []);
    assert.equal(JSON.stringify(validatedEnvelope.world), '{}');
    assert.match(sourceSection(
        'function doctorRuntimeCriticalFingerprint()',
        'function diagnosticPayload()',
    ), /stage3SafeHeldParsedAfterActorAdmissionFailure\.toString\(\)/u);
});

test('actor-admission safe hold stays fail-closed when a persisted ATT already exists', () => {
    const code = sourceSection(
        'function stage3HeldActorProposal(',
        'function stage3WorldAdjudicationRepairFields(validationCodes = [])',
    );
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        actorActionTargetOf: () => ({ chatId: 'chat-safe-hold', index: 2 }),
        parseActorShardProposal: (value, { candidate }) => ({
            proposal: { ...JSON.parse(value), actorId: candidate.id, actorName: candidate.name },
        }),
        actorActionCandidatesFromShard: (_ledger, proposals) => structuredClone(proposals),
        prepareActorActionAttempts: (ledger) => ({
            ledger: structuredClone(ledger), attempts: [],
            rejected: [{ actorId: 'actor-a', reasons: ['capability-out-of-bounds'] }],
        }),
        stage3SafeHeldDraftAfterParseFailure: () => {
            throw new Error('persisted ATT must prevent local draft replacement');
        },
    };
    vm.runInNewContext(`${code}\nthis.validateDraft = stage3ValidateWorldDraftInMemory;`, sandbox);
    const result = sandbox.validateDraft(
        { chatId: 'chat-safe-hold', index: 2 },
        { continuityMaxThreads: 24 },
        { actors: [{ id: 'actor-a' }] },
        {
            state: { turn: 3 },
            raw: { actionProposals: [{ actorId: 'actor-a', intent: 'wait' }] },
        },
        {
            scheduledActorIds: ['actor-a'],
            proposalValidationCandidates: new Map([[
                'actor-a',
                { id: 'actor-a', name: 'Actor A', actorState: { location: { name: '原地' } } },
            ]]),
            pendingActorAttempts: [{ id: 'ATT-EXISTING' }],
            scheduledState: { turn: 2 },
            nextTurn: 3,
        },
    );
    assert.equal(result.ok, false);
    assert.equal(result.validationCode, 'world.actor.attempt_prepare_incomplete');
});

test('proposal repair rejects missing duplicate or unknown target rows without a third call', async () => {
    for (const repairRows of [
        [],
        [
            { actorId: 'actor-b', intent: 'wait', candidateAction: '等待证据', stateChanges: [] },
            { actorId: 'actor-b', intent: 'wait', candidateAction: '重复行', stateChanges: [] },
        ],
        [{ actorId: 'actor-unknown', intent: 'wait', candidateAction: '未知行', stateChanges: [] }],
    ]) {
        let calls = 0;
        const original = JSON.parse(validWorldOutput(7));
        original.actionProposals = [{ actorId: 'actor-b', intent: 'execute' }];
        const generate = loadWorldGenerator(async () => {
            calls += 1;
            return calls === 1
                ? JSON.stringify(original)
                : JSON.stringify({ repairPatch: { actionProposals: repairRows } });
        });
        await assert.rejects(generate([], {
            captured,
            settings: generatorSettings,
            scheduledActorIds: ['actor-b'],
            validateCandidateInMemory: () => ({
                ok: false,
                validationCode: 'world.actor.proposal_invalid',
                repairContext: {
                    family: 'proposal', allowedActorIds: ['actor-b'], targetActorIds: ['actor-b'],
                    targets: [{ actorId: 'actor-b', validationCode: 'actor_shard.proposal_invalid' }],
                },
            }),
        }), (error) => (
            error?.validationReason === 'world.targeted_repair.patch_invalid'
            && error?.initialValidationCode === 'world.actor.proposal_invalid'
        ));
        assert.equal(calls, 2);
    }

});

test('adjudication contract failures expose fixed fields and repair only the failed ActorRef row', async () => {
    const attempts = [{
        id: 'ATT-A', actorId: 'actor-a', actorRef: { kind: 'actor_ref', actorId: 'actor-a' },
        route: 'foreground_attempt', intent: 'execute', resourceCosts: [],
    }, {
        id: 'ATT-B', actorId: 'actor-b', actorRef: { kind: 'actor_ref', actorId: 'actor-b' },
        route: 'foreground_attempt', intent: 'execute', resourceCosts: [],
    }];
    const decision = (attemptId, actorId, appliedStateChanges) => ({
        attemptId, actorId, status: 'success', risk: 'bounded', costs: [],
        actualResourceCosts: [], durationTurns: 1, visibility: 'private',
        observerActorIds: [], resultSummary: 'bounded result',
        observableConsequence: 'bounded trace', revealPath: '', appliedStateChanges,
    });
    const original = JSON.parse(validWorldOutput(7));
    original.actionAdjudications = [
        { ...decision('', 'actor-a', []), attemptId: undefined },
        {
            ...decision('', 'actor-b', [{ kind: 'plan', summary: 'valid plan change' }]),
            attemptId: undefined,
            marker: 'keep-valid',
        },
    ];
    const mapFailure = loadStage3AdjudicationFailureMapper();
    const bindAuthority = (rows) => rows.map((row) => ({
        ...row,
        attemptId: row.actorId === 'actor-a' ? 'ATT-A' : 'ATT-B',
    }));
    const firstBoundRows = bindAuthority(original.actionAdjudications);
    const firstBatch = validateWorldAdjudicationBatch(firstBoundRows, attempts);
    const firstFailure = mapFailure(firstBatch.errors, attempts, firstBoundRows);
    assert.equal(firstFailure.validationCode, 'world.actor.adjudication_contract.applied_state_changes_missing');
    assert.equal(firstFailure.repairContext.family, 'adjudication');
    assert.deepEqual(Array.from(firstFailure.repairContext.allowedPairs, (entry) => ({ ...entry })), [
        { actorId: 'actor-a', attemptId: 'ATT-A' },
        { actorId: 'actor-b', attemptId: 'ATT-B' },
    ]);
    assert.deepEqual(Array.from(firstFailure.repairContext.targets[0].repairFields), [
        'status', 'appliedStateChanges',
    ]);
    assert.equal(JSON.stringify(firstFailure.repairContext).includes('displayName'), false);

    let calls = 0;
    const callMessages = [];
    const generate = loadWorldGenerator(async (messages) => {
        calls += 1;
        callMessages.push(messages);
        return calls === 1
            ? JSON.stringify(original)
            : JSON.stringify({
                repairPatch: {
                    actionAdjudications: [{
                        ...original.actionAdjudications[1],
                        marker: 'must-not-overwrite-valid-adjudication',
                    }, {
                        attemptId: 'ATT-A',
                        status: 'delayed',
                        appliedStateChanges: [],
                        risk: 'must-not-overwrite-existing-risk',
                    }],
                },
            });
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        scheduledActorIds: ['actor-a', 'actor-b'],
        validateCandidateInMemory: (candidateOutput) => {
            const rows = parseContinuityOutput(candidateOutput).raw?.actionAdjudications || [];
            const boundRows = bindAuthority(rows);
            const checked = validateWorldAdjudicationBatch(boundRows, attempts);
            return checked.valid
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : mapFailure(checked.errors, attempts, boundRows);
        },
    });
    const finalRows = parseContinuityOutput(output).raw.actionAdjudications;
    assert.equal(calls, 2);
    assert.equal(finalRows[0].status, 'delayed');
    assert.equal(finalRows[0].attemptId, undefined, 'scheduled ATT authority stays local');
    assert.equal(finalRows[0].risk, 'bounded', 'unlisted valid fields cannot be overwritten');
    const expectedValidRow = structuredClone(original.actionAdjudications[1]);
    delete expectedValidRow.attemptId;
    assert.deepEqual(finalRows[1], expectedValidRow);
    assert.match(callMessages[1][0].content, /applied_state_changes_missing/u);
    assert.match(callMessages[1][0].content, /ATT-A/u);
    assert.doesNotMatch(callMessages[1][0].content, /ATT-B/u);
});

test('adjudication local repair rejects missing duplicate and unknown failed rows at two calls', async () => {
    const repairContext = {
        family: 'adjudication',
        allowedActorIds: ['actor-a', 'actor-b'],
        allowedAttemptIds: ['ATT-A', 'ATT-B'],
        allowedPairs: [
            { actorId: 'actor-a', attemptId: 'ATT-A' },
            { actorId: 'actor-b', attemptId: 'ATT-B' },
        ],
        targets: [{
            actorId: 'actor-a',
            attemptId: 'ATT-A',
            validationCodes: ['world.actor.adjudication_contract.risk_missing'],
            repairFields: ['risk'],
        }],
    };
    for (const rows of [
        [],
        [{ attemptId: 'ATT-A', risk: 'one' }, { actorId: 'actor-a', risk: 'duplicate' }],
        [{ attemptId: 'ATT-UNKNOWN', risk: 'unknown' }],
        [{ actorId: 'actor-unknown', attemptId: 'ATT-A', risk: 'wrong actor' }],
        [{ actorId: 'actor-a', attemptId: 'ATT-UNKNOWN', risk: 'wrong attempt' }],
        [
            { actorId: 'actor-a', attemptId: 'ATT-A', risk: 'fixed target' },
            { actorId: 'actor-b', attemptId: 'ATT-A', risk: 'mismatched redundant row' },
        ],
    ]) {
        let calls = 0;
        const original = JSON.parse(validWorldOutput(7));
        original.actionAdjudications = [
            { attemptId: 'ATT-A', actorId: 'actor-a', risk: '' },
            { attemptId: 'ATT-B', actorId: 'actor-b', risk: 'valid' },
        ];
        const generate = loadWorldGenerator(async () => {
            calls += 1;
            return calls === 1
                ? JSON.stringify(original)
                : JSON.stringify({ repairPatch: { actionAdjudications: rows } });
        });
        await assert.rejects(generate([], {
            captured,
            settings: generatorSettings,
            validateCandidateInMemory: () => ({
                ok: false,
                validationCode: 'world.actor.adjudication_contract.risk_missing',
                repairContext,
            }),
        }), (error) => (
            error?.validationReason === 'world.targeted_repair.patch_invalid'
            && error?.initialValidationCode === 'world.actor.adjudication_contract.risk_missing'
            && error?.repairFamily === 'adjudication'
        ));
        assert.equal(calls, 2);
    }

    let originalMismatchCalls = 0;
    const mismatchedOriginal = JSON.parse(validWorldOutput(7));
    mismatchedOriginal.actionAdjudications = [
        { actorId: 'actor-a', attemptId: 'ATT-B', risk: '' },
    ];
    const originalMismatch = loadWorldGenerator(async () => {
        originalMismatchCalls += 1;
        return originalMismatchCalls === 1
            ? JSON.stringify(mismatchedOriginal)
            : JSON.stringify({
                repairPatch: {
                    actionAdjudications: [{
                        actorId: 'actor-a', attemptId: 'ATT-A', risk: 'fixed',
                    }],
                },
            });
    });
    await assert.rejects(originalMismatch([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: () => ({
            ok: false,
            validationCode: 'world.actor.adjudication_contract.risk_missing',
            repairContext,
        }),
    }), (error) => error?.validationReason === 'world.targeted_repair.patch_invalid');
    assert.equal(originalMismatchCalls, 2);
});

test('targeted repair mechanically extracts explicit wrappers aliases and array roots', async () => {
    const shapes = [
        JSON.stringify({
            repairPatch: { action_adjudications: [{ actorId: 'actor-ready', status: 'blocked' }] },
            explanation: 'ignored transport decoration',
        }),
        JSON.stringify({ patch: { adjudications: [{ actorId: 'actor-ready', status: 'blocked' }] } }),
        JSON.stringify([{ actorId: 'actor-ready', status: 'blocked' }]),
    ];
    for (const repairShape of shapes) {
        let calls = 0;
        const generate = loadWorldGenerator(async () => {
            calls += 1;
            return calls === 1 ? validWorldOutput(7) : repairShape;
        });
        const output = await generate([], {
            captured,
            settings: generatorSettings,
            validateCandidateInMemory: (candidateOutput) => {
                const raw = parseContinuityOutput(candidateOutput).raw;
                return raw?.actionAdjudications?.[0]?.actorId === 'actor-ready'
                    ? { ok: true, validationCode: 'world.candidate.valid' }
                    : { ok: false, validationCode: 'world.actor.adjudication_contract_invalid' };
            },
        });
        const raw = parseContinuityOutput(output).raw;
        assert.equal(raw.actionAdjudications[0].status, 'blocked');
        assert.equal(raw.turn, 7);
        assert.equal(calls, 2);
    }
});

test('targeted repair rejects a zero-hit patch and never repairs an unknown family', async () => {
    let zeroHitCalls = 0;
    const zeroHit = loadWorldGenerator(async () => {
        zeroHitCalls += 1;
        return zeroHitCalls === 1
            ? validWorldOutput(7)
            : JSON.stringify({ repairPatch: { explanation: 'no allowed field' } });
    });
    await assert.rejects(
        zeroHit([], {
            captured,
            settings: generatorSettings,
            validateCandidateInMemory: () => ({
                ok: false,
                validationCode: 'world.actor.adjudication_contract_invalid',
            }),
        }),
        (error) => (
            error?.validationReason === 'world.targeted_repair.patch_invalid'
            && error?.initialValidationCode === 'world.actor.adjudication_contract_invalid'
            && error?.repairFamily === 'adjudication'
        ),
    );
    assert.equal(zeroHitCalls, 2);

    let unknownCalls = 0;
    const unknown = loadWorldGenerator(async () => {
        unknownCalls += 1;
        return validWorldOutput(7);
    });
    await assert.rejects(
        unknown([], {
            captured,
            settings: generatorSettings,
            validateCandidateInMemory: () => ({
                ok: false,
                validationCode: 'world.candidate.invalid',
            }),
        }),
        (error) => error?.validationReason === 'world.candidate.invalid',
    );
    assert.equal(unknownCalls, 1, 'unknown repair families do not consume a second model call');
});

test('an unparseable first draft accepts one strict complete-root repair', async () => {
    let calls = 0;
    const generate = loadWorldGenerator(async () => {
        calls += 1;
        return calls === 1 ? 'not JSON' : validWorldOutput(9);
    });
    const output = await generate([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).state
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.output.parse_invalid' }
        ),
    });
    assert.equal(parseContinuityOutput(output).raw.turn, 9);
    assert.equal(calls, 2);
    const generator = sourceSection(
        'async function generateWorldContinuitySingleBatch(messages, {',
        'async function persistActorRegistryForTurn(captured, {',
    );
    assert.match(generator, /validationCode === 'world\.output\.parse_invalid'[\s\S]*?stage3WorldCompleteParseRepairCandidate/u);
    assert.doesNotMatch(generator, /writeChatNamespace|persistActorActionAttemptsForTurn/u);
});

test('parse repair rejects malformed, ambiguous, incomplete and actor-incomplete roots at two calls', async () => {
    const cases = [
        { repair: 'still not JSON' },
        {
            repair: JSON.stringify({
                ContinuityState: JSON.parse(validWorldOutput(1)),
                sibling: 'ambiguous',
            }),
        },
        { repair: JSON.stringify({ world: {} }) },
        { repair: validWorldOutput(1), scheduledActorIds: ['actor-ready'] },
    ];
    for (const item of cases) {
        let calls = 0;
        const generate = loadWorldGenerator(async () => {
            calls += 1;
            return calls === 1 ? 'not JSON' : item.repair;
        });
        await assert.rejects(
            generate([], {
                captured,
                settings: generatorSettings,
                scheduledActorIds: item.scheduledActorIds || [],
                validateCandidateInMemory: (candidateOutput) => (
                    parseContinuityOutput(candidateOutput).state
                        ? { ok: true, validationCode: 'world.candidate.valid' }
                        : { ok: false, validationCode: 'world.output.parse_invalid' }
                ),
            }),
            (error) => (
                error?.failureKind === 'validation-error'
                && error?.validationReason === 'world.output.parse_invalid'
            ),
        );
        assert.equal(calls, 2);
    }
});

test('two parse failures degrade a structure-only turn to a validator-proven held receipt', () => {
    const safeHeldDraft = loadStage3SafeHeldDraftAfterParseFailure();
    const scheduledBase = normalizeContinuityState({
        turn: 4,
        lastTick: {
            turn: 3,
            action: 'advanced',
            threadId: 'THREAD-A',
            reason: '此前已有可验证推进',
        },
        threads: [{
            id: 'THREAD-A',
            title: '既有线程',
            stage: 'active',
            urgency: 2,
            nextBeat: '等待下一条件',
        }],
        scenarioPlan: { amendments: [{ id: 'PLAN-A', status: 'held' }] },
        world: { facts: [{ id: 'FACT-A', value: 'kept' }] },
    }, { maxThreads: 24, maxResolved: 24 });
    const draft = safeHeldDraft(scheduledBase, { nextTurn: 4 });
    assert.equal(draft.lastTick.threadId, 'THREAD-A');
    assert.equal(draft.lastTick.action, 'held');
    assert.deepEqual(draft.threads, scheduledBase.threads);
    assert.deepEqual(draft.scenarioPlan, scheduledBase.scenarioPlan);
    assert.equal(JSON.stringify(draft.world), '{}');

    const validate = loadStage3WorldCandidateValidator();
    const validation = validate(
        { chatId: 'chat-world-hold' },
        { continuityMaxThreads: 24, continuityAutonomy: 'balanced' },
        {},
        {
            scheduledState: scheduledBase,
            continuityState: draft,
            world: draft.world,
            actionAdjudications: [],
            nextTurn: 4,
            worldContextAvailable: true,
        },
    );
    assert.equal(validation.ok, true);
    assert.equal(validation.next.lastTick.action, 'held');
    assert.equal(validation.next.lastTick.threadId, 'THREAD-A');
    assert.equal(continuityWorldDigest(validation.next), continuityWorldDigest(scheduledBase));
    assert.equal(
        continuityScenarioDigest(validation.next),
        continuityScenarioDigest(scheduledBase),
    );
});

test('parse-failure safe hold defers only unpersisted scheduling and never drops a pending ATT', () => {
    const safeHeldDraft = loadStage3SafeHeldDraftAfterParseFailure();
    const base = normalizeContinuityState({ turn: 1 }, { maxThreads: 24, maxResolved: 24 });
    assert.ok(safeHeldDraft(base, {
        nextTurn: 1,
        scheduledActorIds: ['actor-ready'],
    }));
    assert.equal(safeHeldDraft(base, {
        nextTurn: 1,
        pendingActorAttempts: [{ attemptId: 'ATT-1' }],
    }), null);

    const run = sourceSection(
        'async function runContinuityTarget(',
        'function sameTargetExceptContent(',
    );
    assert.match(run, /safeValidationReason === 'world\.output\.parse_invalid'[\s\S]*?stage3SafeHeldDraftAfterParseFailure/u);
    assert.match(run, /scheduledActorIds,[\s\S]*?pendingActorAttempts: pendingActions\.attempts/u);
    assert.match(run, /actor_scheduling\.advance_parse_deferred_to_hold[\s\S]*?scheduledActorIds = \[\]/u);
    assert.match(run, /proposalValidationCandidates\.clear\(\)/u);
    assert.match(run, /recoveryReason = 'local_safe_hold_after_parse_failure'/u);
    assert.match(run, /deferredActorCount = parseFailureDeferredActorCount/u);
    assert.match(sourceSection(
        'function doctorRuntimeCriticalFingerprint()',
        'function diagnosticPayload()',
    ), /stage3SafeHeldDraftAfterParseFailure\.toString\(\)/u);
});

test('P3 reports both Advance and its one targeted repair as real world model calls', () => {
    const generator = sourceSection(
        'async function generateWorldContinuitySingleBatch(',
        'async function persistActorRegistryForTurn(',
    );
    const run = sourceSection(
        'async function runContinuityTarget(',
        'function sameTargetExceptContent(',
    );
    assert.match(generator, /onModelCall\('advance'\)[\s\S]*?callModel\(messages/u);
    assert.match(generator, /onModelCall\('targeted_repair'\)[\s\S]*?callModel\(repairMessages/u);
    assert.match(run, /let worldModelCalls = 0/u);
    assert.match(run, /onModelCall:\s*\(\) => \{ worldModelCalls \+= 1; \}/u);
    assert.doesNotMatch(run, /modelStartedAt/u);
    assert.match(run, /onMetrics:\s*\(metrics\) => \{[\s\S]*?queueWaitMs \+=[\s\S]*?modelMs \+=[\s\S]*?parseMs \+=[\s\S]*?validationMs \+=/u);
    assert.match(run, /worldModelCalls,\s*\n\s*timings:/u);
    assert.doesNotMatch(run, /worldModelCalls:\s*1/u);
});

test('P3 timing metrics count each model call without charging local validation to modelMs', async () => {
    const metricEvents = [];
    let calls = 0;
    const generate = loadWorldGenerator(async (_messages, options) => {
        calls += 1;
        options.timingSink({ queueWaitMs: 3, modelMs: 8 });
        return calls === 1
            ? validWorldOutput(1)
            : JSON.stringify({ world: { digest: 'valid increment' } });
    });
    await generate([], {
        captured,
        settings: generatorSettings,
        onMetrics: (entry) => metricEvents.push(entry),
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).raw?.world?.digest
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.semantic_progress_missing' }
        ),
    });
    const modelEvents = metricEvents.filter((entry) => Number(entry.modelMs) > 0);
    assert.equal(modelEvents.length, 2);
    assert.equal(modelEvents.reduce((sum, entry) => sum + entry.modelMs, 0), 16);
    assert.equal(modelEvents.reduce((sum, entry) => sum + entry.queueWaitMs, 0), 6);
    assert.ok(metricEvents.some((entry) => Object.hasOwn(entry, 'parseMs')));
    assert.ok(metricEvents.some((entry) => Object.hasOwn(entry, 'validationMs')));
});

test('targeted repair reuses the responsive Advance slot while preserving transport-only backup', async () => {
    const seenOptions = [];
    let calls = 0;
    const generate = loadWorldGenerator(async (_messages, options) => {
        calls += 1;
        seenOptions.push({
            routeSlotIndex: options.routeSlotIndex,
            failover: options.failover,
            maxFailovers: options.maxFailovers,
            transportFailoverOnly: options.transportFailoverOnly,
        });
        if (calls === 1) options.timingSink({
            queueWaitMs: 0, modelMs: 2, routeSlotIndex: 1, transportStatus: 'failed',
        });
        options.timingSink({
            queueWaitMs: 0, modelMs: 5, routeSlotIndex: 2, transportStatus: 'succeeded',
        });
        return calls === 1
            ? validWorldOutput(1)
            : JSON.stringify({ world: { digest: 'bounded repaired delta' } });
    });
    await generate([], {
        captured,
        settings: generatorSettings,
        validateCandidateInMemory: (candidateOutput) => (
            parseContinuityOutput(candidateOutput).raw?.world?.digest
                ? { ok: true, validationCode: 'world.candidate.valid' }
                : { ok: false, validationCode: 'world.semantic_progress_missing' }
        ),
    });
    assert.equal(calls, 2);
    assert.equal(seenOptions[0].routeSlotIndex, undefined);
    assert.equal(seenOptions[1].routeSlotIndex, 2);
    assert.equal(seenOptions[1].failover, true);
    assert.equal(seenOptions[1].maxFailovers, 1);
    assert.equal(seenOptions[1].transportFailoverOnly, true);
});

test('the production authority validator rejects success with empty applied state before Phase1', () => {
    const attempt = {
        id: 'ATT-P3-PREFLIGHT', actorId: 'actor-ready', intent: 'execute',
        route: 'foreground_attempt', resourceCosts: [],
    };
    const result = validateWorldAdjudicationBatch([{
        attemptId: attempt.id,
        status: 'success',
        risk: 'bounded risk',
        costs: [],
        actualResourceCosts: [],
        durationTurns: 1,
        visibility: 'private',
        observerActorIds: [],
        resultSummary: 'the attempt was reported as successful',
        observableConsequence: 'a bounded trace would exist',
        revealPath: '',
        appliedStateChanges: [],
    }], [attempt]);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].reason, 'world_adjudication_contract_invalid');
    assert.deepEqual(result.errors[0].contractCodes, ['applied_state_changes_missing']);
    const helper = sourceSection(
        'function stage3ValidateWorldDraftInMemory(',
        'async function commitPreparedWorldCandidate(',
    );
    assert.match(helper, /validateWorldAdjudicationBatch/u);
    assert.match(helper, /stage3ValidateWorldCandidateInMemory/u);
    assert.match(
        helper,
        /stage3WorldAdjudicationValidationFailure\([\s\S]*?adjudications\.errors,[\s\S]*?recorded\.recorded/u,
    );
    assert.match(helper, /world_adjudication_contract_invalid/u);
    assert.match(helper, /world\.actor\.\$\{firstReason/u);
    const generator = sourceSection(
        'async function generateWorldContinuitySingleBatch(',
        'async function persistActorRegistryForTurn(',
    );
    assert.match(
        generator,
        /stage3WorldValidationExpectedShape\(\s*validationCode,\s*repairContext/u,
    );
    assert.match(generator, /最小期望形状/u);
});

test('production P3 uses the background lane and only host generateRaw is foreground-preemptible', () => {
    const generator = sourceSection(
        'async function generateWorldContinuitySingleBatch',
        'async function persistActorRegistryForTurn',
    );
    assert.match(generator, /runUntilCancelled: true/u);
    const runner = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(
        runner,
        /generateWorldContinuitySingleBatch[\s\S]*?runUntilCancelled: true/u,
    );
    const model = sourceSection(
        'async function callModel(messages, options = {})',
        'async function probeModelChannelConnections',
    );
    assert.match(model, /const backgroundLane = runUntilCancelled/u);
    assert.match(model, /mvuadUsesHostGenerateRaw/u);
    assert.match(model, /profile\.provider !== 'direct'/u);
    assert.match(model, /:background/u);
    const lifecycle = sourceSection('function bindEvents()', 'async function initialize()');
    assert.match(lifecycle, /await preemptHostBackgroundModelControllersForForegroundGeneration\(\)/u);
    assert.match(
        lifecycle,
        /foregroundGenerationStarting = starting[\s\S]*?await preemptHostBackgroundModelControllersForForegroundGeneration\(\)[\s\S]*?activeGenerationSession = lastGeneration[\s\S]*?finally[\s\S]*?foregroundGenerationStarting = null/u,
        'the host-background gate must cover the microtask window before the foreground session is installed',
    );
    const preempt = sourceSection(
        'async function preemptHostBackgroundModelControllersForForegroundGeneration(',
        "async function cancelRunningSovereigntyTasks(reason = 'user_cancelled')",
    );
    assert.match(preempt, /internalQuietGenerationStop = true[\s\S]*?GENERATION_STOPPED[\s\S]*?internalQuietGenerationStop = false/u);
    assert.match(lifecycle, /GENERATION_STOPPED[\s\S]*?if \(internalQuietGenerationStop\) return/u);
});

test('a foreground-preempted P3 target is resumed from the existing serial chain before the next target', () => {
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    const queue = sourceSection(
        'async function enqueueContinuity(targetId, {',
        'function stage3AttemptProjection(ledger, target)',
    );
    assert.match(run, /failureKind === 'foreground_preempted'[\s\S]*?'foreground_preempted'/u);
    assert.match(queue, /continuityChain[\s\S]*?priorResult\?\.stage3RecoveryTarget/u);
    assert.match(
        queue,
        /afterPending[\s\S]*?\.then\(\(priorResult\) => \{[\s\S]*?priorResult\?\.reason === 'foreground_preempted'[\s\S]*?return priorResult/u,
        'an afterPending wake must preserve foreground-preempted recovery instead of restarting during the narrative',
    );
    assert.match(queue, /stage3AcceptedTargetIsStrictlyNewer\(expected, recoveryExpected\)/u);
    assert.match(queue, /await runContinuityTarget\(recoveryTarget,[\s\S]*?force: true/u);
    assert.ok(
        queue.indexOf('await runContinuityTarget(recoveryTarget,')
            < queue.lastIndexOf('return runContinuityTarget(fresh,'),
        'the old unsettled accepted target must settle before the new accepted target starts',
    );
    assert.doesNotMatch(queue, /new Map\(|localStorage|sessionStorage/u);
    assert.match(
        queue,
        /recoverableCheckpointConflict[\s\S]*?world_committed_manual_reconciliation[\s\S]*?result\?\.status === 'failed' && !recoverableCheckpointConflict/u,
        'a proof-invalid checkpoint remains retryable after its authority converges',
    );
});

test('explicit invalidation detaches an unresponsive P3 owner while foreground preemption keeps its chain', async () => {
    const staleResultSource = sourceSection(
        'function stage3StaleValidationCode(reason)',
        'function stage3AcceptedTargetIsStrictlyNewer(currentValue, priorValue)',
    );
    const queueSource = sourceSection(
        'async function stage3AwaitAcceptedFinalP4Barrier(startBarrier)',
        'function stage3AttemptProjection(ledger, target)',
    );
    const invalidateSource = sourceSection(
        'function invalidateContinuityQueue()',
        'function worldCallReservedForUserCancellation(namespace, captured)',
    );
    const state = {
        current: { chatId: 'chat-a', index: 4, epoch: 1, key: 'same-target' },
        calls: 0,
        terminalWrites: 0,
        statusWrites: 0,
        releases: [],
    };
    const sandbox = {
        operationEpoch: 1,
        actorWorldManagementWrite: null,
        continuityPendingKeys: new Map(),
        continuityCompletedKeys: new Set(),
        continuityChain: Promise.resolve(),
        getContext: () => ({ chatId: 'chat-a' }),
        latestAiMessage: () => ({ index: 4 }),
        captureTarget: () => structuredClone(state.current),
        stage3AcceptedTargetKey: (target) => target.key,
        stage3AcceptedTarget: (target) => target,
        stage3AcceptedTargetsMatch: (left, right) => left?.key === right?.key,
        stage3AcceptedTargetIsStrictlyNewer: () => false,
        runContinuityTarget: async () => {
            state.calls += 1;
            return new Promise((resolve) => state.releases.push(resolve));
        },
        recordStage3WorldFinalDiagnostic: async () => { state.terminalWrites += 1; },
        setContinuityStatus: () => { state.statusWrites += 1; },
        renderSovereigntyHealth: () => undefined,
        syncTaskCancelButtons: () => undefined,
        safeDiagnosticReason: (value) => String(value || ''),
        deepClone: (value) => structuredClone(value),
    };
    vm.runInNewContext(
        `${staleResultSource}\n${queueSource}\n${invalidateSource}\n`
        + 'this.enqueue = enqueueContinuity; this.invalidateWorld = invalidateContinuityQueue;',
        sandbox,
    );

    const oldTarget = structuredClone(state.current);
    const oldTask = sandbox.enqueue(4, { force: true, expectedTarget: oldTarget });
    while (state.calls < 1) await new Promise((resolve) => setImmediate(resolve));

    sandbox.operationEpoch = 2;
    state.current = { ...state.current, epoch: 2 };
    sandbox.invalidateWorld();
    const newTask = sandbox.enqueue(4, {
        force: true, manualRecovery: true, expectedTarget: structuredClone(state.current),
    });
    while (state.calls < 2) await new Promise((resolve) => setImmediate(resolve));
    const newOwner = sandbox.continuityPendingKeys.get('same-target');
    assert.ok(newOwner, 'the replacement owner must start before the old provider settles');

    state.releases[0]({ status: 'applied', readbackVerified: true });
    await oldTask;
    assert.equal(sandbox.continuityPendingKeys.get('same-target'), newOwner);
    assert.equal(state.terminalWrites, 0, 'the stale owner must not append a terminal receipt');
    assert.equal(state.statusWrites, 0, 'the stale owner must not update current UI authority');

    state.releases[1]({ status: 'applied', readbackVerified: true });
    assert.equal((await newTask).status, 'applied');
    assert.equal(state.terminalWrites, 1);
    assert.equal(sandbox.continuityPendingKeys.has('same-target'), false);

    state.current = { ...state.current, key: 'foreground-target' };
    const preemptedTask = sandbox.enqueue(4, {
        force: true, expectedTarget: structuredClone(state.current),
    });
    while (state.calls < 3) await new Promise((resolve) => setImmediate(resolve));
    const joined = sandbox.enqueue(4, {
        force: true, afterPending: true, expectedTarget: structuredClone(state.current),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls, 3, 'foreground preemption must not detach or duplicate the owner');
    state.releases[2]({ status: 'stale', reason: 'foreground_preempted' });
    assert.equal((await preemptedTask).reason, 'foreground_preempted');
    assert.equal((await joined).reason, 'foreground_preempted');
});

test('a detached P3 owner cannot enter the model after prior-chain or start-barrier release', async () => {
    const staleResultSource = sourceSection(
        'function stage3StaleValidationCode(reason)',
        'function stage3AcceptedTargetIsStrictlyNewer(currentValue, priorValue)',
    );
    const queueSource = sourceSection(
        'async function stage3AwaitAcceptedFinalP4Barrier(startBarrier)',
        'function stage3AttemptProjection(ledger, target)',
    );
    const invalidateSource = sourceSection(
        'function invalidateContinuityQueue()',
        'function worldCallReservedForUserCancellation(namespace, captured)',
    );
    const exercise = async (blockedOn) => {
        let releasePrior;
        let releaseBarrier;
        let releaseNew;
        const prior = new Promise((resolve) => { releasePrior = resolve; });
        const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
        const state = {
            current: { chatId: 'chat-a', index: 4, epoch: 1, key: 'same-target' },
            oldModelCalls: 0,
            oldWrites: 0,
            newModelCalls: 0,
            terminalWrites: 0,
            statusWrites: 0,
        };
        const sandbox = {
            operationEpoch: 1,
            actorWorldManagementWrite: null,
            continuityPendingKeys: new Map(),
            continuityCompletedKeys: new Set(),
            continuityChain: blockedOn === 'prior' ? prior : Promise.resolve(),
            getContext: () => ({ chatId: 'chat-a' }),
            latestAiMessage: () => ({ index: 4 }),
            captureTarget: () => structuredClone(state.current),
            stage3AcceptedTargetKey: (target) => target.key,
            stage3AcceptedTarget: (target) => target,
            stage3AcceptedTargetsMatch: (left, right) => left?.key === right?.key,
            stage3AcceptedTargetIsStrictlyNewer: () => false,
            runContinuityTarget: async (target) => {
                if (target.epoch === 1) {
                    state.oldModelCalls += 1;
                    state.oldWrites += 1;
                    return { status: 'applied', readbackVerified: true };
                }
                state.newModelCalls += 1;
                return new Promise((resolve) => { releaseNew = resolve; });
            },
            recordStage3WorldFinalDiagnostic: async () => { state.terminalWrites += 1; },
            setContinuityStatus: () => { state.statusWrites += 1; },
            renderSovereigntyHealth: () => undefined,
            syncTaskCancelButtons: () => undefined,
            safeDiagnosticReason: (value) => String(value || ''),
            deepClone: (value) => structuredClone(value),
        };
        vm.runInNewContext(
            `${staleResultSource}\n${queueSource}\n${invalidateSource}\n`
            + 'this.enqueue = enqueueContinuity; this.invalidateWorld = invalidateContinuityQueue;',
            sandbox,
        );

        const oldTask = sandbox.enqueue(4, {
            force: true,
            expectedTarget: structuredClone(state.current),
            startBarrier: blockedOn === 'barrier' ? barrier : null,
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(state.oldModelCalls, 0);

        sandbox.operationEpoch = 2;
        state.current = { ...state.current, epoch: 2 };
        sandbox.invalidateWorld();
        const newTask = sandbox.enqueue(4, {
            force: true,
            manualRecovery: true,
            expectedTarget: structuredClone(state.current),
        });
        while (state.newModelCalls < 1) await new Promise((resolve) => setImmediate(resolve));
        const newOwner = sandbox.continuityPendingKeys.get('same-target');
        assert.ok(newOwner);

        if (blockedOn === 'prior') releasePrior();
        else releaseBarrier();
        const oldResult = await oldTask;
        assert.equal(oldResult.status, 'stale');
        assert.equal(oldResult.reason, 'world_task_owner_changed');
        assert.equal(oldResult.validationCode, 'world.stale.owner_changed');
        assert.equal(oldResult.module, 'world');
        assert.equal(oldResult.zeroWrite, true);
        assert.equal(oldResult.worldModelCalls, 0);
        assert.equal(state.oldModelCalls, 0, `${blockedOn}: detached owner must not call the model`);
        assert.equal(state.oldWrites, 0, `${blockedOn}: detached owner must not write world state`);
        assert.equal(state.terminalWrites, 0, `${blockedOn}: detached owner must not write diagnostics`);
        assert.equal(state.statusWrites, 0, `${blockedOn}: detached owner must not update UI`);
        assert.equal(sandbox.continuityPendingKeys.get('same-target'), newOwner);

        releaseNew({ status: 'applied', readbackVerified: true });
        assert.equal((await newTask).status, 'applied');
    };

    await exercise('prior');
    await exercise('barrier');
});

test('a P3 owner lost during terminal diagnostic await cannot touch completed cache or UI', async () => {
    const staleResultSource = sourceSection(
        'function stage3StaleValidationCode(reason)',
        'function stage3AcceptedTargetIsStrictlyNewer(currentValue, priorValue)',
    );
    const queueSource = sourceSection(
        'async function stage3AwaitAcceptedFinalP4Barrier(startBarrier)',
        'function stage3AttemptProjection(ledger, target)',
    );
    const invalidateSource = sourceSection(
        'function invalidateContinuityQueue()',
        'function worldCallReservedForUserCancellation(namespace, captured)',
    );
    const exercise = async ({ mode, transition }) => {
        let releaseDiagnostic;
        let signalDiagnostic;
        let releaseNew;
        const diagnosticEntered = new Promise((resolve) => { signalDiagnostic = resolve; });
        const diagnosticWait = new Promise((resolve) => { releaseDiagnostic = resolve; });
        const state = {
            chatId: 'chat-a',
            current: { chatId: 'chat-a', index: 4, epoch: 1, key: 'same-target' },
            diagnosticCalls: 0,
            statusWrites: 0,
            renders: 0,
            newModelCalls: 0,
        };
        const sandbox = {
            operationEpoch: 1,
            actorWorldManagementWrite: null,
            continuityPendingKeys: new Map(),
            continuityCompletedKeys: new Set(),
            continuityChain: Promise.resolve(),
            getContext: () => ({ chatId: state.chatId }),
            latestAiMessage: () => ({ index: 4 }),
            captureTarget: () => structuredClone(state.current),
            stage3AcceptedTargetKey: (target) => target.key,
            stage3AcceptedTarget: (target) => target,
            stage3AcceptedTargetsMatch: (left, right) => left?.key === right?.key,
            stage3AcceptedTargetIsStrictlyNewer: () => false,
            runContinuityTarget: async (target) => {
                if (target.epoch === 1) {
                    if (mode === 'catch') throw new Error('controlled world failure');
                    return { status: 'applied', readbackVerified: true };
                }
                state.newModelCalls += 1;
                return new Promise((resolve) => { releaseNew = resolve; });
            },
            recordStage3WorldFinalDiagnostic: async (target) => {
                state.diagnosticCalls += 1;
                if (target.epoch === 1) {
                    signalDiagnostic();
                    await diagnosticWait;
                }
            },
            setContinuityStatus: () => { state.statusWrites += 1; },
            renderSovereigntyHealth: () => { state.renders += 1; },
            syncTaskCancelButtons: () => undefined,
            safeDiagnosticReason: (value) => String(value || ''),
            deepClone: (value) => structuredClone(value),
        };
        vm.runInNewContext(
            `${staleResultSource}\n${queueSource}\n${invalidateSource}\n`
            + 'this.enqueue = enqueueContinuity; this.invalidateWorld = invalidateContinuityQueue;',
            sandbox,
        );

        const oldTask = sandbox.enqueue(4, {
            force: true, expectedTarget: structuredClone(state.current),
        });
        await diagnosticEntered;

        sandbox.operationEpoch = 2;
        sandbox.invalidateWorld();
        let newTask = null;
        let newOwner = null;
        if (transition === 'replace') {
            state.current = { ...state.current, epoch: 2 };
            newTask = sandbox.enqueue(4, {
                force: true, manualRecovery: true,
                expectedTarget: structuredClone(state.current),
            });
            while (state.newModelCalls < 1) await new Promise((resolve) => setImmediate(resolve));
            newOwner = sandbox.continuityPendingKeys.get('same-target');
            assert.ok(newOwner);
        } else {
            state.chatId = 'chat-b';
        }

        releaseDiagnostic();
        await oldTask;
        assert.equal(sandbox.continuityCompletedKeys.has('same-target'), false);
        assert.equal(state.statusWrites, 0);
        assert.equal(state.renders, 0);
        if (transition === 'replace') {
            assert.equal(sandbox.continuityPendingKeys.get('same-target'), newOwner);
            releaseNew({ status: 'applied', readbackVerified: true });
            await newTask;
        }
    };

    await exercise({ mode: 'normal', transition: 'replace' });
    await exercise({ mode: 'normal', transition: 'chat' });
    await exercise({ mode: 'catch', transition: 'replace' });
});

test('every post-model P3 failure carries measured world timings', () => {
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(run, /const finishWorldResult = \(result = \{\}\) =>/u);
    assert.match(
        run,
        /error\?\.code === 'WORLD_TARGET_STALE'[\s\S]*?return finishWorldResult\(\{ status: 'stale'/u,
        'a stale result after transport must retain measured model time',
    );
    for (const reason of [
        'world_actor_proposals_incomplete',
        'world_actor_proposal_invalid',
        'world_candidate_readback_mismatch',
    ]) {
        assert.match(
            run,
            new RegExp(`finishWorldResult\\(\\{[^}]*reason: ['\"]${reason}`, 'u'),
            `${reason} must retain model/parse/persistence timings`,
        );
    }
    assert.match(
        run,
        /stage3PersistPreparedActorAttemptsOnFreshLedger[\s\S]*?return finishWorldResult\(\{[\s\S]*?reason: rebased\.reason/u,
        'fresh-ledger adjudication/Phase1 failures must retain measured timings',
    );
});

test('Advance outlives the old hard timeout but remains immediately cancellable', async () => {
    let resolved = false;
    const generateLong = loadWorldGenerator(async (_messages, options) => {
        assert.equal(options.noTimeout, true);
        assert.equal(options.failover, true);
        await new Promise((resolve) => setTimeout(resolve, 45));
        resolved = true;
        return validWorldOutput();
    });
    const startedAt = Date.now();
    const output = await generateLong([], {
        captured,
        settings: { ...generatorSettings, sovereigntyHardTimeoutMs: 30 },
        isCurrent: () => true,
    });
    assert.equal(resolved, true);
    assert.ok(Date.now() - startedAt >= 30, 'the former hard timeout must not win the race');
    assert.equal(typeof output, 'string');

    const controller = new AbortController();
    let calls = 0;
    const generateCancelled = loadWorldGenerator((_messages, options) => {
        calls += 1;
        assert.equal(options.noTimeout, true);
        return new Promise((_resolve, reject) => {
            const cancel = () => reject(Object.assign(new Error('cancelled by user'), {
                name: 'AbortError',
            }));
            options.signal.addEventListener('abort', cancel, { once: true });
            if (options.signal.aborted) cancel();
        });
    });
    const pending = generateCancelled([], {
        captured,
        settings: { ...generatorSettings, sovereigntyHardTimeoutMs: 30 },
        signal: controller.signal,
        isCurrent: () => true,
    });
    controller.abort('cancelled by user');
    await assert.rejects(pending, /cancelled by user/u);
    assert.equal(calls, 1);
});

test('production callModel honors noTimeout while its existing controller still cancels', async () => {
    const long = loadProductionCallModel(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return 'resolved after configured timeout';
    });
    const startedAt = Date.now();
    assert.equal(await long.callModel([{ role: 'user', content: 'synthetic' }], {
        task: 'synthetic world lifecycle', channel: 'fast', noTimeout: true,
        failover: false, maxFailovers: 0,
    }), 'resolved after configured timeout');
    assert.ok(Date.now() - startedAt >= 10);
    assert.equal(long.activeModelControllers.size, 0);

    const cancelled = loadProductionCallModel((_messages, { signal }) => (
        new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {
                name: 'AbortError',
            })), { once: true });
        })
    ));
    const pending = cancelled.callModel([{ role: 'user', content: 'synthetic' }], {
        task: 'synthetic world cancellation', channel: 'fast', noTimeout: true,
        failover: false, maxFailovers: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cancelled.activeModelControllers.size, 1);
    for (const controller of cancelled.activeModelControllers) controller.abort('user_cancelled');
    await assert.rejects(pending, (error) => (
        error?.name === 'AbortError' && error?.failureKind === 'cancelled'
    ));
    assert.equal(cancelled.activeModelControllers.size, 0);
});

test('production P3 router hands one empty fast slot to one distinct healthy slot', async () => {
    const attempts = [];
    const router = loadProductionCallModel(async (messages, { profile }) => {
        attempts.push({ profile: profile.model, input: structuredClone(messages) });
        return profile.model.endsWith('-0') ? '' : validWorldOutput(4);
    }, { routeCount: 2 });
    const input = [{ role: 'user', content: 'same accepted-world input' }];
    const output = await router.callModel(input, {
        task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
        runUntilCancelled: true, instructionModule: 'world',
        failover: true, maxFailovers: 1, transportFailoverOnly: true,
    });
    assert.equal(parseContinuityOutput(output).raw.turn, 4);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0].input, attempts[1].input, 'handoff keeps the exact input');
    assert.notEqual(attempts[0].profile, attempts[1].profile, 'only distinct configured slots qualify');
    assert.deepEqual(router.health.map(({ slotIndex, ok, failureKind }) => ({
        slotIndex, ok, failureKind,
    })), [
        { slotIndex: 0, ok: false, failureKind: 'empty' },
        { slotIndex: 1, ok: true, failureKind: '' },
    ]);
    const transports = router.diagnostics.filter((entry) => entry.phase === 'transport');
    assert.deepEqual(transports.map((entry) => ({
        slot: entry.routeSlotIndex,
        attempt: entry.attempt,
        failover: entry.failover,
        inputChars: entry.inputChars,
    })), [
        { slot: 0, attempt: 1, failover: false, inputChars: input[0].content.length },
        { slot: 1, attempt: 2, failover: true, inputChars: input[0].content.length },
    ]);
    assert.equal(new Set(router.schedulerKeys).size, 2, 'route queues stay isolated by slot/model key');
});

test('P3 transport handoff is bounded, distinct, and never applies to semantic or foreground failures', async () => {
    const predicateSource = sourceSection(
        'function modelTransportFailureCanFailover(failureKind) {',
        'function safeRouteDiagnostic({',
    );
    const predicateSandbox = {};
    vm.runInNewContext(`${predicateSource}\nthis.allowed = modelTransportFailureCanFailover;`, predicateSandbox);
    for (const kind of ['empty', 'transport-error', 'rate-limit']) {
        assert.equal(predicateSandbox.allowed(kind), true, kind);
    }
    for (const kind of [
        'validation-error', 'cancelled', 'foreground_preempted', 'http', 'unknown', '',
    ]) assert.equal(predicateSandbox.allowed(kind), false, kind);

    for (const failure of [
        Object.assign(new Error('validation'), { failureKind: 'validation-error' }),
        Object.assign(new Error('auth'), { status: 401 }),
        Object.assign(new Error('unknown'), { failureKind: 'unknown' }),
    ]) {
        let calls = 0;
        const router = loadProductionCallModel(async () => { calls += 1; throw failure; }, {
            routeCount: 2,
        });
        await assert.rejects(router.callModel([{ role: 'user', content: 'input' }], {
            task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
            failover: true, maxFailovers: 1, transportFailoverOnly: true,
        }));
        assert.equal(calls, 1);
    }

    let rateLimitCalls = 0;
    const rateLimited = loadProductionCallModel(async () => {
        rateLimitCalls += 1;
        if (rateLimitCalls === 1) {
            throw Object.assign(new Error('rate limited'), {
                status: 429,
                failureKind: 'http',
            });
        }
        return validWorldOutput(6);
    }, { routeCount: 2 });
    const rateLimitOutput = await rateLimited.callModel([
        { role: 'user', content: 'same rate-limited input' },
    ], {
        task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
        failover: true, maxFailovers: 1, transportFailoverOnly: true,
    });
    assert.equal(parseContinuityOutput(rateLimitOutput).raw.turn, 6);
    assert.equal(rateLimitCalls, 2, '429 overrides a generic http failureKind and hands off once');

    let emptyCalls = 0;
    const exhausted = loadProductionCallModel(async () => { emptyCalls += 1; return ''; }, {
        routeCount: 3,
    });
    await assert.rejects(exhausted.callModel([{ role: 'user', content: 'input' }], {
        task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
        failover: true, maxFailovers: 1, transportFailoverOnly: true,
    }), (error) => error?.failureKind === 'empty');
    assert.equal(emptyCalls, 2, 'one handoff is the hard bound even when a third slot exists');

    let duplicateCalls = 0;
    const duplicate = loadProductionCallModel(async () => { duplicateCalls += 1; return ''; }, {
        routeCount: 2, duplicateRouteKeys: true,
    });
    await assert.rejects(duplicate.callModel([{ role: 'user', content: 'input' }], {
        task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
        failover: true, maxFailovers: 1, transportFailoverOnly: true,
    }));
    assert.equal(duplicateCalls, 1, 'a duplicate physical route is not a backup');

    let foregroundCalls = 0;
    const foreground = loadProductionCallModel(async () => {
        foregroundCalls += 1;
        throw Object.assign(new Error('foreground_preempted'), {
            failureKind: 'foreground_preempted',
        });
    }, {
        routeCount: 2,
    });
    await assert.rejects(foreground.callModel([{ role: 'user', content: 'input' }], {
        task: 'synthetic P3 Advance', channel: 'fast', noTimeout: true,
        runUntilCancelled: true, instructionModule: 'world',
        failover: true, maxFailovers: 1, transportFailoverOnly: true,
    }), (error) => error?.failureKind === 'foreground_preempted');
    assert.equal(foregroundCalls, 1);
});

test('production callModel reports scheduler wait separately from transport model time', () => {
    const model = sourceSection(
        'async function callModel(messages, options = {})',
        'async function probeModelChannelConnections',
    );
    assert.match(
        model,
        /const queuedAt = Date\.now\(\)[\s\S]*?const callStartedAt = Date\.now\(\)[\s\S]*?options\.timingSink\?\.\(\{[\s\S]*?queueWaitMs:[\s\S]*?callStartedAt - queuedAt[\s\S]*?modelMs:[\s\S]*?Date\.now\(\) - callStartedAt/u,
    );
    assert.doesNotMatch(
        sourceSection(
            'async function generateWorldContinuitySingleBatch(messages, {',
            'async function persistActorRegistryForTurn(captured, {',
        ),
        /startedAt = Date\.now\(\)[\s\S]*?modelMs/u,
    );
});

test('explicit user cancellation clears only an exact owned empty reservation', async () => {
    const exact = loadCancelledWorldReservationHarness();
    assert.equal(exact.matches(exact.state.namespace, exact.target), true);
    assert.equal(await exact.clear(exact.target), true);
    assert.equal(exact.state.writes, 1);
    assert.equal(exact.state.namespace.continuityCheckpoint, null);

    let advanceCalls = 0;
    const recall = loadStage3LocalRecallPacket();
    const advance = loadWorldGenerator(async (_messages, options) => {
        advanceCalls += 1;
        assert.equal(options.noTimeout, true);
        return validWorldOutput();
    });
    assert.ok(recall({ actorLedger: { actors: [] }, base: { threads: [] }, worldLaneSchedule: { candidates: [] } }));
    await advance([], { captured: exact.target, settings: generatorSettings, isCurrent: () => true });
    assert.equal(advanceCalls, 1);

    const drift = loadCancelledWorldReservationHarness();
    drift.state.currentTarget.generationId = 'generation-drift';
    assert.equal(await drift.clear(drift.target), false);
    assert.equal(drift.state.writes, 0);
    assert.equal(drift.state.namespace.continuityCheckpoint.stage3Phase, 'world_call_reserved');

    const prepared = loadCancelledWorldReservationHarness({ checkpointPhase: 'world_candidate_prepared' });
    assert.equal(await prepared.clear(prepared.target), false);
    assert.equal(prepared.state.writes, 0);
    assert.equal(prepared.state.namespace.continuityCheckpoint.stage3Phase, 'world_candidate_prepared');

    const withAttempt = loadCancelledWorldReservationHarness();
    withAttempt.state.namespace.actorLedger.actionAttempts.push({
        id: 'ATT-1', target: structuredClone(withAttempt.actionTarget),
    });
    assert.equal(await withAttempt.clear(withAttempt.target), false);
    assert.equal(withAttempt.state.writes, 0);

    const cancelSource = sourceSection('function cancelCurrentOperations() {', 'function promptSnapshotText(');
    assert.match(cancelSource, /mvuadWorldReservationTarget/u);
    assert.match(cancelSource, /invalidateOperations\(/u);
    assert.match(cancelSource, /clearUserCancelledWorldCallReservation/u);
    assert.ok(
        cancelSource.indexOf('invalidateOperations(')
            < cancelSource.indexOf('clearUserCancelledWorldCallReservation('),
        'the controller is aborted and the epoch invalidated before the exact reserved cleanup runs',
    );
});

test('explicit manual recovery CAS-retires only a self-consistent empty prior reservation', async () => {
    const exact = loadPriorReservedManualHarness();
    assert.equal(exact.matches(exact.state.namespace, exact.current), true);
    assert.equal(await exact.retire(exact.current), true);
    assert.equal(exact.state.writes, 1);
    assert.equal(exact.state.namespace.continuityCheckpoint, null);

    const reject = async (mutate, label) => {
        const fixture = loadPriorReservedManualHarness();
        mutate(fixture);
        assert.equal(fixture.matches(fixture.state.namespace, fixture.current), false, label);
        assert.equal(await fixture.retire(fixture.current), false, label);
        assert.equal(fixture.state.writes, 0, label);
        assert.equal(
            fixture.state.namespace.continuityCheckpoint.stage3Phase,
            'world_call_reserved',
            label,
        );
    };
    await reject((fixture) => {
        fixture.state.currentTarget = structuredClone(fixture.prior);
        fixture.current = fixture.state.currentTarget;
    }, 'same target transport reservation is never replayed');
    await reject((fixture) => {
        fixture.state.namespace.continuityCheckpoint.preparedWorld = { digest: 'prepared' };
    }, 'prepared material is never cleared');
    await reject((fixture) => {
        fixture.state.namespace.actorLedger.actionAttempts.push({
            id: 'ATT-OLD',
            target: fixture.actionTargetOf(fixture.prior),
        });
    }, 'any prior ATT blocks retirement');
    await reject((fixture) => {
        fixture.state.namespace.actorLedger.actionReceipts.push({
            receiptId: 'RECEIPT-OLD',
            target: fixture.actionTargetOf(fixture.prior),
        });
    }, 'any prior settlement receipt blocks retirement');
    await reject((fixture) => {
        fixture.state.namespace.continuity.nextTurnInjection = {
            producerTarget: structuredClone(fixture.prior),
        };
    }, 'a prior packet blocks retirement');
    await reject((fixture) => {
        fixture.state.namespace.continuity.nextTurnInjection = {
            settlementProof: { producerTarget: structuredClone(fixture.prior) },
        };
    }, 'a prior settlement blocks retirement');
    await reject((fixture) => {
        fixture.state.namespace.continuity.lastSource = structuredClone(fixture.prior);
        fixture.state.namespace.continuityCheckpoint.state.lastSource = structuredClone(fixture.prior);
    }, 'lastSource authority for the prior target blocks retirement');
    await reject((fixture) => {
        fixture.state.namespace.continuity.turn = 1;
    }, 'checkpoint state must match current continuity without injection');
    for (const [field, value] of [
        ['scopeDigest', 'scope-drift'],
        ['generationSerial', 0],
        ['index', 0],
        ['generationId', exact.prior.generationId],
        ['messageId', exact.prior.messageId],
    ]) {
        await reject((fixture) => {
            fixture.state.currentTarget[field] = value;
            fixture.current = fixture.state.currentTarget;
        }, `current ${field} drift fails closed`);
    }
});

test('production writer lifecycle accepts post-apply null only while all reservation side evidence stays exact', async () => {
    const success = loadProductionPriorReservedRetirementHarness();
    assert.equal(
        await success.retire(structuredClone(success.currentTarget)),
        true,
        success.failureCode(),
    );
    assert.equal(success.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint, null);
    assert.equal(success.persisted().continuityCheckpoint, null);
    assert.equal(success.writer.metrics.hostSaveCalls, 1);
    assert.equal(success.writer.metrics.readbackAttempts, 1);
    assert.equal(success.writer.metrics.rolledBackWrites, 0);

    const reject = async (mutate, label) => {
        const fixture = loadProductionPriorReservedRetirementHarness(mutate);
        const originalCheckpoint = structuredClone(
            fixture.fixture.state.namespace.continuityCheckpoint,
        );
        assert.equal(
            await fixture.retire(structuredClone(fixture.currentTarget)),
            false,
            label,
        );
        assert.deepEqual(
            fixture.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
            originalCheckpoint,
            `${label}: the applied candidate must roll back`,
        );
        assert.equal(fixture.writer.metrics.hostSaveCalls, 1, label);
        assert.equal(fixture.writer.metrics.readbackAttempts, 0, label);
        assert.equal(fixture.writer.metrics.rolledBackWrites, 1, label);
    };
    await reject(({ context, fixture }) => {
        context.chatMetadata.mvu_auto_doctor.actorLedger.actionAttempts.push({
            id: 'ATT-RACE',
            target: fixture.actionTargetOf(fixture.prior),
        });
    }, 'post-apply ATT race');
    await reject(({ context, fixture }) => {
        context.chatMetadata.mvu_auto_doctor.continuity.nextTurnInjection = {
            producerTarget: structuredClone(fixture.prior),
        };
    }, 'post-apply packet race');
    await reject(({ context, fixture }) => {
        context.chatMetadata.mvu_auto_doctor.continuityCheckpoint = {
            stage3Phase: 'world_candidate_prepared',
            target: fixture.actionTargetOf(fixture.prior),
            stage3ProducerTarget: structuredClone(fixture.prior),
            preparedWorld: { digest: 'prepared-race' },
        };
    }, 'post-apply other checkpoint race');
    await reject(({ currentTarget }) => {
        currentTarget.generationId = 'generation-drift';
    }, 'post-apply current target drift');
});

test('manual retirement fresh-reads then runs exactly one local Recall and one Advance', async () => {
    const fixture = loadPriorReservedManualHarness();
    const current = fixture.current;
    const ledger = { actors: [], actionAttempts: [] };
    const preparedCheckpoint = { stage3Phase: 'world_candidate_prepared' };
    const chat = Array.from({ length: current.index + 1 }, () => ({ mes: '' }));
    chat[current.index] = { mes: 'accepted narrative' };
    let retireCalls = 0;
    let recallCalls = 0;
    let advanceCalls = 0;
    let namespaceReads = 0;
    const namespace = fixture.state.namespace;
    const runner = loadStage3LegacyManualReconciliationRunner({
        captured: current,
        namespace,
        spies: {
            stage3AcceptedTarget: (value) => value?.generationId ? structuredClone(value) : null,
            stage3AcceptedTargetsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3AcceptedTargetKey: () => 'current-target',
            actorActionTargetOf: fixture.actionTargetOf,
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3PriorReservedCallCanRetire: (candidate) => (
                candidate?.continuityCheckpoint?.stage3Phase === 'world_call_reserved'
            ),
            retirePriorReservedWorldCallForManualRecovery: async () => {
                retireCalls += 1;
                namespace.continuityCheckpoint = null;
                return true;
            },
            readChatNamespace: () => {
                namespaceReads += 1;
                return namespace;
            },
            stage3LegacyTargetNeedsManualReconciliation: () => false,
            stage3CommittedCheckpointIsPriorTerminal: () => false,
            stage3PersistedPackageForTarget: () => null,
            getSettings: () => ({
                continuityMode: 'manual', continuityMaxThreads: 12,
                worldFactionSlots: 0, worldEnvironmentSlots: 0,
                actorLedgerMaxActorsPerTurn: 0, actorLedgerExplorationSlots: 0,
            }),
            getContext: () => ({ chatId: current.chatId, chat }),
            stage3LedgerReadbackGate: () => ({ ok: true, actorLedger: ledger, noActorPermit: true }),
            deepClone: (value) => structuredClone(value),
            continuityBase: () => ({ turn: 1, threads: [], world: {} }),
            collectContinuityWorldContext: async () => ({ hasSetting: true, entries: [] }),
            currentCharacter: () => ({}),
            continuityFeatureActive: () => true,
            advanceContinuityClocks: (value) => ({ state: structuredClone(value) }),
            scheduleWorldLanes: () => ({ candidates: [], selected: [] }),
            pendingActorActionAttempts: () => ({ attempts: [], candidates: [] }),
            scheduleActorTurns: () => ({ selected: [] }),
            stage3LocalRecallPacket: () => {
                recallCalls += 1;
                return { digest: 'recall', actorIds: [], threadIds: [], laneIds: [] };
            },
            writeChatNamespace: async () => true,
            stage3FieldState: () => ({ revision: 1, digest: 'same' }),
            normalizeActorLedger: () => ledger,
            actorLedgerDigest: () => 'ledger',
            setContinuityStatus: () => {},
            buildContinuityMessages: () => [],
            generateWorldContinuitySingleBatch: async () => {
                advanceCalls += 1;
                return '{}';
            },
            parseContinuityOutput: () => ({
                state: { turn: 2, threads: [], world: {} },
                raw: { world: {}, actionAdjudications: [] },
            }),
            stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
            stage3ValidateWorldDraftInMemory: () => ({ ok: true }),
            currentPlayerActorNames: () => [],
            stage3PreparedWorldCheckpoint: () => preparedCheckpoint,
            persistActorActionAttemptsForTurn: async () => ({
                ok: true, checkpoint: preparedCheckpoint, ledger,
            }),
            stage3PreparedWorldCheckpointMatches: () => true,
            stage3PreparedPhase1StatesMatch: () => true,
            commitPreparedWorldCandidate: async () => ({ status: 'applied', worldModelCalls: 1 }),
            latestWorldLaneDiagnostics: null,
            latestActorShardDiagnostics: null,
        },
    });
    const result = await runner(current, { force: true, manualRecovery: true });
    assert.equal(result.status, 'applied');
    assert.equal(retireCalls, 1);
    assert.equal(recallCalls, 1);
    assert.equal(advanceCalls, 1);
    assert.ok(namespaceReads >= 2, 'retirement re-enters through a fresh namespace read');

    const sameTarget = loadPriorReservedManualHarness();
    sameTarget.state.currentTarget = structuredClone(sameTarget.prior);
    let sameTargetModels = 0;
    const sameRunner = loadStage3LegacyManualReconciliationRunner({
        captured: sameTarget.prior,
        namespace: sameTarget.state.namespace,
        spies: {
            stage3AcceptedTarget: (value) => value?.generationId ? structuredClone(value) : null,
            stage3AcceptedTargetsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            actorActionTargetOf: sameTarget.actionTargetOf,
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3PriorReservedCallCanRetire: () => false,
            retirePriorReservedWorldCallForManualRecovery: async () => false,
            stage3LegacyTargetNeedsManualReconciliation: () => false,
            stage3CommittedCheckpointIsPriorTerminal: () => false,
            stage3PersistedPackageForTarget: () => null,
            generateWorldContinuitySingleBatch: () => { sameTargetModels += 1; },
        },
    });
    const sameResult = await sameRunner(sameTarget.prior, { force: true, manualRecovery: true });
    assert.equal(sameResult.reason, 'world_call_reserved_manual_reconciliation');
    assert.equal(sameTargetModels, 0);

    const automatic = loadPriorReservedManualHarness();
    let automaticRetires = 0;
    let automaticModels = 0;
    const automaticRunner = loadStage3LegacyManualReconciliationRunner({
        captured: automatic.current,
        namespace: automatic.state.namespace,
        spies: {
            stage3AcceptedTarget: (value) => value?.generationId ? structuredClone(value) : null,
            stage3AcceptedTargetsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            actorActionTargetOf: automatic.actionTargetOf,
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3PriorReservedCallCanRetire: () => true,
            retirePriorReservedWorldCallForManualRecovery: async () => {
                automaticRetires += 1;
                return true;
            },
            stage3LegacyTargetNeedsManualReconciliation: () => false,
            stage3CommittedCheckpointIsPriorTerminal: () => false,
            stage3PersistedPackageForTarget: () => null,
            generateWorldContinuitySingleBatch: () => { automaticModels += 1; },
        },
    });
    const automaticResult = await automaticRunner(automatic.current, { force: true });
    assert.equal(automaticResult.reason, 'world_call_reserved_manual_reconciliation');
    assert.equal(automaticRetires, 0, 'automatic P1/P3 wakeup cannot retire old authority');
    assert.equal(automaticModels, 0);
});

test('transport failure preserves reserved recovery authority for manual reconciliation', async () => {
    const reserved = loadCancelledWorldReservationHarness();
    const advance = loadWorldGenerator(async () => {
        throw new Error('transport down');
    });
    await assert.rejects(
        advance([], { captured: reserved.target, settings: generatorSettings, isCurrent: () => true }),
        /transport down/u,
    );
    assert.equal(reserved.state.namespace.continuityCheckpoint.stage3Phase, 'world_call_reserved');
    assert.equal(reserved.state.writes, 0);
});

test('transport failover is delegated only to the bounded router while validation and stale stop locally', async () => {
    let calls = 0;
    const transportFailure = loadWorldGenerator(async (_messages, options) => {
        calls += 1;
        assert.equal(options.failover, true);
        assert.equal(options.maxFailovers, 1);
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
        assert.equal(options.validateOutput, undefined);
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

    const singletonArray = parseContinuityOutput(`[${validWorldOutput(3)}]`);
    assert.ok(singletonArray.state);
    assert.equal(singletonArray.raw.turn, 3);
    assert.equal(singletonArray.repairedLocally, true);

    const ambiguousArray = parseContinuityOutput(`[${validWorldOutput(3)},${validWorldOutput(4)}]`);
    assert.equal(ambiguousArray.state, undefined);
    assert.match(ambiguousArray.error, /根节点不能是多项数组/u);

    const namedWrapper = parseContinuityOutput(JSON.stringify({
        ContinuityState: JSON.parse(validWorldOutput(5)),
    }));
    assert.ok(namedWrapper.state);
    assert.equal(namedWrapper.raw.turn, 5);
    assert.equal(namedWrapper.repairedLocally, true);

    const wrapperWithSibling = parseContinuityOutput(JSON.stringify({
        ContinuityState: JSON.parse(validWorldOutput(5)),
        commentary: 'not mechanically unambiguous',
    }));
    assert.equal(wrapperWithSibling.state, undefined);
    assert.match(wrapperWithSibling.error, /wrapper 结构非法/u);

    for (const invalidWrapper of [
        { ContinuityState: null },
        { ContinuityState: [] },
        { ContinuityState: 'not an object' },
    ]) {
        const parsed = parseContinuityOutput(JSON.stringify(invalidWrapper));
        assert.equal(parsed.state, undefined);
        assert.match(parsed.error, /wrapper 结构非法/u);
    }
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
        /if \(existingPacket\) \{[\s\S]*?await stage3ExistingCommittedPackageReadback\([\s\S]*?status: 'applied',[\s\S]*?recovered: true,[\s\S]*?readbackVerified: true,[\s\S]*?worldModelCalls: 0,[\s\S]*?worldWrites: 0,[\s\S]*?nextTurnInjection: deepClone\(durablePacket\)/u,
        'an exact persisted package recovers only after durable proof and without a second model call or write',
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
                stage3LocalRecallPacket: () => { recallCalls += 1; return { digest: 'local' }; },
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

test('same-target committed recovery tolerates profile-only ledger evolution but not ATT authority drift', () => {
    const persisted = loadStage3PersistedPackageValidator({ ledgerDigest: actorLedgerDigest });
    const current = {
        chatId: 'chat-profile-evolution', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 2, generationId: 'generation-2', generationType: 'normal',
        scopeDigest: 'scope-profile-evolution', contentFingerprint: 'content-2',
    };
    const committedLedger = emptyActorLedger(current.chatId);
    committedLedger.actors.push({
        id: 'NPC-PROFILE', name: 'NPC-PROFILE', status: 'active',
        profileStatus: 'ready', profileVersion: 1,
    });
    const proof = persisted.stage3CanonicalSettlementProof(committedLedger, [], current);
    const continuity = {
        chatId: current.chatId,
        turn: 2,
        lastSource: structuredClone(current),
        nextTurnInjection: {
            status: 'pending',
            producerTarget: structuredClone(current),
            sourceContinuityDigest: '',
            settlementProof: proof,
        },
    };
    continuity.nextTurnInjection.sourceContinuityDigest =
        persisted.stage3ContinuityDigestWithoutInjection(continuity);
    const profileEvolved = structuredClone(committedLedger);
    profileEvolved.actors[0].evidence = ['new durable profile evidence'];
    assert.notEqual(actorLedgerDigest(profileEvolved), actorLedgerDigest(committedLedger));
    assert.equal(
        persisted.stage3PersistedPackageForTarget(continuity, profileEvolved, current),
        null,
    );
    assert.ok(persisted.stage3PersistedPackageForTarget(
        continuity,
        profileEvolved,
        current,
        { allowUnrelatedLedgerEvolution: true },
    ));

    const authorityDrift = structuredClone(profileEvolved);
    authorityDrift.actionAttempts.push({
        id: 'unexpected-attempt',
        target: structuredClone(current),
        worldAdjudicationResult: null,
    });
    assert.equal(
        persisted.stage3PersistedPackageForTarget(
            continuity,
            authorityDrift,
            current,
            { allowUnrelatedLedgerEvolution: true },
        ),
        null,
        'same-target ATT drift remains fail-closed',
    );
});

test('a fully committed prior generation becomes history only for a strictly newer accepted turn', async () => {
    const persisted = loadStage3PersistedPackageValidator({ ledgerDigest: actorLedgerDigest });
    const previous = {
        chatId: 'chat-history', index: 1, messageId: 'message-1', swipeId: 0,
        generationSerial: 1, generationId: 'generation-1', generationType: 'normal',
        scopeDigest: 'scope-history', contentFingerprint: 'content-1',
    };
    const current = {
        ...previous,
        index: 2,
        messageId: 'message-2',
        generationSerial: 2,
        generationId: 'generation-2',
        contentFingerprint: 'content-2',
    };
    const committedLedger = emptyActorLedger(previous.chatId);
    const ledger = structuredClone(committedLedger);
    ledger.actors.push({
        id: 'NPC-NEW-TURN',
        name: '新回合人物',
        status: 'active',
        profileStatus: 'ready',
        profileVersion: 1,
    });
    assert.notEqual(
        actorLedgerDigest(ledger),
        actorLedgerDigest(committedLedger),
        'the fixture must prove that a legitimate new-turn P1 ledger change occurred',
    );
    const proof = persisted.stage3CanonicalSettlementProof(committedLedger, [], previous);
    const withoutPacket = {
        chatId: previous.chatId,
        turn: 1,
        lastSource: structuredClone(previous),
        nextTurnInjection: null,
    };
    const packet = {
        status: 'pending',
        producerTarget: structuredClone(previous),
        sourceContinuityDigest: persisted.stage3ContinuityDigestWithoutInjection(withoutPacket),
        settlementProof: proof,
    };
    const continuity = { ...withoutPacket, nextTurnInjection: packet };
    const checkpoint = {
        stage3Phase: 'world_committed',
        target: structuredClone(previous),
        stage3ProducerTarget: structuredClone(previous),
        state: { chatId: previous.chatId, turn: 0, threads: [], world: {} },
    };
    assert.equal(
        persisted.stage3PersistedPackageForTarget(continuity, ledger, previous),
        null,
        'same-target recovery keeps its strict whole-ledger digest contract',
    );
    assert.ok(
        persisted.stage3PersistedPackageForTarget(continuity, ledger, previous, {
            allowUnrelatedLedgerEvolution: true,
        }),
        'the cross-turn consumer keeps the old target proof while allowing unrelated P1 ledger evolution',
    );
    assert.equal(
        persisted.stage3CommittedCheckpointIsPriorTerminal(
            checkpoint, continuity, ledger, current,
        ),
        true,
    );
    const rerolled = {
        ...previous,
        swipeId: 1,
        generationSerial: 2,
        generationId: 'generation-swipe-2',
        generationType: 'swipe',
        contentFingerprint: 'content-swipe-2',
    };
    assert.equal(
        persisted.stage3CommittedCheckpointIsPriorTerminal(
            checkpoint, continuity, ledger, rerolled,
        ),
        false,
        'same-index reroll is not a later-floor historical terminal',
    );
    assert.equal(
        persisted.stage3CommittedCheckpointIsRerollBaseline(
            checkpoint, continuity, ledger, rerolled,
        ),
        true,
        'same-index newer swipe restores the existing pre-generation baseline',
    );
    const identicalRegenerate = {
        ...previous,
        generationSerial: 2,
        generationId: 'generation-regenerate-2',
        generationType: 'regenerate',
    };
    assert.equal(
        persisted.stage3CommittedCheckpointIsRerollBaseline(
            checkpoint, continuity, ledger, identicalRegenerate,
        ),
        true,
        'a new regenerate identity remains a reroll even when host message/swipe/content are identical',
    );
    for (const drift of [
        { ...rerolled, generationSerial: 1 },
        { ...rerolled, generationId: previous.generationId },
        { ...rerolled, generationType: 'normal' },
        { ...rerolled, scopeDigest: 'other-scope' },
    ]) {
        assert.equal(
            persisted.stage3CommittedCheckpointIsRerollBaseline(
                checkpoint, continuity, ledger, drift,
            ),
            false,
        );
    }
    const runSource = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(
        runSource,
        /rerollBaselineCheckpoint[\s\S]*?stage3CommittedCheckpointIsRerollBaseline[\s\S]*?const currentCheckpoint = priorCommittedTerminal \|\| rerollBaselineCheckpoint\s*\? null/u,
        'the accepted P3 run must consume the same-floor checkpoint as a baseline, not manual reconciliation',
    );

    for (const [label, candidateCheckpoint, candidateContinuity, candidateCurrent] of [
        ['same-generation content drift', checkpoint, continuity, {
            ...previous, contentFingerprint: 'same-generation-drift',
        }],
        ['checkpoint target drift', {
            ...checkpoint, target: { ...previous, contentFingerprint: 'target-drift' },
        }, continuity, current],
        ['producer drift', {
            ...checkpoint, stage3ProducerTarget: { ...previous, contentFingerprint: 'producer-drift' },
        }, continuity, current],
        ['missing packet', checkpoint, withoutPacket, current],
        ['continuity authority drift', checkpoint, {
            ...continuity, lastSource: { ...previous, contentFingerprint: 'last-source-drift' },
        }, current],
        ['older target', checkpoint, continuity, {
            ...current, index: 0, generationSerial: 0,
        }],
    ]) {
        assert.equal(
            persisted.stage3CommittedCheckpointIsPriorTerminal(
                candidateCheckpoint, candidateContinuity, ledger, candidateCurrent,
            ),
            false,
            label,
        );
    }

    let recallCalls = 0;
    let advanceCalls = 0;
    const namespace = {
        continuityCheckpoint: structuredClone(checkpoint),
        continuity: structuredClone(continuity),
        actorLedger: structuredClone(ledger),
    };
    const preparedCheckpoint = { stage3Phase: 'world_candidate_prepared' };
    const chat = Array.from({ length: current.index + 1 }, () => ({ mes: '' }));
    chat[current.index] = { mes: 'accepted narrative' };
    const runner = loadStage3LegacyManualReconciliationRunner({
        captured: current,
        namespace,
        spies: {
            stage3AcceptedTarget: persisted.stage3AcceptedTarget,
            stage3AcceptedTargetsMatch: persisted.stage3AcceptedTargetsMatch,
            stage3AcceptedTargetKey: () => 'current-target',
            actorActionTargetOf: (value) => ({ ...value }),
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3CommittedCheckpointIsPriorTerminal:
                persisted.stage3CommittedCheckpointIsPriorTerminal,
            stage3PersistedPackageForTarget: persisted.stage3PersistedPackageForTarget,
            getSettings: () => ({
                continuityMode: 'manual', continuityMaxThreads: 12,
                worldFactionSlots: 0, worldEnvironmentSlots: 0,
                actorLedgerMaxActorsPerTurn: 0, actorLedgerExplorationSlots: 0,
            }),
            getContext: () => ({ chatId: current.chatId, chat }),
            stage3LedgerReadbackGate: () => ({
                ok: true, actorLedger: ledger, noActorPermit: true,
            }),
            deepClone: (value) => structuredClone(value),
            continuityBase: () => ({ turn: 1, threads: [], world: {} }),
            collectContinuityWorldContext: async () => ({ hasSetting: true }),
            currentCharacter: () => ({}),
            continuityFeatureActive: () => true,
            advanceContinuityClocks: (value) => ({ state: structuredClone(value) }),
            scheduleWorldLanes: () => ({ candidates: [], selected: [] }),
            pendingActorActionAttempts: () => ({ attempts: [], candidates: [] }),
            scheduleActorTurns: () => ({ selected: [] }),
            stage3LocalRecallPacket: () => {
                recallCalls += 1;
                return { digest: 'recall', actorIds: [], threadIds: [], laneIds: [] };
            },
            writeChatNamespace: async () => true,
            stage3FieldState: () => ({ revision: 1, digest: 'same' }),
            normalizeActorLedger: () => ledger,
            actorLedgerDigest: () => 'ledger',
            setContinuityStatus: () => {},
            buildContinuityMessages: () => [],
            generateWorldContinuitySingleBatch: async () => {
                advanceCalls += 1;
                return '{}';
            },
            parseContinuityOutput: () => ({
                state: { turn: 2, threads: [], world: {} },
                raw: { world: {}, actionAdjudications: [] },
            }),
            stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
            stage3ValidateWorldDraftInMemory: () => ({ ok: true }),
            currentPlayerActorNames: () => [],
            stage3PreparedWorldCheckpoint: () => preparedCheckpoint,
            persistActorActionAttemptsForTurn: async () => {
                namespace.continuityCheckpoint = preparedCheckpoint;
                return { ok: true, checkpoint: preparedCheckpoint, ledger };
            },
            stage3PreparedWorldCheckpointMatches: () => true,
            stage3PreparedPhase1StatesMatch: () => true,
            commitPreparedWorldCandidate: async () => ({
                status: 'applied', worldModelCalls: 1,
            }),
            latestWorldLaneDiagnostics: null,
            latestActorShardDiagnostics: null,
        },
    });
    const result = await runner(current);
    assert.equal(result.status, 'applied');
    assert.equal(recallCalls, 1);
    assert.equal(advanceCalls, 1);

    let rerollRecallCalls = 0;
    let rerollAdvanceCalls = 0;
    const rerollNamespace = {
        continuityCheckpoint: structuredClone(checkpoint),
        continuity: structuredClone(continuity),
        actorLedger: structuredClone(ledger),
    };
    const rerollChat = Array.from({ length: rerolled.index + 1 }, () => ({ mes: '' }));
    rerollChat[rerolled.index] = { mes: 'accepted replacement narrative' };
    const rerollRunner = loadStage3LegacyManualReconciliationRunner({
        captured: rerolled,
        namespace: rerollNamespace,
        spies: {
            stage3AcceptedTarget: persisted.stage3AcceptedTarget,
            stage3AcceptedTargetsMatch: persisted.stage3AcceptedTargetsMatch,
            stage3AcceptedTargetKey: () => 'reroll-target',
            actorActionTargetOf: (value) => ({ ...value }),
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3CommittedCheckpointIsPriorTerminal:
                persisted.stage3CommittedCheckpointIsPriorTerminal,
            stage3CommittedCheckpointIsRerollBaseline:
                persisted.stage3CommittedCheckpointIsRerollBaseline,
            stage3PersistedPackageForTarget: persisted.stage3PersistedPackageForTarget,
            getSettings: () => ({
                continuityMode: 'manual', continuityMaxThreads: 12,
                worldFactionSlots: 0, worldEnvironmentSlots: 0,
                actorLedgerMaxActorsPerTurn: 0, actorLedgerExplorationSlots: 0,
            }),
            getContext: () => ({ chatId: rerolled.chatId, chat: rerollChat }),
            stage3LedgerReadbackGate: () => ({ ok: true, actorLedger: ledger }),
            deepClone: (value) => structuredClone(value),
            continuityBase: () => structuredClone(checkpoint.state),
            collectContinuityWorldContext: async () => ({ hasSetting: true }),
            currentCharacter: () => ({}),
            continuityFeatureActive: () => true,
            advanceContinuityClocks: (value) => ({ state: structuredClone(value) }),
            scheduleWorldLanes: () => ({ candidates: [], selected: [] }),
            pendingActorActionAttempts: () => ({ attempts: [], candidates: [] }),
            scheduleActorTurns: () => ({ selected: [] }),
            stage3LocalRecallPacket: () => {
                rerollRecallCalls += 1;
                return { digest: 'reroll-recall', actorIds: [], threadIds: [], laneIds: [] };
            },
            stage3FieldState: () => ({ revision: 1, digest: 'same' }),
            normalizeActorLedger: () => ledger,
            actorLedgerDigest: () => 'ledger',
            setContinuityStatus: () => {},
            buildContinuityMessages: () => [],
            generateWorldContinuitySingleBatch: async () => {
                rerollAdvanceCalls += 1;
                return '{}';
            },
            parseContinuityOutput: () => ({
                state: { turn: 1, threads: [], world: {} },
                raw: { world: {}, actionAdjudications: [] },
            }),
            stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
            stage3ValidateWorldDraftInMemory: () => ({ ok: true }),
            currentPlayerActorNames: () => [],
            stage3PreparedWorldCheckpoint: () => preparedCheckpoint,
            persistActorActionAttemptsForTurn: async () => {
                rerollNamespace.continuityCheckpoint = preparedCheckpoint;
                return { ok: true, checkpoint: preparedCheckpoint, ledger };
            },
            stage3PreparedWorldCheckpointMatches: () => true,
            stage3PreparedPhase1StatesMatch: () => true,
            commitPreparedWorldCandidate: async () => ({ status: 'applied', worldModelCalls: 1 }),
            latestWorldLaneDiagnostics: null,
            latestActorShardDiagnostics: null,
        },
    });
    const rerollResult = await rerollRunner(rerolled);
    assert.equal(rerollResult.status, 'applied');
    assert.equal(rerollRecallCalls, 1);
    assert.equal(rerollAdvanceCalls, 1);
    assert.notEqual(rerollResult.reason, 'world_committed_manual_reconciliation');
    let identicalRegenerateAdvanceCalls = 0;
    const identicalRegenerateRunner = loadStage3LegacyManualReconciliationRunner({
        captured: identicalRegenerate,
        namespace: {
            continuityCheckpoint: structuredClone(checkpoint),
            continuity: structuredClone(continuity),
            actorLedger: structuredClone(ledger),
        },
        spies: {
            stage3AcceptedTarget: persisted.stage3AcceptedTarget,
            stage3AcceptedTargetsMatch: persisted.stage3AcceptedTargetsMatch,
            stage3AcceptedTargetKey: () => 'identical-regenerate-target',
            actorActionTargetOf: (value) => ({ ...value }),
            actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
            stage3CommittedCheckpointIsPriorTerminal:
                persisted.stage3CommittedCheckpointIsPriorTerminal,
            stage3CommittedCheckpointIsRerollBaseline:
                persisted.stage3CommittedCheckpointIsRerollBaseline,
            stage3PersistedPackageForTarget: persisted.stage3PersistedPackageForTarget,
            getSettings: () => ({
                continuityMode: 'manual', continuityMaxThreads: 12,
                worldFactionSlots: 0, worldEnvironmentSlots: 0,
                actorLedgerMaxActorsPerTurn: 0, actorLedgerExplorationSlots: 0,
            }),
            getContext: () => ({
                chatId: identicalRegenerate.chatId,
                chat: [{ mes: '' }, { mes: 'accepted narrative' }],
            }),
            stage3LedgerReadbackGate: () => ({ ok: true, actorLedger: ledger }),
            deepClone: (value) => structuredClone(value),
            continuityBase: () => structuredClone(checkpoint.state),
            collectContinuityWorldContext: async () => ({ hasSetting: true }),
            currentCharacter: () => ({}),
            continuityFeatureActive: () => true,
            advanceContinuityClocks: (value) => ({ state: structuredClone(value) }),
            scheduleWorldLanes: () => ({ candidates: [], selected: [] }),
            pendingActorActionAttempts: () => ({ attempts: [], candidates: [] }),
            scheduleActorTurns: () => ({ selected: [] }),
            stage3LocalRecallPacket: () => ({ digest: 'identical-regenerate-recall' }),
            stage3FieldState: () => ({ revision: 1, digest: 'same' }),
            normalizeActorLedger: () => ledger,
            actorLedgerDigest: () => 'ledger',
            setContinuityStatus: () => {},
            buildContinuityMessages: () => [],
            generateWorldContinuitySingleBatch: async () => {
                identicalRegenerateAdvanceCalls += 1;
                return '{}';
            },
            parseContinuityOutput: () => ({
                state: { turn: 1, threads: [], world: {} },
                raw: { world: {}, actionAdjudications: [] },
            }),
            stage3ValidateWorldCandidateInMemory: () => ({ ok: true }),
            stage3ValidateWorldDraftInMemory: () => ({ ok: true }),
            currentPlayerActorNames: () => [],
            stage3PreparedWorldCheckpoint: () => preparedCheckpoint,
            persistActorActionAttemptsForTurn: async () => ({
                ok: true, checkpoint: preparedCheckpoint, ledger,
            }),
            stage3PreparedWorldCheckpointMatches: () => true,
            stage3PreparedPhase1StatesMatch: () => true,
            commitPreparedWorldCandidate: async () => ({ status: 'applied', worldModelCalls: 1 }),
            latestWorldLaneDiagnostics: null,
            latestActorShardDiagnostics: null,
        },
    });
    const identicalRegenerateResult = await identicalRegenerateRunner(identicalRegenerate);
    assert.equal(identicalRegenerateResult.status, 'applied');
    assert.equal(identicalRegenerateAdvanceCalls, 1);

    const runManualCase = async (candidateContinuity, candidateCurrent, candidateLedger = ledger) => {
        let modelCalls = 0;
        const candidateChat = Array.from(
            { length: Math.max(1, candidateCurrent.index + 1) },
            () => ({ mes: 'accepted narrative' }),
        );
        const manualRunner = loadStage3LegacyManualReconciliationRunner({
            captured: candidateCurrent,
            namespace: {
                continuityCheckpoint: structuredClone(checkpoint),
                continuity: structuredClone(candidateContinuity),
            },
            spies: {
                stage3AcceptedTarget: persisted.stage3AcceptedTarget,
                stage3AcceptedTargetsMatch: persisted.stage3AcceptedTargetsMatch,
                actorActionTargetOf: (value) => ({ ...value }),
                actorActionTargetMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
                stage3CommittedCheckpointIsPriorTerminal:
                    persisted.stage3CommittedCheckpointIsPriorTerminal,
                stage3AcceptedTargetIsStrictlyNewer:
                    persisted.stage3AcceptedTargetIsStrictlyNewer,
                stage3PersistedPackageDecision:
                    persisted.stage3PersistedPackageDecision,
                stage3PersistedPackageForTarget: persisted.stage3PersistedPackageForTarget,
                getSettings: () => ({ continuityMaxThreads: 12 }),
                getContext: () => ({ chatId: candidateCurrent.chatId, chat: candidateChat }),
                stage3LedgerReadbackGate: () => ({ ok: true, actorLedger: candidateLedger }),
                stage3LocalRecallPacket: () => ({ digest: 'local' }),
                generateWorldContinuitySingleBatch: () => { modelCalls += 1; },
            },
        });
        return { result: await manualRunner(candidateCurrent), modelCalls };
    };
    for (const [label, candidateContinuity, candidateCurrent] of [
        ['same-generation drift', continuity, {
            ...previous, contentFingerprint: 'same-generation-drift',
        }],
        ['missing packet', withoutPacket, current],
        ['older target', continuity, {
            ...current, index: 0, generationSerial: 0,
        }],
    ]) {
        const rejected = await runManualCase(candidateContinuity, candidateCurrent);
        assert.equal(rejected.result.status, 'failed', label);
        assert.equal(rejected.result.reason, 'world_committed_manual_reconciliation', label);
        assert.equal(rejected.modelCalls, 0, label);
    }

    const settledResult = {
        attemptId: 'ATT-OLD',
        id: 'WORLD-OLD',
        actorRef: { kind: 'actor_ref', actorId: 'NPC-OLD', displayName: '旧人物', aliases: [] },
        target: structuredClone(previous),
        status: 'success',
        outcome: '旧回合已裁决',
    };
    const settledLedger = {
        ...emptyActorLedger(previous.chatId),
        actionAttempts: [{
            id: settledResult.attemptId,
            target: structuredClone(previous),
            worldAdjudicationResult: structuredClone(settledResult),
        }],
    };
    const settledProof = persisted.stage3CanonicalSettlementProof(
        settledLedger,
        [settledResult],
        previous,
    );
    const settledWithoutPacket = {
        ...withoutPacket,
        nextTurnInjection: null,
    };
    const settledContinuity = {
        ...settledWithoutPacket,
        nextTurnInjection: {
            ...packet,
            sourceContinuityDigest:
                persisted.stage3ContinuityDigestWithoutInjection(settledWithoutPacket),
            settlementProof: settledProof,
        },
    };
    assert.equal(
        persisted.stage3CommittedCheckpointIsPriorTerminal(
            checkpoint, settledContinuity, settledLedger, current,
        ),
        true,
        'an intact old-target settlement remains a historical terminal',
    );
    const injectedLedger = structuredClone(settledLedger);
    injectedLedger.actionReceipts = [{
        receiptId: 'actor-action:attempt-old:injected',
        actionId: 'attempt-old',
        attemptId: 'attempt-old',
        actorId: 'NPC-OLD',
        actorRef: structuredClone(settledResult.actorRef),
        stage: 'injected',
        status: 'pending',
        target: structuredClone(previous),
        observableConsequence: 'stable consequence',
        includesResult: true,
        playerActionSettled: false,
        playerConsentSettled: false,
        playerFeelingSettled: false,
    }];
    const injectedProof = persisted.stage3CanonicalSettlementProof(
        injectedLedger,
        [settledResult],
        previous,
    );
    const injectedContinuity = structuredClone(settledContinuity);
    injectedContinuity.nextTurnInjection.settlementProof = injectedProof;
    const responseSettledLedger = structuredClone(injectedLedger);
    Object.assign(responseSettledLedger.actionReceipts[0], {
        stage: 'response_settled',
        status: 'retained',
        consumptionEvidence: '',
        responseSourceRef: {
            chatId: previous.chatId,
            messageId: current.messageId,
            index: current.index,
            swipeId: current.swipeId,
            generationSerial: current.generationSerial,
            generationId: current.generationId,
            generationType: current.generationType,
            scopeDigest: current.scopeDigest,
            hash: current.contentFingerprint,
        },
        settledAt: 123456,
    });
    assert.equal(
        persisted.stage3CommittedCheckpointIsPriorTerminal(
            checkpoint, injectedContinuity, responseSettledLedger, current,
        ),
        false,
        'an unwired response-settled transition cannot be treated as authority-equivalent',
    );
    const strictReceiptMutations = [
        ['receipt status changed', (receipt) => { receipt.status = 'retained'; }],
        ['response source added', (receipt) => {
            receipt.responseSourceRef = structuredClone(responseSettledLedger.actionReceipts[0].responseSourceRef);
        }],
        ['observable consequence changed', (receipt) => {
            receipt.observableConsequence = 'tampered consequence';
        }],
    ];
    for (const [label, mutate] of strictReceiptMutations) {
        const changedLedger = structuredClone(injectedLedger);
        mutate(changedLedger.actionReceipts[0]);
        assert.equal(
            persisted.stage3CommittedCheckpointIsPriorTerminal(
                checkpoint, injectedContinuity, changedLedger, current,
            ),
            false,
            `${label} must change the strict target authority digest`,
        );
    }
    const deletedSettlement = { ...settledLedger, actionAttempts: [] };
    const tamperedSettlement = structuredClone(settledLedger);
    tamperedSettlement.actionAttempts[0].worldAdjudicationResult.outcome = '被篡改';
    for (const [label, candidateLedger] of [
        ['old-target settlement deleted', deletedSettlement],
        ['old-target settlement tampered', tamperedSettlement],
    ]) {
        const rejected = await runManualCase(settledContinuity, current, candidateLedger);
        assert.equal(rejected.result.status, 'failed', label);
        assert.equal(rejected.result.reason, 'world_committed_manual_reconciliation', label);
        assert.equal(
            rejected.result.validationCode,
            'world.checkpoint.prior_terminal.authority_digest_mismatch',
            label,
        );
        assert.equal(rejected.modelCalls, 0, label);
    }
});

test('P4 unrelated-ledger allowance keeps the complete same-target ATT authority exact', () => {
    const persisted = loadStage3PersistedPackageValidator();
    const target = {
        chatId: 'chat-p4-authority', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 2, generationId: 'generation-2', generationType: 'normal',
        scopeDigest: 'scope-p4-authority', contentFingerprint: 'content-2',
    };
    const actorRef = { actorId: 'actor-a', displayName: 'Actor A' };
    const result = {
        attemptId: 'attempt-a', id: 'result-a', status: 'success', actorRef,
        outcome: 'confirmed', worldAdjudicated: true,
    };
    const attempt = {
        id: result.attemptId, actorId: actorRef.actorId, actorRef,
        target: structuredClone(target), action: 'perform bounded action', status: 'success',
        outcome: result.id, settlementEligible: false,
        worldAdjudicationResult: structuredClone(result),
    };
    const receipt = {
        id: 'receipt-a', receiptId: 'receipt-a', stage: 'attempted', attemptId: attempt.id,
        actorId: actorRef.actorId, actorRef, target: structuredClone(target),
        summary: attempt.action, route: 'background_attempt', status: 'adjudicated',
        resultId: result.id, worldAdjudicated: true,
    };
    const ledger = {
        actors: [{ id: actorRef.actorId, profileV6: { status: 'complete' } }],
        actionAttempts: [attempt], actionReceipts: [receipt],
    };
    const proof = persisted.stage3CanonicalSettlementProof(ledger, [result], target);
    const withoutPacket = { chatId: target.chatId, turn: 2, nextTurnInjection: null };
    const continuity = {
        ...withoutPacket,
        nextTurnInjection: {
            status: 'pending', producerTarget: structuredClone(target),
            sourceContinuityDigest: persisted.stage3ContinuityDigestWithoutInjection(withoutPacket),
            settlementProof: proof,
        },
    };
    const accepts = (candidateLedger) => !!persisted.stage3PersistedPackageForTarget(
        continuity,
        candidateLedger,
        target,
        { allowUnrelatedLedgerEvolution: true },
    );
    assert.equal(accepts(ledger), true);
    const profileChanged = structuredClone(ledger);
    profileChanged.actors[0].profileV6.moduleCount = 9;
    assert.equal(accepts(profileChanged), true, 'P1 profile evolution is unrelated');
    const otherTargetChanged = structuredClone(profileChanged);
    otherTargetChanged.actionAttempts.push({
        ...structuredClone(attempt), id: 'attempt-other',
        target: { ...target, index: 4, generationId: 'generation-4' },
        worldAdjudicationResult: null, status: 'held', outcome: null,
    });
    assert.equal(accepts(otherTargetChanged), true, 'other-target ATT evolution is unrelated');

    const eightResults = Array.from({ length: 8 }, (_, index) => ({
        attemptId: `attempt-eight-${index}`,
        id: `result-eight-${index}`,
        status: 'success',
        actorRef: { actorId: `actor-eight-${index}`, displayName: `Actor ${index}` },
        outcome: `confirmed-${index}`,
        worldAdjudicated: true,
    }));
    const eightLedger = {
        actors: eightResults.map((entry) => ({
            id: entry.actorRef.actorId,
            profileV6: { status: 'complete' },
        })),
        actionAttempts: eightResults.map((entry) => ({
            id: entry.attemptId,
            actorId: entry.actorRef.actorId,
            actorRef: structuredClone(entry.actorRef),
            target: structuredClone(target),
            action: `bounded action ${entry.attemptId}`,
            status: 'success',
            outcome: entry.id,
            settlementEligible: false,
            worldAdjudicationResult: structuredClone(entry),
        })),
        actionReceipts: eightResults.map((entry) => ({
            id: `receipt-${entry.attemptId}`,
            receiptId: `receipt-${entry.attemptId}`,
            stage: 'attempted',
            attemptId: entry.attemptId,
            actorId: entry.actorRef.actorId,
            actorRef: structuredClone(entry.actorRef),
            target: structuredClone(target),
            summary: `bounded action ${entry.attemptId}`,
            route: 'background_attempt',
            status: 'adjudicated',
            resultId: entry.id,
            worldAdjudicated: true,
        })),
    };
    const eightProof = persisted.stage3CanonicalSettlementProof(
        eightLedger,
        eightResults,
        target,
    );
    const normalizedEightBase = normalizeContinuityState({
        chatId: target.chatId,
        turn: 2,
        nextTurnInjection: null,
    }, { chatId: target.chatId, maxThreads: 4 });
    const normalizedEightContinuity = normalizeContinuityState({
        ...structuredClone(normalizedEightBase),
        nextTurnInjection: {
            version: 1,
            status: 'pending',
            producerTarget: structuredClone(target),
            sourceContinuityDigest:
                persisted.stage3ContinuityDigestWithoutInjection(normalizedEightBase),
            payload: { text: 'bounded projection', visibleThreadIds: [] },
            settlementProof: eightProof,
            createdAt: 1,
        },
    }, { chatId: target.chatId, maxThreads: 4 });
    assert.equal(
        normalizedEightContinuity.nextTurnInjection.settlementProof.orderedResults.length,
        8,
        'normalization preserves every result when eight actors settle in one accepted turn',
    );
    assert.equal(
        persisted.stage3PersistedPackageDecision(
            normalizedEightContinuity,
            normalizeActorLedger(eightLedger, {
                chatId: target.chatId,
                scopeDigest: target.scopeDigest,
            }),
            target,
            { allowUnrelatedLedgerEvolution: true },
        ).code,
        'ok',
        'the durable normalized eight-actor package retains an exact settlement proof',
    );
    const overCapacityProof = structuredClone(eightProof);
    overCapacityProof.orderedResults = Array.from({ length: 121 }, (_, index) => ({
        ...structuredClone(eightProof.orderedResults[index % eightProof.orderedResults.length]),
        attemptId: `over-capacity-${index}`,
        id: `over-capacity-result-${index}`,
    }));
    const overCapacity = normalizeContinuityState({
        ...structuredClone(normalizedEightBase),
        nextTurnInjection: {
            version: 1,
            status: 'pending',
            producerTarget: structuredClone(target),
            sourceContinuityDigest:
                persisted.stage3ContinuityDigestWithoutInjection(normalizedEightBase),
            payload: { text: 'bounded projection', visibleThreadIds: [] },
            settlementProof: overCapacityProof,
            createdAt: 1,
        },
    }, { chatId: target.chatId, maxThreads: 4 });
    assert.equal(
        overCapacity.nextTurnInjection.settlementProof,
        null,
        'over-capacity proofs fail closed instead of silently dropping results',
    );

    const rawPhase2Ledger = structuredClone(ledger);
    // Phase 2 can still hold the pre-writer attempt shape. The namespace
    // writer then applies normalizeActorLedger and fills canonical technical
    // fields. Both sides must hash the same attempt authority.
    delete rawPhase2Ledger.actionAttempts[0].compatibilityOnly;
    delete rawPhase2Ledger.actionAttempts[0].compatibilityReason;
    delete rawPhase2Ledger.actionAttempts[0].migratedFromLegacyReceipt;
    rawPhase2Ledger.actionReceipts.push({
        receiptId: 'receipt-world-settled',
        actionId: attempt.id,
        attemptId: attempt.id,
        actorId: actorRef.actorId,
        actorRef: structuredClone(actorRef),
        stage: 'world_settled',
        status: 'settled',
        target: { ...structuredClone(target), compatibilityOnly: false },
        resultId: result.id,
        observableConsequence: 'bounded observable consequence',
    });
    const rawPhase2Proof = persisted.stage3CanonicalSettlementProof(
        rawPhase2Ledger,
        [result],
        target,
    );
    const rawPhase2Continuity = structuredClone(continuity);
    rawPhase2Continuity.nextTurnInjection.settlementProof = rawPhase2Proof;
    const durableNormalizedLedger = structuredClone(rawPhase2Ledger);
    const normalizedAuthorityLedger = normalizeActorLedger({
        chatId: target.chatId,
        actionAttempts: rawPhase2Ledger.actionAttempts,
        actionReceipts: rawPhase2Ledger.actionReceipts,
    }, {
        chatId: target.chatId,
        scopeDigest: target.scopeDigest,
    });
    durableNormalizedLedger.actionAttempts = normalizedAuthorityLedger.actionAttempts;
    durableNormalizedLedger.actionReceipts = normalizedAuthorityLedger.actionReceipts;
    const normalizedDecision = persisted.stage3PersistedPackageDecision(
        rawPhase2Continuity,
        durableNormalizedLedger,
        target,
        { allowUnrelatedLedgerEvolution: true },
    );
    assert.equal(
        normalizedDecision.code,
        'ok',
        'raw Phase2 attempts/receipts and the durable normalized read use one canonical proof shape',
    );
    const normalizedReceiptTamper = structuredClone(durableNormalizedLedger);
    normalizedReceiptTamper.actionReceipts.find((entry) => (
        entry.receiptId === 'receipt-world-settled'
    )).observableConsequence = 'tampered observable consequence';
    assert.equal(
        persisted.stage3PersistedPackageDecision(
            rawPhase2Continuity,
            normalizedReceiptTamper,
            target,
            { allowUnrelatedLedgerEvolution: true },
        ).code,
        'authority_digest_mismatch',
        'normalization compatibility never permits same-target receipt authority tampering',
    );
    const normalizedAttemptTamper = structuredClone(durableNormalizedLedger);
    normalizedAttemptTamper.actionAttempts[0].worldAdjudicationResult.id = 'tampered-result';
    assert.equal(
        persisted.stage3PersistedPackageDecision(
            rawPhase2Continuity,
            normalizedAttemptTamper,
            target,
            { allowUnrelatedLedgerEvolution: true },
        ).code,
        'authority_digest_mismatch',
        'attempt canonicalization never permits same-target adjudication tampering',
    );

    const mutations = [];
    for (const [label, mutate] of [
        ['action', (value) => { value.actionAttempts[0].action = 'tampered action'; }],
        ['status', (value) => { value.actionAttempts[0].status = 'failure'; }],
        ['actorRef', (value) => { value.actionAttempts[0].actorRef.actorId = 'actor-b'; }],
        ['target', (value) => { value.actionAttempts[0].target.generationId = 'generation-x'; }],
        ['result', (value) => { value.actionAttempts[0].worldAdjudicationResult.id = 'result-x'; }],
        ['receipt status', (value) => { value.actionReceipts[0].status = 'pending_player'; }],
        ['receipt result', (value) => { value.actionReceipts[0].resultId = 'result-x'; }],
        ['receipt actorRef', (value) => { value.actionReceipts[0].actorRef.actorId = 'actor-b'; }],
        ['receipt target', (value) => { value.actionReceipts[0].target.generationId = 'generation-x'; }],
    ]) {
        const changed = structuredClone(ledger);
        mutate(changed);
        mutations.push([label, changed]);
    }
    const addedTerminal = structuredClone(ledger);
    addedTerminal.actionAttempts.push({
        ...structuredClone(attempt), id: 'attempt-terminal', status: 'held',
        outcome: null, worldAdjudicationResult: null,
    });
    mutations.push(['added same-target terminal/no-result ATT', addedTerminal]);
    const deletedAttempt = structuredClone(ledger);
    deletedAttempt.actionAttempts = [];
    mutations.push(['deleted ATT', deletedAttempt]);
    const addedReceipt = structuredClone(ledger);
    addedReceipt.actionReceipts.push({ ...structuredClone(receipt), id: 'receipt-extra' });
    mutations.push(['added same-target receipt', addedReceipt]);
    const deletedReceipt = structuredClone(ledger);
    deletedReceipt.actionReceipts = [];
    mutations.push(['deleted receipt', deletedReceipt]);
    for (const [label, candidate] of mutations) {
        assert.equal(accepts(candidate), false, label);
    }

    const legacy = structuredClone(continuity);
    delete legacy.nextTurnInjection.settlementProof.targetActionAuthorityDigest;
    delete legacy.nextTurnInjection.settlementProof.targetActionAttemptCount;
    delete legacy.nextTurnInjection.settlementProof.targetActionReceiptCount;
    assert.equal(
        persisted.stage3PersistedPackageForTarget(
            legacy, ledger, target, { allowUnrelatedLedgerEvolution: true },
        ),
        null,
        'old proof without target authority binding fails closed',
    );
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
        'function stage3PersistedPackageForTarget(state, ledger, captured, options = {}) {',
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
        'structure_only');
    assert.equal(noActorGate(current, { ...permit, profileBatch: { readbackVerified: false } }).reason,
        'structure_only');

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
        }, current, { allowUnrelatedLedgerEvolution: true }),
        null,
        'a receipt/settlement mismatch cannot pass even the profile-only evolution path',
    );
    const proofAttemptTampered = structuredClone(continuity);
    proofAttemptTampered.nextTurnInjection.settlementProof.orderedResults[0].attemptId = 'attempt-tampered';
    assert.equal(
        persisted.stage3PersistedPackageForTarget(
            proofAttemptTampered,
            ledger,
            current,
            { allowUnrelatedLedgerEvolution: true },
        ),
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
    const coverageProof = actorProfileDiscoveryCoveragePlan('风声掠过空旷走廊，没有人物进入场景。');
    assert.equal(await persistence.persist(captured, {
        status: 'no_candidates', profileBatch: { readbackVerified: false, coverageProof },
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
    })(captured, null).reason, 'structure_only');

    const unrelatedReceipt = {
        ...structuredClone(savedNamespace),
        actorProfileRetryReceipt: { status: 'not_completed' },
    };
    assert.equal(loadStage3NoActorPermitGate({
        namespace: unrelatedReceipt,
        currentSourceRef: captured,
    })(captured, null).reason, 'no_candidates');
    const unclearedCurrentTickets = {
        ...structuredClone(savedNamespace),
        characterCreationTicketBatches: [{ acceptedTarget: structuredClone(captured) }],
    };
    assert.equal(loadStage3NoActorPermitGate({
        namespace: unclearedCurrentTickets,
        currentSourceRef: captured,
    })(captured, null).reason, 'structure_only');

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
        })(changed, null).reason, 'structure_only');
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
            'structure_only',
        );
    }
    assert.equal(
        runGate(currentSourceRef, false).reason,
        'structure_only',
    );
});

test('P3 admits the durable ready subset while a newly discovered unready actor stays unscheduled', () => {
    const source = {
        chatId: 'chat-ready-subset', messageId: 'message-2', logicalIndex: 2, index: 2,
        swipeId: 0, generation: 4, generationSerial: 4,
        generationId: 'generation-4', generationType: 'normal', type: 'normal',
        identityScopeId: 'chat-ready-subset|card', scopeDigest: 'scope-ready-subset',
        contentHash: 'accepted-content', contentFingerprint: 'accepted-content', hash: 'host-hash',
    };
    const registryEntry = (actorId) => ({
        actorRef: { actorId, displayName: actorId },
        sourceRefs: [structuredClone(source)],
    });
    const ledger = {
        actorRegistry: { registered: {
            'actor-ready': registryEntry('actor-ready'),
            'actor-new': registryEntry('actor-new'),
        } },
        actors: [{ id: 'actor-ready' }, { id: 'actor-new' }],
    };
    const result = loadStage3NoActorPermitGate({
        namespace: { actorLedger: ledger },
        currentSourceRef: source,
        ledger,
        readiness: { 'actor-ready': true, 'actor-new': false },
    })(source, null);
    assert.equal(result.ok, true, JSON.stringify({
        reason: result.reason,
        checkpoint: result.checkpoint?.stage3Phase || null,
    }));
    assert.equal(result.reason, 'ready_subset');
    assert.deepEqual([...result.readyActorIds], ['actor-ready']);
    assert.deepEqual([...result.unreadySourceActorIds], ['actor-new']);
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
            phase1WriteMode: 'actor_attempts',
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
        continuityValue = continuity, checkpointValue = checkpoint } = {}) => ({
        actorLedger: actorLedgerValue,
        continuity: continuityValue,
        continuityCheckpoint: checkpointValue,
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
    assert.equal(gate.matches(checkpoint, namespaceAt({ actorRevision: 7, checkpointRevision: 6 }), ledger, {}), true,
        'a later unrelated P1 actor revision does not invalidate the durable prepared checkpoint');
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
            namespaceAt({ actorLedgerValue: attemptLedger, checkpointValue: ordinaryCheckpoint }),
            attemptLedger,
            {},
        ),
        true,
        'ordinary attempt Phase1 also advances both selected fields from 5 to shared revision 6',
    );

    const checkpointOnly = structuredClone(checkpoint);
    checkpointOnly.preparedWorld.phase1WriteMode = 'checkpoint_only';
    checkpointOnly.preparedWorld.phase1Expected.actorLedger = {
        revision: 6,
        digest: ledger.digest,
    };
    checkpointOnly.preparedWorld.phase1Expected.continuityCheckpoint.revision = 5;
    assert.equal(gate.matches(
        checkpointOnly,
        namespaceAt({ actorRevision: 6, checkpointRevision: 7, checkpointValue: checkpointOnly }),
        ledger,
        {},
    ), true, 'checkpoint-only Phase1 advances only the checkpoint field');
    assert.equal(gate.matches(
        checkpointOnly,
        namespaceAt({ actorRevision: 8, checkpointRevision: 7, checkpointValue: checkpointOnly }),
        ledger,
        {},
    ), true, 'a later P1 profile commit remains compatible with checkpoint-only Phase1');
});

test('prepared Phase1/Phase2 authority allows only profile or other-target ledger evolution', () => {
    const matcher = loadStage3PreparedAuthorityMatcher();
    const captured = {
        chatId: 'chat-prepared-authority', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 2, generationId: 'generation-2', generationType: 'normal',
        scopeDigest: 'scope-prepared', contentFingerprint: 'content-2',
    };
    const actorRef = { actorId: 'actor-a' };
    const attempt = {
        id: 'attempt-a', actorId: actorRef.actorId, actorRef,
        target: structuredClone(captured), action: 'bounded action', status: 'success',
        worldAdjudicationResult: { attemptId: 'attempt-a', id: 'result-a', status: 'success' },
    };
    const receipt = {
        id: 'receipt-a', stage: 'attempted', attemptId: attempt.id,
        actorId: actorRef.actorId, actorRef, target: structuredClone(captured),
        status: 'adjudicated', resultId: 'result-a',
    };
    const ledger = {
        actors: [{ id: actorRef.actorId, profileV6: { status: 'complete' } }],
        actionAttempts: [attempt], actionReceipts: [receipt],
    };
    const checkpoint = matcher.build({
        captured,
        checkpointBase: { turn: 1 },
        scheduledBase: { turn: 2 },
        parsed: { state: { turn: 2 }, raw: { world: {}, actionAdjudications: [] } },
        director: 'standalone', nextTurn: 2, actionTarget: captured,
        ledger, recall: {}, worldContext: { hasSetting: true },
        phase1Expected: {}, phase1WriteMode: 'actor_attempts',
    });
    assert.equal(matcher.matches(checkpoint, ledger, captured, {
        allowUnrelatedActorEvolution: true,
    }), true);
    const profileChanged = structuredClone(ledger);
    profileChanged.actors[0].profileV6.moduleCount = 9;
    assert.equal(matcher.matches(checkpoint, profileChanged, captured, {
        allowUnrelatedActorEvolution: true,
    }), true);
    const otherTarget = structuredClone(profileChanged);
    otherTarget.actionAttempts.push({
        ...structuredClone(attempt), id: 'attempt-other',
        target: { ...captured, index: 4, generationId: 'generation-4' },
    });
    assert.equal(matcher.matches(checkpoint, otherTarget, captured, {
        allowUnrelatedActorEvolution: true,
    }), true);
    for (const [label, candidate] of [
        ['same-target action', (() => { const v = structuredClone(ledger); v.actionAttempts[0].action = 'changed'; return v; })()],
        ['same-target terminal/no-result', (() => { const v = structuredClone(ledger); v.actionAttempts.push({ ...structuredClone(attempt), id: 'terminal', status: 'held', worldAdjudicationResult: null }); return v; })()],
        ['same-target receipt', (() => { const v = structuredClone(ledger); v.actionReceipts[0].status = 'pending_player'; return v; })()],
    ]) {
        assert.equal(matcher.matches(checkpoint, candidate, captured, {
            allowUnrelatedActorEvolution: true,
        }), false, label);
    }
});

test('production checkpoint-only writer guards but never rewrites a concurrent P1 ledger', async () => {
    const actorLedger = {
        actors: [{ id: 'actor-ready-after-model', profileV6: { status: 'complete' } }],
        actionAttempts: [],
        profileRevision: 7,
    };
    const initial = {
        version: 13,
        chatId: 'chat-checkpoint-only',
        rev: 10,
        actorSovereigntyScope: { scopeDigest: 'scope-checkpoint-only' },
        actorLedger: structuredClone(actorLedger),
        continuity: { turn: 1 },
        continuityCheckpoint: null,
        fieldRevisions: { actorLedger: 10, continuity: 4, continuityCheckpoint: 4 },
    };
    let persisted = structuredClone(initial);
    const context = {
        chatId: initial.chatId,
        chatMetadata: { mvu_auto_doctor: structuredClone(initial) },
        updateChatMetadata(patch) {
            this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
        },
        async saveMetadata() {
            persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
        },
        async readPersistedChatMetadata() {
            return structuredClone(persisted);
        },
    };
    const writer = loadProductionActionAttemptWriter(() => context);
    const checkpoint = {
        stage3Phase: 'world_candidate_prepared',
        preparedWorld: { phase1WriteMode: 'checkpoint_only' },
    };
    const result = await writer.persist({
        chatId: initial.chatId,
        scopeDigest: 'scope-checkpoint-only',
    }, {
        previousLedger: actorLedger,
        nextLedger: actorLedger,
        attempts: [],
        target: { chatId: initial.chatId, index: 2 },
        preparedCheckpoint: checkpoint,
        phase1WriteMode: 'checkpoint_only',
        expectedFieldStates: {
            actorLedger: { revision: 10, digest: JSON.stringify(actorLedger) },
            continuity: { revision: 4, digest: JSON.stringify(JSON.stringify(initial.continuity)) },
            continuityCheckpoint: { revision: 4, digest: JSON.stringify(JSON.stringify(null)) },
        },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.readbackNamespace.actorLedger, actorLedger);
    assert.deepEqual(persisted.actorLedger, actorLedger);
    assert.equal(persisted.fieldRevisions.actorLedger, 10, 'P3 does not advance P1 ownership');
    assert.equal(persisted.fieldRevisions.continuityCheckpoint, 11);
    assert.equal(persisted.continuityCheckpoint.preparedWorld.phase1WriteMode, 'checkpoint_only');

    const p1Writer = loadNamespaceWriter(() => context);
    const afterP3 = structuredClone(context.chatMetadata.mvu_auto_doctor);
    const p1Ledger = structuredClone(afterP3.actorLedger);
    p1Ledger.actors[0].profileV6.moduleCount = 9;
    const p1Candidate = { ...afterP3, actorLedger: p1Ledger };
    assert.equal(await p1Writer.write(p1Candidate, initial.chatId, {
        fields: ['actorLedger'], durable: true, force: true, requireReadback: true,
        expectedFieldStates: {
            actorLedger: {
                revision: 10,
                digest: JSON.stringify(afterP3.actorLedger),
            },
        },
        contentValidator: (value) => value.actorLedger?.actors?.[0]?.profileV6?.moduleCount === 9,
    }), true, 'P1 remains able to atomically commit after P3 checkpoint-only Phase1');
    assert.equal(persisted.actorLedger.actors[0].profileV6.moduleCount, 9);
    assert.equal(persisted.continuityCheckpoint.preparedWorld.phase1WriteMode, 'checkpoint_only');
});

test('production prepared checkpoint survives the actual JSON durable readback matcher', async () => {
    const captured = {
        chatId: 'chat-real-prepared-readback', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 2, generationId: 'generation-2', generationType: 'normal',
        scopeDigest: 'scope-real-prepared', contentFingerprint: 'content-real-prepared',
    };
    const actionTarget = {
        chatId: captured.chatId, logicalIndex: captured.index, index: captured.index,
        messageId: captured.messageId, swipeId: captured.swipeId,
        generation: captured.generationSerial, generationId: captured.generationId,
        generationType: captured.generationType, scopeDigest: captured.scopeDigest,
        contentHash: captured.contentFingerprint, hash: captured.contentFingerprint,
    };
    const actorLedger = {
        chatId: captured.chatId,
        actors: [], actorRegistry: { registered: {} }, actionAttempts: [], actionReceipts: [],
    };
    const initial = {
        version: 13, chatId: captured.chatId, rev: 10,
        actorSovereigntyScope: { scopeDigest: captured.scopeDigest },
        actorLedger: structuredClone(actorLedger), continuity: { turn: 0 },
        continuityCheckpoint: null,
        fieldRevisions: { actorLedger: 10, continuity: 4, continuityCheckpoint: 4 },
    };
    let persisted = JSON.parse(JSON.stringify(initial));
    let readbackMutations = [];
    let readbackCallCount = 0;
    let readbackReturnNullAt = 0;
    const context = {
        chatId: captured.chatId,
        chatMetadata: { mvu_auto_doctor: structuredClone(initial) },
        updateChatMetadata(patch) {
            this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
        },
        async saveMetadata() {
            persisted = JSON.parse(JSON.stringify(this.chatMetadata.mvu_auto_doctor));
        },
        async readPersistedChatMetadata() {
            readbackCallCount += 1;
            if (readbackMutations.length) {
                const mutate = readbackMutations.shift();
                mutate(persisted);
                this.chatMetadata.mvu_auto_doctor = structuredClone(persisted);
            }
            if (readbackReturnNullAt === readbackCallCount) return null;
            return JSON.parse(JSON.stringify(persisted));
        },
    };
    const authority = loadStage3PreparedAuthorityMatcher();
    const preModelExpected = {
        actorLedger: { revision: 10, digest: JSON.stringify(actorLedger) },
        continuity: { revision: 3, digest: JSON.stringify(JSON.stringify(initial.continuity)) },
        continuityCheckpoint: { revision: 3, digest: JSON.stringify(JSON.stringify(null)) },
    };
    const phase1Expected = {
        actorLedger: { revision: 10, digest: JSON.stringify(actorLedger) },
        continuity: { revision: 4, digest: JSON.stringify(JSON.stringify(initial.continuity)) },
        continuityCheckpoint: { revision: 4, digest: JSON.stringify(JSON.stringify(null)) },
    };
    const unchangedGate = loadStage3UnchangedFieldRebaseGate();
    assert.equal(unchangedGate(preModelExpected.continuity, phase1Expected.continuity), true);
    assert.equal(
        unchangedGate(preModelExpected.continuityCheckpoint, phase1Expected.continuityCheckpoint),
        true,
    );
    assert.equal(unchangedGate(preModelExpected.continuity, {
        revision: 4,
        digest: 'changed-continuity',
    }), false, 'a real continuity change remains fail-closed');
    const checkpoint = authority.build({
        captured,
        checkpointBase: { turn: 0 }, scheduledBase: { turn: 1 },
        parsed: {
            state: { turn: 1, threads: [], world: {} },
            raw: { world: {}, actionProposals: [], actionAdjudications: [] },
        },
        director: 'standalone', nextTurn: 1, actionTarget,
        ledger: actorLedger,
        recall: {
            digest: 'recall',
            worldbookEntryIds: Array.from({ length: 44 }, (_, index) => `entry-${index}`),
            worldbookSourceRefs: [{ world: 'embedded', nativeId: 0, aliases: undefined }],
        },
        worldContext: { hasSetting: true }, phase1Expected,
        phase1WriteMode: 'checkpoint_only',
    });
    assert.equal(authority.matches(checkpoint, actorLedger, captured), true);
    const writer = loadProductionActionAttemptWriter(
        () => context,
        null,
        authority.matches,
    );
    readbackMutations.push((value) => {
        value.actorLedger = {
            ...structuredClone(value.actorLedger),
            updatedAt: 99,
            p1ProfileReadbackMarker: { status: 'complete', moduleCount: 9 },
        };
        value.rev = Math.max(12, Number(value.rev) || 0);
        value.fieldRevisions.actorLedger = 12;
    });
    const result = await writer.persist(captured, {
        previousLedger: actorLedger, nextLedger: actorLedger, attempts: [], actionTarget,
        preparedCheckpoint: checkpoint, phase1WriteMode: 'checkpoint_only',
        expectedFieldStates: phase1Expected,
    });
    assert.equal(result.ok, true);
    assert.equal(authority.matches(result.checkpoint, result.readbackNamespace.actorLedger, captured, {
        allowUnrelatedActorEvolution: true,
    }), true);
    assert.equal(
        result.readbackNamespace.actorLedger.p1ProfileReadbackMarker.moduleCount,
        9,
        'checkpoint-only readback retains the profile committed during verification',
    );
    for (const [label, mutateLedger] of [
        ['same-target ATT', (ledger) => {
            ledger.actionAttempts = [{ id: 'same-target-attempt', target: structuredClone(actionTarget) }];
        }],
        ['same-target receipt', (ledger) => {
            ledger.actionReceipts = [{ id: 'same-target-receipt', target: structuredClone(actionTarget) }];
        }],
    ]) {
        persisted = JSON.parse(JSON.stringify(initial));
        context.chatMetadata.mvu_auto_doctor = structuredClone(initial);
        readbackMutations.push((value) => {
            mutateLedger(value.actorLedger);
            value.actorLedger.updatedAt = 100;
            value.rev = 12;
            value.fieldRevisions.actorLedger = 12;
        });
        const rejected = await writer.persist(captured, {
            previousLedger: actorLedger, nextLedger: actorLedger, attempts: [], actionTarget,
            preparedCheckpoint: checkpoint, phase1WriteMode: 'checkpoint_only',
            expectedFieldStates: phase1Expected,
        });
        assert.equal(rejected.ok, false, label);
        assert.equal(rejected.reason, 'action_attempt.readback_mismatch', label);
        assert.equal(
            rejected.failureCode,
            'host_save_content_validation_compensated',
            `${label}: the durable selected-field compensation is explicit`,
        );
        assert.equal(context.chatMetadata.mvu_auto_doctor.continuityCheckpoint, null, label);
        assert.equal(persisted.continuityCheckpoint, null, `${label}: durable checkpoint compensated`);
        assert.deepEqual(
            context.chatMetadata.mvu_auto_doctor.actorLedger,
            persisted.actorLedger,
            `${label}: memory and durable actor authority remain identical`,
        );
        assert.equal(
            persisted.actorLedger.actionAttempts.length
                + persisted.actorLedger.actionReceipts.length,
            1,
            `${label}: concurrent same-target authority is never erased`,
        );
    }

    persisted = JSON.parse(JSON.stringify(initial));
    context.chatMetadata.mvu_auto_doctor = structuredClone(initial);
    const competingCheckpoint = {
        stage3Phase: 'world_prepared',
        preparedWorld: { phase1WriteMode: 'checkpoint_only', candidateDigest: 'competing' },
    };
    readbackMutations.push(
        (value) => {
            value.actorLedger.actionAttempts = [{
                id: 'same-target-race', target: structuredClone(actionTarget),
            }];
            value.rev = 12;
            value.fieldRevisions.actorLedger = 12;
        },
        () => undefined,
        () => undefined,
        (value) => {
            value.continuityCheckpoint = structuredClone(competingCheckpoint);
            value.rev = 13;
            value.fieldRevisions.continuityCheckpoint = 13;
        },
    );
    const conflicted = await writer.persist(captured, {
        previousLedger: actorLedger, nextLedger: actorLedger, attempts: [], actionTarget,
        preparedCheckpoint: checkpoint, phase1WriteMode: 'checkpoint_only',
        expectedFieldStates: phase1Expected,
    });
    assert.equal(conflicted.ok, false);
    assert.equal(conflicted.reason, 'action_attempt.readback_mismatch');
    assert.equal(conflicted.failureCode, 'host_save_content_validation_conflict');
    assert.deepEqual(
        context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
        competingCheckpoint,
        'a competing selected-field write stays recoverable in memory',
    );
    assert.deepEqual(
        persisted.continuityCheckpoint,
        competingCheckpoint,
        'a competing selected-field write stays recoverable durably',
    );
    assert.equal(persisted.actorLedger.actionAttempts[0].id, 'same-target-race');
    assert.deepEqual(
        context.chatMetadata.mvu_auto_doctor.actorLedger,
        persisted.actorLedger,
        'the compensation conflict does not fork actor authority',
    );

    persisted = JSON.parse(JSON.stringify(initial));
    context.chatMetadata.mvu_auto_doctor = structuredClone(initial);
    readbackCallCount = 0;
    readbackReturnNullAt = 5;
    readbackMutations.push(
        (value) => {
            value.actorLedger.actionReceipts = [{
                id: 'same-target-unknown', target: structuredClone(actionTarget),
            }];
            value.rev = 12;
            value.fieldRevisions.actorLedger = 12;
        },
        () => undefined,
        () => undefined,
    );
    const unknown = await writer.persist(captured, {
        previousLedger: actorLedger, nextLedger: actorLedger, attempts: [], actionTarget,
        preparedCheckpoint: checkpoint, phase1WriteMode: 'checkpoint_only',
        expectedFieldStates: phase1Expected,
    });
    readbackReturnNullAt = 0;
    assert.equal(unknown.ok, false);
    assert.equal(unknown.failureCode, 'host_save_content_validation_readback_unknown');
    assert.deepEqual(
        context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
        JSON.parse(JSON.stringify(checkpoint)),
        'an unverifiable compensation retains the last proven prepared checkpoint in memory',
    );
    assert.equal(
        context.chatMetadata.mvu_auto_doctor.actorLedger.actionReceipts[0].id,
        'same-target-unknown',
        'an unverifiable compensation never restores the stale pre-save actor ledger',
    );
    const verifiedPhase1 = structuredClone(result.readbackNamespace);
    context.chatMetadata.mvu_auto_doctor.actorLedger = {
        ...structuredClone(actorLedger),
        actors: [{ id: 'p1-completed-after-phase1-readback' }],
    };
    context.chatMetadata.mvu_auto_doctor.fieldRevisions.actorLedger = 12;
    assert.deepEqual(
        result.readbackNamespace,
        verifiedPhase1,
        'the durable Phase1 snapshot is not replaced by a later mutable host read',
    );
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(
        run,
        /phase1Persisted\?\.readbackNamespace[\s\S]*?deepClone\(phase1Persisted\.readbackNamespace\)/u,
    );
});

test('checkpoint-only Phase1 locally recovers one swallowed host save without losing P1 authority', async () => {
    const chatId = 'chat-phase1-host-save-recovery';
    const baseline = {
        version: 13, chatId, rev: 4,
        actorLedger: { actors: [{ id: 'actor-ready', profileV6: { status: 'complete' } }] },
        continuity: { turn: 0 }, continuityCheckpoint: null,
        fieldRevisions: { actorLedger: 4, continuity: 4, continuityCheckpoint: 4 },
    };
    const prepared = {
        stage3Phase: 'world_candidate_prepared',
        target: { generationId: 'generation-2' },
        preparedWorld: { phase1WriteMode: 'checkpoint_only' },
    };
    let persisted = structuredClone(baseline);
    let saveCalls = 0;
    const context = {
        chatId,
        chatMetadata: { mvu_auto_doctor: structuredClone(baseline) },
        updateChatMetadata(patch) {
            this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
        },
        async saveMetadata() {
            saveCalls += 1;
            if (saveCalls === 1) return; // SillyTavern saveMetadata swallowed saveChat failure.
            persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
        },
        async readPersistedChatMetadata() {
            if (saveCalls === 1) {
                persisted.actorLedger.actors[0].profileV6.moduleCount = 9;
                persisted.rev = 5;
                persisted.fieldRevisions.actorLedger = 5;
            }
            return structuredClone(persisted);
        },
    };
    const writer = loadNamespaceWriter(() => context);
    const candidate = { ...structuredClone(baseline), continuityCheckpoint: prepared };
    const failureSink = {};
    const successSink = {};
    const saved = await writer.write(candidate, chatId, {
        fields: ['continuityCheckpoint'], durable: true, force: true,
        requireReadback: true, readbackAttempts: 1,
        allowUnselectedFieldEvolution: true,
        compensateSelectedContentValidationFailure: true,
        failureSink, successSink,
        contentValidator: (value) => (
            value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
            && value?.actorLedger?.actors?.[0]?.profileV6?.status === 'complete'
        ),
    });
    assert.equal(saved, true);
    assert.equal(saveCalls, 2, 'one local host save/readback retry, no model retry');
    assert.equal(persisted.continuityCheckpoint.stage3Phase, 'world_candidate_prepared');
    assert.equal(persisted.actorLedger.actors[0].profileV6.moduleCount, 9);
    assert.deepEqual(context.chatMetadata.mvu_auto_doctor, persisted);
    assert.equal(successSink.readbackNamespace.fieldRevisions.actorLedger, 5);
    assert.equal(writer.metrics.rolledBackWrites, 0);
});

test('checkpoint-only retry never republishes a durable actor ledger behind current P1', async () => {
    const run = async ({
        durableCatchesUp = false, wrongChat = false, wrongScope = false,
        worldAhead = false,
    }) => {
        const chatId = 'chat-p1-non-regression';
        const scope = { scopeDigest: 'scope-current' };
        const current = {
            version: 13, chatId, rev: 5, actorSovereigntyScope: scope,
            actorLedger: { actors: [{ id: 'actor-ready', profileV6: {
                status: 'complete', moduleCount: 9,
            } }], actionAttempts: [], actionReceipts: [] },
            continuity: { turn: 0 }, continuityCheckpoint: null,
            fieldRevisions: { actorSovereigntyScope: 1, actorLedger: 5,
                continuity: 4, continuityCheckpoint: 4 },
        };
        const oldDurable = {
            ...structuredClone(current), rev: 4,
            actorLedger: { actors: [], actionAttempts: [], actionReceipts: [] },
            fieldRevisions: { ...current.fieldRevisions, actorLedger: 4 },
        };
        if (wrongChat) oldDurable.chatId = 'other-chat';
        if (wrongScope) oldDurable.actorSovereigntyScope = { scopeDigest: 'other-scope' };
        if (worldAhead) {
            oldDurable.actorLedger = structuredClone(current.actorLedger);
            oldDurable.fieldRevisions.actorLedger = 5;
            oldDurable.continuity = { turn: 1 };
            oldDurable.fieldRevisions.continuity = 6;
            oldDurable.rev = 6;
        }
        let persisted = structuredClone(oldDurable);
        let saves = 0;
        let reads = 0;
        const context = {
            chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(current) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            },
            async saveMetadata() {
                saves += 1;
                if (saves > 1) persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
            },
            async readPersistedChatMetadata() {
                reads += 1;
                if (durableCatchesUp && reads === 2) persisted = structuredClone(current);
                return structuredClone(persisted);
            },
        };
        const prepared = { stage3Phase: 'world_candidate_prepared', preparedWorld: {
            phase1WriteMode: 'checkpoint_only', targetActionAuthorityDigest: 'empty',
        } };
        const failureSink = {};
        const writer = loadNamespaceWriter(() => context);
        const saved = await writer.write({
            ...structuredClone(current), continuityCheckpoint: prepared,
        }, chatId, {
            fields: ['continuityCheckpoint'], durable: true, force: true,
            requireReadback: true, readbackAttempts: 1,
            allowUnselectedFieldEvolution: true,
            compensateSelectedContentValidationFailure: true,
            failureSink,
            contentValidator: (value) => (
                value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
                && value?.actorLedger?.actors?.[0]?.profileV6?.moduleCount === 9
                && (value?.actorLedger?.actionAttempts?.length || 0) === 0
                && (value?.actorLedger?.actionReceipts?.length || 0) === 0
            ),
        });
        return { saved, failureSink, saves, persisted, context, prepared };
    };

    const behind = await run({});
    assert.equal(behind.saved, false);
    assert.equal(behind.saves, 1, 'the swallowed first save is never followed by a stale-ledger resave');
    assert.equal(behind.failureSink.code, 'host_save_readback_authority_unknown');
    assert.equal(
        behind.context.chatMetadata.mvu_auto_doctor.actorLedger.actors[0]
            .profileV6.moduleCount,
        9,
    );
    assert.equal(
        behind.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint.stage3Phase,
        'world_candidate_prepared',
        'unknown durable state retains the current P1 plus recoverable prepared candidate',
    );

    const caughtUp = await run({ durableCatchesUp: true });
    assert.equal(caughtUp.saved, true);
    assert.equal(caughtUp.saves, 2, 'fresh rev5 authority permits one checkpoint-only resave');
    assert.equal(caughtUp.persisted.actorLedger.actors[0].profileV6.moduleCount, 9);
    assert.equal(caughtUp.persisted.continuityCheckpoint.stage3Phase, 'world_candidate_prepared');

    for (const options of [{ wrongChat: true }, { wrongScope: true }]) {
        const rejected = await run(options);
        assert.equal(rejected.saved, false);
        assert.equal(rejected.saves, 1, 'wrong chat/scope performs no local resave');
        assert.equal(rejected.failureSink.code, 'host_save_readback_authority_unknown');
    }
    const worldAhead = await run({ worldAhead: true });
    assert.equal(worldAhead.saved, false);
    assert.equal(worldAhead.saves, 1, 'P3 never adopts a newer unselected world field');
    assert.equal(worldAhead.failureSink.code, 'host_save_readback_selected_conflict');
});

test('checkpoint-only retry binds baseline and prepared content to selected field revisions', async () => {
    const run = async ({ durablePrepared }) => {
        const chatId = `chat-selected-revision-${durablePrepared ? 'prepared' : 'baseline'}`;
        const baseline = {
            version: 13, chatId, rev: 4,
            actorLedger: { actors: [{ id: 'p1-authority' }], actionAttempts: [], actionReceipts: [] },
            continuity: { turn: 0 }, continuityCheckpoint: null,
            fieldRevisions: { actorLedger: 4, continuity: 4, continuityCheckpoint: 4 },
        };
        const prepared = { stage3Phase: 'world_candidate_prepared', preparedWorld: {
            phase1WriteMode: 'checkpoint_only', targetActionAuthorityDigest: 'empty',
        } };
        let saves = 0;
        let persisted = structuredClone(baseline);
        const context = {
            chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(baseline) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            },
            async saveMetadata() {
                saves += 1;
                if (durablePrepared) {
                    persisted = structuredClone(this.chatMetadata.mvu_auto_doctor);
                    persisted.rev += 1;
                    persisted.fieldRevisions.continuityCheckpoint += 1;
                } else {
                    // A competing checkpoint write advanced only its selected
                    // revision while retaining the old baseline content.
                    persisted.rev = 5;
                    persisted.fieldRevisions.continuityCheckpoint = 5;
                }
            },
            async readPersistedChatMetadata() {
                return structuredClone(persisted);
            },
        };
        const writer = loadNamespaceWriter(() => context);
        const failureSink = {};
        const successSink = {};
        const saved = await writer.write({
            ...structuredClone(baseline), continuityCheckpoint: prepared,
        }, chatId, {
            fields: ['continuityCheckpoint'], durable: true, force: true,
            requireReadback: true, readbackAttempts: 1,
            allowUnselectedFieldEvolution: true,
            compensateSelectedContentValidationFailure: true,
            failureSink, successSink,
            contentValidator: (value) => (
                value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
            ),
        });
        return { saved, saves, persisted, context, failureSink, successSink };
    };

    const advancedBaseline = await run({ durablePrepared: false });
    assert.equal(advancedBaseline.saved, false);
    assert.equal(advancedBaseline.saves, 1, 'advanced baseline revision is never overwritten');
    assert.equal(
        advancedBaseline.failureSink.code,
        'host_save_readback_selected_conflict',
    );
    assert.equal(
        advancedBaseline.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
        null,
        'the higher-revision durable baseline remains authoritative',
    );
    assert.equal(
        advancedBaseline.context.chatMetadata.mvu_auto_doctor
            .fieldRevisions.continuityCheckpoint,
        5,
    );

    const alreadyPrepared = await run({ durablePrepared: true });
    assert.equal(alreadyPrepared.saved, true);
    assert.equal(alreadyPrepared.saves, 1, 'a higher-revision identical prepared write is not saved twice');
    assert.equal(
        alreadyPrepared.successSink.readbackNamespace.fieldRevisions.continuityCheckpoint,
        6,
    );
    assert.deepEqual(
        alreadyPrepared.context.chatMetadata.mvu_auto_doctor,
        alreadyPrepared.persisted,
    );
});

test('checkpoint-only retry checks unrevisioned own fields and rejects unsafe global revisions', async () => {
    const chatId = 'chat-unrevisioned-authority';
    const baseline = {
        version: 13, chatId, rev: 4,
        actorLedger: { actors: [], actionAttempts: [], actionReceipts: [] },
        continuity: { turn: 0 }, continuityCheckpoint: null,
        unrevisionedAuthority: { value: 'current' },
        fieldRevisions: { actorLedger: 4, continuity: 4, continuityCheckpoint: 4 },
    };
    const prepared = { stage3Phase: 'world_candidate_prepared', preparedWorld: {
        phase1WriteMode: 'checkpoint_only', targetActionAuthorityDigest: 'empty',
    } };
    const persisted = {
        ...structuredClone(baseline),
        unrevisionedAuthority: { value: 'different-durable-authority' },
    };
    let saves = 0;
    const context = {
        chatId,
        chatMetadata: { mvu_auto_doctor: structuredClone(baseline) },
        updateChatMetadata(patch) {
            this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
        },
        async saveMetadata() { saves += 1; },
        async readPersistedChatMetadata() { return structuredClone(persisted); },
    };
    const writer = loadNamespaceWriter(() => context);
    const failureSink = {};
    const saved = await writer.write({
        ...structuredClone(baseline), continuityCheckpoint: prepared,
    }, chatId, {
        fields: ['continuityCheckpoint'], durable: true, force: true,
        requireReadback: true, readbackAttempts: 1,
        allowUnselectedFieldEvolution: true,
        compensateSelectedContentValidationFailure: true,
        failureSink,
        contentValidator: (value) => (
            value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
        ),
    });
    assert.equal(saved, false);
    assert.equal(saves, 1, 'unknown unrevisioned authority performs no local resave');
    assert.equal(failureSink.code, 'host_save_readback_authority_unknown');

    for (const unsafeRevision of [Infinity, -1, 1.5]) {
        const unsafe = structuredClone(baseline);
        unsafe.rev = unsafeRevision;
        let unsafeSaves = 0;
        const unsafeContext = {
            chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(unsafe) },
            updateChatMetadata() {},
            async saveMetadata() { unsafeSaves += 1; },
        };
        const unsafeWriter = loadNamespaceWriter(() => unsafeContext);
        const unsafeFailure = {};
        assert.equal(await unsafeWriter.write(structuredClone(unsafe), chatId, {
            fields: ['continuityCheckpoint'], durable: true, force: true,
            failureSink: unsafeFailure,
        }), false);
        assert.equal(unsafeFailure.code, 'namespace_revision_invalid');
        assert.equal(unsafeSaves, 0, 'unsafe global revision is rejected before host save');
    }
});

test('Phase2 selected transaction polls, locally resaves once, and rejects mixed authority', async () => {
    const run = async (mode) => {
        let behavior = mode;
        const chatId = `chat-phase2-selected-${mode}`;
        const preparedCheckpoint = {
            stage3Phase: 'world_candidate_prepared',
            target: { generationId: 'generation-phase2' },
            preparedWorld: { phase1WriteMode: 'checkpoint_only' },
        };
        const committedCheckpoint = {
            stage3Phase: 'world_committed',
            target: { generationId: 'generation-phase2' },
        };
        const baseline = {
            version: 13, chatId, rev: 11,
            actorSovereigntyScope: { scopeDigest: 'scope-phase2-selected' },
            actorLedger: {
                actors: [{ id: 'p1-ready', profileV6: { status: 'complete', moduleCount: 9 } }],
                actionAttempts: [], actionReceipts: [],
            },
            continuity: { turn: 0 }, continuityCheckpoint: preparedCheckpoint,
            continuityDirector: 'standalone', continuityDetected: true,
            fieldRevisions: {
                actorSovereigntyScope: 1, actorLedger: 9,
                continuity: 7, continuityCheckpoint: 7,
                continuityDirector: 7, continuityDetected: 7,
            },
        };
        const desired = {
            ...structuredClone(baseline),
            continuity: { turn: 1, nextTurnInjection: { status: 'pending' } },
            continuityCheckpoint: committedCheckpoint,
        };
        const selected = [
            'continuity', 'continuityCheckpoint', 'continuityDirector', 'continuityDetected',
        ];
        let persisted = structuredClone(baseline);
        let savedCandidate = null;
        let saves = 0;
        let reads = 0;
        const context = {
            chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(baseline) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            },
            async saveMetadata() {
                saves += 1;
                savedCandidate = structuredClone(this.chatMetadata.mvu_auto_doctor);
                if (behavior === 'normal_persist') {
                    persisted = structuredClone(savedCandidate);
                } else if (behavior === 'stale_three_then_visible') {
                    persisted = structuredClone(savedCandidate);
                } else if (behavior === 'swallowed_then_resaved' && saves === 2) {
                    persisted = structuredClone(savedCandidate);
                } else if (behavior === 'already_committed') {
                    persisted = structuredClone(savedCandidate);
                    persisted.rev += 1;
                    for (const field of selected) persisted.fieldRevisions[field] += 1;
                }
            },
            async readPersistedChatMetadata() {
                reads += 1;
                if (behavior === 'unknown') throw new Error('synthetic durable read failure');
                if (behavior === 'resave_error' && reads > 6) {
                    throw new Error('synthetic retry read failure');
                }
                if (behavior === 'resave_null' && reads > 6) return null;
                if (behavior === 'stale_three_then_visible' && reads <= 3) {
                    return structuredClone(baseline);
                }
                if (behavior === 'mixed_selected' && reads > 5) {
                    const mixed = structuredClone(baseline);
                    mixed.continuity = structuredClone(savedCandidate.continuity);
                    mixed.rev = 13;
                    for (const field of selected) mixed.fieldRevisions[field] = 13;
                    return mixed;
                }
                if (behavior === 'higher_baseline' && reads > 5) {
                    const higher = structuredClone(baseline);
                    higher.rev = 13;
                    for (const field of selected) higher.fieldRevisions[field] = 13;
                    return higher;
                }
                if (behavior === 'authority_drift' && reads > 5) {
                    const drift = structuredClone(baseline);
                    drift.actorLedger.actionAttempts.push({
                        id: 'same-target-authority-attempt',
                        target: { generationId: 'generation-phase2' },
                    });
                    drift.actorLedger.actionReceipts.push({
                        id: 'same-target-authority-drift',
                        target: { generationId: 'generation-phase2' },
                    });
                    drift.rev = 13;
                    drift.fieldRevisions.actorLedger = 13;
                    return drift;
                }
                if (behavior === 'precondition_after_fresh' && reads > 5) {
                    const fresh = structuredClone(baseline);
                    fresh.actorLedger.actors[0].profileV6.moduleCount = 10;
                    fresh.actorLedger.actionAttempts.push({
                        id: 'precondition-fresh-attempt',
                        target: { generationId: 'generation-phase2' },
                    });
                    fresh.actorLedger.actionReceipts.push({
                        id: 'precondition-fresh-receipt',
                        target: { generationId: 'generation-phase2' },
                    });
                    fresh.rev = 13;
                    fresh.fieldRevisions.actorLedger = 13;
                    return fresh;
                }
                if (behavior === 'resave_older_actor' && reads > 6) {
                    const older = structuredClone(baseline);
                    older.actorLedger.actors = [];
                    older.rev = 10;
                    older.fieldRevisions.actorLedger = 8;
                    return older;
                }
                return structuredClone(persisted);
            },
        };
        const writer = loadNamespaceWriter(() => context);
        const failureSink = {};
        const successSink = {};
        const ok = await writer.write(desired, chatId, {
            fields: selected, durable: true, force: true,
            requireReadback: true, readbackAttempts: 5,
            allowUnselectedFieldEvolution: true,
            recoverSelectedTransaction: true,
            failureSink, successSink,
            precondition: mode === 'precondition_before_save'
                ? (() => {
                    let checks = 0;
                    return () => ++checks < 3;
                })()
                : mode === 'precondition_after_fresh'
                    ? (() => reads < 6)
                : null,
            contentValidator: (value) => (
                value?.continuity?.turn === 1
                && value?.continuityCheckpoint?.stage3Phase === 'world_committed'
                && (
                    mode === 'precondition_after_fresh'
                    || (
                        (value?.actorLedger?.actionAttempts?.length || 0) === 0
                        && (value?.actorLedger?.actionReceipts?.length || 0) === 0
                    )
                )
            ),
        });
        return {
            ok, saves, reads, persisted, context, failureSink, successSink, writer,
            setBehavior(value) { behavior = value; },
            getPersisted() { return persisted; },
        };
    };

    const delayed = await run('stale_three_then_visible');
    assert.equal(delayed.ok, true);
    assert.equal(delayed.saves, 1);
    assert.equal(delayed.reads, 4, 'bounded polling observes the original Phase2 save');

    const swallowed = await run('swallowed_then_resaved');
    assert.equal(swallowed.ok, true);
    assert.equal(swallowed.saves, 2, 'one swallowed Phase2 save receives one local re-save');
    assert.equal(swallowed.persisted.continuityCheckpoint.stage3Phase, 'world_committed');
    assert.equal(swallowed.persisted.actorLedger.actors[0].profileV6.moduleCount, 9);

    const already = await run('already_committed');
    assert.equal(already.ok, true);
    assert.equal(already.saves, 1, 'a higher-revision identical commit is accepted without re-save');

    const preSave = await run('precondition_before_save');
    assert.equal(preSave.ok, false);
    assert.equal(preSave.saves, 0, 'a pre-save target failure reaches no durable writer');
    assert.equal(
        preSave.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint.stage3Phase,
        'world_candidate_prepared',
    );

    const staleAfterFresh = await run('precondition_after_fresh');
    assert.equal(staleAfterFresh.ok, false);
    assert.equal(staleAfterFresh.saves, 1, 'fresh-target loss performs no local re-save');
    assert.equal(staleAfterFresh.failureSink.code, 'write_precondition_failed');
    assert.equal(staleAfterFresh.failureSink.readbackFailureKind, 'selected_conflict');
    assert.equal(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor
            .actorLedger.actors[0].profileV6.moduleCount,
        10,
    );
    assert.equal(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor
            .actorLedger.actionAttempts[0].id,
        'precondition-fresh-attempt',
    );
    assert.equal(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor
            .actorLedger.actionReceipts[0].id,
        'precondition-fresh-receipt',
    );
    assert.equal(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor
            .continuityCheckpoint.stage3Phase,
        'world_candidate_prepared',
    );
    assert.equal(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor
            .continuity.nextTurnInjection ?? null,
        null,
    );
    staleAfterFresh.setBehavior('normal_persist');
    const staleDiagnostic = structuredClone(
        staleAfterFresh.context.chatMetadata.mvu_auto_doctor,
    );
    staleDiagnostic.phase2DiagnosticMarker = { status: 'target_stale' };
    assert.equal(await staleAfterFresh.writer.write(staleDiagnostic, staleDiagnostic.chatId, {
        fields: ['phase2DiagnosticMarker'], durable: true, force: true,
        requireReadback: true, readbackAttempts: 1,
    }), true);
    assert.equal(
        staleAfterFresh.getPersisted().actorLedger.actionAttempts[0].id,
        'precondition-fresh-attempt',
    );
    assert.equal(
        staleAfterFresh.getPersisted().actorLedger.actionReceipts[0].id,
        'precondition-fresh-receipt',
    );
    assert.equal(
        staleAfterFresh.getPersisted().continuityCheckpoint.stage3Phase,
        'world_candidate_prepared',
    );

    for (const mode of ['resave_null', 'resave_error', 'resave_older_actor']) {
        const rejected = await run(mode);
        assert.equal(rejected.ok, false, mode);
        assert.equal(rejected.saves, 2, `${mode}: exactly one local re-save`);
        assert.equal(
            rejected.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint.stage3Phase,
            'world_candidate_prepared',
            `${mode}: an unverified committed checkpoint is never exposed`,
        );
        assert.equal(
            rejected.context.chatMetadata.mvu_auto_doctor.continuity.turn,
            0,
            `${mode}: P4 has no committed package to consume`,
        );
        assert.equal(
            rejected.context.chatMetadata.mvu_auto_doctor.continuity.nextTurnInjection ?? null,
            null,
            `${mode}: P4 payload stays absent`,
        );
        assert.equal(
            rejected.context.chatMetadata.mvu_auto_doctor.actorLedger
                .actors[0].profileV6.moduleCount,
            9,
            `${mode}: an older retry readback never replaces safe P1 authority`,
        );
        if (mode === 'resave_null') {
            rejected.setBehavior('normal_persist');
            const diagnosticNext = structuredClone(
                rejected.context.chatMetadata.mvu_auto_doctor,
            );
            diagnosticNext.phase2DiagnosticMarker = { status: 'failed' };
            assert.equal(await rejected.writer.write(diagnosticNext, diagnosticNext.chatId, {
                fields: ['phase2DiagnosticMarker'], durable: true, force: true,
                requireReadback: true, readbackAttempts: 1,
            }), true);
            assert.equal(
                rejected.context.chatMetadata.mvu_auto_doctor
                    .continuityCheckpoint.stage3Phase,
                'world_candidate_prepared',
                'an unrelated diagnostic save cannot publish an unverified commit',
            );
        }
    }

    for (const [mode, expectedCode] of [
        ['mixed_selected', 'host_save_readback_selected_conflict'],
        ['higher_baseline', 'host_save_readback_selected_conflict'],
        ['authority_drift', 'host_save_content_validation_conflict'],
        ['unknown', 'host_save_readback_read_error'],
    ]) {
        const rejected = await run(mode);
        assert.equal(rejected.ok, false, mode);
        assert.equal(rejected.saves, 1, `${mode}: no second host save`);
        assert.equal(rejected.failureSink.code, expectedCode, mode);
        assert.equal(
            rejected.context.chatMetadata.mvu_auto_doctor.actorLedger
                .actors[0].profileV6.moduleCount,
            9,
            `${mode}: P1 authority survives`,
        );
        if (mode === 'authority_drift') {
            assert.equal(
                rejected.context.chatMetadata.mvu_auto_doctor
                    .actorLedger.actionAttempts[0].id,
                'same-target-authority-attempt',
            );
            assert.equal(
                rejected.context.chatMetadata.mvu_auto_doctor
                    .actorLedger.actionReceipts[0].id,
                'same-target-authority-drift',
            );
            assert.equal(
                rejected.context.chatMetadata.mvu_auto_doctor
                    .continuityCheckpoint.stage3Phase,
                'world_candidate_prepared',
            );
            assert.equal(
                rejected.context.chatMetadata.mvu_auto_doctor
                    .continuity.nextTurnInjection ?? null,
                null,
            );
            rejected.setBehavior('normal_persist');
            const diagnosticNext = structuredClone(
                rejected.context.chatMetadata.mvu_auto_doctor,
            );
            diagnosticNext.phase2DiagnosticMarker = { status: 'authority_conflict' };
            assert.equal(await rejected.writer.write(diagnosticNext, diagnosticNext.chatId, {
                fields: ['phase2DiagnosticMarker'], durable: true, force: true,
                requireReadback: true, readbackAttempts: 1,
            }), true);
            assert.equal(
                rejected.getPersisted().actorLedger.actionAttempts[0].id,
                'same-target-authority-attempt',
                'later diagnostic persistence retains the fresh ATT authority',
            );
            assert.equal(
                rejected.getPersisted().actorLedger.actionReceipts[0].id,
                'same-target-authority-drift',
                'later diagnostic persistence retains the fresh receipt authority',
            );
            assert.equal(
                rejected.getPersisted().continuityCheckpoint.stage3Phase,
                'world_candidate_prepared',
            );
        }
    }
});

test('production Phase2 writer accepts concurrent P1-only ledger evolution but rejects same-target authority drift', async () => {
    const target = {
        chatId: 'chat-phase2-p1-evolution', index: 1, messageId: 'message-1', swipeId: 0,
        generationSerial: 1, generationId: 'generation-1', generationType: 'normal',
        scopeDigest: 'scope-phase2-p1-evolution', contentFingerprint: 'content-1',
    };
    const persistedPackage = loadStage3PersistedPackageValidator({
        ledgerDigest: (ledger) => JSON.stringify(ledger),
    });
    const modelTimeLedger = {
        actors: [], actionAttempts: [], actionReceipts: [],
    };
    const proof = persistedPackage.stage3CanonicalSettlementProof(
        modelTimeLedger,
        [],
        target,
    );
    const withoutPacket = {
        chatId: target.chatId, turn: 1, lastSource: structuredClone(target),
        nextTurnInjection: null,
    };
    const committedContinuity = {
        ...structuredClone(withoutPacket),
        nextTurnInjection: {
            version: 1, status: 'pending', producerTarget: structuredClone(target),
            sourceContinuityDigest:
                persistedPackage.stage3ContinuityDigestWithoutInjection(withoutPacket),
            payload: { text: 'bounded world projection', visibleThreadIds: [] },
            settlementProof: proof,
        },
    };
    const preparedCheckpoint = {
        stage3Phase: 'world_candidate_prepared', target: structuredClone(target),
        stage3ProducerTarget: structuredClone(target),
        preparedWorld: { phase1WriteMode: 'checkpoint_only' },
    };
    const committedCheckpoint = {
        stage3Phase: 'world_committed', target: structuredClone(target),
        stage3ProducerTarget: structuredClone(target),
    };
    const baseline = {
        version: 13, chatId: target.chatId, rev: 7,
        actorSovereigntyScope: { scopeDigest: target.scopeDigest },
        actorLedger: structuredClone(modelTimeLedger),
        continuity: { chatId: target.chatId, turn: 0, nextTurnInjection: null },
        continuityCheckpoint: preparedCheckpoint,
        continuityDirector: 'standalone', continuityDetected: true,
        fieldRevisions: {
            actorSovereigntyScope: 1, actorLedger: 6, continuity: 7,
            continuityCheckpoint: 7, continuityDirector: 7, continuityDetected: 7,
        },
    };
    const p1Evolved = structuredClone(baseline);
    p1Evolved.rev = 8;
    p1Evolved.fieldRevisions.actorLedger = 8;
    p1Evolved.actorLedger.actors.push({
        id: 'p1-profile', profileV6: { status: 'complete', moduleCount: 9 },
    });
    const selected = [
        'continuity', 'continuityCheckpoint', 'continuityDirector', 'continuityDetected',
    ];
    const desired = {
        ...structuredClone(baseline),
        continuity: committedContinuity,
        continuityCheckpoint: committedCheckpoint,
    };
    const contentValidator = (namespace) => (
        namespace?.continuityCheckpoint?.stage3Phase === 'world_committed'
        && !!persistedPackage.stage3PersistedPackageForTarget(
            namespace?.continuity,
            namespace?.actorLedger,
            target,
            { allowUnrelatedLedgerEvolution: true },
        )
    );
    const run = async (current) => {
        let durable = structuredClone(current);
        const context = {
            chatId: target.chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(current) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            },
            async saveMetadata() {
                durable = structuredClone(this.chatMetadata.mvu_auto_doctor);
            },
            async readPersistedChatMetadata() { return structuredClone(durable); },
        };
        const writer = loadNamespaceWriter(() => context);
        const failureSink = {};
        const ok = await writer.write(desired, target.chatId, {
            fields: selected, durable: true, force: true,
            requireReadback: true, readbackAttempts: 1,
            allowUnselectedFieldEvolution: true,
            recoverSelectedTransaction: true,
            failureSink,
            contentValidator,
        });
        return { ok, context, durable, failureSink };
    };

    assert.equal(
        persistedPackage.stage3PersistedPackageForTarget(
            committedContinuity,
            p1Evolved.actorLedger,
            target,
        ),
        null,
        'the old strict whole-ledger check reproduces the false conflict',
    );
    const accepted = await run(p1Evolved);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.failureSink.code, '');
    assert.equal(accepted.durable.continuityCheckpoint.stage3Phase, 'world_committed');
    assert.equal(accepted.durable.actorLedger.actors[0].profileV6.moduleCount, 9);

    const sameTargetDrift = structuredClone(p1Evolved);
    sameTargetDrift.actorLedger.actionAttempts.push({
        id: 'same-target-drift', target: structuredClone(target), status: 'held',
    });
    sameTargetDrift.rev = 9;
    sameTargetDrift.fieldRevisions.actorLedger = 9;
    const rejected = await run(sameTargetDrift);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.failureSink.code, 'host_save_content_validation_conflict');
    assert.equal(
        rejected.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint.stage3Phase,
        'world_candidate_prepared',
    );
    assert.equal(
        rejected.context.chatMetadata.mvu_auto_doctor.actorLedger.actionAttempts[0].id,
        'same-target-drift',
        'fail-closed recovery preserves the newer actor authority',
    );
});

test('Phase2 host-save failures use fixed phase-specific diagnostic codes', () => {
    const code = sourceSection(
        'function stage3Phase2ReadbackValidationCode(failureSink) {',
        'async function runContinuityTarget(captured, {',
    );
    const sandbox = {};
    vm.runInNewContext(
        `${code}\nthis.mapPhase2 = stage3Phase2ReadbackValidationCode;`,
        sandbox,
    );
    assert.equal(
        sandbox.mapPhase2({ code: 'host_save_readback_revision_behind' }),
        'world.phase2.host_save_revision_behind',
    );
    assert.equal(
        sandbox.mapPhase2({ code: 'host_save_readback_selected_conflict' }),
        'world.phase2.host_save_selected_conflict',
    );
    assert.equal(
        sandbox.mapPhase2({ code: 'host_save_content_validation_conflict' }),
        'world.phase2.host_save_authority_conflict',
    );
});

test('checkpoint-only Phase1 classifies durable readback lag, conflict, missing and read error', async () => {
    const make = ({ mode }) => {
        const chatId = `chat-readback-${mode}`;
        const baseline = {
            version: 13, chatId, rev: 4,
            actorLedger: { actors: [], actionAttempts: [], actionReceipts: [] },
            continuity: { turn: 0 }, continuityCheckpoint: null,
            fieldRevisions: { actorLedger: 4, continuity: 4, continuityCheckpoint: 4 },
        };
        const prepared = { stage3Phase: 'world_candidate_prepared', preparedWorld: {
            phase1WriteMode: 'checkpoint_only', targetActionAuthorityDigest: 'empty',
        } };
        let persisted = structuredClone(baseline);
        let saveCalls = 0;
        const competing = { stage3Phase: 'world_candidate_prepared', preparedWorld: {
            phase1WriteMode: 'checkpoint_only', targetActionAuthorityDigest: 'competing',
        } };
        const context = {
            chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(baseline) },
            updateChatMetadata(patch) {
                this.chatMetadata = { ...this.chatMetadata, ...structuredClone(patch) };
            },
            async saveMetadata() {
                saveCalls += 1;
                if (mode === 'already_persisted') persisted = structuredClone(
                    this.chatMetadata.mvu_auto_doctor,
                );
            },
            async readPersistedChatMetadata() {
                if (mode === 'read_error') throw new Error('synthetic read error');
                if (mode === 'namespace_missing') return null;
                if (mode === 'selected_conflict') {
                    persisted.continuityCheckpoint = structuredClone(competing);
                    persisted.rev = 6;
                    persisted.fieldRevisions.continuityCheckpoint = 6;
                }
                return structuredClone(persisted);
            },
        };
        return { baseline, prepared, competing, context, persisted: () => persisted, saves: () => saveCalls };
    };

    for (const [mode, expectedCode, expectedKind] of [
        ['revision_behind', 'host_save_readback_revision_behind', 'revision_behind'],
        ['namespace_missing', 'host_save_readback_namespace_missing', 'namespace_missing'],
        ['read_error', 'host_save_readback_read_error', 'read_error'],
        ['selected_conflict', 'host_save_readback_selected_conflict', 'selected_conflict'],
    ]) {
        const fixture = make({ mode });
        const writer = loadNamespaceWriter(() => fixture.context);
        const failureSink = {};
        const saved = await writer.write({
            ...structuredClone(fixture.baseline),
            continuityCheckpoint: fixture.prepared,
        }, fixture.baseline.chatId, {
            fields: ['continuityCheckpoint'], durable: true, force: true,
            requireReadback: true, readbackAttempts: 1,
            allowUnselectedFieldEvolution: true,
            compensateSelectedContentValidationFailure: true,
            failureSink,
            contentValidator: (value) => (
                value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
                && value?.continuityCheckpoint?.preparedWorld?.targetActionAuthorityDigest
                    === 'empty'
            ),
        });
        assert.equal(saved, false, mode);
        assert.equal(failureSink.code, expectedCode, mode);
        assert.equal(failureSink.readbackFailureKind, expectedKind, mode);
        assert.equal(writer.metrics.rolledBackWrites, 0, `${mode}: no stale whole rollback`);
        if (mode === 'selected_conflict') {
            assert.deepEqual(
                fixture.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
                fixture.competing,
                'competing durable checkpoint remains authoritative',
            );
        } else if (mode === 'revision_behind') {
            assert.equal(
                fixture.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint,
                null,
                'a proven durable baseline is restored as authority after retry exhaustion',
            );
        } else {
            assert.equal(
                fixture.context.chatMetadata.mvu_auto_doctor.continuityCheckpoint.stage3Phase,
                'world_candidate_prepared',
                `${mode}: unknown save outcome retains recoverable prepared memory`,
            );
        }
    }

    const already = make({ mode: 'already_persisted' });
    const actualRead = already.context.readPersistedChatMetadata.bind(already.context);
    let reads = 0;
    already.context.readPersistedChatMetadata = async () => {
        reads += 1;
        if (reads === 1) return structuredClone(already.baseline);
        return actualRead();
    };
    const writer = loadNamespaceWriter(() => already.context);
    const saved = await writer.write({
        ...structuredClone(already.baseline), continuityCheckpoint: already.prepared,
    }, already.baseline.chatId, {
        fields: ['continuityCheckpoint'], durable: true, force: true,
        requireReadback: true, readbackAttempts: 1,
        allowUnselectedFieldEvolution: true,
        compensateSelectedContentValidationFailure: true,
        contentValidator: (value) => (
            value?.continuityCheckpoint?.stage3Phase === 'world_candidate_prepared'
        ),
    });
    assert.equal(saved, true, 'fresh durable read proves the first save without a second write');
    assert.equal(already.saves(), 1);
});

test('unselected-field readback allowance rejects non-finite or negative revisions', () => {
    const writer = loadNamespaceWriter(() => null);
    const candidate = {
        chatId: 'chat-revision-domain',
        rev: 4,
        fieldRevisions: { continuityCheckpoint: 4 },
    };
    const persisted = {
        ...structuredClone(candidate),
        rev: 5,
    };
    assert.equal(writer.matches(candidate, persisted, ['continuityCheckpoint'], {
        allowUnselectedFieldEvolution: true,
    }), true);
    for (const invalid of [-1, Infinity, -Infinity, Number.NaN, 1.5]) {
        assert.equal(writer.matches(candidate, {
            ...persisted,
            rev: invalid,
        }, ['continuityCheckpoint'], {
            allowUnselectedFieldEvolution: true,
        }), false);
        assert.equal(writer.matches(candidate, {
            ...persisted,
            fieldRevisions: { continuityCheckpoint: invalid },
        }, ['continuityCheckpoint'], {
            allowUnselectedFieldEvolution: true,
        }), false);
    }
});

test('namespace wrapper exposes actor-only stale revision from its async scope window', async () => {
    const scope = { chatId: 'chat-wrapper-race', cardId: 'card', runtimeVersion: 'test' };
    const initial = {
        version: 13,
        chatId: scope.chatId,
        rev: 4,
        actorSovereigntyScope: structuredClone(scope),
        actorLedger: { actors: [{ id: 'actor-before-p1' }] },
        continuityCheckpoint: null,
        fieldRevisions: { actorLedger: 4, continuityCheckpoint: 4 },
    };
    const state = {
        scope,
        context: {
            chatId: scope.chatId,
            chatMetadata: { mvu_auto_doctor: structuredClone(initial) },
        },
        concurrentP1Write: async () => {
            const live = state.context.chatMetadata.mvu_auto_doctor;
            live.actorLedger = { actors: [{ id: 'actor-after-p1', profileV6: { status: 'complete' } }] };
            live.rev = 5;
            live.fieldRevisions.actorLedger = 5;
        },
    };
    const write = loadNamespaceWriteWrapperRaceHarness(state);
    const failureSink = {};
    const saved = await write(structuredClone(initial), scope.chatId, {
        fields: ['actorLedger', 'continuityCheckpoint'],
        failureSink,
    });
    assert.equal(saved, false);
    assert.equal(failureSink.code, 'stale_namespace_revision');
    assert.deepEqual([...failureSink.staleFields], ['actorLedger']);

    state.context.chatMetadata.mvu_auto_doctor = structuredClone(initial);
    const wrappedProductionWriter = loadNamespaceWriteWrapperRaceHarness(state);
    const productionWriter = loadProductionActionAttemptWriter(
        () => state.context,
        wrappedProductionWriter,
    );
    const preparedCheckpoint = {
        stage3Phase: 'world_candidate_prepared',
        preparedWorld: { phase1WriteMode: 'actor_attempts' },
    };
    const productionResult = await productionWriter.persist({
        chatId: scope.chatId,
        scopeDigest: 'scope-digest',
    }, {
        previousLedger: structuredClone(initial.actorLedger),
        nextLedger: { actors: [{ id: 'actor-with-world-attempt' }] },
        attempts: [{ id: 'attempt-1' }],
        target: { chatId: scope.chatId, index: 1 },
        preparedCheckpoint,
        phase1WriteMode: 'actor_attempts',
        expectedFieldStates: {
            actorLedger: { revision: 4, digest: JSON.stringify(initial.actorLedger) },
            continuityCheckpoint: { revision: 4, digest: JSON.stringify(null) },
        },
    });
    assert.equal(productionResult.ok, false);
    assert.equal(productionResult.reason, 'action_attempt.commit_rejected');
    assert.equal(productionResult.failureCode, 'stale_namespace_revision');
    assert.deepEqual([...productionResult.concurrentFields], ['actorLedger']);

    const persistence = sourceSection(
        'async function persistActorActionAttemptsForTurn(captured, {',
        'async function completeActorProfilesForTurn(captured, {',
    );
    assert.match(
        persistence,
        /failureSink\.code === 'stale_namespace_revision'[\s\S]*?failureSink\.staleFields/u,
    );
    for (const helper of [
        sourceSection(
            'async function stage3PersistPreparedActorAttemptsOnFreshLedger(captured, {',
            'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
        ),
        sourceSection(
            'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
            'function stage3PreparedWorldCheckpointMatches(',
        ),
        sourceSection(
            'async function commitPreparedWorldCandidate(captured, {',
            'async function enqueueActorProfiles(targetId, {',
        ),
    ]) {
        assert.match(helper, /\['field_state_mismatch', 'stale_namespace_revision'\]/u);
        assert.match(helper, /concurrentFields\?*\.length === 1/u);
        assert.match(helper, /concurrentFields\[0\] === 'actorLedger'/u);
    }
});

test('attemptless P3 rebases a concurrent P1 profile commit without rerunning Advance', async () => {
    const harness = loadAttemptlessPhase1RebaseHarness({
        failureCode: 'stale_namespace_revision',
    });
    const result = await harness.run();
    assert.equal(result.ok, true);
    assert.equal(result.localAttempts, 2);
    assert.equal(harness.persistCalls(), 2);
    assert.equal(result.persisted.ledger.actors[0].profileV6.status, 'complete');
    assert.deepEqual(result.persisted.ledger.actionAttempts, []);
    assert.equal(
        result.persisted.checkpoint.preparedWorld.ledger.profileRevision,
        3,
        'prepared proof binds the fresh P1 ledger, not the pre-model snapshot',
    );
    const helper = sourceSection(
        'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
        'function stage3PreparedWorldCheckpointMatches(',
    );
    assert.doesNotMatch(helper, /generateWorldContinuitySingleBatch|callModel|world_call_reserved/u);
    assert.match(helper, /localAttempt < 2/u);
    assert.match(helper, /stage3TargetActionAuthorityProjection\([\s\S]*?freshLedger/u);
});

test('scheduled P3 replays only its frozen actor attempt onto the fresh P1 ledger', async () => {
    const harness = loadScheduledPhase1RebaseHarness();
    const result = await harness.run();
    assert.equal(result.ok, true);
    assert.equal(result.localAttempts, 2);
    assert.equal(harness.persistCalls(), 2);
    assert.deepEqual(
        result.persisted.ledger.actionAttempts.map((attempt) => attempt.actorId),
        ['actor-old'],
        'the actor that became ready during Advance is not autonomously scheduled this turn',
    );
    assert.equal(
        result.persisted.ledger.actors.find((actor) => actor.id === 'actor-new-ready')
            .profileV6.status,
        'complete',
        'the concurrent P1 profile commit is retained',
    );
});

test('scheduled Phase1 locally changes an unadmitted fresh proposal into an attemptless safe hold', async () => {
    const harness = loadScheduledPhase1RebaseHarness({ rejectPreparedAttempt: true });
    const result = await harness.run();
    assert.equal(result.ok, true);
    assert.equal(result.recordedCount, 0);
    assert.deepEqual(Array.from(result.deferredActorIds), ['actor-old']);
    assert.equal(harness.persistCalls(), 0, 'no rejected ATT candidate is written');
    assert.equal(harness.attemptlessCalls(), 1, 'the safe no-change checkpoint is written once');
});

test('unresolved attemptless Phase1 CAS drift stays zero-write with a fixed code', async () => {
    const harness = loadAttemptlessPhase1RebaseHarness({ alwaysReject: true });
    const result = await harness.run();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'action_attempt.commit_rejected');
    assert.equal(harness.persistCalls(), 2);
    const map = sourceSection(
        'function stage3WorldFailureValidationCode(reason)',
        'async function runContinuityTarget(captured, {',
    );
    assert.match(map, /'action_attempt\.commit_rejected': 'world\.phase1\.concurrent_actor_ledger_changed'/u);
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.match(run, /stage3PersistAttemptlessPreparedWorldCandidate/u);
    assert.match(run, /validationCode: rebased\.validationCode/u);
});

test('Phase1 readback diagnostics distinguish host verification from candidate authority', async () => {
    const hostMismatch = loadAttemptlessPhase1RebaseHarness({
        alwaysReject: true,
        failureCode: 'host_save_readback_mismatch',
        failureReason: 'action_attempt.readback_mismatch',
    });
    const hostResult = await hostMismatch.run();
    assert.equal(hostResult.validationCode, 'world.phase1.host_save_readback_mismatch');

    const candidateMismatch = loadAttemptlessPhase1RebaseHarness({
        alwaysReject: true,
        failureCode: '',
        failureReason: 'action_attempt.readback_mismatch',
    });
    const candidateResult = await candidateMismatch.run();
    assert.equal(candidateResult.validationCode, 'world.phase1.candidate_readback_mismatch');

    for (const failureCode of [
        'host_save_content_validation_compensated',
        'host_save_content_validation_conflict',
    ]) {
        const contentAuthorityMismatch = loadAttemptlessPhase1RebaseHarness({
            alwaysReject: true,
            failureCode,
            failureReason: 'action_attempt.readback_mismatch',
        });
        const contentResult = await contentAuthorityMismatch.run();
        assert.equal(
            contentResult.validationCode,
            'world.phase1.candidate_readback_mismatch',
            `${failureCode} is an authority mismatch, not a host readback failure`,
        );
    }
    const compensationReadbackUnknown = loadAttemptlessPhase1RebaseHarness({
        alwaysReject: true,
        failureCode: 'host_save_content_validation_readback_unknown',
        failureReason: 'action_attempt.readback_mismatch',
    });
    assert.equal(
        (await compensationReadbackUnknown.run()).validationCode,
        'world.phase1.host_save_readback_unknown',
    );

    const scheduled = sourceSection(
        'async function stage3PersistPreparedActorAttemptsOnFreshLedger(captured, {',
        'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
    );
    assert.match(scheduled, /stage3Phase1ReadbackValidationCode\(persisted\)/u);
});

test('production Phase1 rebase gate rejects semantic or same-target authority drift before writing', async () => {
    const cases = [
        ['continuity digest', { continuity: { turn: 1, changed: true } }],
        ['checkpoint digest', { continuityCheckpoint: { stage3Phase: 'other-target' } }],
        ['same-target ATT', {
            freshActionAttempts: [{ id: 'same-target-attempt', target: { generationId: 'generation-2' } }],
        }],
        ['same-target receipt', {
            freshActionReceipts: [{ id: 'same-target-receipt', target: { generationId: 'generation-2' } }],
        }],
    ];
    for (const [label, options] of cases) {
        const harness = loadAttemptlessPhase1RebaseHarness(options);
        const result = await harness.run();
        assert.equal(result.ok, false, label);
        assert.equal(harness.persistCalls(), 0, `${label} writes no prepared checkpoint`);
        assert.ok([
            'world_candidate_readback_mismatch',
            'action_attempt.concurrent_change',
        ].includes(result.reason), label);
    }
});

test('P3 normal path writes nothing before Recall, Advance, parse, and full in-memory validation', () => {
    const run = sourceSection(
        'async function runContinuityTarget(captured, {',
        'function sameTargetExceptContent(left, right)',
    );
    assert.doesNotMatch(run, /callModel\(/u);
    assert.doesNotMatch(run, /buildContinuityRepairMessages/u);
    const recallAt = run.indexOf('stage3LocalRecallPacket({');
    const reserveAt = run.indexOf("stage3Phase: 'world_call_reserved'");
    const snapshotAt = run.indexOf('let phase1Namespace = readChatNamespace');
    const worldAt = run.indexOf('await generateWorldContinuitySingleBatch', recallAt);
    const draftValidatorAt = run.indexOf('stage3ValidateWorldDraftInMemory', worldAt);
    const proposalAt = run.indexOf('stage3PersistPreparedActorAttemptsOnFreshLedger', worldAt);
    const preparedAt = run.indexOf("stage3Phase: 'world_candidate_prepared'");
    assert.ok(snapshotAt >= 0 && recallAt > snapshotAt && worldAt > recallAt);
    assert.equal(reserveAt, -1, 'normal execution never persists world_call_reserved');
    assert.ok(draftValidatorAt > worldAt && proposalAt > draftValidatorAt);
    const scheduledRebase = sourceSection(
        'async function stage3PersistPreparedActorAttemptsOnFreshLedger(captured, {',
        'async function stage3PersistAttemptlessPreparedWorldCandidate(captured, {',
    );
    const prepareAt = scheduledRebase.indexOf('prepareActorActionAttempts');
    const recordAt = scheduledRebase.indexOf('recordActorActionAttempts', prepareAt);
    const validateAt = scheduledRebase.indexOf('stage3ValidateWorldCandidateInMemory', recordAt);
    const persistAt = scheduledRebase.indexOf('await persistActorActionAttemptsForTurn', recordAt);
    assert.ok(prepareAt >= 0 && recordAt > prepareAt);
    assert.ok(validateAt > recordAt && persistAt > validateAt);
    assert.match(scheduledRebase, /phase1WriteMode: 'actor_attempts'/u);
    assert.match(scheduledRebase, /stage3PreparedWorldCheckpoint\(/u);
    assert.match(scheduledRebase, /stage3PreparedWorldCheckpointMatches\(/u);
    assert.ok(preparedAt < 0, 'checkpoint state is created by the pure helper, not duplicated in the runner');
    assert.match(run, /return commitPreparedWorldCandidate\(captured/u);
    assert.match(run, /validateCandidateInMemory/u);
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

test('production Phase2 zero-model recovery neutralizes a legacy prepared director and reaches committed readback', async () => {
    const producerTarget = {
        chatId: 'chat-phase2', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 2, generationId: 'generation-2', generationType: 'normal',
        scopeDigest: 'scope-phase2', contentFingerprint: 'content-phase2',
    };
    const actionTarget = { ...producerTarget };
    const scheduledBase = { turn: 2, threads: [], world: { digest: 'before' } };
    const candidateNext = { turn: 2, threads: [], world: { digest: 'after' } };
    const checkpoint = {
        stage3Phase: 'world_candidate_prepared',
        preparedWorld: {
            scheduledState: structuredClone(scheduledBase), continuityState: {}, world: {},
            actionAdjudications: [], nextTurn: 2, director: 'stitches', checkpointState: {},
            phase1WriteMode: 'checkpoint_only',
        },
    };
    const namespace = { actorLedger: {}, continuity: {}, continuityCheckpoint: checkpoint };
    const freshNamespace = {
        actorLedger: { actors: [{ id: 'p1-ready', profileV6: { status: 'complete' } }] },
        continuity: {}, continuityCheckpoint: checkpoint,
    };
    let attachedFrom = null;
    let written = null;
    let phase2Writes = 0;
    let packageValidationOptions = null;
    let injectionOptions = null;
    const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    const sandbox = {
        Date,
        pendingActorActionAttempts: () => ({ attempts: [], candidates: [] }),
        actorActionTargetOf: () => structuredClone(actionTarget),
        stage3PreparedPhase1StatesMatch: () => true,
        stage3FieldState: () => ({ revision: 1, digest: 'stable' }),
        stage3ValidateWorldCandidateInMemory: () => ({
            ok: true, settlement: null,
            scheduledBase: structuredClone(scheduledBase),
            next: structuredClone(candidateNext),
        }),
        markActorSchedulingFailure: () => {},
        attachChangedSourceRefs: (base, next) => {
            attachedFrom = structuredClone(base);
            return structuredClone(next);
        },
        sourceRefOf: () => structuredClone(producerTarget),
        normalizeContinuityState: (value) => structuredClone(value),
        stage3CanonicalSettlementProof: () => ({ orderedResults: [] }),
        stage3AcceptedTarget: () => structuredClone(producerTarget),
        stage3ContinuityDigestWithoutInjection: () => 'continuity-digest',
        buildContinuityPacketText: (_state, options) => {
            injectionOptions = structuredClone(options);
            return '';
        },
        continuityPacketPayloadDigest: () => 'continuity-payload:test',
        deepClone: (value) => structuredClone(value),
        stage3TaskOwnsCurrent: () => true,
        stage3TargetIsCurrent: () => ({ ok: true }),
        actorActionTargetMatches: exact,
        stage3AcceptedTargetsMatch: exact,
        stage3ActorLedgerAfterProfileOnlyEvolution: ({ freshLedger }) => ({
            ok: true,
            ledger: structuredClone(freshLedger || {}),
        }),
        capturedTargetKey: () => 'phase2-world-target',
        actorProfilePendingKeys: new Map(),
        actorProfileChain: Promise.resolve(),
        readChatNamespace: () => structuredClone(freshNamespace),
        getContext: () => ({ chatId: producerTarget.chatId }),
        normalizeActorLedger: (value) => structuredClone(value),
        stage3PersistedPackageForTarget: (_continuity, _ledger, _captured, options) => {
            packageValidationOptions = structuredClone(options || {});
            return { settlementProof: { orderedResults: [] } };
        },
        actorActionSettlementsMatchLedger: () => ({ ok: true }),
        writeChatNamespace: async (candidate, _chatId, options) => {
            phase2Writes += 1;
            assert.equal(options.readbackAttempts, 5);
            assert.equal(options.allowUnselectedFieldEvolution, true);
            assert.equal(options.recoverSelectedTransaction, true);
            assert.equal(options.retainOnFailure, undefined);
            if (phase2Writes === 1) {
                options.failureSink.code = 'stale_namespace_revision';
                options.failureSink.staleFields = ['actorLedger'];
                return false;
            }
            written = structuredClone(candidate);
            return options.precondition() === true && options.contentValidator(candidate) === true;
        },
        markActorSchedulingSettled: () => {},
    };
    const code = sourceSection(
        'async function commitPreparedWorldCandidate(captured, {',
        'async function enqueueActorProfiles(targetId, {',
    );
    const phase2DiagnosticCode = sourceSection(
        'function stage3Phase2ReadbackValidationCode(failureSink) {',
        'async function runContinuityTarget(captured, {',
    );
    vm.runInNewContext(
        `${phase2DiagnosticCode}\n${code}\nthis.commit = commitPreparedWorldCandidate;`,
        sandbox,
    );
    const result = await sandbox.commit(producerTarget, {
        token: {}, settings: { continuityMaxThreads: 64, continuityMaxVisible: 4 },
        namespace, checkpoint, ledger: {}, worldModelCalls: 0,
    });
    assert.deepEqual(attachedFrom, scheduledBase);
    assert.equal(written.continuityCheckpoint.stage3Phase, 'world_committed');
    assert.equal(written.continuityDirector, 'doctor');
    assert.equal(written.continuity.nextTurnInjection.payloadFormat, 'canonical-bounded-v1');
    assert.equal(written.continuity.nextTurnInjection.payloadDigest, 'continuity-payload:test');
    assert.equal(written.actorLedger.actors[0].profileV6.status, 'complete');
    assert.equal(injectionOptions.director, 'doctor');
    assert.equal(packageValidationOptions.allowUnrelatedLedgerEvolution, true);
    assert.equal(phase2Writes, 2, 'Phase2 locally rebases one P1-only CAS drift');
    assert.equal(result.status, 'applied');
    assert.equal(result.worldFinalPhase, 'world_committed');
    assert.equal(result.worldModelCalls, 0);
    assert.equal(result.recovered, true);
    assert.equal(result.director, 'doctor');

    phase2Writes = 0;
    written = null;
    sandbox.writeChatNamespace = async (_candidate, _chatId, options) => {
        phase2Writes += 1;
        assert.equal(options.recoverSelectedTransaction, true);
        options.failureSink.code = 'stale_namespace_revision';
        options.failureSink.staleFields = ['actorLedger'];
        return false;
    };
    const exhausted = await sandbox.commit(producerTarget, {
        token: {}, settings: { continuityMaxThreads: 64, continuityMaxVisible: 4 },
        namespace, checkpoint, ledger: {}, worldModelCalls: 0,
    });
    assert.equal(phase2Writes, 2, 'Phase2 actor-only CAS retry is bounded');
    assert.equal(written, null, 'retry exhaustion commits no world candidate');
    assert.equal(exhausted.status, 'failed');
    assert.equal(exhausted.reason, 'world_phase2_actor_ledger_changed');
    assert.equal(exhausted.validationCode, 'world.phase2.concurrent_actor_ledger_changed');

    sandbox.writeChatNamespace = async (_candidate, _chatId, options) => {
        options.failureSink.code = 'host_save_readback_read_error';
        options.failureSink.readbackFailureKind = 'read_error';
        options.failureSink.readbackEvidence = [{
            field: 'continuityCheckpoint', expectedRevision: 8,
            actualRevision: -1, digestMatch: false,
        }];
        return false;
    };
    const hostFailed = await sandbox.commit(producerTarget, {
        token: {}, settings: { continuityMaxThreads: 64, continuityMaxVisible: 4 },
        namespace, checkpoint, ledger: {}, worldModelCalls: 0,
    });
    assert.equal(hostFailed.status, 'failed');
    assert.equal(hostFailed.validationCode, 'world.phase2.host_save_read_error');
    assert.equal(hostFailed.worldFinalPhase, 'world_candidate_prepared');
    assert.equal(hostFailed.readbackFailureKind, 'read_error');
    assert.equal(hostFailed.readbackEvidence[0].field, 'continuityCheckpoint');
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

test('P3 source retains every scheduled ActorRef inside a bounded model projection', () => {
    const advance = sourceSection('function buildContinuityMessages({', 'async function generateWorldContinuitySingleBatch(');
    const recall = sourceSection('function stage3LocalRecallPacket({', 'function stage3WorldbookPromptMaterial(');
    assert.match(advance, /recalledActors = \[\.\.\.\(actorLedger\?\.actors \|\| \[\]\)\]/u);
    assert.match(advance, /world_recall_missing_scheduled_actor_material/u);
    assert.doesNotMatch(advance, /world_recall_capacity_unavailable/u);
    assert.match(advance, /STAGE3_WORLD_MODEL_INPUT_MAX_CHARS/u);
    assert.doesNotMatch(advance, /requiredMaterial\.length\s*>/u);
    assert.doesNotMatch(advance, /recalledActors\.slice\(/u);
    assert.doesNotMatch(recall, /world_recall_capacity_unavailable/u);
    assert.doesNotMatch(recall, /recallBudget/u);
    assert.doesNotMatch(recall, /callModel\(|cropText\(/u);
    const runner = sourceSection('async function runContinuityTarget(captured, {', 'function sameTargetExceptContent(left, right)');
    assert.match(
        runner,
        /scheduledActors = actorSchedule\.selected;[\s\S]*?scheduledActorIds = scheduledActors\.map\(\(actor\) => actor\.actorId\)\.filter\(Boolean\)/u,
    );
    assert.doesNotMatch(runner, /actor_schedule_empty/u);
});

test('P3 local recall preserves every scheduled ID and adds linked structured support', () => {
    const buildRecall = loadStage3LocalRecallPacket();
    const options = {
        mustActorIds: ['actor-must'],
        mustThreadIds: ['thread-must'],
        mustLaneIds: ['lane-must'],
        acceptedNarrative: '人物甲提到了甲地的规则',
        worldbookKeys: ['world-b', 'world-a', 'world-a'],
        worldbookEntries: [
            { id: 'entry-b', world: 'embedded', title: '规则乙', keys: ['乙'], constant: true, content: '完整规则乙' },
            { id: 'entry-a', world: 'embedded', title: '规则甲', keys: ['甲'], content: '完整规则甲' },
            { id: 'entry-unrelated', world: 'embedded', title: '无关规则', keys: ['永不命中'], content: '无关内容' },
        ],
        actorLedger: { actors: [
            { id: 'actor-must', name: '人物甲' },
            { id: 'actor-known', name: '人物乙' },
        ] },
        base: { threads: [
            { id: 'thread-must', stage: 'advancing', actors: [] },
            { id: 'thread-linked', stage: 'advancing', actors: ['actor-must'] },
            { id: 'thread-lane', stage: 'advancing', actors: [] },
            { id: 'thread-unrelated', stage: 'advancing', actors: [] },
            { id: 'thread-resolved', stage: 'resolved', actors: ['actor-must'] },
        ] },
        worldLaneSchedule: { candidates: [
            { sourceId: 'lane-must', sourceThreads: ['thread-lane'] },
            { sourceId: 'lane-known', sourceThreads: ['thread-unrelated'] },
        ] },
    };
    const packet = buildRecall(options);
    assert.ok(packet);
    assert.equal(packet.version, 2);
    assert.equal(packet.selection, 'local_structured_schedule');
    assert.deepEqual(Array.from(packet.actorIds), ['actor-must']);
    assert.deepEqual(Array.from(packet.threadIds), ['thread-lane', 'thread-linked', 'thread-must']);
    assert.deepEqual(Array.from(packet.laneIds), ['lane-must']);
    assert.deepEqual(Array.from(packet.mustActorIds), ['actor-must']);
    assert.deepEqual(Array.from(packet.worldbookKeys), ['world-a', 'world-b']);
    assert.deepEqual(Array.from(packet.worldbookEntryIds), ['entry-a', 'entry-b']);
    assert.deepEqual(
        Array.from(packet.worldbookEvidenceEntryIds),
        ['entry-a', 'entry-b'],
        'keyword-activated evidence precedes constant-only baseline material',
    );
    assert.deepEqual(Array.from(packet.worldbookSourceRefs).map((entry) => entry.id), ['entry-a', 'entry-b']);
    assert.equal(packet.selectedWorldbookCount, 2);
    assert.ok(packet.scanTextChars > 0);
    assert.match(packet.worldbookDigest, /^test-digest:/u);
    assert.equal(buildRecall({ ...options, mustActorIds: ['actor-unknown'] }), null);
    assert.equal(buildRecall({ ...options, mustThreadIds: ['thread-unknown'] }), null);
    assert.equal(buildRecall({ ...options, mustLaneIds: ['lane-unknown'] }), null);
});

test('P3 prompt keeps the full worldbook authority manifest while bounding model-facing evidence', () => {
    const buildMaterial = loadStage3WorldbookPromptMaterial();
    const entries = [
        {
            id: 'keyword-hit', sourceDomain: 'embedded', nativeId: '1', world: 'card',
            title: 'hit', keys: ['hit'], content: 'A'.repeat(12000), contentDigest: 'digest-a',
        },
        {
            id: 'constant-only', sourceDomain: 'embedded', nativeId: '2', world: 'card',
            title: 'constant', keys: [], constant: true,
            content: 'B'.repeat(12000), contentDigest: 'digest-b',
        },
        {
            id: 'external-constant', sourceDomain: 'external', nativeId: '3', world: 'external',
            title: 'external', keys: [], constant: true,
            content: 'C'.repeat(12000), contentDigest: 'digest-c',
        },
    ];
    const material = buildMaterial({ entries }, {
        worldbookEntryIds: entries.map((entry) => entry.id),
        worldbookEvidenceEntryIds: ['keyword-hit', 'constant-only', 'external-constant'],
    });
    assert.equal(material.manifest.length, 3);
    assert.equal(material.manifest.every((entry) => !Object.hasOwn(entry, 'content')), true);
    assert.equal(material.manifest.map((entry) => entry.contentDigest).join(','), 'digest-a,digest-b,digest-c');
    assert.equal(material.evidenceText.length, 6000);
    assert.equal(material.evidenceText.includes('A'.repeat(1000)), true);
    assert.equal(material.evidenceText.includes('C'.repeat(1000)), false);
});

test('P3 production prompt stays within 40000 characters while preserving every required actor and thread ID', () => {
    const buildMessages = loadBuildContinuityMessages();
    const actorIds = Array.from({ length: 10 }, (_, index) => `actor-budget-${index + 1}`);
    const threadIds = Array.from({ length: 12 }, (_, index) => `thread-budget-${index + 1}`);
    const worldbookEntries = Array.from({ length: 99 }, (_, index) => ({
        id: `worldbook-entry-${index + 1}`,
        sourceDomain: 'embedded',
        nativeId: String(index + 1),
        world: '99条内嵌世界书',
        title: `世界设定${index + 1}`,
        keys: [`关键词${index + 1}`],
        constant: true,
        content: `第${index + 1}条完整世界设定。`.repeat(180),
        contentDigest: `content-digest-${index + 1}`,
    }));
    const narrativeSections = Object.fromEntries([
        'person', 'physiology', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, {
        title: key,
        text: `${key}人物档案自然语言内容。`.repeat(180),
        source: 'hypothesis',
        evidence: ['本地权威证据'.repeat(40)],
    }]));
    const actors = actorIds.map((id, index) => ({
        id,
        name: `人物${index + 1}`,
        status: 'ready',
        identity: { role: '独立人物', aliases: [`人物别名${index + 1}`] },
        currentGoals: [{ summary: '推进自己的目标'.repeat(80) }],
        longTermGoals: [{ summary: '保持长期计划'.repeat(80) }],
        knowledge: [{ summary: '有限知识'.repeat(100) }],
        capabilities: [{ summary: '已验证能力'.repeat(100) }],
        resources: [{ summary: '当前资源'.repeat(100) }],
        profileV6: { profileFormat: 'narrative-v1' },
        profileV6View: {
            preparedForAction: true,
            coverage: 100,
            backgroundPending: false,
            narrativeSections,
            moduleStatuses: { hiddenPersistenceDetail: { status: 'ready' } },
            historyCount: 999,
            fieldSourceCount: 999,
            designRolls: { ticketId: 'must-not-be-sent' },
        },
    }));
    const threads = threadIds.map((id, index) => ({
        id,
        title: `事件${index + 1}`,
        kind: 'parallel', origin: 'setting_linked', relation: 'latent', stage: 'advancing',
        stageProgress: 3, urgency: 2, createdTurn: 1, lastAdvancedTurn: 2,
        summary: `事件摘要${index + 1}`.repeat(120),
        offscreenBeat: '幕后变化'.repeat(120),
        nextBeat: '下一步可能'.repeat(120),
        trigger: '具体触发条件'.repeat(120),
        sourceRefs: Array.from({ length: 30 }, () => ({ private: '持久化来源'.repeat(100) })),
    }));
    const recallPacket = {
        version: 2,
        selection: 'local_structured_schedule',
        actorIds,
        threadIds,
        laneIds: ['lane-budget-1'],
        mustActorIds: actorIds,
        mustThreadIds: threadIds,
        mustLaneIds: ['lane-budget-1'],
        worldbookEntryIds: worldbookEntries.map((entry) => entry.id),
        worldbookEvidenceEntryIds: worldbookEntries.map((entry) => entry.id),
        worldbookSourceRefs: worldbookEntries.map((entry) => ({ private: entry.id.repeat(80) })),
        worldbookDigest: 'worldbook-authority-digest',
        selectedWorldbookCount: worldbookEntries.length,
        digest: 'recall-plan-digest',
    };
    const messages = buildMessages({
        context: { chatId: 'chat-budget' },
        captured: { chatId: 'chat-budget', index: 12, swipeId: 0 },
        base: {
            version: 1,
            chatId: 'chat-budget',
            turn: 12,
            lastTick: { turn: 11, action: 'held', threadId: threadIds[0], reason: '等待条件' },
            scenarioPlan: { baseline: '场景规划'.repeat(2000) },
            world: { digest: '世界状态'.repeat(4000), trends: [], factions: [], winds: [], influences: [] },
            threads,
        },
        worldContext: { entries: worldbookEntries, hasSetting: true, sourceCount: 99 },
        stateAnchors: 'MVU只读主线锚点'.repeat(3000),
        actorShardCandidates: {
            scheduledActorIds: actorIds,
            proposals: actorIds.map((actorId) => ({
                actorId,
                intent: 'execute',
                candidateAction: '人物自己的具体尝试'.repeat(500),
                stateChanges: [{ kind: 'plan', summary: '准备行动'.repeat(300) }],
            })),
            rejectedActions: [],
        },
        actorLedger: { actors },
        worldLaneSchedule: {
            candidates: [{ sourceId: 'lane-budget-1', summary: '结构世界候选'.repeat(500) }],
            selected: [{ sourceId: 'lane-budget-1', summary: '结构世界候选'.repeat(500) }],
        },
        recallPacket,
    });
    const prompt = messages.map((message) => message.content).join('');
    assert.ok(prompt.length <= 40000, `world prompt chars=${prompt.length}`);
    actorIds.forEach((actorId) => assert.match(prompt, new RegExp(actorId, 'u')));
    threadIds.forEach((threadId) => assert.match(prompt, new RegExp(threadId, 'u')));
    assert.match(prompt, /worldbook-authority-digest/u);
    assert.doesNotMatch(prompt, /must-not-be-sent|hiddenPersistenceDetail|worldbookSourceRefs/u);
});

test('P3 accepts only current-target P1 actor-registration receipt evolution', () => {
    const gate = loadStage3ProfileEvolutionGate();
    const target = {
        chatId: 'chat-profile-observation', logicalIndex: 4, messageId: 'message-4',
        swipeId: 0, generation: 4, generationId: 'generation-4',
        generationType: 'normal', scopeDigest: 'scope-profile-observation',
        contentHash: 'content-4',
    };
    const oldRegistration = {
        receiptId: 'actor-registration:old', kind: 'actor-registration',
        sourceRef: { ...target }, actorIds: ['actor-old'], settledAt: 1,
    };
    const base = normalizeActorLedger({
        ...emptyActorLedger(target.chatId),
        actorRegistry: { scopeDigest: target.scopeDigest, registered: {} },
        actors: [{ id: 'actor-old', name: 'old' }],
        observationReceipts: [oldRegistration],
    }, { chatId: target.chatId, scopeDigest: target.scopeDigest });
    const freshSource = {
        ...structuredClone(base),
        actors: [...base.actors, { id: 'actor-new', name: 'new' }],
        actorRegistry: {
            ...structuredClone(base.actorRegistry),
            registered: {
                ...structuredClone(base.actorRegistry.registered),
                new: {
                    actorRef: {
                        kind: 'actor_ref', actorId: 'actor-new', displayName: 'new', aliases: [],
                    },
                    origin: 'accepted_narrative', sourceRefs: [], registeredTurn: 4, updatedTurn: 4,
                },
            },
        },
        observationReceipts: [...base.observationReceipts, {
            receiptId: 'actor-registration:new', kind: 'actor-registration',
            sourceRef: { ...target }, actorIds: ['actor-new'], settledAt: 2,
        }],
    };
    const fresh = normalizeActorLedger(
        freshSource,
        { chatId: target.chatId, scopeDigest: target.scopeDigest },
    );
    assert.equal(gate({
        baseLedger: base, freshLedger: fresh, actionTarget: target,
        chatId: target.chatId, scopeDigest: target.scopeDigest,
    }).ok, true);

    const wrongTarget = structuredClone(fresh);
    wrongTarget.observationReceipts.at(-1).sourceRef.messageId = 'other-message';
    assert.equal(gate({
        baseLedger: base, freshLedger: wrongTarget, actionTarget: target,
        chatId: target.chatId, scopeDigest: target.scopeDigest,
    }).reason, 'world_phase1_actor_authority_changed');

    const wrongKind = structuredClone(fresh);
    wrongKind.observationReceipts.at(-1).kind = 'accepted-observation';
    assert.equal(gate({
        baseLedger: base, freshLedger: wrongKind, actionTarget: target,
        chatId: target.chatId, scopeDigest: target.scopeDigest,
    }).reason, 'world_phase1_actor_authority_changed');

    const mutatedOldReceipt = structuredClone(fresh);
    mutatedOldReceipt.observationReceipts[0].settledAt = 999;
    assert.equal(gate({
        baseLedger: base, freshLedger: mutatedOldReceipt, actionTarget: target,
        chatId: target.chatId, scopeDigest: target.scopeDigest,
    }).reason, 'world_phase1_actor_authority_changed');
});

test('P3 local recall is deterministic and adds zero model calls', () => {
    const recallSource = sourceSection('function stage3WorldbookRegexKey(value) {', 'function buildContinuityMessages({');
    assert.doesNotMatch(recallSource, /callModel\(|await |maxTokens|timeout|failover/u);
    assert.match(recallSource, /local_structured_schedule/u);
    assert.match(recallSource, /packet\.digest = fingerprint\(JSON\.stringify\(packet\)\)/u);
    const run = sourceSection('async function runContinuityTarget(captured, {', 'function sameTargetExceptContent(left, right)');
    assert.equal((run.match(/generateWorldContinuitySingleBatch\(/gu) || []).length, 1);
    assert.equal((run.match(/stage3LocalRecallPacket\(/gu) || []).length, 1);
});

test('P3 preserves complete local worldbook entries and bounds only the model-facing evidence view', () => {
    const collector = sourceSection(
        'function usableContinuityWorldEntry(entry)',
        'function usableForumWorldEntry(entry)',
    );
    assert.match(collector, /const contentDigest = fingerprint\(content\)[\s\S]*?content,\s*\n\s*contentDigest,/u);
    assert.doesNotMatch(collector, /cropText\(content,\s*1400/u);
    const collection = sourceSection(
        'async function collectContinuityWorldContextUncached',
        'async function collectContinuityWorldContext(',
    );
    assert.match(collection, /const candidates = \[\.\.\.embedded, \.\.\.external\]/u);
    assert.match(collection, /__doctorSourceKind: 'embedded'/u);
    assert.match(collection, /__doctorSourceKind: 'external_active'/u);
    assert.match(collection, /entries: canonicalEntries/u);
    assert.doesNotMatch(collection, /worldBlocks\.length >= 12/u);
    const promptMaterial = sourceSection(
        'function stage3WorldbookPromptMaterial(',
        'function buildContinuityMessages({',
    );
    assert.match(promptMaterial, /contentDigest: entry\.contentDigest/u);
    assert.match(promptMaterial, /6000, 'P3世界书取材'/u);
    assert.doesNotMatch(promptMaterial.slice(
        promptMaterial.indexOf('const manifest'),
        promptMaterial.indexOf('const evidenceText'),
    ), /content:\s*entry\.content/u);
    const prompt = sourceSection('function buildContinuityMessages({', 'async function generateWorldContinuitySingleBatch(');
    assert.match(prompt, /worldbookAuthority:/u);
    assert.doesNotMatch(prompt, /worldbookManifest: worldbookPromptMaterial\.manifest/u);
    assert.match(prompt, /worldbookPromptMaterial\.evidenceText/u);
    assert.doesNotMatch(prompt, /recalledWorldbookEntries/u);
});

test('P3 canonicalizes duplicate host acquisition paths by physical worldbook SourceRef', () => {
    const { usable, canonical } = loadContinuityWorldEntryCanonicalizer();
    const raw = (sourceKind, content = '同一条物理设定') => ({
        uid: 7,
        world: '当前世界书',
        comment: '同一条目',
        content,
        key: ['条目'],
        __doctorSourceKind: sourceKind,
    });
    const selected = usable(raw('external_selected'));
    const active = usable(raw('external_active'));
    assert.equal(selected.id, active.id);
    assert.deepEqual(selected.sourceRef, active.sourceRef);
    const one = canonical([selected, active]);
    assert.equal(one.length, 1);
    assert.equal(one[0].sourceKind, 'external_active');
    assert.deepEqual(Array.from(one[0].acquisitionSources), ['external_active', 'external_selected']);

    const embedded = usable(raw('embedded'));
    const separateDomains = canonical([active, embedded]);
    assert.equal(separateDomains.length, 2);
    assert.deepEqual(
        Array.from(separateDomains).map((entry) => entry.sourceDomain).sort(),
        ['embedded', 'external'],
    );
    const embeddedMirror = usable({
        ...raw('embedded', '内嵌权威内容'),
        __doctorEmbeddedBookName: '当前世界书',
    });
    const importedMirror = usable(raw('external_active', '宿主转换后的表示'));
    const mirrored = canonical([importedMirror, embeddedMirror], {
        primaryWorld: '当前世界书',
    });
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0].sourceKind, 'embedded');
    assert.equal(mirrored[0].content, '内嵌权威内容');
    assert.equal(mirrored[0].sourceRef.sourceDomain, 'embedded');
    assert.equal(mirrored[0].acquisitionAliases.length, 1);

    const changedPhysicalEntry = usable(raw('external_selected', '同一原生ID的新内容'));
    const sameExternalPhysicalEntry = canonical([changedPhysicalEntry, active]);
    assert.equal(sameExternalPhysicalEntry.length, 1);
    assert.equal(sameExternalPhysicalEntry[0].sourceKind, 'external_active');
    assert.equal(sameExternalPhysicalEntry[0].content, active.content);

    const differentNativeEntry = usable({ ...raw('external_selected'), uid: 8 });
    const distinct = canonical([active, differentNativeEntry]);
    assert.equal(distinct.length, 2, 'different native worldbook entries are never merged');

    const zeroActive = usable({ ...raw('external_active'), uid: 0 });
    const zeroSelected = usable({ ...raw('external_selected'), uid: 0 });
    assert.equal(zeroActive.nativeId, '0');
    assert.equal(zeroActive.id, zeroSelected.id);
    assert.equal(JSON.stringify(zeroActive.sourceRef), JSON.stringify(zeroSelected.sourceRef));
});

test('P3 normalizes embedded card-book fields and preserves its book identity', () => {
    const { usable } = loadContinuityWorldEntryCanonicalizer();
    const embedded = usable({
        id: 0,
        world: '卡书名称',
        __doctorEmbeddedBookName: '卡书名称',
        __doctorSourceKind: 'embedded',
        content: '内嵌规则',
        keys: ['主键'],
        secondary_keys: ['次键'],
        extensions: {
            vectorized: true,
            selectiveLogic: 3,
            case_sensitive: true,
            match_whole_words: true,
        },
        selective: true,
    });
    assert.equal(embedded.nativeId, '0');
    assert.equal(embedded.bookName, '卡书名称');
    assert.deepEqual(Array.from(embedded.keys), ['主键']);
    assert.deepEqual(Array.from(embedded.secondaryKeys), ['次键']);
    assert.equal(embedded.vectorized, true);
    assert.equal(embedded.selectiveLogic, 3);
    assert.equal(embedded.caseSensitive, true);
    assert.equal(embedded.matchWholeWords, true);
    const collection = sourceSection(
        'async function collectContinuityWorldContextUncached',
        'async function collectContinuityWorldContext(',
    );
    assert.match(collection, /__doctorEmbeddedBookName: String\(book\?\.name \|\| ''\)/u);
    assert.match(collection, /canonicalContinuityWorldEntries\(candidates, \{ primaryWorld \}\)/u);
});

test('P3 worldbook activation reuses constant, primary/secondary logic and never self-triggers vector entries', () => {
    const buildRecall = loadStage3LocalRecallPacket();
    const common = {
        actorLedger: { actors: [] }, base: { threads: [] },
        worldLaneSchedule: { candidates: [] }, acceptedNarrative: 'Dragon 门已经开启',
        worldbookEntries: [
            { id: 'const', content: '常驻', constant: true },
            { id: 'whole', content: '整词', keys: ['dragon'], matchWholeWords: true },
            { id: 'and-any', content: '次键', keys: ['门'], secondaryKeys: ['开启', '关闭'], selective: true, selectiveLogic: 0 },
            { id: 'and-all-miss', content: '次键全中', keys: ['门'], secondaryKeys: ['开启', 'moon'], selective: true, selectiveLogic: 3 },
            { id: 'vector', content: '向量', keys: ['门'], vectorized: true },
        ],
    };
    assert.deepEqual(Array.from(buildRecall(common).worldbookEntryIds), ['and-any', 'const', 'whole']);
});

test('P3 Advance prompt distinguishes new actor drafts from existing ATT adjudications', () => {
    const prompt = sourceSection('function buildContinuityMessages({', 'async function generateWorldContinuitySingleBatch(');
    const active = prompt.slice(
        prompt.indexOf('const actionOutputShape = worldCreatesAttempts'),
        prompt.indexOf('/* Historical verbose payload'),
    );
    assert.match(active, /worldCreatesAttempts/u);
    assert.match(active, /actorId.*intent.*candidateAction.*stateChanges/us);
    assert.match(active, /actorId.*status.*resultSummary.*observableConsequence/us);
    assert.match(prompt, /技术身份和账本字段由医生本地绑定/u);
    assert.match(prompt, /不要抄写或猜测任何内部技术标识/u);
    assert.doesNotMatch(active, /attemptId|actorRef|target|travelTurns|actualResourceCosts/u);
});
