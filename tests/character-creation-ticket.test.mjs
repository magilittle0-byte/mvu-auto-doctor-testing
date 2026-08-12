import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    CHARACTER_CREATION_TICKET_AXIS_NAMES,
    CHARACTER_CREATION_TICKET_VERSION,
    bindActorProfileDesignRolls,
    bindCharacterCreationTicket,
    bindCharacterCreationTicketsToRegisteredActors,
    issueCharacterCreationTicket,
    normalizeActorProfileDesignRolls,
    prepareActorProfileV6,
    selectActorProfileCompletionCandidates,
} from '../actor-profile-v6-core.mjs';

const requiredAxes = [
    'valuePriority',
    'temperament',
    'coreDesire',
    'thinkingStyle',
    'socialMotive',
    'socialMethod',
    'interestOrientation',
    'decisionMethod',
    'conflictStyle',
    'moralBoundary',
    'speechRhythm',
    'actionHabit',
    'humorMethod',
    'authorityAttitude',
    'relationshipDistance',
    'ordinaryFriction',
    'selfDeception',
    'pressureAndRecovery',
    'everydayTexture',
    'independentLifeFocus',
];

function preGenerationTarget(overrides = {}) {
    return {
        chatId: 'chat-A',
        generation: 7,
        generationId: 'generation-7',
        generationType: 'normal',
        ...overrides,
    };
}

function acceptedTarget(overrides = {}) {
    return {
        ...preGenerationTarget(),
        messageId: 'message-4',
        index: 4,
        swipeId: 0,
        hash: 'content-hash-A',
        ...overrides,
    };
}

function ticket(order = 1, target = preGenerationTarget()) {
    return issueCharacterCreationTicket({
        id: `${target.generationId}|slot:${order}`,
        name: `原创人物票${order}`,
    }, {
        entropy: `${target.chatId}|${target.generationId}|${order}`,
        target,
        order,
    });
}

function actor(id, name, profileV6 = undefined) {
    return { id, name, profileV6 };
}

function candidate(id, name, target = acceptedTarget(), sourceKind = 'accepted_narrative') {
    return {
        candidateId: id,
        name,
        sourceKind,
        sourceRef: {
            chatId: target.chatId,
            messageId: target.messageId,
            index: target.index,
            swipeId: target.swipeId,
            generation: target.generation,
            hash: target.hash,
        },
    };
}

function registrationEntry(candidateId, actorId, name, created = true) {
    return {
        candidateId,
        actorRef: { actorId, displayName: name, aliases: [] },
        created,
    };
}

function batch(target = preGenerationTarget(), tickets = [ticket(1, target), ticket(2, target)]) {
    return {
        ...target,
        generationSerial: target.generation,
        capacity: tickets.length,
        tickets,
    };
}

test('characterCreationTicket is issued before narrative with every required independent axis', () => {
    const issued = ticket();
    assert.equal(issued.version, CHARACTER_CREATION_TICKET_VERSION);
    assert.equal(issued.version, 3);
    assert.equal(issued.kind, 'character_creation_ticket');
    assert.deepEqual(issued.binding, null);
    assert.equal(issued.issuance.chatId, 'chat-A');
    assert.equal(issued.issuance.generationId, 'generation-7');
    assert.equal(issued.issuance.order, 1);
    assert.deepEqual(CHARACTER_CREATION_TICKET_AXIS_NAMES, requiredAxes);
    assert.deepEqual(Object.keys(issued.axes), requiredAxes);
    assert.ok(requiredAxes.every((axis) => issued.axes[axis]?.result));
});

test('post-generation binding preserves the same ticket and records the full target plus ActorRef', () => {
    const issued = ticket();
    const target = acceptedTarget();
    const bound = bindCharacterCreationTicket(issued, {
        target,
        actorRef: { actorId: 'NPC-1', displayName: '林桥', aliases: ['小桥'] },
        order: 1,
    });
    assert.ok(bound);
    assert.equal(bound.ticketId, issued.ticketId, '绑定只能使用生成前同一张票');
    assert.deepEqual(bound.axes, issued.axes, '绑定不得重掷或替换任一轴');
    assert.deepEqual(bound.binding, {
        ...target,
        order: 1,
        actorRef: { actorId: 'NPC-1', displayName: '林桥', aliases: ['小桥'] },
    });
});

