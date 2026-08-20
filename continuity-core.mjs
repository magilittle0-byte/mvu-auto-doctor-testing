import { normalizeActorRefs } from './actor-ref-core.mjs';
import { normalizeActorActionTarget } from './actor-authority-core.mjs';
import { fingerprint } from './core.mjs';

const STAGES = new Set([
    'seeded',
    'advancing',
    'manifested',
    'resolved',
    'dormant',
]);

const KINDS = new Set([
    'parallel',
    'personal',
    'promise',
    'enemy',
    'mystery',
]);

const EVENT_TYPES = new Set(['conflict', 'progress']);
const EVENT_RESULTS = new Set(['success', 'hold', 'setback']);
const EVENT_OUTCOMES = new Set(['', 'succeeded', 'failed', 'dissipated']);
const KNOWLEDGE = new Set(['hidden', 'rumor', 'observed']);
const KNOWLEDGE_RANK = Object.freeze({ hidden: 0, rumor: 1, observed: 2 });

const ORIGINS = new Set([
    'main_derivative',
    'setting_linked',
    'setting_independent',
    'ambient',
]);

const RELATIONS = new Set([
    'linked',
    'latent',
    'independent',
    'converging',
]);

const CONVERGENCE_CHANNELS = new Set([
    'actor',
    'faction',
    'location',
    'resource',
    'time',
    'causal',
    'public_signal',
]);

const TICK_ACTIONS = new Set([
    'created',
    'advanced',
    'manifested',
    'resolved',
    'dormant',
    'held',
]);

const FACTION_RELATIONS = new Set([
    'bonded',
    'allied',
    'friendly',
    'neutral',
    'distant',
    'hostile',
    'irreconcilable',
]);

const FACTION_CONDITIONS = new Set([
    'dominant',
    'stable',
    'divided',
    'strained',
    'declining',
    'collapsed',
]);

const WIND_TYPES = new Set(['notice', 'report', 'rumor', 'sentiment']);
const TREND_STATES = new Set(['active', 'resolved']);
const INCIDENT_STATES = new Set(['active', 'cooldown', 'resolved']);
const ENEMY_STATES = new Set(['watching', 'preparing', 'acting', 'dormant', 'resolved']);
const SECRET_STATES = new Set(['hidden', 'leaking', 'exposed', 'resolved']);
const ECONOMY_STATES = ['boom', 'stable', 'strained', 'recession', 'crisis'];
const REPUTATION_KEYS = ['authority', 'public', 'underworld', 'professional'];
const SCENARIO_STATUSES = new Set([
    'inactive',
    'active',
    'closing',
    'completed',
    'failed',
]);
const SCENARIO_PHASES = new Set([
    'setup',
    'exploration',
    'escalation',
    'climax',
    'aftermath',
    'closing',
    'completed',
    'failed',
]);
const SCENARIO_CLOSURES = new Set(['open', 'ready', 'blocked', 'completed', 'failed']);
const SCENARIO_CAUSE_TYPES = new Set([
    'player_action',
    'world_chain',
    'setting_fact',
    'system_rule',
]);
const SCENARIO_IMPACTS = new Set(['minor', 'material', 'structural']);
const SCENARIO_FIELDS = new Set([
    'goal',
    'completion',
    'failure',
    'activeApex',
    'route',
    'timeLimit',
    'stakes',
    'phase',
    'closure',
    'closureReason',
]);
const SCENARIO_TEXT_FIELDS = [
    'goal',
    'completion',
    'failure',
    'activeApex',
    'route',
    'timeLimit',
    'stakes',
];

export const SCENARIO_STATUS_LABELS = Object.freeze({
    inactive: '未建立',
    active: '进行中',
    closing: '可收束',
    completed: '已完成',
    failed: '已失败',
});

export const SCENARIO_PHASE_LABELS = Object.freeze({
    setup: '建立',
    exploration: '探索',
    escalation: '发展',
    climax: '终局',
    aftermath: '余波',
    closing: '收束',
    completed: '完成',
    failed: '失败',
});

export const SCENARIO_CAUSE_LABELS = Object.freeze({
    player_action: '玩家行动',
    world_chain: '世界因果链',
    setting_fact: '既有设定事实',
    system_rule: '系统规则',
});

export const CONTINUITY_STAGE_LABELS = Object.freeze({
    seeded: '已埋设',
    advancing: '推进中',
    manifested: '已显现',
    resolved: '已回收',
    dormant: '搁置',
});

export const CONTINUITY_KIND_LABELS = Object.freeze({
    parallel: '平行事件',
    personal: '人物线',
    promise: '约定/承诺',
    enemy: '敌方行动',
    mystery: '谜团线索',
});

export const CONTINUITY_KNOWLEDGE_LABELS = Object.freeze({
    hidden: '幕后隐藏（角色未知）',
    rumor: '传闻阶段（部分可知）',
    observed: '正文已观察',
});

export const CONTINUITY_ORIGIN_LABELS = Object.freeze({
    main_derivative: '主线衍生',
    setting_linked: '世界设定·暗中相关',
    setting_independent: '世界设定·当前独立',
    ambient: '世界脉动',
});

export const CONTINUITY_RELATION_LABELS = Object.freeze({
    linked: '已接入主线',
    latent: '潜在关联',
    independent: '保持独立',
    converging: '正在汇流',
});

export const CONTINUITY_TICK_LABELS = Object.freeze({
    created: '新事件成立',
    advanced: '事件推进',
    manifested: '影响显现',
    resolved: '事件结束',
    dormant: '事件休眠',
    held: '本轮合理保持',
});

const CONTINUITY_URGENCY_LABELS = Object.freeze([
    '暂缓',
    '低',
    '中',
    '高',
]);

const STAGE_SORT_ORDER = Object.freeze({
    manifested: 0,
    advancing: 1,
    seeded: 2,
    dormant: 3,
    resolved: 4,
});

const EVENT_PHASE_LABELS = Object.freeze({
    conflict: {
        seeded: '萌芽',
        advancing: '发酵',
        manifested: '逼近',
        resolved: '终局',
        dormant: '休眠',
    },
    progress: {
        seeded: '筹备',
        advancing: '执行',
        manifested: '关键',
        resolved: '终局',
        dormant: '休眠',
    },
});

const EVENT_PHASE_BASE = Object.freeze({
    conflict: { seeded: 95, advancing: 85, manifested: 75 },
    progress: { seeded: 75, advancing: 85, manifested: 95 },
});

export const WORLD_FACTION_RELATION_LABELS = Object.freeze({
    bonded: '牢固同盟',
    allied: '合作',
    friendly: '友好',
    neutral: '中立',
    distant: '冷淡',
    hostile: '敌对',
    irreconcilable: '不可调和',
});

export const WORLD_FACTION_CONDITION_LABELS = Object.freeze({
    dominant: '鼎盛',
    stable: '稳固',
    divided: '倾轧',
    strained: '困顿',
    declining: '衰落',
    collapsed: '瓦解',
});

export const WORLD_WIND_TYPE_LABELS = Object.freeze({
    notice: '公告',
    report: '消息',
    rumor: '流言',
    sentiment: '舆论',
});

export const WORLD_ECONOMY_LABELS = Object.freeze({
    boom: '繁荣',
    stable: '平稳',
    strained: '趋紧',
    recession: '萧条',
    crisis: '危机',
});

export const WORLD_REPUTATION_LABELS = Object.freeze({
    authority: '官方',
    public: '民间',
    underworld: '暗域',
    professional: '业界',
});

function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function cleanText(value, limit = 500) {
    return String(value || '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, limit);
}

function cleanList(value, limit = 8) {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source.map((item) => cleanText(item, 80)).filter(Boolean))]
        .slice(0, limit);
}

function boundedInteger(value, minimum, maximum, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
}

function cleanId(value, fallback) {
    return cleanText(value || fallback, 90)
        .replace(/[^\p{L}\p{N}_.:\-]/gu, '-');
}

function normalizeScenarioField(field, value) {
    if (field === 'phase') {
        return SCENARIO_PHASES.has(value) ? value : 'setup';
    }
    if (field === 'closure') {
        return SCENARIO_CLOSURES.has(value) ? value : 'open';
    }
    return cleanText(value, field === 'closureReason' ? 700 : 500);
}

function normalizeScenarioSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        ...Object.fromEntries(
            SCENARIO_TEXT_FIELDS.map((field) => [
                field,
                normalizeScenarioField(field, source[field]),
            ]),
        ),
        phase: normalizeScenarioField('phase', source.phase),
        closure: normalizeScenarioField('closure', source.closure),
        closureReason: normalizeScenarioField('closureReason', source.closureReason),
    };
}

function normalizeScenarioChange(value) {
    if (!value || typeof value !== 'object' || !SCENARIO_FIELDS.has(value.field)) {
        return null;
    }
    const field = value.field;
    if (
        (field === 'phase' && (
            !SCENARIO_PHASES.has(value.before)
            || !SCENARIO_PHASES.has(value.after)
        ))
        || (field === 'closure' && (
            !SCENARIO_CLOSURES.has(value.before)
            || !SCENARIO_CLOSURES.has(value.after)
        ))
    ) {
        return null;
    }
    return {
        field,
        before: normalizeScenarioField(field, value.before),
        after: normalizeScenarioField(field, value.after),
    };
}

function normalizeScenarioAmendment(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const id = cleanId(value.id, '');
    if (!id) return null;
    const changes = [];
    const changedFields = new Set();
    let invalidChanges = 0;
    for (const raw of Array.isArray(value.changes) ? value.changes : []) {
        const change = normalizeScenarioChange(raw);
        if (!change || changedFields.has(change.field)) {
            invalidChanges += 1;
            continue;
        }
        changedFields.add(change.field);
        changes.push(change);
        if (changes.length >= 10) break;
    }
    return {
        id,
        revision: boundedInteger(value.revision, 1, 999, index + 1),
        turn: boundedInteger(value.turn, 0, Number.MAX_SAFE_INTEGER, turn),
        causeType: SCENARIO_CAUSE_TYPES.has(value.causeType) ? value.causeType : '',
        impact: SCENARIO_IMPACTS.has(value.impact) ? value.impact : '',
        sourceThreadIds: cleanList(value.sourceThreadIds, 8),
        trigger: cleanText(value.trigger, 500),
        mechanism: cleanText(value.mechanism, 700),
        evidence: cleanList(value.evidence, 8),
        changes,
        ...(invalidChanges ? { invalidChanges } : {}),
        preserves: cleanList(value.preserves, 10),
        visibility: KNOWLEDGE.has(value.visibility) ? value.visibility : '',
        reversible: value.reversible !== false,
        sourceRef: normalizeSourceRef(value.sourceRef),
    };
}

export function emptyScenarioPlan() {
    return {
        status: 'inactive',
        instanceId: '',
        title: '',
        revision: 0,
        baselineEvidence: [],
        baselineSourceRef: null,
        baseline: normalizeScenarioSnapshot({}),
        current: normalizeScenarioSnapshot({}),
        amendments: [],
        createdTurn: 0,
        updatedTurn: 0,
    };
}

export function normalizeScenarioPlan(value, { turn = 0 } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const amendments = [];
    const used = new Set();
    for (const raw of Array.isArray(source.amendments) ? source.amendments : []) {
        const amendment = normalizeScenarioAmendment(raw, amendments.length, turn);
        if (!amendment || used.has(amendment.id)) continue;
        used.add(amendment.id);
        amendments.push(amendment);
        if (amendments.length >= 24) break;
    }
    const baseline = normalizeScenarioSnapshot(source.baseline);
    const current = normalizeScenarioSnapshot(source.current || source.baseline);
    const status = SCENARIO_STATUSES.has(source.status) ? source.status : 'inactive';
    return {
        status,
        instanceId: cleanId(source.instanceId, ''),
        title: cleanText(source.title, 160),
        revision: boundedInteger(
            source.revision,
            0,
            999,
            amendments.length,
        ),
        baselineEvidence: cleanList(source.baselineEvidence, 10),
        baselineSourceRef: normalizeSourceRef(source.baselineSourceRef),
        ...(
            source.baseline
            && (
                (source.baseline.phase != null && !SCENARIO_PHASES.has(source.baseline.phase))
                || (
                    source.baseline.closure != null
                    && !SCENARIO_CLOSURES.has(source.baseline.closure)
                )
            )
                ? { invalidBaseline: true }
                : {}
        ),
        baseline,
        current,
        amendments,
        createdTurn: boundedInteger(source.createdTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        updatedTurn: boundedInteger(source.updatedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
    };
}

function normalizeWorldItemBase(value, fallbackId, turn) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        id: cleanId(source.id, fallbackId),
        knowledge: KNOWLEDGE.has(source.knowledge) ? source.knowledge : 'hidden',
        basis: cleanText(source.basis, 420),
        lastChange: cleanText(source.lastChange, 500),
        sourceThreads: cleanList(source.sourceThreads, 8),
        updatedTurn: boundedInteger(
            source.updatedTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            turn,
        ),
    };
}

function normalizeFaction(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `FAC-${index + 1}`, turn);
    const name = cleanText(value.name || value.title || base.id, 120);
    if (!base.id || !name) return null;
    return {
        ...base,
        name,
        relation: FACTION_RELATIONS.has(value.relation) ? value.relation : 'neutral',
        condition: FACTION_CONDITIONS.has(value.condition) ? value.condition : 'stable',
        goal: cleanText(value.goal, 500),
        summary: cleanText(value.summary, 700),
        pillars: cleanList(value.pillars, 3),
        scope: cleanText(value.scope, 180),
    };
}

function normalizeTrend(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `TREND-${index + 1}`, turn);
    const name = cleanText(value.name || value.title || base.id, 120);
    if (!base.id || !name) return null;
    return {
        ...base,
        name,
        status: TREND_STATES.has(value.status) ? value.status : 'active',
        summary: cleanText(value.summary || value.description, 700),
        scope: cleanText(value.scope, 180),
        source: cleanText(value.source, 300),
    };
}

function normalizeWind(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `WIND-${index + 1}`, turn);
    const topic = cleanText(value.topic || value.title || value.content || base.id, 120);
    const content = cleanText(value.content || value.summary, 700);
    if (!base.id || (!topic && !content)) return null;
    return {
        ...base,
        topic,
        type: WIND_TYPES.has(value.type) ? value.type : 'report',
        strength: boundedInteger(value.strength, 1, 4, 1),
        content,
        source: cleanText(value.source, 180),
        scope: cleanText(value.scope, 180),
        quietTurns: boundedInteger(value.quietTurns, 0, 99, 0),
        expiresTurn: boundedInteger(value.expiresTurn, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function normalizeReputationDimension(value, turn) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        level: boundedInteger(source.level, -2, 2, 0),
        summary: cleanText(source.summary, 500),
        basis: cleanText(source.basis, 420),
        updatedTurn: boundedInteger(
            source.updatedTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            turn,
        ),
    };
}

function normalizeIncident(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `INC-${index + 1}`, turn);
    const title = cleanText(value.title || value.summary || base.id, 120);
    if (!base.id || !title) return null;
    return {
        ...base,
        title,
        status: INCIDENT_STATES.has(value.status) ? value.status : 'active',
        summary: cleanText(value.summary, 700),
        scope: cleanText(value.scope, 180),
        remainingTurns: boundedInteger(value.remainingTurns, 0, 99, 0),
    };
}

function normalizeEnemy(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `ENEMY-${index + 1}`, turn);
    const name = cleanText(value.name || value.title || base.id, 120);
    if (!base.id || !name) return null;
    return {
        ...base,
        name,
        status: ENEMY_STATES.has(value.status) ? value.status : 'watching',
        summary: cleanText(value.summary, 700),
        motive: cleanText(value.motive, 420),
    };
}

function normalizeSecret(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `SECRET-${index + 1}`, turn);
    const title = cleanText(value.title || value.summary || base.id, 120);
    if (!base.id || !title) return null;
    return {
        ...base,
        title,
        status: SECRET_STATES.has(value.status) ? value.status : 'hidden',
        summary: cleanText(value.summary, 700),
        exposure: boundedInteger(value.exposure, 0, 4, 0),
        holders: cleanList(value.holders, 8),
    };
}

function normalizeInfluence(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const base = normalizeWorldItemBase(value, `CAUSE-${index + 1}`, turn);
    const trigger = cleanText(value.trigger || value.title || base.id, 180);
    const impact = cleanText(value.impact, 500);
    if (!base.id || !trigger || !impact) return null;
    return {
        ...base,
        trigger,
        impact,
        fallout: cleanText(value.fallout, 500),
        expiresTurn: boundedInteger(
            value.expiresTurn,
            turn,
            Number.MAX_SAFE_INTEGER,
            turn + 8,
        ),
    };
}

