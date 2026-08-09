import { fingerprint } from './core.mjs';

export const ACTOR_PROFILE_V6_VERSION = 6;
export const ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT = `
【人物主权与多样性】
- 人物不是职业、阵营、物种、性别、外貌或心理类型标签的函数；不得默认粗暴、冷漠、疯癫、绝望、敌对或同质化善良。
- 让不同人物在价值取向、说话节奏、行动习惯、关系距离、信息取样、典型误读、受压反应与恢复路径上形成可观察差异。
- 普通、善意、幽默、克制、胆怯、现实、功利、温和、尴尬和低风险生活都可持续存在；冲突必须来自已有利益、误会、责任或资源条件。
- 一次恐惧、愤怒、失败、服从或受伤不能反推永久人格、隐藏创伤、秘密关系、能力资源或玩家经历。
- 修正无证据黑暗化时保留已有合理敌意、利益冲突和个人边界，不把所有人物洗成同一种好人。
- 人物只决定自身行动尝试；不得替玩家决定行动、同意、参与、支付、感受或关系态度，结果由世界裁决器另行结算。
`.trim();
export const ACTOR_PROFILE_COMPLETION_MODES = Object.freeze([
    'off',
    'basic',
    'full',
    'full_adult',
]);
export const ACTOR_PROFILE_SOURCES = Object.freeze([
    'confirmed',
    'designed_seed',
    'hypothesis',
    'deprecated',
]);
export const ACTOR_PROFILE_MODULES = Object.freeze([
    'identity',
    'personality',
    'relationships',
    'goals',
    'knowledge',
    'resourcesCapabilities',
    'dynamicState',
    'actionHistory',
    'physiology',
]);
const PHYSIOLOGY_CONTENT_FIELDS = Object.freeze([
    'facialAppearance',
    'oralCavity',
    'hairstyle',
    'neckShoulderArmpit',
    'heightWeight',
    'bodySpecial',
    'skinTexture',
    'bodyScent',
    'bodyMeasurements',
    'breastAppearance',
    'waistAbdomen',
    'vulvaAppearance',
    'vaginalProfile',
    'anusAppearance',
    'buttockAppearance',
    'legAppearance',
    'footSize',
    'footAppearance',
    'lactationBodyFluid',
    'sensitiveParts',
]);