test('P5 replaces exactly four axes with approved mature tables and keeps every result independent', () => {
    const issued = ticket();
    const matureTables = {
        coreDesire: [
            '完整正确 vs 缺陷败坏', '被爱被需 vs 不被爱/无用',
            '价值钦佩 vs 毫无价值/失败', '独特真我 vs 平庸/有缺陷',
            '能力全知 vs 无能/被压倒', '安全支持 vs 缺乏指引/孤立',
            '快乐满足 vs 痛苦/匮乏', '掌控独立 vs 被控/受伤害',
            '和谐宁静 vs 冲突/分离',
        ],
        socialMethod: ['直说', '绕开', '交易', '观察', '玩笑', '礼貌疏离', '照顾细节'],
        decisionMethod: ['先核价', '凭经验', '问人', '试错', '留退路', '服从程序', '看心情'],
        relationshipDistance: [
            '自信且乐于建立亲密关系，能有效沟通需求与感受，在独处与陪伴中取得平衡。',
            '渴望高度亲密，但缺乏自信，常担心被伴侣抛弃，对关系状态高度敏感且寻求过度肯定。',
            '高度独立，倾向于压抑情感，视亲密关系为对自主性的威胁，并回避情感依赖。',
            '对亲密关系既渴望又恐惧，因害怕被拒绝或受伤害而回避亲密，行为模式常表现为矛盾与不稳定。',
        ],
    };
    for (const [axis, values] of Object.entries(matureTables)) {
        assert.ok(values.includes(issued.axes[axis].result), `${axis} must use its approved table`);
        assert.equal(issued.axes[axis].die, `d${values.length}`);
    }
    assert.equal(new Set(Object.values(issued.axes)).size, requiredAxes.length);
    assert.equal(typeof issued.axes.thinkingStyle.result, 'string');
    assert.equal(typeof issued.axes.conflictStyle.result, 'string');
    assert.doesNotMatch(JSON.stringify(issued), /MBTI|Tritype|九型人格|依恋类型/u);
});

test('multiple new original actors bind tickets in accepted first-appearance order', () => {
    const target = acceptedTarget();
    const tickets = [ticket(1), ticket(2)];
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors: [actor('NPC-A', '林桥'), actor('NPC-B', '周岚')],
    }, {
        registration: {
            promoted: [
                registrationEntry('C-A', 'NPC-A', '林桥'),
                registrationEntry('C-B', 'NPC-B', '周岚'),
            ],
        },
        candidates: [candidate('C-A', '林桥'), candidate('C-B', '周岚')],
        batch: batch(preGenerationTarget(), tickets),
        target,
    });
    assert.equal(result.matched, true);
    assert.deepEqual(result.bindings.map((entry) => entry.actorRef.actorId), ['NPC-A', 'NPC-B']);
    assert.deepEqual(result.bindings.map((entry) => entry.order), [1, 2]);
    assert.equal(result.ledger.actors[0].profileV6.designRolls.ticketId, tickets[0].ticketId);
    assert.equal(result.ledger.actors[1].profileV6.designRolls.ticketId, tickets[1].ticketId);
});

for (const actorCount of [0, 1, 3, 6, 10]) {
    test(`production binding consumes exactly ${actorCount} ticket(s) for ${actorCount} new actor(s)`, () => {
        const target = acceptedTarget();
        const pool = Array.from({ length: 12 }, (_, index) => ticket(index + 1));
        const actors = Array.from({ length: actorCount }, (_, index) => (
            actor(`NPC-${index + 1}`, `Original ${index + 1}`)
        ));
        const promoted = actors.map((entry, index) => (
            registrationEntry(`C-${index + 1}`, entry.id, entry.name)
        ));
        const candidates = actors.map((entry, index) => (
            candidate(`C-${index + 1}`, entry.name)
        ));
        const result = bindCharacterCreationTicketsToRegisteredActors({
            chatId: target.chatId,
            actors,
        }, {
            registration: { promoted },
            candidates,
            batch: batch(preGenerationTarget(), pool),
            target,
        });
        assert.equal(result.matched, true);
        assert.equal(result.bindings.length, actorCount);
        assert.equal(result.ticketPool.consumed, actorCount);
        assert.equal(result.ticketPool.eligible, actorCount);
        assert.equal(result.ticketPool.exhausted, false);
        assert.deepEqual(
            result.bindings.map((entry) => entry.ticketId),
            pool.slice(0, actorCount).map((entry) => entry.ticketId),
        );
    });
}

