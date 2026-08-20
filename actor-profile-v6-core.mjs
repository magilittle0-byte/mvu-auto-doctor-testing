import { fingerprint } from './core.mjs';

// The public API keeps its V6 name for compatibility, while version 7 adds
// the persisted baseline transaction receipt required by the stage-2
// sovereignty contract. normalizeActorProfileV6 continues to accept V6 data.
export const ACTOR_PROFILE_V6_VERSION = 7;
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
// Narrative v1 is deliberately a compact, human-readable baseline.  It is
// stored beside V6 modules so old, read-only dossiers remain byte-compatible.
export const ACTOR_PROFILE_NARRATIVE_SECTION_KEYS = Object.freeze([
    'person',
    'physiology',
    'personality',
    'history',
    'currentState',
    'relationshipsMotives',
    'knowledgeCapabilitiesResources',
]);
// Versioned locally so a stronger adult-physiology contract can refresh old
// prose once without guessing at medical keywords in the model's Chinese.
export const ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION = 2;
export const ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS = Object.freeze([
    'generalBaseline',
    'reproductiveAnatomy',
    'secondaryTraits',
    'reproductiveFunction',
    'sexualResponse',
    'limitations',
]);
export const ACTOR_PROFILE_COMPLETION_GROUPS = Object.freeze([
    { key: 'identity_bootstrap', modules: [] },
    {
        key: 'character_core',
        modules: [
            'person',
            'personality',
            'history',
            'relationshipsMotives',
            'currentState',
            'knowledgeCapabilitiesResources',
            'physiology',
        ],
    },
]);
export const ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES = Object.freeze([
    'person',
    'personality',
    'history',
    'relationshipsMotives',
    'currentState',
    'knowledgeCapabilitiesResources',
    'physiology',
]);
const ACTOR_PROFILE_NARRATIVE_TITLES = Object.freeze({
    person: '人物信息',
    physiology: '生理特征',
    personality: '性格特征',
    history: '过往经历',
    currentState: '当前状态',
    relationshipsMotives: '关系与动机',
    knowledgeCapabilitiesResources: '知识、能力与资源',
});
export const CHARACTER_CREATION_TICKET_VERSION = 3;
export const CHARACTER_CREATION_TICKET_AXIS_NAMES = Object.freeze([
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

const BASELINE_MODULES = Object.freeze([
    'identity',
    'personality',
    'relationships',
    'goals',
    'knowledge',
    'resourcesCapabilities',
    'physiology',
]);
const PROFILE_INSERT_SOURCE_LAYERS = Object.freeze([
    'ai',
    'characterCreationTicket',
    'confirmedProfile',
    'authorityProposal',
    'acceptedNarrative',
    'authority',
]);

const SOURCE_SET = new Set(ACTOR_PROFILE_SOURCES);
const NARRATIVE_SECTION_SOURCE_SET = new Set([
    'confirmed',
    'designed_seed',
    'hypothesis',
]);
const MODULE_SET = new Set(ACTOR_PROFILE_MODULES);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 500) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function narrativeText(value, limit = 4000) {
    const text = cleanText(value, limit);
    return text && !PROFILE_PLACEHOLDER_RE.test(text) ? text : '';
}

function narrativeSection(value, key, { modelAuthored = false } = {}) {
    const source = isRecord(value) ? value : {};
    const text = narrativeText(source.text ?? source.content ?? value, 4000);
    return {
        key,
        title: ACTOR_PROFILE_NARRATIVE_TITLES[key] || key,
        text,
        // The model owns prose only. Provenance and evidence remain local
        // authority data, so no transport shape can claim confirmed/ticket facts.
        source: modelAuthored
            ? 'hypothesis'
            : (NARRATIVE_SECTION_SOURCE_SET.has(source.source) ? source.source : 'hypothesis'),
        evidence: modelAuthored ? [] : cleanList(source.evidence, 8, 240),
        ...(key === 'physiology'
            && !modelAuthored
            && integer(source.contractVersion, 0, Number.MAX_SAFE_INTEGER, 0) > 0
            ? {
                contractVersion: integer(
                    source.contractVersion,
                    1,
                    Number.MAX_SAFE_INTEGER,
                    1,
                ),
            }
            : {}),
    };
}

function normalizeNarrativeSections(value, options = {}) {
    const source = isRecord(value) ? value : {};
    return Object.fromEntries(ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.map((key) => [
        key,
        narrativeSection(source[key], key, options),
    ]));
}

const PROFILE_MODULE_ALIASES = Object.freeze({
    person: ['person', '\u4eba\u7269\u4fe1\u606f', '\u8eab\u4efd'],
    personality: ['personality', '\u6027\u683c', '\u6027\u683c\u7279\u5f81'],
    history: ['history', '\u7ecf\u5386', '\u8fc7\u5f80\u7ecf\u5386'],
    currentState: ['currentstate', '\u5f53\u524d\u72b6\u6001', '\u73b0\u72b6'],
    relationshipsMotives: ['relationshipsmotives', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u5173\u7cfb\u52a8\u673a'],
    knowledgeCapabilitiesResources: ['knowledgecapabilitiesresources', '\u77e5\u8bc6\u80fd\u529b\u8d44\u6e90', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90'],
    physiology: ['physiology', '\u751f\u7406', '\u751f\u7406\u7279\u5f81'],
});

function moduleAliasKey(value) {
    return String(value || '').toLocaleLowerCase('zh-CN').replace(/[^a-z\p{Script=Han}]/gu, '');
}

export function actorProfileCompletionModuleKey(value) {
    const wanted = moduleAliasKey(value);
    return Object.entries(PROFILE_MODULE_ALIASES).find(([, aliases]) => (
        aliases.some((alias) => moduleAliasKey(alias) === wanted)
    ))?.[0] || '';
}

function actorProfileDiscoveryCoverageDigest(unitDigests, unitLengths) {
    return `actor-profile-coverage:${fingerprint(JSON.stringify({ unitDigests, unitLengths }))}`;
}

export function actorProfileDiscoveryCoveragePlan(acceptedNarrative) {
    const source = String(acceptedNarrative || '');
    const texts = [];
    let start = 0;
    while (start < source.length) {
        // Keep discovery mechanically exhaustive without asking the model to
        // reason across an essay-sized row.  This is a transport partition,
        // not NER: every accepted character remains in exactly one unit.
        const hardEnd = Math.min(source.length, start + 420);
        let end = hardEnd;
        if (hardEnd < source.length) {
            const bounded = source.slice(start + 120, hardEnd);
            let lastBoundary = -1;
            for (const match of bounded.matchAll(/[。！？!?；;\n]/gu)) lastBoundary = match.index;
            if (lastBoundary >= 0) end = start + 120 + lastBoundary + 1;
        }
        texts.push(source.slice(start, end));
        start = end;
    }
    const units = texts.map((text, index) => ({
        id: `CU-${String(index + 1).padStart(3, '0')}`,
        digest: `coverage-unit:${fingerprint(text)}`,
        text,
    }));
    const unitDigests = units.map((unit) => unit.digest);
    const unitLengths = units.map((unit) => unit.text.length);
    return {
        version: 1,
        unitCount: units.length,
        unitDigests,
        unitLengths,
        coverageDigest: actorProfileDiscoveryCoverageDigest(unitDigests, unitLengths),
        units,
    };
}

export function actorProfileDiscoveryCoverageProofMatches(value) {
    const unitDigests = Array.isArray(value?.unitDigests)
        ? value.unitDigests.map((entry) => cleanText(entry, 240)) : [];
    const unitLengths = Array.isArray(value?.unitLengths)
        ? value.unitLengths.map((entry) => Math.max(0, Math.floor(Number(entry) || 0))) : [];
    return value?.version === 1
        && Number(value?.unitCount) > 0
        && Number(value.unitCount) === unitDigests.length
        && unitLengths.length === unitDigests.length
        && unitDigests.every(Boolean)
        && unitLengths.every((entry) => entry > 0)
        && cleanText(value?.coverageDigest, 240) === actorProfileDiscoveryCoverageDigest(unitDigests, unitLengths);
}

export function actorProfileCompletionGroupPlan(candidates, {
    allowDiscovery = false,
    acceptedNarrative = '',
} = {}) {
    const selected = Array.isArray(candidates) ? candidates : [];
    const currentSectionText = (candidate, moduleKey) => {
        const previous = candidate?.previousProfile || candidate?.profileV6 || null;
        if (previous?.profileFormat === 'narrative-v1') {
            return narrativeText(previous?.narrativeSections?.[moduleKey]?.text, 4000);
        }
        return narrativeText(candidate?.narrativeSections?.[moduleKey]?.text, 4000);
    };
    const missingTargets = (moduleKey) => selected.filter((candidate) => {
        if (moduleKey === 'physiology' && modeOf(candidate?.completionMode) !== 'full_adult') return false;
        const refresh = Array.isArray(candidate?.refreshProfileModules)
            && candidate.refreshProfileModules.includes(moduleKey);
        const previous = candidate?.previousProfile || candidate?.profileV6 || null;
        const adultPhysiologyContractStale = moduleKey === 'physiology'
            && previous?.profileFormat === 'narrative-v1'
            && integer(
                previous?.narrativeSections?.physiology?.contractVersion,
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ) < ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION;
        return refresh || adultPhysiologyContractStale || !currentSectionText(candidate, moduleKey);
    });
    return ACTOR_PROFILE_COMPLETION_GROUPS.map((definition) => {
        const targets = Object.fromEntries(definition.modules.map((moduleKey) => [
            moduleKey,
            missingTargets(moduleKey),
        ]));
        const targetCount = Object.values(targets).reduce((sum, rows) => sum + rows.length, 0);
        const discoveryBootstrap = definition.key === 'identity_bootstrap' && allowDiscovery;
        return {
            ...definition,
            modules: definition.modules.filter((moduleKey) => (
                (targets[moduleKey] || []).length > 0
            )),
            targets,
            targetCount,
            discoveryBootstrap,
            ...(discoveryBootstrap
                ? { discoveryCoverage: actorProfileDiscoveryCoveragePlan(acceptedNarrative) }
                : {}),
        };
    }).filter((group) => group.targetCount > 0 || group.discoveryBootstrap);
}

const PROFILE_MODULE_NOTES = Object.freeze({
    person: '\u7528\u81ea\u7136\u4e2d\u6587\u5b8c\u6574\u8bf4\u660e\u8eab\u4efd\u3001\u7269\u79cd\u3001\u5e74\u9f84\u9636\u6bb5\u3001\u5916\u8c8c\u4e0e\u793e\u4f1a\u5b9a\u4f4d\u3002',
    personality: '\u7528\u9009\u62e9\u3001\u4ef7\u503c\u504f\u597d\u3001\u8bf4\u8bdd\u4e0e\u538b\u529b\u53cd\u5e94\u5199\u51fa\u7a33\u5b9a\u800c\u4e0d\u6a21\u677f\u5316\u7684\u6027\u683c\u3002',
    history: '\u5199\u51fa\u8db3\u4ee5\u652f\u6491\u73b0\u5728\u884c\u4e3a\u7684\u7ecf\u5386\u3001\u8f6c\u6298\u4e0e\u5f62\u6210\u539f\u56e0\u3002',
    currentState: '只写适合长期档案保存的状态基线、持续性限制、长期责任与反复出现的压力来源。即时地点、短暂情绪、当下伤势、进行中的动作和计划进度属于 MVU/连续性实时状态，不得固化进人物基线。',
    relationshipsMotives: '说明稳定的关键关系背景、与他人的通常距离、长期驱动力和可观察边界；本回合即时态度与关系数值属于实时状态，不得固化，也不得替玩家决定态度。',
    knowledgeCapabilitiesResources: '\u5206\u6e05\u5df2\u77e5\u4e0e\u672a\u77e5\uff0c\u5199\u51fa\u53ef\u7528\u80fd\u529b\u3001\u5de5\u5177\u3001\u8d44\u6e90\u53ca\u9650\u5236\u3002',
    physiology: '仅 full_adult 填写。六个片段都用自然、客观的完整中文句子：generalBaseline=稳定一般体征；reproductiveAnatomy=与物种和生理性别相符的外生殖器与内生殖系统；secondaryTraits=第二性征；reproductiveFunction=生殖功能、周期、分泌或特殊体液；sexualResponse=性刺激下的生理反应与敏感部位；limitations=明确生理限制。不能只写体型、伤病、服装或机械改造；即时伤势属于 MVU/连续性，不固化为生理基线。不得把性经历、性行为、偏好、同意或关系当成生理事实；无精确尺寸时做合理定性补全，不伪造医学测量。不适用项必须写明物种或构造原因。最小输出形状：<module key="physiology"><field key="generalBaseline">片段</field><field key="reproductiveAnatomy">片段</field><field key="secondaryTraits">片段</field><field key="reproductiveFunction">片段</field><field key="sexualResponse">片段</field><field key="limitations">片段</field></module>。字段标签只用于本地归位，最终只保存自然中文。',
});

const PHYSIOLOGY_FIELD_TITLES = Object.freeze({
    generalBaseline: '一般体征',
    reproductiveAnatomy: '生殖解剖',
    secondaryTraits: '第二性征',
    reproductiveFunction: '生殖功能',
    sexualResponse: '性刺激下的生理反应',
    limitations: '生理限制',
});

const PHYSIOLOGY_FIELD_ALIASES = Object.freeze({
    generalBaseline: ['generalBaseline', '一般体征', '稳定一般体征'],
    reproductiveAnatomy: ['reproductiveAnatomy', '生殖解剖', '生殖系统', '外生殖器与内生殖系统'],
    secondaryTraits: ['secondaryTraits', '第二性征'],
    reproductiveFunction: ['reproductiveFunction', '生殖功能', '周期分泌与特殊体液'],
    sexualResponse: ['sexualResponse', '性刺激反应', '性刺激下的生理反应', '敏感部位'],
    limitations: ['limitations', '限制', '生理限制'],
});

function compactRelevantFragments(value, needles, {
    radius = 240,
    maxFragments = 3,
    fallbackLimit = 900,
    totalLimit = 2400,
} = {}) {
    const source = String(value || '').trim();
    if (!source) return '';
    const labels = [...new Set((needles || []).map((item) => cleanText(item, 160)).filter(Boolean))];
    const spans = [];
    for (const label of labels) {
        let offset = source.indexOf(label);
        while (offset >= 0 && spans.length < maxFragments) {
            spans.push({
                start: Math.max(0, offset - radius),
                end: Math.min(source.length, offset + label.length + radius),
            });
            offset = source.indexOf(label, offset + label.length);
        }
        if (spans.length >= maxFragments) break;
    }
    if (!spans.length) return source.slice(0, fallbackLimit);
    spans.sort((left, right) => left.start - right.start);
    const merged = [];
    for (const span of spans) {
        const previous = merged.at(-1);
        if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
        else merged.push({ ...span });
    }
    return merged.map((span) => source.slice(span.start, span.end).trim())
        .filter(Boolean).join('\n…\n').slice(0, totalLimit);
}

function compactAuthorityOverview(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    const headings = [...source.matchAll(/^\[[^\]\r\n]{1,120}\][^\r\n]*$/gmu)];
    if (!headings.length) return source.slice(0, 1200);
    return headings.map((heading, index) => {
        const start = heading.index;
        const end = index + 1 < headings.length ? headings[index + 1].index : source.length;
        return source.slice(start, Math.min(end, start + 600)).trim();
    }).filter(Boolean).join('\n\n').slice(0, 1800);
}

function candidatePromptLabels(candidate) {
    return cleanList([
        candidate?.actorRef?.name,
        candidate?.name,
        ...(candidate?.actorRef?.aliases || []),
        ...(candidate?.identity?.aliases || []),
        candidate?.previousProfile?.actorName,
    ], 16, 160);
}

export function buildActorProfileModuleGroupMessages(group, {
    evidenceText = '', customPrompt = '', discoveryContext = null, validationFeedback = [],
} = {}) {
    const discoveryOnly = group?.key === 'identity_bootstrap'
        && (group?.modules || []).length === 0;
    // This index is supplied by the local host from the same player-identity
    // source used by Registry preflight.  The model may consume it, but must
    // never manufacture or extend it.
    const excludedActorNames = cleanList(discoveryContext?.excludedActorNames, 24, 160);
    const authorityProjection = (candidate, moduleKeys) => {
        const context = actorProfilePromptContext(candidate);
        const wanted = new Set(moduleKeys || []);
        const confirmed = {};
        if (wanted.has('person') || wanted.has('history') || wanted.has('physiology')) {
            confirmed.identity = context.confirmedAnchors.identity;
        }
        if (wanted.has('personality')) confirmed.personality = context.confirmedAnchors.personality;
        if (wanted.has('history') || wanted.has('relationshipsMotives') || wanted.has('currentState')) {
            confirmed.goals = context.confirmedAnchors.goals;
        }
        if (wanted.has('relationshipsMotives')) confirmed.relationships = context.confirmedAnchors.relationships;
        if (wanted.has('knowledgeCapabilitiesResources')) {
            confirmed.knowledge = context.confirmedAnchors.knowledge;
            confirmed.resourcesCapabilities = context.confirmedAnchors.resourcesCapabilities;
        }
        const additionalConfirmed = candidate?.confirmed || candidate?.previousProfile?.confirmed;
        if (additionalConfirmed && typeof additionalConfirmed === 'object') {
            confirmed.additional = clone(additionalConfirmed);
        }
        const ticket = wanted.has('person') || wanted.has('personality')
            || wanted.has('history') || wanted.has('relationshipsMotives')
            ? context.characterCreationTicket
            : null;
        return {
            confirmed,
            locks: clone(candidate?.locks || candidate?.previousProfile?.locks || {}),
            ...(ticket ? {
                characterCreationTicket: ticket,
                ticketPolicy: candidate?.__discoveryKey
                    ? 'provisional_working_context'
                    : 'locally_bound',
            } : {}),
        };
    };
    const requestedModules = Object.fromEntries(Object.entries(group?.targets || {}).map(([key, rows]) => [
        key,
        (rows || []).map((candidate) => candidateActorIdForPrompt(candidate)),
    ]));
    const actorById = new Map();
    for (const rows of Object.values(group?.targets || {})) {
        for (const candidate of rows || []) {
            actorById.set(candidateActorIdForPrompt(candidate), candidate);
        }
    }
    const targetRows = {
        requestedModules,
        actors: [...actorById.values()].map((candidate) => {
            const actorId = candidateActorIdForPrompt(candidate);
            const labels = candidatePromptLabels(candidate);
            const moduleKeys = Object.entries(requestedModules)
                .filter(([, actorIds]) => actorIds.includes(actorId))
                .map(([moduleKey]) => moduleKey);
            const sections = candidate?.previousProfile?.narrativeSections
                || candidate?.profileV6?.narrativeSections
                || candidate?.narrativeSections || {};
            return {
                actorId,
                name: cleanText(candidate?.actorRef?.name || candidate?.name, 160),
                current: Object.fromEntries(moduleKeys.map((moduleKey) => [
                    moduleKey,
                    narrativeText(sections?.[moduleKey]?.text ?? sections?.[moduleKey], 1200),
                ])),
                narrativeEvidence: compactRelevantFragments(
                    candidate?.__discoveryKey?.split('\u0000')?.[1]
                        || discoveryContext?.acceptedNarrative,
                    labels,
                    { fallbackLimit: 0, totalLimit: 1800 },
                ),
                authorityMaterial: compactRelevantFragments(
                    evidenceText,
                    labels,
                    { fallbackLimit: 0, totalLimit: 2400 },
                ),
                authority: authorityProjection(candidate, moduleKeys),
            };
        }),
    };
    const requestedModuleKeys = (group?.modules || []).filter((key) => (
        (requestedModules[key] || []).length > 0
    ));
    const guides = requestedModuleKeys.map((key) => `${key}: ${PROFILE_MODULE_NOTES[key]}`).join('\n');
    if (discoveryOnly) return [{ role: 'system', content: [
        'Identity Confirmation：你是“MVU自动医生”的人物档案医师，不是正文作者，也不是数据库填表AI。你认真阅读已经接受的故事，认出真正出场的人物，并把身份线索交还给本地医生。',
        '这一步只做已接受正文的人物身份路由，不填档案、不续写剧情。宁可把不确定身份交给本地复核，也不要擅自取名、合并或创造人物。',
        '输出一份很短的中文人物清单，不要写 JSON、XML、函数、变量、digest、正文复述、档案或解释。每个真正出场的新人物单独一行，写成“新人物：正文中的逐字稳定行键”。行键可为姓名、代号、编号、职业或带限定的描述性称谓；必须逐字复制正文，严禁只写“人物、角色、陌生人、男人、女人、他、她”等泛称。没有姓名时，复制正文里能唯一指向一人的完整称谓，例如“柜台后的灰衣记录员”，不要自行缩成“人物”或“记录员”。不得改写、补名或使用玩家、群体、只被提及者、已登记/受保护身份。脚本会把逐字行键机械绑定到最早独立出现的位置，短名若只嵌在更长行键中会被拒绝。',
        '若正文明确揭示已登记人物的新行键，单独一行写成“身份揭示：精确ActorId｜新行键｜同时含旧行键或别名与新行键的最短正文原句”；不得猜测合并。',
        '只有确实没有任何合格新人物或身份揭示时，整个响应只写“没有新人物”。不得把“没有新人物”与人物清单混用。',
        validationFeedback.length ? `\u4ec5\u4fee\u590d\u8eab\u4efd\u53d1\u73b0\u8def\u7531\uff1a${validationFeedback.join('; ')}` : '',
    ].filter(Boolean).join('\n\n') }, { role: 'user', content: [
        `【已接受正文开始】\n${String(discoveryContext?.acceptedNarrative || '')}\n【已接受正文结束】`,
        `【已登记人物，仅用于排除或身份揭示】\n${(discoveryContext?.registeredActorIndex || []).map((entry) => {
            const aliases = cleanList(entry?.aliases, 12, 160);
            return `${cleanText(entry?.actorId, 120)}｜${cleanText(entry?.displayName || entry?.name, 160)}${aliases.length ? `｜别名：${aliases.join('、')}` : ''}`;
        }).filter((line) => line.split('｜').slice(0, 2).every(Boolean)).join('\n') || '无'}`,
        `【受保护身份，仅用于排除】\n${excludedActorNames.join('、') || '无'}`,
    ].join('\n\n') }];
    return [{ role: 'system', content: [
        'Identity Confirmation：你是“MVU自动医生”的人物档案医师。你像一位理解故事与人的传记编辑，把零散证据整理成自然、完整、可继续使用的人物档案；你不是正文作者，也不负责数据库、MVU或世界裁决。',
        '\u4f60\u53ea\u586b\u5199\u6307\u5b9a\u7684\u4eba\u7269\u6863\u6848\u6a21\u5757\uff0c\u4e0d\u7eed\u5199\u5267\u60c5\u3002',
        requestedModuleKeys.some((key) => key !== 'physiology')
            ? ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT : '',
        '\u8f93\u51fa\u7528\u8f7b\u91cf\u8def\u7531\u8fb9\u754c <profile-target actor="\u7cbe\u786eActorRef" name="Registry displayName/\u884c\u952e"> \u548c <module key="\u7cbe\u786emodule key">\u81ea\u7136\u4e2d\u6587</module>\u3002\u6863\u6848\u7ec4\u53ea\u63a5\u6536\u5df2\u7531\u672c\u5730\u9501\u5b9a\u7684 ActorRef\uff0c\u4e0d\u5f97\u81ea\u884c\u65b0\u589e\u4eba\u7269\u884c\u3002',
        '\u8def\u7531\u6807\u7b7e\u4e0d\u662f\u6863\u6848\u6807\u9898\uff1b\u666e\u901a\u6a21\u5757\u5185\u53ea\u5199\u53ef\u8bfb\u7684\u81ea\u7136\u4e2d\u6587\uff0cphysiology \u4f7f\u7528\u516d\u4e2a field \u7247\u6bb5\u5f52\u4f4d\u3002\u4e0d\u8981 JSON/SQL/\u989d\u5916\u8bc1\u660e\u3002',
        '\u65b0\u53d1\u73b0\u884c\u4e2d\u7684\u540c\u56de\u5408\u7968\u636e\u53ea\u662f\u4ea4\u6613\u5185\u7684 provisional working context\uff1a\u6743\u5a01\u8bbe\u5b9a\u3001\u5df2\u63a5\u53d7\u6b63\u6587\u548c\u5df2\u786e\u8ba4\u6863\u6848\u4f18\u5148\uff0c\u51b2\u7a81\u8f74\u5fc5\u987b\u4e22\u5f03\uff1b\u6700\u7ec8\u53ea\u6709\u672c\u5730 Registry promotion \u540e\u7684 ticket binding \u662f\u771f\u503c\u3002\u6a21\u5757\u6587\u672c\u4e0d\u5f97\u8986\u76d6 confirmed/locks/designRolls\u3002',
        guides,
        validationFeedback.length ? `\u4ec5\u4fee\u590d\u672c\u7ec4\uff1a${validationFeedback.join('; ')}` : '',
    ].filter(Boolean).join('\n\n') }, { role: 'user', content: [
        `\u76ee\u6807 ActorRef\u00d7\u5b57\u6bb5\u3001\u5f53\u524d\u503c\u4e0e\u5c40\u90e8\u6750\u6599\uff1a${JSON.stringify(targetRows)}`,
        customPrompt ? `\u5168\u5c40\u9644\u52a0\u63d0\u793a\uff1a\n${customPrompt}` : '',
    ].filter(Boolean).join('\n\n') }];
}

function candidateActorIdForPrompt(candidate) {
    return cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120);
}

function cleanModuleBody(value) {
    return String(value || '').replace(/```(?:\w+)?/giu, '').replace(/```/gu, '')
        .replace(/^\s*(?:\u4ee5\u4e0b\u662f|\u597d\u7684[\uff0c,:\uff1a]?|\u6a21\u5757\u5185\u5bb9[\uff1a:]?)\s*/u, '')
        .replace(/\s*(?:\u4ee5\u4e0a\u662f\u6240\u9700\u5185\u5bb9[\u3002.]?|\u5b8c\u6210[\u3002.]?)\s*$/u, '').trim().slice(0, 4000);
}

export function actorProfileIdentityEvidenceSurface(value) {
    return String(value || '')
        .replace(/[\u201c\u201d\u300c\u300d\u300e\u300f\uff02]/gu, '"')
        .replace(/[\u2018\u2019\uff07]/gu, "'")
        .trim();
}

function physiologyFieldKey(value) {
    const wanted = moduleAliasKey(value);
    return Object.entries(PHYSIOLOGY_FIELD_ALIASES).find(([, aliases]) => (
        aliases.some((alias) => moduleAliasKey(alias) === wanted)
    ))?.[0] || '';
}

function physiologyFragment(value) {
    const text = cleanModuleBody(value).replace(/^\s*[-*•]\s*/u, '');
    return Array.from(text).length >= 8 && !PROFILE_PLACEHOLDER_RE.test(text) ? text : '';
}

function physiologyProse(fields) {
    return ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key) => {
        const fragment = String(fields.get(key) || '').replace(/[\u3002.!\uff01\uff1f\uff1b;]+$/u, '');
        return `${PHYSIOLOGY_FIELD_TITLES[key]}：${fragment}。`;
    }).join('');
}