function normalizeUniqueItems(value, normalizer, turn, limit) {
    const result = [];
    const used = new Set();
    for (const item of Array.isArray(value) ? value : []) {
        const normalized = normalizer(item, result.length, turn);
        if (!normalized?.id || used.has(normalized.id)) continue;
        used.add(normalized.id);
        result.push(normalized);
        if (result.length >= limit) break;
    }
    return result;
}

export function emptyWorldState() {
    return {
        digest: '',
        trends: [],
        factions: [],
        winds: [],
        reputation: Object.fromEntries(
            REPUTATION_KEYS.map((key) => [
                key,
                { level: 0, summary: '', basis: '', updatedTurn: 0 },
            ]),
        ),
        environment: {
            economy: 'stable',
            summary: '',
            basis: '',
            updatedTurn: 0,
            incidents: [],
        },
        shadows: {
            enemies: [],
            secrets: [],
        },
        influences: [],
    };
}

export function normalizeWorldState(value, { turn = 0 } = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const environment = source.environment && typeof source.environment === 'object'
        ? source.environment
        : {};
    const shadows = source.shadows && typeof source.shadows === 'object'
        ? source.shadows
        : {};
    const reputation = source.reputation && typeof source.reputation === 'object'
        ? source.reputation
        : {};
    return {
        digest: cleanText(source.digest, 700),
        trends: normalizeUniqueItems(source.trends, normalizeTrend, turn, 6),
        factions: normalizeUniqueItems(source.factions, normalizeFaction, turn, 16),
        winds: normalizeUniqueItems(source.winds, normalizeWind, turn, 20),
        reputation: Object.fromEntries(
            REPUTATION_KEYS.map((key) => [
                key,
                normalizeReputationDimension(reputation[key], turn),
            ]),
        ),
        environment: {
            economy: ECONOMY_STATES.includes(environment.economy)
                ? environment.economy
                : 'stable',
            summary: cleanText(environment.summary, 700),
            basis: cleanText(environment.basis, 420),
            updatedTurn: boundedInteger(
                environment.updatedTurn,
                0,
                Number.MAX_SAFE_INTEGER,
                turn,
            ),
            incidents: normalizeUniqueItems(
                environment.incidents,
                normalizeIncident,
                turn,
                12,
            ),
        },
        shadows: {
            enemies: normalizeUniqueItems(shadows.enemies, normalizeEnemy, turn, 12),
            secrets: normalizeUniqueItems(shadows.secrets, normalizeSecret, turn, 16),
        },
        influences: normalizeUniqueItems(source.influences, normalizeInfluence, turn, 16)
            .filter((item) => item.expiresTurn >= turn),
    };
}

export function emptyContinuityState(chatId = '') {
    return {
        version: 6,
        chatId: cleanText(chatId, 180),
        turn: 0,
        lastTick: {
            turn: 0,
            action: '',
            threadId: '',
            reason: '',
        },
        lastSource: null,
        threads: [],
        world: emptyWorldState(),
        scenarioPlan: emptyScenarioPlan(),
        nextTurnInjection: null,
        updatedAt: 0,
    };
}

function normalizeNextTurnInjectionTarget(value) {
    const source = value && typeof value === 'object' ? value : {};
    const chatId = cleanText(source.chatId, 180);
    const messageId = cleanText(source.messageId, 180);
    const generationId = cleanText(source.generationId, 180);
    const generationType = cleanText(source.generationType, 80);
    const scopeDigest = cleanText(source.scopeDigest, 180);
    const contentFingerprint = cleanText(source.contentFingerprint, 180);
    if (
        !chatId || !messageId || !generationId || !generationType
        || !scopeDigest || !contentFingerprint
    ) return null;
    return {
        chatId,
        index: boundedInteger(source.index, 0, Number.MAX_SAFE_INTEGER, 0),
        messageId,
        swipeId: boundedInteger(source.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        generationSerial: boundedInteger(
            source.generationSerial,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
        ),
        generationId,
        generationType,
        scopeDigest,
        contentFingerprint,
    };
}

function normalizeNextTurnInjectionConsumer(value) {
    const source = value && typeof value === 'object' ? value : {};
    const chatId = cleanText(source.chatId, 180);
    const generationId = cleanText(source.generationId, 180);
    if (!chatId || !generationId) return null;
    return {
        chatId,
        generationId,
        generationSerial: boundedInteger(
            source.generationSerial,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
        ),
    };
}

function normalizeNextTurnInjectionStartSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        index: boundedInteger(source.index, -1, Number.MAX_SAFE_INTEGER, -1),
        swipeId: boundedInteger(source.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        contentFingerprint: cleanText(source.contentFingerprint, 180),
    };
}