test('existing and authority-backed actors are protected without consuming an original ticket', () => {
    const target = acceptedTarget();
    const firstTicket = ticket(1);
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors: [
            actor('NPC-OLD', '旧识'),
            actor('NPC-CARD', '卡设人物'),
            actor('NPC-NEW', '纸鸢'),
        ],
    }, {
        registration: {
            promoted: [
                registrationEntry('C-OLD', 'NPC-OLD', '旧识', false),
                registrationEntry('C-CARD', 'NPC-CARD', '卡设人物'),
                registrationEntry('C-NEW', 'NPC-NEW', '纸鸢'),
            ],
        },
        candidates: [
            candidate('C-OLD', '旧识'),
            candidate('C-CARD', '卡设人物'),
            candidate('C-NEW', '纸鸢'),
        ],
        batch: batch(preGenerationTarget(), [firstTicket]),
        target,
        protectedActorNames: ['卡设人物'],
    });
    assert.equal(result.bindings.length, 1);
    assert.equal(result.bindings[0].actorRef.actorId, 'NPC-NEW');
    assert.equal(result.bindings[0].ticketId, firstTicket.ticketId);
    assert.equal(result.ledger.actors[0].profileV6, undefined);
    assert.equal(result.ledger.actors[1].profileV6, undefined);
});

test('partial card or worldbook facts discard only their established axes and fill real blanks', () => {
    const target = acceptedTarget();
    const issued = ticket(1);
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors: [actor('NPC-YE', '叶青')],
    }, {
        registration: { promoted: [registrationEntry('C-YE', 'NPC-YE', '叶青')] },
        candidates: [candidate('C-YE', '叶青')],
        batch: batch(preGenerationTarget(), [issued]),
        target,
        authorityText: '世界书｜叶青｜价值观：兑现承诺；表达习惯：先复述事实再提问。',
    });
    assert.equal(result.bindings.length, 1);
    assert.deepEqual(
        new Set(result.bindings[0].discardedAxes),
        new Set(['valuePriority', 'speechRhythm']),
    );
    assert.equal(
        result.ledger.actors[0].profileV6.designRolls.axes.temperament.result,
        issued.axes.temperament.result,
        '没有权威设定的气质轴仍可用于填补真实空白',
    );
});

test('structured profile or MVU fields occupy their exact axes before any free-text adapter', () => {
    const target = acceptedTarget();
    const issued = ticket(1);
    const structuredActor = actor('NPC-STRUCTURED', '程澈');
    structuredActor.identity = {
        socialStyle: '先确认边界再交换信息',
        boundaries: ['不替别人作出不可撤回的选择'],
        everydayHabits: [],
        blindSpots: [],
        desires: [],
    };
    structuredActor.longTermGoals = [];
    structuredActor.relationships = [];
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors: [structuredActor],
    }, {
        registration: {
            promoted: [registrationEntry('C-STRUCTURED', 'NPC-STRUCTURED', '程澈')],
        },
        candidates: [candidate('C-STRUCTURED', '程澈')],
        batch: batch(preGenerationTarget(), [issued]),
        target,
        authorityText: '程澈在这一段自由文本里只是被提到，没有明确轴名声明。',
    });
    assert.equal(result.bindings[0].ticketId, issued.ticketId);
    assert.deepEqual(
        new Set(result.bindings[0].discardedAxes),
        new Set(['socialMethod', 'moralBoundary']),
    );
    assert.equal(
        result.ledger.actors[0].profileV6.designRolls.axes.thinkingStyle.result,
        issued.axes.thinkingStyle.result,
    );
});

test('axis conflicts discard only named low-priority axes while retaining the same ticket', () => {
    const issued = ticket();
    const discarded = ['moralBoundary', 'speechRhythm'];
    const bound = bindCharacterCreationTicket(issued, {
        target: acceptedTarget(),
        actorRef: { actorId: 'NPC-1', displayName: '林桥' },
        order: 1,
        discardedAxes: discarded,
    });
    assert.equal(bound.ticketId, issued.ticketId);
    assert.deepEqual(bound.discardedAxes, discarded);
    assert.equal(bound.axes.temperament.result, issued.axes.temperament.result);
    assert.equal(bound.axes.coreDesire.result, issued.axes.coreDesire.result);
    assert.equal(Object.keys(bound.axes).length, Object.keys(issued.axes).length);
});