function validatePhysiologyCoverage(value) {
    const source = String(value || '');
    const legacySeen = new Map();
    const legacyCoverageRe = /<physiology-coverage\b[^>]*\bkey\s*=\s*(?:["']([^"']+)["']|([^\s>]+))[^>]*>([\s\S]*?)<\/physiology-coverage>/giu;
    let match;
    let invalid = false;
    while ((match = legacyCoverageRe.exec(source))) {
        const key = physiologyFieldKey(match[1] || match[2]);
        const excerpt = physiologyFragment(match[3]);
        if (!key || !excerpt || legacySeen.has(key) || [...legacySeen.values()].includes(excerpt)) {
            invalid = true;
            continue;
        }
        legacySeen.set(key, excerpt);
    }
    const withoutLegacyCoverage = source.replace(legacyCoverageRe, '');
    if (legacySeen.size > 0 || /<physiology-coverage\b/iu.test(source)) {
        const prose = cleanModuleBody(withoutLegacyCoverage);
        const ranges = [];
        for (const excerpt of legacySeen.values()) {
            const start = prose.indexOf(excerpt);
            const end = start + excerpt.length;
            if (start < 0 || ranges.some((range) => start < range.end && end > range.start)) {
                invalid = true;
            }
            ranges.push({ start, end });
        }
        const missingFields = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS
            .filter((key) => !legacySeen.has(key) || !prose.includes(legacySeen.get(key)))
            .map((key) => `physiology.${key}`);
        return { ok: !invalid && missingFields.length === 0, prose, missingFields };
    }

    const normalized = withoutLegacyCoverage
        .replace(/\[\s*(?:physiology[-_ ]?)?field\s*[:=]\s*([^\]]+)\]/giu, '<field key="$1">')
        .replace(/\[\s*\/\s*(?:physiology[-_ ]?)?field\s*\]/giu, '</field>');
    const fields = new Map();
    const fieldRe = /<(?:physiology[-_ ]?)?field\b([^>]*)>([\s\S]*?)(?:<\/(?:physiology[-_ ]?)?field>|(?=<(?:physiology[-_ ]?)?field\b)|$)/giu;
    while ((match = fieldRe.exec(normalized))) {
        const rawKey = match[1].match(/\b(?:key|name)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/iu)?.slice(1).find(Boolean) || '';
        const key = physiologyFieldKey(rawKey);
        const fragment = physiologyFragment(match[2]);
        if (!key || !fragment || fields.has(key) || [...fields.values()].includes(fragment)) {
            invalid = true;
            continue;
        }
        fields.set(key, fragment);
    }

    // Mechanical format repair only: accept one explicitly labelled field per
    // line (English key or listed Chinese alias).  Do not infer fields from
    // free prose or medical keywords.
    if (fields.size === 0 && !invalid) {
        for (const line of normalized.split(/\r?\n/u)) {
            const labelled = line.match(/^\s*(?:[-*•]\s*)?(?:\[|【)?([^\]】:：=]{1,80})(?:\]|】)?\s*[:：=]\s*(.+?)\s*$/u)
                || line.match(/^\s*(?:\[|【)([^\]】]{1,80})(?:\]|】)\s*(.+?)\s*$/u);
            if (!labelled) continue;
            const key = physiologyFieldKey(labelled[1]);
            if (!key) continue;
            const fragment = physiologyFragment(labelled[2]);
            if (!fragment || fields.has(key) || [...fields.values()].includes(fragment)) {
                invalid = true;
                continue;
            }
            fields.set(key, fragment);
        }
    }
    const missingFields = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS
        .filter((key) => !fields.has(key))
        .map((key) => `physiology.${key}`);
    return {
        ok: !invalid && missingFields.length === 0,
        prose: missingFields.length === 0 ? physiologyProse(fields) : '',
        missingFields,
        locallyRecovered: fields.size > 0 && !/<(?:physiology[-_ ]?)?field\b/iu.test(normalized),
    };
}

// Public semantic-bridge adapter.  The implementation stays shared with the
// mature V6 completion path so the preset/Doctor bridge cannot silently invent
// a weaker second definition of an adult physiology profile.
export function validateActorProfilePhysiologyCoverage(value) {
    return validatePhysiologyCoverage(value);
}

export function parseActorProfileModuleGroupOutput(output, group, {
    acceptedNarrative = '',
    registeredActorIndex = [],
} = {}) {
    const text = String(output || '').replace(/[“”]/gu, '"').replace(/[‘’]/gu, "'")
        .replace(/```(?:xml|html|text|markdown)?/giu, '').replace(/```/gu, '').trim();
    const normalizedMarkup = text
        .replace(/\[\s*coverage[-_ ]unit\s+([^\]]+)\]/giu, '<coverage-unit $1>')
        .replace(/\[\s*\/\s*coverage[-_ ]unit\s*\]/giu, '</coverage-unit>')
        .replace(/<\s*coverage[_ ]unit\b/giu, '<coverage-unit')
        .replace(/<\s*\/\s*coverage[_ ]unit\s*>/giu, '</coverage-unit>')
        .replace(/\[\s*profile[-_ ]target\s+([^\]]+)\]/giu, '<profile-target $1>')
        .replace(/\[\s*\/\s*profile[-_ ]target\s*\]/giu, '</profile-target>')
        .replace(/<\s*profile[_ ]target\b/giu, '<profile-target')
        .replace(/<\s*\/\s*profile[_ ]target\s*>/giu, '</profile-target>')
        .replace(/<\s*no[_ ]new\s*\/\s*>/giu, '<no-new/>')
        .replace(/<profile-target\b([^>]*)\/\s*>/giu, '<profile-target$1></profile-target>')
        .replace(/\[\s*module\s*[:=]\s*([^\]]+)\]/giu, '<module key="$1">')
        .replace(/\[\s*\/\s*module\s*\]/giu, '</module>');
    const naturalIdentityRoute = (() => {
        if (group?.key !== 'identity_bootstrap') return null;
        if (/<\/?(?:profile-target|coverage-unit)\b|<no-new\s*\//iu.test(normalizedMarkup)) return null;
        const compact = normalizedMarkup.replace(/\*\*/gu, '').trim();
        if (/^(?:\u6ca1\u6709\u65b0\u4eba\u7269|\u65e0\u65b0\u4eba\u7269|\u672a\u53d1\u73b0\u65b0\u4eba\u7269|\u672a\u53d1\u73b0\u9700\u8981\u767b\u8bb0\u7684\u65b0\u4eba\u7269|\u6ca1\u6709\u53d1\u73b0\u9700\u8981\u767b\u8bb0\u7684\u4eba\u7269)[\u3002.!\uff01]?$/u.test(compact)) {
            return { markup: '<no-new/>', repairs: ['actor_profile.route_natural_empty_normalized'] };
        }
        const quoteAttr = (value) => {
            const clean = cleanText(String(value || '')
                .replace(/^[\u201c\u201d\u300c\u300d\u300e\u300f"']+|[\u201c\u201d\u300c\u300d\u300e\u300f"'\u3002.!\uff01]+$/gu, ''), 240);
            if (!clean || /[<>]/u.test(clean) || (clean.includes('"') && clean.includes("'"))) return null;
            return clean.includes('"') ? `'${clean}'` : `"${clean}"`;
        };
        const rows = [];
        const residue = [];
        let newList = false;
        for (const rawLine of compact.split(/\r?\n/u)) {
            const original = rawLine.trim();
            if (!original) continue;
            const line = original.replace(/^\s*(?:[-*\u2022]|\d+[.)\u3001])\s*/u, '').trim();
            if (/^(?:\u65b0\u4eba\u7269|\u65b0\u89d2\u8272|\u65b0\u589e\u4eba\u7269|\u4eba\u7269\u6e05\u5355|\u65b0\u4eba\u7269\u6e05\u5355)\s*[:\uff1a]\s*$/u.test(line)) {
                newList = true;
                continue;
            }
            const reveal = line.match(/^(?:\u8eab\u4efd\u63ed\u793a|\u8eab\u4efd\u66f4\u65b0|\u5df2\u767b\u8bb0\u4eba\u7269)\s*[:\uff1a]\s*([^|\uff5c]+)\s*[|\uff5c]\s*([^|\uff5c]+)\s*[|\uff5c]\s*(.+)$/u);
            if (reveal) {
                const actor = quoteAttr(reveal[1]);
                const name = quoteAttr(reveal[2]);
                const evidence = cleanModuleBody(reveal[3]);
                if (!actor || !name || !evidence || /[<>]/u.test(evidence)) {
                    residue.push(line);
                    continue;
                }
                rows.push(`<profile-target actor=${actor} name=${name}><identity-evidence>${evidence}</identity-evidence></profile-target>`);
                newList = false;
                continue;
            }
            const discovered = line.match(/^(?:\u65b0\u4eba\u7269|\u65b0\u89d2\u8272|\u65b0\u589e\u4eba\u7269|\u4eba\u7269)\s*[:\uff1a|\uff5c]\s*(.+)$/u);
            const nameText = discovered?.[1] || (newList && /^\s*(?:[-*\u2022]|\d+[.)\u3001])\s*/u.test(original)
                ? line : '');
            if (nameText) {
                const name = quoteAttr(nameText);
                if (!name) residue.push(line);
                else rows.push(`<profile-target actor="new" name=${name}></profile-target>`);
                continue;
            }
            residue.push(line);
        }
        if (!rows.length) return null;
        const identityLikeResidue = residue.some((line) => (
            /(?:\u65b0\u4eba\u7269|\u65b0\u89d2\u8272|\u65b0\u589e\u4eba\u7269|\u4eba\u7269\s*[:\uff1a]|\u8eab\u4efd\u63ed\u793a|\u8eab\u4efd\u66f4\u65b0|\u5df2\u767b\u8bb0\u4eba\u7269|\u6ca1\u6709.*\u4eba\u7269|\u65e0\u65b0\u4eba\u7269|\u672a\u53d1\u73b0.*\u4eba\u7269)/u.test(line)
        ));
        if (identityLikeResidue) return null;
        return {
            markup: rows.join('\n'),
            repairs: [
                'actor_profile.route_natural_list_normalized',
                ...(residue.length ? ['actor_profile.route_extra_prose_ignored'] : []),
            ],
        };
    })();
    const normalized = naturalIdentityRoute?.markup || normalizedMarkup;
    const entries = [];
    const failures = [];
    const routeRepairs = [...(naturalIdentityRoute?.repairs || [])];
    const scheduledCandidates = [...new Map(Object.values(group?.targets || {})
        .flat()
        .map((candidate) => [candidateActorIdForPrompt(candidate), candidate])
        .filter(([actorId]) => actorId)).values()];
    const scheduledRoutes = scheduledCandidates.map((candidate) => ({
        actorId: candidateActorIdForPrompt(candidate),
        name: cleanText(candidate?.actorRef?.name || candidate?.name, 160),
        labels: new Set(candidatePromptLabels(candidate)),
    }));
    const resolveScheduledRoute = (rawActorId, rawName) => {
        const actorId = cleanText(rawActorId, 120);
        const name = cleanText(rawName, 160);
        const exact = scheduledRoutes.find((route) => route.actorId === actorId);
        if (exact) {
            if (!name || name === exact.name) return { actorId: exact.actorId, name: exact.name };
            if (exact.labels.has(name)) {
                return {
                    actorId: exact.actorId,
                    name: exact.name,
                    repair: 'actor_profile.route_name_alias_normalized',
                };
            }
            return { actorId, name };
        }
        if (group?.key === 'identity_bootstrap' || !scheduledRoutes.length) {
            return { actorId, name };
        }
        // A display label/known alias is routing evidence only when it names
        // exactly one scheduled ActorRef. This repairs common model drift
        // without fuzzy matching, inventing an identity, or merging actors.
        const labelled = scheduledRoutes.filter((route) => (
            (actorId && route.labels.has(actorId))
            || (name && route.labels.has(name))
        ));
        if (labelled.length === 1) {
            return {
                actorId: labelled[0].actorId,
                name: labelled[0].name,
                repair: scheduledRoutes.length === 1
                    ? 'actor_profile.route_single_target_label_normalized'
                    : 'actor_profile.route_unique_label_normalized',
            };
        }
        return { actorId, name };
    };
    const expectedCoverage = Array.isArray(group?.discoveryCoverage?.units)
        ? group.discoveryCoverage.units : [];
    let coverageCursor = 0;
    const coverageUnitOffsets = new Map(expectedCoverage.map((unit) => {
        const entry = [unit.id, coverageCursor];
        coverageCursor += String(unit?.text || '').length;
        return entry;
    }));
    const coverageTargetSources = new Map();
    const registeredById = new Map((Array.isArray(registeredActorIndex)
        ? registeredActorIndex : []).map((entry) => [
        cleanText(entry?.actorId, 120),
        {
            actorId: cleanText(entry?.actorId, 120),
            displayName: cleanText(entry?.displayName || entry?.name, 160),
            aliases: cleanList(entry?.aliases, 12, 160),
        },
    ]).filter(([actorId, entry]) => actorId && entry.displayName));
    let coverageProof = null;
    let coverageCompleteEmpty = false;
    if (group?.key === 'identity_bootstrap' && expectedCoverage.length) {
        const expectedById = new Map(expectedCoverage.map((unit) => [unit.id, unit]));
        const coverageMatches = [...normalized.matchAll(
            /<coverage-unit\b([^>]*)>([\s\S]*?)<\/coverage-unit>/giu,
        )];
        const attrValue = (attrs, key) => attrs.match(
            new RegExp(`\\b${key}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'iu'),
        )?.slice(1).find(Boolean) || '';
        const targetMatchesIn = (value) => [...String(value || '').matchAll(
            /<profile-target\b([^>]*)>[\s\S]*?(?:<\/profile-target>|(?=<profile-target\b)|$)/giu,
        )];
        const hasIdentityControlResidue = (value) => (
            /[<\[]\s*\/?\s*(?:profile[-_ ]*target|no[-_ ]*new|coverage[-_ ]*unit)\b/iu
                .test(String(value || ''))
        );
        const bindTarget = (target, expected, unitId, { inferred = false } = {}) => {
            const actorId = attrValue(target[1], 'actor');
            const name = attrValue(target[1], 'name');
            const evidenceSpan = cleanModuleBody(
                target[0].match(/<identity-evidence\b[^>]*>([\s\S]*?)<\/identity-evidence>/iu)?.[1] || '',
            );
            const targetKey = `${cleanText(actorId, 120)}\u0000${cleanText(name, 160)}`;
            if (actorId && name && !coverageTargetSources.has(targetKey)) {
                coverageTargetSources.set(targetKey, {
                    coverageUnitId: unitId,
                    sourceUnitOffset: coverageUnitOffsets.get(unitId) ?? -1,
                    sourceAnchor: expected.text,
                    evidenceSpan,
                });
                if (inferred) routeRepairs.push('actor_profile.route_discovery_unit_inferred');
            }
            if (!name || !expected.text.includes(name)) failures.push({
                actorId: '', name: cleanText(name, 160),
                reason: 'actor_profile.discovery_name_not_in_coverage_unit',
                groupKey: group.key, retryable: true,
            });
        };
        let totalTargets = 0;
        let allNoNew = false;
        if (coverageMatches.length) {
            // Read-only compatibility for the former per-unit echo protocol.
            // A partial wrapper set remains invalid; it is never mixed with
            // the compact flat route protocol.
            const seenCoverageIds = new Set();
            allNoNew = true;
            for (const coverageMatch of coverageMatches) {
                const unitId = cleanText(attrValue(coverageMatch[1], 'id'), 80);
                const digest = cleanText(attrValue(coverageMatch[1], 'digest'), 240);
                const expected = expectedById.get(unitId);
                if (!expected) {
                    failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_unit_unknown', groupKey: group.key, retryable: true });
                    continue;
                }
                if (seenCoverageIds.has(unitId)) {
                    failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_unit_duplicate', groupKey: group.key, retryable: true });
                    continue;
                }
                seenCoverageIds.add(unitId);
                if (digest !== expected.digest) {
                    failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_digest_mismatch', groupKey: group.key, retryable: true });
                    continue;
                }
                const body = coverageMatch[2];
                const targetMatches = targetMatchesIn(body);
                const noNew = /<no-new\s*\/\s*>/iu.test(body);
                const unexplained = body
                    .replace(/<profile-target\b[^>]*>[\s\S]*?(?:<\/profile-target>|(?=<profile-target\b)|$)/giu, '')
                    .replace(/<no-new\s*\/\s*>/giu, '')
                    .trim();
                if (hasIdentityControlResidue(unexplained)) {
                    failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_extra_content', groupKey: group.key, retryable: true });
                    continue;
                }
                if ((noNew && targetMatches.length) || (!noNew && !targetMatches.length)) {
                    failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_disposition_invalid', groupKey: group.key, retryable: true });
                    continue;
                }
                if (noNew) continue;
                allNoNew = false;
                totalTargets += targetMatches.length;
                for (const target of targetMatches) bindTarget(target, expected, unitId);
            }
            for (const unit of expectedCoverage) {
                if (!seenCoverageIds.has(unit.id)) failures.push({
                    actorId: '', reason: 'actor_profile.discovery_coverage_unit_missing', groupKey: group.key, retryable: true,
                });
            }
            const outside = normalized.replace(
                /<coverage-unit\b[^>]*>[\s\S]*?<\/coverage-unit>/giu,
                '',
            ).trim();
            if (hasIdentityControlResidue(outside)) failures.push({
                actorId: '', reason: 'actor_profile.discovery_coverage_extra_content', groupKey: group.key, retryable: true,
            });
            else if (outside) routeRepairs.push('actor_profile.route_extra_prose_ignored');
            if (!failures.length && seenCoverageIds.size === expectedCoverage.length) {
                coverageCompleteEmpty = allNoNew && totalTargets === 0;
            }
        } else {
            const flatTargets = targetMatchesIn(normalized);
            const noNewMatches = [...normalized.matchAll(/<no-new\s*\/\s*>/giu)];
            if (noNewMatches.length) {
                if (
                    noNewMatches.length !== 1
                    || flatTargets.length
                    || normalized.replace(/<no-new\s*\/\s*>/giu, '').trim()
                ) failures.push({
                    actorId: '', reason: 'actor_profile.discovery_coverage_disposition_invalid', groupKey: group.key, retryable: true,
                });
                else coverageCompleteEmpty = true;
            } else if (flatTargets.length) {
                totalTargets = flatTargets.length;
                const flatRouteNames = flatTargets.map((target) => (
                    cleanText(attrValue(target[1], 'name'), 160)
                )).filter(Boolean);
                const earliestIndependentUnit = (name) => {
                    const source = String(acceptedNarrative || '');
                    const longerNames = [...new Set(flatRouteNames.filter((other) => (
                        other.length > name.length && other.includes(name)
                    )))];
                    let offset = source.indexOf(name);
                    while (offset >= 0) {
                        const coveredByLonger = longerNames.some((longerName) => {
                            let longerOffset = source.indexOf(longerName);
                            while (longerOffset >= 0) {
                                if (
                                    longerOffset <= offset
                                    && longerOffset + longerName.length >= offset + name.length
                                ) return true;
                                longerOffset = source.indexOf(longerName, longerOffset + 1);
                            }
                            return false;
                        });
                        if (!coveredByLonger) {
                            const unit = expectedCoverage.find((candidate) => {
                                const unitOffset = coverageUnitOffsets.get(candidate.id) ?? -1;
                                return unitOffset >= 0
                                    && offset >= unitOffset
                                    && offset + name.length <= unitOffset + candidate.text.length;
                            });
                            if (unit) return unit;
                        }
                        offset = source.indexOf(name, offset + 1);
                    }
                    return null;
                };
                for (const target of flatTargets) {
                    const actorId = cleanText(attrValue(target[1], 'actor'), 120);
                    const name = cleanText(attrValue(target[1], 'name'), 160);
                    const evidenceSpan = cleanModuleBody(
                        target[0].match(/<identity-evidence\b[^>]*>([\s\S]*?)<\/identity-evidence>/iu)?.[1] || '',
                    );
                    const explicitUnitId = cleanText(
                        attrValue(target[1], 'unit')
                            || attrValue(target[1], 'coverageUnitId')
                            || attrValue(target[1], 'unitId'),
                        80,
                    );
                    let expected = explicitUnitId ? expectedById.get(explicitUnitId) : null;
                    let unitId = explicitUnitId;
                    if (explicitUnitId && !expected) {
                        failures.push({ actorId: '', reason: 'actor_profile.discovery_coverage_unit_unknown', groupKey: group.key, retryable: true });
                        continue;
                    }
                    if (!explicitUnitId) {
                        expected = actorId && actorId !== 'new' && evidenceSpan
                            ? expectedCoverage.find((unit) => unit.text.includes(evidenceSpan)) || null
                            : name ? earliestIndependentUnit(name) : null;
                        if (!expected) {
                            failures.push({ actorId: '', name, reason: 'actor_profile.discovery_coverage_unit_missing', groupKey: group.key, retryable: true });
                            continue;
                        }
                        unitId = expected.id;
                    }
                    bindTarget(target, expected, unitId, { inferred: !explicitUnitId });
                }
                const outside = normalized.replace(
                    /<profile-target\b[^>]*>[\s\S]*?(?:<\/profile-target>|(?=<profile-target\b)|$)/giu,
                    '',
                ).trim();
                if (hasIdentityControlResidue(outside)) failures.push({
                    actorId: '', reason: 'actor_profile.discovery_coverage_extra_content', groupKey: group.key, retryable: true,
                });
                else if (outside) routeRepairs.push('actor_profile.route_extra_prose_ignored');
            } else failures.push({
                actorId: '', reason: 'actor_profile.discovery_coverage_extra_content', groupKey: group.key, retryable: true,
            });
        }
        if (!failures.length && (coverageCompleteEmpty || totalTargets > 0)) {
            const proofCandidate = {
                version: 1,
                unitCount: group.discoveryCoverage.unitCount,
                unitDigests: [...group.discoveryCoverage.unitDigests],
                unitLengths: [...group.discoveryCoverage.unitLengths],
                coverageDigest: group.discoveryCoverage.coverageDigest,
            };
            if (actorProfileDiscoveryCoverageProofMatches(proofCandidate)) coverageProof = proofCandidate;
        }
    }
    const explicitEmpty = expectedCoverage.length
        ? coverageCompleteEmpty && failures.length === 0
        : /^\s*无人(?:物)?档案[。.!！]?\s*$/u.test(text);
    if (explicitEmpty) return { entries, failures, routeRepairs, formatUnrecoverable: false, explicitEmpty: true, coverageProof, raw: text };
    const targetRe = /<profile-target\b([^>]*)>([\s\S]*?)(?:<\/profile-target>|(?=<profile-target\b)|$)/giu;
    const seenTargets = new Set();
    let targetMatch;
    while ((targetMatch = targetRe.exec(normalized))) {
        const attrs = targetMatch[1];
        const attrValue = (key) => attrs.match(new RegExp(`\\b${key}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'iu'))?.slice(1).find(Boolean) || '';
        const rawActorId = cleanText(attrValue('actor'), 120);
        const rawName = cleanText(attrValue('name'), 160);
        const resolvedRoute = resolveScheduledRoute(rawActorId, rawName);
        const actorId = resolvedRoute.actorId;
        const name = resolvedRoute.name;
        const targetKey = `${actorId}\u0000${name}`;
        if (!actorId || seenTargets.has(targetKey)) {
            failures.push({ actorId, name, reason: actorId ? 'actor_profile.module_target_duplicate' : 'actor_profile.module_target_missing', retryable: true });
            continue;
        }
        if (resolvedRoute.repair) routeRepairs.push(resolvedRoute.repair);
        seenTargets.add(targetKey);
        const modules = {};
        const moduleRe = /<module\b([^>]*)>([\s\S]*?)(?:<\/module>|(?=<module\b)|$)/giu;
        let moduleMatch;
        while ((moduleMatch = moduleRe.exec(targetMatch[2]))) {
            const rawKey = moduleMatch[1].match(/\bkey\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/iu)?.slice(1).find(Boolean) || '';
            const key = actorProfileCompletionModuleKey(rawKey);
            if (!group?.modules?.includes(key)) {
                // The discovery probe owns route keys only.  Older/noisy
                // model responses may append dossier modules, but they are
                // deliberately discarded rather than becoming identity data.
                if (group?.key === 'identity_bootstrap' && !group?.modules?.length) continue;
                failures.push({ actorId, name, reason: 'actor_profile.module_unexpected', moduleKey: rawKey, retryable: true });
                continue;
            }
            if (modules[key]) {
                failures.push({ actorId, name, reason: 'actor_profile.module_duplicate', moduleKey: key, retryable: true });
                continue;
            }
            const physiologyCoverage = key === 'physiology'
                ? validatePhysiologyCoverage(moduleMatch[2])
                : null;
            if (physiologyCoverage && !physiologyCoverage.ok) {
                failures.push({
                    actorId,
                    name,
                    reason: 'actor_profile.physiology_coverage_incomplete',
                    moduleKey: key,
                    missingFields: physiologyCoverage.missingFields,
                    retryable: true,
                });
                continue;
            }
            const body = physiologyCoverage?.prose || cleanModuleBody(moduleMatch[2]);
            const minimum = key === 'person' ? 40 : key === 'currentState' ? 50 : 70;
            if (Array.from(body).length >= minimum && !/^(?:未知|待定|暂无|未登记|无|unknown|n\/?a)[。.!！]?$/iu.test(body)) modules[key] = body;
            else failures.push({ actorId, name, reason: 'actor_profile.module_content_incomplete', moduleKey: key, retryable: true });
        }
        if (actorId === 'new' && (!name || !String(acceptedNarrative).includes(name))) {
            failures.push({ actorId: '', name, reason: 'actor_profile.discovery_name_not_in_narrative', retryable: true });
            continue;
        }
        const routeSource = coverageTargetSources.get(targetKey) || null;
        if (group?.key === 'identity_bootstrap' && !group?.modules?.length && actorId !== 'new') {
            const registered = registeredById.get(actorId);
            if (!registered) {
                // On the first ledger bootstrap there is no ActorRef that can
                // possibly be revealed. Models still sometimes format an
                // otherwise literal new-person row as an invented ActorRef.
                // Normalize only that empty-registry case back to `new`; the
                // exact accepted-text/unit anchor is retained and the later
                // local protected-name/Registry preflight remains unchanged.
                // Once any ActorRef exists, an unknown id stays fail-closed so
                // a misspelled reveal can never duplicate or merge an actor.
                if (
                    registeredById.size === 0
                    && name
                    && routeSource?.sourceAnchor?.includes(name)
                ) {
                    entries.push({
                        actorId: 'new',
                        name,
                        modules,
                        coverageUnitId: routeSource.coverageUnitId,
                        sourceUnitOffset: routeSource.sourceUnitOffset,
                        sourceAnchor: routeSource.sourceAnchor,
                    });
                    routeRepairs.push(
                        'actor_profile.identity_empty_registry_unknown_ref_normalized_to_new',
                    );
                    continue;
                }
                failures.push({ actorId, name, reason: 'actor_profile.identity_reveal_actor_ref_unknown', retryable: true });
                continue;
            }
            if (!name || !routeSource?.sourceAnchor?.includes(name)) {
                failures.push({ actorId, name, reason: 'actor_profile.identity_reveal_name_not_in_coverage_unit', retryable: true });
                continue;
            }
            if (
                Array.from(routeSource.evidenceSpan || '').length < 4
                || Array.from(routeSource.evidenceSpan || '').length > 240
                || !actorProfileIdentityEvidenceSurface(routeSource.sourceAnchor)
                    .includes(actorProfileIdentityEvidenceSurface(routeSource.evidenceSpan))
                || !actorProfileIdentityEvidenceSurface(routeSource.evidenceSpan)
                    .includes(actorProfileIdentityEvidenceSurface(name))
            ) {
                failures.push({ actorId, name, reason: 'actor_profile.identity_reveal_evidence_invalid', retryable: true });
                continue;
            }
            if ([registered.displayName, ...registered.aliases].includes(name)) {
                failures.push({ actorId, name, reason: 'actor_profile.identity_reveal_unchanged', retryable: true });
                continue;
            }
            const anchorActorIds = [...registeredById.values()].filter((entry) => (
                [entry.displayName, ...entry.aliases]
                    .filter(Boolean)
                    .some((label) => actorProfileIdentityEvidenceSurface(routeSource.evidenceSpan)
                        .includes(actorProfileIdentityEvidenceSurface(label)))
            )).map((entry) => entry.actorId);
            if (anchorActorIds.length !== 1 || anchorActorIds[0] !== actorId) {
                failures.push({ actorId, name, reason: 'actor_profile.identity_reveal_actor_ambiguous', retryable: true });
                continue;
            }
            entries.push({
                actorId,
                name,
                modules,
                identityReveal: true,
                previousName: registered.displayName,
                coverageUnitId: routeSource.coverageUnitId,
                sourceUnitOffset: routeSource.sourceUnitOffset,
                sourceAnchor: routeSource.sourceAnchor,
                evidenceSpan: routeSource.evidenceSpan,
            });
            continue;
        }
        entries.push({
            actorId,
            name,
            modules,
            coverageUnitId: routeSource?.coverageUnitId || '',
            sourceUnitOffset: routeSource?.sourceUnitOffset ?? -1,
            sourceAnchor: routeSource?.sourceAnchor || '',
        });
    }
    return {
        entries,
        failures,
        routeRepairs,
        formatUnrecoverable: entries.length === 0,
        explicitEmpty: false,
        coverageProof,
        raw: text,
    };
}

function narrativeSectionsReady(profile) {
    if (profile?.profileFormat !== 'narrative-v1') return false;
    const sections = profile.narrativeSections || {};
    return ACTOR_PROFILE_NARRATIVE_SECTION_KEYS
        .filter((key) => key !== 'physiology')
        .every((key) => (
        Boolean(narrativeText(sections[key]?.text, 4000))
        && NARRATIVE_SECTION_SOURCE_SET.has(sections[key]?.source)
    ));
}

const PROFILE_PLACEHOLDER_RE = /^(?:未设定|未登记|未填写|未生成|未知|待确认|暂无(?:资料|信息|设定)?|不详|无资料|无信息|unknown|unset|unregistered|pending|n\/?a|null|none|[-—]+)[。.!！]?$/iu;

function meaningfulProfileText(value, limit = 500) {
    const text = cleanText(value, limit);
    return text && !PROFILE_PLACEHOLDER_RE.test(text) ? text : '';
}

function meaningfulProfileList(value, limit = 16, itemLimit = 300) {
    return cleanList(value, limit, itemLimit).filter((item) => meaningfulProfileText(item, itemLimit));
}

function meaningfulProfileEntries(value, limit = 24) {
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => {
        if (typeof entry === 'string') return Boolean(meaningfulProfileText(entry, 1000));
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const leaves = Object.values(entry).flatMap((item) => (
            Array.isArray(item) ? item : [item]
        ));
        return leaves.some((item) => (
            typeof item === 'string' && Boolean(meaningfulProfileText(item, 1000))
        ));
    }).slice(0, limit);
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
        designRolls: null,
        locks: {},
        manualOverrides: {},
        moduleVersions: Object.fromEntries(ACTOR_PROFILE_MODULES.map((module) => [module, 0])),
        history: [],
        baselineCommit: null,
        updatedTurn: 0,
    };
}