const SOURCE_SET = new Set(ACTOR_PROFILE_SOURCES);
const MODULE_SET = new Set(ACTOR_PROFILE_MODULES);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 500) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 16, itemLimit = 300) {
    if (!Array.isArray(value)) return [];
    const output = [];
    const seen = new Set();
    for (const entry of value) {
        const item = cleanText(entry, itemLimit);
        const key = item.toLocaleLowerCase();
        if (!item || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
        if (output.length >= limit) break;
    }
    return output;
}

function evidenceKey(value) {
    return cleanText(value, 1000)
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function evidenceFragments(value) {
    const output = [];
    const seen = new Set();
    const lines = String(value || '').split(/\r?\n/gu);
    for (const rawLine of lines) {
        const line = cleanText(rawLine, 6000);
        if (!line) continue;
        const pieces = line.length > 520
            ? (line.match(/.{1,520}(?:[。！？!?]|$)/gu) || [line])
            : [line];
        for (const rawPiece of pieces) {
            const text = cleanText(rawPiece, 520);
            const key = evidenceKey(text);
            if (key.length < 4 || seen.has(key)) continue;
            seen.add(key);
            output.push(text);
        }
    }
    return output;
}

export function buildActorProfileEvidenceBank(evidenceText, {
    candidates = [],
    limit = 96,
} = {}) {
    const fragments = evidenceFragments(evidenceText);
    const names = (Array.isArray(candidates) ? candidates : [])
        .flatMap((candidate) => [candidate?.name, ...(candidate?.identity?.aliases || [])])
        .map((name) => cleanText(name, 160))
        .filter(Boolean);
    const named = fragments.filter((fragment) => names.some((name) => fragment.includes(name)));
    const selected = [];
    const used = new Set();
    for (const fragment of [
        ...named,
        ...fragments.slice(-64),
        ...fragments.slice(0, 24),
    ]) {
        const key = evidenceKey(fragment);
        if (!key || used.has(key)) continue;
        used.add(key);
        selected.push(fragment);
        if (selected.length >= integer(limit, 8, 160, 96)) break;
    }
    return selected.map((text, index) => ({
        id: `E${String(index + 1).padStart(3, '0')}`,
        text,
    }));
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function modeOf(value) {
    return ACTOR_PROFILE_COMPLETION_MODES.includes(value) ? value : 'full';
}

function sourceOf(value, fallback = 'confirmed') {
    return SOURCE_SET.has(value) ? value : fallback;
}

function normalizeModule(value, fallbackData = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        status: ['missing', 'queued', 'ready', 'deferred'].includes(source.status)
            ? source.status
            : 'missing',
        source: sourceOf(source.source, 'confirmed'),
        data: source.data && typeof source.data === 'object' && !Array.isArray(source.data)
            ? clone(source.data)
            : clone(fallbackData),
        unknownFields: cleanList(source.unknownFields, 64, 160),
        version: integer(source.version, 1, Number.MAX_SAFE_INTEGER, 1),
        updatedTurn: integer(source.updatedTurn),
        evidence: cleanList(source.evidence, 16, 300),
    };
}

function emptyPhysiology() {
    return Object.fromEntries([
        ['enabled', false],
        ['adultEnabled', false],
        ...PHYSIOLOGY_CONTENT_FIELDS.map((field) => [field, '']),
    ]);
}

function normalizePhysiology(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries([
        ['enabled', source.enabled === true],
        ['adultEnabled', source.adultEnabled === true],
        ...PHYSIOLOGY_CONTENT_FIELDS.map((field) => [field, cleanText(source[field], 4000)]),
    ]);
}

export function emptyActorProfileV6(actorId = '', name = '', { mode = 'full' } = {}) {
    return {
        version: ACTOR_PROFILE_V6_VERSION,
        actorId: cleanText(actorId, 120),
        name: cleanText(name, 160),
        completionMode: modeOf(mode),
        preparedForAction: false,
        backgroundPending: false,
        coverage: 0,
        modules: Object.fromEntries(ACTOR_PROFILE_MODULES.map((module) => [
            module,
            normalizeModule(null, module === 'physiology' ? emptyPhysiology() : {}),
        ])),
        fieldSources: {},
        locks: {},
        manualOverrides: {},
        moduleVersions: Object.fromEntries(ACTOR_PROFILE_MODULES.map((module) => [module, 0])),
        history: [],
        updatedTurn: 0,
    };
}

export function normalizeActorProfileV6(value, {
    actorId = '',
    name = '',
    mode = 'full',
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const output = emptyActorProfileV6(
        actorId || source.actorId,
        name || source.name,
        { mode: source.completionMode || mode },
    );
    output.preparedForAction = source.preparedForAction === true;
    output.backgroundPending = source.backgroundPending === true;
    output.coverage = integer(source.coverage, 0, 100, 0);
    for (const module of ACTOR_PROFILE_MODULES) {
        output.modules[module] = normalizeModule(
            source.modules?.[module],
            module === 'physiology' ? emptyPhysiology() : {},
        );
        if (module === 'physiology') {
            output.modules[module].data = normalizePhysiology(output.modules[module].data);
        }
    }
    output.fieldSources = Object.fromEntries(
        Object.entries(source.fieldSources || {})
            .map(([path, fieldSource]) => [cleanText(path, 240), sourceOf(fieldSource)])
            .filter(([path]) => path),
    );
    output.locks = Object.fromEntries(
        Object.entries(source.locks || {})
            .map(([path, locked]) => [cleanText(path, 240), locked === true])
            .filter(([path]) => path),
    );
    output.manualOverrides = source.manualOverrides
        && typeof source.manualOverrides === 'object'
        && !Array.isArray(source.manualOverrides)
        ? clone(source.manualOverrides)
        : {};
    for (const module of ACTOR_PROFILE_MODULES) {
        output.moduleVersions[module] = integer(source.moduleVersions?.[module]);
    }
    output.history = (Array.isArray(source.history) ? source.history : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            id: cleanText(entry.id, 120),
            action: cleanText(entry.action, 120),
            module: MODULE_SET.has(entry.module) ? entry.module : 'identity',
            turn: integer(entry.turn),
            at: integer(entry.at),
            beforeDigest: cleanText(entry.beforeDigest, 120),
            afterDigest: cleanText(entry.afterDigest, 120),
        }))
        .filter((entry) => entry.id)
        .slice(-40);
    output.updatedTurn = integer(source.updatedTurn);
    return output;
}

const SOCIAL_SEEDS = [
    '先确认彼此边界，再用小而可撤回的承诺建立信任',
    '对熟人直接，对陌生人保留礼貌距离，冲突后倾向给出可执行方案',
    '用观察与提问校准关系，不把一次情绪当成永久立场',
    '愿意合作但重视对价，通常先处理现实问题再讨论感受',
    '通过日常互助维持关系，遇到压力会缩短表达而不是自动敌对',
    '习惯用轻微幽默缓冲尴尬，同时保留明确拒绝的能力',
    '面对权威会核对规则与后果，对弱势者更关注实际可行的支持',
    '关系靠持续行动而非口号推进，亲近与警惕可以同时存在',
];
const DECISION_SEEDS = [
    '在时间、成本、关系后果与可逆性之间做现实权衡',
    '先寻找最低风险的试探步骤，再根据反馈扩大或撤回投入',
    '信息不足时保留多个解释，不把最坏可能直接当作事实',
    '优先履行明确承诺，同时为意外保留替代路线',
    '会区分紧急与重要，不因场面压力放弃长期目标',
    '倾向把大目标拆成能留下回执的小步骤',
    '先检查自身资源和权限，再决定请求协助或独立处理',
    '允许暂时观望，但需要具体条件与下一检查窗口',
];
const SPEECH_SEEDS = [
    '表达具体，少用绝对化判断，会说明自己能做与不能做的部分',
    '句式自然克制，熟悉后会增加玩笑和省略，不用同一种腔调对所有人',
    '先回应事实再表达态度，意见冲突时偏好给出理由而非威吓',
    '说话节奏受关系和场合影响，公开场合更谨慎，私下更直接',
    '不把情绪当命令，必要时会暂停并约定稍后继续',
    '愿意承认不知道，并把需要核实的部分说清楚',
    '礼貌不等于顺从，拒绝时会尽量给出替代办法',
    '重视对方是否真正理解，复杂事情会换一种说法确认',
];
const PERSONAL_GOAL_SEEDS = [
    {
        longTerm: '保持生活秩序与可支配时间，不让外部事件吞掉全部日常',
        current: '梳理眼前事务的轻重缓急，先完成一个不依赖他人同意的步骤',
        steps: ['列出紧急、重要和可延后的事务', '完成成本最低且可留下回执的准备', '根据实际反馈安排下一窗口'],
        obstacle: '外部变化可能打乱自己的时间安排',
        cost: '需要投入时间与注意力',
        alternative: '条件不足时先缩小范围，保留之后恢复的接口',
    },
    {
        longTerm: '建立可持续的互惠关系，同时保留明确边界和退出余地',
        current: '用一次小而可撤回的合作核对彼此的可靠程度',
        steps: ['确认双方能够承担的最小事项', '约定一个可核验回执', '依据履约情况调整关系距离'],
        obstacle: '对方的意图与能力仍可能不完整',
        cost: '需要承担一次有限的信任风险',
        alternative: '若合作条件不成立，改为交换公开信息而不作承诺',
    },
    {
        longTerm: '逐步弄清影响自身选择的关键信息，不把猜测当成事实',
        current: '核对一条与自己处境直接相关的不确定信息',
        steps: ['区分已知、传闻与未知', '选择可独立验证的一条线索', '记录结果并保留至少一种解释'],
        obstacle: '可用信息存在缺口或来源偏差',
        cost: '需要花费一次行动窗口进行核对',
        alternative: '无法验证时保持观望，只做可逆准备',
    },
    {
        longTerm: '维持现实安全和行动余地，不为场面压力做不可撤回决定',
        current: '检查当前风险、出口与可以提前准备的低成本措施',
        steps: ['确认最直接的风险来源', '准备一个不扩大冲突的应对办法', '约定下一次复核条件'],
        obstacle: '风险可能变化，现有判断并不完备',
        cost: '需要暂时放慢其他事务',
        alternative: '优先撤离或请求明确协助，不独自扩大风险',
    },
    {
        longTerm: '找到能稳定交换价值的位置，使自己的投入获得现实回报',
        current: '盘点自己已确认能做的事与当前缺口，选择一个可交付的小目标',
        steps: ['只盘点已有能力与资源', '定义一个不超出权限的交付', '用结果决定是否继续投入'],
        obstacle: '需求、权限或回报可能尚未说清',
        cost: '需要占用一次可支配行动窗口',
        alternative: '无法交付时先澄清条件，不承诺未知能力',
    },
    {
        longTerm: '保留稳定的恢复节奏，使压力不会永久取代原有生活',
        current: '完成一项能恢复秩序的小事务，再重新评估更大的问题',
        steps: ['确认当前最影响状态的因素', '完成一项短而具体的恢复步骤', '状态回稳后再扩大行动'],
        obstacle: '紧急事务可能持续挤压恢复空间',
        cost: '需要主动留出休息或整理时间',
        alternative: '无法完整恢复时先降低任务强度并延后非紧急承诺',
    },
    {
        longTerm: '让承诺、成本和实际能力保持一致，避免被旧决定拖入失控',
        current: '复核一项现有承诺的期限、代价与可替代路线',
        steps: ['确认承诺仍然有效的依据', '检查当前可承担的成本', '必要时提前提出可执行的调整'],
        obstacle: '承诺对象或环境可能已经变化',
        cost: '可能需要放弃较低优先级的安排',
        alternative: '无法按原方案履行时，尽早缩小范围或重新约定',
    },
    {
        longTerm: '保持自己的判断独立，不把外部刺激自动变成个人目标',
        current: '评估一个新机会或风险是否真的值得纳入自己的计划',
        steps: ['说明它与长期目标的真实关系', '估算最低投入与最坏代价', '选择采纳、忽略、利用或反对并留下理由'],
        obstacle: '外部刺激可能带有不完整或偏向性信息',
        cost: '需要暂停一次惯性反应进行判断',
        alternative: '证据不足时保持原计划，只设置下一检查条件',
    },
    {
        longTerm: '把一门手艺或工作方法打磨到稳定可复用',
        current: '完成一个可检查的小样，用实际结果找出下一处改进',
        steps: ['选定一项具体技术细节', '完成小样并记录误差', '只修改有证据的一处'],
        obstacle: '可用工具、材料或反馈可能有限',
        cost: '需要投入一段不被打断的专注时间',
        alternative: '条件不足时先做纸面演练或工具检查',
    },
    {
        longTerm: '让一个需要照顾的人、生物或场所保持稳定',
        current: '确认对方最迫切且自己能承担的一项需要',
        steps: ['观察当前状态而不预设答案', '提供一项边界清楚的帮助', '依据回应决定是否继续'],
        obstacle: '需要与对方的自主选择和自己的精力边界协调',
        cost: '需要留出一次关注和回访的时间',
        alternative: '无法亲自承担时帮忙找到合适资源',
    },
    {
        longTerm: '理解一个反复出现的现象，形成能被反驳的解释',
        current: '收集一组能区分两种解释的新观察',
        steps: ['写下至少两种可能解释', '找出它们预测不同的地方', '完成一次有界限的观察'],
        obstacle: '新证据可能同时支持多种解释',
        cost: '需要承认原先假设可能不完整',
        alternative: '暂时保留多个假设并标出下一验证点',
    },
    {
        longTerm: '在所属群体中获得与实际贡献相符的声誉与话语权',
        current: '选择一件公开、可交付且容易被核验的事',
        steps: ['确认群体当前真正需要的结果', '说清自己承担的部分', '用完成记录而不是自我宣称证明'],
        obstacle: '评价可能受旧印象或利益分配影响',
        cost: '公开承担会带来被审视的压力',
        alternative: '暂不争论评价，先积累可核验成果',
    },
    {
        longTerm: '建立一个不必以表现、成就或危机换取的归属感',
        current: '参与一次低风险的共同日常，观察自己是否能自然留在其中',
        steps: ['选择一个不要求立即表态的场合', '承担一件小而真实的共同事务', '根据实际舒适度调整距离'],
        obstacle: '过去的互动方式可能让普通亲近显得陌生',
        cost: '需要容忍一点尴尬和不确定',
        alternative: '保留定期来往而不急于定义关系',
    },
    {
        longTerm: '保有对工作、迁居与重要关系的实际选择权',
        current: '找出当前最限制选择的一个条件并降低它的绑定',
        steps: ['区分真正的硬约束与习惯性预设', '为一个替代方案准备最小条件', '在不中断现有安全网的前提下试行'],
        obstacle: '现有资源和承诺会限制转向速度',
        cost: '需要为备选路线预留资源',
        alternative: '先增加信息和联系，不立即做不可逆切换',
    },
    {
        longTerm: '修复一段仍有价值但已经失去可靠互动方式的关系',
        current: '确认一个双方都能看见的具体分歧，而不概括整段关系',
        steps: ['只陈述一件可核对的事', '说明自己能改变的部分', '提议一次可中止的小范围合作'],
        obstacle: '双方对旧事的理解可能仍不一致',
        cost: '需要承担一次被拒绝或暂无回应的风险',
        alternative: '对方不愿参与时保留礼貌边界并停止追逼',
    },
    {
        longTerm: '留下一套别人能理解、接手和继续改良的工作成果',
        current: '把一项只存在自己经验里的做法转成可验证记录',
        steps: ['选择最容易丢失的一个步骤', '记录条件、判断与失败征兆', '让一个不熟悉的人尝试复现'],
        obstacle: '熟练后的直觉很难一次说清',
        cost: '整理会暂时拖慢手头产出',
        alternative: '先保存最小检查表和一个完整案例',
    },
    {
        longTerm: '建立一条不依赖临时运气的收入或资源交换路径',
        current: '核对一项真实需求的数量、交付条件和回报',
        steps: ['确认需求者和实际使用场景', '计算自己能承担的最小交付', '先完成一次不扩张的交易'],
        obstacle: '价格、需求和交付风险可能不透明',
        cost: '需要承担有限的资金或库存占用',
        alternative: '先以小样、预约或信息服务验证需求',
    },
    {
        longTerm: '让一项反复伤害弱者的规则变得可检查、可申诉、可修正',
        current: '收集一个完整事例和对应规则文本，确认问题发生在哪一步',
        steps: ['保存可验证的时间与回执', '区分个别执行失误与规则本身缺陷', '选择一个有权处理的入口'],
        obstacle: '证据链可能不完整，也可能存在正当反对意见',
        cost: '需要持续记录并承担一定公开压力',
        alternative: '暂时无法推动规则时先帮助具体个案完成申诉',
    },
    {
        longTerm: '保留无功利的好奇、幽默和游戏空间，不让所有时间都变成任务',
        current: '发起一次不以胜负或主线成果为目标的小活动',
        steps: ['选一个成本低且可随时停止的玩法', '邀请而不强求他人参与', '让结果停留在开心或尴尬本身'],
        obstacle: '近期压力可能让休闲显得不够正当',
        cost: '需要留出一小段时间并接受活动可能冷场',
        alternative: '无人参与时保留一项自己也能完成的乐趣',
    },
    {
        longTerm: '把居住地维持成安全、顺手且能恢复精力的地方',
        current: '修复一个每天都在制造麻烦的具体问题',
        steps: ['找到最频繁的一个不便', '检查工具、材料和使用者需求', '完成一次可撤回的局部改动'],
        obstacle: '维修可能受到时间、产权或共用空间限制',
        cost: '需要消耗材料并协调短时不便',
        alternative: '先用临时标记、收纳或时段协议减少摩擦',
    },
    {
        longTerm: '恢复或维持能支撑日常行动的体力与作息',
        current: '记录一个可观察的状态变化，并尝试一项低风险调整',
        steps: ['区分短期疲劳与持续问题', '只改变一个作息、饮食或活动因素', '在约定时间后复查反应'],
        obstacle: '现有事务和环境可能妨碍稳定调整',
        cost: '需要降低一部分短期产出',
        alternative: '出现不明原因或恶化时停止自行试验并寻求合适支持',
    },
    {
        longTerm: '建立一条能在不同地点之间稳定往返的交通与信息路径',
        current: '核对一段路线的时间、成本、限制和备选节点',
        steps: ['从实际使用者获取当前情况', '完成一次有返回余地的试行', '把关键节点和变化条件记录下来'],
        obstacle: '时刻、天气、通行权或价格可能变化',
        cost: '需要承担一次试行的时间和费用',
        alternative: '无法亲自试行时先通过两个独立来源交叉核对',
    },
    {
        longTerm: '帮助一个初学者建立自己能检查对错的基础方法',
        current: '设计一个可以当场尝试并得到明确反馈的小练习',
        steps: ['确认对方已经会的部分', '只引入一个新判断点', '让对方自己复述和检查结果'],
        obstacle: '自己熟悉的步骤可能对初学者仍然跳跃',
        cost: '需要放慢节奏并接受不同的理解方式',
        alternative: '语言解释无效时改用示范、图示或分步清单',
    },
    {
        longTerm: '让一项空间、物件或公开成果拥有可辨认而不妨碍使用的美感',
        current: '找出一处最影响整体感受且可以局部修改的细节',
        steps: ['先确认用途和必须保留的约束', '做两个成本可控的小方案', '用实际使用和反馈选择'],
        obstacle: '使用者对美感的理解可能差异很大',
        cost: '需要额外的设计和试作时间',
        alternative: '无法形成共识时优先保留功能并采用可撤回方案',
    },
    {
        longTerm: '保护一项易被忽略的地方性知识、语言或共同记忆',
        current: '从一个愿意讲述的来源完成一份经对方确认的记录',
        steps: ['说清记录用途与可见范围', '保留来源对自己语句的修改权', '区分个人经历、传闻与可公开事实'],
        obstacle: '记忆可能不一致，某些内容也不适合公开',
        cost: '需要花时间整理、回访和管理权限',
        alternative: '先只保存索引与授权状态，不追求一次收集完整',
    },
    {
        longTerm: '建立一个能定期讨论分歧而不立即分裂的小型协作机制',
        current: '把当前争议拆成一项事实、一项利益和一项可试行规则',
        steps: ['让参与者各自确认自己的必要条件', '寻找一个有时限的小范围试行', '预先约定怎样根据结果修改'],
        obstacle: '参与者可能把一次让步理解为永久立场',
        cost: '需要投入协调、记录和复盘时间',
        alternative: '无法共同试行时先设置清晰交接面，各自行动',
    },
];

function seedIndex(actor, salt, length) {
    const identity = `${actor?.id || ''}|${actor?.name || 'actor'}`;
    const numericSuffix = String(actor?.id || '').match(/(\d+)$/u);
    const identityOffset = numericSuffix
        ? Math.max(0, Number(numericSuffix[1]) - 1)
        : [...identity].reduce(
            (sum, character, index) => sum + character.codePointAt(0) * (index + 1),
            0,
        );
    const saltOffset = [...String(salt || '')].reduce(
        (sum, character, index) => sum + character.codePointAt(0) * (index + 3),
        0,
    );
    return (identityOffset + saltOffset) % length;
}

function evidenceForActor(actor) {
    return cleanList([
        ...(actor?.evidence || []),
        ...(actor?.knowledge || []).map((entry) => entry?.id),
        ...(actor?.stateFacts || []).map((entry) => entry?.id),
    ], 16, 300);
}

function hasText(value) {
    if (typeof value === 'string') return Boolean(cleanText(value));
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== undefined;
}

function physiologySeed(actor, { adult = false } = {}) {
    return normalizePhysiology({
        enabled: adult,
        adultEnabled: adult,
    });
}

function completedPhysiologyModule(profile) {
    const module = profile?.modules?.physiology;
    return module?.data?.enabled === true
        && module.source !== 'designed_seed'
        && module.source !== 'deprecated'
        && moduleReady(profile, 'physiology');
}

function recordHistory(profile, module, action, before, after, turn, now) {
    const beforeDigest = `sha256:${fingerprint(JSON.stringify(before ?? null))}`;
    const afterDigest = `sha256:${fingerprint(JSON.stringify(after ?? null))}`;
    profile.history.push({
        id: `PV6H-${fingerprint(`${profile.actorId}|${module}|${action}|${turn}|${now}|${afterDigest}`).slice(0, 20)}`,
        action,
        module,
        turn,
        at: now,
        beforeDigest,
        afterDigest,
    });
    profile.history = profile.history.slice(-40);
}

function setFieldSource(profile, path, source) {
    const next = sourceOf(source);
    if (profile.fieldSources[path] === 'confirmed' && next !== 'confirmed') return;
    profile.fieldSources[path] = next;
}

function recordModuleFieldSources(profile, module, data, source, overrides = {}) {
    const root = `modules.${module}.data`;
    const normalizedOverrides = Object.entries(overrides || {})
        .map(([path, fieldSource]) => [
            cleanText(path, 240).replace(/^\.+/u, ''),
            sourceOf(fieldSource),
        ])
        .filter(([path]) => path)
        .sort((left, right) => right[0].length - left[0].length);
    const sourceFor = (relativePath) => normalizedOverrides.find(([path]) => (
        relativePath === path || relativePath.startsWith(`${path}.`)
    ))?.[1] || source;
    const walk = (value, path, relativePath = '') => {
        setFieldSource(profile, path, sourceFor(relativePath));
        if (!value || typeof value !== 'object') return;
        for (const [key, entry] of Object.entries(value)) {
            walk(entry, `${path}.${key}`, relativePath ? `${relativePath}.${key}` : key);
        }
    };
    walk(data, root);
}

function moduleSnapshot(module) {
    return {
        status: module?.status,
        source: module?.source,
        data: module?.data,
        unknownFields: module?.unknownFields,
        evidence: module?.evidence,
    };
}

function assignModule(profile, module, data, {
    source = 'confirmed',
    unknownFields = [],
    evidence = [],
    turn = 0,
    now = Date.now(),
    action = 'prepare',
    fieldSourceOverrides = {},
} = {}) {
    if (moduleLocked(profile, module)) {
        const current = profile.modules[module];
        recordModuleFieldSources(profile, module, current.data, current.source);
        return false;
    }
    const before = clone(profile.modules[module]);
    const next = {
        status: 'ready',
        source: sourceOf(source),
        data: clone(data),
        unknownFields: cleanList(unknownFields, 64, 160),
        evidence: cleanList(evidence, 16, 300),
    };
    recordModuleFieldSources(profile, module, next.data, next.source, fieldSourceOverrides);
    if (JSON.stringify(moduleSnapshot(before)) === JSON.stringify(next)) return false;
    profile.modules[module] = {
        ...next,
        version: profile.modules[module].version + 1,
        updatedTurn: integer(turn),
    };
    profile.moduleVersions[module] += 1;
    recordHistory(profile, module, action, before, profile.modules[module], turn, now);
    return true;
}

function moduleReady(profile, module) {
    const record = profile.modules[module];
    if (record?.status !== 'ready') return false;
    // Locally designed defaults are display scaffolding, not a persisted NPC
    // dossier. They must never unlock autonomous action.
    if (record.source === 'designed_seed' || record.source === 'deprecated') return false;
    const data = record.data || {};
    if (module === 'identity') return [
        data.name,
        data.role,
        data.species,
        data.gender,
        data.age,
        data.briefIntro,
        data.appearance,
        data.identityText,
    ].every((value) => Boolean(cleanText(value, 2400)));
    if (module === 'personality') {
        return Boolean(
            cleanText(data.biography)
            && cleanText(data.primaryColor)
            && cleanList(data.primaryDerivatives).length >= 2
            && cleanText(data.primarySentence)
            && cleanText(data.baseColor)
            && cleanList(data.baseDerivatives).length >= 2
            && cleanText(data.baseSentence)
            && cleanText(data.accentColor)
            && cleanList(data.accentDerivatives).length >= 2
            && cleanText(data.accentSentence)
            && cleanList(data.othersVoices).length >= 4
            && cleanText(data.authorVoice)
        );
    }
    if (module === 'relationships') return Array.isArray(data.entries)
        && (
            data.entries.length > 0
            || data.coverageState === 'no_confirmed_relationships'
        );
    if (module === 'goals') {
        return Boolean(
            cleanList(data.longTerm).length
            && cleanList(data.current).length
            && cleanText(data.plan?.summary)
            && cleanList(data.plan?.steps).length
        );
    }
    if (module === 'knowledge') return Array.isArray(data.entries)
        && data.unknownRemainsUnknown === true
        && (data.entries.length > 0 || data.coverageState === 'no_confirmed_knowledge');
    if (module === 'resourcesCapabilities') return Array.isArray(data.resources)
        && Array.isArray(data.capabilities)
        && data.noUnconfirmedAbilityGranted === true
        && (
            data.resources.length > 0
            || data.capabilities.length > 0
            || data.coverageState === 'no_confirmed_resources_or_capabilities'
        );
    if (module === 'dynamicState') return data.location && typeof data.location === 'object'
        && Array.isArray(data.stateFacts)
        && Array.isArray(data.stimuli);
    if (module === 'actionHistory') return Array.isArray(data.entries)
        && data.historicalActionsInvented === false
        && (data.entries.length > 0 || data.coverageState === 'no_actions_recorded');
    if (module === 'physiology') {
        if (data.enabled !== true) return true;
        return PHYSIOLOGY_CONTENT_FIELDS.every((field) => (
            Boolean(cleanText(data[field], 4000))
        ));
    }
    return false;
}

function calculateCoverage(profile) {
    // Adult physiology is an explicitly optional profile surface. Its unknown
    // details must stay visible, but they must not turn the core profile's
    // first-action readiness into an impossible 89% ceiling.
    const required = ACTOR_PROFILE_MODULES.filter((module) => module !== 'physiology');
    const ready = required.filter((module) => moduleReady(profile, module)).length;
    return required.length ? Math.round((ready / required.length) * 100) : 100;
}

function calculateOptionalCoverage(profile) {
    if (profile.modules.physiology.data.enabled !== true) return 100;
    return moduleReady(profile, 'physiology') ? 100 : 0;
}

export function prepareActorProfileV6(actor, {
    mode = 'full',
    turn = 0,
    now = Date.now(),
} = {}) {
    const completionMode = modeOf(mode);
    const profile = normalizeActorProfileV6(actor?.profileV6, {
        actorId: actor?.id,
        name: actor?.name,
        mode: completionMode,
    });
    const previousProfile = clone(profile);
    profile.completionMode = completionMode;
    const evidence = evidenceForActor(actor);
    if (completionMode === 'off') {
        profile.coverage = calculateCoverage(profile);
        profile.preparedForAction = profile.coverage === 100;
        profile.backgroundPending = !profile.preparedForAction;
        profile.updatedTurn = integer(turn);
        return profile;
    }

    const identity = {
        name: cleanText(actor?.name, 160),
        role: cleanText(actor?.identity?.role, 180),
        aliases: cleanList(actor?.identity?.aliases, 8, 120),
        lineage: clone(actor?.lineage || {}),
        species: cleanText(actor?.identity?.species, 160),
        gender: cleanText(actor?.identity?.gender, 80),
        age: cleanText(actor?.identity?.age, 80),
        briefIntro: cleanText(actor?.identity?.briefIntro, 240),
        appearance: cleanText(actor?.identity?.appearance, 1200),
        identityText: cleanText(actor?.identity?.identityText, 500),
        relationState: cleanText(actor?.identity?.relationState, 1200),
        attitudeToProtagonist: cleanText(actor?.identity?.attitudeToProtagonist, 600),
        pastExperience: cleanText(actor?.identity?.pastExperience, 2400),
    };
    assignModule(profile, 'identity', identity, {
        source: actor?.identity?.role ? 'confirmed' : 'hypothesis',
        unknownFields: [
            ...(actor?.identity?.role ? [] : ['role']),
            ...(actor?.identity?.species ? [] : ['species']),
            ...(actor?.identity?.gender ? [] : ['gender']),
            ...(actor?.identity?.age ? [] : ['age']),
            ...(actor?.identity?.briefIntro ? [] : ['briefIntro']),
            ...(actor?.identity?.appearance ? [] : ['appearance']),
            ...(actor?.identity?.identityText ? [] : ['identityText']),
            ...(actor?.identity?.relationState ? [] : ['relationState']),
            ...(actor?.identity?.attitudeToProtagonist ? [] : ['attitudeToProtagonist']),
            ...(actor?.identity?.pastExperience ? [] : ['pastExperience']),
        ],
        evidence,
        turn,
        now,
        fieldSourceOverrides: {
            name: 'confirmed',
            role: actor?.identity?.role ? 'confirmed' : 'hypothesis',
            aliases: actor?.identity?.aliases?.length ? 'confirmed' : 'hypothesis',
            lineage: actor?.lineage ? 'confirmed' : 'hypothesis',
            species: actor?.identity?.species ? 'confirmed' : 'hypothesis',
            gender: actor?.identity?.gender ? 'confirmed' : 'hypothesis',
            age: actor?.identity?.age ? 'confirmed' : 'hypothesis',
            briefIntro: actor?.identity?.briefIntro ? 'confirmed' : 'hypothesis',
            appearance: actor?.identity?.appearance ? 'confirmed' : 'hypothesis',
            identityText: actor?.identity?.identityText ? 'confirmed' : 'hypothesis',
            relationState: actor?.identity?.relationState ? 'confirmed' : 'hypothesis',
            attitudeToProtagonist: actor?.identity?.attitudeToProtagonist
                ? 'confirmed'
                : 'hypothesis',
            pastExperience: actor?.identity?.pastExperience ? 'confirmed' : 'hypothesis',
        },
    });

    const hasConfirmedPersonality = [
        ...(actor?.identity?.traits || []),
        actor?.identity?.primaryColor,
        actor?.identity?.socialStyle,
        actor?.identity?.decisionStyle,
        actor?.identity?.speechStyle,
    ].some(hasText);
    const personality = {
        summary: cleanText(actor?.identity?.profileSummary, 700),
        biography: cleanText(actor?.identity?.biography, 2400),
        primaryColor: cleanText(actor?.identity?.primaryColor, 200),
        primaryDerivatives: cleanList(actor?.identity?.primaryDerivatives, 3, 700),
        primarySentence: cleanText(actor?.identity?.primarySentence, 700),
        baseColor: cleanText(actor?.identity?.baseColor, 200),
        baseDerivatives: cleanList(actor?.identity?.baseDerivatives, 3, 700),
        baseSentence: cleanText(actor?.identity?.baseSentence, 700),
        accentColor: cleanText(actor?.identity?.accentColor, 200),
        accentDerivatives: cleanList(actor?.identity?.accentDerivatives, 3, 700),
        accentSentence: cleanText(actor?.identity?.accentSentence, 700),
        othersVoices: cleanList(actor?.identity?.othersVoices, 7, 700),
        authorVoice: cleanText(actor?.identity?.authorVoice, 1400),
        traits: cleanList(actor?.identity?.traits, 12, 180),
        desires: cleanList(actor?.identity?.desires, 12, 240),
        boundaries: cleanList(actor?.identity?.boundaries, 12, 240),
        socialStyle: cleanText(actor?.identity?.socialStyle, 240),
        decisionStyle: cleanText(actor?.identity?.decisionStyle, 240),
        speechStyle: cleanText(actor?.identity?.speechStyle, 240),
        copingStyle: cleanText(actor?.identity?.copingStyle, 240),
        informationStyle: cleanText(actor?.identity?.informationStyle, 240),
        typicalMisread: cleanText(actor?.identity?.typicalMisread, 240),
        relationshipDistancePattern: cleanText(actor?.identity?.relationshipDistancePattern, 240),
        selfImageGap: cleanText(actor?.identity?.selfImageGap, 240),
        learnedCounterDisposition: cleanText(actor?.identity?.learnedCounterDisposition, 240),
        pressureResponse: cleanText(actor?.identity?.pressureResponse, 240),
        recoveryPath: cleanText(actor?.identity?.recoveryPath, 240),
        everydayHabits: cleanList(actor?.identity?.everydayHabits, 8, 180),
        blindSpots: cleanList(actor?.identity?.blindSpots, 8, 220),
    };
    const requiredPersonalityFields = [
        'biography',
        'primaryColor',
        'primaryDerivatives',
        'primarySentence',
        'baseColor',
        'baseDerivatives',
        'baseSentence',
        'accentColor',
        'accentDerivatives',
        'accentSentence',
        'othersVoices',
        'authorVoice',
    ];
    const unknownPersonalityFields = requiredPersonalityFields.filter((key) => !hasText(personality[key]));
    assignModule(profile, 'personality', personality, {
        source: hasConfirmedPersonality ? 'confirmed' : 'hypothesis',
        unknownFields: unknownPersonalityFields,
        evidence,
        turn,
        now,
        fieldSourceOverrides: Object.fromEntries(Object.keys(personality).map((key) => [
            key,
            hasText(personality[key]) ? 'confirmed' : 'hypothesis',
        ])),
    });

    assignModule(profile, 'relationships', {
        entries: clone(actor?.relationships || []),
        noConfirmedRelationshipMeans: 'unknown_not_empty',
        coverageState: actor?.relationships?.length
            ? 'confirmed_entries'
            : 'no_confirmed_relationships',
    }, {
        source: actor?.relationships?.length ? 'confirmed' : 'hypothesis',
        unknownFields: actor?.relationships?.length ? [] : ['relationship_entries'],
        evidence,
        turn,
        now,
    });
    const confirmedLongTerm = cleanList(actor?.longTermGoals, 12, 400);
    const confirmedCurrent = cleanList(actor?.currentGoals, 8, 400);
    const actorPlan = actor?.plan && typeof actor.plan === 'object' && !Array.isArray(actor.plan)
        ? actor.plan
        : {};
    const plan = {
        summary: cleanText(actorPlan.summary, 500),
        steps: cleanList(actorPlan.steps, 12, 300),
        status: cleanText(actorPlan.status, 40) || 'active',
        priority: cleanText(actorPlan.priority, 40),
    };
    const goalFieldSources = {};
    const longTerm = confirmedLongTerm;
    const current = confirmedCurrent;
    for (const [path, present] of [
        ['longTerm', confirmedLongTerm.length > 0],
        ['current', confirmedCurrent.length > 0],
        ['plan.summary', Boolean(cleanText(actor?.plan?.summary))],
        ['plan.steps', cleanList(actor?.plan?.steps, 12, 300).length > 0],
    ]) goalFieldSources[path] = present ? 'confirmed' : 'hypothesis';
    const hasConfirmedGoal = Object.values(goalFieldSources).some((source) => source === 'confirmed');
    const unknownGoalFields = Object.entries(goalFieldSources)
        .filter(([, source]) => source !== 'confirmed')
        .map(([path]) => path);
    assignModule(profile, 'goals', {
        longTerm,
        current,
        priority: plan.priority,
        plan,
        nextWindow: cleanText(actorPlan.nextWindow, 180),
        deadlineTurn: integer(actor?.deadlineTurn),
        commitments: clone(actor?.commitments || []),
        obstacles: cleanList(actorPlan.obstacles, 12, 300),
        costs: cleanList(actorPlan.costs, 12, 300),
        alternatives: cleanList(actorPlan.alternatives, 12, 300),
    }, {
        source: hasConfirmedGoal ? 'confirmed' : 'hypothesis',
        unknownFields: unknownGoalFields,
        evidence,
        turn,
        now,
        fieldSourceOverrides: goalFieldSources,
    });
    assignModule(profile, 'knowledge', {
        entries: clone(actor?.knowledge || []),
        unknownRemainsUnknown: true,
        coverageState: actor?.knowledge?.length
            ? 'confirmed_entries'
            : 'no_confirmed_knowledge',
    }, { source: 'confirmed', evidence, turn, now });
    assignModule(profile, 'resourcesCapabilities', {
        resources: clone(actor?.resources || []),
        capabilities: cleanList(actor?.capabilities, 24, 160),
        noUnconfirmedAbilityGranted: true,
        coverageState: actor?.resources?.length || actor?.capabilities?.length
            ? 'confirmed_entries'
            : 'no_confirmed_resources_or_capabilities',
    }, {
        source: 'confirmed',
        unknownFields: actor?.resources?.length || actor?.capabilities?.length
            ? []
            : ['resources', 'capabilities'],
        evidence,
        turn,
        now,
    });
    assignModule(profile, 'dynamicState', {
        location: clone(actor?.location || {}),
        stateFacts: clone(actor?.stateFacts || []),
        stimuli: clone(actor?.stimuli || []),
        constraints: cleanList(actor?.constraints, 12, 500),
        status: cleanText(actor?.status, 40),
    }, { source: 'confirmed', evidence, turn, now });
    assignModule(profile, 'actionHistory', {
        entries: clone(actor?.actionHistory || []),
        lastAction: clone(actor?.lastAction || null),
        historicalActionsInvented: false,
        coverageState: actor?.actionHistory?.length
            ? 'confirmed_entries'
            : 'no_actions_recorded',
    }, { source: 'confirmed', evidence, turn, now });

    const physiologyEnabled = completionMode === 'full_adult';
    const preserveCompletedPhysiology = physiologyEnabled && completedPhysiologyModule(previousProfile);
    if (preserveCompletedPhysiology) {
        assignModule(profile, 'physiology', previousProfile.modules.physiology.data, {
            source: previousProfile.modules.physiology.source,
            unknownFields: previousProfile.modules.physiology.unknownFields,
            evidence: previousProfile.modules.physiology.evidence,
            turn,
            now,
            action: 'model_completion',
        });
    } else {
        assignModule(profile, 'physiology', physiologySeed(actor, {
            adult: physiologyEnabled,
        }), {
            source: physiologyEnabled ? 'designed_seed' : 'confirmed',
            unknownFields: physiologyEnabled
                ? [...PHYSIOLOGY_CONTENT_FIELDS]
                : [],
            evidence,
            turn,
            now,
        });
    }
    if (!moduleLocked(profile, 'physiology')) {
        profile.modules.physiology.data.enabled = physiologyEnabled;
        profile.modules.physiology.data.adultEnabled = physiologyEnabled;
    }
    for (const [path, overrideValue] of Object.entries(previousProfile.manualOverrides || {})) {
        const parts = pathParts(path);
        if (parts[0] !== 'modules' || !MODULE_SET.has(parts[1])) continue;
        setPath(profile, parts, overrideValue);
        profile.fieldSources[path] = 'confirmed';
    }
    for (const [path, locked] of Object.entries(previousProfile.locks || {})) {
        const parts = pathParts(path);
        if (!locked || parts[0] !== 'modules' || !MODULE_SET.has(parts[1]) || parts.length < 3) {
            continue;
        }
        const preservedValue = getPath(previousProfile, parts);
        if (preservedValue !== undefined) setPath(profile, parts, preservedValue);
    }
    profile.coverage = calculateCoverage(profile);
    profile.preparedForAction = profile.coverage === 100;
    profile.backgroundPending = !profile.preparedForAction
        || calculateOptionalCoverage(profile) < 100;
    const previousComparable = { ...clone(previousProfile), updatedTurn: 0 };
    const currentComparable = { ...clone(profile), updatedTurn: 0 };
    profile.updatedTurn = JSON.stringify(previousComparable) === JSON.stringify(currentComparable)
        ? previousProfile.updatedTurn
        : integer(turn);
    return profile;
}

function removeProjectedDesignedSeeds(actor) {
    const next = clone(actor);
    const profile = normalizeActorProfileV6(next?.profileV6, {
        actorId: next?.id,
        name: next?.name,
    });
    const goals = profile.modules.goals;
    const projected = goals?.data || {};
    const designed = (path) => (
        goals?.source === 'designed_seed'
        || profile.fieldSources[`modules.goals.data.${path}`] === 'designed_seed'
    );
    if (
        designed('longTerm')
        && JSON.stringify(next.longTermGoals || []) === JSON.stringify(projected.longTerm || [])
    ) next.longTermGoals = [];
    if (
        designed('current')
        && JSON.stringify(next.currentGoals || []) === JSON.stringify(projected.current || [])
    ) next.currentGoals = [];
    next.plan = next.plan && typeof next.plan === 'object' ? next.plan : {};
    for (const [actorKey, profilePath] of [
        ['summary', 'plan.summary'],
        ['steps', 'plan.steps'],
        ['nextWindow', 'nextWindow'],
        ['obstacles', 'obstacles'],
        ['costs', 'costs'],
        ['alternatives', 'alternatives'],
        ['priority', 'priority'],
    ]) {
        if (!designed(profilePath)) continue;
        const projectedValue = profilePath.startsWith('plan.')
            ? projected.plan?.[profilePath.slice(5)]
            : projected[profilePath];
        if (JSON.stringify(next.plan[actorKey] ?? null) !== JSON.stringify(projectedValue ?? null)) {
            continue;
        }
        next.plan[actorKey] = Array.isArray(next.plan[actorKey]) ? [] : '';
    }
    return next;
}

export function prepareActorLedgerProfilesV6(value, {
    mode = 'full',
    turn = null,
    now = Date.now(),
} = {}) {
    const ledger = value && typeof value === 'object' ? clone(value) : { actors: [] };
    const currentTurn = turn === null || turn === undefined
        ? integer(ledger.turn)
        : integer(turn);
    const prepared = [];
    const deferred = [];
    ledger.actors = (Array.isArray(ledger.actors) ? ledger.actors : []).map((actor) => {
        const next = removeProjectedDesignedSeeds(actor);
        next.profileV6 = prepareActorProfileV6(next, { mode, turn: currentTurn, now });
        const goalData = next.profileV6.modules.goals.data || {};
        if (!cleanList(next.longTermGoals, 12, 400).length) {
            next.longTermGoals = cleanList(goalData.longTerm, 12, 400);
        }
        if (!cleanList(next.currentGoals, 8, 400).length) {
            next.currentGoals = cleanList(goalData.current, 8, 400);
        }
        const seededPlan = goalData.plan && typeof goalData.plan === 'object'
            ? goalData.plan
            : {};
        next.plan = next.plan && typeof next.plan === 'object' ? next.plan : {};
        if (!cleanText(next.plan.summary)) next.plan.summary = cleanText(seededPlan.summary, 500);
        if (!cleanList(next.plan.steps, 12, 300).length) {
            next.plan.steps = cleanList(seededPlan.steps, 12, 300);
        }
        if (!cleanText(next.plan.nextWindow)) {
            next.plan.nextWindow = cleanText(seededPlan.nextWindow, 180);
        }
        for (const key of ['obstacles', 'costs', 'alternatives']) {
            if (!cleanList(next.plan[key], 12, 300).length) {
                next.plan[key] = cleanList(seededPlan[key], 12, 300);
            }
        }
        if (!cleanText(next.plan.priority)) next.plan.priority = cleanText(seededPlan.priority, 40);
        if (!cleanText(next.plan.status)) next.plan.status = 'active';
        if (next.profileV6.preparedForAction) prepared.push(next.id);
        else deferred.push(next.id);
        return next;
    });
    ledger.migrations = { ...(ledger.migrations || {}), actorProfileV6: true };
    return { ledger, prepared, deferred, coverage: ledger.actors.length
        ? Math.round(ledger.actors.reduce((sum, actor) => sum + actor.profileV6.coverage, 0)
            / ledger.actors.length)
        : 100 };
}

export function actorProfileReadyForAction(actor) {
    const profile = normalizeActorProfileV6(actor?.profileV6, {
        actorId: actor?.id,
        name: actor?.name,
    });
    const coverage = calculateCoverage(profile);
    return profile.preparedForAction === true && coverage === 100;
}

export function selectActorProfileCompletionCandidates(value, {
    maxActors = 8,
    turn: _turn = null,
} = {}) {
    const actors = Array.isArray(value?.actors) ? value.actors : [];
    const incomplete = actors
        .filter((actor) => {
            if (!actorProfileReadyForAction(actor)) return true;
            const profile = normalizeActorProfileV6(actor?.profileV6, {
                actorId: actor?.id,
                name: actor?.name,
            });
            return profile.completionMode === 'full_adult'
                && calculateOptionalCoverage(profile) < 100;
        })
        .sort((left, right) => {
            const leftProfile = normalizeActorProfileV6(left?.profileV6, {
                actorId: left?.id,
                name: left?.name,
            });
            const rightProfile = normalizeActorProfileV6(right?.profileV6, {
                actorId: right?.id,
                name: right?.name,
            });
            const leftCoverage = calculateCoverage(leftProfile);
            const rightCoverage = calculateCoverage(rightProfile);
            if (rightCoverage !== leftCoverage) return rightCoverage - leftCoverage;
            const leftHistory = Array.isArray(left?.actionHistory) ? left.actionHistory.length : 0;
            const rightHistory = Array.isArray(right?.actionHistory) ? right.actionHistory.length : 0;
            if (rightHistory !== leftHistory) return rightHistory - leftHistory;
            const leftEvidence = cleanList(left?.evidence, 64, 300).length;
            const rightEvidence = cleanList(right?.evidence, 64, 300).length;
            if (rightEvidence !== leftEvidence) return rightEvidence - leftEvidence;
            return cleanText(left?.id, 120).localeCompare(cleanText(right?.id, 120), 'zh-CN');
        });
    return incomplete
        .slice(0, integer(maxActors, 1, 24, 8))
        .map((actor) => ({
            actorId: cleanText(actor?.id, 120),
            name: cleanText(actor?.name, 160),
            identity: clone(actor?.identity || {}),
            profileSummary: cleanText(actor?.identity?.profileSummary, 700),
            completionMode: modeOf(actor?.profileV6?.completionMode),
            longTermGoals: cleanList(actor?.longTermGoals, 12, 400),
            currentGoals: cleanList(actor?.currentGoals, 8, 400),
            plan: clone(actor?.plan || {}),
            capabilities: cleanList(actor?.capabilities, 24, 160),
            relationships: clone(actor?.relationships || []),
            knowledge: clone(actor?.knowledge || []),
            location: clone(actor?.location || {}),
            stateFacts: clone(actor?.stateFacts || []),
            evidence: cleanList(actor?.evidence, 16, 300),
            physiology: clone(actor?.profileV6?.modules?.physiology?.data || {}),
        }))
        .filter((actor) => actor.actorId && actor.name);
}

function actorProfilePromptContext(candidate) {
    const pick = (source, fields) => Object.fromEntries(fields
        .map((field) => [field, clone(source?.[field])])
        .filter(([, value]) => hasText(value)));
    return {
        actorId: candidate.actorId,
        name: candidate.name,
        identity: pick(candidate.identity, [
            'role', 'species', 'gender', 'age', 'briefIntro', 'appearance',
            'identityText', 'relationState', 'attitudeToProtagonist', 'pastExperience',
        ]),
        personality: pick(candidate.identity, [
            'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
            'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
            'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
        ]),
        goals: {
            longTerm: cleanList(candidate.longTermGoals, 12, 400),
            current: cleanList(candidate.currentGoals, 8, 400),
            plan: pick(candidate.plan, ['summary', 'steps', 'nextWindow']),
        },
    };
}

function actorProfileFieldGuide(candidate) {
    const groups = [
        'identity: role, species, gender, age, briefIntro, appearance, identityText, relationState, attitudeToProtagonist, pastExperience',
        'personality: biography, primaryColor, primaryDerivatives, primarySentence, baseColor, baseDerivatives, baseSentence, accentColor, accentDerivatives, accentSentence, othersVoices, authorVoice',
        'goals: longTerm, current, plan(summary, steps, nextWindow)',
    ];
    if (modeOf(candidate?.completionMode) === 'full_adult') {
        groups.push('physiology: facialAppearance, oralCavity, hairstyle, neckShoulderArmpit, heightWeight, bodySpecial, skinTexture, bodyScent, bodyMeasurements, breastAppearance, waistAbdomen, vulvaAppearance, vaginalProfile, anusAppearance, buttockAppearance, legAppearance, footSize, footAppearance, lactationBodyFluid, sensitiveParts');
    }
    return groups.join('\n');
}

export function buildActorProfileCompletionMessages(candidates, {
    evidenceText = '',
    customPrompt = '',
} = {}) {
    const selected = Array.isArray(candidates) ? candidates : [];
    const includesPhysiology = selected.some((candidate) => (
        modeOf(candidate?.completionMode) === 'full_adult'
    ));
    const system = [
        '你是数据库填表器。根据材料把同一个角色的碎片整理成自然、连贯、可直接阅读的人物档案。只填表，不续写剧情。',
        '【追踪角色表】填写性别、年龄、外貌、身份、简介、关系、对主角态度和过去经历。外貌只写长期物理特征，不把服装、姿势、伤势或本轮情绪当成固有外貌。原文已有事实不改，留白处可以合理补足。',
        '【追踪人设基线】用性格调色盘写主色、底色、点缀及其具体行为。主色1-3个词，底色和点缀各1-2个词；三组衍生每条30-100字。他者声部写4-7句有视角差的具体议论。履历用角色第一人称自然自述，作者声部只写仍无法下结论的疑问。不要把临时恐惧、受伤、衣着或一次动作写成人格。',
        '【行动方向】用普通话整理长期目标、当前目标和下一步计划；写具体要做什么，不写程序状态词。',
        ...(includesPhysiology ? [
            '【追踪身体基线】按相貌、口腔、发型、肩颈腋窝、身高体重、身材与特异性征、肌肤、气味、三围、胸部、腰腹、外阴、阴道、菊穴、臀部、腿部、足码脚型、足部、泌乳与特殊体液、敏感部位填写长期稳定的客观身体特征。只写物理白描，不写性格、态度、衣物、性经历或本轮临时状态；留白处可以补足，但不能与已有事实冲突。',
        ] : []),
        '尽量填全；某个字段一时写不出可以省略，不要输出空字符串或程序占位词。',
        customPrompt,
        '按上述字段名直接填写。可以用JSON、键值表或清晰的小标题；内容完整、自然、可读比格式整齐更重要。',
    ].filter(Boolean).join('\n\n');
    const user = selected.map((candidate) => [
        `人物：${JSON.stringify(actorProfilePromptContext(candidate))}`,
        `参考材料：\n${[
            ...cleanList(candidate.evidence, 16, 300),
            cleanText(evidenceText, 42000),
        ].filter(Boolean).join('\n')}`,
        `可用字段（按 identity / personality / goals${modeOf(candidate?.completionMode) === 'full_adult' ? ' / physiology' : ''} 分区）：\n${actorProfileFieldGuide(candidate)}`,
    ].join('\n\n')).join('\n\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function buildActorProfileRepairMessages(output, candidate) {
    return [{
        role: 'system',
        content: '你只修复人物档案的JSON格式，不重写、不扩写、不审核人物内容。保留原输出中能辨认的所有字段和值，整理为一个合法JSON对象；允许 identity、personality、goals、physiology 四个分区。不要解释。',
    }, {
        role: 'user',
        content: [
            `当前人物：${JSON.stringify({ actorId: candidate?.actorId, name: candidate?.name })}`,
            `可用字段：\n${actorProfileFieldGuide(candidate)}`,
            `待修复原输出：\n${String(output || '')}`,
        ].join('\n\n'),
    }];
}

function firstJsonObject(text) {
    const source = String(text || '').trim();
    try {
        return JSON.parse(source);
    } catch {
        // Continue with the first balanced value so prose and code fences do
        // not turn usable table content into a failed generation.
    }
    let start = -1;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') {
            quoted = true;
            continue;
        }
        if (char === '{' || char === '[') {
            if (start < 0) start = index;
            stack.push(char);
        } else if ((char === '}' || char === ']') && start >= 0) {
            const expected = char === '}' ? '{' : '[';
            if (stack.at(-1) !== expected) {
                start = -1;
                stack.length = 0;
                continue;
            }
            stack.pop();
            if (!stack.length) {
                try {
                    return JSON.parse(source.slice(start, index + 1));
                } catch {
                    start = -1;
                }
            }
        }
    }
    return null;
}