test('reroll, swipe, chat and late-generation targets cannot reuse another generation ticket', () => {
    const originalTicket = ticket();
    const rerollTicket = ticket(1, preGenerationTarget({
        generation: 8,
        generationId: 'generation-8',
        generationType: 'regenerate',
    }));
    assert.notEqual(rerollTicket.ticketId, originalTicket.ticketId);

    for (const target of [
        acceptedTarget({ chatId: 'chat-B' }),
        acceptedTarget({ generation: 8, generationId: 'generation-8' }),
        acceptedTarget({ generation: 8, generationId: 'generation-late' }),
    ]) {
        const result = bindCharacterCreationTicketsToRegisteredActors({
            chatId: target.chatId,
            actors: [actor('NPC-A', '林桥')],
        }, {
            registration: { promoted: [registrationEntry('C-A', 'NPC-A', '林桥')] },
            candidates: [candidate('C-A', '林桥', target)],
            batch: batch(preGenerationTarget(), [originalTicket]),
            target,
        });
        assert.equal(result.matched, false);
        assert.equal(result.bindings.length, 0);
    }

    const wrongSwipe = acceptedTarget({ swipeId: 2 });
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: wrongSwipe.chatId,
        actors: [actor('NPC-A', '林桥')],
    }, {
        registration: { promoted: [registrationEntry('C-A', 'NPC-A', '林桥')] },
        candidates: [candidate('C-A', '林桥', acceptedTarget({ swipeId: 1 }))],
        batch: batch(preGenerationTarget(), [originalTicket]),
        target: wrongSwipe,
    });
    assert.equal(result.matched, true);
    assert.equal(result.bindings.length, 0, '同generation但错误swipe也不得串票');
});

test('a generation with no newly registered original actor consumes no ticket', () => {
    const issued = ticket();
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: 'chat-A',
        actors: [actor('NPC-OLD', '旧识')],
    }, {
        registration: { promoted: [registrationEntry('C-OLD', 'NPC-OLD', '旧识', false)] },
        candidates: [candidate('C-OLD', '旧识')],
        batch: batch(preGenerationTarget(), [issued]),
        target: acceptedTarget(),
    });
    assert.equal(result.matched, true);
    assert.deepEqual(result.bindings, []);
    assert.equal(result.ledger.actors[0].profileV6, undefined);
    assert.equal(result.ticketPool.consumed, 0);
    assert.equal(result.ticketPool.eligible, 0);
});

test('pool exhaustion is explicit, preserves every actor, and still queues full profile completion', () => {
    const target = acceptedTarget();
    const pool = [ticket(1), ticket(2)];
    const actors = [
        actor('NPC-1', 'Original 1'),
        actor('NPC-2', 'Original 2'),
        actor('NPC-3', 'Original 3'),
    ];
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors,
    }, {
        registration: {
            promoted: actors.map((entry, index) => (
                registrationEntry(`C-${index + 1}`, entry.id, entry.name)
            )),
        },
        candidates: actors.map((entry, index) => candidate(`C-${index + 1}`, entry.name)),
        batch: batch(preGenerationTarget(), pool),
        target,
    });
    assert.equal(result.ledger.actors.length, 3, 'exhaustion must not merge or delete actors');
    assert.equal(result.bindings.length, 2);
    assert.deepEqual(result.ticketPool, {
        capacity: 2,
        issued: 2,
        eligible: 3,
        consumed: 2,
        remaining: 0,
        exhausted: true,
        eligibleActorRefs: actors.map((entry) => ({
            actorId: entry.id,
            displayName: entry.name,
            aliases: [],
        })),
        exhaustedActorRefs: [{
            actorId: 'NPC-3',
            displayName: 'Original 3',
            aliases: [],
        }],
    });
    assert.equal(result.ledger.actors[2].profileV6, undefined, 'no post-narrative reroll');
    const completionCandidates = selectActorProfileCompletionCandidates(result.ledger, {
        maxActors: 8,
        priorityActorIds: actors.map((entry) => entry.id),
    });
    assert.deepEqual(
        completionCandidates.map((entry) => entry.actorId),
        ['NPC-1', 'NPC-2', 'NPC-3'],
        'P1 completion must include the exhausted actor without inventing a ticket',
    );
    assert.equal(completionCandidates[2].designRolls, null);
});