export function normalizeActorProfileV6(value, {
    actorId = '',
    name = '',
    mode = 'full',
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceVersion = Number(source.version);
    const legacyPersisted = Number.isFinite(sourceVersion)
        && sourceVersion > 0
        && sourceVersion <= 6
        && source.preparedForAction === true
        && integer(source.coverage, 0, 100, 0) === 100;
    const output = emptyActorProfileV6(
        actorId || source.actorId,
        name || source.name,
        { mode: source.completionMode || mode },
    );
    output.preparedForAction = source.preparedForAction === true;
    output.backgroundPending = source.backgroundPending === true;
    output.coverage = integer(source.coverage, 0, 100, 0);
    if (source.profileFormat === 'narrative-v1') {
        output.profileFormat = 'narrative-v1';
        output.narrativeSections = normalizeNarrativeSections(source.narrativeSections);
    }
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
    output.designRolls = normalizeActorProfileDesignRolls(source.designRolls);
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
    output.baselineCommit = source.baselineCommit
        && typeof source.baselineCommit === 'object'
        && !Array.isArray(source.baselineCommit)
        ? {
            schemaVersion: integer(source.baselineCommit.schemaVersion, 1, Number.MAX_SAFE_INTEGER, 0),
            commitId: cleanText(source.baselineCommit.commitId, 180),
            actorRef: {
                actorId: cleanText(
                    source.baselineCommit.actorRef?.actorId
                        || source.baselineCommit.actorId,
                    120,
                ),
                name: cleanText(source.baselineCommit.actorRef?.name, 160),
            },
            digest: cleanText(source.baselineCommit.digest, 120),
            sourceRef: source.baselineCommit.sourceRef
                && typeof source.baselineCommit.sourceRef === 'object'
                && !Array.isArray(source.baselineCommit.sourceRef)
                ? clone(source.baselineCommit.sourceRef)
                : null,
            committedTurn: integer(
                source.baselineCommit.committedTurn,
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
            readbackVerified: source.baselineCommit.readbackVerified === true,
            status: cleanText(source.baselineCommit.status, 60),
            verification: source.baselineCommit.verification
                && typeof source.baselineCommit.verification === 'object'
                && !Array.isArray(source.baselineCommit.verification)
                ? {
                    version: integer(
                        source.baselineCommit.verification.version,
                        1,
                        Number.MAX_SAFE_INTEGER,
                        1,
                    ),
                    preparedLedgerDigest: cleanText(
                        source.baselineCommit.verification.preparedLedgerDigest,
                        180,
                    ),
                    transactionId: cleanText(
                        source.baselineCommit.verification.transactionId,
                        180,
                    ),
                    writeSetDigest: cleanText(
                        source.baselineCommit.verification.writeSetDigest,
                        180,
                    ),
                    preparedFieldRevision: integer(
                        source.baselineCommit.verification.preparedFieldRevision,
                        0,
                        Number.MAX_SAFE_INTEGER,
                        0,
                    ),
                    commitId: cleanText(
                        source.baselineCommit.verification.commitId,
                        180,
                    ),
                    profileDigest: cleanText(
                        source.baselineCommit.verification.profileDigest,
                        120,
                    ),
                    commitEvidenceDigest: cleanText(
                        source.baselineCommit.verification.commitEvidenceDigest,
                        180,
                    ),
                    writeSet: (Array.isArray(source.baselineCommit.verification.writeSet)
                        ? source.baselineCommit.verification.writeSet
                        : []).map((entry) => ({
                        actorRef: {
                            actorId: cleanText(entry?.actorRef?.actorId, 120),
                            name: cleanText(entry?.actorRef?.name, 160),
                        },
                        schemaVersion: integer(
                            entry?.schemaVersion,
                            1,
                            Number.MAX_SAFE_INTEGER,
                            0,
                        ),
                        commitId: cleanText(entry?.commitId, 180),
                        profileDigest: cleanText(entry?.profileDigest, 120),
                        sourceRef: entry?.sourceRef
                            && typeof entry.sourceRef === 'object'
                            && !Array.isArray(entry.sourceRef)
                            ? clone(entry.sourceRef)
                            : null,
                        scopeDigest: cleanText(
                            entry?.scopeDigest || entry?.sourceRef?.scopeDigest,
                            180,
                        ),
                        locks: entry?.locks
                            && typeof entry.locks === 'object'
                            && !Array.isArray(entry.locks)
                            ? clone(entry.locks)
                            : {},
                        manualOverrides: entry?.manualOverrides
                            && typeof entry.manualOverrides === 'object'
                            && !Array.isArray(entry.manualOverrides)
                            ? clone(entry.manualOverrides)
                            : {},
                    })).filter((entry) => (
                        entry.actorRef.actorId
                        && entry.commitId
                        && entry.profileDigest
                    )),
                }
                : null,
        }
        : null;
    if (
        output.baselineCommit?.status === 'legacy_persisted'
        && output.baselineCommit.actorRef.actorId
    ) {
        output.baselineCommit = {
            ...output.baselineCommit,
            schemaVersion: Math.min(6, output.baselineCommit.schemaVersion || 6),
            commitId: '',
            digest: '',
            readbackVerified: false,
            status: 'legacy_persisted',
            verification: null,
        };
    } else if (!output.baselineCommit?.commitId || !output.baselineCommit.actorRef.actorId) {
        output.baselineCommit = null;
    }
    if (!output.baselineCommit && legacyPersisted) {
        output.baselineCommit = {
            schemaVersion: sourceVersion,
            commitId: '',
            actorRef: { actorId: output.actorId, name: output.name },
            digest: '',
            sourceRef: null,
            committedTurn: integer(source.updatedTurn),
            readbackVerified: false,
            status: 'legacy_persisted',
            verification: null,
        };
    }
    output.updatedTurn = integer(source.updatedTurn);
    return output;
}

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
const VALUE_SEEDS = [
    '更看重兑现承诺，宁愿少答应也不轻易失约',
    '更看重个人选择权，反感别人替自己决定',
    '更看重具体公平，愿意为程序和申诉入口多花时间',
    '更看重熟人情分，规则允许时会先照顾自己人',
    '更看重手艺与完成度，不喜欢只靠身份压人',
    '更看重现实回报，帮助别人也会先问清成本与对价',
    '更看重安稳日常，不愿让所有事情都升级成宏大使命',
    '更看重公开声誉，希望自己的贡献能被准确看见',
    '更看重知识与解释，面对结论会追问它怎样被证实',
    '更看重弱者免受无谓损失，但不会把帮助等同于替人做主',
    '更看重群体秩序，愿意承担维持协作的麻烦工作',
    '更看重自由探索，允许无功利的好奇和临时改道',
    '更看重家人与故土留下的生活方式，不轻易把旧习惯当落后',
    '更看重效率，能接受不完美但可运行的方案',
    '更看重体面与分寸，即使敌对也不喜欢失控撒泼',
    '更看重诚实交换，不要求全盘坦白但厌恶故意误导',
];
const TEMPERAMENT_SEEDS = [
    '平时松弛健谈，真正要紧时反而会突然安静',
    '慢热寡言，但熟悉后会主动分享琐碎见闻',
    '精力旺盛、容易先动手试一小步，不等于鲁莽',
    '耐心有限，遇到反复解释会明显烦躁但仍能把事做完',
    '情绪来得快去得也快，很少把一场争执记成永久立场',
    '表面随和，涉及自己的时间和物品时边界很硬',
    '对陌生事物兴奋，对熟悉责任却容易拖延',
    '习惯先照顾场面，独处后才承认自己其实介意',
    '不喜欢热闹中心，但会留意谁被人群落下',
    '爱竞争也输得起，失败后更想复盘而不是报复',
    '容易为小事担心，却能在真正危机里按步骤行动',
    '外表严肃，实际很容易被具体而笨拙的善意打动',
    '好奇心强，常因多问一句得到线索，也可能惹人厌烦',
    '对多数事情淡然，唯独少数个人原则会让其突然强硬',
    '重视速度和节奏，等待时容易用别的小事填满空档',
    '观察期很长，一旦作出判断就不喜欢频繁摇摆',
];
const HUMOR_SEEDS = [
    '用轻微自嘲缓冲尴尬，不拿别人的伤处取乐',
    '喜欢一本正经地讲荒唐比喻，等别人自己反应过来',
    '会吐槽制度、天气和手边物件，很少直接挖苦人',
    '几乎不主动讲笑话，但会精准接住熟人的梗',
    '笑点低，紧张时偶尔因不合时宜的小事憋笑',
    '喜欢夸张模仿熟悉的口头禅，遇到陌生人则收敛',
    '把竞争说成小游戏，借玩笑掩饰自己其实很在意输赢',
    '习惯冷不丁指出字面歧义，笑意很淡',
    '幽默感笨拙，常常解释完笑话反而更好笑',
    '不爱玩笑，偶尔的直白评价会意外形成喜感',
    '会用给物件起外号的方式减轻漫长工作的无聊',
    '喜欢善意抬杠，用反例逗人但允许对方不接招',
    '在熟人面前嘴贫，对公开场合的取笑非常谨慎',
    '喜欢讲生活里真实发生的小倒霉，不编夸张传奇',
    '笑时不遮掩，生气时反而不会使用讽刺',
    '对黑色幽默接受度高，但知道什么时候必须停下',
];
const FRICTION_SEEDS = [
    '容易高估自己独自解决问题的能力，开口求助偏晚',
    '对含糊承诺缺乏耐心，可能把仍在思考的人误判成敷衍',
    '太在意不浪费资源，有时显得小气或错过时机',
    '习惯替团队收尾，久而久之会暗自计较别人是否偷懒',
    '看重体面，犯错后的第一反应常是解释而不是道歉',
    '好奇心压过分寸时会多问一句不该问的事',
    '对熟人过度宽容，对陌生人则要求证据过严',
    '喜欢尽快做决定，有时没给慢热的人足够表达时间',
    '过于相信亲手做过的经验，容易低估新方法',
    '害怕承诺后做不到，因此可能错过本可承担的关系',
    '爱比较效率，偶尔忽略别人需要先确认感受和边界',
    '不愿欠人情，可能拒绝一项其实合理的帮助',
    '对规则漏洞很敏感，也可能因此把简单事情弄得太复杂',
    '容易被清楚自信的说法说服，之后才想起核对来源',
    '把疲惫当成意志问题，往往到明显失误后才肯休息',
    '遇到不公平会持续追究，有时不肯接受成本更低的折中',
];
const AUTHORITY_SEEDS = [
    '尊重明确职责，但会要求权威说明权限和后果',
    '对头衔不敏感，更服从现场最懂行的人',
    '习惯先按程序做，发现程序伤人时才转向变通',
    '对熟悉的上级直言不讳，对陌生权力保持表面礼貌',
    '不喜欢命令人，也不愿被模糊命令支配，偏好谈清分工',
    '能在纪律体系里工作，同时私下保留自己的评价',
    '对权威有天然戒心，但不会为了反抗而反抗事实',
    '愿意暂时服从紧急指挥，事后一定要求复盘责任',
    '容易把照顾型权威当作可靠来源，需提醒自己继续核实',
    '看重资历与传承，却允许新人用结果推翻旧做法',
    '更相信共同制定的规则，对单方面例外非常敏感',
    '对权力关系务实，知道何时让步，也记得自己让出了什么',
];
const PRESSURE_RECOVERY_SEEDS = [
    ['压力上升时先缩短说话、检查出口和可控步骤', '确认退路与同伴状态后，通过整理手边物品恢复节奏'],
    ['压力上升时话会变多，试图用提问掌握局面', '得到一条可靠答案后安静下来，重新区分轻重缓急'],
    ['压力上升时先讨价还价，努力减少必须承担的范围', '边界得到承认后会恢复合作，并补做自己承诺的部分'],
    ['压力上升时容易僵住几秒，但仍能执行熟练流程', '完成第一个熟悉步骤后逐渐找回判断，不需要被羞辱刺激'],
    ['压力上升时会加快行动并忽略疲劳', '危险过去后需要吃饭、睡眠或独处，才不会持续过载'],
    ['压力上升时先找最可信的人确认分工', '责任明确后恢复独立行动，不会永久依附对方'],
    ['压力上升时变得挑剔，反复检查别人做过的部分', '看到可核验回执后愿意放手，并承认自己过度控制'],
    ['压力上升时用玩笑淡化严重性', '允许严肃谈一次后会停止插科打诨，转而处理后果'],
    ['压力上升时先撤离争执现场，避免当场说重话', '在时间约定明确时会回来继续谈，不把回避变成失踪'],
    ['压力上升时更依赖规则和旧经验', '获得新证据后通过复盘修正规则，而不是维护面子'],
    ['压力上升时会优先保护某个具体人或物，视野因此变窄', '确认保护对象安全后才重新看见全局和他人的代价'],
    ['压力上升时情绪外露、动作直接，但不会自动失去能力', '通过运动、劳动或完成一件短任务消化情绪后恢复交流'],
];
const EVERYDAY_SEEDS = [
    '会给常用工具固定位置，别人放错时忍不住重新归位',
    '总想尝试路边新食物，踩雷后还会认真记录哪一点难吃',
    '出门前反复确认门窗，却经常忘记带不重要的小东西',
    '喜欢修补还能用的旧物，对纯装饰消费有自己的偏见',
    '忙时会把饮品忘到凉透，空闲时又很讲究冲泡步骤',
    '习惯记账，但会给少数毫无用处的爱好留固定预算',
    '对植物或小动物很有耐心，对复杂机器反而容易烦躁',
    '每到陌生地方先记厕所、出口和便宜饭馆的位置',
    '会收集票根、标签或小纸条，却不愿承认这是纪念',
    '睡前喜欢听固定节目，错过后第二天会有一点不自在',
    '工作台看似凌乱，实际上能立刻指出每件东西在哪里',
    '习惯早到一会儿观察环境，也因此常替迟到的人找借口',
    '不擅长做饭但很会处理剩菜，讨厌把能吃的东西浪费掉',
    '喜欢在走路时默背要做的事，到地方后可能漏掉最后一项',
    '会记住熟人的忌口和常用物，却经常想不起纪念日',
    '遇到长队会观察队伍怎么移动，并暗中猜哪个窗口更快',
];
const THINKING_STYLE_SEEDS = [
    '先把亲眼所见、他人转述和自己的猜测分开，再决定哪一项值得行动',
    '习惯从反例检查结论，哪怕结论正好符合自己的期待也会多问一句',
    '更依赖具体案例理解抽象规则，听完原则后会追问它落到眼前该怎么做',
    '先找系统里最容易卡住的一环，再判断局部修补还是整体改道',
    '会把问题讲给别人听来整理思路，说到一半也允许自己推翻原判断',
    '先估算最坏损失和撤回办法，再给值得一试的新方案留下空间',
    '对数字和清单敏感，但知道统计没有覆盖的生活细节仍可能改变结论',
    '倾向沿时间顺序复盘因果，发现空档时宁可标记未知也不自动补齐',
];
const SOCIAL_MOTIVE_SEEDS = [
    '希望在群体里成为能交换实际帮助的人，而不是单纯获得所有人的喜欢',
    '想被少数可信对象准确理解，对广泛关注和热闹人缘兴趣有限',
    '重视获得同行认可，希望别人看见自己的手艺与判断而非只看身份',
    '需要保留稳定的私人空间，愿意维持关系但不接受全天候可用',
    '享受撮合彼此有用的人，也会在中间人的成本过高时退出',
    '希望自己在共同决定中有真实发言权，不满足于被礼貌地告知结果',
    '倾向守住熟人网络的日常运转，宁愿做琐碎协调也不追求中心位置',
    '把结识新的人当作扩展生活经验，但不会因此自动交付信任和承诺',
];
const INTEREST_ORIENTATION_SEEDS = [
    '优先保护自己的时间与稳定收入，额外投入需要看见清楚回报',
    '愿意为长期信誉承担当下小损失，但拒绝没有边界的道德绑架',
    '对能带来新技能和新入口的机会更有耐心，即使短期收益普通',
    '在熟人与制度冲突时会努力找可公开解释的偏袒范围，不愿装作绝对中立',
    '先保证基本安全与退路，再考虑名望、冒险和更大的共同目标',
    '重视自己对成果的控制权，宁可慢一点也不愿把关键决定完全外包',
    '愿意共享可复制的知识，但会为稀缺工具、材料和劳动明确计价',
    '把生活质量视为真实利益，不会为了宏大叙事无限牺牲休息与普通快乐',
];
const CONFLICT_STYLE_SEEDS = [
    '先把争议缩成一件能核对的事实和一项具体要求，避免一次清算整段关系',
    '会当场指出越界，但倾向把惩罚与补救分开谈，不靠羞辱迫使对方服从',
    '冲突升温时先暂停现场互动，约定时间后带着方案回来而不是永久消失',
    '善于讨价还价，会主动交换让步，但对模糊的以后补偿保持怀疑',
    '不喜欢公开争执，通常先私下沟通；私下无效时才把问题带入正式程序',
    '面对强势对象会暂时收集证据和盟友，不把延迟反应等同于已经接受',
    '容易直接竞争，用结果决定一部分分歧，同时承认有些边界不能靠输赢决定',
    '优先维持共同任务的最低协作面，私人不满可以留到任务结束后再处理',
];
const MORAL_BOUNDARY_SEEDS = [
    '可以隐瞒自己的私事，但不能伪造会让无辜者承担现实风险的关键信息',
    '接受对自愿承担风险的人做等价交易，拒绝利用对方不知情或无法退出牟利',
    '为了保护具体的人可以违背低层程序，但不会把保护扩张成替对方决定人生',
    '允许对敌对者施压和欺骗，却不接受把无关旁人当成报复工具',
    '能容忍资源分配不平均，但要求受损者至少知道规则并保有申诉入口',
    '重视承诺，环境根本变化时可以重谈；不能假装旧承诺从未存在',
    '允许保留秘密与策略，不允许借亲密关系强迫对方交出全部隐私',
    '危急时可以优先求生，但事后必须承认自己把代价留给了谁并尝试补救',
];
const ACTION_HABIT_SEEDS = [
    '开始前会先确认工具、出口和交接人，完成后习惯留下一条可核验回执',
    '喜欢先做十分钟的小样，再决定是否投入整段时间和更多资源',
    '遇到复杂任务会边做边记短清单，但经常把清单写在手边任何纸片上',
    '优先处理会阻塞别人的步骤，自己的收尾则容易拖到最后一刻',
    '行动前常向现场最熟悉的人问一个具体问题，不因头衔自动选择咨询对象',
    '会为常见失败准备低成本备用方案，却不为极小概率情况囤积全部资源',
    '倾向亲手检查关键节点，次要部分愿意委托并用结果而非姿态评估',
    '做决定后会明确下一次复核条件，条件未出现时不反复被场面情绪带走',
];
const SELF_DECEPTION_SEEDS = [
    '自认只是讲效率，实际有时用效率避开需要道歉或解释的关系成本',
    '相信自己不在乎评价，却会对贡献被忽略记得比预想更久',
    '把迟迟不求助解释成独立，往往忽略了别人因此失去提前协作的机会',
    '认为自己对所有人一视同仁，实际会给熟悉的人更多解释机会',
    '声称只是谨慎，某些时候其实是在等待别人先承担失败责任',
    '觉得自己善于照顾人，却可能先做了安排才想起询问对方是否需要',
    '把持续忙碌当成可靠，容易低估疲惫已经怎样影响判断和脾气',
    '认为自己很容易改变主意，但面对亲手建立的方法时会要求过高的新证据',
];
// P5 mature-source replacements. The values are copied from the approved
// Sugar/current-preset tables without carrying type labels or a hidden shared
// type draw. Every consuming axis still receives its own deterministic salt.
const SUGAR_CORE_DESIRE_SEEDS = Object.freeze([
    '完整正确 vs 缺陷败坏',
    '被爱被需 vs 不被爱/无用',
    '价值钦佩 vs 毫无价值/失败',
    '独特真我 vs 平庸/有缺陷',
    '能力全知 vs 无能/被压倒',
    '安全支持 vs 缺乏指引/孤立',
    '快乐满足 vs 痛苦/匮乏',
    '掌控独立 vs 被控/受伤害',
    '和谐宁静 vs 冲突/分离',
]);
const PRESET_SOCIAL_METHOD_SEEDS = Object.freeze([
    '直说',
    '绕开',
    '交易',
    '观察',
    '玩笑',
    '礼貌疏离',
    '照顾细节',
]);
const PRESET_DECISION_METHOD_SEEDS = Object.freeze([
    '先核价',
    '凭经验',
    '问人',
    '试错',
    '留退路',
    '服从程序',
    '看心情',
]);
const SUGAR_RELATIONSHIP_DISTANCE_SEEDS = Object.freeze([
    '自信且乐于建立亲密关系，能有效沟通需求与感受，在独处与陪伴中取得平衡。',
    '渴望高度亲密，但缺乏自信，常担心被伴侣抛弃，对关系状态高度敏感且寻求过度肯定。',
    '高度独立，倾向于压抑情感，视亲密关系为对自主性的威胁，并回避情感依赖。',
    '对亲密关系既渴望又恐惧，因害怕被拒绝或受伤害而回避亲密，行为模式常表现为矛盾与不稳定。',
]);

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
    if (!length) return 0;
    const identity = `${actor?.id || actor?.actorId || ''}|${actor?.name || 'actor'}`;
    const hex = fingerprint(`${identity}|${String(salt || '')}`).split(':').at(-1) || '0';
    return Number.parseInt(hex.slice(-8), 16) % length;
}

function diceEntry(actor, salt, values) {
    const index = seedIndex(actor, salt, values.length);
    return {
        die: `d${values.length}`,
        roll: index + 1,
        result: clone(values[index]),
    };
}

function normalizeCharacterCreationTarget(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        chatId: cleanText(source.chatId, 180),
        messageId: cleanText(source.messageId, 180),
        index: Number.isInteger(Number(source.index)) ? Number(source.index) : -1,
        swipeId: integer(source.swipeId),
        generation: integer(source.generation ?? source.generationSerial),
        generationId: cleanText(source.generationId, 180),
        generationType: cleanText(source.generationType, 40),
        hash: cleanText(source.hash ?? source.fingerprint, 180),
    };
}

function targetIdentityMatches(left, right, fields) {
    return fields.every((field) => left?.[field] === right?.[field]);
}

export function issueCharacterCreationTicket(actor, {
    entropy = '',
    target = null,
    order = 0,
} = {}) {
    const roller = {
        id: cleanText(actor?.id || actor?.actorId, 120),
        name: cleanText(actor?.name, 160),
    };
    const issuanceTarget = normalizeCharacterCreationTarget(target);
    const salted = (axis) => `character-creation-ticket-v3|${cleanText(entropy, 240)}|${axis}`;
    const axes = {
        valuePriority: diceEntry(roller, salted('value'), VALUE_SEEDS),
        temperament: diceEntry(roller, salted('temperament'), TEMPERAMENT_SEEDS),
        coreDesire: diceEntry(roller, salted('core-desire'), SUGAR_CORE_DESIRE_SEEDS),
        thinkingStyle: diceEntry(roller, salted('thinking-style'), THINKING_STYLE_SEEDS),
        socialMotive: diceEntry(roller, salted('social-motive'), SOCIAL_MOTIVE_SEEDS),
        socialMethod: diceEntry(roller, salted('social'), PRESET_SOCIAL_METHOD_SEEDS),
        interestOrientation: diceEntry(
            roller,
            salted('interest-orientation'),
            INTEREST_ORIENTATION_SEEDS,
        ),
        decisionMethod: diceEntry(roller, salted('decision'), PRESET_DECISION_METHOD_SEEDS),
        conflictStyle: diceEntry(roller, salted('conflict-style'), CONFLICT_STYLE_SEEDS),
        moralBoundary: diceEntry(roller, salted('moral-boundary'), MORAL_BOUNDARY_SEEDS),
        speechRhythm: diceEntry(roller, salted('speech'), SPEECH_SEEDS),
        actionHabit: diceEntry(roller, salted('action-habit'), ACTION_HABIT_SEEDS),
        humorMethod: diceEntry(roller, salted('humor'), HUMOR_SEEDS),
        authorityAttitude: diceEntry(roller, salted('authority'), AUTHORITY_SEEDS),
        relationshipDistance: diceEntry(
            roller,
            salted('relationship'),
            SUGAR_RELATIONSHIP_DISTANCE_SEEDS,
        ),
        ordinaryFriction: diceEntry(roller, salted('friction'), FRICTION_SEEDS),
        selfDeception: diceEntry(roller, salted('self-deception'), SELF_DECEPTION_SEEDS),
        pressureAndRecovery: diceEntry(
            roller,
            salted('pressure-recovery'),
            PRESSURE_RECOVERY_SEEDS,
        ),
        everydayTexture: diceEntry(roller, salted('everyday'), EVERYDAY_SEEDS),
        independentLifeFocus: diceEntry(
            roller,
            salted('life-focus'),
            PERSONAL_GOAL_SEEDS.map((item) => item.longTerm),
        ),
    };
    const seed = fingerprint(`${roller.id}|${roller.name}|${cleanText(entropy, 240)}`);
    return {
        version: CHARACTER_CREATION_TICKET_VERSION,
        kind: 'character_creation_ticket',
        seed,
        ticketId: `NPC-DICE-${fingerprint(`${seed}|${JSON.stringify(axes)}`).split(':').at(-1)}`,
        issuance: {
            ...issuanceTarget,
            order: integer(order, 1, 999, 1),
        },
        binding: null,
        discardedAxes: [],
        axes,
    };
}

// Compatibility API for explicit legacy callers. Runtime generation uses
// issueCharacterCreationTicket so a post-generation profile path can be proven
// free of dice issuance.
export function rollActorProfileDiversity(actor, options = {}) {
    return issueCharacterCreationTicket(actor, options);
}

export function normalizeActorProfileDesignRolls(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    const version = integer(source?.version);
    if (!source || ![1, 2, 3].includes(version) || !source.axes) return null;
    const axes = Object.fromEntries(Object.entries(source.axes)
        .map(([axis, entry]) => [cleanText(axis, 80), {
            die: cleanText(entry?.die, 20),
            roll: integer(entry?.roll, 1, 999, 1),
            result: clone(entry?.result),
        }])
        .filter(([axis, entry]) => axis && entry.die && hasText(entry.result)));
    if (version === 3) {
        const axisNames = Object.keys(axes);
        if (
            axisNames.length !== CHARACTER_CREATION_TICKET_AXIS_NAMES.length
            || CHARACTER_CREATION_TICKET_AXIS_NAMES.some((axis) => !Object.hasOwn(axes, axis))
        ) return null;
    } else if (Object.keys(axes).length < (version === 1 ? 8 : 13)) return null;
    const base = {
        version,
        seed: cleanText(source.seed, 120),
        ticketId: cleanText(source.ticketId, 120),
        axes,
    };
    if (version === 1) return base;
    const issuance = normalizeCharacterCreationTarget(source.issuance);
    const bindingTarget = normalizeCharacterCreationTarget(source.binding);
    const bindingActorId = cleanText(source.binding?.actorRef?.actorId, 120);
    return {
        ...base,
        kind: 'character_creation_ticket',
        issuance: {
            ...issuance,
            order: integer(source.issuance?.order, 1, 999, 1),
        },
        binding: source.binding && bindingActorId
            ? {
                ...bindingTarget,
                order: integer(source.binding.order, 1, 999, 1),
                actorRef: {
                    actorId: bindingActorId,
                    displayName: cleanText(
                        source.binding.actorRef?.displayName
                            || source.binding.actorRef?.name,
                        160,
                    ),
                    aliases: cleanList(source.binding.actorRef?.aliases, 12, 160),
                },
            }
            : null,
        discardedAxes: cleanList(source.discardedAxes, 32, 80)
            .filter((axis) => Object.hasOwn(axes, axis)),
    };
}

export function bindCharacterCreationTicket(ticket, {
    target = null,
    actorRef = null,
    order = 0,
    discardedAxes = [],
} = {}) {
    const normalized = normalizeActorProfileDesignRolls(ticket);
    if (![2, 3].includes(normalized?.version) || normalized.binding) return null;
    const targetIdentity = normalizeCharacterCreationTarget(target);
    if (!targetIdentityMatches(normalized.issuance, targetIdentity, [
        'chatId',
        'generation',
        'generationId',
        'generationType',
    ])) return null;
    const actorId = cleanText(actorRef?.actorId, 120);
    if (!actorId || !targetIdentity.messageId || targetIdentity.index < 0) return null;
    const discarded = cleanList(discardedAxes, 32, 80)
        .filter((axis) => Object.hasOwn(normalized.axes, axis));
    return normalizeActorProfileDesignRolls({
        ...normalized,
        binding: {
            ...targetIdentity,
            order: integer(order, 1, 999, 1),
            actorRef: {
                actorId,
                displayName: cleanText(actorRef?.displayName || actorRef?.name, 160),
                aliases: cleanList(actorRef?.aliases, 12, 160),
            },
        },
        discardedAxes: discarded,
    });
}

