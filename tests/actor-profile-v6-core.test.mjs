import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
    prepareActorLedgerProfilesV6,
    prepareActorProfileV6,
    regenerateActorProfileV6Module,
    repairActorProfileInsertLocally,
    rollActorProfileDiversity,
    selectActorProfileCompletionCandidates,
    setActorProfileV6Lock,
    validateActorProfileInsertCandidate,
} from '../actor-profile-v6-core.mjs';
import {
    actorProfileCommitMatchesLedger,
    replaceActorProfileBaselineInLedger,
    scheduleActorTurns,
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
    }
    return candidate;
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
    assert.match(messages[0].content, /数据库\/角色卡\/原著硬设定 > 已接受正文事实 > 缝合怪/u);
    assert.match(messages[0].content, /骰子由脚本选择/u);
    assert.match(messages[1].content, new RegExp(first.ticketId, 'u'));
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
            stitcher: { identity: { role: '缝合怪明确角色' } },
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
    const candidates = selectActorProfileCompletionCandidates(prepared.ledger);
    assert.equal(candidates.length, 1);
    assert.equal(Object.hasOwn(candidates[0], 'currentGoals'), false);
    assert.equal(Object.hasOwn(candidates[0], 'plan'), false);
    assert.equal(Object.hasOwn(candidates[0], 'location'), false);
    assert.equal(Object.hasOwn(candidates[0], 'stateFacts'), false);
    const messages = buildActorProfileCompletionMessages(candidates, { evidenceText });
    assert.match(messages[0].content, /追踪角色表/u);
    assert.match(messages[0].content, /追踪人设基线/u);
    assert.match(messages[0].content, /ProfileInsertCandidate/u);
    assert.match(messages[0].content, /内容仍需自然完整/u);
    assert.match(messages[0].content, /确无原设定时就合理创作/u);
    assert.match(messages[0].content, /数据库.*硬锚点/u);
    assert.doesNotMatch(messages[0].content, /一时写不出可以省略/u);
    assert.doesNotMatch(messages[0].content, /证据编号|来源标签|严格输出形状|全部键/u);
    assert.doesNotMatch(messages[0].content, /未成年|年龄不明|非性化|safetyNote|ageClass/u);
    assert.doesNotMatch(messages[1].content, /profileSummary|socialStyle|copingStyle|obstacles|costs|alternatives/u);
    assert.match(messages[1].content, /NPC-CHEN/u);
    const customMessages = buildActorProfileCompletionMessages(candidates, {
        evidenceText,
        customPrompt: 'PROFILE-PROMPT-SLOT-CANARY',
    });
    assert.match(customMessages[0].content, /用户自定义人物档案\/破限提示/u);
    assert.match(customMessages[0].content, /PROFILE-PROMPT-SLOT-CANARY/u);

    const partial = parseActorProfileCompletionOutput(
        '这里是填表结果：```json\n[{"identity":{"role":"临时领头人"}}]\n```',
        { candidates, evidenceText },
    );
    assert.equal(partial.ok, false);
    assert.equal(partial.errorCode, 'actor_profile.schema_incomplete');
    assert.equal(partial.candidate, null, 'incomplete output must never expose a partial profile');
    assert.ok(partial.missingFields.includes('actorRef.actorId'));

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
    assert.equal(parsed.ok, true);
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
    const digest = actorProfileBaselineDigest(baseline);
    const committed = replaceActorProfileBaselineInLedger(
        prepared.ledger,
        patch.actorRef,
        baseline,
        {
            commitId: 'PBI-SYNTHETIC-1',
            digest,
            committedTurn: 4,
            readbackVerified: true,
        },
    );
    assert.equal(committed.committed, true);
    assert.equal(actorProfileCommitMatchesLedger(committed.ledger, {
        actorRef: patch.actorRef,
        schemaVersion: ACTOR_PROFILE_V6_VERSION,
        commitId: 'PBI-SYNTHETIC-1',
        digest,
    }).ok, true);
    assert.equal(actorProfileReadyForAction(committed.ledger.actors[0]), true);
    assert.equal(
        committed.ledger.actors[0].currentGoals[0],
        '本轮动态目标不得被基线覆盖',
    );
    assert.equal(committed.ledger.actors[0].plan.summary, '本轮动态计划保持独立');
    assert.equal(scheduleActorTurns(committed.ledger, {
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
        { maxActors: 1, turn: 6 },
    )[0].actorId, 'NPC-CHEN');

    const adultPrepared = prepareActorLedgerProfilesV6({
        turn: 4,
        actors: [structuredClone(committed.ledger.actors[0])],
    }, { mode: 'full_adult', turn: 4, now: 100 });
    const adultCandidates = selectActorProfileCompletionCandidates(adultPrepared.ledger);
    assert.equal(adultCandidates.length, 1, 'a completed core dossier must still retry its empty body table');
    const adultMessages = buildActorProfileCompletionMessages(adultCandidates, { evidenceText });
    assert.match(adultMessages[0].content, /追踪身体基线/u);
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
    const adultDigest = actorProfileBaselineDigest(adultProfile);
    const adultCommitted = replaceActorProfileBaselineInLedger(
        adultPrepared.ledger,
        adultPatch.actorRef,
        adultProfile,
        {
            commitId: 'PBI-SYNTHETIC-ADULT',
            digest: adultDigest,
            committedTurn: 4,
            readbackVerified: true,
        },
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
    const candidate = selectActorProfileCompletionCandidates(prepared.ledger)[0];
    const parsed = parseActorProfileCompletionOutput(JSON.stringify({
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
            identity: 'hypothesis',
            personality: 'designed_seed',
            relationships: 'hypothesis',
            goals: 'designed_seed',
            knowledge: 'hypothesis',
            resourcesCapabilities: 'hypothesis',
        },
    }), { candidates: [candidate], completionMode: 'full' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.candidate.identity.role, '临时领队');
    assert.equal(parsed.candidate.identity.appearance.includes('黑色短发'), true);
    assert.deepEqual(parsed.candidate.personality.primaryDerivatives, [
        '陌生环境里先核对出口、人数和可退路线，信息清楚后才谈收益。',
        '一旦有人明确跟随，他会把对方安全计入决定，但仍说明风险。',
    ]);
    assert.equal(parsed.candidate.goals.strategy.summary, '先观察出口，再决定是否接单');
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
        assert.match(result.candidate.personality.biography, /我原本/u);
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
    const digest = actorProfileBaselineDigest(baseline);
    const committed = replaceActorProfileBaselineInLedger(
        prepared.ledger,
        candidate.actorRef,
        baseline,
        { commitId: 'PBI-CHECK', digest, committedTurn: 3, readbackVerified: true },
    );
    assert.equal(committed.committed, true);
    const expected = {
        actorRef: candidate.actorRef,
        schemaVersion: ACTOR_PROFILE_V6_VERSION,
        commitId: 'PBI-CHECK',
        digest,
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
        const digest = actorProfileBaselineDigest(baseline);
        const committed = replaceActorProfileBaselineInLedger(
            ledger,
            result.candidate.actorRef,
            baseline,
            {
                schemaVersion: baseline.version,
                commitId: `commit-${actorId}`,
                digest,
                sourceRef: { chatId: 'chat-profile-transaction', messageId: 'm4' },
                committedTurn: 4,
                readbackVerified: true,
            },
        );
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
