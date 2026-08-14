import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
    ACTOR_PROFILE_V6_VERSION,
    actorProfileActionReadiness,
    actorProfileBaselineDigest,
    actorProfileCompletionMissingFields,
    actorProfileReadyForAction,
    actorProfileV6View,
    applyActorProfileV6Override,
    bindActorProfileDesignRolls,
    buildActorProfileCompletionMessages,
    materializeActorProfileBaseline,
    normalizeActorProfileV6,
    parseActorProfileCompletionOutput,
    parseActorProfileCompletionBatchOutput,
    prepareActorLedgerProfilesV6,
    prepareActorProfileV6,
    regenerateActorProfileV6Module,
    repairActorProfileInsertLocally,
    rollActorProfileDiversity,
    selectActorProfileCompletionCandidates,
    setActorProfileV6Lock,
    validateActorProfileInsertCandidate,
    validateActorProfileDiscoveryAnchor,
} from '../actor-profile-v6-core.mjs';
import {
    actorProfileCommitMatchesLedger,
    finalizeActorProfileBaselinesInLedger,
    normalizeActorLedger,
    replaceActorProfileBaselineInLedger,
    scheduleActorTurns,
    sealActorProfilePendingTransactionInLedger,
} from '../actor-ledger-core.mjs';

function actor(id = 'NPC-ADA', name = '艾达') {
    return {
        id,
        name,
        status: 'active',
        identity: {
            role: '',
            aliases: [],
            traits: [],
            desires: [],
            boundaries: [],
            socialStyle: '',
            decisionStyle: '',
            speechStyle: '',
            everydayHabits: [],
            blindSpots: [],
        },
        lineage: { rootActorId: id, currentForm: name, forms: [] },
        longTermGoals: [],
        currentGoals: [],
        constraints: [],
        stateFacts: [],
        knowledge: [],
        location: { name: '港口', evidence: ['scene:port'] },
        resources: [],
        capabilities: [],
        relationships: [],
        commitments: [],
        stimuli: [],
        actionHistory: [],
        plan: { summary: '', status: 'active' },
        evidence: ['scene:port'],
    };
}

function completeCandidate({
    actorId = 'NPC-CHEN',
    name = '陈锋',
    mode = 'full',
} = {}) {
    const candidate = {
        actorRef: { actorId, name },
        identity: {
            role: '受困小队的临时领头人',
            species: '人类',
            gender: '男',
            age: '29岁',
            briefIntro: '习惯先确认退路，再决定是否承担额外风险的人。',
            appearance: '黑色短发，深棕眼，肩背结实，下颌有一道浅疤。',
            identityText: '在临时队伍中负责核对路线与风险的领头人。',
            relationState: '与同行者保持互助关系，对新合作者先观察后信任。',
            attitudeToProtagonist: '愿意交换信息，但会先说清风险、成本和退出条件。',
            pastExperience: '曾在路线中断后接过带队职责，靠逐项核对带人避开数次风险。',
        },
        personality: {
            biography: '我原本只想把自己的活干完。路线乱了以后，总得有人把出口和人数先看清。',
            primaryColor: '谨慎而负责',
            primaryDerivatives: [
                '陌生环境里先核对出口、人数和可退路线，信息清楚后才谈收益。',
                '有人明确同行时会把对方安全计入决定，但不会用关心代替风险说明。',
            ],
            primarySentence: '先把出口看清，再谈接不接。',
            baseColor: '不服输的现实感',
            baseDerivatives: [
                '独处时会复盘遗漏，不愿承认自己的判断慢了半步。',
                '遇到同样谨慎的人会暗中比较，但仍愿意按事实修正判断。',
            ],
            baseSentence: '我不是怕，只是不想输在没看见的地方。',
            accentColor: '笨拙的体贴',
            accentDerivatives: [
                '同行者疲惫时会主动换到更累的位置，却只说那里视野更好。',
                '危险远离后会借检查装备询问别人是否受伤。',
            ],
            accentSentence: '你先歇一下，我正好还要再看一遍。',
            othersVoices: [
                '林雨说他每次都会重新数一遍人数。',
                '临时同行者嫌他慢，却很少需要跟着他折返。',
                '守夜人见过他独自重画路线。',
                '有人分不清他的负责究竟有多少是不服输。',
            ],
            authorVoice: '我越写越难确定，他是在保护别人，还是无法容忍自己的判断失手。',
        },
        relationships: {
            entries: [{ name: '社区邻里', relation: '日常互助', detail: '通过值守和物资登记保持往来。' }],
            patterns: ['先通过一件可核验的小事判断可靠度，再决定是否拉近关系距离。'],
            coverageState: 'no_confirmed_relationships',
        },
        goals: {
            longTerm: ['找到可持续的安全落脚点，并维持自己可承担的责任范围。'],
            pursuitPrinciples: ['先确认事实、成本和退出条件，再逐步增加投入。'],
            strategy: {
                summary: '用小而可核验的步骤降低长期风险。',
                steps: ['核对现有事实', '完成一个可回退的小步骤', '依据回执调整投入'],
                reviewConditions: '环境、资源或同行关系出现可验证变化时重新评估。',
            },
        },
        knowledge: {
            entries: ['掌握与自身身份相称的生活常识、路线和办事流程。'],
            unknownRemainsUnknown: true,
            coverageState: 'no_confirmed_knowledge',
        },
        resourcesCapabilities: {
            resources: [{ kind: '日常资源', detail: '普通通讯工具、记事本和少量生活用品。' }],
            capabilities: ['能整理清单、核对路线并清楚说明已知风险。'],
            noUnconfirmedAbilityGranted: true,
            coverageState: 'no_confirmed_resources_or_capabilities',
        },
        sources: {
            identity: 'hypothesis',
            personality: 'designed_seed',
            relationships: 'hypothesis',
            goals: 'designed_seed',
            knowledge: 'hypothesis',
            resourcesCapabilities: 'hypothesis',
        },
    };
    for (const field of [
        'role', 'species', 'gender', 'age', 'briefIntro', 'appearance', 'identityText',
        'relationState', 'attitudeToProtagonist', 'pastExperience',
    ]) candidate.sources[`identity.${field}`] = 'hypothesis';
    for (const field of [
        'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
        'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
        'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
    ]) candidate.sources[`personality.${field}`] = 'designed_seed';
    for (const field of [
        'entries', 'patterns',
    ]) candidate.sources[`relationships.${field}`] = 'hypothesis';
    for (const field of [
        'longTerm', 'pursuitPrinciples', 'strategy.summary', 'strategy.steps',
        'strategy.reviewConditions',
    ]) candidate.sources[`goals.${field}`] = 'designed_seed';
    candidate.sources['knowledge.entries'] = 'hypothesis';
    candidate.sources['resourcesCapabilities.resources'] = 'hypothesis';
    candidate.sources['resourcesCapabilities.capabilities'] = 'hypothesis';
    // Keep this legacy-format fixture above the current production quality floor.
    candidate.identity.pastExperience = `${name} has repeatedly reconciled routes, supplies, handovers, and retreat options for a small group; the work taught them to name cost and uncertainty before asking anyone to rely on a plan.`;
    candidate.personality.biography = `${name} begins by separating evidence from assumptions, then offers a reversible next step with the cost made explicit. Years of shared logistics taught them that careful records protect other people's choices without taking those choices away.`;
    candidate.personality.primaryDerivatives = [
        'This person checks exits, people, supplies, and a reversible route before promising an outcome.',
        'This person names risk and cost without making a voluntary choice for anyone else.',
    ];
    candidate.personality.baseDerivatives = [
        'This person revisits a missed detail and corrects the plan openly rather than defending an error.',
        'This person compares evidence and accepts a better observation when it changes the conclusion.',
    ];
    candidate.personality.accentDerivatives = [
        'This person takes the harder watch and gives a practical reason instead of demanding gratitude.',
        'This person checks equipment and asks about harm, leaving room to answer or decline.',
    ];
    candidate.personality.primarySentence = 'I will first separate what we know from what needs a small, checkable test before I ask anyone to rely on it.';
    if (mode === 'full_adult') {
        candidate.physiology = Object.fromEntries([
            ['facialAppearance', '长脸，眉骨略高，深棕色眼睛，下颌左侧有一道浅疤。'],
            ['oralCavity', '牙齿排列整齐，口腔黏膜常态无明显异常。'],
            ['hairstyle', '黑色短发，发质偏硬，通常向后简单梳理。'],
            ['neckShoulderArmpit', '颈部中等长度，肩宽，锁骨线条平直。'],
            ['heightWeight', '身高约178厘米，体重约74公斤。'],
            ['bodySpecial', '中等骨架，肩背肌肉较明显，下颌有旧疤。'],
            ['skinTexture', '肤色偏深，皮肤略粗糙，常态体温正常。'],
            ['bodyScent', '常态有淡皂味和皮革装备留下的气味。'],
            ['bodyMeasurements', '胸腰臀比例匀称，精确数据没有可靠记录。'],
            ['breastAppearance', '胸廓平坦，胸肌轮廓清楚。'],
            ['waistAbdomen', '腰腹紧实，腹部有浅肌肉线条。'],
            ['vulvaAppearance', '不适用：该人物为男性生理构造。'],
            ['vaginalProfile', '不适用：该人物为男性生理构造。'],
            ['anusAppearance', '颜色较周围皮肤略深，常态未记录明显异常。'],
            ['buttockAppearance', '臀型紧实，肌肉分布均匀。'],
            ['legAppearance', '大腿肌肉清楚，小腿结实，腿型笔直。'],
            ['footSize', '约43码，足弓中等。'],
            ['footAppearance', '脚背较宽，趾甲修剪整齐。'],
            ['lactationBodyFluid', '不适用：男性常态无泌乳，未确认其他特殊体液性质。'],
            ['sensitiveParts', '旧疤周围触压时感觉略迟钝，后颈突然受触会迅速回头。'],
        ]);
        candidate.sources.physiology = 'hypothesis';
        for (const field of Object.keys(candidate.physiology)) {
            candidate.sources[`physiology.${field}`] = 'hypothesis';
        }
    }
    return candidate;
}

function canonicalFixtureSourceRef(chatId = 'chat-profile-v6', turn = 1) {
    return {
        chatId,
        messageId: `profile-message-${turn}`,
        index: turn,
        swipeId: 0,
        generation: turn,
        generationId: `profile-generation-${turn}`,
        generationType: 'normal',
        identityScopeId: `${chatId}|character:profile-v6`,
        scopeDigest: `${chatId}|scope:profile-v6`,
        hash: `profile-content-${turn}`,
        compatibilityOnly: false,
    };
}