function evidenceForActor(actor) {
    return cleanList([
        ...(actor?.evidence || []),
        ...(actor?.knowledge || []).map((entry) => entry?.id),
        ...(actor?.stateFacts || []).map((entry) => entry?.id),
    ], 16, 300);
}

function hasText(value) {
    if (typeof value === 'string') return Boolean(meaningfulProfileText(value));
    if (Array.isArray(value)) return meaningfulProfileList(value).length > 0;
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
    // Designed seeds are allowed only after the complete baseline transaction
    // has been durably read back. The commit gate, rather than the source label,
    // separates local scaffolding from a persisted dossier.
    if (record.source === 'deprecated') return false;
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
    ].every((value) => Boolean(meaningfulProfileText(value, 2400)));
    if (module === 'personality') {
        return Boolean(
            meaningfulProfileText(data.biography)
            && meaningfulProfileText(data.primaryColor)
            && meaningfulProfileList(data.primaryDerivatives).length >= 2
            && meaningfulProfileText(data.primarySentence)
            && meaningfulProfileText(data.baseColor)
            && meaningfulProfileList(data.baseDerivatives).length >= 2
            && meaningfulProfileText(data.baseSentence)
            && meaningfulProfileText(data.accentColor)
            && meaningfulProfileList(data.accentDerivatives).length >= 2
            && meaningfulProfileText(data.accentSentence)
            && meaningfulProfileList(data.othersVoices).length >= 4
            && meaningfulProfileText(data.authorVoice)
        );
    }
    if (module === 'relationships') return Array.isArray(data.entries)
        && (
            data.entries.length > 0
            || data.coverageState === 'no_confirmed_relationships'
        );
    if (module === 'goals') {
        return Boolean(
            meaningfulProfileList(data.longTerm).length
            && meaningfulProfileList(data.current).length
            && meaningfulProfileText(data.plan?.summary)
            && meaningfulProfileList(data.plan?.steps).length
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
            Boolean(meaningfulProfileText(data[field], 4000))
        ));
    }
    return false;
}

function calculateCoverage(profile) {
    if (profile?.profileFormat === 'narrative-v1') {
        return narrativeSectionsReady(profile) ? 100 : 0;
    }
    // Adult physiology is an explicitly optional profile surface. Its unknown
    // details must stay visible, but they must not turn the core profile's
    // first-action readiness into an impossible 89% ceiling.
    const required = ACTOR_PROFILE_MODULES.filter((module) => module !== 'physiology');
    const ready = required.filter((module) => moduleReady(profile, module)).length;
    return required.length ? Math.round((ready / required.length) * 100) : 100;
}

function calculateOptionalCoverage(profile) {
    if (profile?.profileFormat === 'narrative-v1') {
        if (modeOf(profile.completionMode) !== 'full_adult') return 100;
        return narrativeText(profile?.narrativeSections?.physiology?.text, 4000)
            && integer(
                profile?.narrativeSections?.physiology?.contractVersion,
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ) >= ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION
            ? 100
            : 0;
    }
    if (profile.modules.physiology.data.enabled !== true) return 100;
    return moduleReady(profile, 'physiology') ? 100 : 0;
}

function canonicalProfileValue(value) {
    if (Array.isArray(value)) return value.map(canonicalProfileValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
        key,
        canonicalProfileValue(value[key]),
    ]));
}

function recoveryInteger(value, fallback = -1) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
}

export function normalizeActorProfileRecoverySourceRef(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const logicalIndex = recoveryInteger(source.logicalIndex ?? source.index);
    return {
        chatId: cleanText(source.chatId, 180),
        messageId: cleanText(source.messageId, 180),
        logicalIndex,
        index: recoveryInteger(source.index ?? source.logicalIndex),
        swipeId: recoveryInteger(source.swipeId, 0),
        generation: recoveryInteger(source.generation, -1),
        generationSerial: recoveryInteger(source.generationSerial, -1),
        generationId: cleanText(source.generationId, 180),
        generationType: cleanText(source.generationType ?? source.type, 40),
        type: cleanText(source.type ?? source.generationType, 40),
        identityScope: clone(source.identityScope ?? null),
        identityScopeId: cleanText(source.identityScopeId, 360),
        scope: clone(source.scope ?? null),
        scopeDigest: cleanText(source.scopeDigest, 180),
        hash: cleanText(source.hash, 180),
        contentHash: cleanText(source.contentHash ?? source.contentFingerprint, 180),
        contentFingerprint: cleanText(source.contentFingerprint ?? source.contentHash, 180),
    };
}

function actorProfileRecoverySourceDigest(value) {
    return `profile-source:${fingerprint(JSON.stringify(canonicalProfileValue(
        normalizeActorProfileRecoverySourceRef(value),
    )))}`;
}

export function actorProfileRecoverySourceMatches(left, right) {
    const normalizedLeft = normalizeActorProfileRecoverySourceRef(left);
    const normalizedRight = normalizeActorProfileRecoverySourceRef(right);
    if (
        !normalizedLeft.chatId
        || !normalizedLeft.messageId
        || normalizedLeft.logicalIndex < 0
        || normalizedLeft.generation < 0
        || normalizedLeft.generationSerial < 0
        || !normalizedLeft.generationId
        || !normalizedLeft.scopeDigest
        || !normalizedLeft.contentFingerprint
    ) return false;
    // `hash` is the full host message hash and may legitimately change when
    // MVU/mechanism blocks are repaired after the narrative was accepted.
    // Recovery identity is instead bound to the immutable message/generation,
    // scope and accepted narrative fingerprint.  All of those remain strict;
    // a narrative, swipe, generation or identity drift still fails closed.
    const recoveryIdentity = (source) => {
        const projection = { ...source };
        delete projection.hash;
        return projection;
    };
    return JSON.stringify(canonicalProfileValue(recoveryIdentity(normalizedLeft)))
        === JSON.stringify(canonicalProfileValue(recoveryIdentity(normalizedRight)));
}

function actorProfileTicketBatchDigestPayload(value, acceptedTarget = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const batch = clone(source);
    delete batch.persistenceDigest;
    delete batch.acceptedTarget;
    return {
        acceptedTarget: normalizeActorProfileRecoverySourceRef(
            acceptedTarget || source.acceptedTarget,
        ),
        batch,
    };
}

function actorProfileTicketBatchShapeValid(value, acceptedTarget) {
    const target = normalizeActorProfileRecoverySourceRef(acceptedTarget);
    const batchGeneration = recoveryInteger(value?.generation, -1);
    const batchGenerationSerial = recoveryInteger(value?.generationSerial, -1);
    const capacity = recoveryInteger(value?.capacity, 0);
    const tickets = Array.isArray(value?.tickets) ? value.tickets : [];
    return Boolean(
        target.chatId
        && value?.chatId === target.chatId
        && cleanText(value?.generationId, 180) === target.generationId
        && batchGeneration === target.generation
        && batchGenerationSerial === target.generationSerial
        && cleanText(value?.generationType, 40) === target.generationType
        && capacity > 0
        && tickets.length === capacity
        && tickets.every((ticket) => {
            const normalized = normalizeActorProfileDesignRolls(ticket);
            return normalized
                && normalized.ticketId
                && normalized.issuance.chatId === target.chatId
                && normalized.issuance.generation === target.generation
                && normalized.issuance.generationId === target.generationId
                && normalized.issuance.generationType === target.generationType;
        })
    );
}

export function actorProfileTicketBatchPersistenceDigest(value, acceptedTarget = null) {
    return `profile-ticket-batch:${fingerprint(JSON.stringify(canonicalProfileValue(
        actorProfileTicketBatchDigestPayload(value, acceptedTarget),
    )))}`;
}

export function sealActorProfileTicketBatchForPersistence(value, acceptedTarget) {
    if (
        !value
        || !actorProfileRecoverySourceMatches(acceptedTarget, acceptedTarget)
        || !actorProfileTicketBatchShapeValid(value, acceptedTarget)
    ) return null;
    const sealed = {
        ...clone(value),
        acceptedTarget: normalizeActorProfileRecoverySourceRef(acceptedTarget),
    };
    sealed.persistenceDigest = actorProfileTicketBatchPersistenceDigest(sealed);
    return sealed;
}

export function actorProfileTicketBatchPersistenceMatches(value, {
    acceptedTarget = null,
    expectedDigest = '',
} = {}) {
    if (!value || !cleanText(value.persistenceDigest, 240)) return false;
    const target = acceptedTarget || value.acceptedTarget;
    return actorProfileTicketBatchShapeValid(value, target)
        && actorProfileRecoverySourceMatches(value.acceptedTarget, target)
        && value.persistenceDigest === actorProfileTicketBatchPersistenceDigest(value)
        && (!expectedDigest || value.persistenceDigest === expectedDigest);
}

function normalizeActorProfileRetryDiagnosticList(value) {
    return cleanList(value, 8, 120);
}

function actorProfileRetryDiagnosticListsMatch(left, right) {
    return JSON.stringify(normalizeActorProfileRetryDiagnosticList(left))
        === JSON.stringify(normalizeActorProfileRetryDiagnosticList(right));
}

function actorProfileRetryReceiptDigestPayload(value) {
    return {
        version: Math.max(0, Number(value?.version) || 0),
        generationId: cleanText(value?.generationId, 180),
        sourceRef: normalizeActorProfileRecoverySourceRef(value?.sourceRef),
        sourceDigest: cleanText(value?.sourceDigest, 240),
        ticketBatchDigest: cleanText(value?.ticketBatchDigest, 240),
        status: cleanText(value?.status, 80),
        outcomeStatus: cleanText(value?.outcomeStatus, 80),
        failingModules: normalizeActorProfileRetryDiagnosticList(value?.failingModules),
        failureCodes: normalizeActorProfileRetryDiagnosticList(value?.failureCodes),
        updatedAt: Math.max(0, Number(value?.updatedAt) || 0),
    };
}

function actorProfileRetryReceiptDigest(value) {
    return `profile-retry-receipt:${fingerprint(JSON.stringify(canonicalProfileValue(
        actorProfileRetryReceiptDigestPayload(value),
    )))}`;
}

export function createActorProfileRetryReceipt({
    sourceRef,
    ticketBatch = null,
    failingModules = [],
    failureCodes = [],
    outcomeStatus = 'not_completed',
    updatedAt = 0,
} = {}) {
    if (!actorProfileRecoverySourceMatches(sourceRef, sourceRef)) return null;
    const normalizedSource = normalizeActorProfileRecoverySourceRef(sourceRef);
    const receipt = {
        version: 3,
        generationId: normalizedSource.generationId,
        sourceRef: normalizedSource,
        sourceDigest: actorProfileRecoverySourceDigest(normalizedSource),
        ticketBatchDigest: actorProfileTicketBatchPersistenceMatches(ticketBatch, {
            acceptedTarget: normalizedSource,
        }) ? ticketBatch.persistenceDigest : '',
        status: 'not_completed',
        outcomeStatus: cleanText(outcomeStatus, 80) || 'not_completed',
        failingModules: normalizeActorProfileRetryDiagnosticList(failingModules),
        failureCodes: normalizeActorProfileRetryDiagnosticList(failureCodes),
        updatedAt: Math.max(0, Number(updatedAt) || 0),
    };
    receipt.receiptDigest = actorProfileRetryReceiptDigest(receipt);
    return receipt;
}

export function actorProfileRetryReceiptMatches(value, {
    currentSourceRef = null,
    ticketBatch = null,
    expectedReceipt = null,
} = {}) {
    const version = Math.max(0, Number(value?.version) || 0);
    const failingModules = normalizeActorProfileRetryDiagnosticList(value?.failingModules);
    const failureCodes = normalizeActorProfileRetryDiagnosticList(value?.failureCodes);
    if (
        ![2, 3].includes(version)
        || value?.status !== 'not_completed'
        || !Array.isArray(value?.failingModules)
        || !Array.isArray(value?.failureCodes)
        || JSON.stringify(value.failingModules) !== JSON.stringify(failingModules)
        || JSON.stringify(value.failureCodes) !== JSON.stringify(failureCodes)
        || !actorProfileRecoverySourceMatches(value.sourceRef, currentSourceRef)
        || value.sourceDigest !== actorProfileRecoverySourceDigest(value.sourceRef)
    ) return false;
    // V3 is the current durable format and seals the complete normalized
    // diagnostic receipt. V2 remains refresh-compatible only when both
    // diagnostic arrays exist in canonical form; a legacy receipt missing
    // either field cannot impersonate a current recoverable failure.
    if (
        version === 3
        && (
            !cleanText(value?.receiptDigest, 240)
            || value.receiptDigest !== actorProfileRetryReceiptDigest(value)
        )
    ) return false;
    if (expectedReceipt) {
        if (
            version !== Math.max(0, Number(expectedReceipt?.version) || 0)
            || !actorProfileRetryDiagnosticListsMatch(
                failingModules,
                expectedReceipt?.failingModules,
            )
            || !actorProfileRetryDiagnosticListsMatch(
                failureCodes,
                expectedReceipt?.failureCodes,
            )
            || (version === 3 && value.receiptDigest !== expectedReceipt?.receiptDigest)
        ) return false;
    }
    if (!value.ticketBatchDigest) return ticketBatch == null;
    return actorProfileTicketBatchPersistenceMatches(ticketBatch, {
        acceptedTarget: currentSourceRef,
        expectedDigest: value.ticketBatchDigest,
    });
}

function actorProfileNoCandidatesTerminalProofPayload(value) {
    return {
        version: Math.max(0, Number(value?.version) || 0),
        kind: cleanText(value?.kind, 80),
        status: cleanText(value?.status, 80),
        generationId: cleanText(value?.generationId, 180),
        sourceRef: normalizeActorProfileRecoverySourceRef(value?.sourceRef),
        sourceDigest: cleanText(value?.sourceDigest, 240),
        coverageProof: actorProfileDiscoveryCoverageProofMatches(value?.coverageProof)
            ? {
                version: 1,
                unitCount: Number(value.coverageProof.unitCount),
                unitDigests: [...value.coverageProof.unitDigests],
                unitLengths: [...value.coverageProof.unitLengths],
                coverageDigest: cleanText(value.coverageProof.coverageDigest, 240),
            }
            : null,
    };
}

function actorProfileNoCandidatesTerminalProofDigest(value) {
    return `profile-no-candidates-proof:${fingerprint(JSON.stringify(canonicalProfileValue(
        actorProfileNoCandidatesTerminalProofPayload(value),
    )))}`;
}

export function createActorProfileNoCandidatesTerminalProof({ sourceRef, coverageProof } = {}) {
    if (!actorProfileRecoverySourceMatches(sourceRef, sourceRef)
        || !actorProfileDiscoveryCoverageProofMatches(coverageProof)) return null;
    const normalizedSource = normalizeActorProfileRecoverySourceRef(sourceRef);
    const proof = {
        version: 2,
        kind: 'actor_profile_terminal_receipt',
        status: 'no_candidates',
        generationId: normalizedSource.generationId,
        sourceRef: normalizedSource,
        sourceDigest: actorProfileRecoverySourceDigest(normalizedSource),
        coverageProof: actorProfileNoCandidatesTerminalProofPayload({ coverageProof }).coverageProof,
    };
    proof.proofDigest = actorProfileNoCandidatesTerminalProofDigest(proof);
    return proof;
}

export function actorProfileNoCandidatesTerminalProofMatches(value, {
    currentSourceRef = null,
    expectedProof = null,
} = {}) {
    return value?.version === 2
        && value?.kind === 'actor_profile_terminal_receipt'
        && value?.status === 'no_candidates'
        && actorProfileRecoverySourceMatches(value.sourceRef, currentSourceRef)
        && value.sourceDigest === actorProfileRecoverySourceDigest(value.sourceRef)
        && actorProfileDiscoveryCoverageProofMatches(value.coverageProof)
        && cleanText(value?.proofDigest, 240) !== ''
        && value.proofDigest === actorProfileNoCandidatesTerminalProofDigest(value)
        && (!expectedProof || value.proofDigest === expectedProof?.proofDigest);
}

export function actorProfileRecoveryCriticalFingerprint(overrides = {}) {
    const helpers = {
        normalizeActorProfileRecoverySourceRef,
        actorProfileRecoverySourceDigest,
        actorProfileRecoverySourceMatches,
        actorProfileTicketBatchDigestPayload,
        actorProfileTicketBatchShapeValid,
        actorProfileTicketBatchPersistenceDigest,
        sealActorProfileTicketBatchForPersistence,
        actorProfileTicketBatchPersistenceMatches,
        normalizeActorProfileRetryDiagnosticList,
        actorProfileRetryDiagnosticListsMatch,
        actorProfileRetryReceiptDigestPayload,
        actorProfileRetryReceiptDigest,
        createActorProfileRetryReceipt,
        actorProfileRetryReceiptMatches,
        actorProfileDiscoveryCoverageDigest,
        actorProfileDiscoveryCoveragePlan,
        actorProfileDiscoveryCoverageProofMatches,
        actorProfileNoCandidatesTerminalProofPayload,
        actorProfileNoCandidatesTerminalProofDigest,
        createActorProfileNoCandidatesTerminalProof,
        actorProfileNoCandidatesTerminalProofMatches,
    };
    const manifest = Object.entries(helpers).map(([name, helper]) => [
        name,
        String(Object.hasOwn(overrides, name) ? overrides[name] : helper),
    ]);
    return `actor-profile-critical:${fingerprint(JSON.stringify(manifest))}`;
}

export function actorProfileGenerationCriticalFingerprint(overrides = {}) {
    const semantics = {
        diversityContract: ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT,
        completionGroups: ACTOR_PROFILE_COMPLETION_GROUPS,
        moduleNotes: PROFILE_MODULE_NOTES,
        physiologyFieldTitles: PHYSIOLOGY_FIELD_TITLES,
        physiologyFieldAliases: PHYSIOLOGY_FIELD_ALIASES,
        physiologyContractVersion: ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
        physiologyCoverageKeys: ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS,
        identityRevealRefreshModules: ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES,
        vagueDiscoveryTerms: [...DISCOVERY_NAME_VAGUE_TERMS].sort(),
        discoveryNameRecovery: String(recoverActorProfileDiscoveryNameFromEvidence),
        profileNormalizer: String(normalizeActorProfileV6),
        actionReadiness: String(actorProfileActionReadiness),
        completionGroupPlan: String(actorProfileCompletionGroupPlan),
        buildGroupMessages: String(buildActorProfileModuleGroupMessages),
        compactRelevantFragments: String(compactRelevantFragments),
        compactAuthorityOverview: String(compactAuthorityOverview),
        candidatePromptLabels: String(candidatePromptLabels),
        promptContext: String(actorProfilePromptContext),
        designRollNormalizer: String(normalizeActorProfileDesignRolls),
        parseGroupOutput: String(parseActorProfileModuleGroupOutput),
        physiologyFieldKey: String(physiologyFieldKey),
        physiologyFragment: String(physiologyFragment),
        physiologyProse: String(physiologyProse),
        physiologyCoverageValidation: String(validatePhysiologyCoverage),
        identityEvidenceSurface: String(actorProfileIdentityEvidenceSurface),
        discoveryAnchor: String(validateActorProfileDiscoveryAnchor),
        ...(overrides || {}),
    };
    return `actor-profile-generation:${fingerprint(JSON.stringify(semantics))}`;
}

export function actorProfileBaselineDigest(value) {
    const profile = normalizeActorProfileV6(value, {
        actorId: value?.actorId,
        name: value?.name,
        mode: value?.completionMode,
    });
    const baselineFieldSources = Object.fromEntries(
        Object.entries(profile.fieldSources || {})
            .filter(([path]) => BASELINE_MODULES.some((module) => (
                path === `modules.${module}` || path.startsWith(`modules.${module}.`)
            )))
            .sort(([left], [right]) => left.localeCompare(right)),
    );
    const payload = {
        schemaVersion: profile.version,
        actorId: profile.actorId,
        name: profile.name,
        completionMode: profile.completionMode,
        ...(profile.profileFormat === 'narrative-v1'
            ? {
                profileFormat: 'narrative-v1',
                narrativeSections: profile.narrativeSections,
            }
            : { modules: Object.fromEntries(BASELINE_MODULES.map((module) => [
                module,
                profile.modules[module],
            ])) }),
        fieldSources: baselineFieldSources,
        designRolls: profile.designRolls,
        locks: profile.locks,
        manualOverrides: profile.manualOverrides,
    };
    return `profile-v1:${fingerprint(JSON.stringify(canonicalProfileValue(payload)))}`;
}

function baselineCommitReady(profile) {
    const commit = profile?.baselineCommit;
    const verification = commit?.verification;
    return calculateCoverage(profile) === 100
        && profile.preparedForAction === true
        && commit?.readbackVerified === true
        && commit.status === 'committed'
        && !!cleanText(commit.commitId, 180)
        && commit.schemaVersion === profile.version
        && commit.actorRef?.actorId === profile.actorId
        && !!cleanText(commit.digest, 120)
        && commit.digest === actorProfileBaselineDigest(profile)
        && !!cleanText(verification?.preparedLedgerDigest, 180)
        && cleanText(verification?.commitId, 180) === commit.commitId
        && cleanText(verification?.profileDigest, 120) === commit.digest
        && (verification?.writeSet || []).some((entry) => (
            entry.actorRef?.actorId === profile.actorId
            && entry.commitId === commit.commitId
            && entry.profileDigest === commit.digest
        ));
}

export function actorProfileActionReadiness(actor) {
    const profile = normalizeActorProfileV6(actor?.profileV6, {
        actorId: actor?.id,
        name: actor?.name,
    });
    const commit = profile.baselineCommit;
    if (calculateCoverage(profile) !== 100) {
        return { ready: false, reason: 'actor_profile.incomplete', migrationRequired: false };
    }
    if (commit?.status === 'legacy_persisted') {
        return { ready: false, reason: 'actor_profile.legacy_migration_required', migrationRequired: true };
    }
    if (!commit || commit.status !== 'committed') {
        return { ready: false, reason: 'actor_profile.not_committed', migrationRequired: false };
    }
    if (!commit.commitId || !commit.digest) {
        return { ready: false, reason: 'actor_profile.commit_receipt_incomplete', migrationRequired: false };
    }
    if (commit.readbackVerified !== true) {
        return { ready: false, reason: 'actor_profile.readback_unverified', migrationRequired: false };
    }
    if (
        commit.schemaVersion !== profile.version
        || commit.actorRef?.actorId !== profile.actorId
        || commit.digest !== actorProfileBaselineDigest(profile)
    ) {
        return { ready: false, reason: 'actor_profile.commit_digest_mismatch', migrationRequired: false };
    }
    if (profile.preparedForAction !== true) {
        return { ready: false, reason: 'actor_profile.not_prepared', migrationRequired: false };
    }
    if (
        !commit.verification?.preparedLedgerDigest
        || commit.verification.commitId !== commit.commitId
        || commit.verification.profileDigest !== commit.digest
        || !(commit.verification.writeSet || []).some((entry) => (
            entry.actorRef?.actorId === profile.actorId
            && entry.commitId === commit.commitId
            && entry.profileDigest === commit.digest
        ))
    ) {
        return {
            ready: false,
            reason: 'actor_profile.ledger_verification_required',
            migrationRequired: false,
        };
    }
    return { ready: true, reason: '', migrationRequired: false };
}

function projectedFieldSource(previousProfile, module, relativePath, value, fallback) {
    const path = `modules.${module}.data.${relativePath}`;
    const previousValue = getPath(previousProfile, pathParts(path));
    const previousSource = sourceOf(previousProfile?.fieldSources?.[path], '');
    if (
        previousSource
        && JSON.stringify(previousValue) === JSON.stringify(value)
    ) return previousSource;
    return sourceOf(fallback, 'hypothesis');
}

function persistedBaselineProjectionMatchesActor(profile, actor) {
    const identity = profile.modules.identity?.data || {};
    const personality = profile.modules.personality?.data || {};
    const profileProjection = {
        identity: Object.fromEntries([
            'role', 'species', 'gender', 'age', 'briefIntro', 'appearance',
            'identityText', 'relationState', 'attitudeToProtagonist', 'pastExperience',
        ].map((field) => [field, identity[field]])),
        personality: Object.fromEntries([
            'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
            'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
            'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
        ].map((field) => [field, personality[field]])),
        longTermGoals: profile.modules.goals?.data?.longTerm || [],
        relationships: profile.modules.relationships?.data?.entries || [],
        knowledge: profile.modules.knowledge?.data?.entries || [],
        resources: profile.modules.resourcesCapabilities?.data?.resources || [],
        capabilities: profile.modules.resourcesCapabilities?.data?.capabilities || [],
    };
    const actorProjection = {
        identity: Object.fromEntries(Object.keys(profileProjection.identity).map((field) => [
            field,
            actor?.identity?.[field],
        ])),
        personality: Object.fromEntries(Object.keys(profileProjection.personality).map((field) => [
            field,
            actor?.identity?.[field],
        ])),
        longTermGoals: actor?.longTermGoals || [],
        relationships: actor?.relationships || [],
        knowledge: actor?.knowledge || [],
        resources: actor?.resources || [],
        capabilities: actor?.capabilities || [],
    };
    return JSON.stringify(canonicalProfileValue(profileProjection))
        === JSON.stringify(canonicalProfileValue(actorProjection));
}

