import { fingerprint } from './core.mjs';
import {
    actorIdFromName,
    isActorId,
    normalizeActorRefs,
} from './actor-ref-core.mjs';
import {
    actorProfileReadyForAction,
    normalizeActorProfileV6,
} from './actor-profile-v6-core.mjs';
import {
    actorActionNarrativeInjection,
    adjudicateActorActionAttempt,
    createActorActionAttempt,
    worldEventFromSettledActionReceipt,
} from './actor-authority-core.mjs';

export const ACTOR_LEDGER_VERSION = 6;
export const ACTOR_LEDGER_MAX_ACTORS = 96;
export const ACTOR_LEDGER_MAX_RECEIPTS = 240;

const TIERS = new Set(['key', 'secondary', 'background']);
const STATUSES = new Set(['active', 'dormant', 'departed', 'deceased', 'resolved']);
const KNOWLEDGE_KINDS = new Set(['observed', 'reported', 'inferred']);
const INTENTS = new Set(['execute', 'replan', 'wait']);
const PRIVATE_NARRATION = /(?:心想|暗想|暗自|内心|心底|心理|秘密想|私下决定|未说出口|回忆起|玩家的秘密|玩家私密)/u;
const PLAYER_SOVEREIGNTY = /(?:让|迫使|命令|说服|要求)(?:了)?玩家(?:接受|同意|服从|支付|交出|前往|离开|攻击|回答|承诺|决定)|玩家(?:接受了|同意了|服从了|支付了|交出了|前往了|离开了|攻击了|回答了|承诺了|决定了)/u;
const GENERIC_WAIT = /^(?:等待|继续等待|暂时不动|按兵不动|保持现状|没有变化|暂无变化|无事发生|条件未成熟)[。.!！]?$/u;
const GROUP_NAME = /(?:队|小队|团队|军|军团|旅团|兵团|团|协会|组织|公司|集团|家族|势力|帮派|教会|政府|部门|机构|委员会|居民|商户|人群|群众|议会|公会|商会)$/u;
const NON_ACTOR_NAME = /^(?:玩家|player|user|系统|system|环境|environment|世界|world|旁白|narrator|主持人|gm|game master)$/iu;
const PLAYER_DEPENDENT_GOAL = /(?:等待|等候|直到|由|让|需要|必须等)(?:玩家|主角|主人|user|player)|(?:玩家|主角|主人|user|player).{0,24}(?:决定|联系|召唤|下令|命令|批准|同意|前往|到来|选择|处置)/iu;
const DIRECT_OBSERVATION = /(?:看见|看到|目睹|注意到|发现|听见|听到|闻到|察觉|收到|读到|被告知|获悉|亲历|遭遇|触碰|检查到|观察到)/u;
const OBSERVATION_NEGATION = /(?:没看见|没有看见|未看见|没听见|没有听见|未听见|一无所知|并不知道|不知情|尚未知晓)/u;

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 500) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 12, itemLimit = 300) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const raw of value) {
        const item = cleanText(raw, itemLimit);
        const key = item.toLocaleLowerCase();
        if (!item || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}

function integer(value, minimum, maximum, fallback) {
    const parsed = Math.floor(Number(value));
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function number(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function stableActorId(name) {
    return actorIdFromName(name);
}

function normalizeExcludedActorNames(value) {
    return new Set(cleanList(value, 24, 160).map((item) => item.toLocaleLowerCase()));
}

function isActorName(value, excludedActorNames = new Set()) {
    const name = cleanText(value, 160);
    return !!name
        && name.length >= 2
        && !NON_ACTOR_NAME.test(name)
        && !GROUP_NAME.test(name)
        && !excludedActorNames.has(name.toLocaleLowerCase());
}

function playerDependentGoal(value, excludedActorNames = new Set()) {
    const text = cleanText(value, 500);
    if (!text) return false;
    if (PLAYER_DEPENDENT_GOAL.test(text)) return true;
    const lower = text.toLocaleLowerCase();
    return [...excludedActorNames].some((name) => (
        name
        && lower.includes(name)
        && /(?:决定|联系|召唤|下令|命令|批准|同意|前往|到来|选择|处置|传唤|发话)/u.test(text)
    ));
}

function normalizeSourceRef(value) {
    if (!value || typeof value !== 'object') return null;
    const chatId = cleanText(value.chatId, 180);
    const messageId = cleanText(value.messageId, 180);
    const hash = cleanText(value.hash, 100);
    if (!chatId || !messageId || !hash) return null;
    return {
        chatId,
        messageId,
        index: integer(value.index, 0, Number.MAX_SAFE_INTEGER, 0),
        swipeId: integer(value.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        generation: integer(value.generation, 0, Number.MAX_SAFE_INTEGER, 0),
        branchId: cleanText(value.branchId, 180),
        hash,
    };
}

function normalizeKnowledge(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const claim = cleanText(value.claim, 700);
    if (!claim) return null;
    const sourceRef = normalizeSourceRef(value.sourceRef);
    return {
        id: cleanText(value.id, 100)
            || `K-${fingerprint(`${claim}|${sourceRef?.hash || index}`).slice(0, 16)}`,
        claim,
        kind: KNOWLEDGE_KINDS.has(value.kind) ? value.kind : 'reported',
        confidence: number(value.confidence, 0, 1, value.kind === 'observed' ? 1 : 0.6),
        learnedTurn: integer(value.learnedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        sourceRef,
        propagation: cleanList(value.propagation, 12, 160),
    };
}

function normalizeResources(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const used = new Set();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const name = cleanText(raw.name || raw.id, 120);
        const id = cleanText(raw.id, 100)
            || `RES-${fingerprint(name.toLocaleLowerCase()).slice(0, 12)}`;
        if (!name || used.has(id)) continue;
        used.add(id);
        result.push({
            id,
            name,
            amount: number(raw.amount, 0, 1_000_000_000, 0),
            unit: cleanText(raw.unit, 60),
            evidence: cleanList(raw.evidence, 6, 240),
        });
        if (result.length >= 24) break;
    }
    return result;
}

function normalizeCommitments(value, turn) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
            id: cleanText(item.id, 100) || `COM-${index + 1}`,
            summary: cleanText(item.summary, 400),
            dueTurn: integer(item.dueTurn, 0, Number.MAX_SAFE_INTEGER, turn + 1),
            status: ['open', 'fulfilled', 'broken', 'cancelled'].includes(item.status)
                ? item.status
                : 'open',
            targetActorId: cleanText(item.targetActorId, 100),
            evidence: cleanList(item.evidence, 6, 240),
        }))
        .filter((item) => item.summary)
        .slice(0, 16);
}