function narrativeDiscoverySourceRef(chatId, turn) {
    const ref = canonicalFixtureSourceRef(chatId, turn);
    return {
        ...ref,
        logicalIndex: ref.index,
        generationSerial: ref.generation,
        contentHash: ref.hash,
        contentFingerprint: ref.hash,
    };
}

function finalizeProfileFixtureLedger(ledger, actorRef, baseline, {
    turn,
    commitId,
} = {}) {
    const digest = actorProfileBaselineDigest(baseline);
    const sourceRef = canonicalFixtureSourceRef(ledger.chatId || 'chat-profile-v6', turn);
    const expected = {
        actorRef,
        schemaVersion: baseline.version,
        commitId,
        digest,
        profileDigest: digest,
        sourceRef,
        scopeDigest: sourceRef.scopeDigest,
        locks: structuredClone(baseline.locks || {}),
        manualOverrides: structuredClone(baseline.manualOverrides || {}),
    };
    const pending = replaceActorProfileBaselineInLedger(ledger, actorRef, baseline, {
        ...expected,
        committedTurn: turn,
        phase: 'pending',
    });
    assert.equal(pending.committed, true, 'fixture pending persistence must be valid');
    const sealed = sealActorProfilePendingTransactionInLedger(pending.ledger, [expected], {
        preparedFieldRevision: turn,
    });
    assert.equal(sealed.sealed, true, 'fixture pending ledger must seal before finalization');
    const finalized = finalizeActorProfileBaselinesInLedger(sealed.ledger, [expected], {
        transactionId: sealed.transactionId,
        writeSetDigest: sealed.writeSetDigest,
        preparedLedgerDigest: sealed.preparedLedgerDigest,
        preparedFieldRevision: sealed.preparedFieldRevision,
    });
    assert.equal(finalized.finalized, true, 'fixture finalization must follow the sealed pending ledger');
    return { committed: true, ledger: finalized.ledger, expected };
}

function ledgerWithCanonicalRegistry(ledger, sourceRef = canonicalFixtureSourceRef()) {
    return normalizeActorLedger({
        ...ledger,
        chatId: sourceRef.chatId,
        actorRegistry: {
            version: 1,
            chatId: sourceRef.chatId,
            identityScopeId: sourceRef.identityScopeId,
            scopeDigest: sourceRef.scopeDigest,
            registered: Object.fromEntries((ledger.actors || []).map((entry) => [entry.name, {
                actorRef: {
                    kind: 'actor_ref',
                    actorId: entry.id,
                    displayName: entry.name,
                    aliases: entry.identity?.aliases || [],
                },
                origin: 'profile_insert_candidate',
                sourceRefs: [sourceRef],
                registeredTurn: 1,
                updatedTurn: 1,
            }])),
        },
        migrations: { ...(ledger.migrations || {}), actorRegistryV1: true },
    }, {
        chatId: sourceRef.chatId,
        identityScopeId: sourceRef.identityScopeId,
        scopeDigest: sourceRef.scopeDigest,
        allowScopeDigestFill: true,
    });
}

test('new original characters receive stable script-rolled multi-axis design tickets', () => {
    const first = rollActorProfileDiversity(actor('NPC-A', '甲'), {
        entropy: 'generation-7|ticket-1',
    });
    const repeated = rollActorProfileDiversity(actor('NPC-A', '甲'), {
        entropy: 'generation-7|ticket-1',
    });
    const second = rollActorProfileDiversity(actor('NPC-B', '乙'), {
        entropy: 'generation-7|ticket-2',
    });
    assert.deepEqual(repeated, first, '同一张骰票必须可稳定复现');
    assert.equal(first.kind, 'character_creation_ticket');
    assert.equal(Object.keys(first.axes).length, 20);
    assert.ok(Object.values(first.axes).every((entry) => entry.die && entry.roll && entry.result));
    assert.notDeepEqual(second.axes, first.axes, '不同人物不能由模型复用同一组常见模板');

    const bound = bindActorProfileDesignRolls(actor('NPC-A', '甲'), first);
    const prepared = prepareActorProfileV6(bound, { mode: 'full', turn: 3, now: 200 });
    assert.equal(prepared.designRolls.ticketId, first.ticketId);
    const messages = buildActorProfileCompletionMessages([{
        actorId: bound.id,
        name: bound.name,
        identity: bound.identity,
        completionMode: 'full',
        longTermGoals: [],
        currentGoals: [],
        plan: {},
        relationships: [],
        knowledge: [],
        evidence: [],
        fieldSources: {},
        designRolls: first,
    }]);
    assert.match(messages[0].content, /不替玩家决定行动、感受、同意或世界结果/u);
    assert.match(messages[0].content, /真实精确 actorId 值/u);
    assert.doesNotMatch(messages[0].content, /characterCreationTicket|coverageState|relationships/u);
    assert.equal(messages[1].content.includes(first.ticketId), false);
});

test('local preparation never invents dossiers or unlocks formal action with designed seeds', () => {
    const ledger = { turn: 3, actors: [actor('NPC-A', '艾达'), actor('NPC-B', '贝拉')] };
    const result = prepareActorLedgerProfilesV6(ledger, { mode: 'full', turn: 3, now: 100 });
    assert.ok(result.coverage < 100);
    assert.deepEqual(result.prepared, []);
    assert.equal(result.deferred.length, 2);
    assert.equal(result.ledger.actors.every(actorProfileReadyForAction), false);
    assert.equal(result.ledger.actors.every((entry) => !entry.identity.socialStyle), true);
    assert.equal(result.ledger.actors.every((entry) => entry.currentGoals.length === 0), true);
    assert.equal(result.ledger.actors.every((entry) => !entry.plan.summary), true);
    assert.equal(
        result.ledger.actors.every((entry) => (
            entry.profileV6.modules.actionHistory.data.historicalActionsInvented === false
        )),
        true,
    );
});

test('confirmed card or narrative facts remain confirmed while evidence gaps stay incomplete', () => {
    const ada = actor();
    ada.identity.role = '港口抄写员';
    ada.identity.speechStyle = '先复述问题，再给出短答案';
    ada.longTermGoals = ['攒钱赎回旧宅'];
    const profile = prepareActorProfileV6(ada, { mode: 'full', turn: 2, now: 100 });
    assert.equal(profile.modules.identity.source, 'confirmed');
    assert.equal(profile.modules.personality.source, 'confirmed');
    assert.equal(profile.modules.goals.source, 'confirmed');
    assert.equal(
        profile.fieldSources['modules.personality.data.speechStyle'],
        'confirmed',
    );
    assert.equal(
        profile.fieldSources['modules.personality.data.socialStyle'],
        'hypothesis',
    );
    assert.equal(profile.fieldSources['modules.goals.data.longTerm'], 'confirmed');
    assert.equal(profile.fieldSources['modules.goals.data.current'], 'hypothesis');
    assert.ok(profile.coverage < 100);
    assert.equal(profile.preparedForAction, false);
    assert.equal(profile.modules.resourcesCapabilities.data.noUnconfirmedAbilityGranted, true);
});