function refreshDynamicProfileModules(profile, actor, { evidence, turn, now }) {
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
    // Missing tickets stay missing here. Only the pre-generation issuer, or an
    // already persisted V1 legacy ticket normalized above, may provide them.
    // The doctor must never invent personality after accepted text exists.
    profile.completionMode = completionMode;
    const evidence = evidenceForActor(actor);
    if (completionMode === 'off') {
        profile.coverage = calculateCoverage(profile);
        profile.preparedForAction = baselineCommitReady(profile);
        profile.backgroundPending = !profile.preparedForAction;
        profile.updatedTurn = integer(turn);
        return profile;
    }
    if (
        profile.completionMode === completionMode
        && baselineCommitReady(profile)
        && persistedBaselineProjectionMatchesActor(profile, actor)
    ) {
        refreshDynamicProfileModules(profile, actor, { evidence, turn, now });
        profile.coverage = calculateCoverage(profile);
        profile.preparedForAction = baselineCommitReady(profile);
        profile.backgroundPending = !profile.preparedForAction
            || calculateOptionalCoverage(profile) < 100;
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
    const identityFieldSources = Object.fromEntries(Object.keys(identity).map((key) => [
        key,
        projectedFieldSource(
            previousProfile,
            'identity',
            key,
            identity[key],
            key === 'name' || hasText(identity[key]) ? 'confirmed' : 'hypothesis',
        ),
    ]));
    assignModule(profile, 'identity', identity, {
        source: Object.values(identityFieldSources).some((source) => source === 'confirmed')
            ? 'confirmed'
            : 'hypothesis',
        unknownFields: [
            ...(hasText(actor?.identity?.role) ? [] : ['role']),
            ...(hasText(actor?.identity?.species) ? [] : ['species']),
            ...(hasText(actor?.identity?.gender) ? [] : ['gender']),
            ...(hasText(actor?.identity?.age) ? [] : ['age']),
            ...(hasText(actor?.identity?.briefIntro) ? [] : ['briefIntro']),
            ...(hasText(actor?.identity?.appearance) ? [] : ['appearance']),
            ...(hasText(actor?.identity?.identityText) ? [] : ['identityText']),
            ...(hasText(actor?.identity?.relationState) ? [] : ['relationState']),
            ...(hasText(actor?.identity?.attitudeToProtagonist) ? [] : ['attitudeToProtagonist']),
            ...(hasText(actor?.identity?.pastExperience) ? [] : ['pastExperience']),
        ],
        evidence,
        turn,
        now,
        fieldSourceOverrides: identityFieldSources,
    });

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
    const personalityFieldSources = Object.fromEntries(Object.keys(personality).map((key) => [
        key,
        projectedFieldSource(
            previousProfile,
            'personality',
            key,
            personality[key],
            hasText(personality[key]) ? 'confirmed' : 'hypothesis',
        ),
    ]));
    const hasConfirmedPersonality = Object.values(personalityFieldSources)
        .some((source) => source === 'confirmed');
    assignModule(profile, 'personality', personality, {
        source: hasConfirmedPersonality ? 'confirmed' : 'hypothesis',
        unknownFields: unknownPersonalityFields,
        evidence,
        turn,
        now,
        fieldSourceOverrides: personalityFieldSources,
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
    for (const [path, present, value] of [
        ['longTerm', confirmedLongTerm.length > 0, confirmedLongTerm],
        ['current', confirmedCurrent.length > 0, confirmedCurrent],
        ['plan.summary', Boolean(cleanText(actor?.plan?.summary)), plan.summary],
        ['plan.steps', cleanList(actor?.plan?.steps, 12, 300).length > 0, plan.steps],
    ]) {
        goalFieldSources[path] = projectedFieldSource(
            previousProfile,
            'goals',
            path,
            value,
            present ? 'confirmed' : 'hypothesis',
        );
    }
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
    refreshDynamicProfileModules(profile, actor, { evidence, turn, now });

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
    profile.preparedForAction = baselineCommitReady(profile);
    profile.backgroundPending = !profile.preparedForAction
        || calculateOptionalCoverage(profile) < 100;
    const previousComparable = { ...clone(previousProfile), updatedTurn: 0 };
    const currentComparable = { ...clone(profile), updatedTurn: 0 };
    profile.updatedTurn = JSON.stringify(previousComparable) === JSON.stringify(currentComparable)
        ? previousProfile.updatedTurn
        : integer(turn);
    return profile;
}

export function bindActorProfileDesignRolls(actor, designRolls) {
    const normalizedRolls = normalizeActorProfileDesignRolls(designRolls);
    if (!normalizedRolls || !actor || typeof actor !== 'object') return clone(actor);
    const next = clone(actor);
    const profile = normalizeActorProfileV6(next.profileV6, {
        actorId: next.id,
        name: next.name,
    });
    if (
        profile.designRolls
        && (
            profile.designRolls.ticketId !== normalizedRolls.ticketId
            || profile.designRolls.version === 1
        )
    ) return next;
    profile.designRolls = normalizedRolls;
    next.profileV6 = profile;
    return next;
}

function ticketCandidateMatchesTarget(candidate, target) {
    const sourceRef = normalizeCharacterCreationTarget(candidate?.sourceRef);
    return targetIdentityMatches(sourceRef, target, [
        'chatId',
        'messageId',
        'index',
        'swipeId',
        'generation',
        'hash',
    ]);
}

function actorNameProtected(name, protectedActorNames) {
    const key = cleanText(name, 160).toLocaleLowerCase('zh-CN');
    if (!key) return true;
    const protectedSet = new Set(cleanList(protectedActorNames, 256, 160)
        .map((item) => item.toLocaleLowerCase('zh-CN')));
    return protectedSet.has(key);
}

const EXPLICIT_AUTHORITY_TICKET_AXIS_LABELS = Object.freeze({
    temperament: ['基础气质'],
    coreDesire: ['核心欲望'],
    valuePriority: ['价值观'],
    thinkingStyle: ['思考方式'],
    socialMotive: ['社交动机'],
    socialMethod: ['社交方式'],
    relationshipDistance: ['关系模式'],
    interestOrientation: ['利益取向'],
    decisionMethod: ['决策方式'],
    conflictStyle: ['冲突方式'],
    pressureAndRecovery: ['压力反应', '恢复方式'],
    moralBoundary: ['道德边界'],
    speechRhythm: ['表达习惯'],
    actionHabit: ['行动习惯'],
    ordinaryFriction: ['弱点'],
    selfDeception: ['偏见', '自我欺骗'],
    humorMethod: ['幽默方式'],
    everydayTexture: ['非极端日常特征'],
});

function actorStructuredOccupiedTicketAxes(actor) {
    const identity = actor?.identity || {};
    const occupied = [];
    const add = (axis, value) => {
        if (hasText(value)) occupied.push(axis);
    };
    add('temperament', identity.traits);
    add('coreDesire', [...(actor?.longTermGoals || []), ...(identity.desires || [])]);
    add('thinkingStyle', identity.informationStyle);
    add('decisionMethod', identity.decisionStyle);
    add('socialMethod', identity.socialStyle);
    add('relationshipDistance', [
        identity.relationshipDistancePattern,
        ...(actor?.relationships || []),
    ]);
    add('pressureAndRecovery', [
        identity.copingStyle,
        identity.pressureResponse,
        identity.recoveryPath,
    ]);
    add('moralBoundary', identity.boundaries);
    add('speechRhythm', identity.speechStyle);
    add('ordinaryFriction', identity.blindSpots);
    add('selfDeception', [identity.selfImageGap, identity.typicalMisread]);
    add('everydayTexture', identity.everydayHabits);
    return occupied;
}

function ticketAxesEstablishedByAuthority(name, authorityText) {
    const actorName = cleanText(name, 160);
    const text = cleanText(authorityText, 200000);
    if (!actorName || !text.includes(actorName)) return [];
    const relevant = text
        .split(/[\n。！？!?]/u)
        .filter((fragment) => fragment.includes(actorName))
        .join('\n');
    if (!relevant) return [];
    return Object.entries(EXPLICIT_AUTHORITY_TICKET_AXIS_LABELS)
        .filter(([, labels]) => labels.some((label) => new RegExp(
            `${label}\\s*[：:=]`,
            'u',
        ).test(relevant)))
        .map(([axis]) => axis);
}

export function bindCharacterCreationTicketsToRegisteredActors(value, {
    registration = null,
    candidates = [],
    batch = null,
    target = null,
    protectedActorNames = [],
    authorityText = '',
    discardedAxesByActor = {},
} = {}) {
    const ledger = clone(value);
    if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.actors)) {
        return { ledger, matched: false, bindings: [], skipped: ['ledger_invalid'] };
    }
    const targetIdentity = normalizeCharacterCreationTarget(target);
    const batchTarget = normalizeCharacterCreationTarget(batch);
    if (!targetIdentityMatches(batchTarget, targetIdentity, [
        'chatId',
        'generation',
        'generationId',
        'generationType',
    ])) {
        return { ledger, matched: false, bindings: [], skipped: ['target_mismatch'] };
    }
    const tickets = (Array.isArray(batch?.tickets) ? batch.tickets : [])
        .map(normalizeActorProfileDesignRolls)
        .filter((ticket) => [2, 3].includes(ticket?.version) && !ticket.binding);
    const ticketPoolCapacity = integer(batch?.capacity, 1, 64, 32);
    const promoted = Array.isArray(registration?.promoted) ? registration.promoted : [];
    const candidateById = new Map((Array.isArray(candidates) ? candidates : [])
        .map((candidate) => [cleanText(candidate?.candidateId, 120), candidate]));
    const bindings = [];
    const skipped = [];
    const eligibleActorRefs = [];
    const exhaustedActorRefs = [];
    let ticketIndex = 0;
    for (const promotedActor of promoted) {
        const actorId = cleanText(promotedActor?.actorRef?.actorId, 120);
        const candidate = candidateById.get(cleanText(promotedActor?.candidateId, 120));
        const actorIndex = ledger.actors.findIndex((actor) => actor?.id === actorId);
        const actor = actorIndex >= 0 ? ledger.actors[actorIndex] : null;
        if (!promotedActor?.created || !candidate || !actor) {
            skipped.push(`${actorId || 'unknown'}:existing_or_missing`);
            continue;
        }
        if (
            candidate.sourceKind !== 'accepted_narrative'
            || !ticketCandidateMatchesTarget(candidate, targetIdentity)
        ) {
            skipped.push(`${actorId}:source_not_current_narrative`);
            continue;
        }
        if (actorNameProtected(actor.name, protectedActorNames)) {
            skipped.push(`${actorId}:authority_protected`);
            continue;
        }
        if (normalizeActorProfileDesignRolls(actor?.profileV6?.designRolls)) {
            skipped.push(`${actorId}:ticket_already_bound`);
            continue;
        }
        eligibleActorRefs.push(clone(promotedActor.actorRef));
        const ticket = tickets[ticketIndex];
        if (!ticket) {
            skipped.push(`${actorId}:ticket_pool_exhausted`);
            exhaustedActorRefs.push(clone(promotedActor.actorRef));
            continue;
        }
        const explicitDiscardedAxes = discardedAxesByActor instanceof Map
            ? discardedAxesByActor.get(actorId)
            : discardedAxesByActor?.[actorId];
        const discardedAxes = [
            ...(Array.isArray(explicitDiscardedAxes) ? explicitDiscardedAxes : []),
            ...actorStructuredOccupiedTicketAxes(actor),
            ...ticketAxesEstablishedByAuthority(actor.name, authorityText),
        ];
        const boundTicket = bindCharacterCreationTicket(ticket, {
            target: targetIdentity,
            actorRef: promotedActor.actorRef,
            order: ticketIndex + 1,
            discardedAxes,
        });
        if (!boundTicket) {
            skipped.push(`${actorId}:ticket_bind_rejected`);
            continue;
        }
        ledger.actors[actorIndex] = bindActorProfileDesignRolls(actor, boundTicket);
        bindings.push({
            ticketId: boundTicket.ticketId,
            actorRef: clone(boundTicket.binding.actorRef),
            order: boundTicket.binding.order,
            discardedAxes: clone(boundTicket.discardedAxes),
        });
        ticketIndex += 1;
    }
    return {
        ledger,
        matched: true,
        bindings,
        skipped,
        ticketPool: {
            capacity: ticketPoolCapacity,
            issued: tickets.length,
            eligible: eligibleActorRefs.length,
            consumed: ticketIndex,
            remaining: Math.max(0, tickets.length - ticketIndex),
            exhausted: exhaustedActorRefs.length > 0,
            eligibleActorRefs,
            exhaustedActorRefs,
        },
    };
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
    return actorProfileActionReadiness(actor).ready;
}

export function selectActorProfileCompletionCandidates(value, {
    initialActorIds = [],
    maintenanceMaxActors = null,
    // Compatibility input for callers older than the Stage-2 split. It is
    // maintenance-only and never truncates current-source initial actors.
    maxActors = null,
    turn: _turn = null,
    priorityActorIds = [],
    includeReadyActorIds = [],
    refreshModulesByActorId = {},
    readinessForActor = null,
} = {}) {
    const actors = Array.isArray(value?.actors) ? value.actors : [];
    const suppliedInitialActorIds = Array.isArray(initialActorIds)
        ? initialActorIds
        : [];
    const initialIds = cleanList(
        suppliedInitialActorIds.length ? suppliedInitialActorIds : priorityActorIds,
        Math.max(24, actors.length),
        120,
    );
    const initial = new Map(initialIds
        .map((actorId, index) => [actorId, index]));
    const forcedReadyIds = new Set(cleanList(
        includeReadyActorIds,
        Math.max(24, actors.length),
        120,
    ));
    const maintenanceBudget = integer(
        maintenanceMaxActors ?? maxActors ?? 0,
        0,
        24,
        0,
    );
    const compareMaintenance = (left, right) => {
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
    };
    const incomplete = actors
        .filter((actor) => !actor?.pendingProfile)
        .filter((actor) => {
            if (forcedReadyIds.has(cleanText(actor?.id, 120))) return true;
            const ready = typeof readinessForActor === 'function'
                ? readinessForActor(actor)?.ready === true
                : actorProfileReadyForAction(actor);
            if (!ready) return true;
            const profile = normalizeActorProfileV6(actor?.profileV6, {
                actorId: actor?.id,
                name: actor?.name,
            });
            return profile.completionMode === 'full_adult'
                && calculateOptionalCoverage(profile) < 100;
        });
    const initialCandidates = incomplete
        .filter((actor) => initial.has(cleanText(actor?.id, 120)))
        .sort((left, right) => (
            initial.get(cleanText(left?.id, 120)) - initial.get(cleanText(right?.id, 120))
        ));
    const maintenanceCandidates = incomplete
        .filter((actor) => !initial.has(cleanText(actor?.id, 120)))
        .sort(compareMaintenance)
        .slice(0, maintenanceBudget);
    return [...initialCandidates, ...maintenanceCandidates]
        .map((actor) => ({
            actorRef: {
                actorId: cleanText(actor?.id, 120),
                name: cleanText(actor?.name, 160),
            },
            batchClass: initial.has(cleanText(actor?.id, 120))
                ? 'initial'
                : 'maintenance',
            actorId: cleanText(actor?.id, 120),
            name: cleanText(actor?.name, 160),
            identity: clone(actor?.identity || {}),
            profileSummary: cleanText(actor?.identity?.profileSummary, 700),
            completionMode: modeOf(actor?.profileV6?.completionMode),
            longTermGoals: cleanList(actor?.longTermGoals, 12, 400),
            capabilities: cleanList(actor?.capabilities, 24, 160),
            resources: clone(actor?.resources || []),
            relationships: clone(actor?.relationships || []),
            knowledge: clone(actor?.knowledge || []),
            evidence: cleanList(actor?.evidence, 16, 300),
            physiology: clone(actor?.profileV6?.modules?.physiology?.data || {}),
            fieldSources: clone(actor?.profileV6?.fieldSources || {}),
            designRolls: clone(actor?.profileV6?.designRolls || null),
            previousProfile: clone(actor?.profileV6 || null),
            refreshProfileModules: cleanList(
                refreshModulesByActorId?.[cleanText(actor?.id, 120)],
                ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.length,
                80,
            ).filter((moduleKey) => ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.includes(moduleKey)),
        }))
        .filter((actor) => actor.actorId && actor.name);
}

function actorProfilePromptContext(candidate) {
    const sourceFor = (module, field) => sourceOf(
        candidate?.fieldSources?.[`modules.${module}.data.${field}`],
        'hypothesis',
    );
    const pick = (source, fields, module, selectedSource, relativePrefix = '') => {
        const selectedSources = new Set(Array.isArray(selectedSource)
            ? selectedSource
            : [selectedSource]);
        return Object.fromEntries(fields
            .map((field) => [field, clone(source?.[field])])
            .filter(([field, value]) => (
                hasText(value)
                && selectedSources.has(sourceFor(
                    module,
                    relativePrefix && field !== 'nextWindow'
                        ? `${relativePrefix}.${field}`
                        : field,
                ))
            )));
    };
    const identityFields = [
        'role', 'species', 'gender', 'age', 'briefIntro', 'appearance',
        'identityText', 'relationState', 'attitudeToProtagonist', 'pastExperience',
    ];
    const personalityFields = [
        'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
        'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
        'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
    ];
    const baselineGoals = candidate?.previousProfile?.modules?.goals?.data || {};
    const goalsFor = (selectedSource) => {
        const selectedSources = new Set(Array.isArray(selectedSource)
            ? selectedSource
            : [selectedSource]);
        return ({
            longTerm: selectedSources.has(sourceFor('goals', 'longTerm'))
                ? cleanList(baselineGoals.longTerm, 12, 400)
                : [],
            pursuitPrinciples: selectedSources.has(sourceFor('goals', 'current'))
                ? cleanList(baselineGoals.current, 8, 400)
                : [],
            strategy: {
                ...pick(
                    baselineGoals.plan,
                    ['summary', 'steps'],
                    'goals',
                    selectedSource,
                    'plan',
                ),
                ...(selectedSources.has(sourceFor('goals', 'nextWindow'))
                    ? { reviewConditions: cleanText(baselineGoals.nextWindow, 400) }
                    : {}),
            },
        });
    };
    const baselineModule = (module) => clone(
        candidate?.previousProfile?.modules?.[module]?.data || {},
    );
    const splitModule = (module, field, fallback) => {
        const value = baselineModule(module)?.[field] ?? clone(fallback);
        const source = sourceFor(module, field);
        return {
            confirmed: source === 'confirmed' ? clone(value) : undefined,
            editable: source === 'confirmed' ? undefined : clone(value),
        };
    };
    const relationships = splitModule('relationships', 'entries', candidate.relationships || []);
    const knowledge = splitModule('knowledge', 'entries', candidate.knowledge || []);
    const resources = splitModule(
        'resourcesCapabilities',
        'resources',
        candidate.resources || [],
    );
    const capabilities = splitModule(
        'resourcesCapabilities',
        'capabilities',
        candidate.capabilities || [],
    );
    return {
        actorRef: clone(candidate.actorRef || {
            actorId: candidate.actorId,
            name: candidate.name,
        }),
        confirmedAnchors: {
            identity: pick(candidate.identity, identityFields, 'identity', 'confirmed'),
            personality: pick(candidate.identity, personalityFields, 'personality', 'confirmed'),
            goals: goalsFor('confirmed'),
            relationships: relationships.confirmed || [],
            knowledge: knowledge.confirmed || [],
            resourcesCapabilities: {
                resources: resources.confirmed || [],
                capabilities: capabilities.confirmed || [],
            },
        },
        editableDraft: {
            identity: pick(candidate.identity, identityFields, 'identity', [
                'hypothesis', 'designed_seed',
            ]),
            personality: pick(candidate.identity, personalityFields, 'personality', [
                'hypothesis', 'designed_seed',
            ]),
            goals: goalsFor(['hypothesis', 'designed_seed']),
            relationships: relationships.editable || [],
            knowledge: knowledge.editable || [],
            resourcesCapabilities: {
                resources: resources.editable || [],
                capabilities: capabilities.editable || [],
            },
        },
        characterCreationTicket: normalizeActorProfileDesignRolls(
            candidate.designRolls || candidate.characterCreationTicket,
        ),
    };
}

function actorProfileFieldGuide(candidate) {
    const physiology = modeOf(candidate?.completionMode) === 'full_adult'
        ? '生理档案已启用：写稳定、客观且符合物种的信息；不适用时写明原因。'
        : '生理信息按人物和物种的实际适用性填写。';
    return [
        '每人一个自然中文档案块，标题为【人物档案：姓名】；已登记目标另写精确 ActorRef，新人物只写标题姓名。',
        '自然段需覆盖人物信息、性格底色、经历、当前状态、关系与动机、知识能力与资源。可用近义标题、任意合理顺序或连贯段落，不要求逐字使用固定七标题。',
        physiology,
        '每项写非占位的自然中文完整句；不要 JSON、数组、技术 flag、来源字段或字段表；不要替玩家写行动、感受、同意或世界结果。',
    ].join('\n');
}

export function buildActorProfileCompletionMessages(candidates, {
    evidenceText = '',
    customPrompt = '',
    validationFeedback = [],
    discoveryContext = null,
    discoveryRetryTargets = [],
} = {}) {
    const selected = Array.isArray(candidates) ? candidates : [];
    const discovery = isRecord(discoveryContext) ? discoveryContext : {};
    const retryDiscoveries = Array.isArray(discoveryRetryTargets)
        ? discoveryRetryTargets
        : [];
    const includesPhysiology = selected.some((candidate) => (
        modeOf(candidate?.completionMode) === 'full_adult'
    )) || modeOf(discovery.completionMode) === 'full_adult';
    const batchFieldGuide = actorProfileFieldGuide({
        completionMode: includesPhysiology ? 'full_adult' : 'full',
    });
    // Narrative-v1 has a deliberately separate transport contract. Keep the
    // legacy V6 prompt below unreachable while legacy callers are retired;
    // P2 must never ask a model for the former field table or provenance.
    const narrativeSystem = [
        'Identity Confirmation：你是“MVU自动医生”的人物档案医师。你像一位耐心、懂人物的传记编辑，从最终正文和权威材料中认出人物，并写成自然完整的中文档案。你不是正文作者，也不是数据库填表AI。',
        '\u4f60\u53ea\u751f\u6210\u4eba\u7269\u6863\u6848\uff0c\u4e0d\u7ee7\u5199\u5267\u60c5\uff0c\u4e0d\u66ff\u73a9\u5bb6\u51b3\u5b9a\u884c\u52a8\u3001\u611f\u53d7\u3001\u540c\u610f\u6216\u4e16\u754c\u7ed3\u679c\u3002\u6b63\u6587\u6ca1\u6709\u8bf4\u6b7b\u7684\u6863\u6848\u7ec6\u8282\uff0c\u53ef\u4ee5\u7ed3\u5408\u4e16\u754c\u89c2\u4e0e\u4eba\u7269\u5df2\u77e5\u903b\u8f91\u505a\u53ef\u4fee\u8ba2\u7684\u81ea\u7136\u8865\u5168\uff0c\u4f46\u4e0d\u5f97\u4e0e\u6743\u5a01\u8bbe\u5b9a\u6216\u5df2\u53d1\u751f\u4e8b\u5b9e\u51b2\u7a81\u3002',
        '\u6bcf\u4eba\u4e00\u4e2a\u5bbd\u677e\u4e2d\u6587\u6863\u6848\u5757\uff1a\u3010\u4eba\u7269\u6863\u6848\uff1a\u59d3\u540d\u3011\u3002\u7528\u81ea\u7136\u6bb5\u843d\u4ea4\u4ee3\u8eab\u4efd/\u5916\u8c8c\u3001\u751f\u7406\uff08\u542f\u7528\u65f6\uff09\u3001\u6027\u683c\u5e95\u8272\u3001\u7ecf\u5386\u3001\u5f53\u524d\u72b6\u6001\u3001\u5173\u7cfb\u4e0e\u52a8\u673a\u3001\u77e5\u8bc6/\u80fd\u529b/\u8d44\u6e90\u3002\u53ef\u7528\u5efa\u8bae\u6807\u9898\u6216\u540c\u4e49\u6807\u9898\uff0c\u4e0d\u9700\u9010\u5b57\u5e7f\u5b9a\u4e03\u4e2a\u6807\u9898\uff1b\u6bcf\u4e2a\u6838\u5fc3\u7ef4\u5ea6\u90fd\u5fc5\u987b\u6709\u975e\u5360\u4f4d\u7684\u81ea\u7136\u4e2d\u6587\u3002\u4e0d\u8981 JSON\u3001\u6570\u7ec4\u3001\u6280\u672f\u6807\u8bb0\u6216\u6765\u6e90\u5b57\u6bb5\u3002',
        `\u5b57\u6bb5\u8bed\u4e49\u6307\u5357\uff08\u53ea\u653e\u4e00\u6b21\uff09\uff1a\n${batchFieldGuide}`,
        '\u5df2\u767b\u8bb0\u4eba\u7269\u5728\u540d\u79f0\u4e0b\u4e00\u884c\u5199 ActorRef\uff1a\u540e\u9762\u5fc5\u987b\u662f\u8f93\u5165\u4e2d\u8be5\u4eba\u7269\u7684\u771f\u5b9e\u7cbe\u786e actorId \u503c\uff1b\u4e0d\u5f97\u5199 actorId \u5b57\u9762\u6a21\u677f\u3002\u65b0\u4eba\u7269\u4e0d\u5199 ActorRef \u6216\u951a\u70b9\uff1b\u6807\u9898\u59d3\u540d\u5fc5\u987b\u9010\u5b57\u590d\u7528\u5df2\u63a5\u53d7\u6b63\u6587\u4e2d\u81f3\u5c11\u4e00\u6b21\u51fa\u73b0\u7684\u975e\u6a21\u7cca\u539f\u59cb\u59d3\u540d\u8fde\u7eed\u5b50\u4e32\uff0c\u591a\u6b21\u51fa\u73b0\u65f6\u811a\u672c\u53d6\u7b2c\u4e00\u6b21\u3002\u4e0d\u5f97\u4f7f\u7528\u522b\u540d\u3001\u65b0\u53d6\u540d\u3001\u73a9\u5bb6\u4ee3\u79f0\u3001\u6cdb\u79f0\u6216\u65b0\u589e\u4eba\u7269\u3002',
        discovery.discoveryRetryOnly === true
            ? '\u8fd9\u662f\u5931\u8d25\u4eba\u7269\u5b50\u96c6\u66ff\u6362\uff1a\u4e0d\u5f97\u91cd\u65b0\u53d1\u73b0\u6b63\u6587\u4eba\u7269\u3002'
            : '\u4ec5\u4e3a\u771f\u6b63\u5728\u6b63\u6587\u4e2d\u51fa\u573a\u7684\u4eba\u7269\u5199\u6863\u3002',
        cleanList(validationFeedback, 16, 120).length
            ? `\u4ec5\u91cd\u5199\u5931\u4eba\u7269\u7684\u5b8c\u6574\u6863\u6848\uff1b\u56fa\u5b9a\u53cd\u9988\uff1a${cleanList(validationFeedback, 16, 120).join(', ')}`
            : '',
    ].filter(Boolean).join('\n\n');
    const narrativeUser = [
        `\u5df2\u767b\u8bb0\u76ee\u6807\uff08\u4ec5\u4f9b\u7cbe\u786e ActorRef \u5bf9\u4f4d\uff09\uff1a${JSON.stringify(selected.map((candidate) => ({ actorId: candidate?.actorRef?.actorId || candidate?.actorId, name: candidate?.actorRef?.name || candidate?.name })) )}`,
        `\u6700\u7ec8\u6b63\u6587\uff1a\n${String(discovery.acceptedNarrative || '').slice(0, 42000)}`,
        `\u6743\u5a01\u6750\u6599\uff1a\n${cleanText(evidenceText, 42000)}`,
        customPrompt ? `\u7528\u6237\u81ea\u5b9a\u4e49\u4eba\u7269\u6863\u6848\u63d0\u793a\uff1a\n${customPrompt}` : '',
        '\u5982\u679c\u7684\u786e\u6ca1\u6709\u5f85\u5199\u4eba\u7269\uff0c\u53ea\u8fd4\u56de\u4e25\u683c\u54e8\u5175\u201c\u65e0\u4eba\u7269\u6863\u6848\u201d\u3002',
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: narrativeSystem }, { role: 'user', content: narrativeUser }];
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

const LOOSE_PROFILE_SECTIONS = Object.freeze({
    identity: ['identity', '身份', '角色表', '追踪角色表', '人物档案', '角色档案'],
    personality: ['personality', 'persona', '性格', '人设', '人设基线', '追踪人设基线'],
    goals: ['goals', '目标', '行动方向', '计划'],
    relationships: ['relationships', '关系基线', '长期关系'],
    knowledge: ['knowledge', '知识边界', '知识'],
    resourcesCapabilities: ['resourcescapabilities', 'resources_capabilities', '资源能力', '能力资源'],
    physiology: ['physiology', 'bodybaseline', '身体', '身体基线', '生理档案', '追踪身体基线'],
});

const LOOSE_PROFILE_FIELDS = Object.freeze({
    identity: {
        role: ['role', '角色', '角色定位', '定位', '职业', '头衔'],
        species: ['species', '物种', '种族'],
        gender: ['gender', '性别'],
        age: ['age', '年龄'],
        briefIntro: ['briefintro', '简介', '人物简介', '角色简介', '一句话介绍', '简短介绍'],
        appearance: ['appearance', '外貌', '外观', '外貌特征'],
        identityText: ['identitytext', '身份', '身份说明'],
        relationState: ['relationstate', '人际关系', '关系状态', '关系'],
        attitudeToProtagonist: ['attitudetoprotagonist', '对主角态度', '对玩家态度'],
        pastExperience: ['pastexperience', '过往经历', '过去经历', '重要经历'],
    },
    personality: {
        biography: ['biography', '履历', '自述'],
        primaryColor: ['primarycolor', '主色调', '性格主色调'],
        primaryDerivatives: ['primaryderivatives', '主色调衍生', '主色衍生', '主色调衍生一', '主色调衍生二', '主色调衍生三'],
        primarySentence: ['primarysentence', '主色调语句', '主色语句'],
        baseColor: ['basecolor', '底色', '性格底色'],
        baseDerivatives: ['basederivatives', '底色衍生', '底色衍生一', '底色衍生二', '底色衍生三'],
        baseSentence: ['basesentence', '底色语句', '底色用语把捉'],
        accentColor: ['accentcolor', '点缀', '性格点缀'],
        accentDerivatives: ['accentderivatives', '点缀衍生', '点缀衍生一', '点缀衍生二', '点缀衍生三'],
        accentSentence: ['accentsentence', '点缀语句', '点缀用语把捉'],
        othersVoices: ['othersvoices', '他者声部', '他人评价'],
        authorVoice: ['authorvoice', '作者声部', '作者疑问'],
    },
    goals: {
        longTerm: ['longterm', 'longtermgoals', '长期目标'],
        pursuitPrinciples: ['pursuitprinciples', '追求原则', '长期行动原则'],
        summary: ['summary', '策略摘要', '长期策略'],
        steps: ['steps', '策略步骤', '长期步骤'],
        reviewConditions: ['reviewconditions', '复核条件', '调整条件'],
    },
    relationships: {
        entries: ['entries', '关系条目'],
        patterns: ['patterns', '关系规律', '长期关系规律'],
        coverageState: ['coveragestate', '覆盖状态'],
    },
    knowledge: {
        entries: ['entries', '知识条目'],
        unknownRemainsUnknown: ['unknownremainsunknown', '未知保持未知'],
        coverageState: ['coveragestate', '覆盖状态'],
    },
    resourcesCapabilities: {
        resources: ['resources', '资源'],
        capabilities: ['capabilities', '能力'],
        noUnconfirmedAbilityGranted: ['nounconfirmedabilitygranted', '不授予未确认能力'],
        coverageState: ['coveragestate', '覆盖状态'],
    },
    physiology: {
        facialAppearance: ['facialappearance', '相貌', '面部外观'],
        oralCavity: ['oralcavity', '口腔'],
        hairstyle: ['hairstyle', '常用发型', '发型'],
        neckShoulderArmpit: ['neckshoulderarmpit', '肩颈腋窝', '颈肩腋窝'],
        heightWeight: ['heightweight', '身高体重', '身高/体重'],
        bodySpecial: ['bodyspecial', '身材特异性征', '身材/特异性征'],
        skinTexture: ['skintexture', '肌肤触感', '皮肤触感'],
        bodyScent: ['bodyscent', '身体气味', '体味'],
        bodyMeasurements: ['bodymeasurements', '三围罩杯', '三围/罩杯', '三围'],
        breastAppearance: ['breastappearance', '胸部外观'],
        waistAbdomen: ['waistabdomen', '腰腹外观', '腰腹'],
        vulvaAppearance: ['vulvaappearance', '外阴外观'],
        vaginalProfile: ['vaginalprofile', '阴道剖面'],
        anusAppearance: ['anusappearance', '菊穴', '肛门外观'],
        buttockAppearance: ['buttockappearance', '臀部外观'],
        legAppearance: ['legappearance', '腿部外观'],
        footSize: ['footsize', '足码脚型', '足码/脚型'],
        footAppearance: ['footappearance', '足部外观'],
        lactationBodyFluid: ['lactationbodyfluid', '泌乳与特殊体液'],
        sensitiveParts: ['sensitiveparts', '敏感部位'],
    },
});

const LOOSE_PROFILE_LIST_FIELDS = new Set([
    'primaryDerivatives',
    'baseDerivatives',
    'accentDerivatives',
    'othersVoices',
    'longTerm',
    'pursuitPrinciples',
    'steps',
    'patterns',
    'entries',
    'resources',
    'capabilities',
]);

function looseProfileKey(value) {
    return String(value || '')
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s_`*#【】\[\]（）()/.·:：-]+/gu, '');
}

function looseProfileSection(value) {
    const key = looseProfileKey(value);
    return Object.entries(LOOSE_PROFILE_SECTIONS).find(([, aliases]) => (
        aliases.some((alias) => looseProfileKey(alias) === key)
    ))?.[0] || '';
}

function looseProfileField(section, value) {
    const key = looseProfileKey(value);
    const sections = section ? [section] : Object.keys(LOOSE_PROFILE_FIELDS);
    for (const candidateSection of sections) {
        const match = Object.entries(LOOSE_PROFILE_FIELDS[candidateSection] || {})
            .find(([field, aliases]) => (
                looseProfileKey(field) === key
                || aliases.some((alias) => looseProfileKey(alias) === key)
            ));
        if (match) return { section: candidateSection, field: match[0] };
    }
    return null;
}

function looseProfileList(value) {
    return cleanList(String(value || '')
        .replace(/^[-*•]\s*/u, '')
        .split(/\s*(?:[；;|]|(?=\d+[.、）)]\s*))\s*/gu)
        .map((item) => item.replace(/^\d+[.、）)]\s*/u, ''))
        .filter(Boolean), 12, 700);
}

function parseLooseProfileTable(text) {
    const result = {
        identity: {},
        personality: {},
        goals: { strategy: {} },
        relationships: {},
        knowledge: {},
        resourcesCapabilities: {},
        physiology: {},
    };
    let section = '';
    let current = null;
    const write = (target, rawValue, { append = false } = {}) => {
        if (!target) return;
        const { section: targetSection, field } = target;
        const container = targetSection === 'goals'
            && ['summary', 'steps', 'reviewConditions'].includes(field)
            ? result.goals.strategy
            : result[targetSection];
        const outputField = field;
        if (LOOSE_PROFILE_LIST_FIELDS.has(field)) {
            const items = looseProfileList(rawValue);
            container[outputField] = cleanList([
                ...(Array.isArray(container[outputField]) ? container[outputField] : []),
                ...items,
            ], field === 'othersVoices' ? 7 : 12, 700);
        } else {
            const value = cleanText(rawValue, 4000);
            if (!value) return;
            container[outputField] = append && container[outputField]
                ? cleanText(`${container[outputField]} ${value}`, 4000)
                : value;
        }
        current = target;
    };
    for (const rawLine of String(text || '').split(/\r?\n/gu)) {
        const line = rawLine.trim();
        if (!line || /^```/u.test(line) || /^\|?\s*:?-{2,}/u.test(line)) continue;
        const heading = line
            .replace(/^#{1,6}\s*/u, '')
            .replace(/^[【\[]|[】\]]$/gu, '')
            .replace(/[：:]$/u, '')
            .trim();
        const headingSection = looseProfileSection(heading);
        if (headingSection) {
            section = headingSection;
            current = null;
            continue;
        }
        let key = '';
        let value = '';
        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.slice(1, -1).split('|').map((cell) => cell.trim()).filter(Boolean);
            if (cells.length >= 3 && looseProfileSection(cells[0])) {
                section = looseProfileSection(cells[0]);
                [key, value] = [cells[1], cells.slice(2).join('；')];
            } else if (cells.length >= 2) {
                [key, value] = [cells[0], cells.slice(1).join('；')];
            }
        } else {
            const match = line.match(/^(?:[-*•]\s*)?([^：:]{1,48})[：:]\s*(.*)$/u);
            if (match) [, key, value] = match;
        }
        const target = key && !/^(?:字段|field|内容|value)$/iu.test(key)
            ? looseProfileField(section, key)
            : null;
        if (target) {
            section = target.section;
            write(target, value);
            continue;
        }
        if (current && /^[-*•]|^\d+[.、）)]/u.test(line)) {
            write(current, line, { append: true });
        } else if (current) {
            write(current, line, { append: true });
        }
    }
    const hasContent = Object.values(result).some((value) => (
        value && typeof value === 'object' && Object.keys(value).some((key) => (
            key !== 'strategy' || Object.keys(value.strategy || {}).length
        ))
    ));
    return hasContent ? result : null;
}

