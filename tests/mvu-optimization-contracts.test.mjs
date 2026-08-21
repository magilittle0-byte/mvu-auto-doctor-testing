import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    sanitizeActorProfilePromptPayload,
    sanitizeActorProfilePromptPayloadInPlace,
    inspectFlatPromptAfterAssistantChatSanitized,
    sanitizeFlatPromptByExactAssistantSource,
    stripActorProfileReceiptBlocks,
} from '../prompt-context-core.mjs';
import {
    extractDeletedChatId,
    planDoctorChatScopeDisposal,
} from '../doctor-chat-scope-core.mjs';
import {
    actorOperationalPromptProjection,
    composeActorOperationalState,
    operationalActorEligible,
} from '../actor-operational-state-core.mjs';
import {
    compressResolvedContinuityHistory,
    enforceContinuityPolicy,
    mergeMarkerRecords,
    normalizeContinuityState,
    parseContinuityOutput,
} from '../continuity-core.mjs';
import {
    bindActorProfileUpdateEntries,
    compileActorProfileMvuPatch,
    parseActorProfileUpdateBlock,
    profileReadiness,
} from '../actor-profile-mvu-core.mjs';
import { actorIdFromScopedIdentity, actorRefFrom } from '../actor-ref-core.mjs';
import { issueCharacterCreationTicket } from '../actor-profile-v6-core.mjs';
import {
    admitDoctorWorldCandidates,
    classifyWorldPressureCandidate,
    normalizeWorldPressureState,
} from '../world-pressure-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const actorLedgerSource = fs.readFileSync(path.join(root, 'actor-ledger-core.mjs'), 'utf8');

test('A: prompt-ready sanitizes outgoing multimodal copy without mutating stored chat', () => {
    const stored = [{ role: 'assistant', mes: [{ type: 'text', text: '正文<人物档案更新>旧档案</人物档案更新>' }] }];
    const before = structuredClone(stored);
    const result = sanitizeActorProfilePromptPayload({ chat: stored }, stored);
    assert.deepEqual(stored, before);
    assert.equal(result.unsupported, false);
    assert.equal(result.eventData.chat[0].mes[0].text, '正文');
    const flat = sanitizeActorProfilePromptPayload(
        { prompt: '系统合同\n正文<人物档案更新>旧档案</人物档案更新>' },
        stored,
    );
    assert.equal(flat.eventData.prompt, '系统合同\n正文');
    assert.match(indexSource, /sanitizeActorProfilePromptEvent\(eventData, eventName\)/u);
    assert.match(indexSource, /context\?\.chat\?\.\[producerIndex\]/u);
});

test('A: flat prompt fails closed when exact content[] source cannot be proven', () => {
    const result = sanitizeFlatPromptByExactAssistantSource(
        '预设合同\n<人物档案更新>源档案</人物档案更新>',
        [{ role: 'assistant', content: [{ type: 'image', url: 'x' }, { type: 'text', text: '不同正文<人物档案更新>源档案</人物档案更新>' }] }],
    );
    assert.equal(result.unsupported, true);
    assert.match(result.prompt, /<人物档案更新>/u);
});

test('A: exact source fallback aggregates multimodal candidates and never scans marker prose', () => {
    const noChange = '<!-- 人物档案无变化 -->';
    const stored = [
        { role: 'system', content: `系统示例 ${noChange}` },
        { role: 'assistant', content: [{ type: 'text', text: `正文${noChange}` }, { type: 'image', url: 'x' }] },
        { role: 'assistant', mes: `另一条${noChange}` },
    ];
    const before = structuredClone(stored);
    const chatEvent = { chat: stored };
    const chatResult = sanitizeActorProfilePromptPayloadInPlace(chatEvent, stored);
    assert.equal(chatResult.unsupported, false);
    assert.equal(chatEvent.chat[0].content, `系统示例 ${noChange}`);
    assert.equal(chatEvent.chat[1].content[0].text, '正文');
    assert.equal(chatEvent.chat[2].mes, '另一条');
    assert.deepEqual(stored, before);

    const combined = { prompt: `系统示例 ${noChange}\n正文\n另一条` };
    const afterChat = inspectFlatPromptAfterAssistantChatSanitized(combined.prompt, stored, {
        assistantSanitized: true,
    });
    assert.equal(afterChat.unsupported, false);
    assert.equal(afterChat.prompt, combined.prompt, 'system contract example remains verbatim');

    const fallback = sanitizeFlatPromptByExactAssistantSource(
        `系统合同\n正文${noChange}`,
        [{ role: 'assistant', mes: `正文${noChange}` }],
    );
    assert.equal(fallback.unsupported, false);
    assert.equal(fallback.prompt, '系统合同\n正文');

    const mixed = sanitizeFlatPromptByExactAssistantSource(
        `正文${noChange}\n变形${noChange}尾部`,
        [{ role: 'assistant', mes: `正文${noChange}` }, { role: 'assistant', mes: `另一条${noChange}` }],
    );
    assert.equal(mixed.replaced, 0, 'ambiguous fallback must not partially erase the payload');
    assert.equal(mixed.unsupported, true);
});