test('fact priority is applied per field and AI fill never impersonates confirmed evidence', () => {
    const candidate = completeCandidate({ actorId: 'NPC-ADA', name: '艾达' });
    candidate.identity.role = '模型猜测的角色';
    candidate.personality.primaryColor = '模型生成的主色';
    candidate.sources['identity.role'] = 'confirmed';
    const validation = validateActorProfileInsertCandidate(candidate, {
        actorRef: candidate.actorRef,
        completionMode: 'full',
        factLayers: {
            characterCreationTicket: {
                personality: { primaryColor: '骰票中的谨慎好奇' },
                goals: { strategy: { reviewConditions: '骰票约定的复核条件。' } },
            },
            confirmedProfile: { identity: { role: '旧档案角色' } },
            authorityProposal: { identity: { role: '中性权威提案角色' } },
            acceptedNarrative: { identity: { role: '正文确认的港口抄写员' } },
            authority: { identity: { age: '27岁' } },
        },
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.candidate.identity.role, '正文确认的港口抄写员');
    assert.equal(validation.candidate.identity.age, '27岁');
    assert.equal(validation.candidate.personality.primaryColor, '骰票中的谨慎好奇');
    assert.equal(
        validation.candidate.goals.strategy.reviewConditions,
        '骰票约定的复核条件。',
    );
    assert.equal(validation.candidate.sources['identity.role'], 'confirmed');
    assert.equal(validation.candidate.sources['personality.primaryColor'], 'designed_seed');
    assert.ok(validation.resolutions.some((entry) => entry.path === 'identity.role'));

    const previousProfile = prepareActorProfileV6(actor('NPC-ADA', '艾达'), {
        mode: 'full',
        turn: 2,
    });
    previousProfile.modules.identity.data.role = '已确认旧档案角色';
    previousProfile.fieldSources['modules.identity.data.role'] = 'confirmed';
    previousProfile.modules.personality.data.primaryColor = '已掷骰票中的务实好奇';
    previousProfile.fieldSources['modules.personality.data.primaryColor'] = 'designed_seed';
    const compiled = parseActorProfileCompletionOutput(JSON.stringify(candidate), {
        candidates: [{
            actorRef: candidate.actorRef,
            completionMode: 'full',
            previousProfile,
        }],
    });
    assert.equal(compiled.ok, true);
    assert.equal(compiled.candidate.identity.role, '已确认旧档案角色');
    assert.equal(compiled.candidate.personality.primaryColor, '已掷骰票中的务实好奇');
    assert.equal(compiled.candidate.sources['identity.role'], 'confirmed');
    assert.equal(compiled.candidate.sources['personality.primaryColor'], 'designed_seed');
});

test('profile completion finishes the most established row before spreading partial dossiers', () => {
    const transient = actor('NPC-TRANSIENT', '路过者');
    const established = actor('NPC-ESTABLISHED', '陈锋');
    established.actionHistory = [
        { turn: 1, attempt: '确认出口' },
        { turn: 2, attempt: '核对同行者位置' },
    ];
    established.evidence = ['陈锋先确认出口。', '陈锋回头核对同行者的位置。'];
    const prepared = prepareActorLedgerProfilesV6({
        turn: 8,
        actors: [transient, established],
    }, { mode: 'full', turn: 8, now: 100 });
    const selected = selectActorProfileCompletionCandidates(prepared.ledger, {
        maxActors: 1,
        turn: 999,
    });
    assert.equal(selected[0].actorId, 'NPC-ESTABLISHED');
});

test('database-style profile generation accepts loose structure and completes the dossier', () => {
    const evidenceText = '陈锋压低声音说先看出口，再决定是否接单。林雨还在他身后。';
    let ledger = { turn: 4, actors: [actor('NPC-CHEN', '陈锋')] };
    ledger.actors[0].evidence = [evidenceText];
    const prepared = prepareActorLedgerProfilesV6(ledger, { mode: 'full', turn: 4, now: 100 });
    const candidates = selectActorProfileCompletionCandidates(prepared.ledger, {
        initialActorIds: ['NPC-CHEN'],
    });
    assert.equal(candidates.length, 1);
    assert.equal(Object.hasOwn(candidates[0], 'currentGoals'), false);
    assert.equal(Object.hasOwn(candidates[0], 'plan'), false);
    assert.equal(Object.hasOwn(candidates[0], 'location'), false);
    assert.equal(Object.hasOwn(candidates[0], 'stateFacts'), false);
    const messages = buildActorProfileCompletionMessages(candidates, { evidenceText });
    assert.match(messages[0].content, /【人物档案：姓名】/u);
    assert.match(messages[0].content, /身份\/外貌、生理（启用时）、性格底色、经历、当前状态、关系与动机、知识\/能力\/资源/u);
    assert.match(messages[0].content, /不要求逐字使用固定七标题/u);
    assert.match(messages[0].content, /不要 JSON、数组、技术标记或来源字段/u);
    assert.doesNotMatch(messages[0].content, /candidateRef|sourceAnchor|characterCreationTicket|coverageState/u);
    assert.doesNotMatch(messages[1].content, /profileSummary|socialStyle|copingStyle|obstacles|costs|alternatives|candidateRef/u);
    assert.match(messages[1].content, /NPC-CHEN/u);
    const customMessages = buildActorProfileCompletionMessages(candidates, {
        evidenceText,
        customPrompt: 'PROFILE-PROMPT-SLOT-CANARY',
    });
    assert.match(customMessages[1].content, /用户自定义人物档案提示/u);
    assert.match(customMessages[1].content, /PROFILE-PROMPT-SLOT-CANARY/u);

    const partial = parseActorProfileCompletionOutput(
        '这里是填表结果：```json\n[{"identity":{"role":"临时领头人"}}]\n```',
        { candidates, evidenceText },
    );
    assert.equal(partial.ok, false);
    assert.equal(partial.errorCode, 'actor_profile.schema_incomplete');
    assert.equal(partial.candidate, null, 'incomplete output must never expose a partial profile');
    assert.ok(partial.missingFields.includes('identity.species'));

    const looseTable = parseActorProfileCompletionOutput(`
## 追踪角色表
| 字段 | 内容 |
| 角色定位 | 受困小队的临时领头人 |
| 物种 | 人类 |
| 性别 | 男 |
| 年龄 | 29岁 |

## 追踪人设基线
履历：我习惯先把出口和同行者的位置看清，再决定是否冒险。
主色调：谨慎、负责
主色调衍生：1. 陌生环境先找出口；2. 作决定前核对同行者的位置

## 行动方向
长期目标：带同行者离开当前区域
当前目标：确认建筑出口
计划摘要：先观察，再决定是否接单
步骤：1. 查看出口；2. 核对同行者位置
`, { candidates, evidenceText });
    assert.equal(looseTable.ok, false);
    assert.equal(looseTable.errorCode, 'actor_profile.schema_incomplete');
    assert.equal(looseTable.candidate, null);

    const legacyPatch = {
        actorId: 'NPC-CHEN',
        name: '陈锋',
        identity: {
            role: '受困契约者小队的临时领头人',
            species: '人类',
            gender: '男',
            age: '29岁',
            briefIntro: '习惯先找退路的临时领队',
            appearance: '黑色短发，深棕眼，肤色偏深，约178cm，肩背结实，眉骨略高，鼻梁笔直，下颌有一道浅疤。',
            identityText: '受困契约者小队的临时领头人',
            relationState: '林雨:同行者，需要共同脱险；主角:刚接触的潜在合作者',
            attitudeToProtagonist: '愿意听取意见，但会先确认对方能否说清风险和退路。',
            pastExperience: '进入当前区域后临时接过带队职责，已经数次带着林雨避开不明威胁。',
            profileSummary: '陈锋习惯先确认退路与同行者的安全，再决定是否承担额外风险；他表达直接，但会把现实代价说清楚。',
            biography: '我原本只想把自己的那份活干完。进来之后，人散了，路线也乱了，总得有人先把出口和人数看清。林雨跟着我走到现在，我不能拿她的命去赌一句漂亮话。',
            primaryColor: '谨慎、负责',
            primaryDerivatives: [
                '陌生环境里先看出口、人数和可退路线；这些信息清楚后，他才愿意谈收益和下一步。',
                '一旦有人明确跟随他，他会把对方的安全计入自己的决定，但不会用关心代替风险说明。',
            ],
            primarySentence: '先把出口看清，再谈接不接。',
            baseColor: '好胜',
            baseDerivatives: [
                '独处时会反复复盘自己错过的细节，不愿承认判断比别人慢半步。',
                '遇到同样谨慎的人会暗中比较谁更早发现问题，但表面仍按事实说话。',
            ],
            baseSentence: '我不是怕，只是不想输在没看见的地方。',
            accentColor: '笨拙的体贴',
            accentDerivatives: [
                '同行者明显疲惫时会把观察位置换到自己这边，却只说这里视野更好。',
                '确认危险暂时远离后，会用检查装备当借口询问别人有没有受伤。',
            ],
            accentSentence: '你先歇一下，我正好还要再看一遍。',
            othersVoices: [
                '林雨说，他问话很短，可每次都把她站的位置算进去。',
                '临时同行的人觉得他太慢，后来才发现他走过的路很少需要折返。',
                '有人嫌他不痛快，因为他从不当场答应看不清代价的事。',
                '守夜的人见过他独自重画路线，也说不准那是负责还是不服输。',
            ],
            authorVoice: '我起初把他写成谨慎的人，可越写越分不清，他一次次确认退路究竟是在保护别人，还是无法容忍自己判断失手。若同行者不再需要他，他还会不会继续这样做？',
            traits: ['遇到陌生风险时先寻找退路'],
            desires: ['让同行者林雨安全离开当前区域'],
            boundaries: ['不在出口不明时接受高风险委托'],
            socialStyle: '先确认对方能提供什么，再决定是否拉近距离',
            decisionStyle: '先观察出口和敌我位置，再比较收益与撤退成本',
            speechStyle: '压低音量，用短句询问最关键的信息',
            copingStyle: '把混乱拆成能立即检查的小步骤',
            pressureResponse: '威胁逼近时会缩短讨论并优先寻找掩体',
            recoveryPath: '确认退路和同伴状态后才逐步恢复正常交流',
        },
        longTermGoals: ['带着林雨找到可持续的安全落脚点'],
        currentGoals: ['确认当前建筑的出口和敌人位置'],
        plan: {
            summary: '先确认出口，再判断是否接下眼前委托',
            steps: ['观察可用出口', '核对林雨的位置', '询问委托的代价'],
            status: 'active',
            priority: 'high',
            nextWindow: '下一次环境短暂安静时',
            obstacles: ['敌情与出口信息不完整'],
            costs: ['观察会消耗时间并暴露停留位置'],
            alternatives: ['信息不足时先撤到更容易防守的位置'],
        },
        capabilities: [],
        hidden: {},
    };
    assert.equal(legacyPatch.actorId, 'NPC-CHEN', 'legacy fixture remains non-authoritative');
    const patch = completeCandidate({ actorId: 'NPC-CHEN', name: '陈锋' });
    const parsed = parseActorProfileCompletionOutput(
        `填表完成：\n\`\`\`json\n${JSON.stringify(patch)}\n\`\`\``,
        {
        candidates,
        completionMode: 'full',
    },
    );
    assert.equal(parsed.ok, true, JSON.stringify({ errorCode: parsed.errorCode, missingFields: parsed.missingFields }));
    assert.equal(parsed.candidate.actorRef.actorId, 'NPC-CHEN');
    assert.equal(parseActorProfileCompletionOutput(
        '这不是可解析的JSON',
        { candidates, completionMode: 'full' },
    ).errorCode, 'actor_profile.format_unrecoverable');
    prepared.ledger.actors[0].currentGoals = ['本轮动态目标不得被基线覆盖'];
    prepared.ledger.actors[0].plan.summary = '本轮动态计划保持独立';
    const baseline = materializeActorProfileBaseline(
        prepared.ledger.actors[0].profileV6,
        parsed.candidate,
        { turn: 4, completionMode: 'full' },
    );
    assert.equal(actorProfileReadyForAction({
        ...prepared.ledger.actors[0],
        profileV6: baseline,
    }), false, 'a complete in-memory baseline is not action-ready before durable readback');
    const committed = finalizeProfileFixtureLedger(prepared.ledger, patch.actorRef, baseline, {
        turn: 4,
        commitId: 'PBI-SYNTHETIC-1',
    });
    assert.equal(committed.committed, true);
    assert.equal(actorProfileCommitMatchesLedger(committed.ledger, {
        actorRef: patch.actorRef,
        schemaVersion: ACTOR_PROFILE_V6_VERSION,
        commitId: 'PBI-SYNTHETIC-1',
        digest: committed.expected.digest,
    }).ok, true);
    assert.equal(actorProfileReadyForAction(committed.ledger.actors[0]), true);
    assert.equal(
        committed.ledger.actors[0].currentGoals[0],
        '本轮动态目标不得被基线覆盖',
    );
    assert.equal(committed.ledger.actors[0].plan.summary, '本轮动态计划保持独立');
    assert.equal(scheduleActorTurns(ledgerWithCanonicalRegistry(committed.ledger), {
        turn: 4,
        maxActors: 1,
        explorationSlots: 0,
        requireProfileReady: true,
    }).selected[0].actorId, 'NPC-CHEN');

    const committedDigest = actorProfileBaselineDigest(
        committed.ledger.actors[0].profileV6,
    );
    const nextTurnActor = structuredClone(committed.ledger.actors[0]);
    nextTurnActor.currentGoals = ['本轮改为观察门外动静'];
    nextTurnActor.plan = { summary: '本轮等待雨停', steps: ['留在檐下'] };
    nextTurnActor.location = { name: '屋檐下', evidence: ['scene:rain'] };
    const nextTurn = prepareActorLedgerProfilesV6({
        ...committed.ledger,
        turn: 5,
        actors: [nextTurnActor],
    }, { mode: 'full', turn: 5, now: 300 });
    assert.equal(
        actorProfileReadyForAction(nextTurn.ledger.actors[0]),
        true,
        `${actorProfileActionReadiness(nextTurn.ledger.actors[0]).reason}:${JSON.stringify(
            Object.entries(committed.ledger.actors[0].profileV6.fieldSources)
                .filter(([, value]) => value === 'confirmed'),
        )}`,
    );
    assert.equal(
        actorProfileBaselineDigest(nextTurn.ledger.actors[0].profileV6),
        committedDigest,
    );
    assert.deepEqual(
        nextTurn.ledger.actors[0].profileV6.modules.goals.data.current,
        patch.goals.pursuitPrinciples,
    );
    assert.equal(nextTurn.ledger.actors[0].currentGoals[0], '本轮改为观察门外动静');
    assert.equal(
        nextTurn.ledger.actors[0].profileV6.modules.dynamicState.data.location.name,
        '屋檐下',
    );
    const changedFactActor = structuredClone(nextTurn.ledger.actors[0]);
    changedFactActor.identity.role = '正文新确认的守门人';
    const changedFact = prepareActorLedgerProfilesV6({
        ...nextTurn.ledger,
        turn: 6,
        actors: [changedFactActor],
    }, { mode: 'full', turn: 6, now: 400 });
    assert.equal(actorProfileReadyForAction(changedFact.ledger.actors[0]), false);
    assert.equal(
        changedFact.ledger.actors[0].profileV6.fieldSources['modules.identity.data.role'],
        'confirmed',
    );
    assert.equal(selectActorProfileCompletionCandidates(
        changedFact.ledger,
        { initialActorIds: ['NPC-CHEN'], turn: 6 },
    )[0].actorId, 'NPC-CHEN');

    const adultPrepared = prepareActorLedgerProfilesV6({
        turn: 4,
        actors: [structuredClone(committed.ledger.actors[0])],
    }, { mode: 'full_adult', turn: 4, now: 100 });
    const adultCandidates = selectActorProfileCompletionCandidates(adultPrepared.ledger, {
        initialActorIds: ['NPC-CHEN'],
    });
    assert.equal(adultCandidates.length, 1, 'a completed core dossier must still retry its empty body table');
    const adultMessages = buildActorProfileCompletionMessages(adultCandidates, { evidenceText });
    assert.match(adultMessages[0].content, /生理档案已启用/u);
    assert.match(adultMessages[0].content, /稳定、客观/u);
    assert.doesNotMatch(adultMessages[0].content, /reproductiveAnatomy|secretionCycle|fertility/u);
    const adultPatch = structuredClone(patch);
    adultPatch.physiology = {
        summary: '成年男性，体格匀称，当前没有影响行动的明显伤病。',
        facialAppearance: '长脸，眉骨略高，深棕色眼睛，鼻梁笔直，下颌左侧有一道浅疤，肤色偏深。',
        oralCavity: '牙齿排列整齐，舌色淡红，口腔黏膜正常。',
        hairstyle: '黑色短发，发质偏硬，通常向后简单梳理。',
        neckShoulderArmpit: '颈部中等长度，肩宽，锁骨线条平直，腋毛稀疏。',
        heightWeight: '178cm / 74kg',
        bodyMeasurements: 'B98-W79-H94',
        bodySpecial: '中等骨架，肩背肌肉较明显，四肢匀称，下颌有旧疤。',
        skinTexture: '肤色偏深，皮肤略粗糙，体温正常。',
        bodyScent: '常态有淡皂味和皮革装备留下的气味。',
        breastAppearance: '胸廓平坦，胸肌轮廓清楚。',
        waistAbdomen: '腰腹紧实，腹部有浅肌肉线条。',
        vulvaAppearance: '不适用，男性生理构造。',
        vaginalProfile: '不适用，男性生理构造。',
        anusAppearance: '颜色较周围皮肤略深，褶皱均匀，括约肌常态正常。',
        buttockAppearance: '臀型紧实，肌肉分布均匀。',
        legAppearance: '大腿肌肉清楚，小腿结实，腿型笔直。',
        footSize: '43码/27cm，埃及型脚',
        footAppearance: '脚背较宽，足弓中等，趾甲修剪整齐。',
        lactationBodyFluid: '无泌乳，无已知特殊体液性质。',
        sensitiveParts: '旧疤周围:触压时感觉略迟钝；后颈:突然触碰会迅速回头。',
        appearance: {
            visibleFeatures: ['肩背挺直，动作利落'],
            proportions: '身形匀称，四肢比例协调',
            measurements: { note: '没有可靠的精确尺寸记录' },
        },
        reproductiveAnatomy: {
            external: '符合成年男性的人类生理构造，未记录异常',
            internal: '符合成年男性的人类生理构造，未记录异常',
        },
        morphology: { species: '人类', form: '成年男性', dimorphism: '男性第二性征' },
        sensitivity: { summary: '一般触觉与痛觉反应正常' },
        physiologicalResponses: { summary: '紧张时呼吸变浅，确认退路后逐渐恢复' },
        secretionCycle: { summary: '没有特殊物种分泌周期' },
        fertility: { summary: '档案没有显示影响生育能力的异常' },
        specialSpecies: { summary: '不适用；人类' },
        currentBodyState: { summary: '当前清醒，行动能力完整' },
        freeform: '精确尺寸与医学数据没有可靠证据，因此不编造数值。',
    };
    adultPatch.sources.physiology = 'hypothesis';
    const parsedAdult = parseActorProfileCompletionOutput(
        JSON.stringify({ actorProfiles: [adultPatch] }),
        { candidates: adultCandidates, completionMode: 'full_adult' },
    );
    assert.equal(parsedAdult.ok, true);
    const adultProfile = materializeActorProfileBaseline(
        adultPrepared.ledger.actors[0].profileV6,
        parsedAdult.candidate,
        { turn: 4, now: 200, completionMode: 'full_adult' },
    );
    const adultCommitted = finalizeProfileFixtureLedger(
        adultPrepared.ledger,
        adultPatch.actorRef,
        adultProfile,
        { turn: 4, commitId: 'PBI-SYNTHETIC-ADULT' },
    );
    assert.equal(adultCommitted.committed, true);
    const persistedAdult = adultCommitted.ledger.actors[0].profileV6;
    assert.equal(persistedAdult.modules.physiology.source, 'hypothesis');
    assert.equal(
        persistedAdult.modules.physiology.data.facialAppearance,
        adultPatch.physiology.facialAppearance,
    );
    assert.equal('summary' in persistedAdult.modules.physiology.data, false);
    assert.equal('reproductiveAnatomy' in persistedAdult.modules.physiology.data, false);
    assert.equal('morphology' in persistedAdult.modules.physiology.data, false);
    assert.equal(actorProfileV6View({
        ...adultPrepared.ledger.actors[0],
        profileV6: persistedAdult,
    }).optionalCoverage, 100);
    assert.equal(selectActorProfileCompletionCandidates({
        actors: [{ ...adultPrepared.ledger.actors[0], profileV6: persistedAdult }],
    }).length, 0);

});

test('database column names in valid Chinese JSON are normalized before completeness validation', () => {
    const evidenceText = '陈锋先核对出口，再回头确认同行者仍在身后。';
    const prepared = prepareActorLedgerProfilesV6({
        turn: 1,
        actors: [{ ...actor('NPC-CHEN', '陈锋'), evidence: [evidenceText] }],
    }, { mode: 'full', turn: 1, now: 100 });
    const candidate = selectActorProfileCompletionCandidates(prepared.ledger, {
        initialActorIds: ['NPC-CHEN'],
    })[0];
    const canonicalChineseFixture = completeCandidate({ actorId: 'NPC-CHEN', name: '陈锋' });
    const parsed = parseActorProfileCompletionOutput(JSON.stringify(Object.assign({
        actorRef: { actorId: 'NPC-CHEN', name: '陈锋' },
        追踪角色表: {
            角色定位: '临时领队',
            物种: '人类',
            性别: '男',
            年龄: '29岁',
            人物简介: '做决定前会先核对退路与同行者位置的人。',
            外貌特征: '黑色短发，深棕眼，肩背结实，下颌有一道浅疤。',
            身份: '受困小队的临时领队',
            人际关系: '林雨：同行者；主角：刚认识的潜在合作者',
            对主角态度: '愿意交换信息，但会先确认风险和退路。',
            重要经历: '进入当前区域后临时接过带队职责，数次带人避开威胁。',
        },
        追踪人设基线: {
            履历: '我原本只想把自己的活干完，后来路线乱了，总得有人先把出口和人数看清。',
            性格主色调: '谨慎、负责',
            主色调衍生一: '陌生环境里先核对出口、人数和可退路线，信息清楚后才谈收益。',
            主色调衍生二: '一旦有人明确跟随，他会把对方安全计入决定，但仍说明风险。',
            主色调语句: '先把出口看清，再谈接不接。',
            性格底色: '好胜',
            底色衍生一: '独处时会反复复盘遗漏，不愿承认判断比别人慢半步。',
            底色衍生二: '遇到同样谨慎的人会暗中比较谁更早发现问题。',
            底色用语把捉: '我不是怕，只是不想输在没看见的地方。',
            性格点缀: '笨拙的体贴',
            点缀衍生一: '同行者疲惫时会主动换到更累的位置，却只说那里视野更好。',
            点缀衍生二: '危险远离后会借检查装备询问别人是否受伤。',
            点缀用语把捉: '你先歇一下，我正好还要再看一遍。',
            他者声部: ['有人嫌他太慢。', '林雨说他总会数人数。', '守夜人见过他重画路线。', '同行者也说不准他是负责还是好胜。'],
            作者声部: '我越写越分不清，他是在保护别人，还是无法容忍自己的判断失手。',
        },
        行动方向: {
            长期目标: ['带同行者离开当前区域'],
            追求原则: ['先确认事实和退出条件，再逐步增加投入'],
            策略: {
                策略摘要: '先观察出口，再决定是否接单',
                策略步骤: ['查看出口', '核对同行者位置'],
                复核条件: '环境或同行关系发生可验证变化时',
            },
        },
        relationships: {
            entries: [{ name: '同行者', relation: '普通合作', detail: '通过共同核对路线维持往来。' }],
            patterns: ['先通过可核验的小事判断可靠度，再决定关系距离。'],
            coverageState: 'no_confirmed_relationships',
        },
        knowledge: {
            entries: ['熟悉自身来路、当前区域的普通路线和日常风险。'],
            unknownRemainsUnknown: true,
            coverageState: 'no_confirmed_knowledge',
        },
        resourcesCapabilities: {
            resources: [{ kind: '日常资源', detail: '随身记录工具和普通旅行用品。' }],
            capabilities: ['能观察出口、核对同行者位置并说明风险。'],
            noUnconfirmedAbilityGranted: true,
            coverageState: 'no_confirmed_resources_or_capabilities',
        },
        sources: {
            ...completeCandidate({ actorId: 'NPC-CHEN', name: '陈锋' }).sources,
            identity: 'hypothesis',
            personality: 'designed_seed',
            relationships: 'hypothesis',
            goals: 'designed_seed',
            knowledge: 'hypothesis',
            resourcesCapabilities: 'hypothesis',
        },
    }, {
        '角色表': canonicalChineseFixture.identity,
        '追踪人设基线': canonicalChineseFixture.personality,
        relationships: canonicalChineseFixture.relationships,
        goals: canonicalChineseFixture.goals,
        knowledge: canonicalChineseFixture.knowledge,
        resourcesCapabilities: canonicalChineseFixture.resourcesCapabilities,
        sources: canonicalChineseFixture.sources,
    })), { candidates: [candidate], completionMode: 'full' });
    assert.equal(parsed.ok, true, JSON.stringify({ errorCode: parsed.errorCode, missingFields: parsed.missingFields }));
    assert.equal(parsed.candidate.identity.role, canonicalChineseFixture.identity.role);
    assert.equal(parsed.candidate.identity.appearance, canonicalChineseFixture.identity.appearance);
    assert.deepEqual(
        parsed.candidate.personality.primaryDerivatives,
        canonicalChineseFixture.personality.primaryDerivatives,
    );
    assert.equal(
        parsed.candidate.goals.strategy.summary,
        canonicalChineseFixture.goals.strategy.summary,
    );
    assert.deepEqual(actorProfileCompletionMissingFields(parsed.candidate, {
        actorRef: candidate.actorRef,
        completionMode: 'full',
    }), []);

    const partial = parseActorProfileCompletionOutput(
        JSON.stringify({ 追踪角色表: { 身份: '临时领队' } }),
        { candidates: [candidate], completionMode: 'full' },
    );
    assert.equal(partial.ok, false);
    assert.equal(partial.candidate, null);
    assert.equal(partial.missingFields.includes('identity.gender'), true);
});

test('basic full and full_adult candidates compile as complete replacement rows', () => {
    for (const mode of ['basic', 'full', 'full_adult']) {
        const candidate = completeCandidate({ mode });
        const result = repairActorProfileInsertLocally(JSON.stringify(candidate), {
            actorRef: candidate.actorRef,
            completionMode: mode,
        });
        assert.equal(result.ok, true, `${mode} must compile in one pass`);
        assert.deepEqual(result.missingFields, []);
        assert.match(result.candidate.personality.biography, /separating evidence from assumptions/u);
    }
});

test('profile transaction parser keeps caikis-style outer actorProfiles wrapper tolerance', () => {
    const candidate = completeCandidate({ mode: 'full' });
    const parsed = parseActorProfileCompletionOutput(JSON.stringify({
        actorProfiles: [candidate],
    }), {
        candidates: [{ actorRef: candidate.actorRef }],
        completionMode: 'full',
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.candidate.actorRef.actorId, candidate.actorRef.actorId);
});

test('local repair handles fences prose smart quotes controls trailing commas and a missing close', () => {
    const candidate = completeCandidate();
    const context = { actorRef: candidate.actorRef, completionMode: 'full' };
    const variants = [];
    variants.push(`前言\n\`\`\`json\n${JSON.stringify(candidate)}\n\`\`\`\n后记`);
    variants.push(JSON.stringify(candidate).replace(/"/gu, (quote, offset, source) => (
        source.slice(0, offset).split('"').length % 2 ? '”' : '“'
    )));
    variants.push(JSON.stringify({
        ...candidate,
        identity: { ...candidate.identity, briefIntro: '他说"先看出口"之后才作决定。' },
    }).replace(/\\"先看出口\\"/u, '"先看出口"'));
    variants.push(JSON.stringify(candidate).replace('习惯', '习\u0001惯'));
    variants.push(JSON.stringify(candidate).replace(/\}\s*$/u, ',').concat('}'));
    variants.push(JSON.stringify(candidate).slice(0, -1));
    for (const output of variants) {
        const result = repairActorProfileInsertLocally(output, context);
        assert.equal(result.ok, true, result.errorCode || result.missingFields.join(','));
    }
});