function normalizeNextTurnInjectionLease(value) {
    const source = value && typeof value === 'object' ? value : {};
    const state = ['reserved', 'released', 'cleanup_failed'].includes(source.state)
        ? source.state
        : 'reserved';
    const chatId = cleanText(source.chatId, 180);
    const generationId = cleanText(source.generationId, 180);
    const generationType = cleanText(source.generationType, 80);
    const scopeDigest = cleanText(source.scopeDigest, 180);
    const expectedScopeDigest = cleanText(source.expectedScopeDigest, 180);
    const consumerPayloadDigest = cleanText(source.consumerPayloadDigest, 240);
    if (
        !chatId
        || !generationId
        || !generationType
        || !scopeDigest
        || !expectedScopeDigest
        || scopeDigest !== expectedScopeDigest
        || !consumerPayloadDigest
    ) {
        return null;
    }
    return {
        state,
        chatId,
        generationId,
        generationSerial: boundedInteger(source.generationSerial, 0, Number.MAX_SAFE_INTEGER, 0),
        generationType,
        scopeDigest,
        expectedScopeDigest,
        consumerPayloadDigest,
        providerId: cleanText(source.providerId, 180),
        slotId: cleanText(source.slotId, 180),
        providerCleanupToken: cleanText(source.providerCleanupToken, 1200),
        cleanupConfirmed: source.cleanupConfirmed === true,
        start: normalizeNextTurnInjectionStartSnapshot(source.start),
        reservedAt: boundedInteger(source.reservedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        ...(state === 'released' || state === 'cleanup_failed'
            ? { releaseReason: cleanText(source.releaseReason, 180) }
            : {}),
    };
}

function normalizeNextTurnInjectionConsumeProof(value) {
    const source = value && typeof value === 'object' ? value : {};
    const chatId = cleanText(source.chatId, 180);
    const generationId = cleanText(source.generationId, 180);
    const generationType = cleanText(source.generationType, 80);
    const scopeDigest = cleanText(source.scopeDigest, 180);
    const messageId = cleanText(source.messageId, 180);
    const contentFingerprint = cleanText(source.contentFingerprint, 180);
    const consumerPayloadDigest = cleanText(source.consumerPayloadDigest, 240);
    if (
        !chatId || !generationId || !generationType || !scopeDigest
        || !messageId || !contentFingerprint || !consumerPayloadDigest
    ) return null;
    return {
        chatId,
        generationId,
        generationSerial: boundedInteger(source.generationSerial, 0, Number.MAX_SAFE_INTEGER, 0),
        generationType,
        scopeDigest,
        index: boundedInteger(source.index, 0, Number.MAX_SAFE_INTEGER, 0),
        messageId,
        swipeId: boundedInteger(source.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        contentFingerprint,
        consumerPayloadDigest,
        providerId: cleanText(source.providerId, 180),
        slotId: cleanText(source.slotId, 180),
        committedAt: boundedInteger(source.committedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function normalizeNextTurnSettlementProof(value) {
    const source = value && typeof value === 'object' ? value : {};
    const producerTarget = normalizeNextTurnInjectionTarget(source.producerTarget);
    const actorLedgerDigest = cleanText(source.actorLedgerDigest, 240);
    const targetActionAuthorityDigest = cleanText(source.targetActionAuthorityDigest, 240);
    const targetActionAttemptCount = boundedInteger(
        source.targetActionAttemptCount, 0, Number.MAX_SAFE_INTEGER, -1,
    );
    const targetActionReceiptCount = boundedInteger(
        source.targetActionReceiptCount, 0, Number.MAX_SAFE_INTEGER, -1,
    );
    const digest = cleanText(source.digest, 240);
    if (
        !producerTarget || !actorLedgerDigest || !targetActionAuthorityDigest || !digest
        || targetActionAttemptCount < 0 || targetActionReceiptCount < 0
        || !Array.isArray(source.orderedResults)
        || source.orderedResults.length > 120
    ) return null;
    const seen = new Set();
    const orderedResults = [];
    for (const raw of source.orderedResults) {
        const attemptId = cleanText(raw?.attemptId, 180);
        const id = cleanText(raw?.id, 180);
        const status = cleanText(raw?.status, 80);
        const actorRef = normalizeActorRefs([raw?.actorRef])[0] || null;
        const worldAdjudicationResult = raw?.worldAdjudicationResult;
        if (
            !attemptId
            || !id
            || !status
            || !actorRef
            || !worldAdjudicationResult
            || typeof worldAdjudicationResult !== 'object'
            || Array.isArray(worldAdjudicationResult)
            || seen.has(attemptId)
        ) return null;
        seen.add(attemptId);
        orderedResults.push({
            attemptId,
            id,
            status,
            actorRef,
            worldAdjudicationResult: clone(worldAdjudicationResult),
        });
    }
    orderedResults.sort((left, right) => left.attemptId.localeCompare(right.attemptId));
    return {
        producerTarget,
        actorLedgerDigest,
        targetActionAuthorityDigest,
        targetActionAttemptCount,
        targetActionReceiptCount,
        digest,
        orderedResults,
    };
}

function normalizeNextTurnInjection(value) {
    const source = value && typeof value === 'object' ? value : {};
    const producerTarget = normalizeNextTurnInjectionTarget(source.producerTarget);
    if (!producerTarget) return null;
    const status = ['pending', 'reserved', 'consumed'].includes(source.status)
        ? source.status
        : 'pending';
    const payload = source.payload && typeof source.payload === 'object'
        ? source.payload
        : {};
    const reservedFor = normalizeNextTurnInjectionConsumer(source.reservedFor);
    const consumedBy = normalizeNextTurnInjectionConsumer(source.consumedBy);
    const consumerLease = normalizeNextTurnInjectionLease(source.consumerLease);
    const consumeProof = normalizeNextTurnInjectionConsumeProof(source.consumeProof);
    if (status === 'reserved' && !reservedFor) return null;
    if (status === 'consumed' && !consumedBy) return null;
    return {
        version: boundedInteger(source.version, 1, 1, 1),
        status,
        producerTarget,
        sourceContinuityDigest: cleanText(source.sourceContinuityDigest, 16000),
        payload: {
            text: cleanText(payload.text, 12000),
            visibleThreadIds: cleanList(payload.visibleThreadIds, 4, 90),
            visibleWorldIds: cleanList(payload.visibleWorldIds, 16, 120),
        },
        payloadFormat: source.payloadFormat === 'canonical-bounded-v1'
            ? 'canonical-bounded-v1'
            : '',
        payloadDigest: cleanText(source.payloadDigest, 180),
        settlementProof: normalizeNextTurnSettlementProof(source.settlementProof),
        createdAt: boundedInteger(source.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
        ...(reservedFor ? { reservedFor } : {}),
        ...(consumedBy ? { consumedBy } : {}),
        ...(consumerLease ? { consumerLease } : {}),
        ...(consumeProof ? { consumeProof } : {}),
    };
}

export function continuityCoreSemanticFingerprint(overrides = {}) {
    return `continuity-core:${fingerprint(JSON.stringify({
        nextTurnTarget: String(
            overrides?.normalizeNextTurnInjectionTarget || normalizeNextTurnInjectionTarget,
        ),
        nextTurnConsumer: String(
            overrides?.normalizeNextTurnInjectionConsumer || normalizeNextTurnInjectionConsumer,
        ),
        nextTurnStartSnapshot: String(
            overrides?.normalizeNextTurnInjectionStartSnapshot
                || normalizeNextTurnInjectionStartSnapshot,
        ),
        nextTurnLease: String(
            overrides?.normalizeNextTurnInjectionLease || normalizeNextTurnInjectionLease,
        ),
        nextTurnConsumeProof: String(
            overrides?.normalizeNextTurnInjectionConsumeProof
                || normalizeNextTurnInjectionConsumeProof,
        ),
        nextTurnSettlementProof: String(
            overrides?.normalizeNextTurnSettlementProof || normalizeNextTurnSettlementProof,
        ),
        nextTurnInjection: String(
            overrides?.normalizeNextTurnInjection || normalizeNextTurnInjection,
        ),
        packetPayloadDigest: String(
            overrides?.continuityPacketPayloadDigest || continuityPacketPayloadDigest,
        ),
        packetText: String(
            overrides?.buildContinuityPacketText || buildContinuityPacketText,
        ),
        consumerPayload: String(
            overrides?.buildContinuityConsumerPayload || buildContinuityConsumerPayload,
        ),
        continuityState: String(
            overrides?.normalizeContinuityState || normalizeContinuityState,
        ),
        resolvedArchiveCompaction: String(
            overrides?.compressResolvedContinuityHistory || compressResolvedContinuityHistory,
        ),
        resolvedArchiveRollup: String(mergeResolvedArchiveRollup),
        resolvedTombstones: String(mergeMarkerRecords),
        globalHoldTerminal: String(
            overrides?.continuityGlobalHoldIsVerifiable
                || continuityGlobalHoldIsVerifiable,
        ),
        continuityPolicy: String(
            overrides?.enforceContinuityPolicy || enforceContinuityPolicy,
        ),
    }))}`;
}

export function normalizeSourceRef(value) {
    if (!value || typeof value !== 'object') return null;
    const chatId = cleanText(value.chatId, 180);
    const messageId = cleanText(value.messageId, 180);
    const contentHash = cleanText(value.contentHash || value.contentFingerprint || value.hash, 180);
    const contentFingerprint = cleanText(value.contentFingerprint || contentHash, 180);
    const hash = cleanText(value.hash || contentHash, 180);
    if (!chatId || !messageId || !hash) return null;
    const target = normalizeActorActionTarget(value.target);
    const logicalIndex = boundedInteger(
        value.logicalIndex ?? value.index,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const generation = boundedInteger(
        value.generation ?? value.generationSerial,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const generationSerial = boundedInteger(
        value.generationSerial ?? value.generation,
        0,
        Number.MAX_SAFE_INTEGER,
        generation,
    );
    return {
        chatId,
        messageId,
        logicalIndex,
        index: boundedInteger(value.index ?? value.logicalIndex, 0, Number.MAX_SAFE_INTEGER, logicalIndex),
        swipeId: boundedInteger(value.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        generation,
        generationSerial,
        generationId: cleanText(value.generationId, 180),
        generationType: cleanText(value.generationType || value.type, 80),
        type: cleanText(value.type || value.generationType, 80),
        identityScope: value.identityScope && typeof value.identityScope === 'object'
            ? structuredClone(value.identityScope)
            : cleanText(value.identityScope, 500),
        identityScopeId: cleanText(value.identityScopeId, 180),
        scope: value.scope && typeof value.scope === 'object'
            ? structuredClone(value.scope)
            : cleanText(value.scope, 500),
        scopeDigest: cleanText(value.scopeDigest, 180),
        hash,
        contentHash,
        contentFingerprint,
        ...(target ? { target } : {}),
    };
}

function normalizeThread(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const fallbackId = `PT-${String(index + 1).padStart(2, '0')}`;
    const id = cleanText(value.id || fallbackId, 90)
        .replace(/[^\p{L}\p{N}_.:\-]/gu, '-');
    const title = cleanText(value.title || value.summary || id, 120);
    const summary = cleanText(value.summary, 700);
    if (!id || (!title && !summary)) return null;
    const stage = STAGES.has(value.stage) ? value.stage : 'seeded';
    const kind = KINDS.has(value.kind) ? value.kind : 'parallel';
    const knowledge = KNOWLEDGE.has(value.knowledge)
        ? value.knowledge
        : (stage === 'manifested' || stage === 'resolved' ? 'observed' : 'hidden');
    const origin = ORIGINS.has(value.origin) ? value.origin : 'main_derivative';
    const relation = RELATIONS.has(value.relation)
        ? value.relation
        : (origin === 'main_derivative' ? 'linked'
            : origin === 'setting_linked' ? 'latent' : 'independent');
    const refs = (Array.isArray(value.sourceRefs) ? value.sourceRefs : [])
        .map(normalizeSourceRef)
        .filter(Boolean)
        .slice(-8);
    const convergenceSource = value.convergence && typeof value.convergence === 'object'
        ? value.convergence
        : {};
    const convergenceChannels = cleanList(convergenceSource.channels, 7)
        .filter((channel) => CONVERGENCE_CHANNELS.has(channel));
    const actorRefs = normalizeActorRefs(
        Array.isArray(value.actorRefs) && value.actorRefs.length
            ? value.actorRefs
            : value.actors,
    );
    return {
        id,
        title,
        kind,
        eventType: EVENT_TYPES.has(value.eventType) ? value.eventType : (
            ['promise', 'personal'].includes(kind) ? 'progress' : 'conflict'
        ),
        level: boundedInteger(value.level, 1, 4, 1),
        origin,
        relation,
        stage,
        summary,
        offscreenBeat: cleanText(value.offscreenBeat, 500),
        nextBeat: cleanText(value.nextBeat, 500),
        trigger: cleanText(value.trigger, 350),
        intersection: cleanText(value.intersection, 450),
        seedBasis: cleanText(value.seedBasis, 400),
        causedBy: cleanList(value.causedBy, 6),
        effects: cleanList(value.effects, 12),
        rumors: cleanList(value.rumors, 8),
        resolution: cleanText(value.resolution, 700),
        actors: cleanList(value.actors),
        actorRefs,
        locations: cleanList(value.locations),
        propagation: cleanList(value.propagation, 12),
        convergence: {
            score: boundedInteger(convergenceSource.score, 0, 4, 0),
            channels: convergenceChannels,
            evidence: cleanList(convergenceSource.evidence, 8),
            entryBeat: cleanText(convergenceSource.entryBeat, 500),
            lastCheckedTurn: boundedInteger(
                convergenceSource.lastCheckedTurn,
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
        },
        knowledge,
        urgency: boundedInteger(value.urgency, 0, 3, 1),
        stageProgress: stage === 'resolved'
            ? 9
            : boundedInteger(value.stageProgress, 1, 8, 1),
        evolveResult: EVENT_RESULTS.has(value.evolveResult) ? value.evolveResult : '',
        consecutiveFails: boundedInteger(value.consecutiveFails, 0, 99, 0),
        stalled: value.stalled === true,
        outcome: EVENT_OUTCOMES.has(value.outcome) ? value.outcome : '',
        createdTurn: boundedInteger(
            value.createdTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            turn,
        ),
        lastAdvancedTurn: boundedInteger(
            value.lastAdvancedTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            turn,
        ),
        resolvedTurn: stage === 'resolved'
            ? boundedInteger(
                value.resolvedTurn,
                0,
                Number.MAX_SAFE_INTEGER,
                value.lastAdvancedTurn ?? turn,
            )
            : 0,
        sourceRefs: refs,
    };
}

function normalizeTick(value, turn) {
    const source = value && typeof value === 'object' ? value : {};
    const action = TICK_ACTIONS.has(source.action) ? source.action : '';
    return {
        turn: boundedInteger(source.turn, 0, Number.MAX_SAFE_INTEGER, action ? turn : 0),
        action,
        threadId: cleanText(source.threadId, 90),
        reason: cleanText(source.reason, 500),
    };
}

export function normalizeContinuityState(value, {
    chatId = '',
    // Active/dormant continuity is canonical history and is never display-
    // truncated. Resolved history has a separate bounded archive so old
    // process logs cannot grow forever while durable effects/source evidence
    // remain recoverable.
    maxThreads = null,
    maxResolved = 24,
} = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const turn = boundedInteger(source.turn, 0, Number.MAX_SAFE_INTEGER, 0);
    const allThreads = [];
    const used = new Set();
    for (const item of Array.isArray(source.threads) ? source.threads : []) {
        const thread = normalizeThread(item, allThreads.length, turn);
        if (!thread || used.has(thread.id)) continue;
        used.add(thread.id);
        allThreads.push(thread);
    }
    const resolvedLimit = Number.isInteger(Number(maxResolved))
        ? Math.max(0, Number(maxResolved))
        : 24;
    const existingArchive = (Array.isArray(source.resolvedArchive)
        ? source.resolvedArchive : [])
        .map((entry) => compactResolvedHistoryEntry(entry))
        .filter(Boolean);
    const resolvedThreads = allThreads.filter((thread) => thread.stage === 'resolved');
    const retainedResolved = new Set(resolvedThreads
        .map((thread, index) => ({ thread, index }))
        .sort((left, right) => (
            (Number(left.thread.resolvedTurn) || 0) - (Number(right.thread.resolvedTurn) || 0)
            || left.index - right.index
        ))
        .slice(-resolvedLimit)
        .map(({ thread }) => thread.id));
    const archivedFromThreads = resolvedThreads
        .filter((thread) => !retainedResolved.has(thread.id))
        .map(compactResolvedHistoryEntry)
        .filter(Boolean);
    const archiveById = new Map();
    for (const entry of [...existingArchive, ...archivedFromThreads]) {
        if (entry?.id) archiveById.set(entry.id, entry);
    }
    for (const id of retainedResolved) archiveById.delete(id);
    const archiveLimit = Math.max(32, Math.min(128, resolvedLimit * 4 || 32));
    const archiveCandidates = [...archiveById.values()]
        .sort((left, right) => (
            (Number(left.resolvedTurn) || 0) - (Number(right.resolvedTurn) || 0)
        ));
    const archiveOverflow = archiveCandidates.length > archiveLimit
        ? archiveCandidates.slice(0, archiveCandidates.length - archiveLimit)
        : [];
    const resolvedArchive = archiveCandidates.slice(-archiveLimit);
    const resolvedArchiveRollup = mergeResolvedArchiveRollup(
        source.resolvedArchiveRollup,
        archiveOverflow,
    );
    const retainedThreads = allThreads.filter((thread) => (
        thread.stage !== 'resolved' || retainedResolved.has(thread.id)
    ));
    // maxThreads remains accepted for compatibility and is intentionally not
    // applied: an active/dormant thread is never discarded as a display item.
    void maxThreads;
    const dormant = retainedThreads.filter((thread) => thread.stage === 'dormant');
    return {
        version: 6,
        chatId: cleanText(chatId || source.chatId, 180),
        turn,
        lastTick: normalizeTick(source.lastTick, turn),
        lastSource: normalizeSourceRef(source.lastSource),
        threads: retainedThreads,
        resolvedArchive,
        resolvedArchiveRollup,
        world: normalizeWorldState(source.world, { turn }),
        scenarioPlan: normalizeScenarioPlan(source.scenarioPlan, { turn }),
        nextTurnInjection: normalizeNextTurnInjection(source.nextTurnInjection),
        droppedCount: resolvedArchive.length,
        deferredCount: dormant.length,
        updatedAt: boundedInteger(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function compactResolvedHistoryEntry(thread) {
    if (!thread || typeof thread !== 'object') return null;
    const refs = Array.isArray(thread.sourceRefs) ? thread.sourceRefs.filter(Boolean) : [];
    const sourceRefs = refs.length <= 2
        ? refs
        : [refs[0], refs.at(-1)].filter((ref, index, list) => (
            ref && list.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(ref)) === index
        ));
    return {
        id: cleanText(thread.id, 120),
        title: cleanText(thread.title, 240),
        origin: cleanText(thread.origin, 80),
        relation: cleanText(thread.relation, 80),
        resolution: cleanText(thread.resolution, 1200),
        effects: clone(Array.isArray(thread.effects) ? thread.effects : []),
        rumors: clone(Array.isArray(thread.rumors) ? thread.rumors : []),
        trigger: cleanText(thread.trigger || thread.futureTrigger, 800),
        futureTrigger: cleanText(thread.futureTrigger || thread.trigger, 800),
        actors: clone(Array.isArray(thread.actors) ? thread.actors : []),
        actorRefs: clone(Array.isArray(thread.actorRefs) ? thread.actorRefs : []),
        locations: clone(Array.isArray(thread.locations) ? thread.locations : []),
        causedBy: clone(Array.isArray(thread.causedBy) ? thread.causedBy : []),
        resolvedTurn: boundedInteger(thread.resolvedTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        sourceRefs: clone(sourceRefs),
    };
}

function mergeResolvedArchiveRollup(previous, entries) {
    const source = previous && typeof previous === 'object' ? previous : {};
    const unique = (values, max) => [...new Set((Array.isArray(values) ? values : [])
        .map((value) => cleanText(value, 700)).filter(Boolean))].slice(-max);
    const compact = (entry) => ({
        id: cleanText(entry?.id, 120),
        resolvedTurn: boundedInteger(entry?.resolvedTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        effects: unique(entry?.effects, 16),
        rumors: unique(entry?.rumors, 12),
        triggers: unique([entry?.trigger, entry?.futureTrigger], 8),
        causedBy: unique(entry?.causedBy, 12),
        actors: unique([
            ...(Array.isArray(entry?.actors) ? entry.actors : []),
            ...(Array.isArray(entry?.actorRefs) ? entry.actorRefs.map((ref) => ref?.actorId) : []),
        ], 12),
        locations: unique(entry?.locations, 12),
        sourceRefs: Array.isArray(entry?.sourceRefs) ? clone(entry.sourceRefs).slice(0, 2) : [],
    });
    const records = [...(Array.isArray(source.records) ? source.records : []),
        ...(entries || []).map(compact)]
        .filter((entry) => entry.id);
    const byId = new Map(records.map((entry) => [entry.id, entry]));
    const boundedRecords = [...byId.values()].sort((left, right) => (
        (Number(left.resolvedTurn) || 0) - (Number(right.resolvedTurn) || 0)
    ));
    const tombstoneThroughTurn = Math.max(
        Number(source.tombstoneThroughTurn) || 0,
        ...boundedRecords.map((entry) => Number(entry.resolvedTurn) || 0),
    );
    const mergeFacts = (key, max) => unique([
        ...(Array.isArray(source[key]) ? source[key] : []),
        ...boundedRecords.flatMap((entry) => entry[key] || []),
    ], max);
    return {
        version: 1,
        overflowCount: Math.max(0, Number(source.overflowCount) || 0) + entries.length,
        tombstoneThroughTurn,
        threadIds: unique([
            ...(Array.isArray(source.threadIds) ? source.threadIds : []),
            ...boundedRecords.map((entry) => entry.id),
        ], 256),
        effects: mergeFacts('effects', 512),
        rumors: mergeFacts('rumors', 512),
        triggers: mergeFacts('triggers', 512),
        causedBy: mergeFacts('causedBy', 512),
        actors: mergeFacts('actors', 512),
        locations: mergeFacts('locations', 512),
        sourceRefs: [
            ...(Array.isArray(source.sourceRefs) ? source.sourceRefs : []),
            ...boundedRecords.flatMap((entry) => entry.sourceRefs || []),
        ].filter(Boolean).slice(0, 256),
    };
}

function resolvedTombstoneGuard(state) {
    const source = state && typeof state === 'object' ? state : {};
    return {
        archivedIds: new Set([
            ...(Array.isArray(source.resolvedArchive)
                ? source.resolvedArchive.map((entry) => entry?.id)
                : []),
            ...(Array.isArray(source.resolvedArchiveRollup?.threadIds)
                ? source.resolvedArchiveRollup.threadIds
                : []),
        ].map((id) => cleanText(id, 120)).filter(Boolean)),
        tombstoneThroughTurn: Number(
            source.resolvedArchiveRollup?.tombstoneThroughTurn,
        ) || 0,
    };
}

function resolvedCandidateIsBlocked(thread, guard) {
    if (!thread || typeof thread !== 'object') return true;
    if (guard.archivedIds.has(thread.id)) return true;
    if (thread.stage === 'resolved') return false;
    const candidateTurns = [
        Number(thread.lastAdvancedTurn) || 0,
        Number(thread.createdTurn) || 0,
    ].filter((turn) => turn > 0);
    return guard.tombstoneThroughTurn > 0
        && candidateTurns.length > 0
        && candidateTurns.some((turn) => turn <= guard.tombstoneThroughTurn);
}

export function compressResolvedContinuityHistory(previous, next = null, {
    maxResolved = 24,
    explicitMigration = false,
} = {}) {
    const before = normalizeContinuityState(previous, { maxResolved });
    const after = normalizeContinuityState(next == null ? previous : next, { maxResolved });
    const beforeById = new Map(before.threads.map((thread) => [thread.id, thread]));
    const newlyResolved = new Set(after.threads
        .filter((thread) => (
            thread.stage === 'resolved'
            && beforeById.get(thread.id)?.stage !== 'resolved'
        ))
        .map((thread) => thread.id));
    const compact = (thread) => ({
        ...thread,
        // Keep durable meaning and source evidence; discard only process
        // narration/convergence diagnostics from this newly resolved turn.
        offscreenBeat: '',
        nextBeat: '',
        intersection: '',
        propagation: [],
        convergence: {
            score: 0,
            channels: [],
            evidence: [],
            entryBeat: '',
            lastCheckedTurn: 0,
        },
        consecutiveFails: 0,
        evolveResult: '',
        stalled: false,
        sourceRefs: compactResolvedHistoryEntry(thread)?.sourceRefs || [],
    });
    const compacted = {
        ...after,
        threads: after.threads.map((thread) => (
            newlyResolved.has(thread.id) ? compact(thread) : thread
        )),
    };
    // Ordinary settlement compacts only newly resolved rows. Older resolved
    // rows are moved to the durable bounded archive by normalization; their
    // effects/rumors/triggers/source endpoints remain available there.
    void explicitMigration;
    return normalizeContinuityState(compacted, { maxResolved });
}

function advanceThreadClock(thread, random) {
    const next = clone(thread);
    if (['resolved', 'dormant'].includes(next.stage)) {
        next.evolveResult = '';
        return next;
    }
    const level = boundedInteger(next.level, 1, 4, 1);
    const maximumFails = next.eventType === 'progress'
        ? 2 + level
        : Math.max(1, 6 - level);
    let successful = next.consecutiveFails >= maximumFails;
    let result = 'success';
    if (!successful) {
        const ratio = Math.min(1, next.stageProgress / 9);
        const stageBase = EVENT_PHASE_BASE[next.eventType]?.[next.stage] || 85;
        const levelAdjust = next.eventType === 'progress'
            ? (level - 1) * 10
            : -((level - 1) * 10);
        const threshold = Math.round(
            stageBase - 200 * ratio * (1 - ratio) + levelAdjust,
        );
        const dice = Math.floor(Math.max(0, Math.min(0.999999, random())) * 100) + 1;
        successful = dice > threshold;
        if (!successful) {
            result = dice < threshold * 0.4 ? 'setback' : 'hold';
        }
    }
    if (successful) {
        next.stageProgress += 1;
        next.consecutiveFails = 0;
        if (next.stageProgress >= 9) {
            const phases = ['seeded', 'advancing', 'manifested'];
            const index = phases.indexOf(next.stage);
            if (index >= 0 && index < phases.length - 1) {
                next.stage = phases[index + 1];
                next.stageProgress = 1;
            } else {
                next.stage = 'resolved';
                next.stageProgress = 9;
                next.outcome = 'succeeded';
            }
        }
    } else {
        next.consecutiveFails += 1;
        if (result === 'setback') {
            next.stageProgress = Math.max(1, next.stageProgress - 1);
        }
    }
    next.evolveResult = result;
    return next;
}

function decayWorldClocks(world, turn, random) {
    const next = clone(world);
    const decay = {
        notice: {
            shelterTurns: 3, strengthBuffer: 3, cadence: 4,
            openingRisk: 12, bandRisk: 14, withinBandRisk: 2,
        },
        report: {
            shelterTurns: 1, strengthBuffer: 4, cadence: 5,
            openingRisk: 15, bandRisk: 12, withinBandRisk: 2,
        },
        rumor: {
            shelterTurns: 0, strengthBuffer: 5, cadence: 3,
            openingRisk: 18, bandRisk: 13, withinBandRisk: 3,
        },
        sentiment: {
            shelterTurns: 5, strengthBuffer: 2, cadence: 6,
            openingRisk: 9, bandRisk: 10, withinBandRisk: 1,
        },
    };
    next.winds = next.winds.filter((wind) => {
        const params = decay[wind.type] || decay.rumor;
        wind.quietTurns = Math.max(0, Number(wind.quietTurns) || 0) + 1;
        const strength = Math.max(1, Math.min(5, Number(wind.strength) || 1));
        const exposedTurns = wind.quietTurns
            - params.shelterTurns
            - (strength - 1) * params.strengthBuffer;
        if (exposedTurns <= 0) return true;
        const elapsed = exposedTurns - 1;
        const band = Math.floor(elapsed / params.cadence);
        const withinBand = elapsed % params.cadence;
        const chance = Math.min(92, Math.max(
            4,
            params.openingRisk
                + band * params.bandRisk
                + withinBand * params.withinBandRisk,
        ));
        return Math.floor(Math.max(0, Math.min(0.999999, random())) * 100) + 1
            > chance;
    });
    next.environment.incidents = next.environment.incidents.map((incident) => {
        if (incident.status !== 'active' || incident.remainingTurns <= 0) return incident;
        const updated = clone(incident);
        updated.remainingTurns -= 1;
        if (updated.remainingTurns <= 0) {
            updated.status = 'cooldown';
            updated.lastChange = '持续期结束，进入冷却';
            updated.updatedTurn = turn;
        }
        return updated;
    });
    next.influences = next.influences.filter((item) => item.expiresTurn >= turn);
    return next;
}

export function advanceContinuityClocks(value, {
    chatId = '',
    maxThreads = 8,
    random = Math.random,
} = {}) {
    const state = normalizeContinuityState(value, { chatId, maxThreads });
    const beforeThreads = new Map(state.threads.map((thread) => [thread.id, thread]));
    state.threads = state.threads.map((thread) => advanceThreadClock(thread, random));
    state.world = decayWorldClocks(state.world, state.turn + 1, random);
    const changedThreadIds = state.threads
        .filter((thread) => (
            stableThreadContent(beforeThreads.get(thread.id)) !== stableThreadContent(thread)
        ))
        .map((thread) => thread.id);
    return {
        state,
        changedThreadIds,
    };
}

export function scheduleWorldLanes(value, {
    turn,
    maxLanes = 2,
    factionSlots = null,
    environmentSlots = null,
    receiptScope = '',
} = {}) {
    const state = normalizeContinuityState(value, { maxThreads: 12 });
    const scheduledTurn = boundedInteger(
        turn,
        state.turn,
        Number.MAX_SAFE_INTEGER,
        state.turn,
    );
    const limit = boundedInteger(maxLanes, 0, 8, 2);
    const factionLimit = factionSlots === null || factionSlots === undefined
        ? limit
        : boundedInteger(factionSlots, 0, 4, limit);
    const environmentLimit = environmentSlots === null || environmentSlots === undefined
        ? limit
        : boundedInteger(environmentSlots, 0, 4, limit);
    const candidates = [];
    const addCandidate = ({
        laneType,
        sourceId,
        label,
        updatedTurn = 0,
        baseScore = 0,
        dueScore = 0,
        dueReason = '',
        knowledge = 'hidden',
        sourceThreads = [],
    }) => {
        const silenceTurns = Math.max(0, scheduledTurn - Number(updatedTurn || 0));
        candidates.push({
            laneType,
            channel: laneType === 'faction' ? 'faction' : 'environment',
            sourceId,
            label: cleanText(label, 180),
            score: baseScore + dueScore + Math.min(18, silenceTurns * 2),
            due: dueScore > 0,
            dueReason: cleanText(
                dueReason || `已沉默${silenceTurns}轮，进入低频世界探索`,
                300,
            ),
            silenceTurns,
            knowledge: KNOWLEDGE.has(knowledge) ? knowledge : 'hidden',
            sourceThreads: cleanList(sourceThreads, 8),
            independentOfActors: true,
        });
    };

    for (const item of state.world.environment.incidents) {
        if (item.status === 'resolved') continue;
        const remaining = Number(item.remainingTurns || 0);
        const due = item.status === 'active' && remaining <= 1;
        addCandidate({
            laneType: 'environment',
            sourceId: item.id,
            label: item.title,
            updatedTurn: item.updatedTurn,
            baseScore: item.status === 'active' ? 80 : 45,
            dueScore: due ? 35 : 0,
            dueReason: due
                ? `环境事件剩余窗口${remaining}轮，必须结算、转入冷却或说明具体阻塞`
                : item.lastChange || item.summary,
            knowledge: item.knowledge,
            sourceThreads: item.sourceThreads,
        });
    }
    if (state.world.environment.summary) {
        addCandidate({
            laneType: 'environment',
            sourceId: 'environment:ambient',
            label: `环境变化：${state.world.environment.summary}`,
            updatedTurn: state.world.environment.updatedTurn,
            baseScore: 48,
            dueScore: 0,
            dueReason: state.world.environment.summary,
            knowledge: 'observed',
        });
    }
    if (state.world.environment.economy !== 'stable') {
        addCandidate({
            laneType: 'environment',
            sourceId: 'environment:economy',
            label: `经济状态：${state.world.environment.economy}`,
            updatedTurn: state.world.environment.updatedTurn,
            baseScore: 58,
            dueScore: 0,
            dueReason: state.world.environment.basis
                || state.world.environment.summary,
            knowledge: 'observed',
        });
    }
    for (const item of state.world.factions) {
        if (item.condition === 'collapsed') continue;
        const pressure = {
            dominant: 4,
            stable: 0,
            divided: 12,
            strained: 20,
            declining: 24,
        }[item.condition] || 0;
        addCandidate({
            laneType: 'faction',
            sourceId: item.id,
            label: item.name,
            updatedTurn: item.updatedTurn,
            baseScore: 60 + pressure,
            dueScore: pressure >= 20 ? 8 : 0,
            dueReason: item.goal || item.lastChange || item.summary,
            knowledge: item.knowledge,
            sourceThreads: item.sourceThreads,
        });
    }
    for (const item of state.world.trends) {
        if (item.status !== 'active') continue;
        addCandidate({
            laneType: 'trend',
            sourceId: item.id,
            label: item.name,
            updatedTurn: item.updatedTurn,
            baseScore: 50,
            dueReason: item.summary || item.source,
            knowledge: item.knowledge,
            sourceThreads: item.sourceThreads,
        });
    }
    for (const item of state.world.winds) {
        const expiresSoon = item.expiresTurn > 0
            && item.expiresTurn <= scheduledTurn + 1;
        addCandidate({
            laneType: 'public_signal',
            sourceId: item.id,
            label: item.topic,
            updatedTurn: item.updatedTurn,
            baseScore: 42 + item.strength * 5,
            dueScore: expiresSoon ? 12 : 0,
            dueReason: expiresSoon
                ? `传播窗口将在第${item.expiresTurn}轮结束`
                : item.content || item.source,
            knowledge: item.knowledge,
            sourceThreads: item.sourceThreads,
        });
    }
    for (const item of state.world.influences) {
        const expiresSoon = item.expiresTurn <= scheduledTurn + 1;
        addCandidate({
            laneType: 'causal',
            sourceId: item.id,
            label: item.trigger,
            updatedTurn: item.updatedTurn,
            baseScore: 52,
            dueScore: expiresSoon ? 18 : 0,
            dueReason: expiresSoon
                ? `因果余波窗口将在第${item.expiresTurn}轮结束`
                : item.fallout || item.impact,
            knowledge: item.knowledge,
            sourceThreads: item.sourceThreads,
        });
    }
    for (const item of state.world.shadows?.enemies || []) {
        addCandidate({
            laneType: 'shadow_enemy', sourceId: item.id, label: item.name,
            updatedTurn: item.updatedTurn, baseScore: 56,
            dueScore: item.status === 'active' ? 10 : 0,
            dueReason: item.summary || item.goal || item.lastChange,
            knowledge: item.knowledge, sourceThreads: item.sourceThreads,
        });
    }
    for (const item of state.world.shadows?.secrets || []) {
        addCandidate({
            laneType: 'shadow_secret', sourceId: item.id, label: item.title,
            updatedTurn: item.updatedTurn, baseScore: 44,
            dueScore: item.status === 'active' ? 8 : 0,
            dueReason: item.summary || item.basis,
            knowledge: item.knowledge, sourceThreads: item.sourceThreads,
        });
    }
    for (const [key, value] of Object.entries(state.world.reputation || {})) {
        if (!value || (!value.summary && !value.basis && Number(value.level) === 0)) continue;
        addCandidate({
            laneType: 'reputation', sourceId: `reputation:${key}`, label: `声誉：${key}`,
            updatedTurn: value.updatedTurn, baseScore: 40 + Math.abs(Number(value.level) || 0) * 6,
            dueReason: value.summary || value.basis, knowledge: 'observed',
        });
    }

    const sorted = candidates.sort((left, right) => (
        right.score - left.score
        || Number(right.due) - Number(left.due)
        || right.silenceTurns - left.silenceTurns
        || left.laneType.localeCompare(right.laneType)
        || left.sourceId.localeCompare(right.sourceId)
    ));
    const selected = [];
    const selectedByChannel = { faction: 0, environment: 0 };
    const channelLimit = { faction: factionLimit, environment: environmentLimit };
    for (const candidate of sorted) {
        if (selected.length >= limit) break;
        if (selectedByChannel[candidate.channel] >= channelLimit[candidate.channel]) continue;
        selected.push(candidate);
        selectedByChannel[candidate.channel] += 1;
    }
    const scope = cleanText(receiptScope, 260)
        .replace(/[^\p{L}\p{N}_.:-]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    const receipts = selected.map((candidate, index) => ({
        receiptId: `world-lane:${scope ? `${scope}:` : ''}${scheduledTurn}:${candidate.laneType}:${candidate.sourceId}`,
        turn: scheduledTurn,
        rank: index + 1,
        laneType: candidate.laneType,
        channel: candidate.channel,
        sourceId: candidate.sourceId,
        status: candidate.due ? 'scheduled' : 'retained',
        due: candidate.due,
        mode: candidate.due ? 'settlement' : 'exploration',
        dueReason: candidate.dueReason,
        independentOfActors: true,
    }));
    return {
        turn: scheduledTurn,
        maxLanes: limit,
        factionSlots: factionLimit,
        environmentSlots: environmentLimit,
        // Full normalized/sorted projection is read-only recall input.  The
        // selected budget remains the Advance priority, never a filter that
        // erases offscreen/due lanes before recall can inspect them.
        candidates: clone(sorted),
        selected,
        receipts,
    };
}

export function continuityLedgerView(value, {
    chatId = '',
    maxThreads = 12,
} = {}) {
    const state = normalizeContinuityState(value, { chatId, maxThreads });
    const items = state.threads
        .map((thread) => {
            const latestSource = thread.sourceRefs.at(-1) || null;
            return {
                ...clone(thread),
                stageLabel: EVENT_PHASE_LABELS[thread.eventType]?.[thread.stage]
                    || CONTINUITY_STAGE_LABELS[thread.stage]
                    || thread.stage,
                kindLabel: CONTINUITY_KIND_LABELS[thread.kind] || thread.kind,
                originLabel: CONTINUITY_ORIGIN_LABELS[thread.origin] || thread.origin,
                relationLabel: CONTINUITY_RELATION_LABELS[thread.relation]
                    || thread.relation,
                knowledgeLabel: CONTINUITY_KNOWLEDGE_LABELS[thread.knowledge]
                    || thread.knowledge,
                urgencyLabel: CONTINUITY_URGENCY_LABELS[thread.urgency]
                    || CONTINUITY_URGENCY_LABELS[1],
                latestSource,
                isResolved: thread.stage === 'resolved',
                isSpoiler: thread.knowledge === 'hidden'
                    && !['linked', 'converging'].includes(thread.relation)
                    && !['manifested', 'resolved'].includes(thread.stage),
            };
        })
        .sort((left, right) => (
            (STAGE_SORT_ORDER[left.stage] ?? 9) - (STAGE_SORT_ORDER[right.stage] ?? 9)
            || right.urgency - left.urgency
            || right.lastAdvancedTurn - left.lastAdvancedTurn
            || left.title.localeCompare(right.title, 'zh-CN')
        ));
    const active = items.filter((thread) => !thread.isResolved);
    const resolved = items.filter((thread) => thread.isResolved);
    const echoes = items.flatMap((thread) => thread.rumors.map((content, index) => ({
        id: `${thread.id}:rumor:${index}`,
        threadId: thread.id,
        threadTitle: thread.title,
        content,
        knowledge: thread.knowledge,
        stage: thread.stage,
        isSpoiler: thread.isSpoiler,
    }))).slice(0, 16);
    const world = clone(state.world);
    const scenarioPlan = clone(state.scenarioPlan);
    scenarioPlan.statusLabel = SCENARIO_STATUS_LABELS[scenarioPlan.status]
        || scenarioPlan.status;
    scenarioPlan.phaseLabel = SCENARIO_PHASE_LABELS[scenarioPlan.current.phase]
        || scenarioPlan.current.phase;
    scenarioPlan.amendments = scenarioPlan.amendments.map((item) => ({
        ...item,
        causeLabel: SCENARIO_CAUSE_LABELS[item.causeType] || item.causeType,
    }));
    scenarioPlan.latestAmendment = scenarioPlan.amendments.at(-1) || null;
    const visibleWorldCount = [
        ...world.trends,
        ...world.factions,
        ...world.winds,
        ...world.environment.incidents,
        ...world.shadows.enemies,
        ...world.shadows.secrets,
        ...world.influences,
    ].length;
    return {
        turn: state.turn,
        updatedAt: state.updatedAt,
        lastTick: clone(state.lastTick),
        activeCount: active.length,
        dormantCount: active.filter((thread) => thread.stage === 'dormant').length,
        resolvedCount: resolved.length,
        echoCount: echoes.length,
        active,
        resolved,
        echoes,
        world,
        scenarioPlan,
        worldCount: visibleWorldCount,
        worldCounts: {
            factions: world.factions.length,
            winds: world.winds.length + echoes.length,
            reputation: REPUTATION_KEYS.filter((key) => (
                world.reputation[key].level !== 0
                || world.reputation[key].summary
            )).length,
            environment: world.environment.incidents.length
                + world.trends.length
                + (world.environment.summary ? 1 : 0),
            shadows: world.shadows.enemies.length + world.shadows.secrets.length,
            influences: world.influences.length,
        },
    };
}

function stableThreadContent(thread) {
    const copy = clone(thread);
    delete copy.sourceRefs;
    delete copy.createdTurn;
    delete copy.lastAdvancedTurn;
    delete copy.resolvedTurn;
    return JSON.stringify(copy);
}

function stableWorldContent(value) {
    const copy = clone(value);
    const stripTurn = (item) => {
        if (item && typeof item === 'object') delete item.updatedTurn;
        return item;
    };
    for (const item of copy.trends || []) stripTurn(item);
    for (const item of copy.factions || []) stripTurn(item);
    for (const item of copy.winds || []) stripTurn(item);
    for (const item of Object.values(copy.reputation || {})) stripTurn(item);
    stripTurn(copy.environment);
    for (const item of copy.environment?.incidents || []) stripTurn(item);
    for (const item of copy.shadows?.enemies || []) stripTurn(item);
    for (const item of copy.shadows?.secrets || []) stripTurn(item);
    for (const item of copy.influences || []) stripTurn(item);
    return JSON.stringify(copy);
}

function stableScenarioContent(value) {
    const copy = clone(value);
    delete copy.updatedTurn;
    delete copy.baselineSourceRef;
    for (const amendment of copy.amendments || []) {
        delete amendment.sourceRef;
    }
    return JSON.stringify(copy);
}

export function continuityWorldDigest(state) {
    const normalized = normalizeContinuityState(state, {
        maxThreads: 24,
        maxResolved: 24,
    });
    return stableWorldContent(normalized.world);
}

export function continuityScenarioDigest(state) {
    const normalized = normalizeContinuityState(state, {
        maxThreads: 24,
        maxResolved: 24,
    });
    return stableScenarioContent(normalized.scenarioPlan);
}

export function continuityLifecycleDigest(state) {
    const normalized = normalizeContinuityState(state, { maxThreads: 24, maxResolved: 24 });
    return JSON.stringify(
        normalized.threads.map((thread) => [thread.id, stableThreadContent(thread)]),
    );
}

export function continuityLifecycleStats(previous, next) {
    const before = normalizeContinuityState(previous, { maxThreads: 24, maxResolved: 24 });
    const after = normalizeContinuityState(next, { maxThreads: 24, maxResolved: 24 });
    const oldById = new Map(before.threads.map((thread) => [thread.id, thread]));
    const newById = new Map(after.threads.map((thread) => [thread.id, thread]));
    const changedExisting = after.threads.filter((thread) => {
        const old = oldById.get(thread.id);
        return old && stableThreadContent(old) !== stableThreadContent(thread);
    });
    const added = after.threads.filter((thread) => !oldById.has(thread.id));
    const schedulerAdvanced = after.lastTick.turn > before.lastTick.turn
        && !!after.lastTick.action
        && !!after.lastTick.reason;
    return {
        activeBefore: before.threads.filter((thread) => thread.stage !== 'resolved').length,
        changedExisting: changedExisting.length,
        added: added.length,
        newlyResolved: changedExisting.filter((thread) => thread.stage === 'resolved').length,
        removed: before.threads.filter((thread) => !newById.has(thread.id)).length,
        schedulerAdvanced,
        tickAction: after.lastTick.action,
    };
}

export function continuityGlobalHoldIsVerifiable(previous, next) {
    const before = normalizeContinuityState(previous, { maxThreads: 24, maxResolved: 24 });
    const after = normalizeContinuityState(next, { maxThreads: 24, maxResolved: 24 });
    const lifecycle = continuityLifecycleStats(before, after);
    return after.turn === before.turn
        && after.lastTick.turn === before.turn
        && after.lastTick.action === 'held'
        && after.lastTick.threadId === 'WORLD'
        && after.lastTick.reason.length >= 8
        && before.threads.every((thread) => thread.stage === 'resolved')
        && lifecycle.changedExisting === 0
        && lifecycle.added === 0
        && lifecycle.removed === 0
        && continuityWorldDigest(before) === continuityWorldDigest(after)
        && continuityScenarioDigest(before) === continuityScenarioDigest(after);
}

function nextWorldId(items, prefix) {
    let number = 1;
    const used = new Set(items.map((item) => item.id));
    while (used.has(`${prefix}-${String(number).padStart(2, '0')}`)) number += 1;
    return `${prefix}-${String(number).padStart(2, '0')}`;
}

function mergeWorldItems(current, updates, {
    prefix,
    identityKey,
    turn,
    cap,
    wind = false,
} = {}) {
    const result = clone(current);
    if (!Array.isArray(updates)) return result;
    for (const raw of updates) {
        if (!raw || typeof raw !== 'object') continue;
        const explicitId = cleanText(raw.id, 90);
        let index = explicitId
            ? result.findIndex((item) => item.id === explicitId)
            : -1;
        if (index < 0 && !explicitId && raw[identityKey]) {
            const matches = result
                .map((item, itemIndex) => (
                    item[identityKey] === cleanText(raw[identityKey], 120)
                        ? itemIndex
                        : -1
                ))
                .filter((itemIndex) => itemIndex >= 0);
            if (matches.length === 1) index = matches[0];
        }
        if (explicitId && index < 0) continue;
        if (index >= 0) {
            const previous = result[index];
            const merged = { ...previous, ...clone(raw), id: previous.id };
            if (wind) merged.quietTurns = 0;
            const beforeText = JSON.stringify({ ...previous, updatedTurn: 0 });
            const afterText = JSON.stringify({ ...merged, updatedTurn: 0 });
            if (beforeText !== afterText) merged.updatedTurn = turn;
            result[index] = merged;
            continue;
        }
        const hasBasis = cleanText(raw.basis, 420)
            || (wind ? cleanText(raw.source, 180) : '');
        if (!hasBasis) continue;
        const fresh = {
            ...clone(raw),
            id: nextWorldId(result, prefix),
            updatedTurn: turn,
        };
        if (wind) fresh.quietTurns = 0;
        result.unshift(fresh);
        if (result.length > cap) result.length = cap;
    }
    return result;
}

export function applyWorldUpdate(current, update, {
    turn = 0,
} = {}) {
    const before = normalizeWorldState(current, { turn });
    const delta = update && typeof update === 'object' ? update : {};
    const environmentDelta = delta.environment && typeof delta.environment === 'object'
        ? delta.environment
        : {};
    const shadowsDelta = delta.shadows && typeof delta.shadows === 'object'
        ? delta.shadows
        : {};
    const result = clone(before);

    if (typeof delta.digest === 'string' && cleanText(delta.digest, 700)) {
        result.digest = cleanText(delta.digest, 700);
    }
    result.trends = mergeWorldItems(before.trends, delta.trends, {
        prefix: 'TREND',
        identityKey: 'name',
        turn,
        cap: 6,
    });
    result.factions = mergeWorldItems(before.factions, delta.factions, {
        prefix: 'FAC',
        identityKey: 'name',
        turn,
        cap: 16,
    });
    result.winds = mergeWorldItems(before.winds, delta.winds, {
        prefix: 'WIND',
        identityKey: 'topic',
        turn,
        cap: 20,
        wind: true,
    });

    if (delta.reputation && typeof delta.reputation === 'object') {
        for (const key of REPUTATION_KEYS) {
            if (!delta.reputation[key] || typeof delta.reputation[key] !== 'object') continue;
            const previous = before.reputation[key];
            const proposed = { ...previous, ...clone(delta.reputation[key]) };
            if (!cleanText(proposed.basis, 420)) continue;
            proposed.level = Math.max(
                previous.level - 1,
                Math.min(previous.level + 1, Number(proposed.level) || 0),
            );
            proposed.updatedTurn = turn;
            result.reputation[key] = proposed;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(environmentDelta, 'economy')
        || Object.prototype.hasOwnProperty.call(environmentDelta, 'summary')
    ) {
        const proposedBasis = cleanText(
            environmentDelta.basis || before.environment.basis,
            420,
        );
        if (proposedBasis) {
            const oldIndex = ECONOMY_STATES.indexOf(before.environment.economy);
            const requested = ECONOMY_STATES.includes(environmentDelta.economy)
                ? ECONOMY_STATES.indexOf(environmentDelta.economy)
                : oldIndex;
            result.environment = {
                ...result.environment,
                ...clone(environmentDelta),
                economy: ECONOMY_STATES[
                    Math.max(oldIndex - 1, Math.min(oldIndex + 1, requested))
                ],
                basis: proposedBasis,
                updatedTurn: turn,
            };
        }
    }
    result.environment.incidents = mergeWorldItems(
        before.environment.incidents,
        environmentDelta.incidents,
        {
            prefix: 'INC',
            identityKey: 'title',
            turn,
            cap: 12,
        },
    );
    result.shadows.enemies = mergeWorldItems(
        before.shadows.enemies,
        shadowsDelta.enemies,
        {
            prefix: 'ENEMY',
            identityKey: 'name',
            turn,
            cap: 12,
        },
    );
    result.shadows.secrets = mergeWorldItems(
        before.shadows.secrets,
        shadowsDelta.secrets,
        {
            prefix: 'SECRET',
            identityKey: 'title',
            turn,
            cap: 16,
        },
    );
    result.influences = mergeWorldItems(before.influences, delta.influences, {
        prefix: 'CAUSE',
        identityKey: 'trigger',
        turn,
        cap: 16,
    });
    return normalizeWorldState(result, { turn });
}

function enforceWorldPolicy(beforeState, afterState) {
    const before = normalizeWorldState(beforeState.world, { turn: beforeState.turn });
    const after = normalizeWorldState(afterState.world, { turn: beforeState.turn + 1 });
    for (const key of REPUTATION_KEYS) {
        after.reputation[key].level = Math.max(
            before.reputation[key].level - 1,
            Math.min(before.reputation[key].level + 1, after.reputation[key].level),
        );
    }
    const oldIndex = ECONOMY_STATES.indexOf(before.environment.economy);
    const newIndex = ECONOMY_STATES.indexOf(after.environment.economy);
    after.environment.economy = ECONOMY_STATES[
        Math.max(oldIndex - 1, Math.min(oldIndex + 1, newIndex))
    ];
    return after;
}

function worldItems(value) {
    const world = value && typeof value === 'object' ? value : emptyWorldState();
    return [
        ...(world.trends || []),
        ...(world.factions || []),
        ...(world.winds || []),
        ...(world.environment?.incidents || []),
        ...(world.shadows?.enemies || []),
        ...(world.shadows?.secrets || []),
        ...(world.influences || []),
    ];
}

function sanitizeWorldSourceThreads(value, validThreadIds, turn) {
    const next = clone(value);
    for (const item of worldItems(next)) {
        item.sourceThreads = cleanList(item.sourceThreads, 8)
            .filter((id) => validThreadIds.has(id));
    }
    return normalizeWorldState(next, { turn });
}

function enrichThreadPropagation(thread, world) {
    const next = clone(thread);
    const linkedItems = worldItems(world).filter((item) => (
        Array.isArray(item.sourceThreads)
        && item.sourceThreads.includes(next.id)
    ));
    next.propagation = cleanList([
        ...(next.propagation || []),
        ...linkedItems.map((item) => item.id),
    ], 12);
    const hasPublicSurface = linkedItems.some((item) => item.knowledge !== 'hidden');
    if (
        next.convergence?.channels?.includes('public_signal')
        && !hasPublicSurface
    ) {
        next.convergence.channels = next.convergence.channels
            .filter((channel) => channel !== 'public_signal');
        if (!next.convergence.channels.length) {
            next.convergence.score = Math.min(
                Number(next.convergence.score) || 0,
                1,
            );
        }
    }
    return next;
}

function threadHasMatureConvergence(thread, world) {
    const convergence = thread?.convergence || {};
    const channels = Array.isArray(convergence.channels) ? convergence.channels : [];
    const evidence = Array.isArray(convergence.evidence) ? convergence.evidence : [];
    if (
        Number(convergence.score) < 2
        || !channels.length
        || !evidence.length
        || !String(convergence.entryBeat || '').trim()
    ) {
        return false;
    }
    if (!channels.includes('public_signal')) return true;
    const publicRefs = new Set(
        worldItems(world)
            .filter((item) => (
                item.knowledge !== 'hidden'
                && Array.isArray(item.sourceThreads)
                && item.sourceThreads.includes(thread.id)
            ))
            .map((item) => item.id),
    );
    return (thread.propagation || []).some((id) => publicRefs.has(id));
}

function scenarioStatusFromCurrent(current) {
    if (current.closure === 'completed' || current.phase === 'completed') return 'completed';
    if (current.closure === 'failed' || current.phase === 'failed') return 'failed';
    if (current.closure === 'ready' || current.phase === 'closing') return 'closing';
    return 'active';
}

function scenarioPlanIsInitializable(plan) {
    return (
        ['active', 'closing'].includes(plan.status)
        && !plan.invalidBaseline
        && !!plan.instanceId
        && !!plan.title
        && !!plan.baseline.goal
        && !!plan.baseline.completion
        && plan.baselineEvidence.length > 0
    );
}

function scenarioSourceIsMature(thread) {
    return !!(
        thread
        && (
            ['manifested', 'resolved'].includes(thread.stage)
            || Number(thread.stageProgress) >= 2
            || (thread.sourceRefs || []).length > 0
        )
        && !!(thread.seedBasis || thread.summary || thread.offscreenBeat)
    );
}

export function enforceScenarioPlanPolicy(previous, candidate, {
    beforeThreads = [],
    afterThreads = [],
    turn = 0,
} = {}) {
    const before = normalizeScenarioPlan(previous, { turn });
    const proposed = normalizeScenarioPlan(candidate, { turn });
    if (before.status === 'inactive') {
        if (!scenarioPlanIsInitializable(proposed)) return before;
        const baseline = normalizeScenarioSnapshot(proposed.baseline);
        const current = normalizeScenarioSnapshot(baseline);
        return normalizeScenarioPlan({
            status: scenarioStatusFromCurrent(current),
            instanceId: proposed.instanceId,
            title: proposed.title,
            revision: 0,
            baselineEvidence: proposed.baselineEvidence,
            baselineSourceRef: proposed.baselineSourceRef,
            baseline,
            current,
            amendments: [],
            createdTurn: turn,
            updatedTurn: turn,
        }, { turn });
    }
    if (['completed', 'failed'].includes(before.status)) return before;

    const oldAmendmentIds = new Set(before.amendments.map((item) => item.id));
    const oldThreads = new Map(beforeThreads.map((thread) => [thread.id, thread]));
    const allThreads = new Map(afterThreads.map((thread) => [thread.id, thread]));
    for (const thread of beforeThreads) {
        if (!allThreads.has(thread.id)) allThreads.set(thread.id, thread);
    }
    const structuralFields = new Set([
        'goal',
        'completion',
        'failure',
        'activeApex',
        'closure',
    ]);
    const requested = proposed.amendments
        .filter((item) => !oldAmendmentIds.has(item.id))
        .slice(0, 1);
    if (!requested.length) return before;
    const amendment = clone(requested[0]);
    const sources = amendment.sourceThreadIds
        .map((id) => allThreads.get(id))
        .filter(Boolean);
    if (
        amendment.invalidChanges
        || !amendment.causeType
        || !amendment.impact
        || !amendment.visibility
        || !amendment.trigger
        || !amendment.mechanism
        || !amendment.evidence.length
        || !amendment.changes.length
        || !amendment.sourceThreadIds.length
        || sources.length !== amendment.sourceThreadIds.length
    ) {
        return before;
    }
    if (amendment.causeType === 'world_chain') {
        const matureOldSources = amendment.sourceThreadIds
            .map((id) => oldThreads.get(id))
            .filter(scenarioSourceIsMature);
        if (matureOldSources.length !== amendment.sourceThreadIds.length) return before;
    } else if (amendment.causeType === 'player_action') {
        const hasDirectPlayerDerivative = sources.some((thread) => (
            thread.origin === 'main_derivative'
            && !!thread.seedBasis
            && (thread.causedBy || []).length > 0
        ));
        if (!hasDirectPlayerDerivative) return before;
    } else {
        const hasPriorTrace = amendment.sourceThreadIds.some((id) => (
            scenarioSourceIsMature(oldThreads.get(id))
        ));
        if (!hasPriorTrace) return before;
    }

    const current = clone(before.current);
    const acceptedChanges = [];
    const requiredNonEmptyFields = new Set(['goal', 'completion', 'phase', 'closure']);
    for (const change of amendment.changes) {
        const actualBefore = normalizeScenarioField(change.field, current[change.field]);
        if (
            change.before !== actualBefore
            || change.after === actualBefore
            || (
                requiredNonEmptyFields.has(change.field)
                && !String(change.after || '').trim()
            )
        ) {
            continue;
        }
        current[change.field] = change.after;
        acceptedChanges.push({ ...change, before: actualBefore });
    }
    if (acceptedChanges.length !== amendment.changes.length) return before;
    const isStructural = acceptedChanges.some((change) => (
        structuralFields.has(change.field)
    ));
    if (
        (isStructural || amendment.impact === 'structural')
        && !amendment.preserves.length
    ) return before;
    if (
        ['ready', 'completed', 'failed'].includes(current.closure)
        && !current.closureReason
    ) return before;
    if (
        (current.closure === 'completed' && current.phase !== 'completed')
        || (current.closure === 'failed' && current.phase !== 'failed')
        || (current.phase === 'completed' && current.closure !== 'completed')
        || (current.phase === 'failed' && current.closure !== 'failed')
    ) return before;
    if (
        before.current.closure === 'completed'
        || before.current.closure === 'failed'
        || before.current.phase === 'completed'
        || before.current.phase === 'failed'
    ) {
        return before;
    }

    amendment.revision = before.revision + 1;
    amendment.turn = turn;
    amendment.changes = acceptedChanges;
    return normalizeScenarioPlan({
        ...before,
        status: scenarioStatusFromCurrent(current),
        revision: amendment.revision,
        current,
        amendments: [...before.amendments, amendment],
        updatedTurn: turn,
    }, { turn });
}

export function enforceContinuityPolicy(previous, candidate, {
    autonomy = 'living',
    allowAutonomous = true,
    maxThreads = 8,
} = {}) {
    const before = normalizeContinuityState(previous, { maxThreads });
    const after = normalizeContinuityState(candidate, { maxThreads });
    const resolvedGuard = resolvedTombstoneGuard(before);
    const validThreadIds = new Set([
        ...before.threads.map((thread) => thread.id),
        ...after.threads.map((thread) => thread.id),
    ]);
    const policyWorld = sanitizeWorldSourceThreads(
        enforceWorldPolicy(before, after, { autonomy }),
        validThreadIds,
        before.turn + 1,
    );
    const gateUnmanifestedKnowledge = (baseline, proposed) => {
        const protectedThread = enrichThreadPropagation(proposed, policyWorld);
        const previousRelation = baseline?.relation || (
            protectedThread.origin === 'main_derivative'
                ? 'linked'
                : protectedThread.origin === 'setting_linked'
                    ? 'latent'
                    : 'independent'
        );
        const requestedBridge = ['linked', 'converging'].includes(
            protectedThread.relation,
        ) && ['independent', 'latent'].includes(previousRelation);
        const requestedConvergence = protectedThread.relation === 'converging'
            && previousRelation !== 'converging';
        if (requestedBridge || requestedConvergence) {
            const mature = threadHasMatureConvergence(
                protectedThread,
                policyWorld,
            );
            if (requestedBridge) {
                protectedThread.relation = mature ? 'converging' : previousRelation;
            } else if (!mature) {
                protectedThread.relation = previousRelation;
            }
        }
        const mayBePublic = ['linked', 'converging'].includes(protectedThread.relation)
            || ['manifested', 'resolved'].includes(protectedThread.stage);
        if (
            !mayBePublic
            && ['independent', 'latent'].includes(protectedThread.relation)
            && (baseline?.knowledge || 'hidden') === 'hidden'
            && protectedThread.knowledge !== 'hidden'
        ) {
            protectedThread.knowledge = 'hidden';
            protectedThread.rumors = clone(baseline?.rumors || []);
        }
        return protectedThread;
    };
    const oldById = new Map(before.threads.map((thread) => [thread.id, thread]));
    const newById = new Map(after.threads.map((thread) => {
        const enriched = enrichThreadPropagation(thread, policyWorld);
        return [enriched.id, enriched];
    }));
    const changeLimit = autonomy === 'expansive'
        ? 6
        : autonomy === 'living'
            ? 3
            : 1;
    const requestedTickId = String(after.lastTick?.threadId || '');
    const changedExisting = [...newById.values()]
        .filter((thread) => {
            const old = oldById.get(thread.id);
            return old
                && old.stage !== 'resolved'
                && stableThreadContent(old) !== stableThreadContent(thread);
        })
        .sort((left, right) => (
            Number(right.id === requestedTickId) - Number(left.id === requestedTickId)
            || right.urgency - left.urgency
            || left.lastAdvancedTurn - right.lastAdvancedTurn
        ));
    const selectedChangedIds = changedExisting
        .slice(0, changeLimit)
        .map((thread) => thread.id);
    const selectedChangedIdSet = new Set(selectedChangedIds);
    const selectedChangedId = selectedChangedIds[0] || '';
    const threads = before.threads.map((old) => {
        if (old.stage === 'resolved' || !selectedChangedIdSet.has(old.id)) {
            return clone(old);
        }
        const proposed = gateUnmanifestedKnowledge(old, newById.get(old.id));
        proposed.origin = old.origin;
        proposed.createdTurn = old.createdTurn;
        proposed.lastAdvancedTurn = before.turn + 1;
        if (proposed.stage === 'resolved') {
            proposed.resolvedTurn = before.turn + 1;
            proposed.resolution ||= proposed.summary || proposed.offscreenBeat;
            if (!proposed.effects.length && proposed.offscreenBeat) {
                proposed.effects = [proposed.offscreenBeat];
            }
        }
        return proposed;
    });

    const newCandidates = [...newById.values()]
        .filter((thread) => (
            !oldById.has(thread.id)
            && !resolvedCandidateIsBlocked(thread, resolvedGuard)
        ));
    const autonomousBefore = before.threads.filter((thread) => (
        thread.origin !== 'main_derivative'
        && thread.stage !== 'resolved'
        && thread.stage !== 'dormant'
    ));
    const cadence = 1;
    const autonomousLimit = autonomy === 'expansive' ? 12 : 8;
    const latestAutonomousCreation = autonomousBefore.reduce(
        (maximum, thread) => Math.max(maximum, thread.createdTurn || 0),
        0,
    );
    const cadenceReady = !autonomousBefore.length
        || before.turn - latestAutonomousCreation >= cadence;

    const activeIds = new Set(
        threads
            .filter((thread) => !['resolved', 'dormant'].includes(thread.stage))
            .map((thread) => thread.id),
    );
    let remaining = Math.max(0, maxThreads - activeIds.size);
    const accepted = [];
    const causal = newCandidates.filter((thread) => (
        thread.seedBasis
        && (
            thread.origin === 'main_derivative'
            || thread.causedBy.some((id) => oldById.has(id))
        )
    ));
    const autonomous = newCandidates.filter((thread) => (
        !causal.includes(thread)
        && thread.origin !== 'main_derivative'
        && thread.seedBasis
    ));

    for (const thread of causal) {
        if (remaining <= 0 || accepted.length >= 3) break;
        accepted.push(thread);
        remaining -= ['resolved', 'dormant'].includes(thread.stage) ? 0 : 1;
    }
    if (
        remaining > 0
        && accepted.length < 3
        && autonomy !== 'conservative'
        && allowAutonomous
        && cadenceReady
        && autonomousBefore.length < autonomousLimit
    ) {
        accepted.push(autonomous[0]);
    }
    for (const item of accepted.filter(Boolean)) {
        const fresh = gateUnmanifestedKnowledge(null, item);
        fresh.createdTurn = before.turn + 1;
        fresh.lastAdvancedTurn = before.turn + 1;
        if (fresh.stage === 'resolved') fresh.resolvedTurn = before.turn + 1;
        threads.push(fresh);
    }

    const scenarioPlan = enforceScenarioPlanPolicy(
        before.scenarioPlan,
        after.scenarioPlan,
        {
            beforeThreads: before.threads,
            afterThreads: threads,
            turn: before.turn + 1,
        },
    );
    const scenarioChanged = JSON.stringify(before.scenarioPlan)
        !== JSON.stringify(scenarioPlan);
    const requestedGlobalHold = normalizeContinuityState({
        ...after,
        lastTick: {
            turn: before.turn,
            action: 'held',
            threadId: 'WORLD',
            reason: after.lastTick?.reason,
        },
        threads,
        world: policyWorld,
        scenarioPlan,
    }, { chatId: before.chatId || after.chatId, maxThreads });
    let lastTick = clone(before.lastTick);
    if (selectedChangedId) {
        const changed = threads.find((thread) => thread.id === selectedChangedId);
        const action = changed?.stage === 'resolved'
            ? 'resolved'
            : changed?.stage === 'manifested'
                ? 'manifested'
                : changed?.stage === 'dormant'
                    ? 'dormant'
                    : 'advanced';
        lastTick = {
            turn: before.turn + 1,
            action,
            threadId: selectedChangedId,
            reason: after.lastTick?.reason
                || changed?.offscreenBeat
                || changed?.resolution
                || changed?.summary
                || '事件状态发生实质变化',
        };
    } else if (accepted.filter(Boolean).length) {
        const created = accepted.find(Boolean);
        lastTick = {
            turn: before.turn + 1,
            action: 'created',
            threadId: created.id,
            reason: after.lastTick?.reason || created.seedBasis || '新的持续因果已经成立',
        };
    } else if (scenarioChanged) {
        lastTick = {
            turn: before.turn + 1,
            action: 'advanced',
            threadId: 'SCENARIO_PLAN',
            reason: scenarioPlan.revision > before.scenarioPlan.revision
                ? `副本/场景规划已通过第 ${scenarioPlan.revision} 次可追溯修订`
                : '副本/场景规划基线已建立',
        };
    } else if (
        after.lastTick?.action === 'held'
        && after.lastTick.reason.length >= 8
        && (
            (
                after.lastTick.turn === before.turn
                && oldById.has(after.lastTick.threadId)
                && oldById.get(after.lastTick.threadId)?.stage !== 'resolved'
            )
            || (
                after.lastTick.turn === before.turn
                && after.lastTick.threadId === 'WORLD'
                && continuityGlobalHoldIsVerifiable(before, requestedGlobalHold)
            )
        )
    ) {
        lastTick = {
            turn: before.turn,
            action: 'held',
            threadId: after.lastTick.threadId,
            reason: after.lastTick.reason,
        };
    }

    return normalizeContinuityState({
        ...after,
        lastTick,
        threads,
        world: policyWorld,
        scenarioPlan,
    }, { chatId: before.chatId || after.chatId, maxThreads });
}

export function attachChangedSourceRefs(previous, next, sourceRef) {
    const ref = normalizeSourceRef(sourceRef);
    const oldById = new Map((previous?.threads || []).map((thread) => [thread.id, thread]));
    const result = clone(next);
    result.threads = (result.threads || []).map((thread) => {
        const old = oldById.get(thread.id);
        const refs = Array.isArray(old?.sourceRefs) ? clone(old.sourceRefs) : [];
        const changed = !old || stableThreadContent(old) !== stableThreadContent(thread);
        if (changed && ref) {
            const sourceKey = (item) => item.target
                ? JSON.stringify(item.target)
                : `${item.chatId}:${item.messageId}:${item.swipeId}:${item.hash}`;
            const key = sourceKey(ref);
            const deduped = refs.filter((item) => (
                sourceKey(item) !== key
            ));
            deduped.push(ref);
            thread.sourceRefs = deduped.slice(-8);
        } else {
            thread.sourceRefs = refs.slice(-8);
        }
        return thread;
    });
    const previousPlan = normalizeScenarioPlan(previous?.scenarioPlan, {
        turn: Number(previous?.turn) || 0,
    });
    const nextPlan = normalizeScenarioPlan(result.scenarioPlan, {
        turn: Number(result?.turn) || 0,
    });
    if (ref && nextPlan.revision > previousPlan.revision) {
        const newest = nextPlan.amendments.find(
            (item) => item.revision === nextPlan.revision,
        );
        if (newest) newest.sourceRef = ref;
    }
    if (
        ref
        && previousPlan.status === 'inactive'
        && nextPlan.status !== 'inactive'
    ) {
        nextPlan.baselineSourceRef = ref;
    }
    result.scenarioPlan = nextPlan;
    return result;
}

export function buildContinuityRepairMessages(output, error, {
    turn = 0,
    threadIds = [],
    actionAttempts = [],
} = {}) {
    const targetTurn = Math.max(1, Math.floor(Number(turn) || 1));
    const allowedThreadIds = [...new Set((threadIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))]
        .slice(0, 40);
    const candidate = String(output || '');
    const boundedCandidate = candidate.length <= 10_000
        ? candidate
        : `${candidate.slice(0, 10_000)}\n[待修复候选已截断]`;
    const attempts = (Array.isArray(actionAttempts) ? actionAttempts : [])
        .filter((entry) => entry && typeof entry === 'object' && entry.id)
        .slice(0, 8)
        .map((entry) => ({
            attemptId: String(entry.id || '').slice(0, 160),
            actorId: String(entry.actorId || '').slice(0, 120),
            actorRef: clone(entry.actorRef || null),
            target: clone(entry.target || null),
            route: String(entry.route || '').slice(0, 40),
            action: String(entry.action || '').slice(0, 700),
            goal: String(entry.goal || '').slice(0, 500),
            timeProposal: clone(entry.timeProposal || null),
            location: clone(entry.location || null),
            playerTargeted: entry.playerTargeted === true,
            proposedStateChanges: (Array.isArray(entry.proposedStateChanges)
                ? entry.proposedStateChanges
                : []).slice(0, 12),
            resourceCosts: (Array.isArray(entry.resourceCosts)
                ? entry.resourceCosts
                : []).slice(0, 12),
            resourceBasis: (Array.isArray(entry.resourceBasis)
                ? entry.resourceBasis
                : []).slice(0, 12),
            knowledgeRefs: (Array.isArray(entry.knowledgeRefs)
                ? entry.knowledgeRefs
                : []).slice(0, 24),
            knownFacts: (Array.isArray(entry.knownFacts)
                ? entry.knownFacts
                : []).slice(0, 24),
            knowledgeBasis: (Array.isArray(entry.knowledgeBasis)
                ? entry.knowledgeBasis
                : []).slice(0, 12),
            expectedCost: String(entry.expectedCost || '').slice(0, 300),
            expectedDuration: String(entry.expectedDuration || '').slice(0, 180),
            expectedRisk: String(entry.expectedRisk || '').slice(0, 300),
            expectedObservableConsequence: String(
                entry.expectedObservableConsequence || '',
            ).slice(0, 500),
            capabilityUsed: String(entry.capabilityUsed || '').slice(0, 160),
            evidence: (Array.isArray(entry.evidence) ? entry.evidence : []).slice(0, 16),
        }));
    return [
        {
            role: 'system',
            content: [
                '你只负责把上一条活世界候选修成一个完整、可解析的增量 JSON 对象。',
                '保留原候选中有依据的内容，不新增事实、不补造人物行动、不替玩家决定。',
                `根对象只允许 turn、lastTick、${attempts.length ? 'actionAdjudications、' : ''}threads、scenarioPlan、world。`,
                `turn与lastTick.turn都必须严格等于目标回合 ${targetTurn}。`,
                'lastTick 必须包含 turn、action、threadId、reason；threadId 只能使用给定已有稳定ID或 WORLD，held 理由不少于8字。',
                'threads必须是数组；scenarioPlan、world必须是对象。缺少变化时使用空数组或空对象。',
                attempts.length
                    ? 'actionAdjudications 必须逐条覆盖给定 attemptId，并逐字段原样回传actorRef与target。人物只提出尝试；世界决定实际成本、耗时、风险和结果。actualResourceCosts只能取尝试已有resourceCosts且不得超量；visibility必须是public/private/observer_limited。settled/partial 只能写 knowledge、location、plan、resource、relationship、risk、condition、commitment、environment 状态，不得替玩家同意、行动、付费、移动或产生感受，也不得结算玩家关系；后台结果必须给出以后可验证的 revealPath。'
                    : '',
                '只输出 JSON 对象，不要围栏、解释或前后文字。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `原校验错误=${String(error || 'invalid-continuity').slice(0, 500)}`,
                `目标回合=${targetTurn}`,
                `允许的已有threadId=${JSON.stringify(allowedThreadIds.length ? allowedThreadIds : ['WORLD'])}`,
                '严格根形状：',
                JSON.stringify({
                    turn: targetTurn,
                    lastTick: {
                        turn: targetTurn,
                        action: 'created|advanced|manifested|resolved|dormant|held',
                        threadId: allowedThreadIds[0] || 'WORLD',
                        reason: '不少于8字的具体依据',
                    },
                    ...(attempts.length ? {
                        actionAdjudications: attempts.map((entry) => ({
                            attemptId: entry.attemptId,
                            actorRef: entry.actorRef,
                            target: entry.target,
                            status: 'success|partial|failure|delayed|blocked',
                            risk: '具体风险',
                            costs: ['具体代价'],
                            actualResourceCosts: [],
                            durationTurns: 1,
                            visibility: 'private',
                            observerActorIds: [],
                            publicSummary: '',
                            privateSummary: '私密结果可填',
                            resultSummary: '世界实际裁决结果',
                            observableConsequence: '可观察后果',
                            revealPath: '隐藏结果以后如何被发现',
                            appliedStateChanges: [{
                                kind: 'knowledge|location|plan|resource|relationship|risk|condition|commitment|environment',
                                summary: '裁决后实际新增状态',
                            }],
                        })),
                    } : {}),
                    threads: [],
                    scenarioPlan: { amendments: [] },
                    world: {
                        digest: '',
                        trends: [],
                        factions: [],
                        winds: [],
                        reputation: {},
                        environment: {},
                        shadows: { enemies: [], secrets: [] },
                        influences: [],
                    },
                }),
                ...(attempts.length ? [
                    '必须裁决的当前人物尝试：',
                    JSON.stringify(attempts),
                ] : []),
                '待修复候选：',
                boundedCandidate,
            ].join('\n'),
        },
    ];
}

// Directly adapted from World/world-engine-api.js parseJSON and
// repairTruncatedJSON. The Doctor-specific additions are deliberately local:
// full-width separators and trailing commas are repaired outside strings, and
// the parsed root is still passed through the existing continuity validator.
// No model call, retry state, queue, or persistence lives in this parser.
function repairTruncatedContinuityJson(content) {
    const rootStart = content.indexOf('{');
    if (rootStart === -1) return null;
    const stack = [];
    const candidates = [];
    let inString = false;
    let escaped = false;
    for (let index = rootStart; index < content.length; index += 1) {
        const char = content[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{' || char === '[') stack.push(char);
        else if (char === '}' || char === ']') stack.pop();
        else if (char === ',' && stack.length > 0) {
            candidates.push({
                end: index,
                suffix: stack.slice().reverse().map((open) => (
                    open === '{' ? '}' : ']'
                )).join(''),
            });
        }
    }
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        try {
            return JSON.parse(
                content.slice(rootStart, candidates[index].end)
                    + candidates[index].suffix,
            );
        } catch {
            // Try the previous complete member boundary.
        }
    }
    return null;
}

function normalizeContinuityJsonPunctuation(content) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (const char of String(content || '')) {
        if (inString) {
            result += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            result += char;
        } else if (char === '：') result += ':';
        else if (char === '，') result += ',';
        else result += char;
    }
    return result.replace(/,\s*([}\]])/gu, '$1');
}

function parseContinuityJsonLocally(text) {
    let content = String(text || '').replace(/^\uFEFF/u, '').trim();
    content = content.replace(/^```json\s*/iu, '').replace(/\s*```\s*$/u, '').trim();
    const attempts = [content, normalizeContinuityJsonPunctuation(content)];
    for (const candidate of attempts) {
        try {
            return { value: JSON.parse(candidate), repaired: candidate !== content };
        } catch {
            // Fall through to bounded object extraction.
        }
        let depth = 0;
        let start = -1;
        let inString = false;
        let escaped = false;
        let lastValid = null;
        for (let index = 0; index < candidate.length; index += 1) {
            const char = candidate[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }
            if (char === '"') inString = true;
            else if (char === '{') {
                if (depth === 0) start = index;
                depth += 1;
            } else if (char === '}' && depth > 0) {
                depth -= 1;
                if (depth === 0 && start !== -1) {
                    try {
                        lastValid = JSON.parse(candidate.slice(start, index + 1));
                    } catch {
                        // Keep scanning for the last valid top-level object.
                    }
                    start = -1;
                }
            }
        }
        if (lastValid) return { value: lastValid, repaired: true };
        const repaired = repairTruncatedContinuityJson(candidate);
        if (repaired) return { value: repaired, repaired: true };
    }
    return null;
}

export function parseContinuityOutput(output, options = {}) {
    const text = String(output || '');
    const tagged = text.match(/<ContinuityState>\s*([\s\S]*?)\s*<\/ContinuityState>/iu);
    const parsedResult = parseContinuityJsonLocally(tagged ? tagged[1] : text);
    if (!parsedResult || !parsedResult.value || typeof parsedResult.value !== 'object') {
        return { error: 'ContinuityState JSON 无法在本地恢复' };
    }
    const arrayUnwrapped = Array.isArray(parsedResult.value)
        && parsedResult.value.length === 1
        && parsedResult.value[0]
        && typeof parsedResult.value[0] === 'object'
        && !Array.isArray(parsedResult.value[0])
        ? parsedResult.value[0]
        : parsedResult.value;
    if (
        arrayUnwrapped
        && !Array.isArray(arrayUnwrapped)
        && Object.hasOwn(arrayUnwrapped, 'ContinuityState')
    ) {
        if (
            Object.keys(arrayUnwrapped).length !== 1
            || !arrayUnwrapped.ContinuityState
            || typeof arrayUnwrapped.ContinuityState !== 'object'
            || Array.isArray(arrayUnwrapped.ContinuityState)
        ) {
            return { error: 'ContinuityState JSON wrapper 结构非法' };
        }
    }
    const wrapperUnwrapped = arrayUnwrapped
        && !Array.isArray(arrayUnwrapped)
        && Object.hasOwn(arrayUnwrapped, 'ContinuityState')
        ? arrayUnwrapped.ContinuityState
        : arrayUnwrapped;
    const parsed = wrapperUnwrapped;
    if (Array.isArray(parsed)) {
        return { error: 'ContinuityState JSON 根节点不能是多项数组' };
    }
    if (Object.hasOwn(parsed, 'actorProfiles')) {
        return { error: 'ContinuityState 包含已停用的人物档案写字段' };
    }
    return {
        state: normalizeContinuityState(parsed, options),
        raw: clone(parsed),
        repairedLocally: parsedResult.repaired === true || parsed !== parsedResult.value,
    };
}

export function extractContinuityMarkers() {
    return {
        records: [],
        taggedSections: [],
    };
}

export function mergeMarkerRecords(state, records, {
    chatId = '',
    maxThreads = 6,
} = {}) {
    const normalized = normalizeContinuityState(state, { chatId, maxThreads });
    const byId = new Map(normalized.threads.map((thread) => [thread.id, thread]));
    const resolvedGuard = resolvedTombstoneGuard(normalized);
    for (const raw of records || []) {
        const incoming = normalizeThread(raw, byId.size, normalized.turn);
        if (!incoming) continue;
        // A compacted resolved event is a tombstone: a late marker may add
        // evidence/effects, but it may not reopen the event as active.
        // When the bounded ID list has rolled over, the monotonic resolved
        // turn floor is the fail-closed fallback for old IDs that are no
        // longer individually enumerable.
        if (!byId.has(incoming.id) && resolvedCandidateIsBlocked(incoming, resolvedGuard)) {
            continue;
        }
        const old = byId.get(incoming.id);
        if (!old) {
            byId.set(incoming.id, incoming);
            continue;
        }
        const stage = old.stage === 'resolved' && incoming.stage !== 'resolved'
            ? 'resolved'
            : incoming.stage === 'seeded' && old.stage !== 'seeded'
                ? old.stage
                : incoming.stage;
        const knowledge = KNOWLEDGE_RANK[incoming.knowledge] >= KNOWLEDGE_RANK[old.knowledge]
            ? incoming.knowledge
            : old.knowledge;
        byId.set(incoming.id, {
            ...old,
            ...incoming,
            title: incoming.title === incoming.id ? old.title : incoming.title || old.title,
            stage,
            origin: old.origin || incoming.origin,
            relation: incoming.relation === 'linked' ? 'linked' : old.relation,
            offscreenBeat: incoming.offscreenBeat || old.offscreenBeat,
            nextBeat: incoming.nextBeat || old.nextBeat,
            trigger: incoming.trigger || old.trigger,
            seedBasis: incoming.seedBasis || old.seedBasis,
            intersection: incoming.intersection || old.intersection,
            causedBy: incoming.causedBy.length ? incoming.causedBy : old.causedBy,
            effects: incoming.effects.length ? incoming.effects : old.effects,
            rumors: incoming.rumors.length ? incoming.rumors : old.rumors,
            resolution: incoming.resolution || old.resolution,
            actors: incoming.actors.length ? incoming.actors : old.actors,
            actorRefs: incoming.actorRefs.length ? incoming.actorRefs : old.actorRefs,
            locations: incoming.locations.length ? incoming.locations : old.locations,
            propagation: incoming.propagation.length
                ? incoming.propagation
                : old.propagation,
            convergence: incoming.convergence.score
                || incoming.convergence.channels.length
                || incoming.convergence.evidence.length
                || incoming.convergence.entryBeat
                ? incoming.convergence
                : old.convergence,
            knowledge,
            urgency: Math.max(old.urgency, incoming.urgency),
            createdTurn: old.createdTurn,
            resolvedTurn: stage === 'resolved'
                ? old.resolvedTurn || incoming.resolvedTurn
                : 0,
            sourceRefs: old.sourceRefs || [],
        });
    }
    return normalizeContinuityState({
        ...normalized,
        threads: [...byId.values()],
    }, { chatId, maxThreads });
}

function legacyContinuityDirectorText(director) {
    if (director === 'stitches') return '缝合怪负责场景与剧情提案；本账本只约束连续性。';
    if (director === 'world') return '世界引擎负责世界推演提案；本账本只补足因果连续性并避免重复推进。';
    if (director === 'world_preset') return '世界引擎与当前预设负责世界/平行事件提案；本账本只做去重、接续与回收。';
    if (director === 'preset') return '当前预设负责平行事件写作；本账本只约束连续性。';
    if (director === 'mixed') return '预设、缝合怪或世界引擎负责剧情与世界提案；本账本只做去重、接续与回收。';
    return '当前没有检测到外部剧情推进器；可按账本低频推进世界支线。';
}

export function buildContinuityInjection(state, {
    director = 'doctor',
    maxVisible = 2,
    selectedThreadIds = null,
    selectedWorldIds = null,
    renderLegacyDirector = false,
} = {}) {
    const normalized = normalizeContinuityState(state, { maxThreads: 12 });
    const selectedThreads = Array.isArray(selectedThreadIds)
        ? new Set(selectedThreadIds.map((id) => cleanText(id)).filter(Boolean))
        : null;
    const selectedWorld = Array.isArray(selectedWorldIds)
        ? new Set(selectedWorldIds.map((id) => cleanText(id)).filter(Boolean))
        : null;
    const worldSelected = (item, fallbackId = '') => (
        selectedWorld === null
        || selectedWorld.has(cleanText(item?.id || item?.sourceId || fallbackId))
    );
    const canReachMain = (thread) => !!thread
        && (
            thread.origin === 'main_derivative'
            || ['linked', 'converging'].includes(thread.relation)
        );
    const active = normalized.threads.filter((thread) => (
        thread.stage !== 'resolved'
        && canReachMain(thread)
        && (!selectedThreads || selectedThreads.has(thread.id))
    ));
    const aftermath = normalized.threads.filter((thread) => (
        thread.stage === 'resolved'
        && normalized.turn - thread.resolvedTurn <= 6
        && (thread.effects.length || thread.rumors.length)
        && canReachMain(thread)
        && (!selectedThreads || selectedThreads.has(thread.id))
    ));
    const scenario = normalized.scenarioPlan;
    const hasScenarioPlan = scenario.status !== 'inactive' && !!scenario.instanceId;
    const scenarioRows = hasScenarioPlan
        ? [
            `当前副本/场景规划[${scenario.instanceId}] ${scenario.title}；版本=v${scenario.revision}；状态=${SCENARIO_STATUS_LABELS[scenario.status] || scenario.status}；阶段=${SCENARIO_PHASE_LABELS[scenario.current.phase] || scenario.current.phase}；收束=${scenario.current.closure}`,
            `当前主目标=${scenario.current.goal}；当前完成条件=${scenario.current.completion}；失败边界=${scenario.current.failure || '未单列'}`,
            `当前终局冲突/最高威胁=${scenario.current.activeApex || '无固定战斗型终局'}；路线结构=${scenario.current.route || '由玩家选择形成'}；时限=${scenario.current.timeLimit || '无明确时限'}；代价/赌注=${scenario.current.stakes || '以已发生事实为准'}`,
            scenario.current.closureReason
                ? `当前收束判定依据=${scenario.current.closureReason}`
                : '',
            ...scenario.amendments.slice(-3).map((item) => (
                `规划修订v${item.revision}[${item.id}]：原因=${SCENARIO_CAUSE_LABELS[item.causeType] || item.causeType}；`
                + `来源=${item.sourceThreadIds.join('、')}；触发=${item.trigger}；机制=${item.mechanism}；`
                + `变更=${item.changes.map((change) => `${change.field}:${change.before}→${change.after}`).join('，')}；`
                + `保留既有成果=${item.preserves.join('；') || '无结构性改写'}`
            )),
        ].filter(Boolean)
        : [];
    const visibleWorldRows = [
        ...normalized.world.trends
            .filter((item) => item.status === 'active' && item.knowledge !== 'hidden'
                && worldSelected(item, `trend:${item.name}`))
            .map((item) => (
                `长期趋势[${item.name}]：${item.summary}`
                + `${item.scope ? `；范围=${item.scope}` : ''}`
            )),
        ...normalized.world.factions
            .filter((item) => item.knowledge !== 'hidden'
                && worldSelected(item, `faction:${item.name}`))
            .map((item) => (
                `势力[${item.name}]：${WORLD_FACTION_RELATION_LABELS[item.relation]}／`
                + `${WORLD_FACTION_CONDITION_LABELS[item.condition]}；`
                + `${item.summary || item.lastChange || item.goal || '暂无公开变化'}`
            )),
        ...normalized.world.winds
            .filter((item) => item.knowledge !== 'hidden'
                && worldSelected(item, `wind:${item.topic}`))
            .map((item) => (
                `风声[${WORLD_WIND_TYPE_LABELS[item.type]}·${item.strength}级·${item.topic}]：`
                + `${item.content}${item.scope ? `；范围=${item.scope}` : ''}`
            )),
        ...REPUTATION_KEYS
            .filter((key) => (
                normalized.world.reputation[key].level !== 0
                || normalized.world.reputation[key].summary
            ) && worldSelected(normalized.world.reputation[key], `reputation:${key}`))
            .map((key) => {
                const item = normalized.world.reputation[key];
                return `声誉[${WORLD_REPUTATION_LABELS[key]}]：${item.level >= 0 ? '+' : ''}${item.level}；${item.summary || '评价发生变化'}`;
            }),
        normalized.world.environment.summary && worldSelected(
            normalized.world.environment,
            'environment:summary',
        )
            ? `环境[经济·${WORLD_ECONOMY_LABELS[normalized.world.environment.economy]}]：${normalized.world.environment.summary}`
            : '',
        ...normalized.world.environment.incidents
            .filter((item) => item.knowledge !== 'hidden' && item.status !== 'resolved'
                && worldSelected(item, `incident:${item.title}`))
            .map((item) => `环境[${item.title}]：${item.summary || item.lastChange}`),
        ...normalized.world.shadows.enemies
            .filter((item) => item.knowledge !== 'hidden' && item.status !== 'resolved'
                && worldSelected(item, `enemy:${item.name}`))
            .map((item) => `敌情[${item.name}]：${item.summary || item.lastChange}`),
        ...normalized.world.shadows.secrets
            .filter((item) => (
                item.knowledge !== 'hidden'
                && ['leaking', 'exposed'].includes(item.status)
                && worldSelected(item, `secret:${item.title}`)
            ))
            .map((item) => `隐秘[${item.title}]：${item.summary || item.lastChange}`),
        ...normalized.world.influences
            .filter((item) => item.knowledge !== 'hidden'
                && worldSelected(item, `influence:${item.trigger}`))
            .map((item) => (
                `因果联动[${item.trigger}]：${item.impact}`
                + `${item.fallout ? `；余波=${item.fallout}` : ''}`
            )),
    ].filter(Boolean).slice(0, 12);
    if (
        !active.length
        && !aftermath.length
        && !visibleWorldRows.length
        && !hasScenarioPlan
    ) return '';
    const tickThread = normalized.threads.find(
        (thread) => thread.id === normalized.lastTick.threadId,
    );
    const tickReason = tickThread
        && canReachMain(tickThread)
        && tickThread.knowledge !== 'hidden'
        ? normalized.lastTick.reason || '未登记'
        : '幕后条件变化已记录（细节已折叠）';
    const directorText = renderLegacyDirector
        ? legacyContinuityDirectorText(director)
        : '世界连续性由医生独立调度；只使用已接受正文、通用世界书与自有账本。';
    const requestedVisible = Number(maxVisible);
    const visibleLimit = Math.min(
        4,
        Math.max(
            0,
            Number.isFinite(requestedVisible)
                && maxVisible !== null
                && maxVisible !== ''
                ? Math.round(requestedVisible)
                : 2,
        ),
    );
    const candidateLimit = visibleLimit;
    const rows = active
        .sort((left, right) => (
            Number(right.relation === 'converging')
                - Number(left.relation === 'converging')
            || right.convergence.score - left.convergence.score
            || right.urgency - left.urgency
            || right.lastAdvancedTurn - left.lastAdvancedTurn
        ))
        .slice(0, candidateLimit)
        .map((thread) => {
            const hiddenConvergence = thread.knowledge === 'hidden'
                && thread.relation === 'converging';
            if (hiddenConvergence) {
                return [
                    `[${thread.id}] 汇流候选（幕后原因保密）`,
                    `阶段=${CONTINUITY_STAGE_LABELS[thread.stage] || thread.stage}`,
                    `来源=${CONTINUITY_ORIGIN_LABELS[thread.origin] || thread.origin}`,
                    '认知=hidden',
                    `汇流强度=${thread.convergence.score}/4`,
                    `成立依据=${thread.convergence.evidence.join('；')}`,
                    `可观察入口=${thread.convergence.entryBeat}`,
                    '调度=只可描写可观察入口，不得揭露幕后标题、真相或不知情角色无法取得的信息',
                ].join('；');
            }
            return [
                `[${thread.id}] ${thread.title}`,
                `阶段=${CONTINUITY_STAGE_LABELS[thread.stage] || thread.stage}`,
                `来源=${CONTINUITY_ORIGIN_LABELS[thread.origin] || thread.origin}`,
                `主线关系=${CONTINUITY_RELATION_LABELS[thread.relation] || thread.relation}`,
                `认知=${thread.knowledge}`,
                `现状=${thread.summary || '无新增事实'}`,
                `幕后变化=${thread.offscreenBeat || '本轮未推进'}`,
                `触发=${thread.trigger || '等待自然接口'}`,
                `下一拍=${thread.nextBeat || '保持，不强推'}`,
                `汇流条件=${thread.intersection || '无；允许独立发展或在幕后结束'}`,
                thread.convergence.score
                    ? `当前汇流=${thread.convergence.score}/4；${thread.convergence.evidence.join('；')}`
                    : '',
                thread.convergence.entryBeat
                    ? `可观察入口=${thread.convergence.entryBeat}`
                    : '',
                thread.propagation.length
                    ? `传播节点=${thread.propagation.join('、')}`
                    : '',
                thread.causedBy.length ? `因果父项=${thread.causedBy.join('、')}` : '',
                thread.effects.length ? `已生效影响=${thread.effects.join('；')}` : '',
                thread.rumors.length ? `传播中的流言=${thread.rumors.join('；')}` : '',
            ].filter(Boolean).join('；');
        });
    const aftermathRows = aftermath.map((thread) => [
        `[${thread.id}] ${thread.title}（已结束）`,
        `收束=${thread.resolution || thread.summary || '事件已经结束'}`,
        thread.effects.length ? `持续影响=${thread.effects.join('；')}` : '',
        thread.rumors.length ? `仍在传播=${thread.rumors.join('；')}` : '',
    ].filter(Boolean).join('；'));
    return [
        '<World_Continuity_Package>',
        directorText,
        normalized.lastTick.action
            ? `最近世界调度=${CONTINUITY_TICK_LABELS[normalized.lastTick.action] || normalized.lastTick.action}；对象=${normalized.lastTick.threadId || '全局'}；依据=${tickReason}`
            : '最近世界调度=尚未运行。',
        '以下只包含已经接入主线或具备真实汇流证据的“小型主线接口”，不是完整后台账本；未列出的复杂支线仍会在幕后独立演化。',
        `本回合可自然采用0—${visibleLimit}条接口；没有合适叙事位置时必须采用0条，禁止为了证明后台调度存在而生硬插入。`,
        '多个触发条件在同一时点分别成熟，或事件共享同一时间、地点、人物、势力、资源或直接因果簇时，可以在同一回合共同爆发；上限不是要求凑数，也不得把互不相关、尚未成熟的事件强行拼成一场。',
        '只可推动NPC、势力、环境、约定与敌方行动；禁止替玩家角色决定、说话、移动、消费资源或追加检定。',
        '未来计划都只是条件式提案：成功路线只在真实成功后启用，失败路线也必须保留，不得把计划目标当成已发生事实。',
        hasScenarioPlan
            ? '副本/场景规划是“当前有效、允许因果修订”的幕后结构，不是要求照演的剧本。玩家仍可自由选路、绕行、谈判、失败或制造意外；主回复不得自行改写规划，只有后续世界调度通过证据门槛并登记新版本后，新的目标、完成条件、终局威胁、路线、时限或赌注才生效。'
            : '',
        hasScenarioPlan
            ? '必须尊重规划中已经取得的胜利与进度。当前完成条件已经满足或closure=ready/completed时，应自然结算或收束；禁止为了延长副本临时追加更强怪物、隐藏阶段、第二个“真正最终Boss”或新主目标。'
            : '',
        hasScenarioPlan
            ? '比原终局威胁更强的新敌人只有在当前版本activeApex已经被可追溯修订时才能成为本副本的新终局；否则只能是另一个有独立因果与边界的后续世界事件。completed/failed的规划不可复开。'
            : '',
        '裁决与规划必须隔离：先按当前卡/骰子前端规则锁定行动、DC、应消费的唯一骰值与成功等级，再选择匹配的剧情分支。若提供骰池或随机序列，只能按其规定位置/顺序取值，禁止为了配合规划浏览后挑选成功数字；禁止先写结果再补造检定。',
        'hidden信息只能形成符合传播路径的痕迹，不能让不知情角色突然全知。计划、传闻和未来可能性不得写成已经发生的事实。',
        'relation=independent或latent的事件默认只在后台账本推进，禁止为了展示伏笔而强行写入正文；只有传播、人物/势力、地点、资源、时间或因果证据通过账本校验并转为converging后，才会出现在这里。',
        '独立事件可以始终不与主线相交，也可以在幕后自行解决；不要把所有世界变化都变成围着玩家转的任务。',
        '已结束事件不是被抹除：其effects与rumors仍是世界事实；若影响仍会自行发展，应沿causedBy建立新的稳定事件，禁止把同一事件无限续命。',
        '采用汇流候选时，只写“可观察入口”及其自然后果；入口可以是风声、价格/供给、公告、环境异常、NPC态度或行动，不必让支线人物直接登场。若入口与当前叙事节奏不合，继续不写。',
        visibleWorldRows.length
            ? '以下是已经公开或正在产生客观影响的世界表面，不是逐项播报清单；仅当当前人物、地点、资源或行动实际会接触时才自然体现，没有列出的隐藏条目不得泄露：'
            : '',
        ...scenarioRows,
        ...visibleWorldRows,
        ...rows,
        ...aftermathRows,
        '</World_Continuity_Package>',
    ].join('\n');
}

const LEGACY_CONSUMER_DIRECTORS = Object.freeze([
    'stitches',
    'world',
    'world_preset',
    'preset',
    'mixed',
    'standalone',
]);

const LEGACY_CONSUMER_RAW_MAX_VISIBLE = Object.freeze([0, 1, 2, 3, 4]);

const CONTINUITY_PACKET_MAX_CHARS = 12000;
const CONTINUITY_PACKET_OPEN = '<World_Continuity_Package>';
const CONTINUITY_PACKET_CLOSE = '</World_Continuity_Package>';

export function continuityPacketPayloadDigest(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const normalized = {
        text: cleanText(source.text, CONTINUITY_PACKET_MAX_CHARS),
        visibleThreadIds: cleanList(source.visibleThreadIds, 4, 90),
        visibleWorldIds: cleanList(source.visibleWorldIds, 16, 120),
    };
    return `continuity-payload:${fingerprint(JSON.stringify(normalized))}`;
}

/**
 * Produces the exact bounded text persisted by P3 and reconstructed by P4.
 * When the legacy renderer exceeds the carrier budget, only its canonical
 * tail is clipped and the closing marker is restored inside the same budget.
 * This keeps the packet structurally complete and makes truncation explicit
 * and deterministic instead of persisting a prefix that P4 can never accept.
 */
export function buildContinuityPacketText(state, options = {}) {
    const full = cleanText(buildContinuityInjection(state, options), Number.MAX_SAFE_INTEGER);
    const maxChars = Math.max(512, Math.floor(Number(options?.maxChars)
        || CONTINUITY_PACKET_MAX_CHARS));
    if (full.length <= maxChars) return full;
    const suffix = ` ${CONTINUITY_PACKET_CLOSE}`;
    const prefixLimit = Math.max(
        CONTINUITY_PACKET_OPEN.length,
        maxChars - suffix.length,
    );
    const prefix = full.slice(0, prefixLimit).trimEnd();
    return `${prefix}${suffix}`.slice(0, maxChars);
}

function exactLegacyVisibleProjection(state, rawMaxVisible) {
    const normalized = normalizeContinuityState(state, { maxThreads: 12 });
    return normalized.threads
        .filter((thread) => (
            thread.stage !== 'resolved'
            && thread.relation === 'converging'
        ))
        .slice(0, Math.max(0, Number(rawMaxVisible) || 0))
        .map((thread) => thread.id);
}

function exactStringListMatches(left, right) {
    return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => value === right[index]);
}

/**
 * Strictly projects the already-persisted P3 legacy text into the sole P4
 * consumer carrier. It never repairs, reorders, rewrites, or persists the
 * P3 payload: a packet must exactly replay the known legacy renderer first.
 */
export function buildContinuityConsumerPayload(state, packet) {
    const rawPacket = packet && typeof packet === 'object' ? packet : {};
    const normalizedState = normalizeContinuityState(state, { maxThreads: 12 });
    const normalizedPacket = normalizeNextTurnInjection(rawPacket);
    const rawText = typeof rawPacket?.payload?.text === 'string'
        ? rawPacket.payload.text
        : '';
    const canonicalText = cleanText(rawText, 12000);
    if (
        !normalizedPacket
        || normalizedPacket.version !== 1
        || !normalizedPacket.settlementProof
        || canonicalText !== normalizedPacket.payload.text
    ) return { ok: false, reason: 'legacy_packet_invalid' };

    // Current P3 packets bind the exact persisted carrier text and visible-ID
    // projection. P4 already verifies the producer target, continuity digest,
    // settlement proof, and same-target action authority before entering this
    // projector, so the payload digest closes the last mutable field without
    // requiring a second render of a potentially very large world state.
    if (normalizedPacket.payloadFormat === 'canonical-bounded-v1') {
        if (!normalizedPacket.payloadDigest) {
            return { ok: false, reason: 'payload_digest_missing' };
        }
        if (
            normalizedPacket.payloadDigest
                !== continuityPacketPayloadDigest(normalizedPacket.payload)
        ) return { ok: false, reason: 'payload_digest_mismatch' };
        if (!canonicalText) {
            if (normalizedPacket.payload.visibleThreadIds.length) {
                return { ok: false, reason: 'payload_structure_invalid' };
            }
            return {
                ok: true,
                text: '',
                empty: true,
                legacy: null,
            };
        }
        if (
            !canonicalText.startsWith(`${CONTINUITY_PACKET_OPEN} `)
            || !canonicalText.endsWith(CONTINUITY_PACKET_CLOSE)
        ) return { ok: false, reason: 'payload_structure_invalid' };
        return {
            ok: true,
            text: canonicalText,
            empty: false,
            legacy: null,
        };
    }

    if (!canonicalText) return { ok: false, reason: 'legacy_packet_invalid' };

    const candidates = new Map();
    for (const rawMaxVisible of LEGACY_CONSUMER_RAW_MAX_VISIBLE) {
        const currentText = buildContinuityInjection(normalizedState, {
            director: 'doctor',
            maxVisible: rawMaxVisible,
        });
        const canonicalCurrentText = buildContinuityPacketText(normalizedState, {
            director: 'doctor',
            maxVisible: rawMaxVisible,
        });
        const visibleProjection = exactLegacyVisibleProjection(
            normalizedState,
            rawMaxVisible,
        );
        const key = JSON.stringify([canonicalCurrentText, visibleProjection]);
        candidates.set(key, {
            director: 'doctor',
            rawMaxVisible,
            legacyText: currentText,
            canonicalLegacyText: canonicalCurrentText,
            visibleProjection,
        });
    }
    for (const director of LEGACY_CONSUMER_DIRECTORS) {
        for (const rawMaxVisible of LEGACY_CONSUMER_RAW_MAX_VISIBLE) {
            const legacyText = buildContinuityInjection(normalizedState, {
                director,
                maxVisible: rawMaxVisible,
                renderLegacyDirector: true,
            });
            const canonicalLegacyText = buildContinuityPacketText(normalizedState, {
                director,
                maxVisible: rawMaxVisible,
                renderLegacyDirector: true,
            });
            const visibleProjection = exactLegacyVisibleProjection(
                normalizedState,
                rawMaxVisible,
            );
            const key = JSON.stringify([canonicalLegacyText, visibleProjection]);
            if (!candidates.has(key)) candidates.set(key, {
                director,
                rawMaxVisible,
                legacyText,
                canonicalLegacyText,
                visibleProjection,
            });
        }
    }
    const matches = [...candidates.values()].filter((candidate) => (
        candidate.canonicalLegacyText === canonicalText
        && exactStringListMatches(
            candidate.visibleProjection,
            normalizedPacket.payload.visibleThreadIds,
        )
    ));
    if (matches.length !== 1) {
        return {
            ok: false,
            reason: matches.length ? 'legacy_projection_ambiguous' : 'legacy_projection_mismatch',
        };
    }

    const lines = matches[0].legacyText.split('\n');
    if (
        lines.length < 4
        || lines[0] !== '<World_Continuity_Package>'
        || lines.at(-1) !== '</World_Continuity_Package>'
    ) return { ok: false, reason: 'legacy_projection_structure_invalid' };

    const expectedDirectorLine = cleanText(lines[1], Number.MAX_SAFE_INTEGER);
    const canonicalPrefix = `${CONTINUITY_PACKET_OPEN} ${expectedDirectorLine}`;
    if (
        !expectedDirectorLine
        || !canonicalText.startsWith(`${canonicalPrefix} `)
        || !canonicalText.endsWith(CONTINUITY_PACKET_CLOSE)
    ) {
        return { ok: false, reason: 'legacy_projection_director_invalid' };
    }

    const canonicalBody = canonicalText.slice(canonicalPrefix.length).trim();

    return {
        ok: true,
        text: cleanText(`${CONTINUITY_PACKET_OPEN} ${canonicalBody}`, 12000),
        legacy: {
            director: matches[0].director,
            rawMaxVisible: matches[0].rawMaxVisible,
        },
    };
}

export function continuityContentDigest(state) {
    const normalized = normalizeContinuityState(state, { maxThreads: 12 });
    delete normalized.updatedAt;
    return JSON.stringify(normalized);
}

export function continuityConsumptionEvidence(receipt, content) {
    const accepted = String(content || '');
    return (Array.isArray(receipt?.semanticEvidenceTerms)
        ? receipt.semanticEvidenceTerms
        : [])
        .map((term) => cleanText(term, 700))
        .find((term) => term.length >= 4 && accepted.includes(term)) || '';
}

export function selectContinuityInjectionCandidates(candidates, receipts, {
    targetTurn = 0,
} = {}) {
    const latestReceiptByThread = new Map();
    for (const receipt of Array.isArray(receipts) ? receipts : []) {
        const threadId = cleanText(receipt?.threadId, 160);
        if (!threadId) continue;
        const previous = latestReceiptByThread.get(threadId);
        if (!previous || Number(previous.injectedAt || 0) < Number(receipt.injectedAt || 0)) {
            latestReceiptByThread.set(threadId, receipt);
        }
    }
    const selectedByThread = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const threadId = cleanText(candidate?.threadId, 160);
        if (!threadId) continue;
        const existing = selectedByThread.get(threadId);
        if (!existing || Number(candidate?.priority || 0) > Number(existing?.priority || 0)) {
            selectedByThread.set(threadId, candidate);
        }
    }
    return [...selectedByThread.values()]
        .filter((candidate) => {
            const previous = latestReceiptByThread.get(cleanText(candidate.threadId, 160));
            if (!previous) return true;
            if (
                ['injected', 'landed', 'missing', 'retained'].includes(previous.status)
                && Number(previous.expiresTurn || 0) >= Number(targetTurn || 0)
            ) return false;
            const cooldownTurns = previous.status === 'consumed' ? 2 : 1;
            return Number(targetTurn || 0)
                > Number(previous.targetTurn || 0) + cooldownTurns;
        })
        .sort((left, right) => (
            Number(right?.priority || 0) - Number(left?.priority || 0)
            || cleanText(left?.threadId, 160).localeCompare(
                cleanText(right?.threadId, 160),
            )
        ));
}

export function settleContinuityNarrativeReceipts(receipts, batches, {
    captured = null,
    content = '',
    now = Date.now(),
} = {}) {
    const capture = captured && typeof captured === 'object' ? captured : {};
    let changed = false;
    let consumed = 0;
    let retained = 0;
    const queue = (Array.isArray(receipts) ? receipts : []).map((receipt) => {
        if (
            receipt?.generationId !== capture.generationId
            || Number(receipt?.generationSerial || 0) !== Number(capture.generationSerial || 0)
            || String(receipt?.chatId || '') !== String(capture.chatId || '')
            || !['injected', 'landed', 'missing'].includes(receipt.status)
        ) return clone(receipt);
        const evidence = continuityConsumptionEvidence(receipt, content);
        const expired = Number(receipt.expiresTurn || 0)
            < Number(receipt.targetTurn || 0);
        const status = expired ? 'expired' : evidence ? 'consumed' : 'retained';
        if (status === 'consumed') consumed += 1;
        if (status === 'retained') retained += 1;
        changed = true;
        return {
            ...clone(receipt),
            status,
            stages: [
                ...(receipt.stages || []),
                {
                    stage: 'response_settled',
                    status,
                    at: now,
                    evidence,
                },
            ],
            consumptionEvidence: evidence,
            settledAt: now,
            consumedBy: status === 'consumed'
                ? {
                    chatId: capture.chatId,
                    messageId: capture.messageId,
                    index: capture.index,
                    swipeId: capture.swipeId,
                    contentFingerprint: capture.contentFingerprint,
                }
                : null,
        };
    });
    const nextBatches = (Array.isArray(batches) ? batches : []).map((batch) => (
        batch?.generationId === capture.generationId
            && Number(batch?.generationSerial || 0) === Number(capture.generationSerial || 0)
            ? {
                ...clone(batch),
                status: consumed > 0 ? 'narrative_acknowledged' : 'retained',
                consumedCount: consumed,
                retainedCount: retained,
                responseContentFingerprint: capture.contentFingerprint,
                settledAt: now,
            }
            : clone(batch)
    ));
    return {
        queue,
        batches: nextBatches,
        changed,
        consumed,
        retained,
    };
}

export function appendRepairJournal(namespace, record, {
    maxEntries = 5,
    maxSnapshotChars = 180000,
} = {}) {
    const next = namespace && typeof namespace === 'object' ? clone(namespace) : {};
    const journal = Array.isArray(next.repairJournal) ? clone(next.repairJournal) : [];
    const clean = clone(record || {});
    if (clean.snapshot) {
        try {
            if (JSON.stringify(clean.snapshot).length > maxSnapshotChars) {
                delete clean.snapshot;
                clean.snapshotOmitted = true;
            }
        } catch {
            delete clean.snapshot;
            clean.snapshotOmitted = true;
        }
    }
    const existingIndex = clean.id
        ? journal.findIndex((item) => item?.id === clean.id)
        : -1;
    if (existingIndex >= 0) journal[existingIndex] = clean;
    else journal.push(clean);
    next.repairJournal = journal.slice(-Math.max(1, Number(maxEntries) || 5));
    return next;
}

export function latestUndoRecord(namespace) {
    const journal = Array.isArray(namespace?.repairJournal)
        ? namespace.repairJournal
        : [];
    for (let index = journal.length - 1; index >= 0; index -= 1) {
        const record = journal[index];
        if (['applied', 'prepared'].includes(record?.status)) return clone(record);
    }
    return null;
}

export function markRepairUndone(namespace, recordId) {
    const next = namespace && typeof namespace === 'object' ? clone(namespace) : {};
    next.repairJournal = (Array.isArray(next.repairJournal) ? next.repairJournal : [])
        .map((record) => record?.id === recordId
            ? { ...record, status: 'undone', undoneAt: Date.now() }
            : record);
    return next;
}