function profileObjectsFromParsed(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    for (const key of [
        'actorProfiles',
        'actor_profiles',
        'profiles',
        '人物档案',
        '角色档案',
    ]) {
        if (Array.isArray(value[key])) return value[key];
    }
    for (const key of ['profile', '人物', '角色', 'data']) {
        if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
            return [value[key]];
        }
    }
    return [value];
}

function candidateForProfile(raw, candidates, index) {
    const actorId = cleanText(raw?.actorId || raw?.actor_id, 120);
    const name = cleanText(raw?.name || raw?.姓名, 160);
    return candidates.find((candidate) => (
        (actorId && cleanText(candidate.actorId, 120) === actorId)
        || (name && cleanText(candidate.name, 160) === name)
    )) || (candidates.length === 1 ? candidates[0] : candidates[index]);
}

function normalizedProfilePatch(raw, candidate, evidenceText) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !candidate) return null;
    const identity = raw.identity && typeof raw.identity === 'object'
        ? raw.identity
        : raw.身份 && typeof raw.身份 === 'object'
            ? raw.身份
            : {};
    const personality = raw.personality && typeof raw.personality === 'object'
        ? raw.personality
        : raw.persona && typeof raw.persona === 'object'
            ? raw.persona
            : raw.人设基线 && typeof raw.人设基线 === 'object'
                ? raw.人设基线
                : raw.性格 && typeof raw.性格 === 'object'
                    ? raw.性格
                    : {};
    const goals = raw.goals && typeof raw.goals === 'object'
        ? raw.goals
        : raw.行动方向 && typeof raw.行动方向 === 'object'
            ? raw.行动方向
            : {};
    const physiology = raw.physiology && typeof raw.physiology === 'object'
        ? raw.physiology
        : raw.bodyBaseline && typeof raw.bodyBaseline === 'object'
            ? raw.bodyBaseline
            : raw.身体基线 && typeof raw.身体基线 === 'object'
                ? raw.身体基线
                : null;
    const evidence = cleanList(candidate.evidence, 8, 300);
    if (!evidence.length) {
        evidence.push(...buildActorProfileEvidenceBank(evidenceText, {
            candidates: [candidate],
            limit: 8,
        }).map((entry) => entry.text));
    }
    const patch = {
        ...raw,
        actorId: candidate.actorId,
        name: candidate.name,
        identity: { ...identity, ...personality },
        longTermGoals: raw.longTermGoals ?? goals.longTermGoals ?? goals.longTerm ?? [],
        currentGoals: raw.currentGoals ?? goals.currentGoals ?? goals.current ?? [],
        plan: raw.plan ?? goals.plan ?? {},
        physiology,
        evidence,
    };
    const hasContent = Object.keys(patch.identity).length
        || cleanList(patch.longTermGoals).length
        || cleanList(patch.currentGoals).length
        || Object.keys(patch.plan || {}).length
        || (patch.physiology && Object.keys(patch.physiology).length);
    return hasContent ? patch : null;
}