function normalizeLooseProfileSection(raw, section) {
    const result = section === 'goals' ? { strategy: {} } : {};
    const sources = [];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        sources.push(raw);
        for (const [key, value] of Object.entries(raw)) {
            if (
                looseProfileSection(key) === section
                && value && typeof value === 'object' && !Array.isArray(value)
            ) sources.push(value);
        }
    }
    const assign = (field, value) => {
        const goalStrategyField = section === 'goals'
            && ['summary', 'steps', 'reviewConditions'].includes(field);
        const target = goalStrategyField ? result.strategy : result;
        if (LOOSE_PROFILE_LIST_FIELDS.has(field)) {
            const rawItems = Array.isArray(value) ? value
                : value && typeof value === 'object' ? Object.values(value)
                    : looseProfileList(value);
            target[field] = cleanList([
                ...(Array.isArray(target[field]) ? target[field] : []),
                ...rawItems,
            ], field === 'othersVoices' ? 7 : 12, 700);
            return;
        }
        if (value && typeof value === 'object') return;
        const text = cleanText(value, 4000);
        if (text) target[field] = text;
    };
    for (const source of sources) {
        for (const [key, value] of Object.entries(source)) {
            if (
                section === 'goals'
                && ['plan', '计划', 'strategy', '策略'].includes(looseProfileKey(key))
                && value && typeof value === 'object' && !Array.isArray(value)
            ) {
                for (const [planKey, planValue] of Object.entries(value)) {
                    const strategyField = looseProfileField('goals', planKey);
                    if (strategyField?.section === 'goals') assign(strategyField.field, planValue);
                }
                continue;
            }
            const target = looseProfileField(section, key);
            if (target?.section === section) assign(target.field, value);
        }
    }
    if (section === 'goals' && !Object.keys(result.strategy).length) delete result.strategy;
    return result;
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

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Minimal transplant of TavernDB's JSON surface normalizer: these quotation
// variants are formatting, never profile facts. Keep this separate from the
// semantic candidate validator below.
function normalizeProfileJsonSurface(output, repairs = null) {
    let source = String(output || '').slice(0, 120000)
        .replace(/```(?:json|javascript|js)?/giu, '')
        .replace(/```/gu, '');
    const normalizedQuotes = source
        .replace(/[“”「」『』〝〞＂]/gu, '"')
        .replace(/[‘’]/gu, "'");
    if (normalizedQuotes !== source) repairs?.push('fullwidth_quote_normalized');
    source = normalizedQuotes;
    return source;
}

function isProfileWordCharacter(value) {
    return /[\p{L}\p{N}_]/u.test(value || '');
}

function isInWordApostrophe(source, index) {
    return source[index] === "'"
        && isProfileWordCharacter(source[index - 1])
        && isProfileWordCharacter(source[index + 1]);
}

function firstUnquotedProfileStructureIndex(source) {
    const trimmed = source.trimStart();
    // A complete quoted root is transport text, not a profile container. It
    // may only be unwrapped later by a declared ProfileInsertCandidate field.
    if (trimmed[0] === '"' || trimmed[0] === "'") return -1;
    let quote = '';
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || (char === "'" && !isInWordApostrophe(source, index))) {
            quote = char;
            continue;
        }
        if (char === '{' || char === '[') return index;
    }
    return -1;
}

// Small, data-only subset of TavernDB's loose JSON reader. It deliberately
// recognizes only JSON values plus single-quoted strings and missing object
// property commas; it never turns arbitrary prose into profile facts.
function parseLooseProfileJsonStructure(output, repairs) {
    const source = normalizeProfileJsonSurface(output, repairs);
    const start = firstUnquotedProfileStructureIndex(source);
    if (start < 0) return null;
    let cursor = start;
    const skip = () => {
        while (/\s/u.test(source[cursor] || '')) cursor += 1;
    };
    const parseQuoted = () => {
        const quote = source[cursor++];
        const singleQuoted = quote === "'";
        let value = '';
        while (cursor < source.length) {
            const char = source[cursor++];
            if (char === quote) {
                if (singleQuoted) repairs.push('loose_single_quotes_normalized');
                return value;
            }
            if (char !== '\\') {
                value += char;
                continue;
            }
            const escaped = source[cursor++];
            if (escaped === undefined) return null;
            if (escaped === 'n') value += '\n';
            else if (escaped === 'r') value += '\r';
            else if (escaped === 't') value += '\t';
            else if (escaped === 'b') value += '\b';
            else if (escaped === 'f') value += '\f';
            else if (escaped === 'u' && /^[0-9a-f]{4}$/iu.test(source.slice(cursor, cursor + 4))) {
                value += String.fromCharCode(Number.parseInt(source.slice(cursor, cursor + 4), 16));
                cursor += 4;
            } else value += escaped;
        }
        return null;
    };
    const parseBare = () => {
        const begin = cursor;
        while (cursor < source.length && !/[\s,}\]]/u.test(source[cursor])) cursor += 1;
        const value = source.slice(begin, cursor);
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(value)) return Number(value);
        return null;
    };
    const parseKey = () => {
        skip();
        if (source[cursor] === '"' || source[cursor] === "'") return parseQuoted();
        const begin = cursor;
        while (cursor < source.length && /[\p{L}\p{N}_$-]/u.test(source[cursor])) cursor += 1;
        return cursor > begin ? source.slice(begin, cursor) : null;
    };
    const parseValue = () => {
        skip();
        if (source[cursor] === '{') return parseObject();
        if (source[cursor] === '[') return parseArray();
        if (source[cursor] === '"' || source[cursor] === "'") return parseQuoted();
        return parseBare();
    };
    const parseObject = () => {
        if (source[cursor++] !== '{') return null;
        const value = {};
        skip();
        if (source[cursor] === '}') {
            cursor += 1;
            return value;
        }
        while (cursor < source.length) {
            const key = parseKey();
            if (!key) return null;
            skip();
            if (source[cursor++] !== ':') return null;
            const member = parseValue();
            if (member === null && source.slice(Math.max(0, cursor - 4), cursor) !== 'null') return null;
            value[key] = member;
            skip();
            if (source[cursor] === '}') {
                cursor += 1;
                return value;
            }
            if (source[cursor] === ',') {
                cursor += 1;
                skip();
                if (source[cursor] === '}') {
                    cursor += 1;
                    return value;
                }
                continue;
            }
            // A next valid object key is an unambiguous missing-property-comma
            // repair. Arrays intentionally do not receive this repair.
            const lookahead = cursor;
            const nextKey = parseKey();
            skip();
            const hasColon = source[cursor] === ':';
            cursor = lookahead;
            if (nextKey && hasColon) {
                repairs.push('loose_missing_property_comma_added');
                continue;
            }
            return null;
        }
        return null;
    };
    const parseArray = () => {
        if (source[cursor++] !== '[') return null;
        const value = [];
        skip();
        if (source[cursor] === ']') {
            cursor += 1;
            return value;
        }
        while (cursor < source.length) {
            const item = parseValue();
            if (item === null && source.slice(Math.max(0, cursor - 4), cursor) !== 'null') return null;
            value.push(item);
            skip();
            if (source[cursor] === ']') {
                cursor += 1;
                return value;
            }
            if (source[cursor++] !== ',') return null;
            skip();
            if (source[cursor] === ']') {
                cursor += 1;
                return value;
            }
        }
        return null;
    };
    const value = parseValue();
    if (value === null) return null;
    repairs.push('loose_nested_structure_parsed');
    return value;
}

function normalizeJsonLikeText(output, repairs) {
    let source = normalizeProfileJsonSurface(output, repairs);
    const first = firstUnquotedProfileStructureIndex(source);
    if (first < 0) return '';
    if (first > 0) repairs.push('prose_prefix_removed');
    source = source.slice(first);
    let quoted = false;
    let escaped = false;
    let normalized = '';
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (escaped) {
                normalized += char;
                escaped = false;
                continue;
            }
            if (char === '\\') {
                normalized += char;
                escaped = true;
                continue;
            }
            if (char === '"') {
                const next = source.slice(index + 1).match(/\S/u)?.[0] || '';
                if ([':', ',', '}', ']'].includes(next) || !next) {
                    normalized += char;
                    quoted = false;
                } else {
                    normalized += '\\"';
                    repairs.push('unescaped_quote_escaped');
                }
                continue;
            }
            if (char === '\n' || char === '\r' || char === '\t' || char.codePointAt(0) < 0x20) {
                normalized += char === '\t' ? '\\t' : '\\n';
                repairs.push('control_character_escaped');
                continue;
            }
            normalized += char;
            continue;
        }
        if (char === '"') {
            quoted = true;
            normalized += char;
        } else if (char === '：') {
            normalized += ':';
            repairs.push('fullwidth_colon_normalized');
        } else if (char === '，') {
            normalized += ',';
            repairs.push('fullwidth_comma_normalized');
        } else if (char.codePointAt(0) >= 0x20 || char === '\n' || char === '\r' || char === '\t') {
            normalized += char;
        } else {
            repairs.push('control_character_removed');
        }
    }
    normalized = normalized.replace(
        /([{,]\s*)([\p{L}\p{N}_$-]+)\s*:/gu,
        (_match, prefix, key) => {
            repairs.push('unquoted_key_quoted');
            return `${prefix}"${key}":`;
        },
    );
    normalized = normalized.replace(/\}\s*\{/gu, (_match) => {
        repairs.push('missing_object_comma_added');
        return '},{';
    });
    normalized = normalized.replace(/,\s*([}\]])/gu, (_match, close) => {
        repairs.push('trailing_comma_removed');
        return close;
    });
    const stack = [];
    quoted = false;
    escaped = false;
    let end = normalized.length;
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') quoted = true;
        else if (char === '{' || char === '[') stack.push(char);
        else if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (stack.at(-1) !== expected) return '';
            stack.pop();
            if (!stack.length) {
                end = index + 1;
                break;
            }
        }
    }
    normalized = normalized.slice(0, end);
    if (stack.length) {
        normalized += [...stack].reverse().map((open) => open === '{' ? '}' : ']').join('');
        repairs.push('closing_bracket_added');
    }
    return normalized;
}

function flattenCandidateSources(value, prefix = '', output = {}) {
    if (!isRecord(value)) return output;
    for (const [rawKey, entry] of Object.entries(value)) {
        const key = cleanText(rawKey, 240);
        if (!key) continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof entry === 'string') {
            // Model output is not a provenance authority. Confirmed and ticket
            // sources are restored only by the independently supplied fact
            // layers below; all candidate self-claims start as hypotheses.
            output[path] = 'hypothesis';
        } else if (isRecord(entry)) {
            flattenCandidateSources(entry, path, output);
        }
    }
    return output;
}

function candidateSection(raw, section) {
    if (isRecord(raw?.[section])) return raw[section];
    const match = Object.entries(raw || {}).find(([key, value]) => (
        looseProfileSection(key) === section && isRecord(value)
    ));
    return match?.[1] || {};
}

function normalizeCandidateArray(value, { text = false, limit = 24, itemLimit = 500 } = {}) {
    let entries;
    if (Array.isArray(value)) {
        entries = value;
    } else if (isRecord(value)) {
        const indexed = Object.entries(value);
        if (!indexed.length || indexed.some(([key]) => !/^\d+$/u.test(key))) return undefined;
        entries = indexed
            .sort(([left], [right]) => Number(left) - Number(right))
            .map(([, entry]) => entry);
    } else {
        return undefined;
    }
    return text ? meaningfulProfileList(entries, limit, itemLimit) : clone(entries);
}

// Do not let the transport parser reinterpret arbitrary quoted prose. Only
// canonical ProfileInsertCandidate container fields may unwrap a *complete*
// JSON string, and only when its resulting type is the declared one.
function parseStrictEmbeddedProfileContainer(value, expected, repairs = null) {
    const typeMatches = expected === 'array'
        ? Array.isArray(value)
        : isRecord(value);
    if (typeMatches || typeof value !== 'string') return value;
    const source = value.trim();
    if (!source || (source[0] !== '{' && source[0] !== '[')) return value;
    try {
        const parsed = JSON.parse(source);
        const parsedMatches = expected === 'array'
            ? Array.isArray(parsed)
            : isRecord(parsed);
        if (!parsedMatches) return value;
        repairs?.push('embedded_profile_container_parsed');
        return parsed;
    } catch {
        return value;
    }
}

function normalizeKnownProfileInsertContainers(raw, repairs = null) {
    if (!isRecord(raw)) return raw;
    const normalized = { ...raw };
    const objectFields = [
        'actorRef', 'actor_ref', 'candidateRef', 'candidate_ref', 'identity',
        'personality', 'relationships', 'goals', 'knowledge',
        'resourcesCapabilities', 'resources_capabilities', 'physiology', 'sources',
    ];
    for (const field of objectFields) {
        normalized[field] = parseStrictEmbeddedProfileContainer(
            normalized[field],
            'object',
            repairs,
        );
    }
    const normalizeArrays = (value, fields) => {
        if (!isRecord(value)) return value;
        const next = { ...value };
        for (const field of fields) {
            next[field] = parseStrictEmbeddedProfileContainer(next[field], 'array', repairs);
        }
        return next;
    };
    normalized.personality = normalizeArrays(normalized.personality, [
        'primaryDerivatives', 'baseDerivatives', 'accentDerivatives', 'othersVoices',
    ]);
    normalized.relationships = normalizeArrays(normalized.relationships, ['entries', 'patterns']);
    normalized.knowledge = normalizeArrays(normalized.knowledge, ['entries']);
    normalized.resourcesCapabilities = normalizeArrays(normalized.resourcesCapabilities, [
        'resources', 'capabilities',
    ]);
    normalized.resources_capabilities = normalizeArrays(normalized.resources_capabilities, [
        'resources', 'capabilities',
    ]);
    normalized.goals = normalizeArrays(normalized.goals, [
        'longTerm', 'pursuitPrinciples', 'current',
    ]);
    for (const strategyField of ['strategy', 'plan']) {
        const strategy = parseStrictEmbeddedProfileContainer(
            normalized.goals?.[strategyField],
            'object',
            repairs,
        );
        if (!isRecord(normalized.goals) || !isRecord(strategy)) continue;
        normalized.goals = {
            ...normalized.goals,
            [strategyField]: normalizeArrays(strategy, ['steps']),
        };
    }
    return normalized;
}

function normalizeProfileInsertCandidate(raw, repairs = null) {
    if (!isRecord(raw)) return null;
    const normalizedRaw = normalizeKnownProfileInsertContainers(raw, repairs);
    if (normalizedRaw.profileFormat === 'narrative-v1') {
        const rawRef = isRecord(normalizedRaw.actorRef) ? normalizedRaw.actorRef : {};
        const rawCandidateRef = isRecord(normalizedRaw.candidateRef)
            ? normalizedRaw.candidateRef
            : {};
        const rawSections = isRecord(normalizedRaw.narrativeSections)
            ? normalizedRaw.narrativeSections
            : {};
        return {
            profileFormat: 'narrative-v1',
            actorRef: {
                actorId: cleanText(rawRef.actorId || rawRef.actor_id, 120),
                name: cleanText(rawRef.name || rawCandidateRef.name, 160),
            },
            candidateRef: String(rawCandidateRef.name || '').trim().slice(0, 160)
                ? {
                    name: String(rawCandidateRef.name || '').trim().slice(0, 160),
                    sourceAnchor: String(rawCandidateRef.sourceAnchor || '').slice(0, 1200),
                }
                : null,
            // A loose-object transport can carry prose, never authority. The
            // local authority layer assigns any confirmed/ticket provenance.
            narrativeSections: normalizeNarrativeSections(rawSections, { modelAuthored: true }),
            sources: {},
            __narrativeIdentityFailure: cleanText(normalizedRaw.__narrativeIdentityFailure, 120),
            __narrativeParseFailure: cleanText(normalizedRaw.__narrativeParseFailure, 120),
        };
    }
    const rawRef = isRecord(normalizedRaw.actorRef) ? normalizedRaw.actorRef
        : isRecord(normalizedRaw.actor_ref) ? normalizedRaw.actor_ref
            : {};
    const rawCandidateRef = isRecord(normalizedRaw.candidateRef) ? normalizedRaw.candidateRef
        : isRecord(normalizedRaw.candidate_ref) ? normalizedRaw.candidate_ref
            : {};
    const candidateName = cleanText(
        rawCandidateRef.name || rawCandidateRef.displayName,
        160,
    );
    const sourceAnchor = String(
        rawCandidateRef.sourceAnchor || rawCandidateRef.source_anchor || '',
    ).slice(0, 1200);
    const identity = normalizeLooseProfileSection(normalizedRaw, 'identity');
    const personality = {
        ...normalizeLooseProfileSection(normalizedRaw, 'personality'),
        ...normalizeLooseProfileSection(normalizedRaw.identity, 'personality'),
    };
    const rawGoals = candidateSection(normalizedRaw, 'goals');
    const goals = normalizeLooseProfileSection(normalizedRaw, 'goals');
    const rawStrategy = isRecord(rawGoals.strategy) ? rawGoals.strategy
        : isRecord(rawGoals.plan) ? rawGoals.plan
            : {};
    const relationshipsRaw = normalizedRaw.relationships
        ?? candidateSection(normalizedRaw, 'relationships');
    const knowledgeRaw = normalizedRaw.knowledge ?? candidateSection(normalizedRaw, 'knowledge');
    const resourcesRaw = normalizedRaw.resourcesCapabilities
        ?? normalizedRaw.resources_capabilities
        ?? candidateSection(normalizedRaw, 'resourcesCapabilities');
    const physiologyRaw = candidateSection(normalizedRaw, 'physiology');
    const sources = flattenCandidateSources(normalizedRaw.sources);
    return {
        actorRef: {
            actorId: cleanText(rawRef.actorId || rawRef.actor_id || raw.actorId || raw.actor_id, 120),
            name: cleanText(
                rawRef.name
                    || rawRef.displayName
                    || (!candidateName ? normalizedRaw.name || normalizedRaw.姓名 : ''),
                160,
            ),
        },
        candidateRef: candidateName || sourceAnchor
            ? { name: candidateName, sourceAnchor }
            : null,
        identity,
        personality,
        relationships: Array.isArray(relationshipsRaw)
            ? { entries: clone(relationshipsRaw), patterns: [], coverageState: '' }
            : {
                entries: normalizeCandidateArray(relationshipsRaw?.entries),
                patterns: meaningfulProfileList(relationshipsRaw?.patterns, 12, 500),
                coverageState: cleanText(relationshipsRaw?.coverageState, 80),
            },
        goals: {
            longTerm: meaningfulProfileList(
                goals.longTerm ?? rawGoals.longTerm ?? raw.longTermGoals,
                12,
                500,
            ),
            pursuitPrinciples: meaningfulProfileList(
                goals.pursuitPrinciples ?? rawGoals.pursuitPrinciples ?? rawGoals.current,
                8,
                500,
            ),
            strategy: {
                summary: meaningfulProfileText(
                    goals.strategy?.summary ?? rawStrategy.summary,
                    700,
                ),
                steps: meaningfulProfileList(
                    goals.strategy?.steps ?? rawStrategy.steps,
                    12,
                    500,
                ),
                reviewConditions: meaningfulProfileText(
                    goals.strategy?.reviewConditions
                        ?? rawStrategy.reviewConditions
                        ?? rawStrategy.nextWindow,
                    400,
                ),
            },
        },
        knowledge: Array.isArray(knowledgeRaw)
            ? { entries: clone(knowledgeRaw), unknownRemainsUnknown: true, coverageState: '' }
            : {
                entries: normalizeCandidateArray(knowledgeRaw?.entries),
                unknownRemainsUnknown: knowledgeRaw?.unknownRemainsUnknown === true,
                coverageState: cleanText(knowledgeRaw?.coverageState, 80),
            },
        resourcesCapabilities: isRecord(resourcesRaw) ? {
            resources: normalizeCandidateArray(resourcesRaw.resources),
            capabilities: normalizeCandidateArray(resourcesRaw.capabilities, {
                text: true,
                limit: 24,
                itemLimit: 240,
            }),
            noUnconfirmedAbilityGranted: resourcesRaw.noUnconfirmedAbilityGranted === true,
            coverageState: cleanText(resourcesRaw.coverageState, 80),
        } : {
            resources: undefined,
            capabilities: undefined,
            noUnconfirmedAbilityGranted: false,
            coverageState: '',
        },
        physiology: Object.keys(physiologyRaw).length
            ? normalizePhysiology({ ...physiologyRaw, enabled: true, adultEnabled: true })
            : null,
        sources,
    };
}

function getCandidatePath(value, path) {
    return path.split('.').reduce((cursor, key) => (
        cursor && typeof cursor === 'object' ? cursor[key] : undefined
    ), value);
}

function setCandidatePath(value, path, nextValue) {
    const parts = path.split('.');
    let cursor = value;
    for (const part of parts.slice(0, -1)) {
        if (!isRecord(cursor[part])) cursor[part] = {};
        cursor = cursor[part];
    }
    cursor[parts.at(-1)] = clone(nextValue);
}

function candidateLeafEntries(value, prefix = '') {
    if (Array.isArray(value) || !isRecord(value)) return prefix ? [[prefix, value]] : [];
    return Object.entries(value).flatMap(([key, entry]) => candidateLeafEntries(
        entry,
        prefix ? `${prefix}.${key}` : key,
    ));
}

function reconcileProfileFactLayers(candidate, context = {}) {
    const resolved = clone(candidate);
    const resolutions = [];
    const explicitLayers = isRecord(context.factLayers) ? context.factLayers : {};
    for (const layer of PROFILE_INSERT_SOURCE_LAYERS.slice(1)) {
        const facts = explicitLayers[layer];
        if (!isRecord(facts)) continue;
        for (const [path, value] of candidateLeafEntries(facts)) {
            if (path === 'actorRef' || path.startsWith('actorRef.')) continue;
            const before = getCandidatePath(resolved, path);
            if (JSON.stringify(before) !== JSON.stringify(value)) {
                resolutions.push({ path, keptLayer: layer, discardedValue: clone(before) });
            }
            setCandidatePath(resolved, path, value);
            resolved.sources[path] = layer === 'characterCreationTicket'
                ? 'designed_seed'
                : 'confirmed';
        }
    }
    return { candidate: resolved, resolutions };
}

function sourceAtPath(candidate, path) {
    let cursor = path;
    while (cursor) {
        if (SOURCE_SET.has(candidate?.sources?.[cursor])) return candidate.sources[cursor];
        cursor = cursor.includes('.') ? cursor.slice(0, cursor.lastIndexOf('.')) : '';
    }
    return '';
}

const INSERT_IDENTITY_FIELDS = Object.freeze([
    'role', 'species', 'gender', 'age', 'briefIntro', 'appearance', 'identityText',
    'relationState', 'attitudeToProtagonist', 'pastExperience',
]);
const INSERT_PERSONALITY_TEXT_FIELDS = Object.freeze([
    'biography', 'primaryColor', 'primarySentence', 'baseColor', 'baseSentence',
    'accentColor', 'accentSentence', 'authorVoice',
]);
const INSERT_PERSONALITY_LIST_FIELDS = Object.freeze({
    primaryDerivatives: 2,
    baseDerivatives: 2,
    accentDerivatives: 2,
    othersVoices: 4,
});

function profileTextLength(value) {
    return Array.from(meaningfulProfileText(value, 4000)).length;
}

function profileTextMeetsQuality(candidate, path, minimum, maximum = Infinity) {
    const length = profileTextLength(getCandidatePath(candidate, path));
    if (!length) return false;
    if (sourceAtPath(candidate, path) === 'confirmed') return true;
    return length >= minimum && length <= maximum;
}