test('A: receipt tags have exact marker boundaries and duplicate evidence is aggregated', () => {
    const bridge = '<人物档案更新_语义桥接>系统合同</人物档案更新_语义桥接>';
    const explanation = '<人物档案更新说明>系统合同</人物档案更新说明>';
    assert.equal(stripActorProfileReceiptBlocks(`${bridge}\n${explanation}`).removed, 0);
    const same = '<!-- 人物档案无变化 -->';
    const result = sanitizeFlatPromptByExactAssistantSource(
        `正文${same}\n另一条${same}`,
        [{ role: 'assistant', mes: `正文${same}` }, { role: 'assistant', mes: `另一条${same}` }],
    );
    assert.equal(result.unsupported, false);
    assert.equal(result.replaced, 2);
    assert.doesNotMatch(result.prompt, /人物档案无变化/u);
});

test('A: prompt-ready proof counts one multimodal nonassistant message once and blocks residue', () => {
    const marker = '<!-- 人物档案无变化 -->';
    const stored = [
        { role: 'system', content: `系统合同示例 ${marker}` },
        { role: 'user', content: [{ type: 'text', text: `用户引用 ${marker}` }, { type: 'text', text: '' }] },
        { role: 'assistant', content: `正文${marker}` },
    ];
    const safe = `系统合同示例 ${marker}\n用户引用 ${marker}`;
    assert.equal(
        inspectFlatPromptAfterAssistantChatSanitized(safe, stored, { assistantSanitized: true }).unsupported,
        false,
    );
    const leaked = `${safe}\n正文${marker}`;
    assert.equal(
        inspectFlatPromptAfterAssistantChatSanitized(leaked, stored, { assistantSanitized: true }).unsupported,
        true,
    );
    assert.equal(
        inspectFlatPromptAfterAssistantChatSanitized(`用户自己写 ${marker}`, [stored[1]], {
            assistantSanitized: true,
        }).unsupported,
        false,
    );
    const unclosed = '<人物档案更新>残片';
    assert.equal(
        inspectFlatPromptAfterAssistantChatSanitized(unclosed, [{ role: 'assistant', mes: unclosed }], {
            assistantSanitized: true,
        }).unsupported,
        true,
    );
});