function normalizeActor(value, index, turn) {
    if (!value || typeof value !== 'object') return null;
    const name = cleanText(value.name || value.id, 160);
    if (!name) return null;
    const identity = value.identity && typeof value.identity === 'object' ? value.identity : {};
    const hidden = value.hidden && typeof value.hidden === 'object' ? value.hidden : {};
    const lineage = value.lineage && typeof value.lineage === 'object' ? value.lineage : {};
    const plan = value.plan && typeof value.plan === 'object' ? value.plan : {};
    const location = value.location && typeof value.location === 'object'
        ? value.location
        : { name: value.location };
    const id = cleanText(value.id, 120) || stableActorId(name);
    return {
        id,
        name,
        tier: TIERS.has(value.tier) ? value.tier : 'background',
        status: STATUSES.has(value.status) ? value.status : 'active',
        inactiveReason: ['sleep', 'absence', 'quiet'].includes(value.inactiveReason)
            ? value.inactiveReason
            : '',
        identity: {
            role: cleanText(identity.role, 180),
            species: cleanText(identity.species, 160),
            profileSummary: cleanText(identity.profileSummary, 700),
            gender: cleanText(identity.gender, 80),
            age: cleanText(identity.age, 80),
            briefIntro: cleanText(identity.briefIntro, 240),
            appearance: cleanText(identity.appearance, 1200),
            identityText: cleanText(identity.identityText, 500),
            relationState: cleanText(identity.relationState, 1200),
            attitudeToProtagonist: cleanText(identity.attitudeToProtagonist, 600),
            pastExperience: cleanText(identity.pastExperience, 2400),
            biography: cleanText(identity.biography, 2400),
            primaryColor: cleanText(identity.primaryColor, 200),
            primaryDerivatives: cleanList(identity.primaryDerivatives, 3, 700),
            primarySentence: cleanText(identity.primarySentence, 700),
            baseColor: cleanText(identity.baseColor, 200),
            baseDerivatives: cleanList(identity.baseDerivatives, 3, 700),
            baseSentence: cleanText(identity.baseSentence, 700),
            accentColor: cleanText(identity.accentColor, 200),
            accentDerivatives: cleanList(identity.accentDerivatives, 3, 700),
            accentSentence: cleanText(identity.accentSentence, 700),
            othersVoices: cleanList(identity.othersVoices, 7, 700),
            authorVoice: cleanText(identity.authorVoice, 1400),
            aliases: cleanList(identity.aliases, 8, 120),
            traits: cleanList(identity.traits, 12, 180),
            desires: cleanList(identity.desires, 12, 240),
            boundaries: cleanList(identity.boundaries, 12, 240),
            socialStyle: cleanText(identity.socialStyle, 240),
            decisionStyle: cleanText(identity.decisionStyle, 240),
            speechStyle: cleanText(identity.speechStyle, 240),
            copingStyle: cleanText(identity.copingStyle, 240),
            informationStyle: cleanText(identity.informationStyle, 240),
            typicalMisread: cleanText(identity.typicalMisread, 240),
            relationshipDistancePattern: cleanText(identity.relationshipDistancePattern, 240),
            selfImageGap: cleanText(identity.selfImageGap, 240),
            learnedCounterDisposition: cleanText(identity.learnedCounterDisposition, 240),
            pressureResponse: cleanText(identity.pressureResponse, 240),
            recoveryPath: cleanText(identity.recoveryPath, 240),
            everydayHabits: cleanList(identity.everydayHabits, 8, 180),
            blindSpots: cleanList(identity.blindSpots, 8, 220),
        },
        lineage: {
            rootActorId: cleanText(lineage.rootActorId, 120) || id,
            currentForm: cleanText(lineage.currentForm, 160) || name,
            mergedActorIds: cleanList(lineage.mergedActorIds, 24, 120),
            forms: (Array.isArray(lineage.forms) ? lineage.forms : [{
                name,
                turn: integer(value.createdTurn, 0, Number.MAX_SAFE_INTEGER, turn),
                evidence: cleanList(value.evidence, 4, 240),
            }])
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    name: cleanText(item.name, 160),
                    turn: integer(item.turn, 0, Number.MAX_SAFE_INTEGER, turn),
                    evidence: cleanList(item.evidence, 8, 240),
                }))
                .filter((item) => item.name)
                .slice(-12),
        },
        longTermGoals: cleanList(value.longTermGoals, 12, 400),
        currentGoals: cleanList(value.currentGoals, 8, 400),
        constraints: cleanList(value.constraints, 12, 500),
        stimuli: (Array.isArray(value.stimuli) ? value.stimuli : [])
            .filter((item) => item && typeof item === 'object')
            .map((item, stimulusIndex) => ({
                id: cleanText(item.id, 120)
                    || `STIM-${fingerprint(`${id}|${item.kind}|${item.summary}|${stimulusIndex}`).slice(0, 16)}`,
                kind: ['observation', 'opportunity', 'risk'].includes(item.kind)
                    ? item.kind
                    : 'observation',
                summary: cleanText(item.summary, 500),
                sourceThreadId: cleanText(item.sourceThreadId, 120),
                status: ['unreviewed', 'adopted', 'ignored', 'misread', 'used', 'opposed']
                    .includes(item.status)
                    ? item.status
                    : 'unreviewed',
                observedTurn: integer(item.observedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
                decidedTurn: integer(item.decidedTurn, 0, Number.MAX_SAFE_INTEGER, 0),
                decisionReason: cleanText(item.decisionReason, 300),
                evidence: cleanList(item.evidence, 8, 240),
            }))
            .filter((item) => item.summary)
            .slice(-48),
        stateFacts: (Array.isArray(value.stateFacts) ? value.stateFacts : [])
            .filter((item) => item && typeof item === 'object')
            .map((item, factIndex) => ({
                id: cleanText(item.id, 120)
                    || `ASF-${fingerprint(`${id}|${item.kind}|${item.summary}|${factIndex}`).slice(0, 16)}`,
                kind: cleanText(item.kind, 80) || 'condition',
                summary: cleanText(item.summary, 500),
                turn: integer(item.turn, 0, Number.MAX_SAFE_INTEGER, turn),
                evidence: cleanList(item.evidence, 8, 240),
            }))
            .filter((item) => item.summary)
            .slice(-48),
        knowledge: (Array.isArray(value.knowledge) ? value.knowledge : [])
            .map((item, knowledgeIndex) => normalizeKnowledge(item, knowledgeIndex, turn))
            .filter(Boolean)
            .slice(-48),
        location: {
            name: cleanText(location.name, 180) || 'unknown',
            sinceTurn: integer(location.sinceTurn, 0, Number.MAX_SAFE_INTEGER, turn),
            evidence: cleanList(location.evidence, 8, 240),
        },
        resources: normalizeResources(value.resources),
        capabilities: cleanList(value.capabilities, 24, 160),
        relationships: (Array.isArray(value.relationships) ? value.relationships : [])
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                actorId: cleanText(item.actorId, 120),
                summary: cleanText(item.summary, 300),
                evidence: cleanList(item.evidence, 6, 240),
            }))
            .filter((item) => item.actorId && item.summary)
            .slice(0, 24),
        commitments: normalizeCommitments(value.commitments, turn),
        hidden: {
            emotionalInertia: cleanList(hidden.emotionalInertia, 12, 240),
            innerConflicts: cleanList(hidden.innerConflicts, 12, 300),
            privateIntentions: cleanList(hidden.privateIntentions, 12, 300),
        },
        plan: {
            summary: cleanText(plan.summary, 500),
            steps: cleanList(plan.steps, 12, 300),
            status: ['active', 'blocked', 'completed', 'abandoned'].includes(plan.status)
                ? plan.status
                : 'active',
            priority: ['low', 'normal', 'high', 'critical'].includes(plan.priority)
                ? plan.priority
                : 'normal',
            nextWindow: cleanText(plan.nextWindow, 180),
            obstacles: cleanList(plan.obstacles, 12, 300),
            costs: cleanList(plan.costs, 12, 300),
            alternatives: cleanList(plan.alternatives, 12, 300),
        },
        lastAction: value.lastAction && typeof value.lastAction === 'object'
            ? {
                id: cleanText(value.lastAction.id, 120),
                turn: integer(value.lastAction.turn, 0, Number.MAX_SAFE_INTEGER, turn),
                summary: cleanText(value.lastAction.summary, 500),
                outcome: cleanText(value.lastAction.outcome, 120),
            }
            : null,
        actionHistory: (Array.isArray(value.actionHistory) ? value.actionHistory : [])
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                id: cleanText(item.id, 160),
                turn: integer(item.turn, 0, Number.MAX_SAFE_INTEGER, turn),
                route: ['foreground_offer', 'foreground_attempt', 'background_private', 'background_public']
                    .includes(item.route)
                    ? item.route
                    : 'background_private',
                attempt: cleanText(item.attempt, 700),
                resultStatus: cleanText(item.resultStatus, 80),
                resultId: cleanText(item.resultId, 160),
                visibility: cleanText(item.visibility, 80),
                disclosure: cleanText(item.disclosure, 80),
                cost: cleanList(item.cost, 8, 240),
                risk: cleanText(item.risk, 80),
                durationTurns: integer(item.durationTurns, 0, 10_000, 0),
                resultSummary: cleanText(item.resultSummary, 700),
                observableConsequence: cleanText(item.observableConsequence, 500),
                revealPath: cleanText(item.revealPath, 500),
                worldAdjudicated: item.worldAdjudicated === true,
                evidence: cleanList(item.evidence, 8, 240),
            }))
            .filter((item) => item.id && item.attempt)
            .slice(-80),
        profileV6: normalizeActorProfileV6(value.profileV6, { id, actorId: id, name }),
        nextActionTurn: integer(value.nextActionTurn, 0, Number.MAX_SAFE_INTEGER, turn + 1),
        deadlineTurn: integer(value.deadlineTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        lastSemanticTurn: integer(
            value.lastSemanticTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            value.lastAction?.turn ?? value.createdTurn ?? turn,
        ),
        semanticProgressCount: integer(
            value.semanticProgressCount,
            0,
            Number.MAX_SAFE_INTEGER,
            value.settledActionCount ?? 0,
        ),
        lastAttemptTurn: integer(value.lastAttemptTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        consecutiveActionFailures: integer(
            value.consecutiveActionFailures,
            0,
            10_000,
            0,
        ),
        initiative: number(value.initiative, 0, 3, 1),
        opportunity: number(value.opportunity, 0, 3, 0),
        silenceTurns: integer(value.silenceTurns, 0, 10_000, 0),
        attentionScore: number(value.attentionScore, 0, 1_000_000, 0),
        evidence: cleanList(value.evidence, 24, 300),
        version: integer(value.version, 1, Number.MAX_SAFE_INTEGER, 1),
        createdTurn: integer(value.createdTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        updatedTurn: integer(value.updatedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        settledActionCount: integer(value.settledActionCount, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function normalizeReceipt(value) {
    if (!value || typeof value !== 'object') return null;
    const receiptId = cleanText(value.receiptId, 180);
    if (!receiptId) return null;
    return {
        ...clone(value),
        receiptId,
        actionId: cleanText(value.actionId, 160),
        actorId: cleanText(value.actorId, 120),
        stage: ['planned', 'attempted', 'executed', 'world_settled', 'injected', 'response_settled']
            .includes(value.stage)
            ? value.stage
            : 'planned',
        status: cleanText(value.status, 80) || 'pending',
        route: ['foreground_offer', 'foreground_attempt', 'background_private', 'background_public']
            .includes(value.route)
            ? value.route
            : 'background_private',
        resultId: cleanText(value.resultId, 160),
        visibility: cleanText(value.visibility, 80),
        disclosure: cleanText(value.disclosure, 80),
        technicalFailure: false,
        observableConsequence: cleanText(value.observableConsequence, 500),
        createdTurn: integer(value.createdTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        target: value.target && typeof value.target === 'object'
            ? {
                chatId: cleanText(value.target.chatId, 180),
                messageId: cleanText(value.target.messageId, 180),
                swipeId: integer(value.target.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
                generation: integer(value.target.generation, 0, Number.MAX_SAFE_INTEGER, 0),
                branchId: cleanText(value.target.branchId, 180),
                hash: cleanText(value.target.hash, 100),
            }
            : null,
    };
}

export function emptyActorLedger(chatId = '') {
    return {
        version: ACTOR_LEDGER_VERSION,
        chatId: cleanText(chatId, 180),
        turn: 0,
        actors: [],
        identityQuarantine: [],
        actionReceipts: [],
        observationReceipts: [],
        migrations: {
            continuityV5: false,
            actorLedgerV2: true,
            actorLedgerV3: true,
            actorLedgerV4: true,
            actorLedgerV5: true,
            actorLedgerV6: true,
            actorProfileV6: true,
        },
        updatedAt: 0,
    };
}

export function normalizeActorLedger(value, {
    chatId = '',
    maxActors = ACTOR_LEDGER_MAX_ACTORS,
    excludedActorNames = [],
} = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const turn = integer(source.turn, 0, Number.MAX_SAFE_INTEGER, 0);
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const actors = [];
    const used = new Set();
    for (const raw of Array.isArray(source.actors) ? source.actors : []) {
        const item = normalizeActor(raw, actors.length, turn);
        if (!item || !isActorName(item.name, excluded) || used.has(item.id)) continue;
        used.add(item.id);
        actors.push(item);
        if (actors.length >= integer(maxActors, 1, ACTOR_LEDGER_MAX_ACTORS, ACTOR_LEDGER_MAX_ACTORS)) {
            break;
        }
    }
    const identityQuarantine = (Array.isArray(source.identityQuarantine)
        ? source.identityQuarantine
        : [])
        .map((entry, index) => {
            const actor = normalizeActor(entry?.actor || entry, index, turn);
            if (!actor || !isActorId(actor.name)) return null;
            return {
                id: cleanText(entry?.id || actor.id, 120) || actor.id,
                reason: cleanText(entry?.reason, 160) || 'unresolved_internal_id_as_name',
                actor,
                quarantinedTurn: integer(entry?.quarantinedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
                evidence: cleanList(entry?.evidence || actor.evidence, 12, 300),
            };
        })
        .filter(Boolean)
        .filter((entry, index, list) => (
            list.findIndex((candidate) => candidate.id === entry.id) === index
        ))
        .slice(-64);
    return {
        version: ACTOR_LEDGER_VERSION,
        chatId: cleanText(chatId || source.chatId, 180),
        turn,
        actors,
        identityQuarantine,
        actionReceipts: (Array.isArray(source.actionReceipts) ? source.actionReceipts : [])
            .map(normalizeReceipt)
            .filter(Boolean)
            .slice(-ACTOR_LEDGER_MAX_RECEIPTS),
        observationReceipts: (Array.isArray(source.observationReceipts)
            ? clone(source.observationReceipts)
            : []).slice(-120),
        migrations: {
            continuityV5: source.migrations?.continuityV5 === true,
            actorLedgerV2: true,
            actorLedgerV3: true,
            actorLedgerV4: true,
            actorLedgerV5: true,
            actorLedgerV6: true,
            actorProfileV6: source.migrations?.actorProfileV6 === true,
            actorRefV1: source.migrations?.actorRefV1 === true,
        },
        updatedAt: integer(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function mergeEvidence(current, additions, limit = 24) {
    return cleanList([...(current || []), ...(additions || [])], limit, 300);
}

function mergeObjectList(current, additions, identity, limit) {
    const result = clone(Array.isArray(current) ? current : []);
    const seen = new Set(result.map(identity).filter(Boolean));
    for (const item of Array.isArray(additions) ? additions : []) {
        const key = identity(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(clone(item));
    }
    return result.slice(-limit);
}

function mergePollutedActorState(canonical, duplicate) {
    const identityListFields = [
        'aliases',
        'traits',
        'desires',
        'boundaries',
        'everydayHabits',
        'blindSpots',
    ];
    const identityTextFields = [
        'role',
        'socialStyle',
        'decisionStyle',
        'speechStyle',
        'copingStyle',
        'informationStyle',
        'typicalMisread',
        'relationshipDistancePattern',
        'selfImageGap',
        'learnedCounterDisposition',
        'pressureResponse',
        'recoveryPath',
    ];
    for (const field of identityListFields) {
        canonical.identity[field] = mergeEvidence(
            canonical.identity[field],
            duplicate.identity[field],
            field === 'aliases' ? 12 : 16,
        ).filter((item) => (
            !isActorId(item)
            && item.toLocaleLowerCase() !== canonical.name.toLocaleLowerCase()
        ));
    }
    for (const field of identityTextFields) {
        if (!cleanText(canonical.identity[field])) {
            canonical.identity[field] = cleanText(duplicate.identity[field], 240);
        }
    }
    for (const field of ['emotionalInertia', 'innerConflicts', 'privateIntentions']) {
        canonical.hidden[field] = mergeEvidence(
            canonical.hidden[field],
            duplicate.hidden[field],
            16,
        );
    }

    const duplicateIsNewer = duplicate.updatedTurn > canonical.updatedTurn;
    const duplicateLocationKnown = cleanText(duplicate.location?.name, 180)
        && duplicate.location.name !== 'unknown';
    if (
        duplicateLocationKnown
        && (
            canonical.location?.name === 'unknown'
            || (duplicateIsNewer && duplicate.location.sinceTurn >= canonical.location.sinceTurn)
        )
    ) canonical.location = clone(duplicate.location);

    const canonicalPlan = canonical.plan || {};
    const duplicatePlan = duplicate.plan || {};
    for (const field of ['summary', 'nextWindow']) {
        if (
            !cleanText(canonicalPlan[field])
            || (duplicateIsNewer && cleanText(duplicatePlan[field]))
        ) canonicalPlan[field] = cleanText(duplicatePlan[field], field === 'summary' ? 500 : 180);
    }
    for (const field of ['steps', 'obstacles', 'costs', 'alternatives']) {
        canonicalPlan[field] = mergeEvidence(canonicalPlan[field], duplicatePlan[field], 12);
    }
    if (duplicateIsNewer) {
        canonicalPlan.status = duplicatePlan.status || canonicalPlan.status;
        canonicalPlan.priority = duplicatePlan.priority || canonicalPlan.priority;
    }
    canonical.plan = canonicalPlan;
    if (
        duplicate.lastAction
        && (!canonical.lastAction || duplicate.lastAction.turn > canonical.lastAction.turn)
    ) canonical.lastAction = clone(duplicate.lastAction);

    const canonicalProfile = normalizeActorProfileV6(canonical.profileV6, {
        actorId: canonical.id,
        name: canonical.name,
    });
    const duplicateProfile = normalizeActorProfileV6(duplicate.profileV6, {
        actorId: canonical.id,
        name: canonical.name,
    });
    const moduleScore = (module) => (
        Number(module?.status === 'ready') * 10_000
        - (module?.unknownFields?.length || 0) * 100
        + (module?.evidence?.length || 0) * 10
        + Number(module?.version || 0)
    );
    for (const module of Object.keys(canonicalProfile.modules)) {
        if (
            moduleScore(duplicateProfile.modules[module])
            > moduleScore(canonicalProfile.modules[module])
        ) canonicalProfile.modules[module] = clone(duplicateProfile.modules[module]);
        canonicalProfile.moduleVersions[module] = Math.max(
            Number(canonicalProfile.moduleVersions[module]) || 0,
            Number(duplicateProfile.moduleVersions[module]) || 0,
        );
    }
    for (const [path, source] of Object.entries(duplicateProfile.fieldSources || {})) {
        if (canonicalProfile.fieldSources[path] !== 'confirmed') {
            canonicalProfile.fieldSources[path] = source;
        }
    }
    canonicalProfile.locks = Object.fromEntries(
        [...new Set([
            ...Object.keys(duplicateProfile.locks || {}),
            ...Object.keys(canonicalProfile.locks || {}),
        ])].map((path) => [
            path,
            duplicateProfile.locks?.[path] === true
                || canonicalProfile.locks?.[path] === true,
        ]),
    );
    canonicalProfile.manualOverrides = {
        ...(duplicateProfile.manualOverrides || {}),
        ...(canonicalProfile.manualOverrides || {}),
    };
    canonicalProfile.history = mergeObjectList(
        canonicalProfile.history,
        duplicateProfile.history,
        (entry) => entry?.id,
        40,
    );
    canonicalProfile.actorId = canonical.id;
    canonicalProfile.name = canonical.name;
    canonicalProfile.preparedForAction = false;
    canonicalProfile.backgroundPending = true;
    canonicalProfile.coverage = 0;
    canonical.profileV6 = canonicalProfile;

    canonical.nextActionTurn = Math.max(canonical.nextActionTurn, duplicate.nextActionTurn);
    canonical.deadlineTurn = [canonical.deadlineTurn, duplicate.deadlineTurn]
        .filter((turn) => turn > 0)
        .sort((left, right) => left - right)[0] || 0;
    canonical.lastSemanticTurn = Math.max(canonical.lastSemanticTurn, duplicate.lastSemanticTurn);
    canonical.lastAttemptTurn = Math.max(canonical.lastAttemptTurn, duplicate.lastAttemptTurn);
    canonical.consecutiveActionFailures = Math.max(
        canonical.consecutiveActionFailures,
        duplicate.consecutiveActionFailures,
    );
    canonical.silenceTurns = Math.max(canonical.silenceTurns, duplicate.silenceTurns);
    canonical.attentionScore = Math.max(canonical.attentionScore, duplicate.attentionScore);
}

function repairPollutedActorIdentities(ledger) {
    const byId = new Map(ledger.actors.map((actor) => [actor.id, actor]));
    const remove = new Set();
    const remap = new Map();
    const quarantined = new Map(
        (ledger.identityQuarantine || []).map((entry) => [entry.id, entry]),
    );
    const resolveCanonical = (duplicate) => {
        let current = duplicate;
        const visited = new Set([duplicate.id]);
        while (isActorId(current?.name) && current.name !== current.id) {
            const next = byId.get(current.name);
            if (!next || next === current || visited.has(next.id)) return null;
            visited.add(next.id);
            current = next;
        }
        return current === duplicate ? null : current;
    };
    for (const duplicate of ledger.actors) {
        if (!isActorId(duplicate.name)) continue;
        // Resolve the entire polluted-name chain before merging. Merging each
        // hop in array order can otherwise copy C into B after B was already
        // copied into A, silently dropping C when B is removed.
        const canonical = resolveCanonical(duplicate);
        if (!canonical || canonical === duplicate) {
            quarantined.set(duplicate.id, {
                id: duplicate.id,
                reason: 'unresolved_internal_id_as_name',
                actor: clone(duplicate),
                quarantinedTurn: ledger.turn,
                evidence: cleanList(duplicate.evidence, 12, 300),
            });
            remove.add(duplicate.id);
            continue;
        }
        canonical.identity.aliases = cleanList([
            ...canonical.identity.aliases,
            ...duplicate.identity.aliases,
            ...(isActorId(duplicate.lineage.currentForm) ? [] : [duplicate.lineage.currentForm]),
        ], 12, 160).filter((item) => item !== canonical.name && !isActorId(item));
        canonical.lineage.forms = mergeObjectList(
            canonical.lineage.forms,
            duplicate.lineage.forms.filter((item) => !isActorId(item.name)),
            (item) => cleanText(item?.name, 160).toLocaleLowerCase(),
            12,
        );
        canonical.lineage.mergedActorIds = cleanList([
            ...canonical.lineage.mergedActorIds,
            duplicate.id,
            duplicate.lineage.rootActorId,
            ...duplicate.lineage.mergedActorIds,
        ], 24, 120).filter((item) => item !== canonical.id);
        canonical.knowledge = mergeObjectList(canonical.knowledge, duplicate.knowledge, (item) => item?.id, 48);
        canonical.resources = mergeObjectList(canonical.resources, duplicate.resources, (item) => item?.id, 32);
        canonical.relationships = mergeObjectList(
            canonical.relationships,
            duplicate.relationships,
            (item) => `${item?.actorId}|${item?.summary}`,
            24,
        );
        canonical.commitments = mergeObjectList(canonical.commitments, duplicate.commitments, (item) => item?.id, 32);
        canonical.stimuli = mergeObjectList(canonical.stimuli, duplicate.stimuli, (item) => item?.id, 48);
        canonical.stateFacts = mergeObjectList(canonical.stateFacts, duplicate.stateFacts, (item) => item?.id, 48);
        canonical.actionHistory = mergeObjectList(canonical.actionHistory, duplicate.actionHistory, (item) => item?.id, 80);
        canonical.capabilities = mergeEvidence(canonical.capabilities, duplicate.capabilities, 24);
        canonical.currentGoals = mergeEvidence(canonical.currentGoals, duplicate.currentGoals, 8);
        canonical.longTermGoals = mergeEvidence(canonical.longTermGoals, duplicate.longTermGoals, 12);
        canonical.constraints = mergeEvidence(canonical.constraints, duplicate.constraints, 12);
        canonical.evidence = mergeEvidence(canonical.evidence, duplicate.evidence, 24);
        mergePollutedActorState(canonical, duplicate);
        canonical.semanticProgressCount += duplicate.semanticProgressCount;
        canonical.settledActionCount += duplicate.settledActionCount;
        canonical.updatedTurn = Math.max(canonical.updatedTurn, duplicate.updatedTurn);
        canonical.version += 1;
        remove.add(duplicate.id);
        remap.set(duplicate.id, canonical.id);
    }
    ledger.identityQuarantine = [...quarantined.values()].slice(-64);
    if (!remove.size) return ledger;
    ledger.actors = ledger.actors.filter((actor) => !remove.has(actor.id));
    for (const receipt of ledger.actionReceipts) {
        if (remap.has(receipt.actorId)) receipt.actorId = remap.get(receipt.actorId);
        if (remap.has(receipt.targetActorId)) {
            receipt.targetActorId = remap.get(receipt.targetActorId);
        }
        if (Array.isArray(receipt.actorIds)) {
            receipt.actorIds = [...new Set(receipt.actorIds.map((actorId) => (
                remap.get(actorId) || actorId
            )))];
        }
    }
    ledger.observationReceipts = ledger.observationReceipts.map((receipt) => ({
        ...receipt,
        actorId: remap.get(receipt?.actorId) || receipt?.actorId,
        targetActorId: remap.get(receipt?.targetActorId) || receipt?.targetActorId,
        actorIds: Array.isArray(receipt?.actorIds)
            ? [...new Set(receipt.actorIds.map((actorId) => (
                remap.get(actorId) || actorId
            )))]
            : receipt?.actorIds,
        observerActorIds: Array.isArray(receipt?.observerActorIds)
            ? [...new Set(receipt.observerActorIds.map((actorId) => (
                remap.get(actorId) || actorId
            )))]
            : receipt?.observerActorIds,
    }));
    for (const actor of ledger.actors) {
        actor.relationships = actor.relationships.map((relationship) => (
            remap.has(relationship.actorId)
                ? { ...relationship, actorId: remap.get(relationship.actorId) }
                : relationship
        ));
        actor.commitments = actor.commitments.map((commitment) => (
            remap.has(commitment.targetActorId)
                ? { ...commitment, targetActorId: remap.get(commitment.targetActorId) }
                : commitment
        ));
    }
    ledger.migrations.actorRefV1 = true;
    return ledger;
}

function continuityStimulusKind(thread) {
    const text = cleanText([
        thread?.kind,
        thread?.eventType,
        thread?.summary,
        thread?.nextBeat,
        thread?.trigger,
    ].filter(Boolean).join(' '), 1200);
    if (/(?:敌|威胁|风险|危险|追捕|损失|危机|attack|threat|risk)/iu.test(text)) return 'risk';
    if (/(?:机会|资源|邀请|窗口|线索|交易|opportunity|chance)/iu.test(text)) return 'opportunity';
    return 'observation';
}

function mergeActorStimuli(current, additions, limit = 48) {
    const result = Array.isArray(current) ? clone(current) : [];
    const seen = new Set(result.map((item) => item.id));
    for (const item of Array.isArray(additions) ? additions : []) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
    }
    return result.slice(-limit);
}

export function migrateActorLedgerFromContinuity(value, continuity, {
    excludedActorNames = [],
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = repairPollutedActorIdentities(normalizeActorLedger(value, {
        chatId: continuity?.chatId || value?.chatId,
        excludedActorNames,
    }));
    const byId = new Map();
    const byName = new Map();
    for (const actor of ledger.actors) {
        const nameKey = actor.name.toLocaleLowerCase();
        if (byName.has(nameKey)) continue;
        byId.set(actor.id, actor);
        byName.set(nameKey, actor);
    }
    for (const actor of byId.values()) {
        const migratedConstraints = actor.currentGoals.filter(
            (item) => playerDependentGoal(item, excluded),
        );
        actor.currentGoals = actor.currentGoals.filter(
            (item) => !playerDependentGoal(item, excluded),
        );
        actor.constraints = mergeEvidence(
            actor.constraints,
            migratedConstraints,
            12,
        );
    }
    const turn = integer(continuity?.turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    for (const thread of Array.isArray(continuity?.threads) ? continuity.threads : []) {
        const actorRefs = normalizeActorRefs(
            Array.isArray(thread?.actorRefs) && thread.actorRefs.length
                ? thread.actorRefs
                : thread?.actors,
            { actors: [...byId.values()] },
        );
        for (const ref of actorRefs) {
            const existingById = byId.get(ref.actorId);
            const actorName = cleanText(
                existingById?.name || ref.displayName || ref.aliases[0],
                160,
            );
            if (!actorName && isActorId(ref.actorId)) continue;
            if (!isActorName(actorName, excluded)) continue;
            const id = ref.actorId || stableActorId(actorName);
            const nameKey = actorName.toLocaleLowerCase();
            const publicHints = thread?.knowledge === 'hidden'
                ? []
                : cleanList([thread?.nextBeat, thread?.trigger], 4, 400);
            const directiveConstraints = [];
            const stimuli = publicHints.map((summary, stimulusIndex) => ({
                id: `STIM-${fingerprint(`${id}|${thread?.id}|${summary}|${stimulusIndex}`).slice(0, 16)}`,
                kind: continuityStimulusKind(thread),
                summary,
                sourceThreadId: cleanText(thread?.id, 120),
                status: 'unreviewed',
                observedTurn: turn,
                evidence: cleanList([
                    thread?.id,
                    thread?.seedBasis,
                    ...(thread?.sourceRefs || []).map((ref) => ref?.hash),
                ], 8, 240),
            }));
            const current = byId.get(id) || byName.get(nameKey) || normalizeActor({
                id,
                name: actorName,
                tier: 'background',
                location: {
                    name: cleanList(thread?.locations, 1, 180)[0] || 'unknown',
                    sinceTurn: turn,
                    evidence: cleanList([thread?.id, thread?.seedBasis], 8, 240),
                },
                currentGoals: [],
                constraints: directiveConstraints,
                stimuli,
                nextActionTurn: turn + 1,
                evidence: cleanList([
                    thread?.id,
                    thread?.seedBasis,
                    ...(thread?.sourceRefs || []).map((ref) => ref?.hash),
                ], 12, 300),
                createdTurn: turn,
                updatedTurn: turn,
            }, byId.size, turn);
            current.evidence = mergeEvidence(current.evidence, [
                thread?.id,
                thread?.seedBasis,
                ...(thread?.sourceRefs || []).map((ref) => ref?.hash),
            ]);
            if (thread?.knowledge !== 'hidden') {
                const eventGoalHints = new Set(publicHints.map((item) => item.toLocaleLowerCase()));
                current.currentGoals = current.currentGoals.filter(
                    (item) => !eventGoalHints.has(item.toLocaleLowerCase()),
                );
                current.constraints = current.constraints.filter(
                    (item) => !eventGoalHints.has(item.toLocaleLowerCase()),
                );
                current.stimuli = mergeActorStimuli(current.stimuli, stimuli);
                const claim = cleanText(thread?.summary, 700);
                if (claim) {
                    const knowledge = normalizeKnowledge({
                        claim,
                        kind: thread?.knowledge === 'observed' ? 'observed' : 'reported',
                        confidence: thread?.knowledge === 'observed' ? 1 : 0.6,
                        learnedTurn: turn,
                        sourceRef: thread?.sourceRefs?.at?.(-1),
                        propagation: [thread?.id],
                    }, current.knowledge.length, turn);
                    if (
                        knowledge
                        && !current.knowledge.some((item) => item.id === knowledge.id)
                    ) current.knowledge.push(knowledge);
                }
            }
            byId.set(current.id, current);
            byName.set(nameKey, current);
        }
    }
    return normalizeActorLedger({
        ...ledger,
        turn: Math.max(ledger.turn, turn),
        actors: [...byId.values()],
        migrations: {
            ...ledger.migrations,
            continuityV5: true,
            actorLedgerV5: true,
            actorLedgerV6: true,
            actorRefV1: true,
        },
        updatedAt: Date.now(),
    }, {
        chatId: ledger.chatId || continuity?.chatId,
        excludedActorNames,
    });
}

function taggedTextBlocks(text, tag) {
    const source = String(text || '');
    const escaped = String(tag || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    if (!escaped) return [];
    return [...source.matchAll(new RegExp(
        `<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`,
        'giu',
    ))].map((match) => String(match[1] || ''));
}

function sceneActorFacts(userText) {
    const facts = [];
    let location = '';
    for (const block of taggedTextBlocks(userText, 'scene')) {
        const locationMatch = block.match(/(?:地点|位置|location|place)\s*[：:=]\s*([^\n|]+)/iu);
        if (locationMatch?.[1]) location = cleanText(locationMatch[1], 180);
        const presentMatch = block.match(/(?:在场|出场|present)\s*[：:=]\s*([^\n|]+)/iu);
        if (!presentMatch?.[1]) continue;
        for (const raw of presentMatch[1].split(/[,，、;；]/u)) {
            const name = cleanText(raw.replace(/\([^)]*\)|（[^）]*）/gu, ''), 160);
            if (name) facts.push({ name, evidence: `在场：${cleanText(raw, 180)}`, present: true });
        }
    }
    return { facts, location };
}

function actActorFacts(userText) {
    const facts = [];
    for (const block of taggedTextBlocks(userText, 'act')) {
        const headings = [...block.matchAll(/^\s*#{2,6}\s+([^\n#]+?)\s*$/gmu)];
        for (let index = 0; index < headings.length; index += 1) {
            const name = cleanText(headings[index][1], 160);
            const start = (headings[index].index || 0) + headings[index][0].length;
            const end = headings[index + 1]?.index ?? block.length;
            const section = block.slice(start, end);
            if (
                /^(?:新人引导者|系统引导者|系统提示)$/u.test(name)
                && /(?:合成音|转为系统提示|无\s*[（(]?转为系统)/u.test(section)
            ) continue;
            facts.push({
                name,
                evidence: cleanText(`### ${name} ${section}`, 300),
                present: true,
            });
        }
    }
    return facts;
}

function structuredContentActorFacts(content) {
    const facts = [];
    const patterns = [
        /【(?:敌方|人物|角色|NPC)(?:档案|资料|状态)[·・:：]\s*([^】]+)】/giu,
        /<(?:actor|npc)\b[^>]*(?:name|id)=["']([^"']+)["'][^>]*>/giu,
    ];
    for (const pattern of patterns) {
        for (const match of String(content || '').matchAll(pattern)) {
            const name = cleanText(match[1], 160);
            if (name) facts.push({ name, evidence: cleanText(match[0], 300), present: true });
        }
    }
    return facts;
}

function canonicalActorName(name, knownNames, actors) {
    const source = cleanText(name, 160);
    if (!source) return '';
    const candidates = [
        ...(Array.isArray(knownNames) ? knownNames : []),
        ...(Array.isArray(actors) ? actors.flatMap((actor) => [
            actor?.name,
            ...(actor?.identity?.aliases || []),
        ]) : []),
    ].map((item) => cleanText(item, 160)).filter(Boolean);
    const exact = candidates.find((item) => item.toLocaleLowerCase() === source.toLocaleLowerCase());
    if (exact) return exact;
    if (source.length >= 3) {
        const suffixMatches = [...new Set(candidates.filter((item) => (
            item.length > source.length && item.endsWith(source)
        )))];
        if (suffixMatches.length === 1) return suffixMatches[0];
    }
    return source;
}

export function discoverActorsFromTurnSources(value, {
    userText = '',
    acceptedContent = '',
    knownActorNames = [],
    excludedActorNames = [],
    sourceRef = null,
    turn = null,
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = normalizeActorLedger(value, { excludedActorNames });
    const currentTurn = turn === null || turn === undefined
        ? ledger.turn
        : integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const ref = normalizeSourceRef(sourceRef);
    const scene = sceneActorFacts(userText);
    const facts = [
        ...actActorFacts(userText),
        ...scene.facts,
        ...structuredContentActorFacts(acceptedContent),
        ...(Array.isArray(knownActorNames) ? knownActorNames : []).map((name) => ({
            name,
            evidence: `MVU人物锚点：${cleanText(name, 160)}`,
            present: false,
        })),
    ];
    const discovered = [];
    const touched = [];
    for (const fact of facts) {
        const actorName = canonicalActorName(fact.name, knownActorNames, ledger.actors);
        if (!isActorName(actorName, excluded)) continue;
        const nameKey = actorName.toLocaleLowerCase();
        let actor = ledger.actors.find((entry) => (
            entry.name.toLocaleLowerCase() === nameKey
            || entry.identity.aliases.some((alias) => alias.toLocaleLowerCase() === nameKey)
        ));
        const evidence = cleanList([
            fact.evidence,
            ref ? `${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}` : '',
        ], 8, 300);
        if (!actor) {
            actor = normalizeActor({
                id: stableActorId(actorName),
                name: actorName,
                tier: fact.present ? 'secondary' : 'background',
                status: 'active',
                location: {
                    name: scene.location || 'unknown',
                    sinceTurn: currentTurn,
                    evidence,
                },
                evidence,
                nextActionTurn: currentTurn + 1,
                createdTurn: currentTurn,
                updatedTurn: currentTurn,
            }, ledger.actors.length, currentTurn);
            ledger.actors.push(actor);
            discovered.push({ actorId: actor.id, name: actor.name });
        } else {
            actor.evidence = mergeEvidence(actor.evidence, evidence);
            if (fact.present && scene.location) {
                actor.location = {
                    name: scene.location,
                    sinceTurn: currentTurn,
                    evidence: mergeEvidence(actor.location?.evidence, evidence, 12),
                };
            }
            actor.updatedTurn = Math.max(actor.updatedTurn, currentTurn);
            touched.push({ actorId: actor.id, name: actor.name });
        }
    }
    if (discovered.length) {
        ledger.observationReceipts.push({
            receiptId: `actor-discovery:${fingerprint(JSON.stringify([
                ref?.chatId || ledger.chatId,
                ref?.messageId || '',
                ref?.swipeId || 0,
                ref?.generation || 0,
                ref?.hash || '',
                discovered.map((entry) => entry.actorId),
            ])).slice(0, 18)}`,
            kind: 'actor-discovery',
            sourceRef: ref,
            actorIds: discovered.map((entry) => entry.actorId),
            settledAt: Date.now(),
        });
        ledger.observationReceipts = ledger.observationReceipts.slice(-120);
    }
    ledger.turn = Math.max(ledger.turn, currentTurn);
    ledger.updatedAt = Date.now();
    return {
        ledger: normalizeActorLedger(ledger, { excludedActorNames }),
        discovered,
        touched,
        location: scene.location,
    };
}

function mergeProfileText(current, proposed, limit = 240) {
    const oldValue = cleanText(current, limit);
    return oldValue || cleanText(proposed, limit);
}

const VOLATILE_PROFILE_LABEL_RE = /^(?:冷酷|冰冷|暴躁|粗暴|凶狠|残忍|疯狂|狂热|病态|绝望|恐惧|怯懦|结巴|空洞|麻木|杀意|致命武器|忠诚|服从)$/iu;
const TOTALIZING_PROFILE_RE = /(?:不再是.{0,18}而是(?:一件|一个)|彻底(?:失去|抹去|变成|沦为)|(?:全部人格|整个人).{0,12}(?:只剩|化作|变成))/iu;
const TYPOLOGY_PROFILE_RE = /(?:\b(?:INTJ|INTP|ENTJ|ENTP|INFJ|INFP|ENFJ|ENFP|ISTJ|ISFJ|ESTJ|ESFJ|ISTP|ISFP|ESTP|ESFP)\b|\b[1-9]w[1-9]\b|\btritype\b|MBTI|迈尔斯|九型人格|三型组合|依恋类型|安全型依恋|焦虑型依恋|回避型依恋|恐惧型依恋|病娇|地雷系|白切黑|抖[SM]|S\s*\/\s*M)/iu;

function stableProfileText(value, limit = 240) {
    const cleaned = cleanText(value, limit);
    if (
        !cleaned
        || VOLATILE_PROFILE_LABEL_RE.test(cleaned)
        || TOTALIZING_PROFILE_RE.test(cleaned)
        || TYPOLOGY_PROFILE_RE.test(cleaned)
    ) {
        return '';
    }
    return cleaned;
}

function stableProfileList(value, limit = 12, itemLimit = 240) {
    return cleanList(value, limit, itemLimit).filter((item) => (
        !VOLATILE_PROFILE_LABEL_RE.test(item)
        && !TOTALIZING_PROFILE_RE.test(item)
        && !TYPOLOGY_PROFILE_RE.test(item)
    ));
}

function mergeProfilePattern(current, proposed, limit = 240) {
    const oldValue = cleanText(current, limit);
    const newValue = cleanText(proposed, limit);
    if (!newValue) return oldValue;
    if (!oldValue) return newValue;
    const oldKey = evidenceLookupText(oldValue);
    const newKey = evidenceLookupText(newValue);
    if (oldKey === newKey || oldKey.includes(newKey)) return oldValue;
    if (newKey.includes(oldKey)) return newValue;
    return cleanText(`${oldValue}；${newValue}`, limit);
}

function evidenceLookupText(value) {
    return cleanText(value, 240000)
        .toLocaleLowerCase('zh-CN')
        .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function mergeProfileList(current, proposed, limit = 12, itemLimit = 240) {
    return cleanList([...(current || []), ...(Array.isArray(proposed) ? proposed : [])], limit, itemLimit);
}

function actorProfileSnapshot(actor) {
    return JSON.stringify({
        identity: actor.identity,
        longTermGoals: actor.longTermGoals,
        currentGoals: actor.currentGoals,
        plan: actor.plan,
        capabilities: actor.capabilities,
        hidden: actor.hidden,
    });
}

export function mergeActorProfilePatches(value, patches, {
    turn = null,
    sourceRef = null,
    maxPatches = 8,
    evidenceCorpus = '',
    mergeMode = 'append',
} = {}) {
    const ledger = normalizeActorLedger(value);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const ref = normalizeSourceRef(sourceRef);
    const evidenceHaystack = evidenceLookupText(evidenceCorpus);
    const accepted = [];
    const rejected = [];
    const candidates = (Array.isArray(patches) ? patches : []).slice(
        0,
        integer(maxPatches, 0, 24, 8),
    );
    const consolidate = mergeMode === 'consolidate';
    const mergeStableText = (current, proposed, limit = 240) => {
        const next = consolidate
            ? cleanText(proposed, limit)
            : stableProfileText(proposed, limit);
        if (consolidate && next) return next;
        return mergeProfileText(current, next, limit);
    };
    const mergeStablePattern = (current, proposed, limit = 240) => {
        const next = consolidate
            ? cleanText(proposed, limit)
            : stableProfileText(proposed, limit);
        if (consolidate && next) return next;
        return mergeProfilePattern(current, next, limit);
    };
    const mergeStableList = (current, proposed, limit = 12, itemLimit = 240) => {
        const next = consolidate
            ? cleanList(proposed, limit, itemLimit)
            : stableProfileList(proposed, limit, itemLimit);
        if (consolidate && next.length) return next;
        return mergeProfileList(current, next, limit, itemLimit);
    };
    for (const raw of candidates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            rejected.push({ actorId: '', reason: 'profile-not-object' });
            continue;
        }
        const requestedId = cleanText(raw.actorId, 120);
        const requestedName = cleanText(raw.name, 160);
        const actorIndex = ledger.actors.findIndex((actor) => (
            (requestedId && actor.id === requestedId)
            || (requestedName && (
                actor.name === requestedName
                || actor.identity.aliases.includes(requestedName)
            ))
        ));
        if (actorIndex < 0) {
            rejected.push({
                actorId: requestedId,
                name: requestedName,
                reason: 'unknown-actor',
            });
            continue;
        }
        const evidence = cleanList(raw.evidence, 8, 300);
        if (!evidence.length) {
            rejected.push({
                actorId: ledger.actors[actorIndex].id,
                name: ledger.actors[actorIndex].name,
                reason: 'evidence-missing',
            });
            continue;
        }
        const groundedEvidence = evidence.filter((item) => {
            const needle = evidenceLookupText(item);
            return needle.length >= 4 && evidenceHaystack.includes(needle);
        });
        if (!groundedEvidence.length) {
            rejected.push({
                actorId: ledger.actors[actorIndex].id,
                name: ledger.actors[actorIndex].name,
                reason: evidenceHaystack ? 'evidence-not-grounded' : 'evidence-corpus-missing',
            });
            continue;
        }
        const actor = clone(ledger.actors[actorIndex]);
        const before = actorProfileSnapshot(actor);
        const identity = raw.identity && typeof raw.identity === 'object'
            && !Array.isArray(raw.identity)
            ? raw.identity
            : {};
        const hidden = raw.hidden && typeof raw.hidden === 'object'
            && !Array.isArray(raw.hidden)
            ? raw.hidden
            : {};
        actor.identity = {
            ...actor.identity,
            role: mergeStableText(actor.identity.role, identity.role, 180),
            species: mergeStableText(actor.identity.species, identity.species, 160),
            profileSummary: mergeStableText(
                actor.identity.profileSummary,
                identity.profileSummary || identity.summary,
                700,
            ),
            gender: mergeStableText(actor.identity.gender, identity.gender, 80),
            age: mergeStableText(actor.identity.age, identity.age, 80),
            briefIntro: mergeStableText(actor.identity.briefIntro, identity.briefIntro, 240),
            appearance: mergeStableText(actor.identity.appearance, identity.appearance, 1200),
            identityText: mergeStableText(actor.identity.identityText, identity.identityText, 500),
            relationState: mergeStableText(actor.identity.relationState, identity.relationState, 1200),
            attitudeToProtagonist: mergeStableText(
                actor.identity.attitudeToProtagonist,
                identity.attitudeToProtagonist,
                600,
            ),
            pastExperience: mergeStableText(
                actor.identity.pastExperience,
                identity.pastExperience,
                2400,
            ),
            biography: mergeStableText(actor.identity.biography, identity.biography, 2400),
            primaryColor: mergeStableText(
                actor.identity.primaryColor,
                identity.primaryColor,
                200,
            ),
            primaryDerivatives: mergeStableList(
                actor.identity.primaryDerivatives,
                identity.primaryDerivatives,
                3,
                700,
            ),
            primarySentence: mergeStableText(
                actor.identity.primarySentence,
                identity.primarySentence,
                700,
            ),
            baseColor: mergeStableText(actor.identity.baseColor, identity.baseColor, 200),
            baseDerivatives: mergeStableList(
                actor.identity.baseDerivatives,
                identity.baseDerivatives,
                3,
                700,
            ),
            baseSentence: mergeStableText(
                actor.identity.baseSentence,
                identity.baseSentence,
                700,
            ),
            accentColor: mergeStableText(actor.identity.accentColor, identity.accentColor, 200),
            accentDerivatives: mergeStableList(
                actor.identity.accentDerivatives,
                identity.accentDerivatives,
                3,
                700,
            ),
            accentSentence: mergeStableText(
                actor.identity.accentSentence,
                identity.accentSentence,
                700,
            ),
            othersVoices: mergeStableList(
                actor.identity.othersVoices,
                identity.othersVoices,
                7,
                700,
            ),
            authorVoice: mergeStableText(actor.identity.authorVoice, identity.authorVoice, 1400),
            traits: mergeStableList(actor.identity.traits, identity.traits, 12, 180),
            desires: mergeStableList(actor.identity.desires, identity.desires, 12, 240),
            boundaries: mergeStableList(actor.identity.boundaries, identity.boundaries, 12, 240),
            socialStyle: mergeStablePattern(actor.identity.socialStyle, identity.socialStyle),
            decisionStyle: mergeStablePattern(actor.identity.decisionStyle, identity.decisionStyle),
            speechStyle: mergeStablePattern(actor.identity.speechStyle, identity.speechStyle),
            copingStyle: mergeStablePattern(actor.identity.copingStyle, identity.copingStyle),
            informationStyle: mergeStablePattern(
                actor.identity.informationStyle,
                identity.informationStyle,
            ),
            typicalMisread: mergeStablePattern(
                actor.identity.typicalMisread,
                identity.typicalMisread,
            ),
            relationshipDistancePattern: mergeStablePattern(
                actor.identity.relationshipDistancePattern,
                identity.relationshipDistancePattern,
            ),
            selfImageGap: mergeStablePattern(
                actor.identity.selfImageGap,
                identity.selfImageGap,
            ),
            learnedCounterDisposition: mergeStablePattern(
                actor.identity.learnedCounterDisposition,
                identity.learnedCounterDisposition,
            ),
            pressureResponse: mergeStablePattern(
                actor.identity.pressureResponse,
                identity.pressureResponse,
            ),
            recoveryPath: mergeStablePattern(
                actor.identity.recoveryPath,
                identity.recoveryPath,
            ),
            everydayHabits: mergeStableList(
                actor.identity.everydayHabits,
                identity.everydayHabits,
                8,
                180,
            ),
            blindSpots: mergeStableList(actor.identity.blindSpots, identity.blindSpots, 8, 220),
        };
        actor.longTermGoals = mergeStableList(actor.longTermGoals, raw.longTermGoals, 12, 400);
        actor.currentGoals = mergeStableList(actor.currentGoals, raw.currentGoals, 8, 400);
        const proposedPlan = raw.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan)
            ? raw.plan
            : {};
        actor.plan = {
            ...actor.plan,
            summary: mergeStableText(actor.plan?.summary, proposedPlan.summary, 500),
            steps: mergeStableList(actor.plan?.steps, proposedPlan.steps, 12, 300),
            nextWindow: mergeStableText(
                actor.plan?.nextWindow,
                proposedPlan.nextWindow,
                180,
            ),
            obstacles: mergeStableList(
                actor.plan?.obstacles,
                proposedPlan.obstacles,
                12,
                300,
            ),
            costs: mergeStableList(actor.plan?.costs, proposedPlan.costs, 12, 300),
            alternatives: mergeStableList(
                actor.plan?.alternatives,
                proposedPlan.alternatives,
                12,
                300,
            ),
            priority: ['low', 'normal', 'high', 'critical'].includes(proposedPlan.priority)
                ? proposedPlan.priority
                : actor.plan?.priority,
            status: ['active', 'blocked', 'completed', 'abandoned'].includes(proposedPlan.status)
                ? proposedPlan.status
                : actor.plan?.status,
        };
        actor.capabilities = mergeStableList(actor.capabilities, raw.capabilities, 24, 160);
        actor.hidden = {
            emotionalInertia: mergeStableList(
                actor.hidden.emotionalInertia,
                hidden.emotionalInertia,
                12,
                240,
            ),
            innerConflicts: mergeStableList(
                actor.hidden.innerConflicts,
                hidden.innerConflicts,
                12,
                300,
            ),
            privateIntentions: mergeStableList(
                actor.hidden.privateIntentions,
                hidden.privateIntentions,
                12,
                300,
            ),
        };
        if (actorProfileSnapshot(actor) === before) {
            rejected.push({
                actorId: actor.id,
                name: actor.name,
                reason: 'no-new-profile-facts',
            });
            continue;
        }
        actor.evidence = mergeEvidence(actor.evidence, [
            ...groundedEvidence,
            ref ? `${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}` : '',
        ]);
        actor.updatedTurn = currentTurn;
        actor.version += 1;
        ledger.actors[actorIndex] = actor;
        accepted.push({ actorId: actor.id, name: actor.name, evidence: groundedEvidence });
    }
    if (accepted.length) {
        ledger.turn = Math.max(ledger.turn, currentTurn);
        ledger.observationReceipts.push({
            receiptId: `actor-profile:${fingerprint(JSON.stringify([
                ref?.chatId || ledger.chatId,
                ref?.messageId || '',
                ref?.swipeId || 0,
                ref?.generation || 0,
                ref?.branchId || '',
                ref?.hash || '',
                accepted.map((item) => item.actorId),
            ])).slice(0, 18)}`,
            kind: 'profile-enrichment',
            sourceRef: ref,
            actorIds: accepted.map((item) => item.actorId),
            settledAt: Date.now(),
        });
        ledger.observationReceipts = ledger.observationReceipts.slice(-120);
        ledger.updatedAt = Date.now();
    }
    return {
        ledger: normalizeActorLedger(ledger),
        accepted,
        rejected,
    };
}

export function mergeActorIdentityReveal(value, {
    actorId = '',
    revealedName = '',
    aliases = [],
    evidence = [],
    turn = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const id = cleanText(actorId, 120);
    const name = cleanText(revealedName, 160);
    if (!id || !isActorName(name)) return ledger;
    let index = ledger.actors.findIndex((actor) => (
        actor.id === id
        || actor.name === id
        || actor.identity.aliases.includes(id)
    ));
    if (index < 0) {
        const quarantinedIndex = (ledger.identityQuarantine || [])
            .findIndex((entry) => entry.id === id || entry.actor?.id === id);
        if (quarantinedIndex < 0) return ledger;
        const restored = clone(ledger.identityQuarantine[quarantinedIndex].actor);
        restored.name = name;
        restored.identity.aliases = cleanList([
            ...restored.identity.aliases.filter((item) => !isActorId(item)),
            ...aliases,
        ], 12, 160).filter((item) => item !== name);
        if (isActorId(restored.lineage.currentForm)) restored.lineage.currentForm = name;
        ledger.identityQuarantine.splice(quarantinedIndex, 1);
        ledger.actors.push(restored);
        index = ledger.actors.length - 1;
    }
    const actor = clone(ledger.actors[index]);
    const previousName = actor.name;
    actor.name = name;
    actor.identity.aliases = cleanList([
        ...actor.identity.aliases,
        previousName,
        ...aliases,
    ], 12, 160).filter((item) => item !== name);
    actor.evidence = mergeEvidence(actor.evidence, evidence);
    actor.updatedTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    actor.version += 1;
    ledger.actors[index] = actor;
    ledger.updatedAt = Date.now();
    return ledger;
}

function observableStatements(content) {
    const accepted = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '')
        .replace(/<[^>]+>/gu, ' ');
    return accepted
        .split(/(?<=[。！？.!?])\s*/u)
        .map((item) => cleanText(item, 700))
        .filter((item) => item.length >= 4 && !PRIVATE_NARRATION.test(item))
        .slice(0, 12);
}

function actorNames(actor) {
    return [actor.name, ...actor.identity.aliases]
        .map((item) => cleanText(item, 160))
        .filter((item) => item.length >= 2);
}

function directlyObservedBy(statement, actor) {
    if (!DIRECT_OBSERVATION.test(statement) || OBSERVATION_NEGATION.test(statement)) return false;
    return actorNames(actor).some((name) => {
        const index = statement.indexOf(name);
        if (index < 0) return false;
        const local = statement.slice(index, index + name.length + 28);
        return DIRECT_OBSERVATION.test(local) && !OBSERVATION_NEGATION.test(local);
    });
}

function escapePattern(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function reconcileActorIdentityRevealsFromAcceptedContent(value, {
    content = '',
    sourceRef = null,
} = {}) {
    let ledger = normalizeActorLedger(value);
    const ref = normalizeSourceRef(sourceRef);
    if (!ref) return ledger;
    const body = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '');
    for (const current of [...ledger.actors]) {
        const names = actorNames(current);
        let revealedName = '';
        for (const alias of names) {
            const pattern = new RegExp(
                `${escapePattern(alias)}[^。！？.!?]{0,48}`
                + '(?:真实身份(?:是|为)|原来(?:就是|是)|自称(?:为)?)'
                + '\\s*([\\p{L}\\p{N}·・_-]{2,40})',
                'u',
            );
            const match = body.match(pattern);
            if (match) {
                revealedName = cleanText(match[1], 160)
                    .replace(/(?:本人|自己)$/u, '');
                break;
            }
        }
        if (!isActorName(revealedName) || revealedName === current.name) continue;
        const duplicate = ledger.actors.find((actor) => (
            actor.id !== current.id
            && (
                actor.name === revealedName
                || actor.identity.aliases.includes(revealedName)
            )
        ));
        ledger = mergeActorIdentityReveal(ledger, {
            actorId: current.id,
            revealedName,
            aliases: names,
            evidence: [`${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}`],
            turn: ledger.turn,
        });
        if (!duplicate) continue;
        const stable = ledger.actors.find((actor) => actor.id === current.id);
        stable.knowledge = [
            ...stable.knowledge,
            ...duplicate.knowledge.filter((item) => (
                !stable.knowledge.some((known) => known.id === item.id)
            )),
        ].slice(-48);
        stable.evidence = mergeEvidence(stable.evidence, duplicate.evidence);
        stable.identity.aliases = cleanList([
            ...stable.identity.aliases,
            duplicate.name,
            ...duplicate.identity.aliases,
        ], 12, 160).filter((item) => item !== stable.name);
        stable.resources = stable.resources.length ? stable.resources : clone(duplicate.resources);
        stable.capabilities = mergeEvidence(stable.capabilities, duplicate.capabilities, 24);
        stable.version += 1;
        ledger.actors = ledger.actors.filter((actor) => actor.id !== duplicate.id);
    }
    ledger.updatedAt = Date.now();
    return normalizeActorLedger(ledger, { chatId: ledger.chatId });
}

export function reconcileActorMutationLineageFromAcceptedContent(value, {
    content = '',
    sourceRef = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const ref = normalizeSourceRef(sourceRef);
    if (!ref) return ledger;
    const body = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '');
    for (const actor of [...ledger.actors]) {
        let form = '';
        for (const name of actorNames(actor)) {
            const pattern = new RegExp(
                `${escapePattern(name)}[^。！？.!?]{0,36}`
                + '(?:异变为|变异成|转化为|进化为|蜕变为)'
                + '\\s*([\\p{L}\\p{N}·・_-]{2,60})',
                'u',
            );
            const match = body.match(pattern);
            if (match) {
                form = cleanText(match[1], 160);
                break;
            }
        }
        if (!isActorName(form)) continue;
        const stable = ledger.actors.find((item) => item.id === actor.id);
        const evidence = `${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}`;
        if (!stable.lineage.forms.some((item) => item.name === form)) {
            stable.lineage.forms.push({
                name: form,
                turn: ledger.turn,
                evidence: [evidence],
            });
        }
        stable.lineage.forms = stable.lineage.forms.slice(-12);
        stable.lineage.currentForm = form;
        stable.identity.aliases = cleanList([
            ...stable.identity.aliases,
            form,
        ], 12, 160).filter((item) => item !== stable.name);
        stable.evidence = mergeEvidence(stable.evidence, [evidence]);
        stable.version += 1;
        const duplicate = ledger.actors.find((item) => (
            item.id !== stable.id
            && (item.name === form || item.identity.aliases.includes(form))
        ));
        if (duplicate) {
            stable.knowledge = [
                ...stable.knowledge,
                ...duplicate.knowledge.filter((item) => (
                    !stable.knowledge.some((known) => known.id === item.id)
                )),
            ].slice(-48);
            stable.resources = stable.resources.length
                ? stable.resources
                : clone(duplicate.resources);
            stable.capabilities = mergeEvidence(stable.capabilities, duplicate.capabilities, 24);
            ledger.actors = ledger.actors.filter((item) => item.id !== duplicate.id);
        }
    }
    ledger.updatedAt = Date.now();
    return normalizeActorLedger(ledger, { chatId: ledger.chatId });
}

export function applyAcceptedContentObservations(value, {
    content = '',
    sourceRef = null,
    observerActorIds = [],
} = {}) {
    const ledger = normalizeActorLedger(value);
    const ref = normalizeSourceRef(sourceRef);
    const observers = new Set(cleanList(observerActorIds, 32, 120));
    const statements = observableStatements(content);
    if (!ref || !observers.size || !statements.length) return ledger;
    const receiptId = `actor-observation:${fingerprint(JSON.stringify([
        ref.chatId,
        ref.messageId,
        ref.swipeId,
        ref.generation,
        ref.branchId,
        ref.hash,
    ])).slice(0, 18)}`;
    if (ledger.observationReceipts.some((receipt) => receipt.receiptId === receiptId)) {
        return ledger;
    }
    const learnedIds = [];
    ledger.actors = ledger.actors.map((actor) => {
        if (!observers.has(actor.id)) return actor;
        const next = clone(actor);
        for (const claim of statements.filter((item) => directlyObservedBy(item, actor))) {
            const knowledge = normalizeKnowledge({
                claim,
                kind: 'observed',
                confidence: 1,
                learnedTurn: ledger.turn,
                sourceRef: ref,
                propagation: ['accepted-content'],
            }, next.knowledge.length, ledger.turn);
            if (!knowledge || next.knowledge.some((item) => item.id === knowledge.id)) continue;
            next.knowledge.push(knowledge);
            learnedIds.push(knowledge.id);
        }
        next.knowledge = next.knowledge.slice(-48);
        next.updatedTurn = ledger.turn;
        next.version += 1;
        return next;
    });
    if (!learnedIds.length) return ledger;
    ledger.observationReceipts.push({
        receiptId,
        sourceRef: ref,
        observerActorIds: [...observers],
        knowledgeIds: [...new Set(learnedIds)],
        statementCount: statements.length,
        settledAt: Date.now(),
    });
    ledger.observationReceipts = ledger.observationReceipts.slice(-120);
    ledger.updatedAt = Date.now();
    return ledger;
}

export function inferObserverActorIds(value, content) {
    const ledger = normalizeActorLedger(value);
    const statements = observableStatements(content);
    return ledger.actors
        .filter((actor) => ['active', 'dormant'].includes(actor.status))
        .filter((actor) => statements.some((statement) => directlyObservedBy(statement, actor)))
        .map((actor) => actor.id);
}

export function reconcileActorLifecycleFromAcceptedContent(value, {
    content = '',
    sourceRef = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const ref = normalizeSourceRef(sourceRef);
    if (!ref) return ledger;
    const statements = observableStatements(content);
    const transitions = [];
    ledger.actors = ledger.actors.map((current) => {
        const actor = clone(current);
        const relevant = statements.filter((statement) => (
            actorNames(actor).some((name) => statement.includes(name))
        ));
        if (!relevant.length) return actor;
        let nextStatus = actor.status;
        if (relevant.some((statement) => /(?:已经|确认|当场|彻底)?(?:死亡|身亡|毙命|被杀死|咽气|尸体)/u.test(statement))) {
            nextStatus = 'deceased';
        } else if (
            actor.status !== 'deceased'
            && relevant.some((statement) => /(?:已经)?(?:离开|离场|撤离|远走|失踪|退出)(?:了|当前|此地|港区|现场)?/u.test(statement))
        ) {
            nextStatus = 'departed';
        } else if (
            actor.status !== 'deceased'
            && relevant.some((statement) => /(?:昏迷|沉睡|休眠|失去意识|无法行动)/u.test(statement))
        ) {
            nextStatus = 'dormant';
        } else if (
            actor.status !== 'deceased'
            && relevant.some((statement) => /(?:苏醒|醒来|回归|返回|重新回到|恢复行动)/u.test(statement))
        ) {
            nextStatus = 'active';
        }
        if (nextStatus === actor.status) return actor;
        transitions.push({
            actorId: actor.id,
            from: actor.status,
            to: nextStatus,
        });
        actor.status = nextStatus;
        actor.inactiveReason = nextStatus === 'dormant'
            ? 'sleep'
            : nextStatus === 'departed'
                ? 'absence'
                : '';
        actor.updatedTurn = ledger.turn;
        actor.version += 1;
        actor.evidence = mergeEvidence(actor.evidence, [
            `${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}`,
        ]);
        return actor;
    });
    if (!transitions.length) return ledger;
    ledger.observationReceipts.push({
        receiptId: `actor-lifecycle:${fingerprint(JSON.stringify([
            ref.chatId,
            ref.messageId,
            ref.swipeId,
            ref.generation,
            ref.branchId,
            ref.hash,
        ])).slice(0, 18)}`,
        sourceRef: ref,
        transitions,
        settledAt: Date.now(),
    });
    ledger.observationReceipts = ledger.observationReceipts.slice(-120);
    ledger.updatedAt = Date.now();
    return ledger;
}

function actorStarvationLimit(actor) {
    if (actor.tier === 'key') return 3;
    if (actor.tier === 'secondary') return 4;
    return 6;
}

function schedulingScore(actor, turn) {
    const due = actor.nextActionTurn <= turn;
    const semanticAge = Math.max(
        actor.silenceTurns,
        turn - Math.max(0, Number(actor.lastSemanticTurn) || 0),
    );
    const starved = due && semanticAge >= actorStarvationLimit(actor);
    const deadlineDistance = actor.deadlineTurn > 0 ? actor.deadlineTurn - turn : Infinity;
    const openCommitments = actor.commitments.filter((item) => item.status === 'open');
    const overdueCommitments = openCommitments.filter((item) => item.dueTurn <= turn);
    const reasons = [];
    let score = 0;
    if (due) {
        score += 100;
        reasons.push('action-due');
    }
    if (starved) {
        score += 220;
        reasons.push('semantic-starvation');
    }
    if (deadlineDistance <= 0) {
        score += 90;
        reasons.push('deadline-due');
    } else if (deadlineDistance <= 2) {
        score += 45;
        reasons.push('deadline-near');
    }
    if (overdueCommitments.length) {
        score += 70 + overdueCommitments.length * 8;
        reasons.push('commitment-due');
    } else if (openCommitments.length) {
        score += 18;
        reasons.push('commitment-open');
    }
    score += actor.initiative * 12;
    score += actor.opportunity * 14;
    score += Math.min(80, semanticAge * 3);
    score += Math.min(20, actor.resources.reduce((total, item) => total + item.amount, 0));
    score -= Math.min(40, actor.attentionScore / 10);
    if (actor.status === 'dormant') score -= 10;
    if (actor.status === 'dormant' && actor.inactiveReason === 'sleep') score = -Infinity;
    if (!['active', 'dormant'].includes(actor.status)) score = -Infinity;
    return { score, reasons, semanticAge, starved };
}

export function scheduleActorTurns(value, {
    turn = null,
    maxActors = 2,
    explorationSlots = 1,
    excludedActorNames = [],
    requireProfileReady = false,
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = normalizeActorLedger(value, { excludedActorNames });
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const limit = integer(maxActors, 0, 5, 2);
    const explorationLimit = Math.min(
        limit,
        integer(explorationSlots, 0, 2, 1),
    );
    const scored = ledger.actors
        .filter((actor) => (
            isActorName(actor.name, excluded)
            && (!requireProfileReady || actorProfileReadyForAction(actor))
        ))
        .map((actor) => ({ actor, ...schedulingScore(actor, currentTurn) }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => (
            Number(right.starved) - Number(left.starved)
            || (left.starved && right.starved
                ? left.actor.lastAttemptTurn - right.actor.lastAttemptTurn
                : 0)
            || right.score - left.score
            || right.semanticAge - left.semanticAge
            || left.actor.nextActionTurn - right.actor.nextActionTurn
            || left.actor.id.localeCompare(right.actor.id)
        ));
    const coreLimit = Math.max(0, limit - explorationLimit);
    const selected = scored.slice(0, coreLimit).map((item) => ({
        actorId: item.actor.id,
        actorName: item.actor.name,
        slot: 'priority',
        score: item.score,
        reasons: item.reasons.length ? item.reasons : ['initiative-opportunity'],
    }));
    const selectedIds = new Set(selected.map((item) => item.actorId));
    const exploration = scored
        .filter((item) => !selectedIds.has(item.actor.id))
        .sort((left, right) => (
            left.actor.attentionScore - right.actor.attentionScore
            || right.semanticAge - left.semanticAge
            || left.actor.lastAttemptTurn - right.actor.lastAttemptTurn
            || right.actor.opportunity - left.actor.opportunity
            || left.actor.id.localeCompare(right.actor.id)
        ))
        .slice(0, explorationLimit)
        .map((item) => ({
            actorId: item.actor.id,
            actorName: item.actor.name,
            slot: 'exploration',
            score: item.score,
            reasons: ['low-attention-exploration'],
        }));
    return {
        turn: currentTurn,
        selected: [...selected, ...exploration],
        deferredActorIds: scored
            .filter((item) => !selectedIds.has(item.actor.id)
                && !exploration.some((candidate) => candidate.actorId === item.actor.id))
            .map((item) => item.actor.id),
    };
}

export function actorActionCandidatesFromShard(value, proposals, {
    turn = null,
    collisionIntensity = 2,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const byId = new Map(ledger.actors.map((item) => [item.id, item]));
    const intensity = integer(collisionIntensity, 0, 3, 2);
    return (Array.isArray(proposals) ? proposals : []).map((proposal) => {
        const actor = byId.get(cleanText(proposal?.actorId, 120));
        if (!actor) return clone(proposal);
        const action = cleanText(proposal?.candidateAction, 700);
        const declaredIntent = cleanText(proposal?.intent, 40);
        const wait = declaredIntent === 'wait';
        const replan = declaredIntent === 'replan';
        const contactMatch = intensity > 0 && action.match(
            intensity >= 2
                ? /(?:寻找|来访|拜访|寄信|传信|悬赏|跟踪|求助|袭击|取走|拿走|封锁|抬价|降价|散布|公告|布告|交通|舆论)/u
                : /(?:来访|拜访|寄信|传信|袭击|求助)/u,
        );
        const knowledgeRefs = (actor.knowledge || [])
            .filter((item) => (proposal?.knowledgeBasis || []).includes(item.claim))
            .map((item) => item.id);
        const allowedEvidence = new Set([
            ...actor.evidence,
            ...actor.knowledge.map((item) => item.id),
        ]);
        const evidence = cleanList([
            ...(proposal?.evidence || []),
            ...knowledgeRefs,
        ], 24, 300).filter((item) => allowedEvidence.has(item));
        return {
            actorId: actor.id,
            actorName: actor.name,
            intent: wait ? 'wait' : replan ? 'replan' : 'execute',
            time: { turn: currentTurn, window: cleanText(proposal?.time, 160) || 'now' },
            location: {
                from: actor.location.name,
                to: cleanText(proposal?.location, 180) || actor.location.name,
                travelTurns: integer(proposal?.travelTurns, 0, 10_000, 0),
            },
            action,
            actionWindow: cleanText(proposal?.actionWindow, 180),
            expectedCost: cleanText(proposal?.expectedCost, 300),
            expectedDuration: cleanText(proposal?.expectedDuration, 180),
            expectedRisk: cleanText(proposal?.expectedRisk, 300),
            observableConsequence: cleanText(proposal?.observableConsequence, 500),
            stimulusDecisions: clone(proposal?.stimulusDecisions || []),
            stateChanges: (Array.isArray(proposal?.stateChanges)
                ? proposal.stateChanges
                : []).map((item) => ({
                kind: cleanText(item?.kind, 80),
                summary: cleanText(item?.summary, 500),
            })).filter((item) => item.kind && item.summary),
            knowledgeRefs,
            resourceCosts: (Array.isArray(proposal?.resourceCosts)
                ? proposal.resourceCosts
                : []).map((item) => ({
                resourceId: cleanText(item?.resourceId, 100),
                amount: number(item?.amount, 0, 1_000_000_000, 0),
            })),
            capabilityUsed: cleanText(proposal?.capabilityUsed, 160),
            contact: contactMatch
                ? {
                    mode: cleanText(contactMatch[0], 80),
                    target: cleanText(
                        proposal?.interactionTargets?.[0]?.actorName || '当前世界',
                        180,
                    ),
                    observableConsequence: action,
                }
                : null,
            planUpdate: cleanText(proposal?.currentGoal, 500),
            waitCondition: wait
                ? cleanText(proposal?.waitCondition, 500) || action
                : '',
            evidence: evidence.length ? evidence : actor.evidence.slice(0, 1),
        };
    });
}

export function mergeActorWorldEventsIntoContinuity(continuity, worldEvents) {
    const state = clone(continuity || {});
    state.threads = Array.isArray(state.threads) ? state.threads : [];
    const existing = new Set(state.threads.map((thread) => thread?.id));
    for (const event of Array.isArray(worldEvents) ? worldEvents : []) {
        const id = `ACTOR-${cleanText(event?.id, 90)}`;
        if (!event?.id || existing.has(id)) continue;
        existing.add(id);
        const disclosed = event.disclosure === 'disclosed' || event.visibility === 'observed';
        const observable = disclosed ? cleanText(event.observableConsequence, 500) : '';
        state.threads.push({
            id,
            title: `${cleanText(event.actorName, 120)}的主动行动`,
            kind: 'personal',
            eventType: 'progress',
            level: 1,
            origin: 'setting_independent',
            relation: observable ? 'converging' : 'independent',
            stage: observable ? 'manifested' : 'advancing',
            summary: cleanText(event.summary, 700),
            offscreenBeat: cleanText(event.summary, 500),
            nextBeat: '等待可观察后果自然进入场景或在后台继续',
            trigger: observable || '等待行动留下可传播或可观察后果',
            intersection: observable,
            seedBasis: cleanText(event.sourceReceiptId || event.id, 300),
            causedBy: [],
            effects: [observable].filter(Boolean),
            rumors: [],
            actors: [cleanText(event.actorName, 120)].filter(Boolean),
            locations: [cleanText(event.location, 120)].filter(Boolean),
            propagation: [],
            convergence: {
                score: observable ? 3 : 0,
                channels: observable ? ['actor', 'location'] : [],
                evidence: [cleanText(event.id, 240)],
                entryBeat: observable,
                lastCheckedTurn: Number(event.turn) || Number(state.turn) || 0,
            },
            knowledge: observable ? 'observed' : 'hidden',
            actionRoute: ['foreground_offer', 'foreground_attempt', 'background_private', 'background_public']
                .includes(event.route)
                ? event.route
                : 'background_private',
            sourceReceiptId: cleanText(event.sourceReceiptId, 160),
            disclosure: observable ? 'disclosed' : 'pending',
            urgency: observable ? 2 : 1,
            stageProgress: 1,
            evolveResult: '',
            consecutiveFails: 0,
            stalled: false,
            outcome: '',
            createdTurn: Number(event.turn) || Number(state.turn) || 0,
            lastAdvancedTurn: Number(event.turn) || Number(state.turn) || 0,
            resolvedTurn: 0,
            sourceRefs: [],
        });
    }
    return state;
}

function validateCandidate(actor, candidate, turn) {
    const reasons = [];
    if (!actor || cleanText(candidate?.actorId, 120) !== actor.id) {
        return ['actor-identity-mismatch'];
    }
    if (
        !['active', 'dormant'].includes(actor.status)
        || (actor.status === 'dormant' && actor.inactiveReason === 'sleep')
    ) {
        reasons.push('actor-not-actionable');
    }
    if (cleanText(candidate?.actorName, 160) !== actor.name) {
        reasons.push('actor-identity-mismatch');
    }
    const intent = cleanText(candidate?.intent, 40);
    if (!INTENTS.has(intent)) reasons.push('intent-invalid');
    const action = cleanText(candidate?.action, 700);
    if (!action) reasons.push('action-missing');
    if (PLAYER_SOVEREIGNTY.test(action)) reasons.push('player-sovereignty');
    const time = candidate?.time && typeof candidate.time === 'object' ? candidate.time : {};
    if (integer(time.turn, 0, Number.MAX_SAFE_INTEGER, -1) !== turn) {
        reasons.push('time-invalid');
    }
    const location = candidate?.location && typeof candidate.location === 'object'
        ? candidate.location
        : {};
    const from = cleanText(location.from, 180);
    const to = cleanText(location.to, 180);
    const travelTurns = integer(location.travelTurns, 0, 10_000, 0);
    if (
        from !== actor.location.name
        || !to
        || (to !== from && travelTurns <= 0)
    ) reasons.push('location-or-travel-invalid');
    const knowledgeIds = new Set(actor.knowledge.map((item) => item.id));
    const actorEvidence = new Set([
        ...actor.evidence,
        ...actor.knowledge.map((item) => item.id),
    ]);
    const knowledgeRefs = cleanList(candidate?.knowledgeRefs, 24, 120);
    const evidence = cleanList(candidate?.evidence, 24, 300);
    if (knowledgeRefs.some((id) => !knowledgeIds.has(id))) {
        reasons.push('knowledge-out-of-bounds');
    }
    if (evidence.some((item) => !actorEvidence.has(item))) {
        reasons.push('evidence-out-of-bounds');
    }
    const resourceById = new Map(actor.resources.map((item) => [item.id, item]));
    const costs = Array.isArray(candidate?.resourceCosts) ? candidate.resourceCosts : [];
    if (costs.some((cost) => (
        !resourceById.has(cleanText(cost?.resourceId, 100))
        || number(cost?.amount, 0, 1_000_000_000, 0)
            > resourceById.get(cleanText(cost?.resourceId, 100)).amount
    ))) reasons.push('resource-insufficient');
    const capability = cleanText(candidate?.capabilityUsed, 160);
    if (capability && !actor.capabilities.includes(capability)) {
        reasons.push('capability-out-of-bounds');
    }
    const stateChanges = (Array.isArray(candidate?.stateChanges)
        ? candidate.stateChanges
        : [])
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            kind: cleanText(item.kind, 80),
            summary: cleanText(item.summary, 500),
        }))
        .filter((item) => item.kind && item.summary);
    if (intent !== 'wait' && !stateChanges.length) {
        reasons.push('semantic-delta-missing');
    }
    if (intent === 'wait') {
        const condition = cleanText(candidate?.waitCondition, 500);
        if (condition.length < 8 || GENERIC_WAIT.test(condition)) {
            reasons.push('wait-condition-not-concrete');
        }
    }
    return [...new Set(reasons)];
}

function contactWorldEvent(actor, candidate, actionId, turn) {
    const contact = candidate?.contact && typeof candidate.contact === 'object'
        ? candidate.contact
        : null;
    const observable = cleanText(contact?.observableConsequence, 500);
    return {
        id: `AE-${fingerprint(`${actionId}|${observable}`).slice(0, 16)}`,
        actorId: actor.id,
        actorName: actor.name,
        actionId,
        turn,
        type: cleanText(contact?.mode, 80) || 'private_action',
        target: cleanText(contact?.target, 180),
        summary: cleanText(candidate.action, 700),
        observableConsequence: observable,
        location: cleanText(candidate?.location?.to, 180),
        knowledge: observable ? 'observed' : 'hidden',
        status: 'settled',
        sourceEvidence: cleanList(candidate.evidence, 24, 300),
    };
}

function stageReceipt(actionId, actorId, stage, turn, extra = {}) {
    return normalizeReceipt({
        receiptId: `actor-action:${actionId}:${stage}`,
        actionId,
        actorId,
        stage,
        status: stage === 'injected' ? 'pending' : 'settled',
        createdTurn: turn,
        ...extra,
    });
}

function updateTier(actor) {
    if (actor.tier === 'background' && actor.settledActionCount >= 3) return 'secondary';
    if (actor.tier === 'secondary' && actor.settledActionCount >= 8) return 'key';
    if (
        actor.tier === 'key'
        && actor.silenceTurns >= 24
        && !actor.commitments.some((item) => item.status === 'open')
    ) return 'secondary';
    return actor.tier;
}

export function prepareActorActionAttempts(value, candidates, {
    turn = null,
    playerNames = [],
} = {}) {
    const ledger = normalizeActorLedger(value);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const byId = new Map(ledger.actors.map((item) => [item.id, item]));
    const attempts = [];
    const admittedCandidates = [];
    const rejected = [];
    for (const raw of Array.isArray(candidates) ? candidates : []) {
        const candidate = clone(raw);
        const actor = byId.get(cleanText(candidate?.actorId, 120));
        const reasons = validateCandidate(actor, candidate, currentTurn);
        if (reasons.length) {
            rejected.push({ actorId: cleanText(candidate?.actorId, 120), reasons });
            continue;
        }
        const attempt = createActorActionAttempt(candidate, {
            actor,
            turn: currentTurn,
            playerNames,
        });
        attempts.push(attempt);
        admittedCandidates.push({ ...candidate, attemptId: attempt.id });
    }
    return { ledger, attempts, admittedCandidates, rejected };
}

export function settleActorActionCandidates(value, candidates, {
    turn = null,
    attemptedActorIds = [],
    playerNames = [],
    worldAdjudications = [],
} = {}) {
    const ledger = normalizeActorLedger(value);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const byId = new Map(ledger.actors.map((item) => [item.id, item]));
    const accepted = [];
    const rejected = [];
    const worldEvents = [];
    const receipts = [];
    const attempts = [];
    const results = [];
    const pendingWorld = [];
    const adjudicationByAttempt = new Map(
        (Array.isArray(worldAdjudications) ? worldAdjudications : [])
            .map((entry) => [cleanText(entry?.attemptId, 160), entry])
            .filter(([attemptId]) => attemptId),
    );
    const semanticAcceptedIds = new Set();
    for (const raw of Array.isArray(candidates) ? candidates : []) {
        const candidate = clone(raw);
        const actor = byId.get(cleanText(candidate?.actorId, 120));
        const reasons = validateCandidate(actor, candidate, currentTurn);
        if (reasons.length) {
            rejected.push({
                actorId: cleanText(candidate?.actorId, 120),
                reasons,
            });
            continue;
        }
        const attempt = createActorActionAttempt(candidate, {
            actor,
            turn: currentTurn,
            playerNames,
        });
        const adjudicated = adjudicateActorActionAttempt(attempt, {
            actor,
            risk: candidate.contact ? 'contact' : 'ordinary',
            cost: (candidate.resourceCosts || []).map((item) => (
                `${item.resourceId}:${item.amount}`
            )),
            durationTurns: integer(candidate.location?.travelTurns, 0, 10_000, 0),
            worldDecision: adjudicationByAttempt.get(attempt.id) || null,
        });
        const actionId = attempt.id;
        const result = adjudicated.result;
        attempts.push(attempt);
        results.push(result);
        if (result.status === 'pending_world') {
            pendingWorld.push({
                actorId: actor.id,
                attempt,
                failureCode: result.worldAdjudicationFailure || 'world_adjudication_missing',
            });
            continue;
        }
        const next = clone(actor);
        next.lastAttemptTurn = currentTurn;
        const stimulusDecisionById = new Map(
            (Array.isArray(candidate.stimulusDecisions) ? candidate.stimulusDecisions : [])
                .map((entry) => [cleanText(entry?.stimulusId, 180), entry])
                .filter(([id]) => id),
        );
        next.stimuli = next.stimuli.map((stimulus) => {
            const decision = stimulusDecisionById.get(stimulus.id);
            if (!decision) return stimulus;
            return {
                ...stimulus,
                status: ['adopted', 'ignored', 'misread', 'used', 'opposed']
                    .includes(decision.decision)
                    ? decision.decision
                    : stimulus.status,
                decidedTurn: currentTurn,
                decisionReason: cleanText(decision.reason, 300),
            };
        });
        if (result.status === 'settled') {
            for (const cost of result.resourceCosts) {
                const resource = next.resources.find(
                    (item) => item.id === cleanText(cost.resourceId, 100),
                );
                if (resource) resource.amount -= number(cost.amount, 0, resource.amount, 0);
            }
            if (candidate.intent === 'execute' && candidate.location.to !== next.location.name) {
                next.location = {
                    name: cleanText(candidate.location.to, 180),
                    sinceTurn: currentTurn + integer(candidate.location.travelTurns, 0, 10_000, 0),
                    evidence: mergeEvidence(next.location.evidence, candidate.evidence, 8),
                };
            }
        }
        const planUpdate = cleanText(candidate.planUpdate, 500);
        if (planUpdate) next.plan.summary = planUpdate;
        if (candidate.intent === 'wait') next.plan.status = 'blocked';
        else if (candidate.intent === 'replan') next.plan.status = 'active';
        const stateChanges = (Array.isArray(result.appliedStateChanges)
            ? result.appliedStateChanges
            : [])
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                kind: cleanText(item.kind, 80),
                summary: cleanText(item.summary, 500),
            }))
            .filter((item) => item.kind && item.summary);
        const semanticProgress = ['settled', 'partial'].includes(result.status)
            && candidate.intent !== 'wait'
            && stateChanges.length > 0;
        next.lastAction = {
            id: actionId,
            turn: currentTurn,
            summary: cleanText(candidate.action, 700),
            outcome: result.status,
        };
        next.nextActionTurn = currentTurn + Math.max(
            1,
            integer(candidate.location.travelTurns, 0, 10_000, 0),
        );
        next.silenceTurns = semanticProgress
            ? 0
            : Math.min(10_000, next.silenceTurns + 1);
        next.attentionScore += candidate.contact ? 1 : 0;
        if (semanticProgress) {
            next.settledActionCount += 1;
            next.semanticProgressCount += 1;
            next.lastSemanticTurn = currentTurn;
            next.consecutiveActionFailures = 0;
            next.stateFacts = [
                ...next.stateFacts,
                ...stateChanges.map((change, changeIndex) => ({
                    id: `ASF-${fingerprint(`${actionId}|${change.kind}|${change.summary}|${changeIndex}`).slice(0, 16)}`,
                    kind: change.kind,
                    summary: change.summary,
                    turn: currentTurn,
                    evidence: mergeEvidence([], candidate.evidence, 8),
                })),
            ].slice(-48);
            semanticAcceptedIds.add(next.id);
        } else if (result.status === 'rejected') {
            next.consecutiveActionFailures = Math.min(
                10_000,
                next.consecutiveActionFailures + 1,
            );
        }
        next.actionHistory = [
            ...next.actionHistory,
            {
                id: actionId,
                turn: currentTurn,
                route: attempt.route,
                attempt: attempt.action,
                resultStatus: result.status,
                resultId: result.id,
                visibility: result.visibility,
                disclosure: result.disclosure,
                cost: result.costs,
                risk: result.risk,
                durationTurns: result.durationTurns,
                resultSummary: result.summary,
                observableConsequence: result.observableConsequence,
                revealPath: result.revealPath,
                worldAdjudicated: result.worldAdjudicated,
                evidence: result.evidence,
            },
        ].slice(-80);
        next.tier = updateTier(next);
        next.status = 'active';
        next.updatedTurn = currentTurn;
        next.version += 1;
        byId.set(next.id, next);
        const authorityEvent = worldEventFromSettledActionReceipt(adjudicated.receipt, {
            result,
        });
        const event = authorityEvent
            ? {
                ...authorityEvent,
                actorName: next.name,
                summary: cleanText(candidate.action, 700),
                location: next.location.name,
                observableConsequence: result.disclosure === 'disclosed'
                    ? cleanText(result.publicSummary, 500)
                    : '',
                turn: currentTurn,
            }
            : null;
        accepted.push({
            ...candidate,
            actionId,
            route: attempt.route,
            attempt,
            result,
            semanticProgress,
        });
        receipts.push(stageReceipt(actionId, next.id, 'planned', currentTurn, {
            summary: cleanText(candidate.planUpdate || next.plan.summary, 500),
            route: attempt.route,
        }));
        receipts.push(stageReceipt(actionId, next.id, 'attempted', currentTurn, {
            summary: cleanText(candidate.action, 700),
            route: attempt.route,
            semanticProgress,
            playerActionSettled: false,
            playerConsentSettled: false,
            playerFeelingSettled: false,
        }));
        receipts.push({
            ...adjudicated.receipt,
            worldEventId: event?.id || '',
            observableConsequence: event?.observableConsequence || '',
            semanticProgress,
        });
        if (event) worldEvents.push(event);
        const injection = actorActionNarrativeInjection(attempt, result);
        if (injection.text) {
            receipts.push(stageReceipt(actionId, next.id, 'injected', currentTurn, {
                worldEventId: event?.id || '',
                route: attempt.route,
                observableConsequence: injection.text,
                includesResult: injection.includesResult,
                playerActionSettled: false,
                playerConsentSettled: false,
                playerFeelingSettled: false,
            }));
        }
    }
    ledger.turn = Math.max(ledger.turn, currentTurn);
    ledger.actors = ledger.actors.map((actor) => {
        const next = byId.get(actor.id) || actor;
        if (!semanticAcceptedIds.has(actor.id) && accepted.some((item) => item.actorId === actor.id)) {
            if (
                next.status === 'active'
                && next.silenceTurns >= 12
                && !next.commitments.some((item) => item.status === 'open')
                && !next.constraints.length
                && !next.currentGoals.length
            ) next.status = 'dormant';
        }
        return next;
    });
    ledger.actionReceipts = [...ledger.actionReceipts, ...receipts]
        .slice(-ACTOR_LEDGER_MAX_RECEIPTS);
    ledger.updatedAt = Date.now();
    return {
        ledger,
        accepted,
        rejected,
        worldEvents,
        receipts,
        attempts,
        results,
        pendingWorld,
    };
}

export function settleActorInjectionReceipts(value, {
    content = '',
    sourceRef = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const accepted = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '');
    const ref = normalizeSourceRef(sourceRef);
    if (!ref) return ledger;
    ledger.actionReceipts = ledger.actionReceipts.map((receipt) => {
        if (receipt.stage !== 'injected' || receipt.status !== 'pending') return receipt;
        const target = receipt.target && typeof receipt.target === 'object'
            ? receipt.target
            : null;
        if (target && (
            (target.chatId && target.chatId !== ref.chatId)
            || (target.messageId && target.messageId !== ref.messageId)
            || (target.swipeId && target.swipeId !== ref.swipeId)
            || (target.generation && target.generation !== ref.generation)
            || (target.branchId && target.branchId !== ref.branchId)
            || (target.hash && target.hash !== ref.hash)
        )) return receipt;
        const evidence = receipt.observableConsequence
            && accepted.includes(receipt.observableConsequence)
            ? receipt.observableConsequence
            : '';
        return {
            ...receipt,
            stage: 'response_settled',
            status: evidence ? 'consumed' : 'retained',
            consumptionEvidence: evidence,
            responseSourceRef: ref,
            settledAt: Date.now(),
        };
    });
    ledger.updatedAt = Date.now();
    return ledger;
}

export function actorLedgerView(value) {
    const ledger = normalizeActorLedger(value);
    const semanticSilences = ledger.actors.map((actor) => Math.max(
        actor.silenceTurns,
        ledger.turn - Math.max(0, Number(actor.lastSemanticTurn) || 0),
    ));
    return {
        version: ledger.version,
        turn: ledger.turn,
        actorCount: ledger.actors.length,
        activeCount: ledger.actors.filter((item) => item.status === 'active').length,
        dormantCount: ledger.actors.filter((item) => item.status === 'dormant').length,
        semanticProgressCount: ledger.actors.reduce(
            (total, actor) => total + actor.semanticProgressCount,
            0,
        ),
        maxSemanticSilence: Math.max(0, ...semanticSilences),
        stalledDueCount: ledger.actors.filter((actor, index) => (
            ['active', 'dormant'].includes(actor.status)
            && actor.nextActionTurn <= ledger.turn
            && semanticSilences[index] >= actorStarvationLimit(actor)
        )).length,
        consecutiveFailureCount: ledger.actors.reduce(
            (total, actor) => total + actor.consecutiveActionFailures,
            0,
        ),
        actors: ledger.actors.map((actor) => {
            const publicActor = clone(actor);
            delete publicActor.hidden;
            return publicActor;
        }),
        receipts: clone(ledger.actionReceipts),
        observationReceipts: clone(ledger.observationReceipts),
        privateThoughtsExposed: false,
    };
}