test('every required semantic field is checked on the current row without borrowing old drafts', () => {
    const base = completeCandidate();
    const paths = [
        ...[
            'role', 'species', 'gender', 'age', 'briefIntro', 'appearance', 'identityText',
            'relationState', 'attitudeToProtagonist', 'pastExperience',
        ].map((field) => `identity.${field}`),
        ...[
            'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
            'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
            'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
        ].map((field) => `personality.${field}`),
        'relationships.entries',
        'relationships.patterns',
        'relationships.coverageState',
        'goals.longTerm',
        'goals.pursuitPrinciples',
        'goals.strategy.summary',
        'goals.strategy.steps',
        'goals.strategy.reviewConditions',
        'knowledge.entries',
        'knowledge.unknownRemainsUnknown',
        'knowledge.coverageState',
        'resourcesCapabilities.resources',
        'resourcesCapabilities.capabilities',
        'resourcesCapabilities.noUnconfirmedAbilityGranted',
        'resourcesCapabilities.coverageState',
    ];
    const removePath = (value, path) => {
        const parts = path.split('.');
        const parent = parts.slice(0, -1).reduce((cursor, part) => cursor[part], value);
        delete parent[parts.at(-1)];
    };
    for (const path of paths) {
        const incomplete = structuredClone(base);
        removePath(incomplete, path);
        const result = validateActorProfileInsertCandidate(incomplete, {
            actorRef: base.actorRef,
            completionMode: 'full',
            previousProfile: prepareActorProfileV6(actor('NPC-CHEN', '陈锋'), {
                mode: 'full',
            }),
        });
        assert.equal(result.ok, false, path);
        assert.equal(result.candidate, null, path);
        assert.ok(result.missingFields.includes(path), path);
    }
});