export function parseActorProfileCompletionOutput(output, {
    candidates = [],
    evidenceText = '',
} = {}) {
    const parsed = firstJsonObject(output);
    if (!parsed) {
        return { profiles: null, error: 'actor_profile.json_invalid' };
    }
    const selected = Array.isArray(candidates) ? candidates : [];
    const profiles = profileObjectsFromParsed(parsed);
    const normalized = [];
    const seen = new Set();
    for (const [index, raw] of profiles.entries()) {
        const candidate = candidateForProfile(raw, selected, index);
        const patch = normalizedProfilePatch(raw, candidate, evidenceText);
        if (!patch || seen.has(patch.actorId)) continue;
        seen.add(patch.actorId);
        normalized.push(patch);
    }
    if (!normalized.length) {
        return { profiles: null, error: 'actor_profile.content_missing' };
    }
    return { profiles: normalized, error: '' };
}

export function applyActorProfileCompletionToV6(value, patch, {
    turn = 0,
    now = Date.now(),
} = {}) {
    const profile = normalizeActorProfileV6(value, {
        actorId: patch?.actorId,
        name: patch?.name,
    });
    if (
        profile.completionMode !== 'full_adult'
        || !patch?.physiology
        || typeof patch.physiology !== 'object'
        || Array.isArray(patch.physiology)
        || moduleLocked(profile, 'physiology')
    ) {
        return profile;
    }
    const source = patch?.sources?.physiology === 'confirmed' ? 'confirmed' : 'hypothesis';
    const data = normalizePhysiology({
        ...clone(patch.physiology),
        enabled: true,
        adultEnabled: true,
    });
    assignModule(profile, 'physiology', data, {
        source,
        unknownFields: [],
        evidence: cleanList(patch.evidence, 16, 300),
        turn,
        now,
        action: 'model_completion',
    });
    profile.coverage = calculateCoverage(profile);
    profile.preparedForAction = profile.coverage === 100;
    profile.backgroundPending = !profile.preparedForAction
        || calculateOptionalCoverage(profile) < 100;
    profile.updatedTurn = integer(turn);
    return profile;
}

