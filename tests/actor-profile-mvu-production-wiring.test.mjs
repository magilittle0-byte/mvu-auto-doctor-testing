import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    actorProfileMvuDigest,
    actorProfileMvuSourceRefDigest,
    actorProfileReceiptPlacementAccepted,
    compileActorProfileMvuPatch,
    profileReadiness,
    actorProfilePromptProjection,
} from '../actor-profile-mvu-core.mjs';
import {
    ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS,
    actorProfileRecoverySourceDigest,
} from '../actor-profile-v6-core.mjs';
import { actorProfileReadinessInLedger } from '../actor-ledger-core.mjs';
import { composeActorOperationalState, actorOperationalPromptProjection } from '../actor-operational-state-core.mjs';
import {
    actorProfileRetryReceiptMatches,
    createActorProfileRetryReceipt,
} from '../actor-profile-v6-core.mjs';
import {
    normalizeAssistantStoredText,
    normalizeStoredAssistantMessage,
    selectBoundedRelevantActorIds,
} from '../prompt-context-core.mjs';
import { createActorProfileSurfaceView } from '../v2/surface/actor-profile-view.mjs';
import {
    doctorProfileFoldStorageKey,
    isExactDoctorChatStorageKey,
    planDoctorChatScopeDisposal,
} from '../doctor-chat-scope-core.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('stored assistant text normalization is shared, multimodal-safe, and fail-closed', () => {
    assert.deepEqual(normalizeAssistantStoredText('  正文  '), { ok: true, text: '正文' });
    assert.deepEqual(
        normalizeAssistantStoredText([
            { type: 'text', text: '甲' },
            { type: 'image_url', image_url: { url: 'private://image' } },
            { type: 'text', text: '乙' },
        ]),
        { ok: true, text: '甲乙' },
    );
    assert.deepEqual(
        normalizeAssistantStoredText([
            { type: 'text', content: '甲' },
            { type: 'image' },
            '乙',
        ]),
        { ok: true, text: '甲乙' },
    );
    assert.equal(normalizeAssistantStoredText({ text: '伪正文' }).ok, false);
    assert.equal(normalizeAssistantStoredText([{ type: 'tool', value: '未知' }]).ok, false);
    assert.equal(normalizeAssistantStoredText([{ type: 'image' }]).ok, false);
    assert.equal(normalizeStoredAssistantMessage({ is_user: false, content: [{ type: 'text', text: '甲' }] }).text, '甲');
    assert.equal(normalizeStoredAssistantMessage({ role: 'system', mes: '<人物档案更新>' }).ok, false);
    assert.equal(normalizeStoredAssistantMessage({ mes: '<人物档案更新>' }).ok, false);
});