test('local normalization converts numeric-key list objects without inventing absent fields', () => {
    const candidate = completeCandidate();
    candidate.personality.othersVoices = {
        0: '熟人会说他答应过的琐事也会记得。',
        1: '同行认为他谨慎，但不会拿谨慎当拖延借口。',
        2: '陌生人常把他的少言误认成冷淡。',
        3: '受过他帮助的人知道他会把风险讲清楚。',
    };
    candidate.relationships.entries = {};
    candidate.knowledge.entries = {};
    candidate.resourcesCapabilities.resources = {};
    candidate.resourcesCapabilities.capabilities = {};
    const result = repairActorProfileInsertLocally(JSON.stringify(candidate), {
        actorRef: candidate.actorRef,
        completionMode: 'full',
    });
    assert.equal(result.ok, false);
    assert.equal(result.candidate, null);
    assert.ok(result.missingFields.includes('relationships.entries'));
    assert.ok(result.missingFields.includes('knowledge.entries'));
    assert.ok(result.missingFields.includes('resourcesCapabilities.resources'));
    assert.ok(result.missingFields.includes('resourcesCapabilities.capabilities'));

    candidate.relationships.entries = [{ name: '邻里', relation: '日常互助' }];
    candidate.knowledge.entries = ['掌握与自身身份相称的日常常识。'];
    candidate.resourcesCapabilities.resources = [{ kind: '日常资源', detail: '普通记事工具。' }];
    candidate.resourcesCapabilities.capabilities = ['能核对清单并说明风险。'];
    const normalized = repairActorProfileInsertLocally(JSON.stringify(candidate), {
        actorRef: candidate.actorRef,
        completionMode: 'full',
    });
    assert.equal(normalized.ok, true);
    assert.deepEqual(normalized.candidate.personality.othersVoices, Object.values(
        candidate.personality.othersVoices,
    ));
});

test('placeholders fail and physiology not-applicable values require an explicit reason', () => {
    for (const placeholder of ['未知', '待确认', '暂无', '不详', '']) {
        const candidate = completeCandidate();
        candidate.identity.role = placeholder;
        const result = validateActorProfileInsertCandidate(candidate, {
            actorRef: candidate.actorRef,
            completionMode: 'full',
        });
        assert.ok(result.missingFields.includes('identity.role'));
    }
    const adult = completeCandidate({ mode: 'full_adult' });
    adult.physiology.vulvaAppearance = '不适用';
    const rejected = validateActorProfileInsertCandidate(adult, {
        actorRef: adult.actorRef,
        completionMode: 'full_adult',
    });
    assert.ok(rejected.missingFields.includes('physiology.vulvaAppearance'));
    adult.physiology.vulvaAppearance = '不适用：该人物为男性生理构造。';
    assert.equal(validateActorProfileInsertCandidate(adult, {
        actorRef: adult.actorRef,
        completionMode: 'full_adult',
    }).ok, true);
});

test('commit identity schema id and digest mismatches all fail closed', () => {
    const prepared = prepareActorLedgerProfilesV6({
        turn: 3,
        actors: [actor('NPC-CHEN', '陈锋')],
    }, { mode: 'full', turn: 3, now: 100 });
    const candidate = completeCandidate();
    const baseline = materializeActorProfileBaseline(
        prepared.ledger.actors[0].profileV6,
        candidate,
        { turn: 3, completionMode: 'full' },
    );
    const committed = finalizeProfileFixtureLedger(prepared.ledger, candidate.actorRef, baseline, {
        turn: 3,
        commitId: 'PBI-CHECK',
    });
    assert.equal(committed.committed, true);
    const expected = {
        actorRef: candidate.actorRef,
        schemaVersion: ACTOR_PROFILE_V6_VERSION,
        commitId: 'PBI-CHECK',
        digest: committed.expected.digest,
    };
    for (const [key, value] of [
        ['actorRef', { actorId: 'NPC-OTHER', name: '其他人' }],
        ['actorRef', { actorId: 'NPC-CHEN', name: '错误姓名' }],
        ['schemaVersion', ACTOR_PROFILE_V6_VERSION + 1],
        ['commitId', 'PBI-WRONG'],
        ['digest', 'sha256:wrong'],
    ]) {
        assert.equal(actorProfileCommitMatchesLedger(committed.ledger, {
            ...expected,
            [key]: value,
        }).ok, false, key);
    }
});