test('exact replay reads the persisted binding and consumes no second ticket', () => {
    const target = acceptedTarget();
    const issued = ticket(1);
    const options = {
        registration: { promoted: [registrationEntry('C-1', 'NPC-1', 'Original 1')] },
        candidates: [candidate('C-1', 'Original 1')],
        batch: batch(preGenerationTarget(), [issued]),
        target,
    };
    const first = bindCharacterCreationTicketsToRegisteredActors({
        chatId: target.chatId,
        actors: [actor('NPC-1', 'Original 1')],
    }, options);
    const replay = bindCharacterCreationTicketsToRegisteredActors(first.ledger, options);
    assert.equal(replay.bindings.length, 0);
    assert.equal(replay.ticketPool.consumed, 0);
    assert.equal(replay.ticketPool.eligible, 0);
    assert.ok(replay.skipped.includes('NPC-1:ticket_already_bound'));
    assert.equal(
        replay.ledger.actors[0].profileV6.designRolls.ticketId,
        issued.ticketId,
    );
});

test('baseline personality ticket remains stable while per-turn dynamic emotion changes', () => {
    const bound = bindCharacterCreationTicket(ticket(1), {
        target: acceptedTarget(),
        actorRef: { actorId: 'NPC-1', displayName: 'Original 1' },
        order: 1,
    });
    const baseActor = bindActorProfileDesignRolls({
        id: 'NPC-1',
        name: 'Original 1',
        status: '紧张',
        stateFacts: [],
        stimuli: [{ kind: 'noise' }],
    }, bound);
    const tense = prepareActorProfileV6(baseActor, { mode: 'full', turn: 1, now: 100 });
    const calm = prepareActorProfileV6({
        ...baseActor,
        profileV6: tense,
        status: '平静',
        stimuli: [],
    }, { mode: 'full', turn: 2, now: 200 });
    assert.deepEqual(calm.designRolls, tense.designRolls);
    assert.equal(tense.modules.dynamicState.data.status, '紧张');
    assert.equal(calm.modules.dynamicState.data.status, '平静');
    assert.doesNotMatch(JSON.stringify(calm.designRolls), /紧张|平静/u);
});

test('legacy V1 persisted tickets are normalized but local doctor preparation never issues a replacement', () => {
    const issued = ticket();
    const legacyV2 = { ...issued, version: 2 };
    assert.equal(normalizeActorProfileDesignRolls(legacyV2)?.version, 2);
    assert.equal(bindCharacterCreationTicket(legacyV2, {
        target: acceptedTarget(),
        actorRef: { actorId: 'NPC-V2', displayName: 'Legacy V2' },
        order: 1,
    })?.ticketId, legacyV2.ticketId);
    const legacy = {
        version: 1,
        seed: issued.seed,
        ticketId: `LEGACY-${issued.ticketId}`,
        axes: Object.fromEntries(Object.entries(issued.axes).slice(0, 12)),
    };
    assert.equal(normalizeActorProfileDesignRolls(legacy)?.version, 1);
    const withLegacy = bindActorProfileDesignRolls(actor('NPC-OLD', '旧识'), legacy);
    const prepared = prepareActorProfileV6(withLegacy, { mode: 'full', turn: 9, now: 999 });
    assert.equal(prepared.designRolls.ticketId, legacy.ticketId);

    const withoutTicket = prepareActorProfileV6(actor('NPC-EMPTY', '空白'), {
        mode: 'full',
        turn: 9,
        now: 999,
    });
    assert.equal(withoutTicket.designRolls, null);
});