test('B: deletion payload is fail-closed and scope planning is exact', () => {
    assert.equal(extractDeletedChatId({ id: 'message-not-chat' }), '');
    assert.equal(extractDeletedChatId(42), '');
    assert.equal(extractDeletedChatId('chat-a'), '');
    assert.equal(extractDeletedChatId('chat-a', {
        __doctorChatScopeOptions: true,
        allowPositionalString: true,
    }), 'chat-a');
    const plan = planDoctorChatScopeDisposal('old', 'current');
    assert.equal(plan.ok, true);
    assert.equal(plan.chatId, 'old');
    assert.equal(plan.current, false);
    assert.match(plan.storageKey, /mvu-auto-doctor-profile-fold-v1:/u);
    assert.doesNotMatch(indexSource, /localStorage\.clear\s*\(/u);
    assert.match(indexSource, /extractDeletedChatId\(chatFileName,\s*\{[\s\S]*allowPositionalString: true/u);
});

test('B: production deletion wiring handles group scopes only with exact owned positional ids', () => {
    const helperStart = indexSource.indexOf('function bindDoctorChatDeletionEvents');
    const helperEnd = indexSource.indexOf('function bindActorProfilePromptSanitizationEvents', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    const handlers = new Map();
    const disposed = [];
    const disposeCalls = [];
    const statuses = [];
    const context = { eventSource: { on: (name, handler) => handlers.set(name, handler) } };
    const bind = new Function(
        'context', 'types', 'setStatus', 'extractDeletedChatId', 'disposeDoctorChatScope',
        `${indexSource.slice(helperStart, helperEnd)}\nreturn bindDoctorChatDeletionEvents;`,
    )(
        context,
        { CHAT_DELETED: 'chat_deleted', GROUP_CHAT_DELETED: 'group_chat_deleted' },
        (message) => statuses.push(message), extractDeletedChatId,
        (chatId, options) => {
            disposeCalls.push({ chatId, options });
            if (chatId === 'group-a') disposed.push({ chatId, options });
        },
    );
    bind(context, { CHAT_DELETED: 'chat_deleted', GROUP_CHAT_DELETED: 'group_chat_deleted' });

    assert.deepEqual([...handlers.keys()].sort(), ['chat_deleted', 'group_chat_deleted']);
    handlers.get('group_chat_deleted')('group-a');
    assert.deepEqual(disposed, [{ chatId: 'group-a', options: { reason: 'group_chat_deleted' } }], 'exact group id disposes even when only a special cache remains');
    handlers.get('group_chat_deleted')('group-not-owned');
    handlers.get('group_chat_deleted')({ chatId: 'group-a' });
    assert.equal(disposeCalls.length, 2, 'only proved positional strings reach the disposer');
    assert.equal(disposed.length, 1, 'an unowned exact string is a safe idempotent no-op');
    assert.equal(statuses.length, 1);
});

test('A: production prompt-ready helper preserves social-first/profile/continuity ordering', () => {
    const helperStart = indexSource.indexOf('function bindActorProfilePromptSanitizationEvents');
    const helperEnd = indexSource.indexOf('function bindEvents', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    const calls = [];
    const handlers = new Map();
    const bind = new Function(
        'context', 'types', 'setStatus', 'lastActorProfilePromptSanitization',
        'sanitizeSocialPromptEvent', 'sanitizeActorProfilePromptEvent',
        'ensureActorProfileTicketPromptInOutgoingPayload', 'inspectContinuityInjectionEvent',
        `${indexSource.slice(helperStart, helperEnd)}\nreturn bindActorProfilePromptSanitizationEvents;`,
    )(
        { eventSource: { on: (name, handler) => handlers.set(name, handler) } },
        {
            CHAT_COMPLETION_PROMPT_READY: 'prompt-ready',
            GENERATE_AFTER_COMBINE_PROMPTS: 'after-combine',
        },
        () => {}, { status: 'not-yet', unsupported: false },
        (_data, name) => calls.push(`social:${name}`),
        (_data, name) => calls.push(`profile:${name}`),
        (_data, name) => {
            calls.push(`ticket:${name}`);
            return { ok: true, landed: true };
        },
        () => calls.push('continuity'),
    );
    bind(
        { eventSource: { on: (name, handler) => handlers.set(name, handler) } },
        {
            CHAT_COMPLETION_PROMPT_READY: 'prompt-ready',
            GENERATE_AFTER_COMBINE_PROMPTS: 'after-combine',
        },
    );
    assert.deepEqual([...handlers.keys()].sort(), ['after-combine', 'prompt-ready']);
    handlers.get('prompt-ready')({ prompt: 'x' });
    assert.deepEqual(calls, [
        'social:prompt-ready',
        'profile:prompt-ready',
        'ticket:prompt-ready',
        'continuity',
    ]);
    assert.match(indexSource, /bindActorProfilePromptSanitizationEvents\(context, types\)/u);
});

test('B: production invalidateOperations clears task owners with the invalidated ids', () => {
    const start = indexSource.indexOf('function invalidateOperations(');
    const end = indexSource.indexOf('function worldCallReservedForUserCancellation', start);
    assert.ok(start >= 0 && end > start);
    const taskIds = new Set(['old-task', 'current-task']);
    const owners = new Map([
        ['old-task', { chatId: 'old-chat' }],
        ['current-task', { chatId: 'current-chat' }],
    ]);
    const pending = new Set(['pending']);
    const activeControllers = new Set();
    const sandbox = {
        operationEpoch: 4,
        activeSovereigntyTaskIds: taskIds,
        activeSovereigntyTaskOwners: owners,
        activeModelControllers: activeControllers,
        activeTaskProgress: null,
        pendingOpeningSyncTimer: null,
        automaticPendingKeys: pending,
        actorProfilePendingKeys: new Set(['actor']),
        runChain: Promise.resolve(), actorProfileChain: Promise.resolve(), forumChain: Promise.resolve(),
        invalidateDoctorRepairCenterRequests: () => {},
        invalidateContinuityQueue: () => {},
        syncTaskCancelButtons: () => {},
        finishTaskProgress: () => {},
    };
    const names = [
        'operationEpoch', 'invalidateDoctorRepairCenterRequests', 'activeModelControllers',
        'activeSovereigntyTaskIds', 'activeSovereigntyTaskOwners', 'activeTaskProgress',
        'finishTaskProgress', 'syncTaskCancelButtons', 'pendingOpeningSyncTimer',
        'automaticPendingKeys', 'runChain', 'actorProfilePendingKeys', 'actorProfileChain',
        'invalidateContinuityQueue', 'forumChain',
    ];
    const inspect = new Function(...names, `${indexSource.slice(start, end)}\ninvalidateOperations('chat_changed', { persistProgress: false });\nreturn { operationEpoch, taskCount: activeSovereigntyTaskIds.size, ownerCount: activeSovereigntyTaskOwners.size };`)(
        ...names.map((name) => sandbox[name]),
    );
    assert.equal(inspect.operationEpoch, 5, 'invalidation advances the operation epoch');
    assert.equal(inspect.taskCount, 0);
    assert.equal(inspect.ownerCount, 0);
    assert.equal(pending.size, 0);
    assert.equal(sandbox.actorProfilePendingKeys.size, 0);
});

test('C: only newly resolved thread is compressed; old resolved history is unchanged', () => {
    const previous = {
        turn: 3,
        threads: [{
            id: 'old', title: '旧事件', stage: 'resolved', resolution: '旧结局',
            effects: ['旧影响'], rumors: ['旧风声'], trigger: '旧触发',
            offscreenBeat: '旧过程', convergence: { score: 4, evidence: ['旧日志'] },
        }],
    };
    const next = {
        ...previous,
        turn: 4,
        threads: [...previous.threads, {
            id: 'new', title: '新事件', stage: 'resolved', resolution: '新结局',
            effects: ['新影响'], rumors: ['新风声'], trigger: '新触发',
            offscreenBeat: '过程', nextBeat: '过程2', propagation: ['日志'],
            convergence: { score: 4, evidence: ['日志'] },
        }],
    };
    const compacted = compressResolvedContinuityHistory(previous, next);
    const old = compacted.threads.find((thread) => thread.id === 'old');
    const fresh = compacted.threads.find((thread) => thread.id === 'new');
    assert.equal(old.offscreenBeat, '旧过程');
    assert.equal(old.convergence.score, 4);
    assert.equal(fresh.offscreenBeat, '');
    assert.equal(fresh.nextBeat, '');
    assert.deepEqual(fresh.propagation, []);
    assert.equal(fresh.convergence.score, 0);
    assert.match(indexSource, /settleActorLedgerInjectionReceipts\(captured\)/u);
});

test('C: resolved history has a bounded archive without dropping active threads or durable effects', () => {
    const threads = [
        { id: 'active-1', title: '进行中', stage: 'active', origin: 'main_derivative' },
        { id: 'dormant-1', title: '休眠中', stage: 'dormant', origin: 'main_derivative' },
        ...Array.from({ length: 40 }, (_, index) => ({
            id: `resolved-${index + 1}`,
            title: `事件${index + 1}`,
            stage: 'resolved',
            resolvedTurn: index + 1,
            resolution: `结局${index + 1}`,
            effects: [`持续影响${index + 1}`],
            rumors: [`风声${index + 1}`],
            trigger: `未来触发${index + 1}`,
            sourceRefs: [
                { chatId: 'chat-c', messageId: `origin-${index + 1}`, index: 1, generation: 1, contentFingerprint: 'origin' },
                { chatId: 'chat-c', messageId: `settled-${index + 1}`, index: 2, generation: 2, contentFingerprint: 'settled' },
            ],
            offscreenBeat: '应被压缩的过程',
        })),
    ];
    const normalized = normalizeContinuityState({ turn: 8, threads }, { maxResolved: 2 });
    assert.deepEqual(normalized.threads.map((thread) => thread.id), [
        'active-1', 'dormant-1', 'resolved-39', 'resolved-40',
    ]);
    assert.equal(normalized.resolvedArchive.length, 32);
    assert.ok(normalized.resolvedArchiveRollup.effects.includes('持续影响1'));
    assert.ok(normalized.resolvedArchiveRollup.rumors.includes('风声1'));
    assert.ok(normalized.resolvedArchiveRollup.triggers.includes('未来触发1'));
    assert.ok(normalized.resolvedArchiveRollup.sourceRefs.some((ref) => ref.messageId === 'origin-1'));
    assert.equal(normalized.resolvedArchive[0].offscreenBeat, undefined);
    const reopened = mergeMarkerRecords(normalized, [{
        id: 'resolved-1', stage: 'active', title: '错误重开', lastAdvancedTurn: 1, effects: ['伪造'],
    }], { maxThreads: 12 });
    assert.equal(reopened.threads.some((thread) => thread.id === 'resolved-1'), false);
    assert.ok(reopened.resolvedArchiveRollup.threadIds.includes('resolved-1'));
    assert.ok(normalized.resolvedArchiveRollup.tombstoneThroughTurn >= 6);
});

test('C: archive rollover keeps a monotonic tombstone beyond the bounded ID list', () => {
    const state = normalizeContinuityState({
        turn: 400,
        threads: Array.from({ length: 400 }, (_, index) => ({
            id: `overflow-${index + 1}`,
            title: `过期事件${index + 1}`,
            stage: 'resolved',
            resolvedTurn: index + 1,
            effects: [`资源影响${index + 1}`],
            rumors: [`风声${index + 1}`],
            futureTrigger: `未来触发${index + 1}`,
            sourceRefs: [{ chatId: 'chat-c', messageId: `source-${index + 1}` }],
        })),
    }, { maxResolved: 1 });
    assert.equal(state.resolvedArchive.length, 32);
    assert.equal(state.resolvedArchiveRollup.threadIds.length, 256);
    assert.ok(state.resolvedArchiveRollup.tombstoneThroughTurn >= 367);
    assert.ok(state.resolvedArchiveRollup.effects.includes('资源影响1'));
    const oldReopen = mergeMarkerRecords(state, [{
        id: 'overflow-1', stage: 'active', title: '不能重开', lastAdvancedTurn: 1,
    }]);
    assert.equal(oldReopen.threads.some((thread) => thread.id === 'overflow-1'), false);
    const newThread = mergeMarkerRecords(state, [{
        id: 'new-live', stage: 'active', title: '新事件', lastAdvancedTurn: 400,
    }]);
    assert.ok(newThread.threads.some((thread) => thread.id === 'new-live'));
});

test('C: enforceContinuityPolicy cannot reopen resolved or tombstoned threads', () => {
    const resolvedBefore = normalizeContinuityState({
        turn: 5,
        threads: [{
            id: 'done', title: '已结束事件', stage: 'resolved', resolvedTurn: 5,
            resolution: '结局已落定', effects: ['持续事实'],
        }],
        lastTick: { turn: 5, action: 'resolved', threadId: 'done', reason: '已结束' },
    });
    const reopenedCandidate = {
        ...resolvedBefore,
        turn: 6,
        threads: [{
            ...resolvedBefore.threads[0],
            stage: 'advancing',
            resolvedTurn: 0,
            lastAdvancedTurn: 6,
            summary: '伪造重开',
        }],
        lastTick: { turn: 6, action: 'advanced', threadId: 'done', reason: '伪造推进' },
    };
    const preserved = enforceContinuityPolicy(resolvedBefore, reopenedCandidate);
    const done = preserved.threads.find((thread) => thread.id === 'done');
    assert.equal(done.stage, 'resolved');
    assert.equal(done.resolvedTurn, 5);
    assert.deepEqual(done.effects, ['持续事实']);
    assert.equal(preserved.lastTick.threadId, 'done');
    assert.equal(preserved.lastTick.action, 'resolved');

    const archivedBefore = normalizeContinuityState({
        turn: 40,
        threads: Array.from({ length: 4 }, (_, index) => ({
            id: `archived-${index + 1}`,
            title: `旧事件${index + 1}`,
            stage: 'resolved',
            resolvedTurn: index + 1,
            resolution: `结局${index + 1}`,
            effects: [`事实${index + 1}`],
        })),
    }, { maxResolved: 1 });
    assert.ok(archivedBefore.resolvedArchive.some((thread) => thread.id === 'archived-1'));
    const archivedAttempt = enforceContinuityPolicy(archivedBefore, {
        ...archivedBefore,
        turn: 41,
        threads: [{
            id: 'archived-1', title: '错误重建', stage: 'advancing',
            origin: 'main_derivative', seedBasis: '旧来源', createdTurn: 41,
            lastAdvancedTurn: 41,
        }],
    });
    assert.equal(archivedAttempt.threads.some((thread) => thread.id === 'archived-1'), false);

    const rollupBefore = normalizeContinuityState({
        turn: 50,
        resolvedArchiveRollup: {
            threadIds: ['rollup-old'],
            tombstoneThroughTurn: 30,
        },
    });
    const rollupAttempt = enforceContinuityPolicy(rollupBefore, {
        ...rollupBefore,
        turn: 51,
        threads: [{
            id: 'rollup-old', title: '滚动归档重建', stage: 'advancing',
            origin: 'main_derivative', seedBasis: '旧来源', createdTurn: 51,
            lastAdvancedTurn: 51,
        }],
    });
    assert.equal(rollupAttempt.threads.some((thread) => thread.id === 'rollup-old'), false);

    const oldLostAttempt = enforceContinuityPolicy(rollupBefore, {
        ...rollupBefore,
        turn: 51,
        threads: [{
            id: 'lost-old', title: '已丢失ID的旧事件', stage: 'advancing',
            origin: 'main_derivative', seedBasis: '旧来源', createdTurn: 20,
            lastAdvancedTurn: 20,
        }],
    });
    assert.equal(oldLostAttempt.threads.some((thread) => thread.id === 'lost-old'), false);

    const fresh = enforceContinuityPolicy(rollupBefore, {
        ...rollupBefore,
        turn: 51,
        threads: [{
            id: 'fresh-after-tombstone', title: '真正新事件', stage: 'advancing',
            origin: 'main_derivative', seedBasis: '新的可验证来源', createdTurn: 31,
            lastAdvancedTurn: 31,
        }],
    });
    assert.ok(fresh.threads.some((thread) => thread.id === 'fresh-after-tombstone'));
    assert.equal(fresh.lastTick.action, 'created');
    assert.equal(fresh.lastTick.threadId, 'fresh-after-tombstone');
});

test('C: selected world lanes consume pressure and retain durable admission receipts', () => {
    const state = normalizeWorldPressureState({ turn: 4, phase: 'exploration' });
    const selected = [
        classifyWorldPressureCandidate({ id: 'selected-faction', laneType: 'faction', label: '势力变化' }, {
            id: 'selected-faction', channel: 'faction', sameScene: false,
        }),
    ];
    const unselected = Array.from({ length: 6 }, (_, index) => (
        classifyWorldPressureCandidate({ id: `unselected-${index}`, laneType: 'environment', label: '后台环境' }, {
            id: `unselected-${index}`, channel: 'environment', sameScene: false,
        })
    ));
    const admitted = admitDoctorWorldCandidates(state, selected, {
        turn: 5, injectionLimit: 1, pressureCap: 3, sameSceneBossCap: 1,
    });
    assert.deepEqual(admitted.admitted.map((entry) => entry.id), ['selected-faction']);
    assert.ok(admitted.receipts.some((receipt) => receipt.candidateId === 'selected-faction'));
    assert.equal(unselected.some((entry) => admitted.receipts.some((receipt) => receipt.candidateId === entry.id)), false);
    assert.equal(JSON.stringify(admitted.state), JSON.stringify(admitDoctorWorldCandidates(
        state, selected, { turn: 5, injectionLimit: 1, pressureCap: 3, sameSceneBossCap: 1 },
    ).state));
    assert.match(indexSource, /pressureInputLanes = rawWorldLaneSchedule\.selected/u);
    assert.match(indexSource, /JSON\.stringify\(persisted\?\.worldPressure/u);
});

test('C: raw continuity provenance survives parsing for positive structural admission', () => {
    const parsed = parseContinuityOutput(JSON.stringify({
        turn: 2,
        threads: [{ id: 'thread-1', stage: 'active', title: '势力推进', sourceId: 'faction:pressure' }],
        world: { factions: [{ id: 'faction-1', sourceId: 'faction:pressure', condition: '紧张' }] },
    }));
    assert.equal(parsed.raw.threads[0].sourceId, 'faction:pressure');
    assert.match(indexSource, /rawThreads:\s*workingParsed\.raw\?\.threads/u);
    assert.match(indexSource, /const provenance = \[row\.sourceId, row\.sourceThreadId, row\.laneId\]/u);
    assert.doesNotMatch(indexSource, /provenance = \[[^\]]*row\.id/u);
});

test('D: full_adult readiness is strict across old profiles and canonical physiology prose', () => {
    const sections = Object.fromEntries([
        'person', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, { text: `${key}完整内容`, source: 'confirmed' }]));
    const physiology = [
        '一般体征：稳定的一般体征描述。',
        '生殖解剖：与物种相符的生殖系统描述。',
        '第二性征：明确的第二性征描述。',
        '生殖功能：周期与功能的客观描述。',
        '性刺激下的生理反应：生理反应与敏感部位描述。',
        '生理限制：物种相关的明确限制描述。',
    ].join('\n');
    const base = {
        profileFormat: 'narrative-v1',
        completionMode: 'full',
        narrativeSections: sections,
        localMetadata: { status: 'readback_ready', readbackVerified: true },
    };
    assert.equal(profileReadiness(base, { requiredCompletionMode: 'full_adult' }).ready, false);
    const complete = structuredClone(base);
    complete.narrativeSections.physiology = {
        text: physiology, source: 'confirmed', contractVersion: 2,
    };
    assert.equal(profileReadiness(complete, { requiredCompletionMode: 'full_adult' }).ready, true);
    const missing = structuredClone(complete);
    missing.narrativeSections.physiology.text = physiology.replace('生理限制：物种相关的明确限制描述。', '');
    assert.equal(profileReadiness(missing, { requiredCompletionMode: 'full_adult' }).ready, false);
    assert.match(indexSource, /actorProfilePromptProjection\([\s\S]*?requiredCompletionMode/u);
    assert.match(indexSource, /requiredCompletionMode:\s*settings\.actorProfileCompletionMode/u);
});

test('D: configured MVU runtime binding is exact, dynamic, and JSON-Pointer safe', () => {
    const start = indexSource.indexOf('function doctorMvuActorRuntimeById');
    const end = indexSource.indexOf('\nfunction actorLedgerOperationalCandidateView', start);
    const helper = new Function('statDataOf', 'isPlainObject', 'deepClone', `${indexSource.slice(start, end)}\nreturn doctorMvuActorRuntimeById;`)(
        (value) => value?.stat_data,
        (value) => value && typeof value === 'object' && !Array.isArray(value),
        (value) => structuredClone(value),
    );
    const result = helper({ stat_data: { 状态: { 人物: {
        'Actor-1': { 位置: '北门', 资源: { 粮食: 2 }, '键/值': 'escaped' },
        'Actor-2': { 位置: '南门', 资源: { 粮食: 3 } },
    } } } }, {
        byActorPath: '/状态/人物',
        fields: { location: '/位置', resources: '/资源', condition: '/键~1值' },
    });
    assert.equal(result['Actor-1'].location, '北门');
    assert.equal(result['Actor-2'].resources.粮食, 3);
    assert.equal(result['Actor-1'].condition, 'escaped');
    assert.equal(helper({ stat_data: { 状态: { 人物: { '__proto__': { 位置: 'bad' } } } } }, {
        byActorPath: '/状态/人物', fields: { location: '/位置' },
    })['Actor-1'], undefined);
    assert.deepEqual(helper({ stat_data: { 状态: { 人物: { 'Actor-1': { 位置: 'bad' } } } } }, {
        byActorPath: '/状态/*', fields: { location: '/位置' },
    }), {});
});

test('D: operational projection is bounded, MVU wins, and absolute cooldown is consumed', () => {
    const state = composeActorOperationalState({
        actor: {
            id: 'actor-1', status: 'active', nextActionTurn: 8,
            profileRef: { status: 'ready', readbackVerified: true },
            location: 'legacy-location', resources: ['legacy-resource'],
        },
        actorId: 'actor-1',
        profileReady: true,
        profileEvolution: { goal: '长期目标', blocker: '可重规划阻碍' },
        mvuRuntimeByActorId: {
            'actor-1': { location: 'MVU地点', resources: { food: 2 }, actionable: true, turn: 7 },
        },
        receipts: [],
        openThreads: [{ id: 'thread-1', actorRefs: [{ actorId: 'actor-1' }] }],
    });
    assert.equal(state.location, 'MVU地点');
    assert.equal(state.fieldSources.location, 'mvu_runtime');
    assert.equal(state.cooldownUntilTurn, 8);
    assert.equal(state.lastEffectiveChangeTurn, 7);
    assert.equal(state.fieldSources.lastEffectiveChangeTurn, 'mvu_runtime');
    assert.equal(operationalActorEligible(state, 7), false);
    assert.equal(operationalActorEligible(state, 8), true);
    const projection = actorOperationalPromptProjection(state, { maxChars: 120, maxTokens: 30 });
    assert.ok(projection.usedChars <= 120);
    assert.ok(projection.usedTokens <= 30);
    assert.ok(projection.omitted.length > 0);
    assert.match(actorLedgerSource, /operationalActorEligible\(/u);
    assert.match(indexSource, /doctorMvuActorRuntimeById\(\s*runtimeData,\s*settings\.actorRuntimeBindings\s*,?/u);
    assert.match(indexSource, /source: 'legacy_observation'/u);
    const blocked = composeActorOperationalState({
        actor: { id: 'actor-2', status: 'active', profileRef: { status: 'ready', readbackVerified: true } },
        actorId: 'actor-2', profileReady: false,
        mvuRuntimeByActorId: { 'actor-2': { actionable: true, location: '伪提升' } },
    });
    assert.equal(blocked.actionable, false, 'runtime actionable cannot promote a strict profile failure');
    const unchanged = composeActorOperationalState({
        actor: { id: 'actor-3', status: 'active', profileRef: { status: 'ready', readbackVerified: true } },
        actorId: 'actor-3', profileReady: true, receipts: [],
    });
    assert.equal(unchanged.lastEffectiveChangeTurn, 0, 'no runtime/receipt change must not invent a turn');
    assert.equal(unchanged.fieldSources.lastEffectiveChangeTurn, 'unbound');
});

test('D: same-turn attempt identity is required before a new attempt can run', () => {
    const baseActor = {
        id: 'actor-attempt', status: 'active',
        lastAction: { id: 'ATT-B', summary: '新尝试', turn: 8 },
        lastAttemptTurn: 8, nextActionTurn: 8,
    };
    const oldReceipt = {
        actorId: 'actor-attempt', attemptId: 'ATT-A', status: 'adjudicated',
        worldAdjudicated: true, summary: '旧行动', resultSummary: '旧结果', turn: 8,
        target: { kind: 'actor_attempt', attemptId: 'ATT-A' },
    };
    const pending = composeActorOperationalState({
        actor: baseActor, actorId: baseActor.id, profileReady: true,
        receipts: [oldReceipt], currentTurn: 8,
    });
    assert.equal(pending.lastAction, '旧行动');
    assert.equal(pending.lastOutcome, '旧结果');
    assert.equal(pending.lastAttemptId, 'ATT-B');
    assert.equal(pending.settledAttemptId, '', 'a different same-turn receipt cannot settle ATT-B');
    assert.equal(pending.lastAttemptPending, true);
    assert.equal(operationalActorEligible(pending, 8), false);

    const settled = composeActorOperationalState({
        actor: baseActor, actorId: baseActor.id, profileReady: true,
        receipts: [{ ...oldReceipt, attemptId: 'ATT-B', summary: '新行动', resultSummary: '新结果',
            target: { kind: 'actor_attempt', attemptId: 'ATT-B' } }], currentTurn: 8,
    });
    assert.equal(settled.lastAction, '新行动');
    assert.equal(settled.lastOutcome, '新结果');
    assert.equal(settled.lastAttemptPending, false);
    assert.equal(operationalActorEligible(settled, 8), true);
});

test('A/D: issued ticket keeps stable ActorId while accepted natural name and visible anchor are authoritative', () => {
    const actorId = actorIdFromScopedIdentity('ticket-natural-name', {
        chatId: 'chat-ticket', identityKey: 'ticket-natural-name',
    });
    const ticket = issueCharacterCreationTicket({ id: 'ticket-seed', name: '原创人物骰票1' }, {
        entropy: 'ticket-natural-name',
        target: { chatId: 'chat-ticket', generation: 1, generationId: 'generation-ticket', generationType: 'normal' },
        order: 1,
    });
    const reservedActorRef = actorRefFrom({ actorId, displayName: '' }, { allowCreate: false });
    const reserved = {
        ...ticket,
        reservedActorRef,
        reservation: {
            status: 'reserved', chatId: 'chat-ticket', generationId: 'generation-ticket',
            generationSerial: 1, generationType: 'normal', ticketId: ticket.ticketId, actorId,
        },
    };
    const sourceRef = {
        chatId: 'chat-ticket', messageId: 'message-ticket', index: 2,
        generationId: 'generation-ticket', generationSerial: 1, generationType: 'normal',
        scopeDigest: 'scope-ticket', contentFingerprint: 'content-ticket',
    };
    const fullFields = [
        '人物信息：林岚是港口的修表匠。', '性格特征：她谨慎但愿意帮助陌生人。',
        '过往经历：她曾在旧城钟楼学习机械。', '当前状态：她正在寻找失踪的兄长。',
        '关系与动机：她信任邻居并想查明真相。', '知识、能力与资源：她熟悉钟表结构并有一间小工坊。',
    ].join('\n');
    const accepted = `<content>林岚走进港口，在雨里抬头看向旧钟楼。</content>\n<!-- 人物档案更新\n新增人物｜ticket=${ticket.ticketId}｜姓名：林岚｜正文锚点：林岚走进港口\n${fullFields}\n-->`;
    const parsed = parseActorProfileUpdateBlock(accepted);
    const bound = bindActorProfileUpdateEntries(parsed, {
        tickets: [reserved], acceptedNarrative: '林岚走进港口，在雨里抬头看向旧钟楼。', sourceRef,
    });
    assert.equal(bound.entries[0].actorId, actorId);
    assert.equal(bound.entries[0].name, '林岚');
    assert.equal(bound.failedActorTargets.length, 0);
    const compiled = compileActorProfileMvuPatch(bound, {
        sourceRef, profileRootPresent: 'ready', readbackVerified: false,
    });
    assert.equal(compiled.writeSet[0].actorId, actorId);
    assert.equal(compiled.profiles[actorId].actorRef.name, '林岚');
    assert.doesNotMatch(JSON.stringify(compiled.profiles[actorId]), /原创人物骰票1/u);

    const noAnchor = parseActorProfileUpdateBlock(
        accepted.replace('正文锚点：林岚走进港口', '正文锚点：'),
    );
    const quarantined = bindActorProfileUpdateEntries(noAnchor, {
        tickets: [reserved], acceptedNarrative: '林岚走进港口，在雨里抬头看向旧钟楼。',
    });
    assert.equal(quarantined.entries.length, 0);
    assert.equal(quarantined.failedActorTargets[0].actorId, actorId);
    assert.equal(quarantined.failedActorTargets[0].name, '林岚');
    assert.equal(quarantined.failedActorTargets[0].ticketId, ticket.ticketId);

    const wrongReservation = { ...reserved, reservation: { ...reserved.reservation, actorId: `${actorId}-wrong` } };
    const wrong = bindActorProfileUpdateEntries(parsed, {
        tickets: [wrongReservation], acceptedNarrative: '林岚走进港口，在雨里抬头看向旧钟楼。',
    });
    assert.equal(wrong.entries.length, 0);
    assert.match(wrong.quarantined[0].reason, /ticket|actor/iu);
});

test('D: current attempt receipt is selected by attemptId even when same-turn receipt order changes', () => {
    const actor = {
        id: 'actor-two-receipts', status: 'active', profileRef: { status: 'ready', readbackVerified: true },
        lastAction: { id: 'ATT-B', turn: 8, summary: 'B attempt' }, lastAttemptTurn: 8, nextActionTurn: 8,
    };
    const receiptA = {
        actorId: actor.id, attemptId: 'ATT-A', status: 'adjudicated', worldAdjudicated: true,
        summary: 'A action', resultSummary: 'A result', turn: 8,
        target: { kind: 'actor_attempt', attemptId: 'ATT-A' },
    };
    const receiptB = { ...receiptA, attemptId: 'ATT-B', summary: 'B action', resultSummary: 'B result',
        target: { kind: 'actor_attempt', attemptId: 'ATT-B' } };
    for (const receipts of [[receiptA, receiptB], [receiptB, receiptA]]) {
        const state = composeActorOperationalState({ actor, actorId: actor.id, profileReady: true, receipts,
            currentTurn: 8 });
        assert.equal(state.lastAction, 'B action');
        assert.equal(state.lastOutcome, 'B result');
        assert.equal(state.settledAttemptId, 'ATT-B');
        assert.equal(state.lastAttemptPending, false);
    }
    const onlyA = composeActorOperationalState({ actor, actorId: actor.id, profileReady: true,
        receipts: [receiptA], currentTurn: 8 });
    assert.equal(onlyA.lastAction, 'A action');
    assert.equal(onlyA.lastAttemptPending, true);
});