test('two concurrent generation results commit independently in actor order', async () => {
    const prepared = prepareActorLedgerProfilesV6({
        version: 6,
        chatId: 'chat-profile-transaction',
        turn: 4,
        actors: [
            actor('NPC-BROKEN', '坏格式人物'),
            actor('NPC-GOOD', '完整人物'),
        ],
    }, { mode: 'full', turn: 4, now: 100 });
    const goodCandidate = completeCandidate({ actorId: 'NPC-GOOD', name: '完整人物' });
    const generationResults = await Promise.all([
        Promise.resolve('这不是一张可恢复的档案'),
        Promise.resolve(JSON.stringify(goodCandidate)),
    ].map(async (output, index) => repairActorProfileInsertLocally(await output, {
        actorRef: index === 0
            ? { actorId: 'NPC-BROKEN', name: '坏格式人物' }
            : goodCandidate.actorRef,
        completionMode: 'full',
    })));

    let ledger = prepared.ledger;
    for (let index = 0; index < generationResults.length; index += 1) {
        const result = generationResults[index];
        if (!result.ok) continue;
        const actorId = index === 0 ? 'NPC-BROKEN' : 'NPC-GOOD';
        const current = ledger.actors.find((entry) => entry.id === actorId);
        const baseline = materializeActorProfileBaseline(current.profileV6, result.candidate, {
            turn: 4,
            completionMode: 'full',
        });
        const committed = finalizeProfileFixtureLedger(ledger, result.candidate.actorRef, baseline, {
            turn: 4,
            commitId: `commit-${actorId}`,
        });
        assert.equal(committed.committed, true);
        ledger = committed.ledger;
    }

    assert.equal(generationResults[0].errorCode, 'actor_profile.format_unrecoverable');
    assert.equal(actorProfileReadyForAction(
        ledger.actors.find((entry) => entry.id === 'NPC-BROKEN'),
    ), false);
    assert.equal(actorProfileReadyForAction(
        ledger.actors.find((entry) => entry.id === 'NPC-GOOD'),
    ), true);
});

test('legacy V6 profiles remain readable and editable without fabricated transaction evidence', () => {
    const legacyActor = actor('NPC-LEGACY', '旧人物');
    const seed = prepareActorProfileV6(legacyActor, {
        mode: 'full',
        turn: 2,
    });
    const legacy = materializeActorProfileBaseline(
        seed,
        completeCandidate({ actorId: 'NPC-LEGACY', name: '旧人物' }),
        { mode: 'full', turn: 2 },
    );
    legacy.version = 6;
    legacy.coverage = 100;
    legacy.preparedForAction = true;
    legacy.baselineCommit = undefined;
    const normalized = normalizeActorProfileV6(legacy, {
        actorId: 'NPC-LEGACY',
        name: '旧人物',
        mode: 'full',
    });
    assert.equal(normalized.version, ACTOR_PROFILE_V6_VERSION);
    assert.equal(normalized.baselineCommit.status, 'legacy_persisted');
    assert.equal(normalized.baselineCommit.commitId, '');
    assert.equal(normalized.baselineCommit.digest, '');
    assert.equal(normalized.baselineCommit.readbackVerified, false);
    const legacyReadableActor = {
        ...actor('NPC-LEGACY', '旧人物'),
        profileV6: normalized,
    };
    assert.equal(actorProfileReadyForAction(legacyReadableActor), false);
    assert.deepEqual(actorProfileActionReadiness(legacyReadableActor), {
        ready: false,
        reason: 'actor_profile.legacy_migration_required',
        migrationRequired: true,
    });
    const override = applyActorProfileV6Override(normalized, {
        path: 'modules.identity.data.role',
        value: '人工确认的旧档案身份',
        turn: 4,
    });
    assert.equal(override.applied, true);
    assert.equal(override.profile.baselineCommit.status, 'legacy_persisted');
    assert.equal(override.profile.baselineCommit.commitId, '');
    assert.equal(override.profile.baselineCommit.digest, '');
    assert.equal(override.profile.baselineCommit.readbackVerified, false);
    assert.equal(actorProfileReadyForAction({
        ...legacyReadableActor,
        profileV6: override.profile,
    }), false);
});

test('completion off leaves an incomplete new actor out of formal action scheduling', () => {
    const profile = prepareActorProfileV6(actor(), { mode: 'off', turn: 1 });
    assert.equal(profile.preparedForAction, false);
    assert.equal(profile.backgroundPending, true);
});

test('adult physiology remains optional and never disguises an incomplete core dossier', () => {
    const profile = prepareActorProfileV6(actor(), { mode: 'full_adult', turn: 1 });
    const physiology = profile.modules.physiology.data;
    assert.equal(physiology.enabled, true);
    assert.equal(physiology.adultEnabled, true);
    assert.deepEqual(
        Object.keys(physiology).sort(),
        [
            'adultEnabled', 'anusAppearance', 'bodyMeasurements', 'bodyScent',
            'bodySpecial', 'breastAppearance', 'buttockAppearance', 'enabled',
            'facialAppearance', 'footAppearance', 'footSize', 'hairstyle',
            'heightWeight', 'lactationBodyFluid', 'legAppearance',
            'neckShoulderArmpit', 'oralCavity', 'sensitiveParts', 'skinTexture',
            'vaginalProfile', 'vulvaAppearance', 'waistAbdomen',
        ].sort(),
    );
    assert.equal(Object.values(physiology).filter((value) => value === '').length, 20);
    const view = actorProfileV6View({ ...actor(), profileV6: profile });
    assert.ok(profile.coverage < 100, 'missing identity, personality and goals remain visible');
    assert.equal(profile.preparedForAction, false);
    assert.equal(view.optionalCoverage, 0, 'unknown optional details stay visibly incomplete');
    assert.deepEqual(view.optionalPendingModules, ['physiology']);
    assert.equal(profile.backgroundPending, true);
});

test('narrative adult physiology contract is versioned so old generic prose becomes maintenance', () => {
    const actorRef = { actorId: 'NPC-ADULT-NARRATIVE', name: '成年测试人物' };
    const sections = Object.fromEntries([
        'person', 'physiology', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, {
        title: key,
        text: `${key}：这是一段完整自然的中文档案内容，用于验证版本化成人生理补全。`,
        source: 'hypothesis',
        evidence: [],
    }]));
    const previous = normalizeActorProfileV6({
        version: ACTOR_PROFILE_V6_VERSION,
        actorId: actorRef.actorId,
        name: actorRef.name,
        completionMode: 'full_adult',
        profileFormat: 'narrative-v1',
        narrativeSections: sections,
    }, { actorId: actorRef.actorId, name: actorRef.name, mode: 'full_adult' });
    assert.equal(actorProfileV6View({
        id: actorRef.actorId,
        name: actorRef.name,
        profileV6: previous,
    }).optionalCoverage, 0);
    const materialized = materializeActorProfileBaseline(previous, {
        profileFormat: 'narrative-v1',
        actorRef,
        narrativeSections: sections,
    }, { completionMode: 'full_adult', turn: 2, now: 200 });
    assert.equal(
        materialized.narrativeSections.physiology.contractVersion,
        ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
    );
    assert.equal(actorProfileV6View({
        id: actorRef.actorId,
        name: actorRef.name,
        profileV6: materialized,
    }).optionalCoverage, 100);
});

test('manual overrides, locks, module regeneration and version history are durable', () => {
    const ada = actor();
    let profile = prepareActorProfileV6(ada, { mode: 'full', turn: 1, now: 100 });
    const overridden = applyActorProfileV6Override(profile, {
        path: 'modules.personality.data.speechStyle',
        value: '只在确认事实后下结论',
        turn: 2,
        now: 200,
    });
    assert.equal(overridden.applied, true);
    profile = setActorProfileV6Lock(overridden.profile, {
        path: 'modules.personality',
        locked: true,
    });
    const regenerated = regenerateActorProfileV6Module(profile, ada, {
        module: 'personality',
        turn: 3,
        now: 300,
    });
    assert.equal(regenerated.regenerated, false);
    assert.equal(regenerated.reason, 'module_locked');
    assert.equal(profile.history.length > 0, true);
});

test('field, module and actor locks survive later automatic profile preparation', () => {
    const ada = actor();
    let profile = prepareActorProfileV6(ada, { mode: 'full', turn: 1, now: 100 });
    const overridden = applyActorProfileV6Override(profile, {
        path: 'modules.personality.data.speechStyle',
        value: '先核实来源，再用一句话回答',
        turn: 2,
        now: 200,
    });
    profile = setActorProfileV6Lock(overridden.profile, {
        path: 'modules.personality.data.speechStyle',
        locked: true,
    });
    profile = setActorProfileV6Lock(profile, {
        path: 'modules.personality',
        locked: true,
    });
    const preparedAgain = prepareActorProfileV6({ ...ada, profileV6: profile }, {
        mode: 'full_adult',
        turn: 3,
        now: 300,
    });
    assert.equal(
        preparedAgain.modules.personality.data.speechStyle,
        '先核实来源，再用一句话回答',
    );
    assert.equal(
        preparedAgain.manualOverrides['modules.personality.data.speechStyle'],
        '先核实来源，再用一句话回答',
    );
    assert.equal(preparedAgain.locks['modules.personality'], true);

    const actorLocked = setActorProfileV6Lock(preparedAgain, { path: 'actor', locked: true });
    const rejectedOverride = applyActorProfileV6Override(actorLocked, {
        path: 'modules.identity.data.role',
        value: '越权改写',
        turn: 4,
    });
    assert.equal(rejectedOverride.applied, false);
    assert.equal(rejectedOverride.reason, 'field_locked');
    const rejectedRegeneration = regenerateActorProfileV6Module(actorLocked, ada, {
        module: 'identity',
        turn: 4,
    });
    assert.equal(rejectedRegeneration.regenerated, false);
    assert.equal(rejectedRegeneration.reason, 'module_locked');
});

test('diagnostic view exposes source and counts without profile prose', () => {
    const ada = actor();
    ada.profileV6 = prepareActorProfileV6(ada, { mode: 'full', turn: 1 });
    const view = actorProfileV6View(ada);
    const serialized = JSON.stringify(view);
    assert.ok(view.coverage < 100);
    assert.equal(view.preparedForAction, false);
    assert.equal('data' in view.moduleStatuses.personality, false);
    assert.equal(serialized.includes('socialStyle'), false);
    assert.equal(view.physiologyInfersPersonality, false);
});