test('static production path proves pre-generation injection and forbids doctor post-processing rerolls', async () => {
    const [profileSource, runtimeSource, presetSource] = await Promise.all([
        readFile(new URL('../actor-profile-v6-core.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
        readFile(new URL('../fair-director-preset-core.mjs', import.meta.url), 'utf8'),
    ]);
    const prepareProfile = profileSource.slice(
        profileSource.indexOf('export function prepareActorProfileV6'),
        profileSource.indexOf('export function bindActorProfileDesignRolls'),
    );
    assert.doesNotMatch(prepareProfile, /rollActorProfileDiversity|issueCharacterCreationTicket/u);
    assert.match(prepareProfile, /Missing tickets stay missing here/u);

    const nextTurnConsumer = runtimeSource.slice(
        runtimeSource.indexOf('async function precomposeNextTurnConsumer'),
        runtimeSource.indexOf('async function commitNextTurnConsumer'),
    );
    assert.ok(
        nextTurnConsumer.indexOf('prepareNpcDesignTicketBatch()')
            < nextTurnConsumer.indexOf('immutableNextTurnConsumerPayload(worldText, ticketText)'),
        '票据必须在唯一 P4 next-turn consumer 组装最终提示词前创建',
    );
    assert.match(runtimeSource, /await precomposeNextTurnConsumer\(session\)/u);
    assert.doesNotMatch(nextTurnConsumer, /Parallel_Continuity_Bridge|combined.?pool|applySocialInjection/u);
    const actorTransaction = runtimeSource.slice(runtimeSource.indexOf(
        'const actorRegistration = promoteActorCandidatesToRegistry',
    ));
    const bindAt = actorTransaction.indexOf('bindCharacterCreationTicketsToRegisteredActors');
    assert.ok(bindAt > 0);
    assert.ok(bindAt < actorTransaction.indexOf('prepareActorLedgerProfilesV6'));
    assert.doesNotMatch(actorTransaction, /persistActorRegistryForTurn/u);
    assert.doesNotMatch(runtimeSource, /settleNpcDesignTicketBatch/u);
    const chatSwitchStart = runtimeSource.indexOf('const onChatChanged = async () =>');
    const chatSwitchEnd = runtimeSource.indexOf('lastGeneration = {', chatSwitchStart);
    const chatSwitchReset = runtimeSource.slice(
        chatSwitchStart,
        chatSwitchEnd,
    );
    assert.match(chatSwitchReset, /pendingNpcDesignTicketBatch = null/u);
    assert.match(chatSwitchReset, /npcDesignTicketBatches\.clear\(\)/u);
    assert.match(runtimeSource, /characterCreationTicketPoolCapacity:\s*32/u);
    assert.match(runtimeSource, /Number\(getSettings\(\)\.characterCreationTicketPoolCapacity\) \|\| 32/u);
    assert.match(runtimeSource, /mvuad-character-ticket-pool-capacity/u);
    assert.match(runtimeSource, /type="number" min="1" max="64"/u);
    assert.doesNotMatch(
        runtimeSource.slice(
            runtimeSource.indexOf('function prepareNpcDesignTicketBatch'),
            runtimeSource.indexOf('function npcDesignTicketPrompt'),
        ),
        /actorProfileBatchCapacity/u,
    );
    for (const salt of [
        'value', 'temperament', 'core-desire', 'thinking-style', 'social-motive',
        'social', 'interest-orientation', 'decision', 'conflict-style',
        'moral-boundary', 'speech', 'action-habit', 'humor', 'authority',
        'relationship', 'friction', 'self-deception', 'pressure-recovery',
        'everyday', 'life-focus',
    ]) assert.match(profileSource, new RegExp(`salted\\('${salt}'\\)`, 'u'));
    assert.match(profileSource, /SUGAR_CORE_DESIRE_SEEDS/u);
    assert.match(profileSource, /PRESET_SOCIAL_METHOD_SEEDS/u);
    assert.match(profileSource, /PRESET_DECISION_METHOD_SEEDS/u);
    assert.match(profileSource, /SUGAR_RELATIONSHIP_DISTANCE_SEEDS/u);
    for (const fallback of [
        'VALUE_SEEDS', 'TEMPERAMENT_SEEDS', 'THINKING_STYLE_SEEDS',
        'SOCIAL_MOTIVE_SEEDS', 'INTEREST_ORIENTATION_SEEDS',
        'CONFLICT_STYLE_SEEDS', 'MORAL_BOUNDARY_SEEDS', 'SPEECH_SEEDS',
        'ACTION_HABIT_SEEDS', 'HUMOR_SEEDS', 'AUTHORITY_SEEDS',
        'FRICTION_SEEDS', 'SELF_DECEPTION_SEEDS', 'PRESSURE_RECOVERY_SEEDS',
        'EVERYDAY_SEEDS',
    ]) assert.match(profileSource, new RegExp(`salted\\('[^']+'\\),\\s*${fallback}`, 'u'));
    assert.match(
        profileSource,
        /salted\('life-focus'\),\s*PERSONAL_GOAL_SEEDS\.map\(\(item\) => item\.longTerm\)/u,
    );
    assert.match(presetSource, /Character_Kaleidoscope_Contract_V3/u);
    assert.match(presetSource, /不得运行、保存或输出 MBTI、九型人格、Tritype、依恋类型名或代码/u);
    assert.match(presetSource, /本回合的紧张、愤怒、恐惧、冷淡/u);
    assert.match(presetSource, /正文生成前/u);
    assert.match(presetSource, /医生只在最终正文被接受后识别人物/u);
});