function repairProfileCandidateMetadata(candidate, context = {}, {
    allowActorRefFill = false,
} = {}) {
    const repaired = clone(candidate);
    const repairs = [];
    if (repaired?.profileFormat === 'narrative-v1') {
        if (!isRecord(repaired.actorRef)) repaired.actorRef = {};
        if (allowActorRefFill && !cleanText(repaired.actorRef.actorId, 120)) {
            repaired.actorRef.actorId = cleanText(context?.actorRef?.actorId || context?.actorId, 120);
            if (repaired.actorRef.actorId) repairs.push('actor_ref_id_filled_from_target');
        }
        if (allowActorRefFill && !cleanText(repaired.actorRef.name, 160)) {
            repaired.actorRef.name = cleanText(context?.actorRef?.name || context?.name, 160);
            if (repaired.actorRef.name) repairs.push('actor_ref_name_filled_from_target');
        }
        repaired.narrativeSections = normalizeNarrativeSections(repaired.narrativeSections);
        return { candidate: repaired, repairs };
    }
    if (!isRecord(repaired.actorRef)) repaired.actorRef = {};
    if (allowActorRefFill && !cleanText(repaired.actorRef.actorId, 120)) {
        repaired.actorRef.actorId = cleanText(
            context?.actorRef?.actorId || context?.actorId,
            120,
        );
        if (repaired.actorRef.actorId) repairs.push('actor_ref_id_filled_from_target');
    }
    if (allowActorRefFill && !cleanText(repaired.actorRef.name, 160)) {
        repaired.actorRef.name = cleanText(context?.actorRef?.name || context?.name, 160);
        if (repaired.actorRef.name) repairs.push('actor_ref_name_filled_from_target');
    }
    if (!isRecord(repaired.sources)) repaired.sources = {};
    if (!isRecord(repaired.relationships)) repaired.relationships = {};
    if (!isRecord(repaired.knowledge)) repaired.knowledge = {};
    if (!isRecord(repaired.resourcesCapabilities)) repaired.resourcesCapabilities = {};
    const coverageRepairs = [
        ['relationships', 'entries', 'confirmed_entries', 'no_confirmed_relationships'],
        ['knowledge', 'entries', 'confirmed_entries', 'no_confirmed_knowledge'],
        [
            'resourcesCapabilities',
            'resources',
            'confirmed_entries',
            'no_confirmed_resources_or_capabilities',
        ],
    ];
    for (const [section, field, confirmedState, emptyState] of coverageRepairs) {
        if (cleanText(repaired[section]?.coverageState, 80)) continue;
        const path = `${section}.${field}`;
        repaired[section].coverageState = sourceAtPath(repaired, path) === 'confirmed'
            ? confirmedState
            : emptyState;
        repairs.push(`${section}_coverage_state_normalized`);
    }
    if (repaired.knowledge.unknownRemainsUnknown !== true) {
        repaired.knowledge.unknownRemainsUnknown = true;
        repairs.push('knowledge_unknown_guard_normalized');
    }
    if (repaired.resourcesCapabilities.noUnconfirmedAbilityGranted !== true) {
        repaired.resourcesCapabilities.noUnconfirmedAbilityGranted = true;
        repairs.push('capability_guard_normalized');
    }
    const sourcePaths = [
        ...INSERT_IDENTITY_FIELDS.map((field) => `identity.${field}`),
        ...INSERT_PERSONALITY_TEXT_FIELDS.map((field) => `personality.${field}`),
        ...Object.keys(INSERT_PERSONALITY_LIST_FIELDS)
            .map((field) => `personality.${field}`),
        'relationships.entries',
        'relationships.patterns',
        'goals.longTerm',
        'goals.pursuitPrinciples',
        'goals.strategy.summary',
        'goals.strategy.steps',
        'goals.strategy.reviewConditions',
        'knowledge.entries',
        'resourcesCapabilities.resources',
        'resourcesCapabilities.capabilities',
        ...(modeOf(context?.completionMode) === 'full_adult'
            ? PHYSIOLOGY_CONTENT_FIELDS.map((field) => `physiology.${field}`)
            : []),
    ];
    for (const path of sourcePaths) {
        if (sourceAtPath(repaired, path)) continue;
        const value = getCandidatePath(repaired, path);
        const present = Array.isArray(value)
            ? value.length > 0
            : isRecord(value)
                ? Object.keys(value).length > 0
                : Boolean(meaningfulProfileText(value, 4000));
        if (!present) continue;
        repaired.sources[path] = 'hypothesis';
        repairs.push(`source_inferred:${path}`);
    }
    return { candidate: repaired, repairs };
}

function existingProfileCandidateFactLayers(previousProfile) {
    if (!previousProfile || typeof previousProfile !== 'object') return {};
    const profile = normalizeActorProfileV6(previousProfile, {
        actorId: previousProfile.actorId,
        name: previousProfile.name,
        mode: previousProfile.completionMode,
    });
    const layers = { characterCreationTicket: {}, confirmedProfile: {} };
    const mappings = [
        ...INSERT_IDENTITY_FIELDS.map((field) => ['identity', field, `identity.${field}`]),
        ...INSERT_PERSONALITY_TEXT_FIELDS.map((field) => [
            'personality', field, `personality.${field}`,
        ]),
        ...Object.keys(INSERT_PERSONALITY_LIST_FIELDS).map((field) => [
            'personality', field, `personality.${field}`,
        ]),
        ...['entries', 'patterns', 'coverageState'].map((field) => [
            'relationships', field, `relationships.${field}`,
        ]),
        ['goals', 'longTerm', 'goals.longTerm'],
        ['goals', 'current', 'goals.pursuitPrinciples'],
        ['goals', 'plan.summary', 'goals.strategy.summary'],
        ['goals', 'plan.steps', 'goals.strategy.steps'],
        ['goals', 'nextWindow', 'goals.strategy.reviewConditions'],
        ...['entries', 'unknownRemainsUnknown', 'coverageState'].map((field) => [
            'knowledge', field, `knowledge.${field}`,
        ]),
        ...['resources', 'capabilities', 'noUnconfirmedAbilityGranted', 'coverageState']
            .map((field) => [
                'resourcesCapabilities', field, `resourcesCapabilities.${field}`,
            ]),
        ...PHYSIOLOGY_CONTENT_FIELDS.map((field) => [
            'physiology', field, `physiology.${field}`,
        ]),
    ];
    for (const [module, modulePath, candidatePath] of mappings) {
        const value = getPath(profile, ['modules', module, 'data', ...modulePath.split('.')]);
        const meaningful = (Array.isArray(value) && value.length > 0)
            || value === true
            || (typeof value === 'string' && Boolean(meaningfulProfileText(value, 4000)))
            || (isRecord(value) && Object.keys(value).length > 0);
        if (!meaningful) continue;
        const fieldPath = `modules.${module}.data.${modulePath}`;
        const fieldSource = sourceOf(
            profile.fieldSources[fieldPath],
            profile.modules[module]?.source || 'hypothesis',
        );
        const layer = fieldSource === 'confirmed'
            ? 'confirmedProfile'
            : fieldSource === 'designed_seed'
                ? 'characterCreationTicket'
                : '';
        if (layer) setCandidatePath(layers[layer], candidatePath, value);
    }
    return layers;
}

function profileFactLayersForContext(context = {}) {
    const merged = existingProfileCandidateFactLayers(context.previousProfile);
    const explicit = isRecord(context.factLayers) ? context.factLayers : {};
    for (const layer of PROFILE_INSERT_SOURCE_LAYERS.slice(1)) {
        if (!isRecord(explicit[layer])) continue;
        if (!isRecord(merged[layer])) merged[layer] = {};
        for (const [path, value] of candidateLeafEntries(explicit[layer])) {
            setCandidatePath(merged[layer], path, value);
        }
    }
    return merged;
}

export function validateActorProfileInsertCandidate(candidate, context = {}) {
    if (!isRecord(candidate)) {
        return {
            ok: false,
            candidate: null,
            repairs: [],
            errorCode: 'actor_profile.format_unrecoverable',
            missingFields: [],
            resolutions: [],
        };
    }
    const sourceCandidate = clone(candidate);
    if (
        context?.deferTicketSourceNormalization !== true
        && !normalizeActorProfileDesignRolls(context?.designRolls)
    ) {
        sourceCandidate.sources = Object.fromEntries(Object.entries(
            sourceCandidate.sources || {},
        ).map(([path, source]) => [
            path,
            source === 'designed_seed' ? 'hypothesis' : source,
        ]));
    }
    const expectedActorId = cleanText(
        context?.actorRef?.actorId || context?.actorId,
        120,
    );
    const actualActorId = cleanText(sourceCandidate.actorRef?.actorId, 120);
    const actualName = cleanText(sourceCandidate.actorRef?.name, 160);
    const expectedName = cleanText(context?.actorRef?.name || context?.name, 160);
    if (
        (expectedActorId && actualActorId && expectedActorId !== actualActorId)
        || (expectedName && actualName && expectedName !== actualName)
    ) {
        return {
            ok: false,
            candidate: null,
            repairs: [],
            errorCode: 'actor_profile.actor_ref_mismatch',
            missingFields: [],
            resolutions: [],
        };
    }
    if (sourceCandidate.profileFormat === 'narrative-v1') {
        const missingFields = [];
        if (sourceCandidate.__narrativeParseFailure) {
            missingFields.push(sourceCandidate.__narrativeParseFailure);
        }
        if (sourceCandidate.__narrativeIdentityFailure) {
            missingFields.push(sourceCandidate.__narrativeIdentityFailure);
        }
        if (!actualActorId) missingFields.push('actorRef.actorId');
        if (!actualName) missingFields.push('actorRef.name');
        const requiredNarrativeKeys = ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.filter((key) => (
            key !== 'physiology' || modeOf(context.completionMode) === 'full_adult'
        ));
        for (const key of requiredNarrativeKeys) {
            if (!narrativeText(sourceCandidate.narrativeSections?.[key]?.text, 4000)) {
                missingFields.push(`narrativeSections.${key}`);
            }
        }
        return {
            ok: missingFields.length === 0,
            candidate: missingFields.length ? null : {
                ...sourceCandidate,
                narrativeSections: normalizeNarrativeSections(sourceCandidate.narrativeSections),
            },
            repairs: [],
            errorCode: missingFields.length ? 'actor_profile.schema_incomplete' : '',
            missingFields,
            resolutions: [],
        };
    }
    if (context.__candidateOnly !== true) {
        const candidateOnly = validateActorProfileInsertCandidate(sourceCandidate, {
            actorRef: context.actorRef,
            actorId: context.actorId,
            name: context.name,
            completionMode: context.completionMode,
            __candidateOnly: true,
        });
        if (!candidateOnly.ok) return candidateOnly;
    }
    const reconciled = context.__candidateOnly === true
        ? { candidate: sourceCandidate, resolutions: [] }
        : reconcileProfileFactLayers(sourceCandidate, {
            ...context,
            factLayers: profileFactLayersForContext(context),
        });
    const value = reconciled.candidate;
    const missing = [];
    if (!actualActorId) missing.push('actorRef.actorId');
    if (!actualName) missing.push('actorRef.name');
    for (const field of INSERT_IDENTITY_FIELDS) {
        if (!meaningfulProfileText(value.identity?.[field], 4000)) missing.push(`identity.${field}`);
    }
    for (const [field, minimum] of [
        ['briefIntro', 12],
        ['appearance', 20],
        ['identityText', 16],
        ['pastExperience', 30],
    ]) {
        if (!profileTextMeetsQuality(value, `identity.${field}`, minimum)) {
            missing.push(`identity.${field}:quality`);
        }
    }
    for (const field of INSERT_PERSONALITY_TEXT_FIELDS) {
        if (!meaningfulProfileText(value.personality?.[field], 4000)) {
            missing.push(`personality.${field}`);
        }
    }
    for (const [field, minimum] of Object.entries(INSERT_PERSONALITY_LIST_FIELDS)) {
        const items = meaningfulProfileList(value.personality?.[field], 12, 700);
        const itemQuality = sourceAtPath(value, `personality.${field}`) === 'confirmed'
            ? true
            : field === 'othersVoices'
            ? items.every((item) => profileTextLength(item) >= 12)
            : items.every((item) => {
                const length = profileTextLength(item);
                return length >= 30 && length <= 100;
            });
        if (items.length < minimum || !itemQuality) {
            missing.push(`personality.${field}`);
        }
    }
    for (const [field, minimum, maximum] of [
        ['biography', 80, Infinity],
        ['primarySentence', 16, Infinity],
        ['baseSentence', 16, Infinity],
        ['accentSentence', 16, Infinity],
        ['authorVoice', 12, 200],
    ]) {
        if (!profileTextMeetsQuality(value, `personality.${field}`, minimum, maximum)) {
            missing.push(`personality.${field}:quality`);
        }
    }
    if (!meaningfulProfileEntries(value.relationships?.entries).length) {
        missing.push('relationships.entries');
    }
    if (!meaningfulProfileList(value.relationships?.patterns, 12, 500).length) {
        missing.push('relationships.patterns');
    }
    if (!['confirmed_entries', 'no_confirmed_relationships'].includes(
        value.relationships?.coverageState,
    )) missing.push('relationships.coverageState');
    if (!meaningfulProfileList(value.goals?.longTerm, 12, 500).length) {
        missing.push('goals.longTerm');
    }
    if (!meaningfulProfileList(value.goals?.pursuitPrinciples, 8, 500).length) {
        missing.push('goals.pursuitPrinciples');
    }
    if (!meaningfulProfileText(value.goals?.strategy?.summary, 700)) {
        missing.push('goals.strategy.summary');
    }
    if (!meaningfulProfileList(value.goals?.strategy?.steps, 12, 500).length) {
        missing.push('goals.strategy.steps');
    }
    if (!meaningfulProfileText(value.goals?.strategy?.reviewConditions, 400)) {
        missing.push('goals.strategy.reviewConditions');
    }
    if (!meaningfulProfileEntries(value.knowledge?.entries).length) {
        missing.push('knowledge.entries');
    }
    if (value.knowledge?.unknownRemainsUnknown !== true) {
        missing.push('knowledge.unknownRemainsUnknown');
    }
    if (!['confirmed_entries', 'no_confirmed_knowledge'].includes(
        value.knowledge?.coverageState,
    )) missing.push('knowledge.coverageState');
    if (!meaningfulProfileEntries(value.resourcesCapabilities?.resources).length) {
        missing.push('resourcesCapabilities.resources');
    }
    if (!meaningfulProfileList(value.resourcesCapabilities?.capabilities, 24, 240).length) {
        missing.push('resourcesCapabilities.capabilities');
    }
    if (value.resourcesCapabilities?.noUnconfirmedAbilityGranted !== true) {
        missing.push('resourcesCapabilities.noUnconfirmedAbilityGranted');
    }
    if (!['confirmed_entries', 'no_confirmed_resources_or_capabilities'].includes(
        value.resourcesCapabilities?.coverageState,
    )) missing.push('resourcesCapabilities.coverageState');
    if (modeOf(context?.completionMode) === 'full_adult') {
        if (!isRecord(value.physiology)) missing.push('physiology');
        for (const field of PHYSIOLOGY_CONTENT_FIELDS) {
            const text = meaningfulProfileText(value.physiology?.[field], 4000);
            if (
                !text
                || (/^不适用[。.!！]?$/u.test(text))
                || !profileTextMeetsQuality(value, `physiology.${field}`, 8)
            ) missing.push(`physiology.${field}`);
        }
    }
    const sourcePaths = [
        ...INSERT_IDENTITY_FIELDS.map((field) => `identity.${field}`),
        ...INSERT_PERSONALITY_TEXT_FIELDS.map((field) => `personality.${field}`),
        ...Object.keys(INSERT_PERSONALITY_LIST_FIELDS).map((field) => `personality.${field}`),
        'relationships.entries',
        'relationships.patterns',
        'goals.longTerm',
        'goals.pursuitPrinciples',
        'goals.strategy.summary',
        'goals.strategy.steps',
        'goals.strategy.reviewConditions',
        'knowledge.entries',
        'resourcesCapabilities.resources',
        'resourcesCapabilities.capabilities',
        ...(modeOf(context?.completionMode) === 'full_adult'
            ? PHYSIOLOGY_CONTENT_FIELDS.map((field) => `physiology.${field}`)
            : []),
    ];
    for (const path of sourcePaths) {
        if (!sourceAtPath(value, path)) missing.push(`sources.${path}`);
    }
    const uniqueMissing = [...new Set(missing)];
    return {
        ok: uniqueMissing.length === 0,
        candidate: uniqueMissing.length ? null : value,
        repairs: [],
        errorCode: uniqueMissing.length ? 'actor_profile.schema_incomplete' : '',
        missingFields: uniqueMissing,
        resolutions: reconciled.resolutions,
    };
}

export function repairActorProfileInsertLocally(output, context = {}) {
    const repairs = [];
    let parsed = firstJsonObject(output);
    if (!parsed) {
        const repairedText = normalizeJsonLikeText(output, repairs);
        try {
            parsed = repairedText ? JSON.parse(repairedText) : null;
        } catch {
            parsed = null;
        }
    }
    if (!parsed) parsed = parseLooseProfileTable(output);
    const objects = profileObjectsFromParsed(parsed);
    if (objects.length !== 1) {
        return {
            ok: false,
            candidate: null,
            repairs: [...new Set(repairs)],
            errorCode: 'actor_profile.format_unrecoverable',
            missingFields: [],
        };
    }
    const candidate = normalizeProfileInsertCandidate(objects[0], repairs);
    if (!candidate) {
        return {
            ok: false,
            candidate: null,
            repairs: [...new Set(repairs)],
            errorCode: 'actor_profile.format_unrecoverable',
            missingFields: [],
        };
    }
    const local = repairProfileCandidateMetadata(candidate, context, {
        allowActorRefFill: true,
    });
    const validation = validateActorProfileInsertCandidate(local.candidate, context);
    return {
        ...validation,
        repairs: [...new Set([
            ...repairs,
            ...local.repairs,
            ...(validation.repairs || []),
        ])],
    };
}

export function parseActorProfileCompletionOutput(output, options = {}) {
    return repairActorProfileInsertLocally(output, options.candidates?.[0] || options);
}

function balancedJsonSegments(text) {
    const source = normalizeProfileJsonSurface(text);
    const segments = [];
    let start = -1;
    let quote = '';
    let escaped = false;
    const stack = [];
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || (char === "'" && !isInWordApostrophe(source, index))) {
            quote = char;
            continue;
        }
        if (char === '{' || char === '[') {
            if (start < 0) start = index;
            stack.push(char);
            continue;
        }
        if ((char === '}' || char === ']') && start >= 0) {
            const expected = char === '}' ? '{' : '[';
            if (stack.at(-1) !== expected) {
                start = -1;
                stack.length = 0;
                continue;
            }
            stack.pop();
            if (!stack.length) {
                segments.push(source.slice(start, index + 1));
                start = -1;
            }
        }
    }
    if (start >= 0) segments.push(source.slice(start));
    return segments;
}

// Faithful local translation of shujuku's splitTopLevelSegments_ACU row
// salvage: split only at a delimiter outside strings and nested structures,
// then sanitize/parse each row independently so a bad row cannot erase peers.
function splitTopLevelProfileSegments(text, delimiter = ',') {
    const segments = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;
    const source = String(text || '');
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            current += char;
            if (quote) escaped = true;
            continue;
        }
        if (quote) {
            current += char;
            if (char === quote) quote = '';
            continue;
        }
        if (char === '"' || (char === "'" && !isInWordApostrophe(source, index))) {
            current += char;
            quote = char;
            continue;
        }
        if (!quote) {
            if (char === '{') braceDepth += 1;
            else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
            else if (char === '[') bracketDepth += 1;
            else if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            else if (char === '(') parenDepth += 1;
            else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
            else if (
                char === delimiter
                && braceDepth === 0
                && bracketDepth === 0
                && parenDepth === 0
            ) {
                if (current.trim()) segments.push(current.trim());
                current = '';
                continue;
            }
        }
        current += char;
    }
    if (current.trim()) segments.push(current.trim());
    return segments;
}

function salvageProfileArrayRows(output, repairs) {
    const source = normalizeProfileJsonSurface(output, repairs);
    const open = firstUnquotedProfileStructureIndex(source);
    if (open < 0 || source[open] !== '[') return [];
    const trimmedEnd = source.trimEnd();
    const close = trimmedEnd.endsWith(']') ? source.lastIndexOf(']') : -1;
    const body = source.slice(open + 1, close > open ? close : source.length);
    const rows = splitTopLevelProfileSegments(body, ',');
    if (rows.length < 2) return [];
    const objects = [];
    for (const row of rows) {
        const rowRepairs = [];
        let parsed = null;
        try {
            parsed = JSON.parse(row);
        } catch {
            const normalized = normalizeJsonLikeText(row, rowRepairs);
            try {
                parsed = normalized ? JSON.parse(normalized) : null;
            } catch {
                parsed = null;
            }
        }
        if (!isRecord(parsed)) continue;
        objects.push(parsed);
        repairs.push('array_row_salvaged', ...rowRepairs);
    }
    return objects;
}

function parseProfileObjectsLocally(output) {
    const repairs = [];
    const source = String(output || '').trim();
    const parsedValues = [];
    let explicitEmpty = false;
    const addParsed = (value) => {
        if (Array.isArray(value) && value.length === 0) explicitEmpty = true;
        if (
            value
            && typeof value === 'object'
            && !Array.isArray(value)
            && ['actorProfiles', 'actor_profiles', 'profiles', '人物档案', '角色档案']
                .some((key) => Array.isArray(value[key]) && value[key].length === 0)
        ) explicitEmpty = true;
        for (const object of profileObjectsFromParsed(value)) {
            if (isRecord(object)) parsedValues.push(object);
        }
    };
    try {
        const parsed = JSON.parse(source);
        explicitEmpty = Array.isArray(parsed) && parsed.length === 0;
        addParsed(parsed);
    } catch {
        const repaired = normalizeJsonLikeText(source, repairs);
        if (repaired) {
            try {
                const parsed = JSON.parse(repaired);
                explicitEmpty = Array.isArray(parsed) && parsed.length === 0;
                addParsed(parsed);
            } catch {
                // Continue with independent balanced values / JSONL so one bad
                // row cannot erase otherwise usable rows.
            }
        }
    }
    if (!parsedValues.length) {
        const loose = parseLooseProfileJsonStructure(source, repairs);
        if (loose !== null) addParsed(loose);
    }
    if (!parsedValues.length) {
        for (const segment of balancedJsonSegments(source)) {
            try {
                addParsed(JSON.parse(segment));
                continue;
            } catch {
                const segmentRepairs = [];
                const repaired = normalizeJsonLikeText(segment, segmentRepairs);
                try {
                    if (repaired) {
                        addParsed(JSON.parse(repaired));
                        repairs.push(...segmentRepairs);
                    }
                } catch {
                    // This row stays absent; expected ActorRefs are reported as
                    // missing below and may receive the one subset replacement.
                }
            }
        }
    }
    if (!parsedValues.length) {
        parsedValues.push(...salvageProfileArrayRows(source, repairs));
    }
    if (!parsedValues.length) {
        const loose = parseLooseProfileTable(source);
        if (isRecord(loose)) {
            parsedValues.push(loose);
            repairs.push('loose_profile_table_parsed');
        }
    }
    const repairLabels = [...new Set(repairs)]
        .filter((label) => new Set([
            'prose_prefix_removed',
            'unescaped_quote_escaped',
            'control_character_escaped',
            'control_character_removed',
            'fullwidth_colon_normalized',
            'fullwidth_comma_normalized',
            'fullwidth_quote_normalized',
            'unquoted_key_quoted',
            'missing_object_comma_added',
            'trailing_comma_removed',
            'closing_bracket_added',
            'array_row_salvaged',
            'loose_profile_table_parsed',
            'loose_single_quotes_normalized',
            'loose_missing_property_comma_added',
            'embedded_profile_container_parsed',
            'loose_nested_structure_parsed',
        ]).has(label))
        .slice(0, 12);
    const emptyOutput = source.length === 0;
    const rootType = emptyOutput
        ? 'empty'
        : source.startsWith('[')
            ? 'array'
            : source.startsWith('{')
                ? 'object'
                : 'other';
    return {
        objects: parsedValues,
        repairs: [...new Set(repairs)],
        explicitEmpty,
        batchMeta: {
            rootType,
            parsedRowCount: Math.min(128, parsedValues.length),
            explicitEmpty,
            emptyOutput,
            formatUnrecoverable: !emptyOutput && parsedValues.length === 0 && !explicitEmpty,
            repairLabels,
        },
    };
}

const DISCOVERY_NAME_VAGUE_TERMS = new Set([
    '他', '她', '它', '牠', '他们', '她们', '它们', '你', '你们', '您', '我', '我们',
    '咱', '咱们', '俺', '俺们', '其', '其等', '之', '自己', '本人', '人家',
    '对方', '旁人', '别人', '他人', '某人', '某某', '某甲', '某乙', '谁', '谁人', '何人',
    '大家', '众人', '人们', '群众', '群体', '各位', '诸位',
    '这人', '那人', '此人', '其人', '这个人', '那个人', '这个', '那个', '这位', '那位',
    '男人', '女人', '男子', '女子', '男孩', '女孩', '男生', '女生', '男士', '女士',
    '老人', '老者', '老头', '老翁', '老妇', '老妪', '少年', '少女', '小孩', '孩子',
    '孩童', '儿童', '婴儿', '青年', '中年人', '成年人',
    '家伙', '角色', '人物', '路人', '陌生人', '过客', '行人', '无名氏',
    'i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'her', 'it', 'they', 'them',
    'someone', 'somebody', 'anyone', 'anybody', 'everyone', 'everybody', 'nobody', 'noone',
    'person', 'people', 'man', 'woman', 'boy', 'girl', 'guy', 'gal', 'lady', 'gentleman',
    'stranger', 'passerby', 'pedestrian', 'bystander', 'character', 'figure',
    'someoneelse', 'somebodyelse', 'other', 'others', 'another', 'thisone', 'thatone',
    'theman', 'thewoman', 'theboy', 'thegirl', 'theperson', 'thestranger',
    'aman', 'awoman', 'aboy', 'agirl', 'aperson',
]);