test('narrative-v1 accepts seven natural sections and binds trusted discovery to its first literal name', () => {
    const narrative = '陈锋站在门边，先确认出口。';
    const discoverySourceRef = narrativeDiscoverySourceRef('chat-narrative-chen', 21);
    const output = `前言\n【人物档案：陈锋】\nActorRef: NPC-CHEN\n【人物信息】一名谨慎的临时领队。\n【生理特征】成年男性，步态稳定。\n【性格特征】说话直接但会先确认风险。\n【过往经历】曾在多次撤离中承担带队责任。\n【当前状态】正留意出口和同伴位置。\n【关系与动机】愿意合作，但不替他人决定。\n【知识、能力与资源】掌握路线观察常识，现有资源仍以账本为准。`;
    const parsed = parseActorProfileCompletionBatchOutput(output, {
        candidates: [{ actorRef: { actorId: 'NPC-CHEN', name: '陈锋' }, completionMode: 'full' }],
        discoveryContext: { acceptedNarrative: narrative, completionMode: 'full' },
    });
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].candidate.profileFormat, 'narrative-v1');
    assert.equal(parsed.entries[0].candidate.narrativeSections.person.text.includes('谨慎'), true);
    const profile = materializeActorProfileBaseline(null, parsed.entries[0].candidate, { completionMode: 'full' });
    assert.equal(profile.profileFormat, 'narrative-v1');
    assert.equal(profile.coverage, 100);
    const lockedNarrative = setActorProfileV6Lock(profile, { path: 'actor', locked: true });
    assert.deepEqual(lockedNarrative, profile, 'narrative dossiers are read-only through the old lock API');
    assert.equal(
        applyActorProfileV6Override(profile, { path: 'modules.identity.data.role', value: 'forbidden' }).reason,
        'narrative_read_only',
    );
    assert.equal(
        regenerateActorProfileV6Module(profile, { id: 'NPC-CHEN', name: '\u9648\u950b' }, { module: 'identity' }).reason,
        'narrative_read_only',
    );
    const changed = structuredClone(profile);
    changed.narrativeSections.history.text = '另一段完整经历。';
    assert.notEqual(actorProfileBaselineDigest(profile), actorProfileBaselineDigest(changed));

    const repeatedName = parseActorProfileCompletionBatchOutput(output.replace('ActorRef: NPC-CHEN\n', ''), {
        candidates: [],
        discoveryContext: {
            acceptedNarrative: `${narrative} 陈锋回头。`, completionMode: 'full', sourceRef: discoverySourceRef,
        },
    });
    assert.equal(repeatedName.discoveries.length, 1);
    assert.equal(repeatedName.discoveries[0].candidateRef.sourceAnchor, '陈锋');
    assert.equal(repeatedName.discoveries[0].offset, narrative.indexOf('陈锋'));
});

test('narrative first-literal discovery remains parser-only and fail-closed for missing, vague, duplicate, and JSON rows', () => {
    const name = '\u9648\u950b';
    const acceptedNarrative = `${name}\u5728\u95e8\u8fb9\u786e\u8ba4\u51fa\u53e3\uff0c\u968f\u540e${name}\u56de\u5934\u4e0e\u540c\u4f34\u8bf4\u8bdd\u3002`;
    const sectionKeys = [
        '\u4eba\u7269\u4fe1\u606f', '\u751f\u7406\u7279\u5f81', '\u6027\u683c\u7279\u5f81', '\u8fc7\u5f80\u7ecf\u5386',
        '\u5f53\u524d\u72b6\u6001', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90',
    ];
    const narrativeBlock = (headingName) => [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${headingName}\u3011`,
        ...sectionKeys.map((title) => `\u3010${title}\u3011\u8fd9\u662f\u4e0e\u5f53\u524d\u4eba\u7269\u76f8\u5173\u7684\u5b8c\u6574\u81ea\u7136\u4e2d\u6587\u6bb5\u843d\u3002`),
    ].join('\n');
    const context = {
        acceptedNarrative,
        completionMode: 'full',
        sourceRef: narrativeDiscoverySourceRef('chat-narrative-first', 22),
    };
    const first = parseActorProfileCompletionBatchOutput(narrativeBlock(name), {
        candidates: [], discoveryContext: context,
    });
    assert.equal(first.discoveries.length, 1);
    assert.equal(first.discoveries[0].offset, acceptedNarrative.indexOf(name));
    assert.equal(first.discoveries[0].candidateRef.sourceAnchor, name);

    const missing = parseActorProfileCompletionBatchOutput(narrativeBlock('\u5357\u6865'), {
        candidates: [], discoveryContext: context,
    });
    assert.equal(missing.discoveries.length, 0);
    assert.equal(missing.unresolved[0].reason, 'actor_profile.discovery_name_missing_from_narrative');
    assert.equal(missing.unresolved[0].identityReplacement, undefined);

    const missingWithBadSection = parseActorProfileCompletionBatchOutput([
        `\u3010\u4eba\u7269\u6863\u6848\uff1a\u5357\u6865\u3011`,
        ...sectionKeys.slice(1).map((title) => `\u3010${title}\u3011\u8fd9\u662f\u5b8c\u6574\u81ea\u7136\u4e2d\u6587\u6bb5\u843d\u3002`),
    ].join('\n'), { candidates: [], discoveryContext: context });
    assert.equal(missingWithBadSection.unresolved[0].reason, 'actor_profile.discovery_name_missing_from_narrative');
    assert.equal(missingWithBadSection.unresolved[0].identityReplacement, undefined);

    const vague = parseActorProfileCompletionBatchOutput(narrativeBlock('\u4ed6'), {
        candidates: [], discoveryContext: { acceptedNarrative: '\u4ed6\u7ad9\u5728\u95e8\u8fb9\u3002', completionMode: 'full' },
    });
    assert.equal(vague.discoveries.length, 0);
    assert.equal(vague.unresolved[0].reason, 'actor_profile.discovery_name_vague');

    for (const rowKey of ['\u6821\u957f', '\u9ed1\u5e02\u5546\u4eba', '\u58eb\u5175A', '\u53d7\u4f24\u7684\u8b66\u536b', '\u53d7\u4f24\u7684\u5546\u6237']) {
        const literal = validateActorProfileDiscoveryAnchor({
            name: rowKey,
            sourceAnchor: `${rowKey}\u6b63\u5728\u73b0\u573a\u5904\u7406\u4e8b\u60c5\u3002`,
        }, `${rowKey}\u6b63\u5728\u73b0\u573a\u5904\u7406\u4e8b\u60c5\u3002`);
        assert.equal(literal.ok, true, rowKey);
    }
    for (const vagueRowKey of ['\u4ed6', '\u4f17\u4eba', '\u67d0\u67d0', '\u8fd9\u4e2a\u4eba', '\u8def\u4eba', '\u964c\u751f\u4eba', '\u7537\u4eba', '\u5973\u4eba', '\u5b69\u5b50', '\u8001\u4eba']) {
        const vagueLiteral = validateActorProfileDiscoveryAnchor({
            name: vagueRowKey,
            sourceAnchor: `${vagueRowKey}\u6b63\u5728\u73b0\u573a\u5904\u7406\u4e8b\u60c5\u3002`,
        }, `${vagueRowKey}\u6b63\u5728\u73b0\u573a\u5904\u7406\u4e8b\u60c5\u3002`);
        assert.equal(vagueLiteral.ok, false, vagueRowKey);
        assert.equal(vagueLiteral.reason, 'actor_profile.discovery_name_vague', vagueRowKey);
    }

    const duplicate = parseActorProfileCompletionBatchOutput([
        narrativeBlock(name), narrativeBlock(name),
    ].join('\n'), { candidates: [], discoveryContext: context });
    assert.equal(duplicate.discoveries.length, 0);
    assert.equal(duplicate.unresolved[0].reason, 'actor_profile.discovery_ref_duplicate');

    const forgedJson = {
        profileFormat: 'narrative-v1',
        candidateRef: { name, sourceAnchor: name },
        narrativeSections: Object.fromEntries([
            'person', 'physiology', 'personality', 'history', 'currentState',
            'relationshipsMotives', 'knowledgeCapabilitiesResources',
        ].map((key) => [key, { text: '\u5b8c\u6574\u7684\u4e2d\u6587\u53d9\u4e8b\u6bb5\u843d\u3002' }])),
    };
    const repeatedLiteral = parseActorProfileCompletionBatchOutput(JSON.stringify(forgedJson), {
        candidates: [], discoveryContext: context,
    });
    assert.equal(repeatedLiteral.discoveries.length, 1);
    assert.equal(repeatedLiteral.discoveries[0].offset, acceptedNarrative.indexOf(name));

    const forgedAnchor = validateActorProfileDiscoveryAnchor({
        name,
        sourceAnchor: `${name}在一座不存在的钟楼内策划行动。`,
    }, acceptedNarrative);
    assert.equal(forgedAnchor.ok, false);
    assert.equal(forgedAnchor.reason, 'actor_profile.discovery_anchor_not_in_narrative');
});

test('narrative-v1 keeps unknown or duplicate headings as loose additional prose and strips model-claimed provenance', () => {
    const actorRef = { actorId: 'NPC-NARRATIVE-GATE', name: '\u6797\u5cb8' };
    const seven = [
        ['\u4eba\u7269\u4fe1\u606f', '\u4ed6\u662f\u4e00\u540d\u8d1f\u8d23\u770b\u5b88\u54e8\u4f4d\u7684\u4eba\u3002'],
        ['\u751f\u7406\u7279\u5f81', '\u5176\u8eab\u4f53\u4e0e\u6240\u5c5e\u7269\u79cd\u7684\u8bbe\u5b9a\u4e00\u81f4\u3002'],
        ['\u6027\u683c\u7279\u5f81', '\u4ed6\u4f1a\u5148\u542c\u53d6\u4ed6\u4eba\u7684\u7406\u7531\u518d\u53d1\u8868\u610f\u89c1\u3002'],
        ['\u8fc7\u5f80\u7ecf\u5386', '\u4ed6\u66fe\u7ecf\u5728\u8fb9\u5883\u57ce\u9547\u4e2d\u62c5\u4efb\u591c\u73ed\u5de5\u4f5c\u3002'],
        ['\u5f53\u524d\u72b6\u6001', '\u4ed6\u7ef4\u6301\u957f\u671f\u7a33\u5b9a\u7684\u54e8\u4f4d\u804c\u8d23\u3002'],
        ['\u5173\u7cfb\u4e0e\u52a8\u673a', '\u4ed6\u613f\u610f\u5e2e\u52a9\u5408\u4f5c\u8005\uff0c\u4f46\u4e0d\u4f1a\u4ee3\u66ff\u4ed6\u4eba\u4f5c\u51b3\u5b9a\u3002'],
        ['\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90', '\u4ed6\u7684\u65e5\u5e38\u7ecf\u9a8c\u4e0d\u7b49\u4e8e\u8d26\u672c\u6388\u6743\u7684\u80fd\u529b\u3002'],
    ];
    const block = (extra = '') => [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${actorRef.name}\u3011`,
        `ActorRef: ${actorRef.actorId}`,
        ...seven.map(([title, text]) => `\u3010${title}\u3011${text}`),
        extra,
    ].filter(Boolean).join('\n');
    for (const [label, output] of [
        ['unknown', block('\u3010\u5176\u4ed6\u5206\u7c7b\u3011\u4e0d\u5e94\u88ab\u9759\u9ed8\u541e\u6389\u3002')],
        ['duplicate', block('\u3010\u4eba\u7269\u4fe1\u606f\u3011\u91cd\u590d\u6bb5\u843d\u4e0d\u80fd\u6210\u4e3a\u4fee\u590d\u3002')],
    ]) {
        const parsed = parseActorProfileCompletionBatchOutput(output, {
            candidates: [{ actorRef, completionMode: 'full' }],
        });
        assert.equal(parsed.entries.length, 1, label);
        assert.equal(parsed.failures.length, 0, label);
    }

    const sectionKeys = [
        'person', 'physiology', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ];
    const rawNarrative = {
        profileFormat: 'narrative-v1',
        actorRef,
        narrativeSections: Object.fromEntries(sectionKeys.map((key) => [key, {
            text: `${key} \u4e3a\u5b8c\u6574\u7684\u81ea\u7136\u4e2d\u6587\u6bb5\u843d\u3002`,
            source: key === 'history' ? 'deprecated' : 'confirmed',
            evidence: ['model-must-not-own-authority'],
        }])),
    };
    const parsedJson = parseActorProfileCompletionBatchOutput(JSON.stringify(rawNarrative), {
        candidates: [{ actorRef, completionMode: 'full' }],
    });
    assert.equal(parsedJson.entries.length, 1);
    assert.equal(Object.values(parsedJson.entries[0].candidate.narrativeSections).every((section) => (
        section.source === 'hypothesis' && section.evidence.length === 0
    )), true, 'transport cannot claim confirmed or deprecated provenance');
});