function pathParts(path) {
    return String(path || '').split('.').map((part) => cleanText(part, 80)).filter(Boolean);
}

function setPath(object, parts, value) {
    let cursor = object;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index];
        if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }
    cursor[parts.at(-1)] = clone(value);
}

function getPath(object, parts) {
    let cursor = object;
    for (const key of parts) {
        if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return undefined;
        cursor = cursor[key];
    }
    return clone(cursor);
}

function moduleLocked(profile, module) {
    return profile?.locks?.actor === true
        || profile?.locks?.[module] === true
        || profile?.locks?.[`modules.${module}`] === true;
}

export function setActorProfileV6Lock(value, {
    path,
    locked = true,
} = {}) {
    const profile = normalizeActorProfileV6(value);
    const key = pathParts(path).join('.');
    if (!key) return profile;
    profile.locks[key] = locked === true;
    return profile;
}

export function applyActorProfileV6Override(value, {
    path,
    value: overrideValue,
    turn = 0,
    now = Date.now(),
} = {}) {
    const profile = normalizeActorProfileV6(value);
    const parts = pathParts(path);
    const module = parts[0] === 'modules' && MODULE_SET.has(parts[1]) ? parts[1] : '';
    if (
        !parts.length
        || profile.locks.actor
        || (module && moduleLocked(profile, module))
        || profile.locks[parts.join('.')]
    ) {
        return { profile, applied: false, reason: parts.length ? 'field_locked' : 'path_invalid' };
    }
    if (!module) return { profile, applied: false, reason: 'module_invalid' };
    const before = clone(profile.modules[module]);
    setPath(profile, parts, overrideValue);
    profile.manualOverrides[parts.join('.')] = clone(overrideValue);
    profile.fieldSources[parts.join('.')] = 'confirmed';
    profile.moduleVersions[module] += 1;
    profile.modules[module].version += 1;
    profile.modules[module].updatedTurn = integer(turn);
    profile.modules[module].status = 'ready';
    recordHistory(profile, module, 'manual_override', before, profile.modules[module], turn, now);
    profile.coverage = calculateCoverage(profile);
    profile.preparedForAction = profile.coverage === 100;
    profile.updatedTurn = integer(turn);
    return { profile, applied: true };
}