export function isVagueActorProfileDiscoveryName(name) {
    const compact = String(name || '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
    if (!compact) return true;
    return DISCOVERY_NAME_VAGUE_TERMS.has(compact);
}

// Recover a specific label only when the same evidence unit explicitly
// supplies one. A bare role word remains invalid; this never invents a name
// from an adjective, occupation, or otherwise free prose.
export function recoverActorProfileDiscoveryNameFromEvidence(name, sourceAnchor) {
    const original = String(name || '').trim().slice(0, 160);
    if (!isVagueActorProfileDiscoveryName(original)) return '';
    const anchor = String(sourceAnchor || '').slice(0, 1200);
    if (!anchor) return '';
    const candidates = new Set();
    const add = (value) => {
        const label = String(value || '').trim().replace(/[\s\u3000]+/gu, ' ');
        if (!label || label.length > 80 || isVagueActorProfileDiscoveryName(label)) return;
        if (/^[\p{P}\p{S}\d\s]+$/u.test(label)) return;
        if (anchor.includes(label)) candidates.add(label);
    };
    for (const pattern of [
        /"([^"\r\n]{2,80})"/gu,
        /“([^”\r\n]{2,80})”/gu,
        /「([^」\r\n]{2,80})」/gu,
        /『([^』\r\n]{2,80})』/gu,
        /《([^》\r\n]{2,80})》/gu,
        /【([^】\r\n]{2,80})】/gu,
    ]) {
        for (const match of anchor.matchAll(pattern)) add(match[1]);
    }
    for (const match of anchor.matchAll(/(?:名为|名叫|叫作|叫做|称作|称为|自称)\s*[“"「『《【]?([^，。！？；：:\n]{2,80}?)[”"」』》】]?(?=[，。！？；：:\n]|$)/gu)) {
        add(String(match[1]).split(/[”"」』》】]/u)[0].split(/的/u)[0]);
    }
    return candidates.size === 1 ? [...candidates][0] : '';
}

export function validateActorProfileDiscoveryAnchor(candidateRef, acceptedNarrative) {
    const name = String(candidateRef?.name || '').trim().slice(0, 160);
    const sourceAnchor = String(candidateRef?.sourceAnchor || '').slice(0, 1200);
    const narrative = String(acceptedNarrative || '');
    const failure = (reason) => ({
        ok: false,
        reason,
        retryable: true,
        offset: -1,
        name,
        sourceAnchor,
    });
    if (!name) return failure('actor_profile.discovery_name_missing');
    if (isVagueActorProfileDiscoveryName(name)) return failure('actor_profile.discovery_name_vague');
    if (!sourceAnchor) return failure('actor_profile.discovery_anchor_missing');
    if (!sourceAnchor.includes(name)) {
        return failure('actor_profile.discovery_name_not_in_anchor');
    }
    if (narrative.indexOf(sourceAnchor) < 0) {
        return failure('actor_profile.discovery_anchor_not_in_narrative');
    }
    const explicitOffset = candidateRef?.sourceOffset;
    let offset = -1;
    if (Number.isInteger(explicitOffset) && explicitOffset >= 0) {
        const explicitUnitOffset = candidateRef?.sourceUnitOffset;
        const hasExplicitUnitOffset = Number.isInteger(explicitUnitOffset)
            && explicitUnitOffset >= 0;
        const anchorStarts = hasExplicitUnitOffset
            ? (narrative.slice(explicitUnitOffset, explicitUnitOffset + sourceAnchor.length)
                === sourceAnchor ? [explicitUnitOffset] : [])
            : [];
        if (!hasExplicitUnitOffset) {
            let from = 0;
            while (from <= narrative.length - sourceAnchor.length) {
                const anchorStart = narrative.indexOf(sourceAnchor, from);
                if (anchorStart < 0) break;
                anchorStarts.push(anchorStart);
                from = anchorStart + Math.max(1, sourceAnchor.length);
            }
        }
        const insideTrustedAnchor = anchorStarts.some((anchorStart) => (
            explicitOffset >= anchorStart
            && explicitOffset + name.length <= anchorStart + sourceAnchor.length
        ));
        if (
            narrative.slice(explicitOffset, explicitOffset + name.length) !== name
            || !insideTrustedAnchor
        ) return failure('actor_profile.discovery_source_offset_invalid');
        offset = explicitOffset;
    } else {
        // Legacy callers without an authority-bound offset keep first-literal
        // ordering. New identity batches provide the verified independent
        // occurrence so a shorter key nested in a longer key cannot steal it.
        offset = narrative.indexOf(name);
    }
    if (offset < 0) return failure('actor_profile.discovery_anchor_not_in_narrative');
    return {
        ok: true,
        reason: '',
        retryable: false,
        offset,
        name,
        sourceAnchor,
    };
}

const NARRATIVE_SECTION_HEADER_KEYS = Object.freeze(Object.fromEntries(
    ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.map((key) => [
        ACTOR_PROFILE_NARRATIVE_TITLES[key],
        key,
    ]),
));

// These are semantic aliases, not a second schema.  The model may use a
// familiar natural heading; storage still normalizes it into the one dossier
// shape owned by the ledger.
const NARRATIVE_SECTION_HEADER_ALIASES = Object.freeze({
    '\u8eab\u4efd': 'person', '\u57fa\u672c\u8d44\u6599': 'person', '\u5916\u8c8c': 'person',
    '\u751f\u7406': 'physiology', '\u4f53\u5f81': 'physiology',
    '\u6027\u683c': 'personality', '\u4e2a\u6027': 'personality', '\u5e95\u8272': 'personality',
    '\u80cc\u666f': 'history', '\u5c65\u5386': 'history', '\u7ecf\u5386': 'history',
    '\u73b0\u72b6': 'currentState', '\u8fd1\u51b5': 'currentState', '\u72b6\u6001': 'currentState',
    '\u5173\u7cfb': 'relationshipsMotives', '\u52a8\u673a': 'relationshipsMotives', '\u76ee\u7684': 'relationshipsMotives',
    '\u77e5\u8bc6': 'knowledgeCapabilitiesResources', '\u80fd\u529b': 'knowledgeCapabilitiesResources', '\u8d44\u6e90': 'knowledgeCapabilitiesResources',
});

function narrativeHeaderKey(value) {
    const label = cleanText(value, 120);
    return NARRATIVE_SECTION_HEADER_KEYS[label]
        || NARRATIVE_SECTION_HEADER_ALIASES[label.toLowerCase()]
        || '';
}

function narrativeParagraphSection(text, fallback) {
    const value = cleanText(text, 4000);
    const rules = [
        [/\u751f\u7406|\u4f53\u5f81|\u8eab\u4f53|\u5916\u5f62/u, 'physiology'],
        [/\u6027\u683c|\u4e2a\u6027|\u5e95\u8272|\u4e60\u60ef|\u53cd\u5e94/u, 'personality'],
        [/\u8fc7\u53bb|\u7ecf\u5386|\u5c65\u5386|\u80cc\u666f|\u66fe\u7ecf/u, 'history'],
        [/\u73b0\u5728|\u5f53\u524d|\u8fd1\u671f|\u6b63\u5728|\u72b6\u6001/u, 'currentState'],
        [/\u5173\u7cfb|\u52a8\u673a|\u76ee\u7684|\u6b32\u671b|\u5728\u610f/u, 'relationshipsMotives'],
        [/\u77e5\u9053|\u64c5\u957f|\u80fd\u529b|\u8d44\u6e90|\u4f1a\u4ec0\u4e48/u, 'knowledgeCapabilitiesResources'],
        [/\u8eab\u4efd|\u540d\u5b57|\u5916\u8c8c|\u804c\u4e1a|\u79cd\u65cf/u, 'person'],
    ];
    const matched = rules.find(([pattern]) => pattern.test(value))?.[1];
    return matched || '';
}

function parseNarrativeProfileBlocks(output, discoveryContext = null) {
    const source = String(output || '').replace(/```(?:markdown|text)?/giu, '').trim();
    const starts = [...source.matchAll(/(?:^|\n)\s*(?:#+\s*)?(?:【\s*人物档案\s*[：:]\s*([^】\n]{1,160})\s*】|人物档案\s*[：:]\s*([^\n]{1,160}))/gu)];
    const rows = [];
    for (let index = 0; index < starts.length; index += 1) {
        const match = starts[index];
        // Identity matching is intentionally literal: no case folding, alias
        // lookup or synonym normalization may turn a prose heading into an
        // ActorRef or a discovery anchor.
        const name = String(match[1] || match[2] || '').trim().slice(0, 160);
        const bodyStart = match.index + match[0].length;
        const bodyEnd = index + 1 < starts.length ? starts[index + 1].index : source.length;
        const body = source.slice(bodyStart, bodyEnd);
        const actorRefLine = body.match(/(?:^|\n)\s*(?:ActorRef|actor[_ ]?ref)\s*[：:]\s*([^\n]+)/iu);
        const sections = {};
        const additionalParagraphs = [];
        let parseFailure = '';
        // Bracketed headings mark real dossier sections.  A bare colon is a
        // boundary only for a known semantic alias, so ordinary prose remains
        // ordinary prose instead of becoming a malformed table row.
        const headerMatches = [...body.matchAll(/(?:^|\n)\s*(?:#+\s*)?(?:【\s*([^】\n]+)\s*】\s*(?:[：:])?|([^\n：:]{2,80})\s*[：:])/gu)];
        const headers = headerMatches.filter((header) => (
            Boolean(header[1]) || Boolean(narrativeHeaderKey(header[2]))
        ));
        const unheaded = narrativeText(body.slice(0, headers[0]?.index ?? body.length), 4000);
        if (unheaded) additionalParagraphs.push(unheaded);
        for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
            const header = headers[headerIndex];
            const label = cleanText(header[1] || header[2], 120);
            if (/^actor[_ ]?ref$/iu.test(label)) continue;
            const section = narrativeHeaderKey(label);
            const start = header.index + header[0].length;
            const end = headerIndex + 1 < headers.length ? headers[headerIndex + 1].index : body.length;
            const text = narrativeText(body.slice(start, end), 4000);
            if (!text) continue;
            if (!section) {
                additionalParagraphs.push(text);
            } else if (sections[section]) {
                sections[section].text = narrativeText(`${sections[section].text}\n\n${text}`, 4000);
            } else {
                sections[section] = { text, source: 'hypothesis', evidence: [] };
            }
        }
        if (additionalParagraphs.length) {
            const fallback = ACTOR_PROFILE_NARRATIVE_SECTION_KEYS.filter((key) => (
                key !== 'physiology' && !sections[key]
            ));
            const paragraphs = additionalParagraphs.flatMap((value) => (
                String(value).split(/\n\s*\n+/u)
            )).map((value) => narrativeText(value, 4000)).filter(Boolean);
            for (const text of paragraphs) {
                const section = narrativeParagraphSection(text, fallback);
                if (!section) {
                    sections.person = sections.person
                        ? { ...sections.person, text: narrativeText(`${sections.person.text}\n\n${text}`, 4000) }
                        : { text, source: 'hypothesis', evidence: [] };
                    continue;
                }
                const indexOfSection = fallback.indexOf(section);
                if (indexOfSection >= 0) fallback.splice(indexOfSection, 1);
                sections[section] = sections[section]
                    ? { ...sections[section], text: narrativeText(`${sections[section].text}\n\n${text}`, 4000) }
                    : { text, source: 'hypothesis', evidence: [] };
            }
        }
        const actorId = cleanText(actorRefLine?.[1], 120)
            .replace(/^(?:actorId\s*[=:]\s*)/iu, '')
            .split(/[，,\s]+/u)[0];
        if (/^actorid$/iu.test(actorId)) parseFailure ||= 'actor_profile.actor_ref_literal_invalid';
        const narrative = String(discoveryContext?.acceptedNarrative || '');
        const first = name ? narrative.indexOf(name) : -1;
        const row = {
            profileFormat: 'narrative-v1',
            actorRef: actorId ? { actorId, name } : {},
            candidateRef: actorId ? null : {
                name,
                sourceAnchor: first >= 0 ? narrative.slice(first, first + name.length) : '',
            },
            narrativeSections: sections,
            __narrativeParseFailure: parseFailure,
            __narrativeIdentityFailure: actorId || first >= 0
                ? ''
                : 'actor_profile.discovery_name_missing_from_narrative',
        };
        rows.push(row);
    }
    return rows;
}

export function parseActorProfileCompletionBatchOutput(output, options = {}) {
    const requiredCandidates = (Array.isArray(options.candidates) ? options.candidates : [])
        .filter((candidate) => cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120));
    const requiredIds = new Set(requiredCandidates.map((candidate) => cleanText(
        candidate?.actorRef?.actorId || candidate?.actorId,
        120,
    )));
    const suppliedCandidates = [...requiredCandidates];
    const candidateCounts = new Map();
    for (const candidate of suppliedCandidates) {
        const actorId = cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120);
        candidateCounts.set(actorId, (candidateCounts.get(actorId) || 0) + 1);
    }
    const duplicateInputIds = new Set([...candidateCounts]
        .filter(([, count]) => count > 1)
        .map(([actorId]) => actorId));
    const candidates = suppliedCandidates.filter((candidate) => !duplicateInputIds.has(
        cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120),
    ));
    const expectedById = new Map(candidates.map((candidate) => [
        cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120),
        candidate,
    ]));
    const narrativeTransport = String(output || '')
        .replace(/```(?:markdown|text)?/giu, '')
        .trim();
    const narrativeExplicitEmpty = /^\u65e0\u4eba\u7269\u6863\u6848[\u3002.]?$/u.test(narrativeTransport);
    const narrativeRows = narrativeExplicitEmpty
        ? []
        : parseNarrativeProfileBlocks(output, options.discoveryContext);
    const parsed = narrativeRows.length
        ? {
            objects: narrativeRows,
            repairs: ['narrative_blocks_parsed'],
            explicitEmpty: false,
            batchMeta: {
                rootType: 'narrative_blocks',
                parsedRowCount: Math.min(128, narrativeRows.length),
                explicitEmpty: false,
                emptyOutput: false,
                formatUnrecoverable: false,
                repairLabels: ['narrative_blocks_parsed'],
            },
        }
        : (narrativeExplicitEmpty
            ? {
                objects: [], repairs: [], explicitEmpty: true,
                batchMeta: {
                    rootType: 'narrative_blocks', parsedRowCount: 0, explicitEmpty: true,
                    emptyOutput: false, formatUnrecoverable: false, repairLabels: [],
                },
            }
            : parseProfileObjectsLocally(output));
    const batchFormatUnrecoverable = parsed.objects.length === 0 && !parsed.explicitEmpty;
    const acceptedById = new Map();
    const failureById = new Map();
    const unexpected = [];
    const discoveries = [];
    const unresolved = [];
    const seen = new Set();
    const seenDiscoveryKeys = new Set();
    const duplicateDiscoveryKeys = new Set();
    for (const raw of parsed.objects) {
        const normalized = normalizeProfileInsertCandidate(raw, parsed.repairs);
        if (normalized?.__narrativeIdentityFailure) {
            unresolved.push({
                candidateRef: { name: cleanText(raw?.candidateRef?.name || raw?.actorRef?.name, 160), sourceAnchor: '' },
                reason: normalized.__narrativeIdentityFailure,
                missingFields: [],
                retryable: false,
            });
            continue;
        }
        const actorId = cleanText(normalized?.actorRef?.actorId, 120);
        const rawCandidateName = cleanText(normalized?.candidateRef?.name, 160);
        const sourceAnchor = String(normalized?.candidateRef?.sourceAnchor || '').slice(0, 1200);
        const recoveredName = recoverActorProfileDiscoveryNameFromEvidence(
            rawCandidateName,
            sourceAnchor,
        );
        const candidateName = recoveredName || rawCandidateName;
        if (recoveredName && Array.isArray(parsed.repairs)) {
            parsed.repairs.push('actor_profile.discovery_name_from_explicit_evidence');
        }
        if (actorId && (candidateName || sourceAnchor)) {
            unexpected.push({
                actorId,
                name: candidateName,
                reason: 'actor_profile.row_ref_ambiguous',
            });
            continue;
        }
        if (!actorId && (candidateName || sourceAnchor)) {
            const discoveryKey = `${candidateName}\u0000${sourceAnchor}`;
            if (seenDiscoveryKeys.has(discoveryKey)) {
                duplicateDiscoveryKeys.add(discoveryKey);
                continue;
            }
            seenDiscoveryKeys.add(discoveryKey);
            const anchorCheck = validateActorProfileDiscoveryAnchor(
                { name: candidateName, sourceAnchor },
                options.discoveryContext?.acceptedNarrative,
            );
            if (!anchorCheck.ok) {
                unresolved.push({
                    candidateRef: { name: candidateName, sourceAnchor },
                    reason: anchorCheck.reason || 'actor_profile.discovery_anchor_invalid',
                    missingFields: [],
                    retryable: true,
                });
                continue;
            }
            const temporaryActorId = `DISC-${fingerprint(JSON.stringify([
                candidateName,
                sourceAnchor,
            ])).slice(0, 24)}`;
            normalized.actorRef = { actorId: temporaryActorId, name: candidateName };
            const context = {
                actorRef: normalized.actorRef,
                completionMode: modeOf(options.discoveryContext?.completionMode),
                deferTicketSourceNormalization: true,
            };
            const local = repairProfileCandidateMetadata(normalized, context);
            const validation = validateActorProfileInsertCandidate(local.candidate, context);
            if (!validation.ok) {
                unresolved.push({
                    candidateRef: { name: candidateName, sourceAnchor },
                    reason: validation.errorCode || 'actor_profile.schema_incomplete',
                    missingFields: validation.missingFields || [],
                    retryable: true,
                });
                continue;
            }
            const discovery = {
                temporaryActorId,
                candidateRef: { name: candidateName, sourceAnchor },
                offset: anchorCheck.offset,
                candidate: validation.candidate,
                repairs: [...new Set([...parsed.repairs, ...local.repairs])],
                resolutions: validation.resolutions || [],
            };
            discoveries.push(discovery);
            continue;
        }
        if (!actorId) {
            unexpected.push({ reason: 'actor_profile.actor_ref_missing' });
            continue;
        }
        const context = expectedById.get(actorId);
        if (!context) {
            unexpected.push({ actorId, reason: 'actor_profile.actor_ref_unknown' });
            continue;
        }
        if (seen.has(actorId)) {
            acceptedById.delete(actorId);
            failureById.set(actorId, {
                actorId,
                name: cleanText(context?.actorRef?.name || context?.name, 160),
                reason: 'actor_profile.actor_ref_duplicate',
                missingFields: [],
                retryable: true,
            });
            continue;
        }
        seen.add(actorId);
        const local = repairProfileCandidateMetadata(normalized, context);
        const validation = validateActorProfileInsertCandidate(local.candidate, context);
        if (!validation.ok) {
            failureById.set(actorId, {
                actorId,
                name: cleanText(context?.actorRef?.name || context?.name, 160),
                reason: validation.errorCode || 'actor_profile.schema_incomplete',
                missingFields: validation.missingFields || [],
                retryable: validation.errorCode !== 'actor_profile.actor_ref_mismatch',
            });
            continue;
        }
        acceptedById.set(actorId, {
            actorId,
            name: cleanText(context?.actorRef?.name || context?.name, 160),
            candidate: validation.candidate,
            repairs: [...new Set([...parsed.repairs, ...local.repairs])],
            resolutions: validation.resolutions || [],
        });
    }
    if (duplicateDiscoveryKeys.size) {
        for (const key of duplicateDiscoveryKeys) {
            const [name, sourceAnchor] = key.split('\u0000');
            for (let index = discoveries.length - 1; index >= 0; index -= 1) {
                const item = discoveries[index];
                if (
                    item.candidateRef.name === name
                    && item.candidateRef.sourceAnchor === sourceAnchor
                ) discoveries.splice(index, 1);
            }
            unresolved.push({
                candidateRef: { name, sourceAnchor },
                reason: 'actor_profile.discovery_ref_duplicate',
                missingFields: [],
                retryable: true,
            });
        }
    }
    for (const [actorId, context] of expectedById) {
        if (!requiredIds.has(actorId)) continue;
        if (acceptedById.has(actorId) || failureById.has(actorId)) continue;
        failureById.set(actorId, {
            actorId,
            name: cleanText(context?.actorRef?.name || context?.name, 160),
            reason: batchFormatUnrecoverable
                ? 'actor_profile.format_unrecoverable'
                : 'actor_profile.missing_candidate',
            missingFields: [],
            retryable: true,
        });
    }
    const entries = candidates
        .map((candidate) => acceptedById.get(cleanText(
            candidate?.actorRef?.actorId || candidate?.actorId,
            120,
        )))
        .filter(Boolean);
    const failures = candidates
        .map((candidate) => failureById.get(cleanText(
            candidate?.actorRef?.actorId || candidate?.actorId,
            120,
        )))
        .filter(Boolean);
    const inputFailures = [...duplicateInputIds].map((actorId) => ({
        actorId,
        name: cleanText(suppliedCandidates.find((candidate) => (
            cleanText(candidate?.actorRef?.actorId || candidate?.actorId, 120) === actorId
        ))?.actorRef?.name, 160),
        reason: 'actor_profile.input_actor_ref_duplicate',
        missingFields: [],
        retryable: false,
    }));
    return {
        ok: failures.length === 0
            && inputFailures.length === 0
            && unexpected.length === 0
            && unresolved.length === 0,
        entries,
        failures: [...inputFailures, ...failures],
        unexpected,
        discoveries,
        unresolved,
        explicitEmpty: parsed.explicitEmpty === true,
        repairs: parsed.repairs,
        batchMeta: parsed.batchMeta,
    };
}

export function actorProfileCompletionMissingFields(candidate, context = {}) {
    return validateActorProfileInsertCandidate(candidate, context).missingFields;
}

function candidateModuleSources(candidate, section, relativePaths) {
    const overrides = Object.fromEntries(relativePaths.map((path) => [
        path,
        sourceAtPath(candidate, `${section}.${path}`) || 'hypothesis',
    ]));
    return {
        source: Object.values(overrides).some((source) => source === 'confirmed')
            ? 'confirmed'
            : Object.values(overrides).some((source) => source === 'designed_seed')
                ? 'designed_seed'
                : 'hypothesis',
        overrides,
    };
}

function normalizeProfileProjectionSourceRef(value) {
    if (!isRecord(value)) return null;
    const chatId = cleanText(value.chatId, 180);
    const messageId = cleanText(value.messageId, 180);
    const hash = cleanText(value.hash, 100);
    if (!chatId || !messageId || !hash) return null;
    return {
        chatId,
        messageId,
        index: integer(value.index),
        swipeId: integer(value.swipeId),
        generation: integer(value.generation),
        generationId: cleanText(value.generationId, 180),
        generationType: cleanText(value.generationType, 80),
        identityScopeId: cleanText(value.identityScopeId, 300),
        hash,
    };
}

function canonicalProfileRelationshipEntries(value) {
    if (!Array.isArray(value)) return [];
    const output = [];
    const seen = new Set();
    for (const raw of value) {
        const entry = typeof raw === 'string' ? { summary: raw, name: '关系背景' } : raw;
        if (!isRecord(entry)) continue;
        const actorId = cleanText(entry.actorId || entry.actor_id, 120);
        const name = cleanText(
            entry.name || entry.counterparty || entry.targetName || entry.relation,
            160,
        );
        const summary = meaningfulProfileText(
            entry.summary || entry.detail || entry.relation,
            500,
        );
        if ((!actorId && !name) || !summary) continue;
        const key = `${actorId}|${name}|${summary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
            actorId,
            name,
            summary,
            evidence: cleanList(entry.evidence, 6, 240),
        });
        if (output.length >= 24) break;
    }
    return output;
}

function canonicalProfileKnowledgeEntries(value, turn) {
    if (!Array.isArray(value)) return [];
    return value.map((raw, index) => {
        const entry = typeof raw === 'string' ? { claim: raw } : raw;
        if (!isRecord(entry)) return null;
        const claim = meaningfulProfileText(entry.claim || entry.summary || entry.text, 700);
        if (!claim) return null;
        const sourceRef = normalizeProfileProjectionSourceRef(entry.sourceRef);
        const kind = ['observed', 'reported', 'inferred'].includes(entry.kind)
            ? entry.kind
            : 'inferred';
        const requestedConfidence = Number(entry.confidence);
        return {
            id: cleanText(entry.id, 100)
                || `K-${fingerprint(`${claim}|${sourceRef?.hash || index}`).slice(0, 16)}`,
            claim,
            kind,
            confidence: Math.min(1, Math.max(
                0,
                Number.isFinite(requestedConfidence) ? requestedConfidence : 0.6,
            )),
            learnedTurn: integer(entry.learnedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
            sourceRef,
            propagation: cleanList(entry.propagation, 12, 160),
        };
    }).filter(Boolean).slice(0, 48);
}

function canonicalProfileResources(value) {
    if (!Array.isArray(value)) return [];
    const output = [];
    const seen = new Set();
    for (const raw of value) {
        const entry = typeof raw === 'string' ? { name: raw } : raw;
        if (!isRecord(entry)) continue;
        const name = meaningfulProfileText(entry.name || entry.kind || entry.id, 120);
        if (!name) continue;
        const id = cleanText(entry.id, 100)
            || `RES-${fingerprint(name.toLocaleLowerCase()).slice(0, 12)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const requestedAmount = Number(entry.amount);
        output.push({
            id,
            name,
            amount: Math.min(1_000_000_000, Math.max(
                0,
                Number.isFinite(requestedAmount) ? requestedAmount : 0,
            )),
            unit: cleanText(entry.unit, 60),
            description: cleanText(entry.description || entry.detail, 300),
            evidence: cleanList(entry.evidence, 6, 240),
        });
        if (output.length >= 24) break;
    }
    return output;
}

export function materializeActorProfileBaseline(previousProfile, candidate, {
    turn = 0,
    now = Date.now(),
    completionMode = 'full',
} = {}) {
    const profile = normalizeActorProfileV6(previousProfile, {
        actorId: candidate?.actorRef?.actorId,
        name: candidate?.actorRef?.name,
        mode: completionMode,
    });
    profile.version = ACTOR_PROFILE_V6_VERSION;
    profile.actorId = cleanText(candidate?.actorRef?.actorId, 120);
    profile.name = cleanText(candidate?.actorRef?.name, 160);
    profile.completionMode = modeOf(completionMode || profile.completionMode);
    if (candidate?.profileFormat === 'narrative-v1') {
        profile.profileFormat = 'narrative-v1';
        profile.narrativeSections = normalizeNarrativeSections(candidate.narrativeSections);
        if (
            profile.completionMode === 'full_adult'
            && narrativeText(profile.narrativeSections.physiology?.text, 4000)
        ) {
            profile.narrativeSections.physiology.contractVersion =
                ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION;
        }
        // Narrative sections are authored content; anchors, tickets, locks and
        // all runtime facts stay on their existing local ownership paths.
        profile.baselineCommit = null;
        profile.coverage = calculateCoverage(profile);
        profile.preparedForAction = false;
        profile.backgroundPending = true;
        profile.updatedTurn = integer(turn);
        return profile;
    }
    // Preserve the old persisted shape exactly. Legacy V6 has no narrative
    // marker or empty sections until it is explicitly replaced by narrative-v1.
    delete profile.profileFormat;
    delete profile.narrativeSections;
    // A ProfileInsertCandidate is a complete replacement row after fact-layer
    // reconciliation. Empty scaffold sources from local preparation must not
    // retain a stale "confirmed" lock over newly designed hypotheses.
    for (const path of Object.keys(profile.fieldSources || {})) {
        if (BASELINE_MODULES.some((module) => path.startsWith(
            `modules.${module}.data`,
        ))) delete profile.fieldSources[path];
    }
    const evidence = cleanList(previousProfile?.modules?.identity?.evidence, 16, 300);
    const assignBaseline = (module, data, paths) => {
        const sourceInfo = candidateModuleSources(candidate, module, paths);
        assignModule(profile, module, data, {
            source: sourceInfo.source,
            unknownFields: [],
            evidence,
            turn,
            now,
            action: 'profile_insert',
            fieldSourceOverrides: sourceInfo.overrides,
        });
    };
    assignBaseline('identity', {
        name: profile.name,
        aliases: cleanList(previousProfile?.modules?.identity?.data?.aliases, 8, 120),
        lineage: clone(previousProfile?.modules?.identity?.data?.lineage || {}),
        ...clone(candidate.identity),
    }, ['name', ...INSERT_IDENTITY_FIELDS]);
    assignBaseline('personality', clone(candidate.personality), [
        ...INSERT_PERSONALITY_TEXT_FIELDS,
        ...Object.keys(INSERT_PERSONALITY_LIST_FIELDS),
    ]);
    assignBaseline('relationships', {
        ...clone(candidate.relationships),
        entries: canonicalProfileRelationshipEntries(candidate.relationships?.entries),
    }, [
        'entries', 'patterns', 'coverageState',
    ]);
    assignBaseline('goals', {
        longTerm: clone(candidate.goals.longTerm),
        current: clone(candidate.goals.pursuitPrinciples),
        plan: {
            summary: candidate.goals.strategy.summary,
            steps: clone(candidate.goals.strategy.steps),
            status: 'baseline',
            priority: 'normal',
        },
        nextWindow: candidate.goals.strategy.reviewConditions,
        baselineKind: 'long_term',
        commitments: [],
        obstacles: [],
        costs: [],
        alternatives: [],
    }, ['longTerm', 'current', 'plan.summary', 'plan.steps', 'nextWindow']);
    assignBaseline('knowledge', {
        ...clone(candidate.knowledge),
        entries: canonicalProfileKnowledgeEntries(candidate.knowledge?.entries, turn),
    }, [
        'entries', 'unknownRemainsUnknown', 'coverageState',
    ]);
    assignBaseline('resourcesCapabilities', {
        ...clone(candidate.resourcesCapabilities),
        resources: canonicalProfileResources(candidate.resourcesCapabilities?.resources),
    }, [
        'resources', 'capabilities', 'noUnconfirmedAbilityGranted', 'coverageState',
    ]);
    if (profile.completionMode === 'full_adult') {
        assignBaseline('physiology', normalizePhysiology({
            ...candidate.physiology,
            enabled: true,
            adultEnabled: true,
        }), PHYSIOLOGY_CONTENT_FIELDS);
    } else if (!moduleLocked(profile, 'physiology')) {
        assignModule(profile, 'physiology', emptyPhysiology(), {
            source: 'confirmed',
            unknownFields: [],
            evidence,
            turn,
            now,
            action: 'profile_insert',
        });
    }
    for (const [path, overrideValue] of Object.entries(profile.manualOverrides || {})) {
        const parts = pathParts(path);
        if (parts[0] !== 'modules' || !BASELINE_MODULES.includes(parts[1])) continue;
        setPath(profile, parts, overrideValue);
        profile.fieldSources[path] = 'confirmed';
    }
    profile.baselineCommit = null;
    profile.coverage = calculateCoverage(profile);
    profile.preparedForAction = false;
    profile.backgroundPending = true;
    profile.updatedTurn = integer(turn);
    return profile;
}

export function applyActorProfileCompletionToV6(value, candidate, options = {}) {
    return materializeActorProfileBaseline(value, candidate, options);
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
    if (profile.profileFormat === 'narrative-v1') return clone(value);
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
    if (profile.profileFormat === 'narrative-v1') {
        return { profile: clone(value), applied: false, reason: 'narrative_read_only' };
    }
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
    profile.preparedForAction = baselineCommitReady(profile);
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
    if (profile.profileFormat === 'narrative-v1') {
        return { profile: clone(value), regenerated: false, reason: 'narrative_read_only' };
    }
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
    profile.preparedForAction = baselineCommitReady(profile);
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
    const preparedForAction = baselineCommitReady(profile);
    const requiredUnknownFieldCount = Object.entries(profile.modules)
        .filter(([module]) => module !== 'physiology')
        .reduce((total, [, module]) => total + module.unknownFields.length, 0);
    return {
        version: profile.version,
        actorId: profile.actorId,
        name: profile.name,
        completionMode: profile.completionMode,
        profileFormat: profile.profileFormat,
        narrativeSections: profile.profileFormat === 'narrative-v1'
            ? clone(profile.narrativeSections)
            : null,
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
        designRolls: profile.designRolls
            ? {
                ticketId: profile.designRolls.ticketId,
                axisCount: Object.keys(profile.designRolls.axes || {}).length,
            }
            : null,
        hasActionPlan: moduleReady(profile, 'goals'),
        physiologyEnabled: profile.modules.physiology.data.enabled === true,
        adultPhysiologyEnabled: profile.modules.physiology.data.adultEnabled === true,
        physiologyInfersPersonality: false,
    };
}