test('narrative-v1 discovery derives a candidate only from one literal title-name occurrence', () => {
    const name = '\u6797\u5cb8';
    const acceptedNarrative = `\u96fe\u4e2d\u7684${name}\u8d70\u8fd1\u54e8\u4f4d\uff0c\u6ca1\u6709\u8bf4\u522b\u7684\u8bdd\u3002`;
    const output = [
        `# \u3010\u4eba\u7269\u6863\u6848\uff1a${name}\u3011`,
        '\u3010\u4eba\u7269\u4fe1\u606f\u3011\u4ed6\u5728\u8fb9\u754c\u54e8\u5361\u8d1f\u8d23\u5f15\u8def\u3002',
        '\u3010\u751f\u7406\u7279\u5f81\u3011\u4ed6\u7684\u8eab\u4f53\u7279\u5f81\u7b26\u5408\u6b64\u4e16\u754c\u7684\u4eba\u7c7b\u8bbe\u5b9a\u3002',
        '\u3010\u6027\u683c\u7279\u5f81\u3011\u4ed6\u529e\u4e8b\u5ba1\u614e\uff0c\u4f1a\u7559\u610f\u5408\u4f5c\u8005\u7684\u754c\u7ebf\u3002',
        '\u3010\u8fc7\u5f80\u7ecf\u5386\u3011\u4ed6\u6709\u591a\u5e74\u4e61\u95f4\u8def\u7ebf\u5de5\u4f5c\u7684\u7ecf\u9a8c\u3002',
        '\u3010\u5f53\u524d\u72b6\u6001\u3011\u4ed6\u6b63\u4e0e\u5176\u4ed6\u54e8\u536b\u4fdd\u6301\u8f6e\u503c\u3002',
        '\u3010\u5173\u7cfb\u4e0e\u52a8\u673a\u3011\u4ed6\u91cd\u89c6\u4e92\u52a9\uff0c\u4e0d\u8d8a\u6743\u66ff\u4ed6\u4eba\u9009\u62e9\u3002',
        '\u3010\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90\u3011\u4ed6\u77e5\u9053\u7a33\u5b9a\u7684\u54e8\u5361\u89c4\u7a0b\uff0c\u5b9e\u9645\u8d44\u6e90\u4ecd\u4ee5\u8d26\u672c\u4e3a\u51c6\u3002',
    ].join('\n');
    const parsed = parseActorProfileCompletionBatchOutput(output, {
        candidates: [],
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef('chat-narrative-literal', 24),
        },
    });
    assert.equal(parsed.discoveries.length, 1);
    assert.equal(parsed.discoveries[0].candidateRef.name, name);
    assert.equal(parsed.discoveries[0].candidateRef.sourceAnchor, name);
    assert.equal(parsed.discoveries[0].offset, acceptedNarrative.indexOf(name));
    assert.match(parsed.discoveries[0].temporaryActorId, /^DISC-/u);
});

test('narrative transport accepts bounded heading forms and only the strict empty sentinel', () => {
    const empty = parseActorProfileCompletionBatchOutput('\u65e0\u4eba\u7269\u6863\u6848\u3002', { candidates: [] });
    assert.equal(empty.explicitEmpty, true);
    assert.equal(empty.entries.length, 0);
    const prose = parseActorProfileCompletionBatchOutput('\u6ca1\u6709\u65b0\u4eba\u7269\uff0c\u4eca\u65e5\u5e73\u9759\u3002', { candidates: [] });
    assert.equal(prose.explicitEmpty, false, 'only the exact sentinel is no-candidates');
    assert.equal(prose.batchMeta.formatUnrecoverable, true);
    const multi = parseActorProfileCompletionBatchOutput([
        '```markdown',
        '## \u4eba\u7269\u6863\u6848\uff1a\u5357\u6865',
        'ActorRef: NPC-HEADING',
        '\u4eba\u7269\u4fe1\u606f\uff1a\u4ed6\u662f\u8d1f\u8d23\u5f15\u8def\u7684\u5b88\u536b\u3002',
        '# \u751f\u7406\u7279\u5f81\uff1a\u5176\u4f53\u5f81\u7b26\u5408\u4eba\u7c7b\u8bbe\u5b9a\u3002',
        '\u3010\u6027\u683c\u7279\u5f81\u3011\u4ed6\u4f1a\u5148\u542c\u53d6\u4ed6\u4eba\u7684\u9700\u6c42\u3002',
        '\u8fc7\u5f80\u7ecf\u5386\uff1a\u4ed6\u66fe\u957f\u671f\u5728\u8fb9\u9547\u503c\u5b88\u3002',
        '\u3010\u5f53\u524d\u72b6\u6001\u3011\u4ed6\u6b63\u5728\u5b88\u62a4\u56fa\u5b9a\u54e8\u4f4d\u3002',
        '\u5173\u7cfb\u4e0e\u52a8\u673a\uff1a\u4ed6\u91cd\u89c6\u5408\u4f5c\u4e0e\u8fb9\u754c\u3002',
        '\u3010\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90\u3011\u4ed6\u77e5\u9053\u54e8\u4f4d\u6d41\u7a0b\uff0c\u5176\u4ed6\u8d44\u6e90\u4ee5\u8d26\u672c\u4e3a\u51c6\u3002',
        '```',
    ].join('\n'), { candidates: [{ actorRef: { actorId: 'NPC-HEADING', name: '\u5357\u6865' } }] });
    assert.equal(multi.entries.length, 1);

    const dialogue = parseActorProfileCompletionBatchOutput([
        '【人物档案：北桥】', 'ActorRef：NPC-DIALOGUE',
        '人物信息：她是负责夜间引路的守卫。', '生理特征：其体征符合人类设定。',
        '性格特征：她会耐心听取同伴的选择。', '过往经历：她长期在边境城镇值守。',
        '【当前状态】她正维持固定的夜间职责。\n她说：先别替别人决定。\n原因是：每个人都要保留选择。',
        '关系与动机：她愿意协作，但尊重每个人的边界。',
        '知识、能力与资源：她熟悉值守流程，资源仍以账本为准。',
    ].join('\n'), { candidates: [{ actorRef: { actorId: 'NPC-DIALOGUE', name: '\u5317\u6865' } }] });
    assert.equal(dialogue.entries.length, 1);
    assert.match(dialogue.entries[0].candidate.narrativeSections.currentState.text, /她说/u);

    const bracketUnknown = parseActorProfileCompletionBatchOutput([
        '【人物档案：北桥】', 'ActorRef：NPC-DIALOGUE',
        '【人物信息】她是负责夜间引路的守卫。', '【生理特征】其体征符合人类设定。',
        '【性格特征】她会耐心听取同伴的选择。', '【过往经历】她长期在边境城镇值守。',
        '【当前状态】她正维持固定的夜间职责。', '【未知段】此段必须失败。',
        '【关系与动机】她愿意协作，但尊重每个人的边界。',
        '【知识、能力与资源】她熟悉值守流程，资源仍以账本为准。',
    ].join('\n'), { candidates: [{ actorRef: { actorId: 'NPC-DIALOGUE', name: '\u5317\u6865' } }] });
    assert.equal(bracketUnknown.entries.length, 1);
    assert.equal(bracketUnknown.failures.length, 0);
});

test('legacy V6 normalizes and renders without adding narrative persistence fields', () => {
    const legacy = prepareActorProfileV6(actor('NPC-LEGACY-SHAPE', '\u65e7\u6863\u6848'), { mode: 'full', turn: 1 });
    delete legacy.profileFormat;
    delete legacy.narrativeSections;
    const normalized = normalizeActorProfileV6(legacy, {
        actorId: 'NPC-LEGACY-SHAPE',
        name: '\u65e7\u6863\u6848',
        mode: 'full',
    });
    const view = actorProfileV6View({ id: 'NPC-LEGACY-SHAPE', name: '\u65e7\u6863\u6848', profileV6: legacy });
    assert.equal(Object.hasOwn(normalized, 'profileFormat'), false);
    assert.equal(Object.hasOwn(normalized, 'narrativeSections'), false);
    assert.equal(view.profileFormat, undefined);
    assert.equal(view.narrativeSections, null);
});

test('nine-actor long sessions never turn missing dossiers into generic plans', () => {
    let ledger = {
        turn: 1,
        actors: Array.from({ length: 9 }, (_, index) => (
            actor(`NPC-LONG-${index + 1}`, `人物${index + 1}`)
        )),
    };
    const first = prepareActorLedgerProfilesV6(ledger, { mode: 'full', turn: 1, now: 100 });
    ledger = first.ledger;
    const historyCounts = ledger.actors.map((entry) => entry.profileV6.history.length);
    for (let turn = 2; turn <= 54; turn += 1) {
        ledger.turn = turn;
        ledger = prepareActorLedgerProfilesV6(ledger, {
            mode: 'full',
            turn,
            now: 100 + turn,
        }).ledger;
    }
    assert.equal(ledger.actors.every((entry) => entry.profileV6.coverage < 100), true);
    assert.equal(ledger.actors.every((entry) => !entry.profileV6.preparedForAction), true);
    assert.equal(ledger.actors.every((entry) => entry.currentGoals.length === 0), true);
    assert.equal(ledger.actors.every((entry) => !entry.plan.summary), true);
    assert.equal(ledger.actors.every((entry) => (
        Object.keys(entry.profileV6.fieldSources).length > 20
    )), true);
    assert.deepEqual(
        ledger.actors.map((entry) => entry.profileV6.history.length),
        historyCounts,
        'unchanged profiles must not fill the 40-entry history cap every turn',
    );
    assert.deepEqual(new Set(ledger.actors.map((entry) => entry.plan.summary)), new Set(['']));
});