test('production accepted-final capture uses normalized text and rejects unknown stored shapes', () => {
    const capture = section('function captureTarget', 'async function freshFrozenScopeGuard');
    assert.match(capture, /normalizedStoredAssistantMessage\(message\)/u);
    assert.match(capture, /fingerprint\(normalized\.text\)/u);
    assert.match(capture, /acceptedContentFingerprint\(normalized\.text\)/u);
    const repairTarget = section('function captureDoctorRepairTargetReadOnly', 'function commitCandidate');
    assert.match(repairTarget, /normalizedStoredAssistantMessage\(message\)/u);
    const core = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget\(');
    assert.match(core, /normalizedStoredAssistantMessage\(context\?\.chat\?\.\[captured\.index\]\)/u);
    const p3 = section('async function runContinuityTarget', 'async function enqueueContinuity');
    assert.match(p3, /normalizedStoredAssistantMessage\(context\?\.chat\?\.\[captured\.index\]\)/u);
});

test('production disposeDoctorChatScope isolates old owners and late writes', () => {
    const dispose = section('function disposeDoctorChatScope', 'function bindEvents');
    const current = 'chat-B';
    const old = 'chat-A';
    const calls = {
        invalidate: 0,
        clearFallback: 0,
        clearShadow: 0,
        aborted: [],
        storage: [],
        lateWrites: 0,
    };
    const storage = new Map([
        [doctorProfileFoldStorageKey(old), 'old-fold'],
        [doctorProfileFoldStorageKey(current), 'current-fold'],
        ['third-party:keep', 'keep'],
    ]);
    const localStorageStub = {
        get length() { return storage.size; },
        key(index) { return [...storage.keys()][index] || null; },
        removeItem(key) { calls.storage.push(key); storage.delete(key); },
    };
    const oldController = { mvuadChatId: old, abort() { calls.aborted.push(old); } };
    const currentController = { mvuadChatId: current, abort() { calls.aborted.push(current); } };
    const oldConsumer = { chatId: old, cancelled: false };
    const currentConsumer = { chatId: current, cancelled: false };
    const oldTask = { chatId: old };
    const currentTask = { chatId: current };
    const oldRepair = { chatId: old, cancelled: false };
    const currentRepair = { chatId: current, cancelled: false };
    const oldBusyKey = `${old}|ACTOR-A`;
    const currentBusyKey = `${current}|ACTOR-A`;
    const maps = {
        selector: new Map([[old, {}], [current, {}], ['selector-only', { actorId: 'ACTOR-ONLY' }], ['selector-other', {}]]),
        requests: new Map([['old', oldRepair], ['current', currentRepair]]),
        modules: new Map(),
        pending: new Set([old, current]),
        completed: new Set([old, current]),
        surfaceBusy: new Map([[oldBusyKey, { chatId: old }], [currentBusyKey, { chatId: current }]]),
        surfaceFailures: new Map([[oldBusyKey, { chatId: old }], [currentBusyKey, { chatId: current }]]),
        controllers: new Set([oldController, currentController]),
        taskOwners: new Map([['task-old', oldTask], ['task-current', currentTask]]),
        taskIds: new Set(['task-old', 'task-current']),
        accepted: new Map([['old', { chatId: old }], ['current', { chatId: current }]]),
        tickets: new Map([['old', { chatId: old }], ['current', { chatId: current }]]),
        observations: new Map([['old', { chatId: old }], ['current', { chatId: current }]]),
    };
    const prune = (container, chatId) => {
        if (!container?.entries && !(container instanceof Set)) return;
        if (container instanceof Set) {
            for (const value of [...container]) if (String(value?.chatId || value) === chatId) container.delete(value);
            return;
        }
        for (const [key, value] of [...container.entries()]) {
            if (String(value?.chatId || key) === chatId) container.delete(key);
        }
    };
    const match = (value, chatId) => String(value?.chatId || value?.owner?.chatId || '') === chatId;
    const cancel = (container, chatId) => {
        for (const [key, value] of [...container.entries()]) {
            if (!match(value, chatId)) continue;
            value.cancelled = true;
            container.delete(key);
        }
    };
    const surfacePrune = (map, chatId) => prune(map, chatId);
    const unregister = (taskId) => {
        maps.taskIds.delete(taskId);
        maps.taskOwners.delete(taskId);
    };
    const buildRun = (activeConsumer) => new Function(
        'getContext', 'planDoctorChatScopeDisposal', 'isExactDoctorChatStorageKey', 'localStorage',
        'actorSovereigntyScopeSelectorCache', 'cancelDoctorRepairScopeEntries',
        'doctorRepairCenterRequests', 'doctorRepairCenterModuleRequests', 'doctorOwnedChatMatch',
        'doctorRepairCenterUiOwner', 'automaticPendingKeys', 'automaticCompletedKeys',
        'openingSyncPendingKeys', 'openingSyncCompletedKeys', 'actorProfilePendingKeys',
        'actorProfileCompletedKeys', 'userCancelledActorProfileKeys', 'continuityPendingKeys',
        'continuityCompletedKeys', 'forumPendingKeys', 'forumCompletedKeys',
        'acceptedFinalDispatchPromises', 'acceptedFinalLaunchPromises', 'npcDesignTicketBatches',
        'pendingSovereigntyObservations', 'pruneDoctorOwnedChatEntries', 'pruneActorProfileSurfaceMapForChat',
        'actorProfileSurfaceBusy', 'actorProfileSurfaceFailures', 'activeModelControllers',
        'activeSovereigntyTaskOwners', 'unregisterActiveSovereigntyTask', 'activeGenerationSession',
        'pendingAcceptedFinalTimer', 'pendingAcceptedFinalSession', 'activeNextTurnConsumer', 'lastGeneration',
        'generationSerial', 'currentGenerationEpoch', 'operationEpoch', 'pendingChatSaveTimer',
        'pendingOperationLogSaveTimer', 'pendingOpeningSyncTimer', 'invalidateOperations',
        'clearActorProfileReadShadow', 'clearNextTurnConsumerFallback', 'pendingNpcDesignTicketBatch',
        'activeSovereigntyTaskIds', 'actorProfileSurfaceCache', 'lastActorProfilePromptSanitization',
        `${dispose}\nreturn disposeDoctorChatScope;`,
    )(
        () => ({ chatId: current }), planDoctorChatScopeDisposal, isExactDoctorChatStorageKey, localStorageStub,
        maps.selector, cancel, maps.requests, maps.modules, match, oldRepair,
        maps.pending, maps.completed, maps.pending, maps.completed, maps.pending, maps.completed,
        maps.pending, maps.pending, maps.completed, maps.pending, maps.completed, maps.accepted,
        maps.accepted, maps.tickets, maps.observations, prune, surfacePrune,
        maps.surfaceBusy, maps.surfaceFailures, maps.controllers, maps.taskOwners, unregister,
        { chatId: old, stopped: false }, null, { chatId: old }, activeConsumer,
        { chatId: old }, 1, 1, 1, null, null, null,
        () => { calls.invalidate += 1; }, () => { calls.clearShadow += 1; }, () => {
            calls.clearFallback += 1;
        }, null, maps.taskIds, maps.selector, { status: 'ready' },
    );
    const run = buildRun(oldConsumer);
    const unknown = run({ id: old });
    assert.equal(unknown.ok, false);
    assert.equal(calls.storage.length, 0, 'unmappable deletion performs no cleanup');
    const oldResult = run(old);
    assert.equal(oldResult.current, false);
    assert.equal(oldConsumer.cancelled, true);
    assert.equal(currentConsumer.cancelled, false);
    assert.equal(oldController.abort ? calls.aborted.length : 0, 1);
    assert.deepEqual([...maps.taskOwners.keys()], ['task-current']);
    assert.equal(maps.surfaceBusy.has(oldBusyKey), false);
    assert.equal(maps.surfaceBusy.has(currentBusyKey), true);
    assert.equal(storage.has(doctorProfileFoldStorageKey(old)), false);
    assert.equal(storage.has(doctorProfileFoldStorageKey(current)), true);
    assert.equal(storage.has('third-party:keep'), true);
    assert.equal(calls.invalidate, 0);
    assert.equal(calls.clearFallback, 0);
    assert.equal(calls.clearShadow, 0);
    const lateCallback = () => {
        if (oldConsumer.cancelled) return;
        calls.lateWrites += 1;
    };
    lateCallback();
    assert.equal(calls.lateWrites, 0, 'cancelled old scope cannot write after disposal');

    const currentOwnerRun = buildRun(currentConsumer);
    const currentOwnerResult = currentOwnerRun(old);
    assert.equal(currentOwnerResult.current, false);
    assert.equal(currentConsumer.cancelled, false, 'current consumer survives old-chat deletion');
    assert.equal(calls.clearFallback, 0, 'old chat cannot clear the current host slot');
    assert.equal(calls.invalidate, 0);
    assert.equal(storage.has(doctorProfileFoldStorageKey(current)), true);
    assert.equal(storage.has('third-party:keep'), true);

    const selectorOnlyResult = run('selector-only');
    assert.equal(selectorOnlyResult.current, false);
    assert.equal(maps.selector.has('selector-only'), false, 'selector-only scope is disposed without another cache');
    assert.equal(maps.selector.has('selector-other'), true, 'other selector scope is untouched');

    const currentDeleteRun = buildRun(currentConsumer);
    const currentDeleteResult = currentDeleteRun(current);
    assert.equal(currentDeleteResult.current, true);
    assert.equal(calls.invalidate, 1);
    assert.equal(calls.clearFallback, 1);
    assert.equal(calls.clearShadow, 1);
    assert.equal(calls.aborted.length, 2);
    assert.equal(storage.has(doctorProfileFoldStorageKey(current)), false);
    assert.equal(storage.has('third-party:keep'), true);
});

test('production semantic actor capacity rejects 65 before parse/replace/write', async () => {
    const core = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget\(');
    const actorIds = Array.from({ length: 65 }, (_, index) => `NPC-prod-cap-${index}`);
    const fakeContext = { chat: [{ mes: '<content>正文</content>\n<!-- 人物档案更新 -->' }] };
    let parseCalls = 0;
    let replaceCalls = 0;
    let settleCalls = 0;
    let compileCalls = 0;
    let commitCalls = 0;
    let replayCalls = 0;
    let namespaceWrites = 0;
    const run = new Function(
        'normalizedStoredAssistantMessage', 'actorProfileSemanticFailure',
        'freshFrozenScopeGuard', 'operationToken', 'continuityTargetIsCurrent',
        'actorProfileTransientResult',
        'getContext', 'sovereigntyNarrativeEligible', 'npcDesignTicketBatchForTarget',
        'reservedTicketMatchesAcceptedTarget', 'extractActorProfileUpdateBlock',
        'actorProfileReceiptOmissionDecision', 'settleSemanticActorProfileTransactionTarget',
        'parseActorProfileUpdateBlock', 'readChatNamespace', 'normalizeActorLedger',
        'bindActorProfileUpdateEntries', 'acceptedContentText', 'sourceRefOf',
        'ACTOR_PROFILE_MAX_TRANSACTION_ACTORS',
        'compileActorProfileMvuPatch', 'commitCandidate',
        'replayFinalizedSemanticProfileOperations', 'writeChatNamespace',
        `${core}\nreturn runSemanticActorProfileTargetCore;`,
    )(
        () => ({ ok: true, text: fakeContext.chat[0].mes }),
        (captured, reason, extra) => ({ status: 'not_completed', reason, ...extra }),
        async () => ({ ok: true }),
        () => ({}),
        () => ({ ok: true }),
        (status, extra) => ({ status, ...extra }),
        () => fakeContext,
        () => true,
        () => ({ tickets: [] }),
        () => true,
        () => ({ present: true, ok: true, block: '<人物档案更新>' }),
        () => 'profile_block_missing',
        async (captured) => { settleCalls += 1; return { ok: true, target: captured, messageText: fakeContext.chat[0].mes,
            extracted: { ok: true, block: '<人物档案更新>' }, Mvu: {
                getMvuData() { return {}; },
                parseMessage() { parseCalls += 1; }, replaceMvuData() { replaceCalls += 1; },
            }, data: {} }; },
        () => ({ failures: [], quarantined: [], ok: true, entries: actorIds.map((actorId) => ({ actorId })) }),
        () => ({ actorLedger: {} }),
        (value) => value,
        () => ({ ok: true, entries: actorIds.map((actorId) => ({ actorId })), quarantined: [], failedActorTargets: [] }),
        (value) => value,
        (value) => value,
        64,
        () => { compileCalls += 1; },
        () => { commitCalls += 1; },
        () => { replayCalls += 1; },
        () => { namespaceWrites += 1; },
    );
    const result = await run({ chatId: 'chat-cap', index: 0 });
    assert.equal(result.reason, 'profile_transaction_actor_capacity_exceeded');
    assert.equal(result.zeroWrite, true);
    assert.equal(result.repairable, true);
    assert.equal(settleCalls, 0);
    assert.equal(parseCalls, 0);
    assert.equal(replaceCalls, 0);
    assert.equal(compileCalls, 0);
    assert.equal(commitCalls, 0);
    assert.equal(replayCalls, 0);
    assert.equal(namespaceWrites, 0);
});

test('profile authority survives mechanism-only replay but rejects narrative drift', () => {
    const authoritySource = section(
        'function sourceRefOf(captured)',
        'async function persistSemanticActorLedgerProjection',
    );
    const stableSourceRef = {
        chatId: 'chat-source', messageId: 'message-4', index: 4, swipeId: 2,
        generationSerial: 8, generationId: 'generation-8', generationType: 'normal',
        scopeDigest: 'scope-1', contentFingerprint: 'narrative-8',
        hash: 'narrative-8', contentHash: 'narrative-8',
    };
    const profile = {
        actorId: 'NPC-stable', name: '林澈',
        本地元数据: { sourceRef: stableSourceRef, sourceRefDigest: actorProfileMvuSourceRefDigest(stableSourceRef) },
    };
    const capturedBefore = {
        chatId: 'chat-source', index: 4, messageId: 'message-4', swipeId: 2,
        generationSerial: 8, generationId: 'generation-8', generationType: 'normal',
        identityScopeId: 'chat-source|card-1', scopeDigest: 'scope-1',
        fingerprint: 'full-message-before', contentFingerprint: 'narrative-8',
    };
    const capturedAfterReplay = {
        ...capturedBefore,
        fingerprint: 'full-message-after-doctor-replay',
    };
    const functions = new Function(
        'actorProfileMvuSourceRefDigest', 'actorProfileMvuDigest', 'profileReadiness',
        'deepClone', 'ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION',
        'normalizeActorActionTarget',
        `${authoritySource}\nreturn { actorProfileAuthoritySourceRef, semanticProfileReadinessRef, semanticProfileRefMatchesMvu };`,
    )(
        actorProfileMvuSourceRefDigest,
        (value) => 'profile-v1:1:abc123',
        () => ({ ready: true }),
        (value) => JSON.parse(JSON.stringify(value)),
        2,
        (value) => value,
    );
    const ref = functions.semanticProfileReadinessRef(
        profile,
        { actorId: profile.actorId, profileDigest: 'profile-v1:1:abc123', revision: 1 },
        capturedAfterReplay,
        '/人物档案/byActorId',
    );
    assert.equal(ref.sourceRef.hash, 'narrative-8');
    assert.equal(ref.sourceRef.contentFingerprint, 'narrative-8');
    assert.equal(functions.semanticProfileRefMatchesMvu({
        ...ref, sourceRefDigest: actorProfileMvuSourceRefDigest(ref.sourceRef),
    }, profile), true);
    assert.equal(functions.semanticProfileRefMatchesMvu({
        ...ref,
        sourceRef: { ...ref.sourceRef, contentFingerprint: 'narrative-changed' },
        sourceRefDigest: actorProfileMvuSourceRefDigest(ref.sourceRef),
    }, profile), false);
    assert.notEqual(
        functions.actorProfileAuthoritySourceRef(capturedBefore).hash,
        capturedBefore.fingerprint,
        'profile source digest must ignore only the Doctor mechanism hash',
    );
});

test('registry projection recovery derives a new Actor identity from durable MVU and fails closed on drift', () => {
    const recoveryHelpers = section(
        'function semanticProfileRecoveryIdentity',
        'async function recoverSemanticProfileRegistryProjection',
    );
    const helpers = new Function(
        'isActorId', 'actorProfileRecoverySourceMatches',
        'actorProfileMvuSourceRefDigest', 'actorProfileMvuDigest', 'profileReadiness',
        'semanticProfileRefMatchesMvu',
        `${recoveryHelpers}\nreturn { semanticProfileRecoveryIdentity, semanticProfileRecoveryEvidence, semanticProfileProjectionEvidenceCode, semanticProfileRecoveryResidualFailureCodes, semanticProfileRecoveryProfileIsValid, semanticProfileRecoveryProjectionInputs, semanticProfileRecoveryIdentityMatchesActor };`,
    )(
        (value) => /^(?:NPC|ACTOR)(?:[-:][\p{L}\p{N}_.]+)+$/iu.test(String(value || '').trim()),
        (left, right) => String(left?.messageId || '') === String(right?.messageId || '')
            && String(left?.generationId || '') === String(right?.generationId || ''),
        (value) => `profile-source:${value.messageId}`,
        actorProfileMvuDigest,
        () => ({ ready: true }),
        () => true,
    );
    const profile = {
        actorRef: { actorId: 'NPC-new-1', name: '林澈', aliases: ['小澈'] },
        '姓名与别名': { 姓名: '林澈', 别名: ['小澈'] },
        profileFormat: 'narrative-v1',
        version: 1,
        本地元数据: {
            status: 'complete', readbackVerified: true,
            sourceRef: { messageId: 'm2', generationId: 'g2' },
            sourceRefDigest: 'profile-source:m2',
        },
    };
    assert.deepEqual(helpers.semanticProfileRecoveryIdentity('NPC-new-1', profile), {
        actorId: 'NPC-new-1', name: '林澈', aliases: ['小澈'],
    });
    assert.equal(
        helpers.semanticProfileRecoveryIdentity('NPC-new-1', {
            ...profile, '姓名与别名': { 姓名: '原创人物骰票1' },
        }),
        null,
    );
    assert.equal(
        helpers.semanticProfileRecoveryProfileIsValid(
            profile, 'NPC-new-1', { messageId: 'm2', generationId: 'g2' }, actorProfileMvuDigest(profile), 'full',
        ),
        true,
    );
    assert.equal(
        helpers.semanticProfileRecoveryProfileIsValid(
            profile, 'NPC-new-1', { messageId: 'm2', generationId: 'g2' }, 'deadbeef2', 'full',
        ),
        false,
    );
    const inputs = helpers.semanticProfileRecoveryProjectionInputs({
        evidence: [{ actorId: 'NPC-new-1', profileDigest: actorProfileMvuDigest(profile) }],
        profiles: { 'NPC-new-1': profile },
        ledger: { actors: [] },
        sourceRef: { messageId: 'm2', generationId: 'g2', swipeId: 0 },
        root: '/人物档案/byActorId',
        requiredCompletionMode: 'full',
    });
    assert.equal(inputs.ok, true);
    assert.deepEqual(inputs.entries, [{
        actorId: 'NPC-new-1', mode: 'new', name: '林澈', aliases: ['小澈'],
        sourceAnchor: 'recovery:m2:0',
    }]);
    assert.equal(inputs.writeSet[0].path, '/人物档案/byActorId/NPC-new-1');
    const existingInputs = helpers.semanticProfileRecoveryProjectionInputs({
        evidence: [{ actorId: 'NPC-new-1', profileDigest: actorProfileMvuDigest(profile) }],
        profiles: { 'NPC-new-1': profile },
        ledger: { actors: [{
            id: 'NPC-new-1', name: '林澈', profileRef: { digest: 'old-digest' },
        }] },
        sourceRef: { messageId: 'm2', generationId: 'g2', swipeId: 0 },
        root: '/人物档案/byActorId', requiredCompletionMode: 'full',
    });
    assert.equal(existingInputs.ok, true, 'old registry ref may be replaced after exact MVU recovery evidence');
    assert.equal(helpers.semanticProfileRecoveryIdentityMatchesActor(
        { name: '另一名角色' }, { name: '林澈', aliases: ['小澈'] },
    ), false, 'a conflicting registry identity remains fail-closed');
    assert.equal(
        helpers.semanticProfileRecoveryProjectionInputs({
            evidence: [{ actorId: 'NPC-new-1', profileDigest: 'profile-v1:badbad' }],
            profiles: { 'NPC-new-1': profile }, ledger: { actors: [] },
            sourceRef: { messageId: 'm2', generationId: 'g2', swipeId: 0 },
            root: '/人物档案/byActorId', requiredCompletionMode: 'full',
        }).ok,
        false,
    );
    assert.deepEqual(
        helpers.semanticProfileRecoveryEvidence(helpers.semanticProfileProjectionEvidenceCode(
            'NPC-new-1', actorProfileMvuDigest(profile),
        )),
        { actorId: 'NPC-new-1', profileDigest: actorProfileMvuDigest(profile) },
    );
    assert.deepEqual(
        helpers.semanticProfileRecoveryEvidence(helpers.semanticProfileProjectionEvidenceCode(
            'ACTOR:legacy.id', actorProfileMvuDigest(profile),
        )),
        { actorId: 'ACTOR:legacy.id', profileDigest: actorProfileMvuDigest(profile) },
    );
    assert.equal(
        helpers.semanticProfileRecoveryEvidence('registry_projection_pending:ACTOR:legacy.id'),
        null,
        'a colon ActorId without a sealed digest is ambiguous and must not recover',
    );
    assert.deepEqual(
        helpers.semanticProfileRecoveryResidualFailureCodes({
            failureCodes: [
                helpers.semanticProfileProjectionEvidenceCode('NPC-new-1', actorProfileMvuDigest(profile)),
                'failed_actor:NPC-bad-2', 'profile_entry_incomplete',
            ],
        }, ['NPC-new-1'], { failedActorTargets: [{ actorId: 'NPC-bad-2' }] }),
        ['failed_actor:NPC-bad-2', 'profile_entry_incomplete'],
        'projection recovery must preserve the other actor recovery owner',
    );
});

test('initial partial projection failure preserves the exact bad-Actor recovery owner for refresh repair', async () => {
    const failureSource = section('function actorProfileSemanticFailure', 'function actorProfileExplicitNoChangeReceipt');
    const semanticFailure = new Function(
        'classifyActorProfileRepairFailure', 'actorProfileTransientResult', 'sourceRefOf',
        `${failureSource}\nreturn actorProfileSemanticFailure;`,
    )(
        ({ code }) => ({ code, failureClass: 'content' }),
        (_status, value) => value,
        () => ({ messageId: 'm8', generationId: 'g8', swipeId: 0 }),
    );
    const initial = semanticFailure(
        { messageId: 'm8' }, 'actor_profile.registry_projection_failed', {
            committed: ['NPC-good'],
            readbackVerified: true,
            registryProjectionPending: true,
            projectionActorIds: ['NPC-good'],
            projectionEvidence: [{ actorId: 'NPC-good', profileDigest: actorProfileMvuDigest({ actorId: 'NPC-good' }) }],
            partial: true,
            commitStatus: 'partial',
            quarantined: [{ reason: 'profile_entry_incomplete', ticketId: 'T-B' }],
            failedActorTargets: [{ actorId: 'NPC-bad', ticketId: 'T-B', missingFields: ['history'] }],
        },
    );
    assert.equal(initial.profileBatch.partial, true);
    assert.equal(initial.profileBatch.commitStatus, 'partial');
    assert.deepEqual(initial.profileBatch.failedActorTargets, [{
        actorId: 'NPC-bad', ticketId: 'T-B', missingFields: ['history'],
    }]);

    const recoverySource = section('async function persistActorProfileRecoveryState', 'async function finalizeActorProfileRecoveryOutcome');
    let savedNamespace = null;
    const context = { chatId: 'chat-8' };
    const captured = {
        chatId: 'chat-8', generationId: 'g8', messageId: 'm8', index: 4,
        scopeDigest: 'scope-8', actorSovereigntyScope: { chatId: 'chat-8' },
    };
    const batch = {
        chatId: 'chat-8', generationId: 'g8',
        tickets: [{ ticketId: 'T-B', chatId: 'chat-8' }],
    };
    const persist = new Function(
        'readChatNamespace', 'sourceRefOf', 'captureTarget', 'getContext',
        'actorProfileRecoverySourceMatches', 'getContextTarget', 'npcDesignTicketBatches',
        'actorProfileTicketBatchPersistenceMatches', 'actorProfileTicketBatchPersistenceDigest',
        'sealActorProfileTicketBatchForPersistence',
        'deepClone', 'createActorProfileRetryReceipt', 'compactActorProfileFailureCode',
        'durableActorProfileRecoveryTarget',
        'normalizeActorProfileRecoveryProgress', 'actorProfileRecoveryProgressDigest',
        'writeChatNamespace', 'actorProfileRetryReceiptWithProgressMatches',
        'actorProfileNoCandidatesTerminalProofMatches',
        `${recoverySource}\nreturn persistActorProfileRecoveryState;`,
    )(
        () => context.namespace || (context.namespace = { characterCreationTicketBatches: [] }),
        () => ({ messageId: 'm8', generationId: 'g8', swipeId: 0 }),
        () => captured,
        () => context,
        () => true,
        () => captured,
        new Map([['g8', batch]]),
        (entry) => Boolean(entry),
        () => 'ticket-digest',
        (entry) => ({ ...entry, persistenceDigest: 'ticket-digest' }),
        structuredClone,
        ({ sourceRef, ticketBatch, failureCodes, projectionEvidence, outcomeStatus }) => ({
            version: 3, status: 'not_completed', sourceRef,
            ticketBatchDigest: ticketBatch?.persistenceDigest || '',
            failureCodes, projectionEvidence, failingModules: ['profile'], outcomeStatus,
        }),
        (value) => String(value || ''),
        (target) => ({
            actorId: target.actorId,
            ...(target.ticketId ? { ticketId: target.ticketId } : {}),
            ...(target.missingFields?.length ? { missingFields: target.missingFields } : {}),
            ...(target.failureCodes?.length ? { failureCodes: target.failureCodes } : {}),
        }),
        () => null,
        () => 'progress-digest',
        async (next, _chatId, options) => {
            savedNamespace = structuredClone(next);
            assert.equal(options.contentValidator(savedNamespace), true);
            return true;
        },
        () => true,
        () => true,
    );
    const persisted = await persist(captured, initial);
    assert.equal(persisted, true);
    assert.deepEqual(savedNamespace.characterCreationTicketBatches[0].failedActorTargets, [{
        actorId: 'NPC-bad', ticketId: 'T-B', missingFields: ['history'],
    }]);
    assert.ok(savedNamespace.actorProfileRetryReceipt.failureCodes.includes('failed_actor:NPC-bad'));
    assert.ok(savedNamespace.actorProfileRetryReceipt.failureCodes.includes('registry_projection_pending'));
    assert.deepEqual(savedNamespace.actorProfileRetryReceipt.projectionEvidence, [{
        actorId: 'NPC-good', profileDigest: actorProfileMvuDigest({ actorId: 'NPC-good' }),
    }]);
});

test('semantic profile root creation preserves legacy siblings and rejects invalid roots', () => {
    const rootSource = section('function actorProfileMvuRootFromData', 'async function settleSemanticActorProfileTransactionTarget');
    const roots = new Function(
        'statDataOf', 'isPlainObject', 'ACTOR_PROFILE_MVU_ROOT',
        `${rootSource}\nreturn { actorProfileMvuRootFromData, actorProfileMvuRootPresent };`,
    )(
        (value) => value?.stat_data || {},
        (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
        '/人物档案/byActorId',
    );
    const withSibling = { stat_data: { 人物档案: { legacySibling: { keep: true } } } };
    assert.equal(roots.actorProfileMvuRootFromData(withSibling), '/人物档案/byActorId');
    assert.equal(roots.actorProfileMvuRootPresent(withSibling), 'root_without_byActorId');
    const invalid = { stat_data: { 人物档案: { byActorId: 'not-an-object' } } };
    assert.equal(roots.actorProfileMvuRootFromData(invalid), '');
    assert.equal(roots.actorProfileMvuRootPresent(invalid), 'invalid');
    assert.equal(roots.actorProfileMvuRootPresent({ stat_data: {} }), 'missing_root');

    const sourceRef = {
        chatId: 'chat-root', messageId: 'message-root', index: 2,
        generationId: 'generation-root', generationSerial: 1,
        generationType: 'normal', scopeDigest: 'scope-root',
        contentFingerprint: 'content-root',
    };
    const bound = {
        entries: [{ mode: 'existing', actorId: 'NPC-root', name: '根人物', fields: {
            person: '根人物来自已接受正文。', personality: '根人物谨慎而幽默。',
            history: '根人物曾在旧城生活。', currentState: '根人物正在修理钟表。',
            relationshipsMotives: '根人物维护邻里关系。',
            knowledgeCapabilitiesResources: '根人物熟悉钟表并有一间小工坊。',
        } }], failures: [], quarantined: [], failedActorTargets: [],
    };
    const compiled = compileActorProfileMvuPatch(bound, {
        profileRoot: '/人物档案/byActorId',
        profileRootPresent: 'root_without_byActorId',
        existingProfiles: {}, sourceRef, readbackVerified: false, completionMode: 'full',
    });
    assert.equal(compiled.ok, true);
    assert.equal(compiled.operations[0].path, '/人物档案/byActorId');
    assert.equal(compiled.operations.some((operation) => operation.path === '/人物档案'), false);
    const unknown = compileActorProfileMvuPatch(bound, {
        profileRoot: '/人物档案/byActorId', profileRootPresent: null,
        existingProfiles: {}, sourceRef, readbackVerified: false, completionMode: 'full',
    });
    assert.equal(unknown.operations.length, 0, 'unknown root state must not create a container');
    assert.equal(unknown.commitStatus, 'quarantined');
});

test('production semantic root rollback restores the exact container state', async () => {
    const rollbackSource = section(
        'async function rollbackSemanticProfileWriteSet',
        'async function replayFinalizedSemanticProfileOperations',
    );
    const rollbackHelpersSource = section(
        'function semanticProfileContainerRollbackOperations',
        'async function rollbackSemanticProfileWriteSet',
    );
    const run = new Function(
        'mvuDataAt', 'parseCandidate', 'commitCandidate', 'sourceRefOf',
        'actorProfileMvuDigest', 'deepClone', 'statDataOf', 'isPlainObject',
        'actorProfileMvuProfilesFromData', `${rollbackHelpersSource}\n${rollbackSource}`
            + '\nreturn rollbackSemanticProfileWriteSet;',
    )(
        async (mvu) => structuredClone(mvu.data),
        async (_mvu, _fresh, text) => ({ status: 'ready', text }),
        async (mvu, candidate) => {
            const operations = JSON.parse(candidate.text.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/u)?.[1] || '[]');
            for (const operation of operations) {
                const parts = String(operation.path || '').split('/').filter(Boolean);
                let cursor = mvu.data.stat_data;
                for (const part of parts.slice(0, -1)) cursor = cursor?.[part];
                if (!cursor) continue;
                const leaf = parts.at(-1);
                if (operation.op === 'remove') delete cursor[leaf];
                else cursor[leaf] = structuredClone(operation.value);
            }
            return { status: 'applied', readbackVerified: true };
        },
        (captured) => captured,
        actorProfileMvuDigest,
        structuredClone,
        (value) => value?.stat_data || {},
        (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
        (data) => data?.stat_data?.['人物档案']?.byActorId || {},
    );
    const write = {
        actorId: 'NPC-root-rollback', path: '/人物档案/byActorId/NPC-root-rollback',
    };
    const profile = { actorRef: { actorId: write.actorId }, narrativeSections: {} };
    const makeMvu = (data) => ({ data });
    const missingRoot = makeMvu({ stat_data: { 人物档案: { byActorId: { [write.actorId]: profile } } } });
    assert.equal(await run({ captured: { index: 0 }, Mvu: missingRoot, profileRoot: '/人物档案/byActorId',
        profileRootPresent: 'missing_root', writeSet: [write], beforeProfiles: {} }), true);
    assert.equal(missingRoot.data.stat_data['人物档案'], undefined);

    const siblingRoot = makeMvu({ stat_data: { 人物档案: {
        legacySibling: { keep: true }, byActorId: { [write.actorId]: profile },
    } } });
    assert.equal(await run({ captured: { index: 0 }, Mvu: siblingRoot, profileRoot: '/人物档案/byActorId',
        profileRootPresent: 'root_without_byActorId', writeSet: [write], beforeProfiles: {} }), true);
    assert.deepEqual(siblingRoot.data.stat_data['人物档案'], { legacySibling: { keep: true } });

    const ready = makeMvu({ stat_data: { 人物档案: { byActorId: {
        [write.actorId]: profile,
    } } } });
    assert.equal(await run({ captured: { index: 0 }, Mvu: ready, profileRoot: '/人物档案/byActorId',
        profileRootPresent: 'ready', writeSet: [write], beforeProfiles: { [write.actorId]: profile } }), true);
    assert.deepEqual(ready.data.stat_data['人物档案'].byActorId[write.actorId], profile);
});

test('v4 projection evidence is sealed, complete for 12 actors, and tamper-evident', () => {
    const sourceRef = {
        chatId: 'chat-evidence', messageId: 'message-evidence', index: 3,
        generation: 1, generationId: 'generation-evidence', generationSerial: 1,
        swipeId: 0,
        generationType: 'normal', scopeDigest: 'scope-evidence',
        contentFingerprint: 'content-evidence',
    };
    const projectionEvidence = Array.from({ length: 12 }, (_, index) => {
        const actorId = index === 11 ? 'ACTOR:legacy.id' : `NPC-evidence-${index}`;
        return {
            actorId,
            profileDigest: actorProfileMvuDigest({ actorId }),
        };
    });
    const receipt = createActorProfileRetryReceipt({
        sourceRef, failingModules: ['profile'],
        failureCodes: ['registry_projection_pending', 'failed_actor:NPC-bad'],
        projectionEvidence, outcomeStatus: 'not_completed', updatedAt: 1,
    });
    assert.equal(receipt.version, 4);
    assert.equal(receipt.projectionEvidence.length, 12);
    assert.equal(actorProfileRetryReceiptMatches(receipt, { currentSourceRef: sourceRef }), true);
    assert.equal(actorProfileRetryReceiptMatches({
        ...receipt,
        projectionEvidence: receipt.projectionEvidence.slice().reverse(),
    }, { currentSourceRef: sourceRef }), false);
    assert.equal(actorProfileRetryReceiptMatches({
        ...receipt,
        projectionEvidence: receipt.projectionEvidence.slice(1),
    }, { currentSourceRef: sourceRef }), false);
    assert.equal(actorProfileRetryReceiptMatches({
        ...receipt,
        receiptDigest: 'profile-retry-receipt:tampered',
    }, { currentSourceRef: sourceRef }), false);
    const sixtyFour = Array.from({ length: 64 }, (_, index) => ({
        actorId: index % 2 ? `NPC-cap-${index}` : `ACTOR:cap.${index}`,
        profileDigest: actorProfileMvuDigest({ actorId: index % 2 ? `NPC-cap-${index}` : `ACTOR:cap.${index}` }),
    }));
    const bounded = createActorProfileRetryReceipt({ sourceRef, projectionEvidence: sixtyFour });
    assert.equal(bounded.projectionEvidence.length, 64);
    const overCapacity = createActorProfileRetryReceipt({
        sourceRef, projectionEvidence: [...sixtyFour, {
            actorId: 'NPC-cap-64', profileDigest: actorProfileMvuDigest({ actorId: 'NPC-cap-64' }),
        }],
    });
    assert.equal(overCapacity, null);
});

test('finalized replay updates only multimodal text parts and a failed save restores the exact swipe', async () => {
    const applySource = section('function applyBlockToCurrentSwipe', 'async function refreshMessage');
    const apply = new Function(
        'STATUS_PLACEHOLDER', 'deepClone', 'normalizedStoredAssistantMessage',
        'preserveActorProfileOperationsOnUpdateBlock', 'replaceUpdateBlocks',
        `${applySource}\nreturn applyBlockToCurrentSwipe;`,
    )(
        '<StatusPlaceHolderImpl/>',
        structuredClone,
        normalizeStoredAssistantMessage,
        (_content, block) => ({ ok: true, block }),
        (content, block) => `${content}\n${block}`,
    );
    const image = { type: 'image_url', image_url: { url: 'private://image' } };
    const message = {
        is_user: false,
        mes: [{ type: 'text', text: '正文' }, image],
        swipe_id: 0,
        swipes: [[{ type: 'text', text: '正文' }, image]],
    };
    assert.equal(apply(message, '<人物档案更新>完成</人物档案更新>', true), true);
    assert.match(message.mes[0].text, /人物档案更新/u);
    assert.deepEqual(message.mes[1], image);
    assert.deepEqual(message.swipes[0][1], image);

    const refreshSource = section('async function refreshMessage', 'async function persistRepairRecord');
    const before = structuredClone(message);
    const context = {
        chat: [message],
        saveChat: async () => { throw new Error('synthetic save failure'); },
        updateMessageBlock() {},
        eventTypes: { MESSAGE_UPDATED: 'message_updated' },
        eventSource: { emit() {} },
    };
    const refresh = new Function(
        'targetIsCurrent', 'getContext', 'deepClone', 'normalizedStoredAssistantMessage',
        'applyBlockToCurrentSwipe', 'console',
        `${refreshSource}\nreturn refreshMessage;`,
    )(
        () => ({ ok: true }),
        () => context,
        structuredClone,
        normalizeStoredAssistantMessage,
        (_message, _block, _include, _remove) => {
            _message.mes[0].text = '临时写入';
            return true;
        },
        { warn() {} },
    );
    assert.equal(await refresh(0, 'x', true), false);
    assert.deepEqual(message, before, 'save failure must restore the original multimodal swipe');
});

test('runtime diagnostic version exactly matches the install manifest', () => {
    const runtimeVersion = source.match(/const VERSION = '([^']+)'/u)?.[1];
    assert.equal(runtimeVersion, manifest.version);
});

test('paired IZUMI preset bytes and runtime version are the candidate truth', async () => {
    const presetPath = new URL('../dist/01_主预设_人物万花筒_可调篇幅_IZUMI0814作者更新_ARGO1.3最小融合候选版.json', import.meta.url);
    const presetBytes = await readFile(presetPath);
    const sha = createHash('sha256').update(presetBytes).digest('hex').toUpperCase();
    assert.match(source, new RegExp(`ACTOR_PROFILE_PRESET_ARTIFACT_EXPECTED_SHA256 = '${sha}'`, 'u'));
    const preset = JSON.parse(presetBytes);
    const named = new Map((preset.prompts || []).map((entry) => [entry.name, entry]));
    assert.equal(named.get('🧾人物档案回执终检V4·兼容历史（停用）')?.enabled, false);
    assert.equal(named.get('🧾人物档案更新语义块V6·accepted-final桥接')?.enabled, true);
    assert.equal(named.get('🧾人物档案回执终检V5·覆盖旧选项顺序')?.enabled, true);
    const enabledProfilePrompts = (preset.prompts || []).filter((entry) => (
        entry.enabled === true && /人物档案|Doctor.*profile/iu.test(String(entry.name || ''))
    ));
    const joined = enabledProfilePrompts.map((entry) => `${entry.name}\n${entry.content || ''}`).join('\n');
    assert.match(joined, /消费了骰票却有字段或生理项缺失时，不得把该人物从回执中省略或改报“人物档案无变化”/u);
    assert.match(joined, /完整 ticketId、自然姓名、可见正文锚点和已经写出的自然段/u);
    assert.match(joined, /<luntan>[\s\S]*?<\/content>[\s\S]*?人物档案[\s\S]*?(?:options|UpdateVariable)/u);
    // The prompt may name the forbidden machine-owned fields in its
    // instruction text.  What must stay semantic-only is the model's
    // sample receipt/output shape, not the explanatory prohibition.
    const outputSample = joined.split('【技术边界】')[0];
    assert.doesNotMatch(outputSample, /(?:^|\n)\s*(?:revision|digest|SourceRef|JSONPatch)\s*[:=]/imu);
});

test('accepted-final profile adapter is exact-source, zero-model, and uses existing MVU transaction', () => {
    const target = section('async function moduleTargetForAcceptedFinal', 'function dispatchAcceptedFinal');
    for (const field of [
        'messageId', 'swipeId', 'generationId', 'generationSerial',
        'contentFingerprint', 'scopeDigest', 'operationEpoch',
    ]) assert.match(target, new RegExp(field, 'u'));

    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.match(semantic, /commitCandidate\(Mvu, candidate/u);
    assert.match(semantic, /requireExactTarget:\s*true, syncFrontend:\s*false/u);
    assert.match(semantic, /replayFinalizedSemanticProfileOperations/u);
    assert.match(source, /async function replayFinalizedSemanticProfileOperations[\s\S]*?mergeActorProfileOperationsIntoAcceptedMessage/u);
    assert.match(semantic, /profileRootPresent/u);
    assert.match(semantic, /projectSemanticProfilesToActorLedger/u);
    assert.match(semantic, /actorProfileExplicitNoChangeReceipt\(messageText\)/u);
    assert.match(semantic, /exactTicketCount:\s*tickets\.length/u);
    assert.match(semantic, /omission === 'profile_block_missing'[\s\S]*?emptyOperations:\s*true/u);
    assert.match(semantic, /actorProfileSemanticNoChange\(captured, acceptedContentText\(messageText\)\)/u);
    assert.match(semantic, /settleSemanticActorProfileTransactionTarget/u);
    assert.match(semantic, /captured = settled\.target/u);
    assert.match(semantic, /const currentData = settled\.data/u);
    assert.doesNotMatch(semantic, /callModel|generateRaw|runActorProfileTarget/u);

    const wrapper = section('async function runSemanticActorProfileTarget(captured)', 'function renderSemanticProfileEntries');
    assert.match(wrapper, /finalizeActorProfileRecoveryOutcome\(captured, result\)/u);
    assert.match(wrapper, /recovery\.recoverySaved === true/u);
    assert.match(wrapper, /profile_finalization_failed/u);
    assert.match(wrapper, /terminalDiagnosticPersisted = false/u);
});

test('production imports the recovery source digest used by semantic failed-actor persistence', () => {
    const importEnd = source.indexOf("from './actor-profile-v6-core.mjs'");
    const importStart = source.lastIndexOf('import {', importEnd);
    const profileImport = source.slice(importStart, importEnd);
    assert.match(profileImport, /actorProfileRecoverySourceDigest/u);
    const value = actorProfileRecoverySourceDigest({
        chatId: 'chat-safe', messageId: 'message-safe', logicalIndex: 2, index: 2,
        swipeId: 0, generation: 1, generationSerial: 1, generationId: 'generation-safe',
        generationType: 'normal', scopeDigest: 'scope-safe', contentFingerprint: 'content-safe',
    });
    assert.match(value, /^profile-source:\d+:[a-f0-9]+$/u);
});

test('semantic profile wrapper converts finalization exceptions into a visible terminal failure', async () => {
    const wrapper = section(
        'async function runSemanticActorProfileTarget(captured)',
        'function renderSemanticProfileEntries',
    );
    const statuses = [];
    let schedulingFailure = '';
    const run = new Function(
        'setActorProfileStatus', 'runSemanticActorProfileTargetCore',
        'actorProfileSemanticFailure', 'finalizeActorProfileRecoveryOutcome',
        'captureTarget', 'getContext', 'sameAcceptedNarrativeTarget', 'sourceRefOf',
        'recordActorProfileFinalDiagnostic', 'compactActorProfileFailureCode',
        'latestActorProfileDiagnostic', 'markActorSchedulingNotReachedByProfile',
        'renderSovereigntyHealth',
        `${wrapper}\nreturn runSemanticActorProfileTarget;`,
    )(
        (text, kind) => statuses.push({ text, kind }),
        async () => ({ status: 'atomic_readback', profileBatch: { committed: ['ACTOR-SAFE'] } }),
        (_captured, reason, extra) => ({
            status: 'not_completed', reason, profileBatch: { failed: [{ code: reason }], ...extra },
        }),
        async () => { throw new ReferenceError('missing private helper'); },
        () => null,
        () => ({ chatId: 'chat-safe' }),
        () => false,
        () => ({ chatId: 'chat-safe', messageId: 'message-safe' }),
        async () => { throw new Error('diagnostic persistence unavailable'); },
        (value) => String(value || '').slice(0, 120),
        null,
        (reason) => { schedulingFailure = reason; },
        () => {},
    );
    const result = await run({ chatId: 'chat-safe', index: 2 });
    assert.equal(result.status, 'not_completed');
    assert.equal(result.reason, 'profile_finalization_failed');
    assert.equal(result.terminalDiagnosticPersisted, false);
    assert.equal(schedulingFailure, 'profile_finalization_failed');
    assert.equal(statuses.at(-1).kind, 'error');
});

test('profile transaction settle tolerates only host-tail normalization and waits for an exact stable MVU base', async () => {
    const helperSource = section(
        'async function settleSemanticActorProfileTransactionTarget',
        'function actorProfileSemanticFailure',
    );
    let messageText = '<content>accepted</content>\n<!-- 人物档案更新\nBLOCK\n-->\n<UpdateVariable>old</UpdateVariable>';
    let mvuVersion = 1;
    let sleeps = 0;
    const context = { chat: [{}, {}, { is_user: false, mes: messageText }] };
    const captured = {
        chatId: 'chat-stable', index: 2, messageId: 'message-2', swipeId: 7,
        generationId: 'generation-8', generationSerial: 8, generationType: 'swipe',
        contentFingerprint: 'accepted-content', fingerprint: 'full-old',
        actorSovereigntyScope: { chatId: 'chat-stable' }, scopeDigest: 'scope-stable',
    };
    const getContext = () => context;
    const captureTarget = () => ({
        ...captured,
        fingerprint: context.chat[2].mes.includes('normalized') ? 'full-normalized' : 'full-old',
    });
    const sameAcceptedNarrativeTarget = (left, right) => Boolean(
        right
        && left.chatId === right.chatId
        && left.messageId === right.messageId
        && left.swipeId === right.swipeId
        && left.generationId === right.generationId
        && left.contentFingerprint === right.contentFingerprint
    );
    const extractActorProfileUpdateBlock = (value) => ({
        ok: true, present: true,
        block: value.includes('BLOCK-CHANGED') ? 'BLOCK-CHANGED' : 'BLOCK',
    });
    const Mvu = { getMvuData() {}, parseMessage() {}, replaceMvuData() {} };
    const dependencies = {
        normalizedStoredAssistantMessage: (message) => (
            message?.is_user === false && typeof message?.mes === 'string'
                ? { ok: true, text: message.mes.trim() }
                : { ok: false, reason: 'assistant_text_shape_unsupported' }
        ),
        getMvu: async () => Mvu,
        getContext,
        captureTarget,
        sameAcceptedNarrativeTarget,
        extractActorProfileUpdateBlock,
        mvuDataAt: async () => ({ stat_data: { version: mvuVersion } }),
        statDataOf: (value) => value?.stat_data,
        fingerprint: (value) => String(value),
        safeJson: (value) => JSON.stringify(value),
        sleep: async () => {
            sleeps += 1;
            if (sleeps === 1) {
                messageText = '<content>accepted</content>\n<!-- 人物档案更新\nBLOCK\n-->\n<UpdateVariable>normalized</UpdateVariable>';
                context.chat[2].mes = messageText;
            }
            if (sleeps === 2) mvuVersion = 2;
        },
    };
    const names = Object.keys(dependencies);
    const settle = new Function(...names, `${helperSource}\nreturn settleSemanticActorProfileTransactionTarget;`)(
        ...Object.values(dependencies),
    );
    const result = await settle(captured, 'BLOCK', {
        stableReads: 3, intervalMs: 1, maxWaitMs: 20,
    });
    assert.equal(result.ok, true);
    assert.equal(result.target.fingerprint, 'full-normalized');
    assert.equal(result.data.stat_data.version, 2);
    assert.ok(sleeps >= 4, 'both host tail and MVU base must remain quiet across repeated reads');

    context.chat[2].mes = context.chat[2].mes.replace('BLOCK', 'BLOCK-CHANGED');
    const changed = await settle(captured, 'BLOCK', {
        stableReads: 2, intervalMs: 1, maxWaitMs: 4,
    });
    assert.equal(changed.ok, false);
    assert.equal(changed.reason, 'profile_source_changed_before_commit');
});

test('P3 starts independently, freezes ready actors, and structure world does not wait for profiles', () => {
    const dispatch = section('function dispatchAcceptedFinal', 'function acceptedFinalDispatchKey');
    const semanticBranch = dispatch.slice(dispatch.indexOf('if (semanticPath)'));
    assert.ok(
        semanticBranch.indexOf("launchScoped('世界连续性'")
            < semanticBranch.indexOf("launchScoped('人物档案'"),
    );
    assert.doesNotMatch(semanticBranch, /await\s+profileTask/u);
    const continuity = section('async function runContinuityTarget', 'async function enqueueContinuity');
    assert.match(continuity, /requireProfileReady:\s*true/u);
    assert.match(continuity, /actor set is frozen/iu);
    assert.match(continuity, /stage3AttachMvuProfilesToLedger/u);
    const enqueue = section('async function enqueueContinuity', 'function stage3AttemptProjection');
    assert.doesNotMatch(enqueue, /afterPending[\s\S]*?enqueueContinuity\(targetId/u);
    const wake = section(
        'async function wakeContinuityAfterProfileTerminal',
        'function dispatchAcceptedFinal',
    );
    assert.match(
        wake,
        /profileResult\?\.status === 'no_candidates'[\s\S]*?profileResult\s*:\s*null/u,
    );
    assert.doesNotMatch(wake, /joinedPendingOwner/u);
    assert.match(wake, /zeroWrite !== true[\s\S]*?worldModelCalls/u);
    assert.match(wake, /freshTarget = await moduleTargetForAcceptedFinal\(envelope\)/u);
    assert.match(wake, /stage3TargetIsCurrent\(freshTarget, operationToken\(freshTarget\)\)/u);
    assert.match(wake, /expectedTarget:\s*freshTarget/u);
    assert.match(wake, /afterPending:\s*false/u);
    const stale = section(
        'function stage3StaleValidationCode',
        'function stage3AcceptedTargetIsStrictlyNewer',
    );
    assert.match(stale, /world_task_owner_changed:\s*'world\.stale\.owner_changed'/u);
    assert.match(stale, /module:\s*'world'[\s\S]*?zeroWrite:\s*true[\s\S]*?worldModelCalls:\s*0/u);
});

test('P4 keeps one exact-once consumer while adding only bounded related ready profiles', () => {
    const p4 = section('function p4RelevantActorIds', 'async function commitNextTurnConsumer');
    assert.match(p4, /slice\(0, Math\.max\(0/u);
    assert.match(p4, /requiredCompletionMode/u);
    assert.match(p4, /actorProfilePromptProjection/u);
    assert.match(p4, /semanticProfileRefMatchesMvu/u);
    assert.match(source, /semanticProfileRefMatchesMvu[\s\S]*sourceRefDigest/u);
    assert.match(p4, /immutableNextTurnConsumerPayload\(worldText, ticketText, profileText\)/u);
    assert.equal((p4.match(/setNextTurnConsumerFallback\(payload\.text\)/gu) || []).length, 1);
});

test('P4 mention relevance uses the exact normalized producer text for multimodal messages', () => {
    const p4Source = section('function p4ProfileProducerTarget', 'async function p4ActorProfileSummary');
    const functions = new Function(
        'stage3AcceptedTarget', 'latestAiMessage', 'getContext', 'captureTarget',
        'stage3AcceptedTargetsMatch', 'normalizeActorLedger', 'actorActionTargetMatches',
        'selectBoundedRelevantActorIds', 'getSettings', 'normalizedStoredAssistantMessage',
        'acceptedContentText', 'stripAssistantAcceptedMechanism',
        `${p4Source}\nreturn { p4ProfileProducerTarget, p4RelevantActorIds };`,
    )(
        (value) => value,
        () => null,
        () => ({ chat: [null, {
            is_user: false,
            mes: [{ type: 'text', text: '林澈在门口观察风向。' }, { type: 'image' }],
        }] }),
        (_context, index) => ({ index, messageId: 'm2', chatId: 'chat-1', generationId: 'g2', scopeDigest: 's1' }),
        () => true,
        (value) => value.actorLedger || value,
        () => false,
        ({ mentionedActorIds, maxActors }) => ({ actorIds: mentionedActorIds, maxActors }),
        () => ({ actorProfilePromptMaxActors: 4, actorProfilePromptMaxChars: 800, actorProfilePromptMaxTokens: 200 }),
        normalizeStoredAssistantMessage,
        (value) => String(value || ''),
        (value) => String(value || '').replace(/<!--[\\s\\S]*?人物档案(?:更新|无变化)[\\s\\S]*?-->/gu, ''),
    );
    const namespace = {
        actorLedger: {
            actors: [
                { id: 'NPC-lin', name: '林澈', identity: { aliases: ['小澈'] } },
                { id: 'NPC-hidden', name: '沈默后台' },
            ],
            actionAttempts: [], actionReceipts: [],
        },
    };
    const packet = {
        producerTarget: { index: 1, messageId: 'm2', chatId: 'chat-1', generationId: 'g2', scopeDigest: 's1' },
        payload: {},
    };
    assert.deepEqual(functions.p4RelevantActorIds(namespace, packet), ['NPC-lin']);

    const unknownContext = () => ({ chat: [null, {
        is_user: false, mes: { text: '林澈' },
    }] });
    const unknownFunctions = new Function(
        'stage3AcceptedTarget', 'getContext', 'captureTarget', 'stage3AcceptedTargetsMatch',
        'normalizeActorLedger', 'actorActionTargetMatches', 'selectBoundedRelevantActorIds',
        'getSettings', 'normalizedStoredAssistantMessage',
        'acceptedContentText', 'stripAssistantAcceptedMechanism',
        `${p4Source}\nreturn p4RelevantActorIds;`,
    )(
        (value) => value, unknownContext,
        (_context, index) => ({ index, messageId: 'm2', chatId: 'chat-1', generationId: 'g2', scopeDigest: 's1' }),
        () => true, (value) => value.actorLedger || value, () => false,
        ({ mentionedActorIds, maxActors }) => ({ actorIds: mentionedActorIds, maxActors }),
        () => ({ actorProfilePromptMaxActors: 4, actorProfilePromptMaxChars: 800, actorProfilePromptMaxTokens: 200 }),
        normalizeStoredAssistantMessage,
        (value) => String(value || ''),
        (value) => String(value || '').replace(/<!--[\\s\\S]*?人物档案(?:更新|无变化)[\\s\\S]*?-->/gu, ''),
    );
    assert.deepEqual(unknownFunctions(namespace, packet), [], 'unsupported stored shape cannot become a mention seed');
});

test('semantic maintenance stays one-person MVU targeted and never enters legacy batch', () => {
    const enqueue = section('async function enqueueActorProfiles', 'async function confirmDangerousAction');
    assert.match(enqueue, /actorProfilePathMode === 'semantic'/u);
    assert.match(enqueue, /includeMaintenance !== true/u);
    assert.match(enqueue, /runSemanticActorProfileTargetedRepair\(expected,[\s\S]*?\{ actorId \}/u);
    assert.match(enqueue, /profileReadiness\(profiles\?\.\[actorId\][\s\S]*requiredCompletionMode/u);
    const semanticBranch = enqueue.slice(
        enqueue.indexOf("if (!legacyPath && getSettings().actorProfilePathMode === 'semantic')"),
        enqueue.indexOf('// A foreground generation may have preempted', enqueue.indexOf("if (!legacyPath")),
    );
    assert.doesNotMatch(semanticBranch, /completeActorProfileBatchTransaction/u);
    const repair = section('async function runSemanticActorProfileTargetedRepair', 'async function migrateLegacyProfilesToMvu');
    assert.match(repair, /prior\.fields[\s\S]*?exact\.fields/u);
    assert.match(repair, /physiologyFields/u);
    const targetedCommit = section('async function commitSemanticTargetedProfileOnly', 'async function migrateLegacyProfilesToMvu');
    assert.match(targetedCommit, /replayFinalizedSemanticProfileOperations/u);
    const migration = section('async function migrateLegacyProfilesToMvu', 'async function runActorProfileTarget');
    assert.match(migration, /replayFinalizedSemanticProfileOperations/u);
    assert.match(migration, /normalizedStoredAssistantMessage\(context\.chat\[captured\.index\]\)/u);
});

test('semantic repair is single-person targeted and legacy migration is explicit and reversible', () => {
    const repair = section('async function runSemanticActorProfileTargetedRepair', 'async function migrateLegacyProfilesToMvu');
    assert.match(repair, /人物档案单人物定向补缺/u);
    assert.match(repair, /targets\.slice\(0, 1\)/u);
    assert.match(repair, /只补全一个人物/u);
    assert.match(repair, /profileReadiness\(currentProfiles\?\.\[requested\][\s\S]*?requiredCompletionMode/u);
    assert.match(repair, /physiology\.generalBaseline/u);
    assert.match(repair, /六项缺一不可/u);
    assert.doesNotMatch(repair, /runActorProfileTarget|completeActorProfilesForTurn/u);
    const migration = section('async function migrateLegacyProfilesToMvu', 'async function runActorProfileTarget');
    assert.match(migration, /compileLegacyActorProfileMigration/u);
    assert.match(migration, /legacyProfiles/u);
    assert.match(migration, /syncFrontend:\s*false/u);
    assert.match(source, /mvuad-profile-migrate/u);
    assert.match(source, /actorProfilePathMode === 'semantic'/u);
});

test('semantic compiler receives the live completion mode instead of hard-coded basic readiness', () => {
    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.match(semantic, /compileActorProfileMvuPatch\(bound,[\s\S]*?completionMode:\s*getSettings\(\)\.actorProfileCompletionMode/u);
    assert.doesNotMatch(semantic, /completionMode:\s*'basic'/u);
});

test('contracted receipt omission fails closed while dedicated tail no-change receipts are valid', () => {
    const helperSource = section(
        'function actorProfileExplicitNoChangeReceipt',
        'function actorProfileSemanticNoChange',
    );
    const helpers = new Function(
        'actorProfileReceiptPlacementAccepted',
        `${helperSource}\nreturn { actorProfileExplicitNoChangeReceipt, actorProfileReceiptOmissionDecision };`,
    )(actorProfileReceiptPlacementAccepted);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<!-- 人物档案无变化 -->',
    ), true);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<!-- 人物档案无变化 -->\n<options>1. 继续</options>',
    ), true);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content><!-- 人物档案无变化 --></content>',
    ), true);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content><!-- 人物档案无变化 -->\n正文仍在继续</content>',
    ), false);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<!-- 人物档案无变化 -->\n<options>1. 继续</options>',
    ), false);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<options>1. 继续</options>\n<!-- 人物档案无变化 -->\n数据库自由文本',
    ), false);
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 32,
        explicitNoChange: false,
    }), 'profile_block_missing');
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 32,
        explicitNoChange: true,
    }), 'no_candidates');
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 0,
        explicitNoChange: false,
    }), 'no_candidates');
});