export function regenerateActorProfileV6Module(value, actor, {
    module,
    mode = null,
    turn = 0,
    now = Date.now(),
} = {}) {
    const profile = normalizeActorProfileV6(value, {
        actorId: actor?.id,
        name: actor?.name,
        mode: mode || value?.completionMode,
    });
    if (!MODULE_SET.has(module)) return { profile, regenerated: false, reason: 'module_invalid' };
    if (moduleLocked(profile, module)) {
        return { profile, regenerated: false, reason: 'module_locked' };
    }
    const regenerated = prepareActorProfileV6({ ...clone(actor), profileV6: profile }, {
        mode: mode || profile.completionMode,
        turn,
        now,
    });
    const before = clone(profile.modules[module]);
    profile.modules[module] = clone(regenerated.modules[module]);
    profile.moduleVersions[module] += 1;
    recordHistory(profile, module, 'regenerate', before, profile.modules[module], turn, now);
    profile.coverage = calculateCoverage(profile);
    profile.preparedForAction = profile.coverage === 100;
    profile.updatedTurn = integer(turn);
    return { profile, regenerated: true };
}

export function actorProfileV6View(actor) {
    const profile = normalizeActorProfileV6(actor?.profileV6, {
        actorId: actor?.id,
        name: actor?.name,
    });
    const coverage = calculateCoverage(profile);
    const optionalCoverage = calculateOptionalCoverage(profile);
    const preparedForAction = profile.preparedForAction === true && coverage === 100;
    const requiredUnknownFieldCount = Object.entries(profile.modules)
        .filter(([module]) => module !== 'physiology')
        .reduce((total, [, module]) => total + module.unknownFields.length, 0);
    return {
        version: profile.version,
        actorId: profile.actorId,
        name: profile.name,
        completionMode: profile.completionMode,
        preparedForAction,
        backgroundPending: !preparedForAction || optionalCoverage < 100,
        coverage,
        optionalCoverage,
        requiredUnknownFieldCount,
        optionalPendingModules: optionalCoverage < 100 ? ['physiology'] : [],
        moduleStatuses: Object.fromEntries(Object.entries(profile.modules).map(([key, module]) => [
            key,
            {
                status: module.status,
                source: module.source,
                version: module.version,
                unknownFieldCount: module.unknownFields.length,
                locked: profile.locks[key] === true || profile.locks[`modules.${key}`] === true,
            },
        ])),
        historyCount: profile.history.length,
        fieldSourceCount: Object.keys(profile.fieldSources).length,
        hasActionPlan: moduleReady(profile, 'goals'),
        physiologyEnabled: profile.modules.physiology.data.enabled === true,
        adultPhysiologyEnabled: profile.modules.physiology.data.adultEnabled === true,
        physiologyInfersPersonality: false,
    };
}