test('runtime fingerprint binds preset bridge, parser/compiler, transaction, P3, repair and P4', () => {
    const fingerprint = section('function doctorRuntimeCriticalFingerprint', 'function diagnosticPayload');
    assert.match(fingerprint, /ACTOR_PROFILE_MAX_TRANSACTION_ACTORS,/u);
    assert.match(fingerprint, /ACTOR_PROFILE_RECOVERY_EVIDENCE_CAPACITY,/u);
    assert.match(fingerprint, /continuityCoreSemanticFingerprint()/u);
    assert.match(fingerprint, /actorProfilePresetContractVersion\.toString\(\)/u);
    assert.match(fingerprint, /actorProfilePresetContractVersion\(\)/u);
    assert.match(fingerprint, /bindDoctorChatDeletionEvents\.toString\(\)/u);
    assert.match(fingerprint, /bindActorProfilePromptSanitizationEvents\.toString\(\)/u);
    const deletionBinding = section('function bindDoctorChatDeletionEvents', 'function bindActorProfilePromptSanitizationEvents');
    const promptBinding = section('function bindActorProfilePromptSanitizationEvents', 'function bindEvents');
    const bindingBefore = createHash('sha256').update(`${deletionBinding}\n${promptBinding}`).digest('hex');
    const bindingAfter = createHash('sha256')
        .update(`${deletionBinding.replace('GROUP_CHAT_DELETED', 'GROUP_CHAT_DELETED_MUTATED')}\n${promptBinding.replace('CHAT_COMPLETION_PROMPT_READY', 'CHAT_COMPLETION_PROMPT_READY_MUTATED')}`)
        .digest('hex');
    assert.notEqual(bindingBefore, bindingAfter, 'event binding mutations must alter the runtime fingerprint projection');
    for (const helper of [
        'semanticProfileRefMatchesMvu', 'stage3WorldSemanticProfilePromptView',
        'stage3FreshMvuProfileGate', 'p4ProfileProducerTarget',
        'actorProfileSurfaceCacheForCurrentTarget', 'stage3StructuralLaneRowSafe',
        'stage3PositiveStructuralWorldDelta', 'stage3IsolateHeldActorWorldDelta',
    ]) assert.match(fingerprint, new RegExp(`${helper}\\.toString\\(\\)`, 'u'));
    const helperProjection = [
        'semanticProfileRefMatchesMvu', 'stage3WorldSemanticProfilePromptView',
        'stage3FreshMvuProfileGate', 'p4ProfileProducerTarget',
        'actorProfileSurfaceCacheForCurrentTarget', 'stage3StructuralLaneRowSafe',
        'stage3PositiveStructuralWorldDelta', 'stage3IsolateHeldActorWorldDelta',
    ].map((helper) => section(`function ${helper}`, '\nfunction ')).join('\n');
    const before = createHash('sha256').update(helperProjection).digest('hex');
    const after = createHash('sha256').update(helperProjection.replace('return', 'return /*mutation*/')).digest('hex');
    assert.notEqual(before, after, 'a helper-body mutation must alter the fingerprint projection');
    for (const helper of [
        'actorProfileSemanticRuntimeFingerprint',
        'runSemanticActorProfileTarget',
        'runSemanticActorProfileTargetCore',
        'settleSemanticActorProfileTransactionTarget',
        'actorProfileExplicitNoChangeReceipt',
        'actorProfileReceiptOmissionDecision',
        'runSemanticActorProfileTargetedRepair',
        'wakeContinuityAfterProfileTerminal',
        'stage3StaleValidationCode',
        'stage3ZeroWriteStaleResult',
        'projectSemanticProfilesToActorLedger',
        'persistSemanticActorLedgerProjection',
        'stage3AttachMvuProfilesToLedger',
        'p4RelevantActorIds',
        'p4ActorProfileSummary',
        'npcDesignTicketPrompt',
        'immutableNextTurnConsumerPayload',
        'actorProfileSurfaceRuntimeFingerprint',
        'renderActorProfiles',
        'repairActorProfileFromSurface',
        'migrateActorProfileFromSurface',
    ]) assert.match(fingerprint, new RegExp(helper, 'u'));
});

test('production full_adult gate keeps UI, profileRef, P3 and P4 non-ready until all physiology evidence exists', async () => {
    const sourceRef = {
        chatId: 'chat-adult', messageId: 'message-adult', index: 1,
        swipeId: 0,
        generationId: 'generation-adult', generationSerial: 1, generationType: 'normal',
        scopeDigest: 'scope-adult', contentFingerprint: 'content-adult',
        hash: 'content-adult', contentHash: 'content-adult',
    };
    const sections = Object.fromEntries([
        ['person', '人物身份自然段'], ['personality', '人物性格自然段'], ['history', '人物历史自然段'],
        ['currentState', '人物长期状态自然段'], ['relationshipsMotives', '人物关系动机自然段'],
        ['knowledgeCapabilitiesResources', '人物知识能力资源自然段'],
    ].map(([key, text]) => [key, { key, text, source: 'hypothesis' }]));
    const physiology = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS
        .map((key) => `<field key="${key}">${key}的完整生理覆盖证据。</field>`).join('\n');
    const profile = {
        profileFormat: 'narrative-v1', completionMode: 'full_adult',
        actorRef: { actorId: 'NPC-adult-gate', name: '成人档案人物', aliases: [] },
        姓名与别名: { 姓名: '成人档案人物', 别名: [] },
        narrativeSections: {
            ...sections,
            physiology: { key: 'physiology', text: physiology, source: 'hypothesis', contractVersion: 2 },
        },
        本地元数据: {
            status: 'readback_ready', readbackVerified: true, revision: 2,
            sourceRef, sourceRefDigest: actorProfileMvuSourceRefDigest(sourceRef),
        },
    };
    const readinessRefSource = section(
        'function semanticProfileReadinessRef',
        'function semanticProfileRefMatchesMvu',
    );
    const makeReadinessRef = new Function(
        'deepClone', 'actorProfileMvuDigest', `${readinessRefSource}\nreturn semanticProfileReadinessRef;`,
    )(structuredClone, actorProfileMvuDigest);
    const generatedRef = makeReadinessRef(profile, {
        actorId: profile.actorRef.actorId, profileDigest: actorProfileMvuDigest(profile), revision: 2,
    }, { ...sourceRef }, '/人物档案/byActorId');
    const actor = {
        id: profile.actorRef.actorId, name: profile.actorRef.name,
        profileRef: generatedRef,
    };
    const ledger = { chatId: sourceRef.chatId, actors: [actor], actionAttempts: [], actionReceipts: [] };
    assert.equal(profileReadiness(profile, { requiredCompletionMode: 'full_adult' }).ready, true);
    assert.equal(actorProfileReadinessInLedger(ledger, actor.id, {
        requiredCompletionMode: 'full_adult', profileOverride: profile, requireProfileOverride: true,
    }).ready, true);
    const healthyView = createActorProfileSurfaceView({
        profiles: { [actor.id]: profile }, actors: [actor], currentTarget: sourceRef,
        completionMode: 'full_adult',
    });
    assert.equal(healthyView.cards[0].status.color, 'green');

    const semanticMatchSource = section(
        'function semanticProfileRefMatchesMvu',
        'async function persistSemanticActorLedgerProjection',
    );
    const semanticMatch = new Function(
        'profileReadiness', 'actorProfileMvuDigest', 'actorProfileMvuSourceRefDigest',
        'ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION',
        `${semanticMatchSource}\nreturn semanticProfileRefMatchesMvu;`,
    )(
        profileReadiness, actorProfileMvuDigest, actorProfileMvuSourceRefDigest, 2,
    );
    const gateSource = section(
        'async function stage3FreshMvuProfileGate',
        'function stage3ValidateWorldDraftInMemory',
    );
    const mvuData = { stat_data: { 人物档案: { byActorId: { [actor.id]: profile } } } };
    const gate = new Function(
        'getMvu', 'mvuDataAt', 'actorProfileMvuProfilesFromData', 'ACTOR_PROFILE_MVU_ROOT',
        'profileReadiness', 'semanticProfileRefMatchesMvu', 'actorProfileReadinessInLedger',
        `${gateSource}\nreturn stage3FreshMvuProfileGate;`,
    )(
        async () => ({ getMvuData: async () => mvuData }),
        async (mvu) => mvu.getMvuData(),
        (data) => data?.stat_data?.['人物档案']?.byActorId || {},
        '/人物档案/byActorId', profileReadiness, semanticMatch, actorProfileReadinessInLedger,
    );
    const gateHealthy = await gate(sourceRef, ledger, [actor.id], {
        actorProfileCompletionMode: 'full_adult',
    });
    assert.deepEqual(gateHealthy.invalidActorIds, []);
    assert.deepEqual(Object.keys(gateHealthy.profiles), [actor.id]);
    assert.equal(semanticMatch(actor.profileRef, profile, { requiredCompletionMode: 'full_adult' }), true);

    const producerMessage = { is_user: false, mes: '成人档案人物在门口观察风向。' };
    const producerTarget = {
        ...sourceRef, index: 0, messageId: 'message-adult-producer',
    };
    const p4Source = section('function p4ProfileProducerTarget', 'function immutableNextTurnConsumerPayload');
    const p4 = new Function(
        'stage3AcceptedTarget', 'latestAiMessage', 'getContext', 'captureTarget',
        'stage3AcceptedTargetsMatch', 'normalizeActorLedger', 'actorActionTargetMatches',
        'selectBoundedRelevantActorIds', 'getSettings', 'normalizedStoredAssistantMessage',
        'acceptedContentText', 'stripAssistantAcceptedMechanism', 'getMvu', 'mvuDataAt',
        'actorProfileMvuProfilesFromData', 'ACTOR_PROFILE_MVU_ROOT', 'actorProfilePromptProjection',
        'semanticProfileRefMatchesMvu', 'stage3WorldPromptText', 'stage3WorldPromptValue',
        'composeActorOperationalState', 'doctorMvuActorRuntimeById', 'actorOperationalPromptProjection',
        `${p4Source}\nreturn p4ActorProfileSummary;`,
    )(
        (value) => value, () => null, () => ({ chat: [producerMessage] }),
        () => producerTarget, () => true, (value) => value,
        () => false, ({ inSceneActorIds, mentionedActorIds, eventActorIds, maxActors }) => ({
            actorIds: [...new Set([...inSceneActorIds, ...mentionedActorIds, ...eventActorIds])], maxActors,
        }),
        () => ({ actorProfileCompletionMode: 'full_adult', actorProfilePromptMaxActors: 4,
            actorProfilePromptMaxChars: 1800, actorProfilePromptMaxTokens: 400, actorRuntimeBindings: {} }),
        normalizeStoredAssistantMessage, (value) => String(value || ''),
        (value) => String(value || ''), async () => ({ getMvuData: async () => mvuData }),
        async (mvu) => mvu.getMvuData(), (data) => data?.stat_data?.['人物档案']?.byActorId || {},
        '/人物档案/byActorId', actorProfilePromptProjection, semanticMatch,
        (value, max) => String(value || '').slice(0, max),
        (value) => JSON.stringify(value || ''), composeActorOperationalState,
        () => ({}), actorOperationalPromptProjection,
    );
    const p4Namespace = { actorLedger: ledger, continuity: { threads: [] } };
    const p4Packet = { producerTarget, payload: { visibleActorIds: [actor.id] }, turn: 8 };
    const healthyP4 = await p4(p4Namespace, p4Packet);
    assert.match(healthyP4, /成人档案人物/u);

    const incomplete = structuredClone(profile);
    incomplete.narrativeSections.physiology.text = incomplete.narrativeSections.physiology.text
        .replace(/<field key="[^"]+">[\s\S]*?<\/field>\s*/u, '');
    const incompleteActor = structuredClone(actor);
    incompleteActor.profileRef.digest = actorProfileMvuDigest(incomplete);
    const incompleteLedger = { ...ledger, actors: [incompleteActor] };
    mvuData.stat_data['人物档案'].byActorId[actor.id] = incomplete;
    const gateIncomplete = await gate(sourceRef, incompleteLedger, [actor.id], {
        actorProfileCompletionMode: 'full_adult',
    });
    assert.deepEqual(gateIncomplete.invalidActorIds, [actor.id]);
    assert.deepEqual(gateIncomplete.validActorIds, []);
    const incompleteP4 = await p4({ actorLedger: incompleteLedger, continuity: { threads: [] } }, p4Packet);
    assert.equal(incompleteP4, '');
    assert.equal(profileReadiness(incomplete, { requiredCompletionMode: 'full_adult' }).ready, false);
    assert.equal(actorProfileReadinessInLedger(incompleteLedger, incompleteActor.id, {
        requiredCompletionMode: 'full_adult', profileOverride: incomplete, requireProfileOverride: true,
    }).ready, false);
    const redView = createActorProfileSurfaceView({
        profiles: { [incompleteActor.id]: incomplete }, actors: [incompleteActor],
        currentTarget: sourceRef, completionMode: 'full_adult',
    });
    assert.equal(redView.cards[0].status.color, 'red');
    assert.equal(redView.cards[0].status.repairable, true);
    assert.ok(
        profileReadiness(incomplete, { requiredCompletionMode: 'full_adult' }).missingFields.length > 0,
        'strict full_adult gate must expose the missing physiology evidence',
    );
});

test('partial semantic profile batch remains repairable per failed ActorId', () => {
    const recovery = section('async function persistActorProfileRecoveryState', 'async function finalizeActorProfileRecoveryOutcome');
    assert.match(recovery, /partialProfileBatch/u);
    assert.match(recovery, /retryable = status === 'not_completed'[\s\S]*partialProfileBatch/u);
    assert.match(recovery, /failed_actor:/u);
    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.match(semantic, /partialCommit[\s\S]*not_completed/u);
    assert.match(semantic, /committed:[\s\S]*failed:[\s\S]*partial/u);
});

test('database and worldbook have no write authority in the semantic profile transaction', () => {
    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.doesNotMatch(semantic, /TavernDB|tableEdit|database|worldbook|writeWorld/u);
    assert.match(source, /independent_modules_no_global_settlement/u);
});
