import { fingerprint } from './core.mjs';
import {
    actorIdFromName,
    actorIdFromScopedIdentity,
    isActorId,
    normalizeActorRefs,
} from './actor-ref-core.mjs';
import {
    ACTOR_PROFILE_V6_VERSION,
    actorProfileActionReadiness,
    actorProfileBaselineDigest,
    isVagueActorProfileDiscoveryName,
    normalizeActorProfileV6,
    validateActorProfileDiscoveryAnchor,
} from './actor-profile-v6-core.mjs';
import {
    actorActionTargetMatches,
    actorActionNarrativeInjection,
    actorRefsMatch,
    adjudicateActorActionAttempt,
    createActorActionAttempt,
    normalizeActorActionTarget,
    validateActorActionAttempt,
    validateWorldAdjudicationBatch,
    worldEventFromSettledActionReceipt,
} from './actor-authority-core.mjs';

export const ACTOR_LEDGER_VERSION = 8;
export const ACTOR_REGISTRY_VERSION = 1;
export const ACTOR_LEDGER_MAX_ACTORS = 96;
export const ACTOR_LEDGER_MAX_RECEIPTS = 240;
export const ACTOR_LEDGER_MAX_ACTION_ATTEMPTS = 120;

const TIERS = new Set(['key', 'secondary', 'background']);
const STATUSES = new Set(['active', 'dormant', 'departed', 'deceased', 'resolved']);
const KNOWLEDGE_KINDS = new Set(['observed', 'reported', 'inferred']);
const INTENTS = new Set(['execute', 'replan', 'wait']);
const ACTOR_CANDIDATE_SOURCES = new Set([
    'accepted_narrative',
    'authority_input',
    'mvu_anchor',
]);
const PRIVATE_NARRATION = /(?:心想|暗想|暗自|内心|心底|心理|秘密想|私下决定|未说出口|回忆起|玩家的秘密|玩家私密)/u;
const PLAYER_SOVEREIGNTY = /(?:让|迫使|命令|说服|要求)(?:了)?玩家(?:接受|同意|服从|支付|交出|前往|离开|攻击|回答|承诺|决定)|玩家(?:接受了|同意了|服从了|支付了|交出了|前往了|离开了|攻击了|回答了|承诺了|决定了)/u;
const GENERIC_WAIT = /^(?:等待|继续等待|暂时不动|按兵不动|保持现状|没有变化|暂无变化|无事发生|条件未成熟)[。.!！]?$/u;
const GROUP_NAME = /(?:队|小队|团队|军|军团|旅团|兵团|团|协会|组织|公司|集团|家族|势力|帮派|教会|政府|部门|机构|委员会|人群|群众|议会|公会|商会)$/u;
const NON_ACTOR_NAME = /^(?:玩家|player|user|系统(?:播报|提示|公告|通知)?|system(?:\s+(?:broadcast|message|notice|announcement))?|环境|environment|世界|world|旁白|narrator|场景|scene|规则播报|任务提示|游戏提示|主持人|gm|game master|他|她|它|牠|他们|她们|它们|你|你们|您|我|我们|咱|咱们|俺|俺们|某人|某某|某甲|某乙|谁|谁人|何人|大家|众人|人们|群众|群体|各位|诸位)$/iu;
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

function cleanActorIdList(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const raw of value) {
        const actorId = cleanText(raw, 120);
        if (!actorId || seen.has(actorId)) continue;
        seen.add(actorId);
        result.push(actorId);
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

export function classifyActorRegistryTargetName(value, excludedActorNames = []) {
    const name = cleanText(value, 160);
    if (!name || name.length < 2) return 'actor_candidate.identity_missing_or_short';
    if (NON_ACTOR_NAME.test(name)) return 'actor_candidate.identity_system';
    if (GROUP_NAME.test(name)) return 'actor_candidate.identity_group';
    if (isVagueActorProfileDiscoveryName(name)) return 'actor_candidate.identity_missing_or_short';
    const excluded = excludedActorNames instanceof Set
        ? excludedActorNames
        : normalizeExcludedActorNames(excludedActorNames);
    if (excluded.has(name.toLocaleLowerCase())) return 'actor_candidate.identity_excluded';
    return '';
}

function isActorName(value, excludedActorNames = new Set()) {
    return !classifyActorRegistryTargetName(value, excludedActorNames);
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
    const scopeDigest = cleanText(value.scopeDigest, 180);
    if (!chatId || !messageId || !hash) return null;
    return {
        chatId,
        messageId,
        logicalIndex: integer(value.logicalIndex ?? value.index, 0, Number.MAX_SAFE_INTEGER, 0),
        index: integer(value.index, 0, Number.MAX_SAFE_INTEGER, 0),
        swipeId: integer(value.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
        generation: integer(value.generation, 0, Number.MAX_SAFE_INTEGER, 0),
        generationSerial: integer(value.generationSerial ?? value.generation, 0, Number.MAX_SAFE_INTEGER, 0),
        generationId: cleanText(value.generationId, 180),
        generationType: cleanText(value.generationType, 80),
        identityScopeId: cleanText(value.identityScopeId, 300),
        scopeDigest,
        hash,
        contentHash: cleanText(value.contentHash || value.contentFingerprint || hash, 180),
        contentFingerprint: cleanText(value.contentFingerprint || value.contentHash || hash, 180),
        compatibilityOnly: !scopeDigest
            || !cleanText(value.generationId, 180)
            || !cleanText(value.generationType, 80)
            || !cleanText(value.contentHash || value.contentFingerprint, 180),
    };
}

// caikis first_npc/second_npc: an explicit full-name delimiter is the only
// automatic source of aliases. No suffix or semantic inference is allowed.
export function explicitDelimitedActorAliases(value) {
    const name = cleanText(value, 160);
    if (!/[·・•]/u.test(name)) return [];
    return cleanList(name.split(/[·・•]/u), 12, 160).filter((item) => item !== name);
}

// npc_tracker registry.js: resolveRegistryTargetName, adapted to a local value.
export function resolveActorRegistryTargetName(value) {
    return cleanText(value, 160);
}

// Doctor-required accepted-narrative adapter: source/generation/swipe binding.
export function acceptedActorSourceRefMatches(value, expected, { allowLegacyReadOnly = false } = {}) {
    const actual = normalizeSourceRef(value);
    const target = normalizeSourceRef(expected);
    if (!actual || !target) return false;
    if (!allowLegacyReadOnly && (actual.compatibilityOnly || target.compatibilityOnly)) return false;
    if (Boolean(actual.scopeDigest) !== Boolean(target.scopeDigest)) return false;
    return [
        'chatId', 'messageId', 'logicalIndex', 'index', 'swipeId', 'generation', 'generationSerial',
        'generationId', 'generationType', 'identityScopeId', 'scopeDigest', 'hash',
        'contentHash', 'contentFingerprint',
    ].every((field) => actual[field] === target[field]);
}

export function emptyActorRegistry(chatId = '', identityScopeId = '', scopeDigest = '') {
    return {
        version: ACTOR_REGISTRY_VERSION,
        chatId: cleanText(chatId, 180),
        identityScopeId: cleanText(identityScopeId, 300),
        scopeDigest: cleanText(scopeDigest, 180),
        characters: {},
        registered: {},
        updatedAt: 0,
    };
}

function registrySourceRefs(value, chatId) {
    const refs = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
        const ref = normalizeSourceRef(raw);
        if (!ref || (chatId && ref.chatId !== chatId)) continue;
        const key = [
            ref.chatId,
            ref.messageId,
            ref.swipeId,
            ref.generation,
            ref.generationId,
            ref.generationType,
            ref.identityScopeId,
            ref.scopeDigest,
            ref.hash,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
    }
    return refs.slice(-24);
}

function registryEntryFromActor(actor, chatId, {
    origin = 'legacy_persisted',
    sourceRefs = [],
    registeredTurn = null,
} = {}) {
    const actorId = cleanText(actor?.id, 120);
    const displayName = cleanText(actor?.name, 160);
    if (!actorId || !displayName) return null;
    const aliases = cleanList(actor?.identity?.aliases, 12, 160)
        .filter((item) => item !== displayName && !isActorId(item));
    return {
        actorRef: {
            kind: 'actor_ref',
            actorId,
            displayName,
            aliases,
        },
        origin: cleanText(origin, 80) || 'legacy_persisted',
        sourceRefs: registrySourceRefs(sourceRefs, chatId),
        registeredTurn: integer(
            registeredTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            actor?.createdTurn || 0,
        ),
        updatedTurn: integer(
            actor?.updatedTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            actor?.createdTurn || 0,
        ),
    };
}

function normalizeRegistryEntry(value, chatId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawRef = value.actorRef && typeof value.actorRef === 'object'
        ? value.actorRef
        : value;
    const actorId = cleanText(rawRef.actorId || value.actorId, 120);
    const displayName = cleanText(
        rawRef.displayName || rawRef.name || value.displayName || value.name,
        160,
    );
    if (!actorId || !displayName) return null;
    const actor = {
        id: actorId,
        name: displayName,
        identity: { aliases: rawRef.aliases || value.aliases },
        status: value.lifecycle?.status || value.status,
        inactiveReason: value.lifecycle?.inactiveReason || value.inactiveReason,
        lineage: value.lineage,
        createdTurn: value.registeredTurn,
        updatedTurn: value.updatedTurn,
    };
    const entry = registryEntryFromActor(actor, chatId, {
        origin: value.origin,
        sourceRefs: value.sourceRefs,
        registeredTurn: value.registeredTurn,
    });
    return entry;
}

function normalizeCandidateRegistryRow(value, chatId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = resolveActorRegistryTargetName(value.name || value.actorRef?.displayName);
    const actorId = cleanText(value.actorRef?.actorId || value.explicitActorId, 120);
    if (!name || !isActorId(actorId)) return null;
    const aliases = cleanList([
        ...(value.aliases || []),
        ...(value.actorRef?.aliases || []),
        ...explicitDelimitedActorAliases(name),
    ], 12, 160).filter((item) => item !== name);
    return {
        kind: 'actor_candidate',
        candidateId: cleanText(value.candidateId, 120)
            || `AC-${fingerprint(`${chatId}|${actorId}|${name}`).slice(0, 18)}`,
        name,
        aliases,
        actorRef: { kind: 'actor_ref', actorId, displayName: name, aliases },
        sourceKind: ACTOR_CANDIDATE_SOURCES.has(value.sourceKind)
            ? value.sourceKind
            : 'accepted_narrative',
        sourceRefs: registrySourceRefs(value.sourceRefs || [value.sourceRef], chatId),
        evidence: cleanList(value.evidence, 12, 300),
        present: value.present === true,
        location: cleanText(value.location, 180),
        discoveredTurn: integer(value.discoveredTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        updatedTurn: integer(value.updatedTurn, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

export function normalizeActorRegistry(value, {
    chatId = '',
    identityScopeId = '',
    scopeDigest = '',
    allowScopeDigestFill = false,
    actors = [],
    migrateLegacy = false,
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const expectedChatId = cleanText(chatId || source.chatId, 180);
    const expectedScopeDigest = cleanText(scopeDigest, 180);
    const sourceChatId = cleanText(source.chatId, 180);
    if (chatId && sourceChatId && cleanText(chatId, 180) !== sourceChatId) {
        return emptyActorRegistry(chatId, identityScopeId, expectedScopeDigest);
    }
    const expectedScopeId = cleanText(identityScopeId || source.identityScopeId, 300);
    const sourceScopeId = cleanText(source.identityScopeId, 300);
    if (identityScopeId && sourceScopeId && expectedScopeId !== sourceScopeId) {
        return emptyActorRegistry(expectedChatId, expectedScopeId, expectedScopeDigest);
    }
    const sourceScopeDigest = cleanText(source.scopeDigest, 180);
    if (expectedScopeDigest && sourceScopeDigest && expectedScopeDigest !== sourceScopeDigest) {
        return emptyActorRegistry(expectedChatId, expectedScopeId, expectedScopeDigest);
    }
    const normalizedScopeDigest = sourceScopeDigest
        || (allowScopeDigestFill ? expectedScopeDigest : '');
    const characters = {};
    const registered = {};
    const usedActorIds = new Set();
    for (const raw of Object.values(source.characters || {})) {
        const row = normalizeCandidateRegistryRow(raw, expectedChatId);
        if (!row || usedActorIds.has(row.actorRef.actorId) || characters[row.name]) continue;
        usedActorIds.add(row.actorRef.actorId);
        characters[row.name] = row;
    }
    const legacyEntries = Array.isArray(source.entries)
        ? source.entries.filter((entry) => entry?.state !== 'retired')
        : [];
    for (const raw of [...Object.values(source.registered || {}), ...legacyEntries]) {
        const entry = normalizeRegistryEntry(raw, expectedChatId);
        if (
            !entry
            || usedActorIds.has(entry.actorRef.actorId)
            || registered[entry.actorRef.displayName]
        ) continue;
        usedActorIds.add(entry.actorRef.actorId);
        registered[entry.actorRef.displayName] = entry;
    }
    if (migrateLegacy && !Object.keys(registered).length) {
        for (const actor of Array.isArray(actors) ? actors : []) {
            const entry = registryEntryFromActor(actor, expectedChatId);
            if (
                !entry
                || usedActorIds.has(entry.actorRef.actorId)
                || registered[entry.actorRef.displayName]
            ) continue;
            usedActorIds.add(entry.actorRef.actorId);
            registered[entry.actorRef.displayName] = entry;
        }
    }
    return {
        version: ACTOR_REGISTRY_VERSION,
        chatId: expectedChatId,
        identityScopeId: expectedScopeId,
        scopeDigest: normalizedScopeDigest,
        // Registry identity is authoritative storage, not an action/display
        // budget. Production normalization must retain every validated row.
        characters,
        registered,
        updatedAt: integer(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

export function actorRegistryDigest(value) {
    const registry = normalizeActorRegistry(value, { chatId: value?.chatId });
    const payload = {
        version: registry.version,
        chatId: registry.chatId,
        identityScopeId: registry.identityScopeId,
        scopeDigest: registry.scopeDigest,
        characters: Object.values(registry.characters)
            .sort((left, right) => left.actorRef.actorId.localeCompare(right.actorRef.actorId)),
        registered: Object.values(registry.registered)
            .sort((left, right) => left.actorRef.actorId.localeCompare(right.actorRef.actorId))
            .map((entry) => ({
                actorRef: entry.actorRef,
                origin: entry.origin,
                sourceRefs: entry.sourceRefs,
                registeredTurn: entry.registeredTurn,
                updatedTurn: entry.updatedTurn,
            })),
    };
    return `actor-registry-v1:${fingerprint(JSON.stringify(payload))}`;
}

export function actorRegistryMatchesLedger(value, expected = {}) {
    const ledger = normalizeActorLedger(value, {
        chatId: expected.chatId || value?.chatId,
        scopeDigest: expected.scopeDigest || '',
    });
    const mismatches = [];
    if (expected.chatId && ledger.chatId !== expected.chatId) mismatches.push('chatId');
    if (expected.scopeDigest && ledger.actorRegistry.scopeDigest !== expected.scopeDigest) {
        mismatches.push('scopeDigest');
    }
    if (expected.digest && actorRegistryDigest(ledger.actorRegistry) !== expected.digest) {
        mismatches.push('digest');
    }
    const registered = new Set(Object.values(ledger.actorRegistry.registered)
        .map((entry) => entry.actorRef.actorId));
    for (const actorId of cleanActorIdList(expected.actorIds)) {
        if (!registered.has(actorId)) mismatches.push(`actorRef:${actorId}`);
    }
    return { ok: mismatches.length === 0, mismatches };
}

// npc_tracker gate.js parseGateNames, direct rename.
export function parseRegisteredActorGateNames(result, registeredSet) {
    const allowed = registeredSet instanceof Set
        ? registeredSet
        : new Set(Array.isArray(registeredSet) ? registeredSet : []);
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
    if (!Array.isArray(result.characters)) return [];
    const out = [];
    const seen = new Set();
    for (const item of result.characters) {
        const name = String(item ?? '').trim();
        if (!name || seen.has(name) || !allowed.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

// npc_tracker runGate control flow, with accepted local candidates replacing
// its model call: build characters once, then intersect with registeredSet.
export function runRegisteredActorGate(value, candidateNames) {
    const registry = normalizeActorRegistry(value, {
        chatId: value?.chatId,
        identityScopeId: value?.identityScopeId,
    });
    const registeredSet = new Set(Object.keys(registry.registered));
    const result = { characters: Array.isArray(candidateNames) ? candidateNames : [] };
    const names = parseRegisteredActorGateNames(result, registeredSet);
    return {
        ok: true,
        names,
        actorRefs: names.map((name) => clone(registry.registered[name].actorRef)),
    };
}

function normalizeKnowledge(value, index, turn) {
    const stringShorthand = typeof value === 'string';
    const source = stringShorthand ? { claim: value } : value;
    if (!source || typeof source !== 'object') return null;
    const claim = cleanText(source.claim, 700);
    if (!claim) return null;
    const sourceRef = normalizeSourceRef(source.sourceRef);
    return {
        id: cleanText(source.id, 100)
            || `K-${fingerprint(`${claim}|${sourceRef?.hash || index}`).slice(0, 16)}`,
        claim,
        kind: KNOWLEDGE_KINDS.has(source.kind)
            ? source.kind
            : stringShorthand ? 'inferred' : 'reported',
        confidence: number(source.confidence, 0, 1, source.kind === 'observed' ? 1 : 0.6),
        learnedTurn: integer(source.learnedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        sourceRef,
        propagation: cleanList(source.propagation, 12, 160),
    };
}

function normalizeResources(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const used = new Set();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const name = cleanText(raw.name || raw.kind || raw.id, 120);
        const id = cleanText(raw.id, 100)
            || `RES-${fingerprint(name.toLocaleLowerCase()).slice(0, 12)}`;
        if (!name || used.has(id)) continue;
        used.add(id);
        result.push({
            id,
            name,
            amount: number(raw.amount, 0, 1_000_000_000, 0),
            unit: cleanText(raw.unit, 60),
            description: cleanText(raw.description || raw.detail, 300),
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

function normalizeActorPendingProfile(value, actorId, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const profileV6 = normalizeActorProfileV6(value.profileV6, {
        actorId,
        name,
        mode: value.profileV6?.completionMode,
    });
    return {
        version: 1,
        transactionId: cleanText(value.transactionId, 180),
        writeSetDigest: cleanText(value.writeSetDigest, 180),
        preparedLedgerDigest: cleanText(value.preparedLedgerDigest, 180),
        preparedFieldRevision: integer(
            value.preparedFieldRevision,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
        ),
        actorRef: {
            actorId: cleanText(value.actorRef?.actorId || actorId, 120),
            name: cleanText(value.actorRef?.name || name, 160),
        },
        sourceRef: normalizeSourceRef(value.sourceRef),
        scopeDigest: cleanText(value.scopeDigest || value.sourceRef?.scopeDigest, 180),
        schemaVersion: integer(
            value.schemaVersion,
            1,
            Number.MAX_SAFE_INTEGER,
            ACTOR_PROFILE_V6_VERSION,
        ),
        commitId: cleanText(value.commitId, 180),
        profileDigest: cleanText(value.profileDigest, 120),
        status: 'pending_readback',
        readbackVerified: false,
        preparedForAction: false,
        locks: clone(value.locks || profileV6.locks || {}),
        manualOverrides: clone(value.manualOverrides || profileV6.manualOverrides || {}),
        writeSet: canonicalProfileWriteSet(value.writeSet),
        committedTurn: integer(value.committedTurn, 0, Number.MAX_SAFE_INTEGER, 0),
        preparedProjection: value.preparedProjection && typeof value.preparedProjection === 'object'
            ? clone(value.preparedProjection)
            : null,
        profileV6,
    };
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
            .map((item) => typeof item === 'string'
                ? { name: '关系背景', summary: item }
                : item)
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                actorId: cleanText(item.actorId, 120),
                name: cleanText(
                    item.name || item.counterparty || item.targetName || item.relation,
                    160,
                ),
                summary: cleanText(item.summary || item.detail || item.relation, 500),
                evidence: cleanList(item.evidence, 6, 240),
            }))
            .filter((item) => (item.actorId || item.name) && item.summary)
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
                actorRef: item.actorRef && typeof item.actorRef === 'object'
                    ? clone(item.actorRef)
                    : null,
                target: normalizeActorActionTarget(item.target),
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
        pendingProfile: normalizeActorPendingProfile(value.pendingProfile, id, name),
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
    const normalized = {
        ...clone(value),
        receiptId,
        actionId: cleanText(value.actionId, 160),
        attemptId: cleanText(value.attemptId || value.actionId, 160),
        actorId: cleanText(value.actorId, 120),
        actorRef: value.actorRef && typeof value.actorRef === 'object'
            ? {
                kind: 'actor_ref',
                actorId: cleanText(value.actorRef.actorId || value.actorId, 120),
                displayName: cleanText(value.actorRef.displayName, 160),
                aliases: cleanList(value.actorRef.aliases, 12, 160),
            }
            : null,
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
                logicalIndex: integer(
                    value.target.logicalIndex ?? value.target.index,
                    0,
                    Number.MAX_SAFE_INTEGER,
                    0,
                ),
                index: integer(
                    value.target.logicalIndex ?? value.target.index,
                    0,
                    Number.MAX_SAFE_INTEGER,
                    0,
                ),
                swipeId: integer(value.target.swipeId, 0, Number.MAX_SAFE_INTEGER, 0),
                generation: integer(value.target.generation, 0, Number.MAX_SAFE_INTEGER, 0),
                generationId: cleanText(value.target.generationId, 180),
                generationType: cleanText(value.target.generationType, 80),
                scopeDigest: cleanText(value.target.scopeDigest, 180),
                contentHash: cleanText(value.target.contentHash || value.target.hash, 120),
                hash: cleanText(value.target.contentHash || value.target.hash, 120),
            }
            : null,
    };
    delete normalized.actionAttempt;
    return normalized;
}

function actionAttemptPayload(value) {
    const attempt = clone(value || {});
    delete attempt.settlementEligible;
    delete attempt.compatibilityOnly;
    delete attempt.compatibilityReason;
    delete attempt.migratedFromLegacyReceipt;
    return attempt;
}

function actionAttemptFingerprint(value) {
    return fingerprint(JSON.stringify(actionAttemptPayload(value)));
}

function normalizeActionAttempt(value, { migratedFromLegacyReceipt = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const legacyReceiptHistory = migratedFromLegacyReceipt
        || value.migratedFromLegacyReceipt === true
        || value.compatibilityReason === 'action_attempt.legacy_embedded_receipt';
    const attempt = actionAttemptPayload(value);
    const id = cleanText(attempt.id, 160);
    if (!id) return null;
    const validation = validateActorActionAttempt(attempt);
    const status = cleanText(attempt.status, 80) || 'attempted';
    const terminal = !['attempted', 'pending_world'].includes(status);
    const compatibilityOnly = legacyReceiptHistory || !validation.valid;
    return {
        ...attempt,
        id,
        status,
        settlementEligible: validation.valid && !terminal && !legacyReceiptHistory,
        compatibilityOnly,
        compatibilityReason: legacyReceiptHistory
            ? 'action_attempt.legacy_embedded_receipt'
            : validation.valid ? '' : validation.reason,
        migratedFromLegacyReceipt: legacyReceiptHistory,
    };
}

function compactActionAttempts(values) {
    const deduped = (Array.isArray(values) ? values : [])
        .filter(Boolean)
        .filter((entry, index, list) => (
            list.findLastIndex((candidate) => candidate.id === entry.id) === index
        ));
    const pending = deduped.filter((entry) => (
        ['attempted', 'pending_world', 'pending_player'].includes(entry.status)
        && entry.compatibilityOnly !== true
    ));
    const terminal = deduped.filter((entry) => !pending.includes(entry));
    // Pending recovery state is outside the terminal-history budget. Keeping
    // a separate terminal window also guarantees a just-settled result remains
    // available for durable readback even while pending work is over capacity.
    const terminalOrder = new Map(
        terminal.map((entry, index) => [entry.id, index]),
    );
    const retainedTerminal = [...terminal]
        .sort((left, right) => (
            Number(left.adjudicatedAt || left.worldAdjudicationResult?.settledAt || 0)
            - Number(right.adjudicatedAt || right.worldAdjudicationResult?.settledAt || 0)
            || (terminalOrder.get(left.id) ?? 0) - (terminalOrder.get(right.id) ?? 0)
        ))
        .slice(-ACTOR_LEDGER_MAX_ACTION_ATTEMPTS);
    const retainedIds = new Set([
        ...pending.map((entry) => entry.id),
        ...retainedTerminal.map((entry) => entry.id),
    ]);
    return {
        attempts: deduped.filter((entry) => retainedIds.has(entry.id)),
        backlog: {
            status: pending.length > ACTOR_LEDGER_MAX_ACTION_ATTEMPTS
                ? 'pending_over_capacity'
                : 'ok',
            pendingCount: pending.length,
            capacity: ACTOR_LEDGER_MAX_ACTION_ATTEMPTS,
            terminalRetained: retainedTerminal.length,
            terminalDropped: Math.max(0, terminal.length - retainedTerminal.length),
            pendingDropped: 0,
        },
    };
}

function compactActionReceipts(values, attempts) {
    const receipts = (Array.isArray(values) ? values : []).filter(Boolean);
    const protectedAttemptIds = new Set((Array.isArray(attempts) ? attempts : [])
        .filter((entry) => (
            ['attempted', 'pending_world', 'pending_player'].includes(entry.status)
            && entry.compatibilityOnly !== true
        ))
        .map((entry) => entry.id));
    const isProtected = (receipt) => (
        protectedAttemptIds.has(cleanText(receipt?.attemptId || receipt?.actionId, 160))
        || receipt?.status === 'pending'
        || receipt?.status === 'pending_world'
        || receipt?.status === 'pending_player'
    );
    const protectedReceipts = receipts.filter(isProtected);
    const terminalReceipts = receipts.filter((receipt) => !isProtected(receipt));
    const retainedTerminal = terminalReceipts.slice(-ACTOR_LEDGER_MAX_RECEIPTS);
    const retained = new Set([...protectedReceipts, ...retainedTerminal]);
    return {
        receipts: receipts.filter((entry) => retained.has(entry)),
        protectedCount: protectedReceipts.length,
        terminalDropped: Math.max(
            0,
            receipts.length - protectedReceipts.length - retainedTerminal.length,
        ),
        overCapacity: protectedReceipts.length > ACTOR_LEDGER_MAX_RECEIPTS,
    };
}

export function emptyActorLedger(chatId = '') {
    return {
        version: ACTOR_LEDGER_VERSION,
        chatId: cleanText(chatId, 180),
        turn: 0,
        actors: [],
        actorRegistry: emptyActorRegistry(chatId),
        identityQuarantine: [],
        actionAttempts: [],
        actionAttemptBacklog: {
            status: 'ok',
            pendingCount: 0,
            capacity: ACTOR_LEDGER_MAX_ACTION_ATTEMPTS,
            terminalRetained: 0,
            terminalDropped: 0,
            pendingDropped: 0,
            receiptProtectedCount: 0,
            receiptTerminalDropped: 0,
            receiptOverCapacity: false,
        },
        actionReceipts: [],
        observationReceipts: [],
        migrations: {
            continuityV5: false,
            actorLedgerV2: true,
            actorLedgerV3: true,
            actorLedgerV4: true,
            actorLedgerV5: true,
            actorLedgerV6: true,
            actorLedgerV7: true,
            actorLedgerV8: true,
            actorProfileV6: true,
            actorRegistryV1: false,
        },
        updatedAt: 0,
    };
}

export function normalizeActorLedger(value, {
    chatId = '',
    identityScopeId = '',
    scopeDigest = '',
    allowScopeDigestFill = false,
    maxActors = null,
    excludedActorNames = [],
} = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const expectedChatId = cleanText(chatId || source.chatId, 180);
    const sourceChatId = cleanText(source.chatId, 180);
    if (chatId && sourceChatId && cleanText(chatId, 180) !== sourceChatId) {
        return emptyActorLedger(chatId);
    }
    const turn = integer(source.turn, 0, Number.MAX_SAFE_INTEGER, 0);
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const actors = [];
    const used = new Set();
    const explicitProjectionLimit = maxActors !== null
        && maxActors !== undefined
        && Number.isFinite(Number(maxActors))
        ? Math.max(0, Math.floor(Number(maxActors)))
        : null;
    for (const raw of Array.isArray(source.actors) ? source.actors : []) {
        if (explicitProjectionLimit === 0) break;
        const item = normalizeActor(raw, actors.length, turn);
        if (!item || !isActorName(item.name, excluded) || used.has(item.id)) continue;
        used.add(item.id);
        actors.push(item);
        // A caller may still request an explicit compatibility/read-only
        // projection. The production ledger path passes no limit.
        if (explicitProjectionLimit !== null && actors.length >= explicitProjectionLimit) {
            break;
        }
    }
    const hasPersistedRegistry = source.migrations?.actorRegistryV1 === true
        && source.actorRegistry
        && typeof source.actorRegistry === 'object'
        && !Array.isArray(source.actorRegistry)
        && Number(source.actorRegistry.version) >= 1;
    const actorRegistry = normalizeActorRegistry(source.actorRegistry, {
        chatId: expectedChatId,
        identityScopeId,
        scopeDigest,
        allowScopeDigestFill,
        actors,
        migrateLegacy: !hasPersistedRegistry,
    });
    const registeredIds = new Set(Object.values(actorRegistry.registered)
        .map((entry) => entry.actorRef.actorId));
    const registeredActors = actors.filter((actor) => registeredIds.has(actor.id));
    const actorById = new Map(registeredActors.map((actor) => [actor.id, actor]));
    actorRegistry.registered = Object.fromEntries(Object.values(actorRegistry.registered)
        .filter((entry) => actorById.has(entry.actorRef.actorId))
        .map((entry) => {
            const actor = actorById.get(entry.actorRef.actorId);
            const synced = registryEntryFromActor(actor, expectedChatId, {
                origin: entry.origin,
                sourceRefs: entry.sourceRefs,
                registeredTurn: entry.registeredTurn,
            });
            return [synced.actorRef.displayName, synced];
        }));
    const identityQuarantine = (Array.isArray(source.identityQuarantine)
        ? source.identityQuarantine
        : [])
        .map((entry, index) => {
            if (cleanText(entry?.reason, 160) === 'actor_candidate.alias_conflict') {
                const conflictingActorIds = cleanList(entry?.conflictingActorIds, 12, 120);
                const name = cleanText(entry?.name, 160);
                if (!name || conflictingActorIds.length < 2) return null;
                return {
                    id: cleanText(entry?.id, 120)
                        || `IQ-${fingerprint(`${name}|${conflictingActorIds.join('|')}`).slice(0, 18)}`,
                    reason: 'actor_candidate.alias_conflict',
                    name,
                    conflictingActorIds,
                    sourceRef: normalizeSourceRef(entry?.sourceRef),
                    quarantinedTurn: integer(entry?.quarantinedTurn, 0, Number.MAX_SAFE_INTEGER, turn),
                    evidence: cleanList(entry?.evidence, 12, 300),
                };
            }
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
    const rawReceipts = Array.isArray(source.actionReceipts) ? source.actionReceipts : [];
    const normalizedAttemptById = new Map();
    for (const rawAttempt of Array.isArray(source.actionAttempts) ? source.actionAttempts : []) {
        const attempt = normalizeActionAttempt(rawAttempt);
        if (attempt) normalizedAttemptById.set(attempt.id, attempt);
    }
    // v7 and early v8 receipts embedded the whole attempt. Lift those records
    // into the single journal for history only, then discard the duplicate
    // receipt payload. They can be displayed or migrated, but cannot settle.
    for (const rawReceipt of rawReceipts) {
        const embedded = rawReceipt?.actionAttempt;
        const embeddedId = cleanText(embedded?.id || rawReceipt?.attemptId, 160);
        if (!embeddedId || normalizedAttemptById.has(embeddedId)) continue;
        const migrated = normalizeActionAttempt({
            ...clone(embedded),
            id: embeddedId,
            status: rawReceipt?.status === 'pending_world'
                ? 'legacy_pending'
                : cleanText(rawReceipt?.status, 80) || cleanText(embedded?.status, 80),
            outcome: cleanText(rawReceipt?.resultId, 160) || embedded?.outcome || null,
        }, { migratedFromLegacyReceipt: true });
        if (migrated) normalizedAttemptById.set(migrated.id, migrated);
    }
    const compactedAttempts = compactActionAttempts([...normalizedAttemptById.values()]);
    const normalizedReceipts = rawReceipts.map(normalizeReceipt).filter(Boolean);
    const compactedReceipts = compactActionReceipts(
        normalizedReceipts,
        compactedAttempts.attempts,
    );
    return {
        version: ACTOR_LEDGER_VERSION,
        chatId: expectedChatId,
        turn,
        actors: registeredActors,
        actorRegistry,
        identityQuarantine,
        actionAttempts: compactedAttempts.attempts,
        actionAttemptBacklog: {
            ...compactedAttempts.backlog,
            receiptProtectedCount: compactedReceipts.protectedCount,
            receiptTerminalDropped: compactedReceipts.terminalDropped,
            receiptOverCapacity: compactedReceipts.overCapacity,
        },
        actionReceipts: compactedReceipts.receipts,
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
            actorLedgerV7: true,
            actorLedgerV8: true,
            actorProfileV6: source.migrations?.actorProfileV6 === true,
            actorRefV1: source.migrations?.actorRefV1 === true,
            actorRegistryV1: true,
        },
        updatedAt: integer(source.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

function canonicalActorLedgerValue(value) {
    if (Array.isArray(value)) return value.map(canonicalActorLedgerValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
        key,
        canonicalActorLedgerValue(value[key]),
    ]));
}

export function actorLedgerDigest(value) {
    const ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    return `actor-ledger-v1:${fingerprint(JSON.stringify(canonicalActorLedgerValue(ledger)))}`;
}

function canonicalProfileWriteSet(expectedCommits) {
    return (Array.isArray(expectedCommits) ? expectedCommits : [])
        .map((entry) => ({
            actorRef: {
                actorId: cleanText(entry?.actorRef?.actorId || entry?.actorId, 120),
                name: cleanText(entry?.actorRef?.name || entry?.name, 160),
            },
            schemaVersion: integer(
                entry?.schemaVersion,
                1,
                Number.MAX_SAFE_INTEGER,
                ACTOR_PROFILE_V6_VERSION,
            ),
            commitId: cleanText(entry?.commitId, 180),
            profileDigest: cleanText(entry?.profileDigest || entry?.digest, 120),
            sourceRef: normalizeSourceRef(entry?.sourceRef),
            scopeDigest: cleanText(
                entry?.scopeDigest || entry?.sourceRef?.scopeDigest,
                180,
            ),
            locks: clone(entry?.locks || {}),
            manualOverrides: clone(entry?.manualOverrides || {}),
        }))
        .filter((entry) => (
            entry.actorRef.actorId
            && entry.commitId
            && entry.profileDigest
        ))
        .sort((left, right) => left.actorRef.actorId.localeCompare(right.actorRef.actorId));
}

export function actorProfileWriteSetDigest(expectedCommits) {
    const writeSet = canonicalProfileWriteSet(expectedCommits);
    return `actor-profile-write-set-v1:${fingerprint(JSON.stringify(
        canonicalActorLedgerValue(writeSet),
    ))}`;
}

export function actorProfileTransactionId({ chatId = '', sourceRef = null, preparedFieldRevision = 0, expectedCommits = [] } = {}) {
    return `PBT-${fingerprint(JSON.stringify([
        cleanText(chatId, 180),
        normalizeSourceRef(sourceRef),
        integer(preparedFieldRevision, 0, Number.MAX_SAFE_INTEGER, 0),
        canonicalProfileWriteSet(expectedCommits),
    ])).slice(0, 24)}`;
}

// The batch seal proves atomicity at final readback. Long-lived action
// readiness must not rebuild that historical batch against today's profiles:
// a later, valid maintenance commit for one peer would otherwise invalidate
// every untouched member of the old batch. This compact receipt binds the
// immutable transaction metadata and original write-set without binding
// current peer profile values.
export function actorProfileCommitEvidenceDigest(value = {}) {
    const writeSet = canonicalProfileWriteSet(value.writeSet);
    const projection = canonicalActorLedgerValue({
        version: 2,
        transactionId: cleanText(value.transactionId, 180),
        writeSetDigest: cleanText(value.writeSetDigest, 180),
        preparedLedgerDigest: cleanText(value.preparedLedgerDigest, 180),
        preparedFieldRevision: integer(
            value.preparedFieldRevision,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
        ),
        commitId: cleanText(value.commitId, 180),
        profileDigest: cleanText(value.profileDigest, 120),
        writeSet,
    });
    return `actor-profile-commit-evidence-v2:${fingerprint(JSON.stringify(projection))}`;
}

export function actorProfilePendingWriteSetProjection(value, expectedCommits, {
    preparedFieldRevision = 0,
    transactionId = '',
    writeSetDigest = '',
} = {}) {
    const ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    const writeSet = canonicalProfileWriteSet(expectedCommits);
    // Phase 1 staging: project only from a fully matching
    // actor.pendingProfile. Missing or mismatched candidates produce an
    // explicitly unmatchable placeholder; the live profileV6 is never used
    // as a fallback here.
    const pendingEntries = writeSet.map((expected) => {
        const actor = ledger.actors.find((entry) => entry.id === expected.actorRef.actorId);
        const pending = actor?.pendingProfile || null;
        if (!actor || !pending) {
            return { expected, pending: null, pendingDigest: '' };
        }
        const profile = normalizeActorProfileV6(pending.profileV6, {
            actorId: actor.id,
            name: actor.name,
            mode: pending.profileV6?.completionMode,
        });
        const pendingDigest = actorProfileBaselineDigest(profile);
        const pendingMatches = pending.actorRef?.actorId === expected.actorRef.actorId
            && pending.schemaVersion === expected.schemaVersion
            && pending.commitId === expected.commitId
            && pending.profileDigest === expected.profileDigest
            && pendingDigest === expected.profileDigest;
        return { expected, pending: pendingMatches ? pending : null, pendingDigest };
    });
    const actors = pendingEntries.map(({ expected, pending, pendingDigest }) => {
        const actor = ledger.actors.find((entry) => entry.id === expected.actorRef.actorId);
        const finalProfile = actor?.profileV6;
        const finalVerification = finalProfile?.baselineCommit?.verification;
        const finalMode = !pending && finalProfile && finalVerification ? 'final' : 'pending';
        const sourceRef = pending
            ? pending.sourceRef
            : (finalProfile?.baselineCommit?.sourceRef || null);
        const locks = clone(pending?.locks || finalProfile?.locks || expected.locks || {});
        const manualOverrides = clone(
            pending?.manualOverrides
                || finalProfile?.manualOverrides
                || expected.manualOverrides
                || {},
        );
        const finalCommitId = finalProfile?.baselineCommit?.commitId || expected.commitId;
        const finalDigest = finalProfile
            ? actorProfileBaselineDigest(finalProfile)
            : pendingDigest;
        if (!pending) {
            return {
                actorRef: {
                    actorId: cleanText(expected.actorRef.actorId, 120),
                    name: cleanText(expected.actorRef.name, 160),
                },
                schemaVersion: integer(
                    expected.schemaVersion,
                    1,
                    Number.MAX_SAFE_INTEGER,
                    ACTOR_PROFILE_V6_VERSION,
                ),
                commitId: finalMode === 'final' ? finalCommitId : '',
                profileDigest: finalMode === 'final' ? finalDigest : '',
                sourceRef: finalMode === 'final' ? normalizeSourceRef(sourceRef) : null,
                scopeDigest: finalMode === 'final'
                    ? cleanText(sourceRef?.scopeDigest, 180)
                    : '',
                status: finalMode === 'final' ? 'pending_readback' : 'pending_missing',
                readbackVerified: false,
                preparedForAction: false,
                locks,
                manualOverrides,
            };
        }
        return {
            actorRef: {
                actorId: cleanText(pending.actorRef?.actorId || expected.actorRef.actorId, 120),
                name: cleanText(pending.actorRef?.name || expected.actorRef.name, 160),
            },
            schemaVersion: integer(
                pending.schemaVersion,
                1,
                Number.MAX_SAFE_INTEGER,
                ACTOR_PROFILE_V6_VERSION,
            ),
            commitId: cleanText(pending.commitId, 180),
            profileDigest: pendingDigest,
            sourceRef: normalizeSourceRef(pending.sourceRef),
            scopeDigest: cleanText(
                pending.scopeDigest || pending.sourceRef?.scopeDigest,
                180,
            ),
            status: 'pending_readback',
            readbackVerified: false,
            preparedForAction: false,
            locks: clone(pending.locks || {}),
            manualOverrides: clone(pending.manualOverrides || {}),
        };
    });
    const transactionMetadata = pendingEntries.map(({ pending, expected }) => {
        if (pending) return pending;
        const actor = ledger.actors.find((entry) => entry.id === expected.actorRef.actorId);
        return actor?.profileV6?.baselineCommit?.verification || {};
    });
    return canonicalActorLedgerValue({
        version: 1,
        transactionId: cleanText(
            transactionId
                || transactionMetadata.map((entry) => entry.transactionId).find(Boolean),
            180,
        ),
        writeSetDigest: cleanText(
            writeSetDigest
                || transactionMetadata.map((entry) => entry.writeSetDigest).find(Boolean),
            180,
        ) || actorProfileWriteSetDigest(writeSet),
        preparedFieldRevision: integer(
            preparedFieldRevision,
            0,
            Number.MAX_SAFE_INTEGER,
            0,
        ),
        writeSet,
        actors,
    });
}

export function actorProfilePendingWriteSetDigest(value, expectedCommits, options = {}) {
    const projection = actorProfilePendingWriteSetProjection(
        value,
        expectedCommits,
        options,
    );
    return `actor-profile-pending-v1:${fingerprint(JSON.stringify(projection))}`;
}

// Phase 1 never publishes a candidate profile.  It seals every pending row
// with one canonical write-set before the single durable pending save, so a
// later recovery cannot promote an arbitrary subset of the batch.
export function sealActorProfilePendingTransactionInLedger(value, expectedCommits, {
    transactionId = '',
    preparedFieldRevision = 0,
} = {}) {
    let ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    const originalLedger = clone(ledger);
    const writeSet = canonicalProfileWriteSet(expectedCommits);
    if (!writeSet.length) {
        return { ledger: originalLedger, sealed: false, reason: 'actor_profile.write_set_empty' };
    }
    const canonicalTransactionId = cleanText(transactionId, 180)
        || actorProfileTransactionId({
            chatId: ledger.chatId,
            sourceRef: writeSet[0]?.sourceRef,
            preparedFieldRevision,
            expectedCommits: writeSet,
        });
    const writeSetDigest = actorProfileWriteSetDigest(writeSet);
    const revision = integer(preparedFieldRevision, 0, Number.MAX_SAFE_INTEGER, 0);
    for (const expected of writeSet) {
        const index = ledger.actors.findIndex((actor) => actor.id === expected.actorRef.actorId);
        const actor = index >= 0 ? clone(ledger.actors[index]) : null;
        if (!actor || !actorProfileCommitMatchesLedger(ledger, {
            ...expected,
            transactionId: '',
            writeSetDigest: '',
            preparedLedgerDigest: '',
            phase: 'pending',
        }).ok) {
            return { ledger: originalLedger, sealed: false, reason: 'actor_profile.pending_readback_mismatch' };
        }
        actor.pendingProfile = {
            ...actor.pendingProfile,
            transactionId: canonicalTransactionId,
            writeSetDigest,
            preparedFieldRevision: revision,
            writeSet: clone(writeSet),
            preparedLedgerDigest: '',
            preparedProjection: null,
        };
        ledger.actors[index] = actor;
    }
    const projection = actorProfilePendingWriteSetProjection(ledger, writeSet, {
        transactionId: canonicalTransactionId,
        writeSetDigest,
        preparedFieldRevision: revision,
    });
    const preparedLedgerDigest = `actor-profile-pending-v1:${fingerprint(JSON.stringify(projection))}`;
    for (const expected of writeSet) {
        const index = ledger.actors.findIndex((actor) => actor.id === expected.actorRef.actorId);
        ledger.actors[index] = {
            ...ledger.actors[index],
            pendingProfile: {
                ...ledger.actors[index].pendingProfile,
                preparedLedgerDigest,
                preparedProjection: clone(projection),
            },
        };
    }
    ledger = normalizeActorLedger(ledger, { chatId: ledger.chatId });
    return {
        ledger,
        sealed: true,
        transactionId: canonicalTransactionId,
        writeSetDigest,
        preparedFieldRevision: revision,
        preparedLedgerDigest,
        writeSet,
    };
}

export function replaceActorProfileBaselineInLedger(value, actorRef, baseline, commitMeta = {}) {
    const ledger = normalizeActorLedger(value);
    const originalLedger = clone(ledger);
    const actorId = cleanText(actorRef?.actorId || actorRef, 120);
    const actorName = cleanText(actorRef?.name, 160);
    const actorIndex = ledger.actors.findIndex((actor) => actor.id === actorId);
    if (actorIndex < 0) {
        return { ledger, committed: false, reason: 'actor_profile.actor_ref_mismatch' };
    }
    const actor = clone(ledger.actors[actorIndex]);
    if (
        actorName
        && actor.name !== actorName
        && !actor.identity.aliases.includes(actorName)
    ) {
        return { ledger, committed: false, reason: 'actor_profile.actor_ref_mismatch' };
    }
    const profile = normalizeActorProfileV6(baseline, {
        actorId: actor.id,
        name: actor.name,
        mode: baseline?.completionMode,
    });
    if (
        profile.actorId !== actor.id
        || profile.version !== ACTOR_PROFILE_V6_VERSION
        || Number(commitMeta.schemaVersion || profile.version) !== profile.version
        || (commitMeta.actorRef?.actorId && commitMeta.actorRef.actorId !== actor.id)
        || (
            commitMeta.actorRef?.name
            && commitMeta.actorRef.name !== actor.name
            && !actor.identity.aliases.includes(commitMeta.actorRef.name)
        )
        || !cleanText(commitMeta.commitId, 180)
    ) {
        return { ledger, committed: false, reason: 'actor_profile.commit_rejected' };
    }
    const digest = actorProfileBaselineDigest(profile);
    if (commitMeta.digest && cleanText(commitMeta.digest, 120) !== digest) {
        return { ledger, committed: false, reason: 'actor_profile.commit_rejected' };
    }
    if (commitMeta.phase === 'pending') {
        // Phase 1 staging only: persist the full candidate on
        // actor.pendingProfile and leave actor.profileV6 plus every live
        // compatibility projection (identity/goals/relationships/knowledge/
        // resources/capabilities) untouched until a later final commit.
        const pendingCommitId = cleanText(commitMeta.commitId, 180);
        const stagedWriteSet = canonicalProfileWriteSet(
            Array.isArray(commitMeta.writeSet) && commitMeta.writeSet.length
                ? commitMeta.writeSet
                : [{
                    actorRef: { actorId: actor.id, name: actor.name },
                    schemaVersion: profile.version,
                    commitId: pendingCommitId,
                    profileDigest: digest,
                    sourceRef: commitMeta.sourceRef,
                    scopeDigest: cleanText(
                        commitMeta.scopeDigest || commitMeta.sourceRef?.scopeDigest,
                        180,
                    ),
                }],
        );
        profile.preparedForAction = false;
        profile.backgroundPending = true;
        const pendingProfile = normalizeActorPendingProfile({
            version: 1,
            transactionId: cleanText(commitMeta.transactionId, 180),
            writeSetDigest: cleanText(commitMeta.writeSetDigest, 180)
                || actorProfileWriteSetDigest(stagedWriteSet),
            preparedLedgerDigest: cleanText(commitMeta.preparedLedgerDigest, 180),
            preparedFieldRevision: integer(
                commitMeta.preparedFieldRevision,
                0,
                Number.MAX_SAFE_INTEGER,
                0,
            ),
            actorRef: { actorId: actor.id, name: actor.name },
            sourceRef: commitMeta.sourceRef && typeof commitMeta.sourceRef === 'object'
                ? clone(commitMeta.sourceRef)
                : null,
            scopeDigest: cleanText(
                commitMeta.scopeDigest || commitMeta.sourceRef?.scopeDigest,
                180,
            ),
            schemaVersion: profile.version,
            commitId: pendingCommitId,
            profileDigest: digest,
            locks: clone(profile.locks || {}),
            manualOverrides: clone(profile.manualOverrides || {}),
            writeSet: stagedWriteSet,
            profileV6: profile,
        }, actor.id, actor.name);
        actor.pendingProfile = pendingProfile;
        ledger.actors[actorIndex] = actor;
        return {
            ledger,
            committed: true,
            pending: true,
            phase: 'pending',
            actorId: actor.id,
            commitId: pendingCommitId,
            profileDigest: digest,
            transactionId: pendingProfile?.transactionId || '',
            writeSetDigest: pendingProfile?.writeSetDigest || '',
            ledgerChanged: JSON.stringify(canonicalActorLedgerValue(ledger))
                !== JSON.stringify(canonicalActorLedgerValue(originalLedger)),
        };
    }
    const finalized = commitMeta.phase === 'final'
        && commitMeta.readbackVerified === true;
    profile.baselineCommit = {
        schemaVersion: profile.version,
        commitId: cleanText(commitMeta.commitId, 180),
        actorRef: { actorId: actor.id, name: actor.name },
        digest,
        sourceRef: commitMeta.sourceRef && typeof commitMeta.sourceRef === 'object'
            ? clone(commitMeta.sourceRef)
            : null,
        committedTurn: integer(
            commitMeta.committedTurn,
            0,
            Number.MAX_SAFE_INTEGER,
            ledger.turn,
        ),
        readbackVerified: finalized,
        status: finalized ? 'committed' : 'pending_readback',
        verification: finalized && commitMeta.verification
            ? clone(commitMeta.verification)
            : null,
    };
    profile.preparedForAction = finalized;
    profile.backgroundPending = !profile.preparedForAction;
    actor.profileV6 = profile;

    // Narrative v1 deliberately never re-parses prose into structured facts.
    // Existing actor-ledger facts remain their independent authority.  Legacy
    // module dossiers retain the established compatibility projection.
    if (profile.profileFormat !== 'narrative-v1') {
        const identity = profile.modules.identity.data || {};
        const personality = profile.modules.personality.data || {};
        actor.identity = {
            ...actor.identity,
            ...Object.fromEntries([
                'role', 'species', 'gender', 'age', 'briefIntro', 'appearance',
                'identityText', 'relationState', 'attitudeToProtagonist', 'pastExperience',
            ].map((field) => [field, clone(identity[field])])),
            ...Object.fromEntries([
                'biography', 'primaryColor', 'primaryDerivatives', 'primarySentence',
                'baseColor', 'baseDerivatives', 'baseSentence', 'accentColor',
                'accentDerivatives', 'accentSentence', 'othersVoices', 'authorVoice',
            ].map((field) => [field, clone(personality[field])])),
        };
        actor.longTermGoals = clone(profile.modules.goals.data?.longTerm || []);
        actor.relationships = clone(profile.modules.relationships.data?.entries || []);
        actor.knowledge = clone(profile.modules.knowledge.data?.entries || []);
        actor.resources = clone(profile.modules.resourcesCapabilities.data?.resources || []);
        actor.capabilities = clone(profile.modules.resourcesCapabilities.data?.capabilities || []);
    }
    actor.updatedTurn = Math.max(actor.updatedTurn, profile.baselineCommit.committedTurn);
    actor.version += 1;
    ledger.actors[actorIndex] = actor;
    const normalized = normalizeActorLedger(ledger, { chatId: ledger.chatId });
    const committedActor = normalized.actors.find((entry) => entry.id === actor.id);
    const expected = {
        actorRef: { actorId: actor.id, name: actor.name },
        schemaVersion: profile.version,
        commitId: profile.baselineCommit.commitId,
        digest,
        phase: finalized ? 'final' : 'pending',
    };
    if (!actorProfileCommitMatchesLedger(normalized, expected).ok) {
        return { ledger: originalLedger, committed: false, reason: 'actor_profile.commit_rejected' };
    }
    return {
        ledger: normalized,
        committed: true,
        actorId: actor.id,
        commit: clone(committedActor.profileV6.baselineCommit),
    };
}

export function finalizeActorProfileBaselinesInLedger(value, expectedCommits, {
    preparedLedgerDigest = '',
    preparedFieldRevision = 0,
    transactionId = '',
    writeSetDigest = '',
} = {}) {
    let ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    const originalLedger = clone(ledger);
    const writeSet = canonicalProfileWriteSet(expectedCommits);
    if (!writeSet.length) {
        return { ledger, finalized: false, reason: 'actor_profile.write_set_empty' };
    }
    const firstPending = ledger.actors.find((actor) => actor.pendingProfile
        && actor.pendingProfile.actorRef?.actorId === writeSet[0].actorRef.actorId)?.pendingProfile;
    const expectedTransactionId = cleanText(transactionId || firstPending?.transactionId, 180);
    const expectedWriteSetDigest = cleanText(
        writeSetDigest || firstPending?.writeSetDigest,
        180,
    );
    const expectedPreparedDigest = cleanText(
        preparedLedgerDigest || firstPending?.preparedLedgerDigest,
        180,
    );
    const revision = integer(
        preparedFieldRevision || firstPending?.preparedFieldRevision,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    if (
        !expectedTransactionId
        || expectedWriteSetDigest !== actorProfileWriteSetDigest(writeSet)
        || !expectedPreparedDigest
    ) return { ledger: originalLedger, finalized: false, reason: 'actor_profile.pending_transaction_mismatch' };
    const actualPreparedDigest = actorProfilePendingWriteSetDigest(ledger, writeSet, {
        preparedFieldRevision: revision,
        transactionId: expectedTransactionId,
        writeSetDigest: expectedWriteSetDigest,
    });
    if (actualPreparedDigest !== expectedPreparedDigest) {
        return { ledger: originalLedger, finalized: false, reason: 'actor_profile.pending_digest_mismatch' };
    }
    for (const expected of writeSet) {
        if (!actorProfileCommitMatchesLedger(ledger, {
            ...expected,
            transactionId: expectedTransactionId,
            writeSetDigest: expectedWriteSetDigest,
            preparedLedgerDigest: expectedPreparedDigest,
            preparedFieldRevision: revision,
            phase: 'pending',
        }).ok) {
            return { ledger: originalLedger, finalized: false, reason: 'actor_profile.pending_readback_mismatch' };
        }
    }
    for (const expected of writeSet) {
        const pendingActor = ledger.actors.find((entry) => entry.id === expected.actorRef.actorId);
        const pending = pendingActor?.pendingProfile;
        if (!pendingActor || !pending) {
            return { ledger: originalLedger, finalized: false, reason: 'actor_profile.actor_ref_mismatch' };
        }
        const replaced = replaceActorProfileBaselineInLedger(ledger, expected.actorRef,
            pending.profileV6, {
                ...expected,
                sourceRef: pending.sourceRef,
                scopeDigest: pending.scopeDigest,
                committedTurn: pending.committedTurn,
                readbackVerified: true,
                phase: 'final',
                verification: {
                    version: 2,
                    transactionId: expectedTransactionId,
                    writeSetDigest: expectedWriteSetDigest,
                    preparedLedgerDigest: expectedPreparedDigest,
                    preparedFieldRevision: revision,
                    commitId: expected.commitId,
                    profileDigest: expected.profileDigest,
                    writeSet: clone(writeSet),
                    preparedProjection: clone(pending.preparedProjection),
                    commitEvidenceDigest: actorProfileCommitEvidenceDigest({
                        transactionId: expectedTransactionId,
                        writeSetDigest: expectedWriteSetDigest,
                        preparedLedgerDigest: expectedPreparedDigest,
                        preparedFieldRevision: revision,
                        commitId: expected.commitId,
                        profileDigest: expected.profileDigest,
                        writeSet,
                    }),
                },
            });
        if (!replaced.committed) {
            return { ledger: originalLedger, finalized: false, reason: replaced.reason || 'actor_profile.finalize_rejected' };
        }
        ledger = replaced.ledger;
        const actorIndex = ledger.actors.findIndex((entry) => entry.id === expected.actorRef.actorId);
        ledger.actors[actorIndex] = { ...ledger.actors[actorIndex], pendingProfile: null };
    }
    ledger.updatedAt = Date.now();
    const normalized = normalizeActorLedger(ledger, { chatId: ledger.chatId });
    if (!writeSet.every((expected) => actorProfileCommitMatchesLedger(
        normalized,
        {
            ...expected,
            transactionId: expectedTransactionId,
            writeSetDigest: expectedWriteSetDigest,
            preparedLedgerDigest: expectedPreparedDigest,
            preparedFieldRevision: revision,
            phase: 'final',
        },
    ).ok)) {
        return { ledger: originalLedger, finalized: false, reason: 'actor_profile.finalize_rejected' };
    }
    return {
        ledger: normalized,
        finalized: true,
        transactionId: expectedTransactionId,
        writeSetDigest: expectedWriteSetDigest,
        preparedLedgerDigest: expectedPreparedDigest,
        preparedFieldRevision: revision,
        writeSet,
    };
}

export function actorProfileCommitMatchesLedger(value, expected = {}) {
    const ledger = normalizeActorLedger(value);
    const actorId = cleanText(expected.actorRef?.actorId || expected.actorId, 120);
    const actorName = cleanText(expected.actorRef?.name || expected.name, 160);
    const actor = ledger.actors.find((entry) => entry.id === actorId);
    if (!actor) return { ok: false, mismatches: ['actorRef'] };
    const phase = expected.phase === 'pending' ? 'pending' : 'final';
    const pending = phase === 'pending' ? actor.pendingProfile : null;
    const profile = normalizeActorProfileV6(
        phase === 'pending' ? pending?.profileV6 : actor.profileV6, {
        actorId: actor.id,
        name: actor.name,
    });
    const commit = phase === 'pending'
        ? {
            actorRef: pending?.actorRef,
            schemaVersion: pending?.schemaVersion,
            commitId: pending?.commitId,
            digest: pending?.profileDigest,
            readbackVerified: pending?.readbackVerified,
            status: pending?.status,
        }
        : profile.baselineCommit;
    const mismatches = [];
    if (commit?.actorRef?.actorId !== actorId) mismatches.push('actorRef');
    if (
        actorName
        && (actor.name !== actorName || commit?.actorRef?.name !== actorName)
    ) mismatches.push('actorRef.name');
    if (profile.version !== Number(expected.schemaVersion)) mismatches.push('schemaVersion');
    if (commit?.schemaVersion !== Number(expected.schemaVersion)) mismatches.push('commitSchemaVersion');
    if (commit?.commitId !== cleanText(expected.commitId, 180)) mismatches.push('commitId');
    const digest = actorProfileBaselineDigest(profile);
    if (digest !== cleanText(expected.digest || expected.profileDigest, 120)) {
        mismatches.push('digest');
    }
    if (commit?.digest !== digest) mismatches.push('commitDigest');
    if (phase === 'pending') {
        if (!pending) mismatches.push('pendingProfile');
        if (commit?.readbackVerified !== false || commit?.status !== 'pending_readback') {
            mismatches.push('pendingReadback');
        }
        if (profile.preparedForAction !== false) mismatches.push('preparedForAction');
        for (const field of [
            'transactionId', 'writeSetDigest', 'preparedLedgerDigest', 'preparedFieldRevision',
        ]) {
            if (expected[field] !== undefined && expected[field] !== ''
                && pending?.[field] !== expected[field]) mismatches.push(field);
        }
        if (expected.sourceRef && JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(pending?.sourceRef)))
            !== JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(expected.sourceRef)))) mismatches.push('sourceRef');
        if (expected.scopeDigest && cleanText(pending?.scopeDigest, 180) !== cleanText(expected.scopeDigest, 180)) mismatches.push('scopeDigest');
        if (expected.locks && JSON.stringify(canonicalActorLedgerValue(pending?.locks || {}))
            !== JSON.stringify(canonicalActorLedgerValue(expected.locks))) mismatches.push('locks');
        if (expected.manualOverrides && JSON.stringify(canonicalActorLedgerValue(pending?.manualOverrides || {}))
            !== JSON.stringify(canonicalActorLedgerValue(expected.manualOverrides))) mismatches.push('manualOverrides');
    } else {
        if (commit?.readbackVerified !== true || commit?.status !== 'committed') {
            mismatches.push('readbackVerified');
        }
        if (profile.preparedForAction !== true) mismatches.push('preparedForAction');
        const verification = commit?.verification;
        const writeSet = canonicalProfileWriteSet(verification?.writeSet);
        if (
            !verification
            || verification.commitId !== commit?.commitId
            || verification.profileDigest !== commit?.digest
            || !writeSet.some((entry) => (
                entry.actorRef.actorId === actorId
                && entry.commitId === commit?.commitId
                && entry.profileDigest === commit?.digest
            ))
        ) {
            mismatches.push('verification');
        } else {
            // Rebuild the pending-equivalent projection from the current
            // final ledger.  The stored projection is diagnostic only: locks,
            // manual overrides, profile digest, and the complete write-set
            // must all come from the current host value before readiness.
            const projectedDigest = actorProfilePendingWriteSetDigest(
                ledger,
                writeSet,
                {
                    preparedFieldRevision: verification.preparedFieldRevision,
                    transactionId: verification.transactionId,
                    writeSetDigest: verification.writeSetDigest,
                },
            );
            if (projectedDigest !== verification.preparedLedgerDigest) {
                mismatches.push('preparedLedgerDigest');
            }
            for (const field of [
                'transactionId', 'writeSetDigest', 'preparedLedgerDigest', 'preparedFieldRevision',
            ]) {
                if (expected[field] !== undefined && expected[field] !== ''
                    && verification?.[field] !== expected[field]) mismatches.push(field);
            }
        }
    }
    return { ok: mismatches.length === 0, mismatches };
}

export function actorProfileReadinessInLedger(value, actorId) {
    const ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    const id = cleanText(actorId, 120);
    const actor = ledger.actors.find((entry) => entry.id === id);
    if (!actor) return { ready: false, reason: 'actor_profile.actor_missing' };
    if (actor.pendingProfile) {
        return { ready: false, reason: 'actor_profile.pending_readback', migrationRequired: false };
    }
    const base = actorProfileActionReadiness(actor);
    if (!base.ready) return base;
    const profile = normalizeActorProfileV6(actor.profileV6, {
        actorId: actor.id,
        name: actor.name,
    });
    const commit = profile.baselineCommit;
    const verification = commit?.verification;
    const writeSet = canonicalProfileWriteSet(verification?.writeSet);
    const ownEntry = writeSet.find((entry) => entry.actorRef.actorId === actor.id);
    const mismatches = [];
    if (!verification || !writeSet.length || !ownEntry) mismatches.push('verification');
    if (verification?.writeSetDigest !== actorProfileWriteSetDigest(writeSet)) {
        mismatches.push('writeSetDigest');
    }
    if (!verification?.transactionId) {
        mismatches.push('transactionId');
    }
    if (!String(verification?.preparedLedgerDigest || '').startsWith('actor-profile-pending-v1:')) {
        mismatches.push('preparedLedgerDigest');
    }
    if (
        !ownEntry
        || ownEntry.actorRef.actorId !== actor.id
        || ownEntry.actorRef.name !== actor.name
        || ownEntry.schemaVersion !== profile.version
        || ownEntry.commitId !== commit?.commitId
        || ownEntry.profileDigest !== commit?.digest
        || JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(ownEntry.sourceRef)))
            !== JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(commit?.sourceRef)))
        || cleanText(ownEntry.scopeDigest || ownEntry.sourceRef?.scopeDigest, 180)
            !== cleanText(commit?.sourceRef?.scopeDigest, 180)
        || JSON.stringify(canonicalActorLedgerValue(ownEntry.locks || {}))
            !== JSON.stringify(canonicalActorLedgerValue(profile.locks || {}))
        || JSON.stringify(canonicalActorLedgerValue(ownEntry.manualOverrides || {}))
            !== JSON.stringify(canonicalActorLedgerValue(profile.manualOverrides || {}))
    ) mismatches.push('actorCommitEvidence');

    if (Number(verification?.version || 0) >= 2) {
        if (
            !verification.commitEvidenceDigest
            || verification.commitEvidenceDigest !== actorProfileCommitEvidenceDigest(verification)
        ) mismatches.push('commitEvidenceDigest');
    } else if (!mismatches.length) {
        // Version-1 receipts predate the compact stable evidence digest. Keep
        // their strict whole-batch proof while it still matches. If it differs
        // only because peers now carry independently valid later commits,
        // preserve this untouched actor's readiness instead of forcing a
        // destructive full-batch regeneration.
        const liveMatch = actorProfileCommitMatchesLedger(ledger, {
            actorRef: { actorId: actor.id, name: actor.name },
            schemaVersion: profile.version,
            commitId: commit?.commitId,
            digest: commit?.digest,
            phase: 'final',
        });
        if (!liveMatch.ok) {
            let changedPeerCount = 0;
            let invalidPeerEvolution = false;
            for (const entry of writeSet) {
                if (entry.actorRef.actorId === actor.id) continue;
                const peer = ledger.actors.find((candidate) => (
                    candidate.id === entry.actorRef.actorId
                ));
                const peerCommit = peer?.profileV6?.baselineCommit;
                const sameHistoricalCommit = !!peer
                    && peer.name === entry.actorRef.name
                    && peerCommit?.schemaVersion === entry.schemaVersion
                    && peerCommit?.commitId === entry.commitId
                    && peerCommit?.digest === entry.profileDigest
                    && JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(
                        peerCommit?.sourceRef,
                    ))) === JSON.stringify(canonicalActorLedgerValue(normalizeSourceRef(
                        entry.sourceRef,
                    )));
                if (sameHistoricalCommit) continue;
                if (!peer || actorProfileActionReadiness(peer).ready !== true) {
                    invalidPeerEvolution = true;
                    continue;
                }
                changedPeerCount += 1;
            }
            if (
                !changedPeerCount
                || invalidPeerEvolution
                || liveMatch.mismatches.some((entry) => entry !== 'preparedLedgerDigest')
            ) mismatches.push(...liveMatch.mismatches);
        }
    }
    const matched = { ok: mismatches.length === 0, mismatches: [...new Set(mismatches)] };
    return matched.ok
        ? { ready: true, reason: '', migrationRequired: false }
        : {
            ready: false,
            reason: 'actor_profile.ledger_verification_mismatch',
            migrationRequired: false,
            mismatches: matched.mismatches,
        };
}

export function actorProfilePendingTransactionForSource(value, {
    sourceRef = null,
    scopeDigest = '',
} = {}) {
    const ledger = normalizeActorLedger(value, { chatId: value?.chatId || '' });
    const expectedScope = cleanText(scopeDigest || sourceRef?.scopeDigest, 180);
    const matching = ledger.actors.filter((actor) => {
        const pending = actor.pendingProfile;
        return pending
            && acceptedActorSourceRefMatches(pending.sourceRef, sourceRef)
            && cleanText(pending.scopeDigest || pending.sourceRef?.scopeDigest, 180) === expectedScope;
    });
    if (!matching.length) return { present: false, valid: true, ledger };
    const first = matching[0].pendingProfile;
    const transactionId = cleanText(first.transactionId, 180);
    const writeSetDigest = cleanText(first.writeSetDigest, 180);
    const preparedLedgerDigest = cleanText(first.preparedLedgerDigest, 180);
    const preparedFieldRevision = integer(first.preparedFieldRevision, 0, Number.MAX_SAFE_INTEGER, 0);
    const writeSet = canonicalProfileWriteSet(first.writeSet);
    const reasons = [];
    if (!transactionId || !writeSetDigest || !preparedLedgerDigest || !writeSet.length) {
        reasons.push('transaction_seal_missing');
    }
    if (writeSetDigest !== actorProfileWriteSetDigest(writeSet)) reasons.push('write_set_digest');
    const expectedIds = new Set(writeSet.map((entry) => entry.actorRef.actorId));
    if (expectedIds.size !== writeSet.length || expectedIds.size !== matching.length) reasons.push('write_set_members');
    for (const actor of matching) {
        const pending = actor.pendingProfile;
        const expected = writeSet.find((entry) => entry.actorRef.actorId === actor.id);
        if (!expected || pending.transactionId !== transactionId
            || pending.writeSetDigest !== writeSetDigest
            || pending.preparedLedgerDigest !== preparedLedgerDigest
            || integer(pending.preparedFieldRevision, 0, Number.MAX_SAFE_INTEGER, 0) !== preparedFieldRevision
            || JSON.stringify(canonicalActorLedgerValue(canonicalProfileWriteSet(pending.writeSet)))
                !== JSON.stringify(canonicalActorLedgerValue(writeSet))) {
            reasons.push(`member:${actor.id}`);
        }
    }
    const projectedDigest = actorProfilePendingWriteSetDigest(ledger, writeSet, {
        preparedFieldRevision,
        transactionId,
        writeSetDigest,
    });
    if (projectedDigest !== preparedLedgerDigest) reasons.push('prepared_projection');
    const expectedTransactionId = actorProfileTransactionId({
        chatId: ledger.chatId,
        sourceRef,
        preparedFieldRevision,
        expectedCommits: writeSet,
    });
    if (transactionId !== expectedTransactionId) reasons.push('transaction_seal');
    return {
        present: true,
        valid: reasons.length === 0,
        reason: reasons[0] || '',
        reasons,
        ledger,
        transactionId,
        writeSetDigest,
        preparedLedgerDigest,
        preparedFieldRevision,
        writeSet,
        actorIds: writeSet.map((entry) => entry.actorRef.actorId),
        ledgerDigest: actorLedgerDigest(ledger),
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
    if (!canonicalProfile.designRolls && duplicateProfile.designRolls) {
        canonicalProfile.designRolls = clone(duplicateProfile.designRolls);
    }
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
    allowLegacyRegistration = false,
    currentRegistryAuthoritative = false,
    migrationTimestamp = null,
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const currentRegistryBoundary = currentRegistryAuthoritative === true
        && allowLegacyRegistration !== true
        && value?.actorRegistry
        && typeof value.actorRegistry === 'object'
        && !Array.isArray(value.actorRegistry)
        && Number(value.actorRegistry.version) >= ACTOR_REGISTRY_VERSION
        && value.actorRegistry.characters
        && typeof value.actorRegistry.characters === 'object'
        && !Array.isArray(value.actorRegistry.characters)
        && value.actorRegistry.registered
        && typeof value.actorRegistry.registered === 'object'
        && !Array.isArray(value.actorRegistry.registered);
    // normalizeActorLedger can reconstruct Registry rows for pre-Registry
    // data. A current raw Registry is an explicit boundary even when its old
    // migration marker is missing, so do not let normalization promote stray
    // ledger actors before the adapter guard runs.
    const normalizationInput = currentRegistryBoundary
        ? {
            ...clone(value),
            migrations: { ...(value?.migrations || {}), actorRegistryV1: true },
        }
        : value;
    const normalized = normalizeActorLedger(normalizationInput, {
        chatId: continuity?.chatId || value?.chatId,
        excludedActorNames,
    });
    // This export remains available to compatibility callers, but a completed
    // migration is a pure normalized read. In particular it must not refresh
    // timestamps or reinterpret later continuity as a second identity source.
    if (normalized.migrations.continuityV5 === true) return normalized;
    const ledger = repairPollutedActorIdentities(normalized);
    const persistedMigrationTimestamp = Math.max(
        integer(value?.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        integer(value?.actorRegistry?.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        integer(continuity?.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
    );
    const stableMigrationTimestamp = migrationTimestamp == null
        ? persistedMigrationTimestamp
        : integer(
            migrationTimestamp,
            0,
            Number.MAX_SAFE_INTEGER,
            persistedMigrationTimestamp,
        );
    const byId = new Map();
    const byName = new Map();
    for (const actor of ledger.actors) {
        const nameKey = actor.name.toLocaleLowerCase();
        byId.set(actor.id, actor);
        const matches = byName.get(nameKey) || [];
        matches.push(actor);
        byName.set(nameKey, matches);
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
            {
                actors: [...byId.values()],
                chatId: ledger.chatId || continuity?.chatId,
                allowCreate: allowLegacyRegistration === true,
            },
        );
        for (const ref of actorRefs) {
            const existingById = byId.get(ref.actorId);
            // Continuity is a world/event projection, not an ActorRegistry
            // writer. Only the explicit legacy adapter may reconstruct actors
            // from pre-Registry persisted continuity. Normal runtime can enrich
            // an already registered ActorRef but cannot create one here.
            if (!existingById && allowLegacyRegistration !== true) continue;
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
            const nameMatches = byName.get(nameKey) || [];
            if (!byId.has(id) && nameMatches.length > 1) continue;
            const current = byId.get(id) || nameMatches[0] || normalizeActor({
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
            const updatedNameMatches = byName.get(nameKey) || [];
            if (!updatedNameMatches.some((actor) => actor.id === current.id)) {
                updatedNameMatches.push(current);
                byName.set(nameKey, updatedNameMatches);
            }
        }
    }
    const migratedActors = [...byId.values()];
    const actorRegistry = clone(ledger.actorRegistry);
    if (allowLegacyRegistration === true) {
        for (const actor of migratedActors) {
            if (Object.values(actorRegistry.registered)
                .some((entry) => entry.actorRef.actorId === actor.id)) continue;
            const entry = registryEntryFromActor(actor, ledger.chatId || continuity?.chatId, {
                origin: 'legacy_continuity_migration',
                registeredTurn: turn,
            });
            if (entry && !actorRegistry.registered[entry.actorRef.displayName]) {
                actorRegistry.registered[entry.actorRef.displayName] = entry;
            }
        }
    }
    actorRegistry.updatedAt = Math.max(
        integer(actorRegistry.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        stableMigrationTimestamp,
    );
    return normalizeActorLedger({
        ...ledger,
        turn: Math.max(ledger.turn, turn),
        actors: migratedActors,
        actorRegistry,
        migrations: {
            ...ledger.migrations,
            continuityV5: true,
            actorLedgerV5: true,
            actorLedgerV6: true,
            actorLedgerV7: true,
            actorRefV1: true,
            actorRegistryV1: true,
        },
        updatedAt: Math.max(
            integer(ledger.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
            stableMigrationTimestamp,
        ),
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
            if (name) facts.push({
                name,
                evidence: `在场：${cleanText(raw, 180)}`,
                present: true,
                sourceKind: 'authority_input',
                identityKey: `scene:${name.toLocaleLowerCase('zh-CN')}`,
            });
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
                sourceKind: 'authority_input',
                identityKey: `act:${name.toLocaleLowerCase('zh-CN')}`,
            });
        }
    }
    return facts;
}

function structuredContentActorFacts(content) {
    const facts = [];
    let ordinal = 0;
    for (const match of String(content || '').matchAll(
        /【(?:敌方|人物|角色|NPC)(?:档案|资料|状态)[·・:：]\s*([^】]+)】/giu,
    )) {
        const name = cleanText(match[1], 160);
        if (name) facts.push({
            name,
            evidence: cleanText(match[0], 300),
            present: true,
            sourceKind: 'accepted_narrative',
            identityKey: `narrative-name:${name.toLocaleLowerCase('zh-CN')}`,
            position: match.index || 0,
            ordinal: ordinal++,
        });
    }
    for (const match of String(content || '').matchAll(/<(?:actor|npc)\b([^>]*)>/giu)) {
        const attributes = Object.fromEntries([...String(match[1] || '').matchAll(
            /([\w-]+)\s*=\s*["']([^"']+)["']/gu,
        )].map((attribute) => [attribute[1].toLocaleLowerCase(), cleanText(attribute[2], 180)]));
        const rawId = cleanText(attributes.id || attributes['actor-id'], 120);
        const name = cleanText(attributes.name || attributes['display-name'] || rawId, 160);
        if (!name) continue;
        facts.push({
            name,
            explicitActorId: isActorId(rawId) ? rawId : '',
            identityDisambiguated: Boolean(rawId),
            evidence: cleanText(match[0], 300),
            present: true,
            sourceKind: 'accepted_narrative',
            identityKey: rawId
                ? `narrative-id:${rawId.toLocaleLowerCase()}`
                : `narrative-name:${name.toLocaleLowerCase('zh-CN')}`,
            position: match.index || 0,
            ordinal: ordinal++,
        });
    }
    return facts
        .sort((left, right) => left.position - right.position || left.ordinal - right.ordinal)
        .map(({ position: _position, ordinal: _ordinal, ...fact }) => fact);
}

export function acceptedModelProfileDiscoveryFacts(content, discoveries, sourceRef = null) {
    const source = String(content || '');
    const supplied = Array.isArray(discoveries) ? discoveries : [];
    const prepared = supplied.map((entry, inputIndex) => {
        const narrativeName = entry?.candidate?.profileFormat === 'narrative-v1'
            || entry?.profileFormat === 'narrative-v1';
        const name = narrativeName
            ? String(entry?.candidateRef?.name || '').trim().slice(0, 160)
            : cleanText(entry?.candidateRef?.name, 160);
        const sourceAnchor = String(entry?.candidateRef?.sourceAnchor || '').slice(0, 1200);
        const sourceOffset = entry?.candidateRef?.sourceOffset;
        const sourceUnitOffset = entry?.candidateRef?.sourceUnitOffset;
        const sourceOrdinal = entry?.candidateRef?.sourceOrdinal;
        const coverageUnitId = cleanText(entry?.candidateRef?.coverageUnitId, 80);
        const anchorCheck = validateActorProfileDiscoveryAnchor(
            {
                name,
                sourceAnchor,
                sourceOffset: Number.isInteger(sourceOffset) ? sourceOffset : undefined,
                sourceUnitOffset: Number.isInteger(sourceUnitOffset)
                    ? sourceUnitOffset : undefined,
            },
            source,
        );
        return {
            entry,
            inputIndex,
            name,
            narrativeName,
            sourceAnchor,
            coverageUnitId,
            sourceUnitOffset: Number.isInteger(sourceUnitOffset)
                ? sourceUnitOffset : undefined,
            sourceOrdinal: Number.isInteger(sourceOrdinal) && sourceOrdinal >= 0
                ? sourceOrdinal : inputIndex,
            sourceOffset: anchorCheck.offset,
            reason: anchorCheck.ok ? '' : anchorCheck.reason,
        };
    });
    const nameCounts = new Map();
    for (const item of prepared) {
        const key = item.narrativeName ? item.name : item.name.toLocaleLowerCase('zh-CN');
        if (!key || item.reason) continue;
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    const facts = [];
    const accepted = [];
    const unresolved = [];
    for (const item of prepared) {
        const duplicateName = (nameCounts.get(
            item.narrativeName ? item.name : item.name.toLocaleLowerCase('zh-CN'),
        ) || 0) > 1;
        const reason = item.reason || (duplicateName
            ? 'actor_profile.discovery_name_duplicate'
            : '');
        if (reason) {
            unresolved.push({
                candidateRef: {
                    name: item.name,
                    sourceAnchor: item.sourceAnchor,
                    sourceOffset: item.sourceOffset,
                    sourceOrdinal: item.sourceOrdinal,
                    coverageUnitId: item.coverageUnitId,
                    sourceUnitOffset: item.sourceUnitOffset,
                },
                reason,
                inputIndex: item.inputIndex,
            });
            continue;
        }
        const acceptedIndex = accepted.length;
        const safeEntry = clone(item.entry);
        accepted.push({
            ...safeEntry,
            candidateRef: {
                name: item.name,
                sourceAnchor: item.sourceAnchor,
                sourceOffset: item.sourceOffset,
                sourceOrdinal: item.sourceOrdinal,
                coverageUnitId: item.coverageUnitId,
                sourceUnitOffset: item.sourceUnitOffset,
            },
            sourceOffset: item.sourceOffset,
            inputIndex: item.inputIndex,
        });
        facts.push({
            name: item.name,
            evidence: item.sourceAnchor,
            present: true,
            sourceKind: 'accepted_narrative',
            identityKey: `model-profile:${item.sourceOffset}:${item.name}`,
            position: item.sourceOffset,
            ordinal: item.sourceOrdinal,
            modelProfileDiscoveryIndex: acceptedIndex,
            narrativeProfile: item.narrativeName === true,
        });
    }
    facts.sort((left, right) => left.position - right.position || left.ordinal - right.ordinal);
    return { facts, accepted, unresolved };
}

export function discoverActorsFromTurnSources(value, {
    userText = '',
    acceptedContent = '',
    knownActorNames = [],
    excludedActorNames = [],
    sourceRef = null,
    turn = null,
    modelProfileDiscoveries = null,
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = normalizeActorLedger(value, { excludedActorNames });
    const currentTurn = turn === null || turn === undefined
        ? ledger.turn
        : integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const ref = normalizeSourceRef(sourceRef);
    const scene = sceneActorFacts(userText);
    const modelDiscovery = acceptedModelProfileDiscoveryFacts(
        acceptedContent,
        modelProfileDiscoveries,
        sourceRef,
    );
    const useModelProfileDiscoveries = Array.isArray(modelProfileDiscoveries);
    const facts = [
        ...actActorFacts(userText),
        ...scene.facts,
        ...(useModelProfileDiscoveries
            ? modelDiscovery.facts
            : structuredContentActorFacts(acceptedContent)),
        ...(Array.isArray(knownActorNames) ? knownActorNames : []).map((name) => ({
            name,
            evidence: `MVU人物锚点：${cleanText(name, 160)}`,
            present: false,
            sourceKind: 'mvu_anchor',
            identityKey: `mvu:${cleanText(name, 160).toLocaleLowerCase('zh-CN')}`,
        })),
    ];
    const candidates = [];
    const acceptedProfiles = [];
    const rejectedProfileIdentityReasons = new Map();
    const byKey = new Map();
    for (const [factIndex, fact] of facts.entries()) {
        const actorName = resolveActorRegistryTargetName(fact.name);
        const identityReason = Number.isInteger(fact.modelProfileDiscoveryIndex) && isActorId(actorName)
            ? 'actor_candidate.identity_internal_id'
            : classifyActorRegistryTargetName(actorName, excluded);
        if (identityReason) {
            if (Number.isInteger(fact.modelProfileDiscoveryIndex)) {
                const profileDiscovery = modelDiscovery.accepted[fact.modelProfileDiscoveryIndex];
                if (profileDiscovery) rejectedProfileIdentityReasons.set(
                    profileDiscovery.inputIndex,
                    identityReason,
                );
            }
            continue;
        }
        const sourceKind = ACTOR_CANDIDATE_SOURCES.has(fact.sourceKind)
            ? fact.sourceKind
            : 'accepted_narrative';
        const identityKey = cleanText(fact.identityKey, 300)
            || `${sourceKind}:${actorName.toLocaleLowerCase('zh-CN')}`;
        const evidence = cleanList([
            fact.evidence,
            ref ? `${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}` : '',
        ], 8, 300);
        const candidateKey = `${cleanText(fact.explicitActorId, 120)}|${identityKey}`;
        const current = byKey.get(candidateKey);
        if (current) {
            current.evidence = mergeEvidence(current.evidence, evidence, 12);
            current.present ||= fact.present === true;
            if (!current.location && fact.present) current.location = scene.location;
            continue;
        }
        const candidate = {
            kind: 'actor_candidate',
            state: 'discovered',
            candidateId: `AC-${fingerprint(JSON.stringify(fact.narrativeProfile === true
                ? [
                    canonicalActorLedgerValue(ref),
                    ref?.scopeDigest || '',
                    Number(fact.position) || 0,
                    String(fact.name || ''),
                ]
                : [ledger.chatId, ref?.messageId || '', ref?.swipeId || 0,
                    ref?.generation || 0, ref?.hash || '', identityKey, factIndex,
                ])).slice(0, 18)}`,
            chatId: ref?.chatId || ledger.chatId,
            name: actorName,
            explicitActorId: cleanText(fact.explicitActorId, 120),
            identityDisambiguated: fact.identityDisambiguated === true,
            identityKey,
            sourceKind,
            sourceRef: ref,
            evidence,
            present: fact.present === true,
            location: fact.present ? scene.location : '',
            discoveredTurn: currentTurn,
        };
        byKey.set(candidateKey, candidate);
        candidates.push(candidate);
        if (Number.isInteger(fact.modelProfileDiscoveryIndex)) {
            const profileDiscovery = modelDiscovery.accepted[fact.modelProfileDiscoveryIndex];
            if (profileDiscovery) {
                acceptedProfiles.push({
                    ...clone(profileDiscovery),
                    candidateId: candidate.candidateId,
                    sourceOffset: Number(fact.position) || 0,
                });
            }
        }
    }
    return {
        ledger,
        candidates,
        discovered: [],
        touched: [],
        location: scene.location,
        modelProfileDiscoveries: acceptedProfiles
            .sort((left, right) => (
                left.sourceOffset - right.sourceOffset
                || Number(left.candidateRef?.sourceOrdinal || 0)
                    - Number(right.candidateRef?.sourceOrdinal || 0)
            )),
        unresolved: [
            ...clone(modelDiscovery.unresolved),
            ...modelDiscovery.accepted
                .filter((entry) => !acceptedProfiles.some((accepted) => (
                    accepted.inputIndex === entry.inputIndex
                )))
                .map((entry) => ({
                    candidateRef: clone(entry.candidateRef),
                    reason: rejectedProfileIdentityReasons.get(entry.inputIndex)
                        || 'actor_candidate.identity_quarantined',
                    inputIndex: entry.inputIndex,
                })),
        ],
    };
}

function exactRegistryRows(table, claims) {
    const names = new Set(cleanList(claims, 16, 160));
    return Object.values(table || {}).filter((row) => (
        [row?.name || row?.actorRef?.displayName, ...(row?.aliases || row?.actorRef?.aliases || [])]
            .some((name) => names.has(cleanText(name, 160)))
    ));
}

function unresolvedQuarantineEntriesForActorId(ledger, actorId) {
    const id = cleanText(actorId, 120);
    if (!isActorId(id)) return [];
    return (Array.isArray(ledger?.identityQuarantine) ? ledger.identityQuarantine : [])
        .filter((entry) => (
            cleanText(entry?.reason, 160) === 'unresolved_internal_id_as_name'
            && cleanText(entry?.actor?.id, 120) === id
            && isActorId(cleanText(entry?.actor?.name, 160))
        ));
}

function explicitQuarantineRevealEntries(ledger, candidate) {
    if (
        candidate?.kind !== 'actor_candidate'
        || candidate?.state !== 'discovered'
        || candidate?.sourceKind !== 'accepted_narrative'
        || candidate?.identityDisambiguated !== true
    ) return [];
    return unresolvedQuarantineEntriesForActorId(ledger, candidate?.explicitActorId);
}

function preferredActorRegistryName(currentName, incomingName) {
    const current = resolveActorRegistryTargetName(currentName);
    const incoming = resolveActorRegistryTargetName(incomingName);
    return explicitDelimitedActorAliases(incoming).includes(current) ? incoming : current;
}

// npc_tracker registry.js applyRegistryResult, renamed for caikis first_npc.
export function applyCandidateRegistryResult(characters, result) {
    const name = resolveActorRegistryTargetName(result?.name);
    if (!name) throw new Error('actor registry candidate name is required');
    if (characters[name]) throw new Error(`actor registry candidate already exists: ${name}`);
    characters[name] = result;
    return result;
}

// npc_tracker runRegistry + caikis first_npc INSERT/UPDATE control flow.
export function runActorRegistryUpsert(value, candidates, {
    chatId = '',
    identityScopeId = '',
    scopeDigest = '',
    allowScopeDigestFill = false,
    expectedSourceRef = null,
    turn = null,
    excludedActorNames = [],
} = {}) {
    const sourceChatId = cleanText(value?.chatId, 180);
    const expectedChatId = cleanText(chatId || sourceChatId, 180);
    const expectedScopeDigest = cleanText(scopeDigest, 180);
    const persistedScopeDigest = cleanText(value?.actorRegistry?.scopeDigest, 180);
    if (sourceChatId && expectedChatId && sourceChatId !== expectedChatId) {
        return {
            ledger: normalizeActorLedger(value),
            inserted: [],
            updated: [],
            quarantined: (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
                candidateId: cleanText(candidate?.candidateId, 120),
                name: cleanText(candidate?.name, 160),
                reason: 'actor_candidate.chat_mismatch',
            })),
            changed: false,
        };
    }
    if (
        expectedScopeDigest
        && persistedScopeDigest
        && expectedScopeDigest !== persistedScopeDigest
    ) {
        return {
            ledger: normalizeActorLedger(value),
            inserted: [],
            updated: [],
            quarantined: (Array.isArray(candidates) ? candidates : []).map((candidate) => ({
                candidateId: cleanText(candidate?.candidateId, 120),
                name: cleanText(candidate?.name, 160),
                reason: 'actor_candidate.scope_digest_mismatch',
            })),
            changed: false,
        };
    }
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = normalizeActorLedger(value, {
        chatId: expectedChatId,
        identityScopeId,
        scopeDigest: expectedScopeDigest,
        allowScopeDigestFill,
        excludedActorNames,
    });
    const currentTurn = turn === null || turn === undefined
        ? ledger.turn
        : integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const registry = clone(ledger.actorRegistry);
    const inserted = [];
    const updated = [];
    const quarantined = [];
    const candidateList = Array.isArray(candidates) ? candidates : [];
    const beforeDigest = actorRegistryDigest(registry);
    for (const raw of candidateList) {
        const candidateId = cleanText(raw?.candidateId, 120);
        const name = cleanText(raw?.name, 160);
        const candidateChatId = cleanText(raw?.chatId, 180);
        const sourceKind = cleanText(raw?.sourceKind, 80);
        const sourceRef = normalizeSourceRef(raw?.sourceRef);
        const reject = (reason) => quarantined.push({ candidateId, name, reason });
        if (raw?.kind !== 'actor_candidate' || raw?.state !== 'discovered') {
            reject('actor_candidate.invalid_state');
            continue;
        }
        if (
            !expectedChatId
            || candidateChatId !== expectedChatId
            || !sourceRef
            || sourceRef.chatId !== expectedChatId
        ) {
            reject('actor_candidate.chat_mismatch');
            continue;
        }
        if (!ACTOR_CANDIDATE_SOURCES.has(sourceKind)) {
            reject('actor_candidate.source_invalid');
            continue;
        }
        if (
            !registry.identityScopeId
            || !sourceRef.identityScopeId
            || (expectedSourceRef && !acceptedActorSourceRefMatches(sourceRef, expectedSourceRef))
            || (registry.identityScopeId && sourceRef.identityScopeId !== registry.identityScopeId)
            || (Boolean(registry.scopeDigest) !== Boolean(sourceRef.scopeDigest))
            || (registry.scopeDigest && sourceRef.scopeDigest !== registry.scopeDigest)
        ) {
            reject('actor_candidate.source_ref_mismatch');
            continue;
        }
        const identityReason = isActorId(name)
            ? 'actor_candidate.identity_internal_id'
            : classifyActorRegistryTargetName(name, excluded);
        if (identityReason) {
            reject(identityReason);
            continue;
        }
        const quarantineRevealEntries = explicitQuarantineRevealEntries(ledger, raw);
        if (quarantineRevealEntries.length > 1) {
            reject('actor_candidate.identity_quarantined');
            continue;
        }
        const quarantineReveal = quarantineRevealEntries[0] || null;
        const aliases = explicitDelimitedActorAliases(name);
        const claims = [name, ...aliases];
        const candidateMatches = exactRegistryRows(registry.characters, claims);
        const registeredMatches = exactRegistryRows(registry.registered, claims);
        const matches = [...candidateMatches, ...registeredMatches];
        if (
            quarantineReveal
            && matches.some((entry) => (
                entry?.actorRef?.actorId !== quarantineReveal.actor.id
            ))
        ) {
            reject('actor_candidate.alias_conflict');
            continue;
        }
        if (matches.length > 1) {
            const conflictingActorIds = [...new Set(matches.map((item) => item.actorRef.actorId))];
            const conflict = {
                id: `IQ-${fingerprint(`${name}|${conflictingActorIds.join('|')}`).slice(0, 18)}`,
                candidateId,
                name,
                reason: 'actor_candidate.alias_conflict',
                conflictingActorIds,
                sourceRef,
                evidence: cleanList(raw.evidence, 12, 300),
                quarantinedTurn: currentTurn,
            };
            quarantined.push(conflict);
            ledger.identityQuarantine.push(conflict);
            continue;
        }
        if (registeredMatches.length === 1) {
            if (quarantineReveal) {
                reject('actor_candidate.identity_quarantined');
                continue;
            }
            const entry = registeredMatches[0];
            const previousName = entry.actorRef.displayName;
            const nextName = preferredActorRegistryName(previousName, name);
            const nextAliases = cleanList([
                ...entry.actorRef.aliases,
                previousName,
                name,
                ...aliases,
            ], 12, 160).filter((item) => item !== nextName);
            entry.actorRef = { ...entry.actorRef, displayName: nextName, aliases: nextAliases };
            entry.sourceRefs = registrySourceRefs([...entry.sourceRefs, sourceRef], expectedChatId);
            entry.updatedTurn = currentTurn;
            if (nextName !== previousName) {
                delete registry.registered[previousName];
                registry.registered[nextName] = entry;
            }
            const actor = ledger.actors.find((item) => item.id === entry.actorRef.actorId);
            if (actor) {
                actor.name = nextName;
                actor.identity.aliases = nextAliases;
                actor.evidence = mergeEvidence(actor.evidence, raw.evidence, 24);
                actor.updatedTurn = Math.max(actor.updatedTurn, currentTurn);
            }
            updated.push({ candidateId, actorRef: clone(entry.actorRef), table: 'registered' });
            continue;
        }
        if (candidateMatches.length === 1) {
            const row = candidateMatches[0];
            if (
                quarantineReveal
                && row.actorRef.actorId !== quarantineReveal.actor.id
            ) {
                reject('actor_candidate.alias_conflict');
                continue;
            }
            const previousName = row.name;
            const nextName = preferredActorRegistryName(previousName, name);
            const nextAliases = cleanList([
                ...row.aliases,
                previousName,
                name,
                ...aliases,
            ], 12, 160).filter((item) => item !== nextName);
            row.name = nextName;
            row.aliases = nextAliases;
            row.actorRef = { ...row.actorRef, displayName: nextName, aliases: nextAliases };
            row.sourceRefs = registrySourceRefs([...row.sourceRefs, sourceRef], expectedChatId);
            if (sourceKind === 'accepted_narrative') row.sourceKind = sourceKind;
            row.evidence = mergeEvidence(row.evidence, raw.evidence, 12);
            row.present ||= raw.present === true;
            if (raw.present && raw.location) row.location = cleanText(raw.location, 180);
            row.updatedTurn = currentTurn;
            if (nextName !== previousName) {
                delete registry.characters[previousName];
                registry.characters[nextName] = row;
            }
            updated.push({ candidateId, actorRef: clone(row.actorRef), table: 'characters' });
            continue;
        }

        const actorId = quarantineReveal?.actor?.id || actorIdFromScopedIdentity(name, {
            chatId: registry.identityScopeId,
            identityKey: `name:${name}`,
        });
        if (
            !actorId
            || [...Object.values(registry.characters), ...Object.values(registry.registered)]
                .some((item) => item.actorRef.actorId === actorId)
        ) {
                reject('actor_candidate.actor_ref_collision');
                continue;
        }
        const row = normalizeCandidateRegistryRow({
            candidateId,
            name,
            aliases,
            actorRef: { kind: 'actor_ref', actorId, displayName: name, aliases },
            sourceKind,
            sourceRefs: [sourceRef],
            evidence: raw.evidence,
            present: raw.present,
            location: raw.location,
            discoveredTurn: currentTurn,
            updatedTurn: currentTurn,
        }, expectedChatId);
        applyCandidateRegistryResult(registry.characters, row);
        inserted.push({ candidateId, actorRef: clone(row.actorRef), table: 'characters' });
    }
    registry.updatedAt = Date.now();
    ledger.actorRegistry = registry;
    ledger.turn = Math.max(ledger.turn, currentTurn);
    ledger.updatedAt = Date.now();
    ledger.migrations.actorRegistryV1 = true;
    const normalized = normalizeActorLedger(ledger, {
        chatId: expectedChatId,
        identityScopeId: registry.identityScopeId,
        scopeDigest: registry.scopeDigest,
        excludedActorNames,
    });
    return {
        ledger: normalized,
        inserted,
        updated,
        quarantined,
        changed: beforeDigest !== actorRegistryDigest(normalized.actorRegistry),
    };
}

// Production wiring for caikis first_npc UPDATE-only versus second_npc promotion.
export function actorCandidatesForRegistryPromotion(candidates, upsertResult) {
    const acceptedByCandidateId = new Map();
    const duplicateCandidateIds = new Set();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const candidateId = cleanText(candidate?.candidateId, 120);
        if (!candidateId || candidate?.sourceKind !== 'accepted_narrative') continue;
        if (acceptedByCandidateId.has(candidateId)) {
            duplicateCandidateIds.add(candidateId);
            acceptedByCandidateId.delete(candidateId);
            continue;
        }
        if (!duplicateCandidateIds.has(candidateId)) {
            acceptedByCandidateId.set(candidateId, candidate);
        }
    }

    const characterRows = Object.values(
        upsertResult?.ledger?.actorRegistry?.characters || {},
    );
    const selectedByStoredCandidateId = new Map();
    for (const result of [
        ...(Array.isArray(upsertResult?.inserted) ? upsertResult.inserted : []),
        ...(Array.isArray(upsertResult?.updated) ? upsertResult.updated : []),
    ]) {
        const candidateId = cleanText(result?.candidateId, 120);
        const candidate = acceptedByCandidateId.get(candidateId);
        if (result?.table !== 'characters' || !candidate) continue;
        const matchingRows = characterRows.filter((row) => (
            actorRefsMatch(row?.actorRef, result?.actorRef)
        ));
        if (matchingRows.length !== 1) continue;
        const storedCandidateId = cleanText(matchingRows[0]?.candidateId, 120);
        if (!storedCandidateId || selectedByStoredCandidateId.has(storedCandidateId)) continue;
        selectedByStoredCandidateId.set(storedCandidateId, {
            ...candidate,
            candidateId: storedCandidateId,
        });
    }
    return [...selectedByStoredCandidateId.values()];
}

// caikis second_npc INSERT ... SELECT, then DELETE first_npc.
export function promoteActorCandidatesToRegistry(value, candidates, {
    chatId = '',
    identityScopeId = '',
    scopeDigest = '',
    allowScopeDigestFill = false,
    expectedSourceRef = null,
    turn = null,
    excludedActorNames = [],
} = {}) {
    const expectedChatId = cleanText(chatId || value?.chatId, 180);
    const ledger = normalizeActorLedger(value, {
        chatId: expectedChatId,
        identityScopeId,
        scopeDigest,
        allowScopeDigestFill,
        excludedActorNames,
    });
    const registry = clone(ledger.actorRegistry);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const promoted = [];
    const discovered = [];
    const touched = [];
    const quarantined = [];
    const beforeDigest = actorRegistryDigest(registry);

    for (const raw of Array.isArray(candidates) ? candidates : []) {
        const candidateId = cleanText(raw?.candidateId, 120);
        const name = resolveActorRegistryTargetName(raw?.name);
        const sourceRef = normalizeSourceRef(raw?.sourceRef);
        if (
            !sourceRef
            || (Boolean(registry.scopeDigest) !== Boolean(sourceRef.scopeDigest))
            || (registry.scopeDigest && sourceRef.scopeDigest !== registry.scopeDigest)
            || (expectedSourceRef && !acceptedActorSourceRefMatches(sourceRef, expectedSourceRef))
        ) {
            quarantined.push({ candidateId, name, reason: 'actor_candidate.scope_digest_mismatch' });
            continue;
        }
        if (raw?.sourceKind !== 'accepted_narrative') {
            quarantined.push({ candidateId, name, reason: 'actor_candidate.promotion_not_accepted' });
            continue;
        }
        const rowsForCandidate = Object.values(registry.characters).filter((item) => (
            candidateId && item.candidateId === candidateId
        ));
        const row = rowsForCandidate.length === 1 ? rowsForCandidate[0] : null;
        if (!row) {
            quarantined.push({
                candidateId,
                name,
                reason: rowsForCandidate.length > 1
                    ? 'actor_candidate.candidate_ambiguous'
                    : 'actor_candidate.candidate_missing',
            });
            continue;
        }
        const quarantineRevealEntries = explicitQuarantineRevealEntries(ledger, raw);
        const quarantineReveal = quarantineRevealEntries.length === 1
            ? quarantineRevealEntries[0]
            : null;
        const rowQuarantineEntries = unresolvedQuarantineEntriesForActorId(
            ledger,
            row.actorRef.actorId,
        );
        if (
            quarantineRevealEntries.length > 1
            || (rowQuarantineEntries.length && !quarantineReveal)
            || (quarantineReveal && row.actorRef.actorId !== quarantineReveal.actor.id)
        ) {
            quarantined.push({
                candidateId,
                name: row.name,
                reason: 'actor_candidate.identity_quarantined',
            });
            continue;
        }
        if (
            (expectedSourceRef && !row.sourceRefs.some((ref) => (
                acceptedActorSourceRefMatches(ref, expectedSourceRef)
            )))
            || (sourceRef && !row.sourceRefs.some((ref) => acceptedActorSourceRefMatches(ref, sourceRef)))
        ) {
            quarantined.push({ candidateId, name, reason: 'actor_candidate.source_ref_mismatch' });
            continue;
        }
        const conflicts = exactRegistryRows(registry.registered, [row.name, ...row.aliases]);
        if (conflicts.length) {
            quarantined.push({ candidateId, name: row.name, reason: 'actor_candidate.alias_conflict' });
            continue;
        }
        let actor = ledger.actors.find((item) => item.id === row.actorRef.actorId);
        const restoring = !actor && Boolean(quarantineReveal);
        const created = !actor && !restoring;
        if (restoring) {
            actor = clone(quarantineReveal.actor);
            actor.name = row.name;
            actor.identity.aliases = cleanList([
                ...actor.identity.aliases.filter((item) => !isActorId(item)),
                ...row.aliases,
            ], 12, 160).filter((item) => item !== row.name);
            if (isActorId(actor.lineage.currentForm)) actor.lineage.currentForm = row.name;
            actor.evidence = mergeEvidence(actor.evidence, row.evidence, 24);
            actor.updatedTurn = Math.max(actor.updatedTurn, currentTurn);
            actor.version += 1;
            ledger.actors.push(actor);
        } else if (!actor) {
            actor = normalizeActor({
                id: row.actorRef.actorId,
                name: row.name,
                tier: row.present ? 'secondary' : 'background',
                status: 'active',
                identity: { aliases: row.aliases },
                location: {
                    name: row.location || 'unknown',
                    sinceTurn: currentTurn,
                    evidence: row.evidence,
                },
                evidence: row.evidence,
                nextActionTurn: currentTurn + 1,
                createdTurn: currentTurn,
                updatedTurn: currentTurn,
            }, ledger.actors.length, currentTurn);
            ledger.actors.push(actor);
        }
        const entry = registryEntryFromActor(actor, expectedChatId, {
            origin: row.sourceKind,
            sourceRefs: row.sourceRefs,
            registeredTurn: currentTurn,
        });
        // SELECT/COPY the candidate row into registered, then DELETE the original.
        registry.registered[entry.actorRef.displayName] = entry;
        delete registry.characters[row.name];
        if (restoring) {
            ledger.identityQuarantine = ledger.identityQuarantine
                .filter((entry) => entry !== quarantineReveal);
        }
        const actorRef = clone(entry.actorRef);
        promoted.push({ candidateId, actorRef, created, boundBy: 'candidate_copy' });
        (created ? discovered : touched).push({ actorId: actorRef.actorId, name: actorRef.displayName });
    }

    registry.updatedAt = Date.now();
    ledger.actorRegistry = registry;
    if (discovered.length) {
        ledger.observationReceipts.push({
            receiptId: `actor-registration:${fingerprint(JSON.stringify([
                expectedChatId,
                currentTurn,
                discovered.map((entry) => entry.actorId),
            ])).slice(0, 18)}`,
            kind: 'actor-registration',
            sourceRef: normalizeSourceRef(expectedSourceRef),
            actorIds: discovered.map((entry) => entry.actorId),
            settledAt: Date.now(),
        });
        ledger.observationReceipts = ledger.observationReceipts.slice(-120);
    }
    ledger.turn = Math.max(ledger.turn, currentTurn);
    ledger.updatedAt = Date.now();
    const normalized = normalizeActorLedger(ledger, {
        chatId: expectedChatId,
        identityScopeId: registry.identityScopeId,
        scopeDigest: registry.scopeDigest,
        excludedActorNames,
    });
    return {
        ledger: normalized,
        promoted,
        discovered,
        touched,
        quarantined,
        changed: beforeDigest !== actorRegistryDigest(normalized.actorRegistry),
    };
}

/**
 * Retired compatibility export.
 *
 * P1 ProfileInsertCandidate -> atomic save/readback is the only production
 * profile writer. This bounded adapter accounts for every legacy input without
 * resolving names, changing profiles, or manufacturing receipts.
 */
export function mergeActorProfilePatches(value, patches, {
    maxPatches = 8,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const inputIsArray = Array.isArray(patches);
    const inputCount = inputIsArray ? patches.length : 0;
    const limit = integer(maxPatches, 0, 24, 8);
    const processedCount = Math.min(inputCount, limit);
    const overflowCount = Math.max(0, inputCount - processedCount);
    const rejected = inputIsArray
        ? patches.slice(0, limit).map((raw, inputIndex) => ({
            actorId: cleanText(raw?.actorId, 120),
            name: cleanText(raw?.name, 160),
            inputIndex,
            reason: 'actor_profile.legacy_patch_retired',
        }))
        : [{
            actorId: '',
            inputIndex: -1,
            reason: 'actor_profile.legacy_patch_input_invalid',
        }];
    if (overflowCount > 0) {
        rejected.push({
            actorId: '',
            inputIndex: processedCount,
            startIndex: processedCount,
            count: overflowCount,
            total: inputCount,
            reason: 'actor_profile.legacy_patch_overflow',
        });
    }
    return {
        ledger,
        accepted: [],
        rejected,
        inputCount,
        processedCount,
        overflowCount,
        retired: true,
    };
}

export function mergeActorIdentityReveal(value, {
    actorId = '',
    revealedName = '',
    aliases = [],
    evidence = [],
    sourceRef = null,
    turn = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const id = cleanText(actorId, 120);
    const name = cleanText(revealedName, 160);
    if (!id || !isActorName(name)) return ledger;
    const index = ledger.actors.findIndex((actor) => (
        actor.id === id
        || actor.name === id
        || actor.identity.aliases.includes(id)
    ));
    // A reveal may UPDATE an already registered row, but cannot create or
    // restore a registered identity without the first_npc candidate path.
    if (index < 0) return ledger;
    const actor = clone(ledger.actors[index]);
    const registryEntry = Object.values(ledger.actorRegistry.registered)
        .find((entry) => entry.actorRef.actorId === actor.id);
    if (!registryEntry) return ledger;
    const previousName = actor.name;
    const nextAliases = cleanList([
        ...actor.identity.aliases,
        previousName,
        ...aliases,
    ], 12, 160).filter((item) => item !== name);
    const conflicts = exactRegistryRows(
        ledger.actorRegistry.registered,
        [name, ...nextAliases],
    ).filter((entry) => entry.actorRef.actorId !== actor.id);
    if (conflicts.length) {
        const conflictingActorIds = [
            actor.id,
            ...conflicts.map((entry) => entry.actorRef.actorId),
        ];
        const conflict = {
            id: `IQ-${fingerprint(`${name}|${conflictingActorIds.join('|')}`).slice(0, 18)}`,
            name,
            reason: 'actor_candidate.alias_conflict',
            conflictingActorIds,
            sourceRef: normalizeSourceRef(sourceRef),
            evidence: cleanList(evidence, 12, 300),
            quarantinedTurn: integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn),
        };
        if (!ledger.identityQuarantine.some((entry) => entry.id === conflict.id)) {
            ledger.identityQuarantine.push(conflict);
        }
        ledger.updatedAt = Date.now();
        return normalizeActorLedger(ledger, { chatId: ledger.chatId });
    }
    actor.name = name;
    actor.identity.aliases = nextAliases;
    actor.evidence = mergeEvidence(actor.evidence, evidence);
    actor.updatedTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    actor.version += 1;
    ledger.actors[index] = actor;
    const previousRegistryName = registryEntry.actorRef.displayName;
    registryEntry.actorRef = {
        kind: 'actor_ref',
        actorId: actor.id,
        displayName: actor.name,
        aliases: cleanList(actor.identity.aliases, 12, 160),
    };
    if (previousRegistryName !== actor.name) {
        delete ledger.actorRegistry.registered[previousRegistryName];
        ledger.actorRegistry.registered[actor.name] = registryEntry;
    }
    ledger.actorRegistry.updatedAt = Date.now();
    ledger.updatedAt = Date.now();
    return normalizeActorLedger(ledger, { chatId: ledger.chatId });
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
    if (!ref || ref.compatibilityOnly) return ledger;
    const body = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '');
    for (const match of body.matchAll(/<(?:actor|npc)\b([^>]*)>/giu)) {
        const attributes = Object.fromEntries([...String(match[1] || '').matchAll(
            /([\w-]+)\s*=\s*["']([^"']+)["']/gu,
        )].map((attribute) => [attribute[1].toLocaleLowerCase(), cleanText(attribute[2], 180)]));
        const actorId = cleanText(attributes.id || attributes['actor-id'], 120);
        const revealedName = cleanText(attributes.name || attributes['display-name'], 160);
        if (!isActorId(actorId) || !isActorName(revealedName)) continue;
        ledger = mergeActorIdentityReveal(ledger, {
            actorId,
            revealedName,
            evidence: [`${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}`],
            sourceRef: ref,
            turn: ledger.turn,
        });
    }
    const nameOwners = new Map();
    for (const actor of ledger.actors) {
        for (const name of actorNames(actor)) {
            const key = name.toLocaleLowerCase('zh-CN');
            const owners = nameOwners.get(key) || new Set();
            owners.add(actor.id);
            nameOwners.set(key, owners);
        }
    }
    for (const current of [...ledger.actors]) {
        const names = actorNames(current);
        let revealedName = '';
        for (const alias of names) {
            if ((nameOwners.get(alias.toLocaleLowerCase('zh-CN'))?.size || 0) !== 1) continue;
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
        ledger = mergeActorIdentityReveal(ledger, {
            actorId: current.id,
            revealedName,
            aliases: names,
            evidence: [`${ref.messageId}:${ref.swipeId}:${ref.generation}:${ref.hash}`],
            sourceRef: ref,
            turn: ledger.turn,
        });
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
    if (!ref || ref.compatibilityOnly) return ledger;
    const body = String(content ?? '')
        .replace(/^[\s\S]*?<content\b[^>]*>/iu, '')
        .replace(/<\/content>[\s\S]*$/iu, '');
    const nameOwners = new Map();
    for (const actor of ledger.actors) {
        for (const name of actorNames(actor)) {
            const key = name.toLocaleLowerCase('zh-CN');
            const owners = nameOwners.get(key) || new Set();
            owners.add(actor.id);
            nameOwners.set(key, owners);
        }
    }
    for (const actor of [...ledger.actors]) {
        let form = '';
        for (const name of actorNames(actor)) {
            if ((nameOwners.get(name.toLocaleLowerCase('zh-CN'))?.size || 0) !== 1) continue;
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
        const conflicts = exactRegistryRows(ledger.actorRegistry.registered, [form])
            .filter((entry) => entry.actorRef.actorId !== stable.id);
        if (conflicts.length) {
            const conflictingActorIds = [
                stable.id,
                ...conflicts.map((entry) => entry.actorRef.actorId),
            ];
            const conflict = {
                id: `IQ-${fingerprint(`${form}|${conflictingActorIds.join('|')}`).slice(0, 18)}`,
                name: form,
                reason: 'actor_candidate.alias_conflict',
                conflictingActorIds,
                sourceRef: ref,
                evidence: [evidence],
                quarantinedTurn: ledger.turn,
            };
            if (!ledger.identityQuarantine.some((entry) => entry.id === conflict.id)) {
                ledger.identityQuarantine.push(conflict);
            }
            continue;
        }
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
    if (!ref || ref.compatibilityOnly || !observers.size || !statements.length) return ledger;
    const receiptId = `actor-observation:${fingerprint(JSON.stringify([
        ref.chatId,
        ref.messageId,
        ref.swipeId,
        ref.generation,
        ref.scopeDigest,
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
    if (!ref || ref.compatibilityOnly) return ledger;
    const statements = observableStatements(content);
    const transitions = [];
    ledger.actors = ledger.actors.map((current) => {
        const actor = clone(current);
        const relevant = statements.filter((statement) => (
            actorNames(actor).some((name) => statement.includes(name))
        ));
        if (!relevant.length) return actor;
        let nextStatus = actor.status;
        const mentionWindows = actorNames(actor).flatMap((name) => {
            const windows = [];
            let from = 0;
            while (from < String(content || '').length) {
                const index = String(content || '').indexOf(name, from);
                if (index < 0) break;
                windows.push(String(content || '').slice(index, index + 900));
                from = index + Math.max(1, name.length);
            }
            return windows;
        });
        const explicitDeath = relevant.some((statement) => (
            /(?:已经|确认|当场|彻底)?(?:死亡|身亡|毙命|被杀死|咽气|尸体)/u.test(statement)
        ));
        const observedDeathSequence = mentionWindows.some((window) => (
            /(?:惨叫|呼吸|心跳|脉搏|声音).{0,160}(?:越来越微弱|停止|消失|中断).{0,80}(?:彻底)?(?:归于死寂|没有回应|停止)/su.test(window)
            || /(?:断裂的?(?:手指|肢体)|致命伤|大量失血).{0,220}(?:一条人命|死亡|身亡|毙命|归于死寂)/su.test(window)
        ));
        if (explicitDeath || observedDeathSequence) {
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
    const goalReady = actor.currentGoals.length > 0
        && actor.plan?.status === 'active'
        && actor.nextActionTurn <= turn + 1;
    const activeGoalStarved = actor.currentGoals.length > 0
        && actor.plan?.status === 'active'
        && semanticAge >= actorStarvationLimit(actor);
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
    if ((goalReady && !due) || activeGoalStarved) {
        score += 52;
        reasons.push('current-goal-due');
    }
    if (actor.longTermGoals.length && !goalReady) {
        score += 8;
        reasons.push('long-term-goal');
    }
    if (actor.lastAction && Number(actor.lastAction.turn || 0) < turn && semanticAge >= actorStarvationLimit(actor)) {
        score += 20;
        reasons.push('last-action-starved');
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

function actorActionEligibilityInLedger(ledger, actorId) {
    const id = cleanText(actorId, 120);
    const actor = ledger.actors.find((entry) => entry.id === id);
    if (!actor || !isActorId(id)) {
        return { ready: false, reason: 'actor_action.actor_missing', actor: null, actorRef: null };
    }
    if (!cleanText(ledger.actorRegistry?.scopeDigest, 180)) {
        return {
            ready: false,
            reason: 'actor_action.registry_scope_digest_missing',
            actor,
            actorRef: null,
            migrationRequired: true,
        };
    }
    const registryEntry = Object.values(ledger.actorRegistry?.registered || {})
        .find((entry) => entry?.actorRef?.actorId === id);
    if (!registryEntry) {
        return { ready: false, reason: 'actor_action.not_registered', actor, actorRef: null };
    }
    const actorRef = {
        kind: 'actor_ref',
        actorId: actor.id,
        displayName: actor.name,
        aliases: cleanList(actor.identity?.aliases, 12, 160),
    };
    if (!actorRefsMatch(registryEntry.actorRef, actorRef)) {
        return {
            ready: false,
            reason: 'actor_action.registry_ref_mismatch',
            actor,
            actorRef: clone(registryEntry.actorRef),
        };
    }
    const quarantined = (ledger.identityQuarantine || []).some((entry) => (
        cleanText(entry?.id, 120) === id
        || cleanText(entry?.actor?.id, 120) === id
    ));
    if (quarantined) {
        return {
            ready: false,
            reason: 'actor_action.identity_quarantined',
            actor,
            actorRef: clone(registryEntry.actorRef),
        };
    }
    const profileReadiness = actorProfileReadinessInLedger(ledger, actor.id);
    if (!profileReadiness.ready) {
        return {
            ready: false,
            reason: profileReadiness.reason,
            actor,
            actorRef: clone(registryEntry.actorRef),
            migrationRequired: profileReadiness.migrationRequired === true,
        };
    }
    return {
        ready: true,
        reason: '',
        actor,
        actorRef: clone(registryEntry.actorRef),
        profileAuthority: {
            schemaVersion: actor.profileV6.baselineCommit.schemaVersion,
            commitId: actor.profileV6.baselineCommit.commitId,
            digest: actor.profileV6.baselineCommit.digest,
            readbackVerified: true,
        },
    };
}

export function actorActionEligibility(value, actorId) {
    return actorActionEligibilityInLedger(normalizeActorLedger(value), actorId);
}

export function scheduleActorTurns(value, {
    turn = null,
    maxActors = null,
    explorationSlots = 1,
    excludedActorNames = [],
    requireProfileReady: _requireProfileReady = true,
} = {}) {
    const excluded = normalizeExcludedActorNames(excludedActorNames);
    const ledger = normalizeActorLedger(value, { excludedActorNames });
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const limit = maxActors === null || maxActors === undefined
        ? Number.MAX_SAFE_INTEGER
        : integer(maxActors, 0, Number.MAX_SAFE_INTEGER, 2);
    const explorationLimit = Math.min(
        limit,
        integer(explorationSlots, 0, 2, 1),
    );
    const scored = ledger.actors
        .filter((actor) => (
            isActorName(actor.name, excluded)
            && actorActionEligibilityInLedger(ledger, actor.id).ready
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
    const isMustInclude = (item) => item.reasons.some((reason) => (
        ['action-due', 'semantic-starvation', 'deadline-due', 'commitment-due', 'current-goal-due', 'last-action-starved'].includes(reason)
    ));
    // Due NPC commitments are durable world obligations, not a cosmetic
    // prompt-budget choice.  The optional budget only constrains non-due
    // exploration candidates.
    const mustInclude = scored.filter(isMustInclude);
    const coreLimit = Math.max(0, limit - explorationLimit);
    const optional = scored.filter((item) => !isMustInclude(item)).slice(0, coreLimit);
    const selected = [...mustInclude, ...optional].map((item) => ({
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
        const eligibility = actorActionEligibilityInLedger(ledger, actor.id);
        if (!eligibility.ready) {
            return {
                ...clone(proposal),
                actorId: actor.id,
                actorName: actor.name,
                actorRef: clone(eligibility.actorRef),
                actionGateFailure: eligibility.reason,
            };
        }
        const action = cleanText(proposal?.candidateAction, 700);
        const declaredIntent = cleanText(proposal?.intent, 40);
        const wait = declaredIntent === 'wait';
        const replan = declaredIntent === 'replan';
        // Routing is an explicit Advance field.  Do not infer a public/contact
        // action from prose with a keyword regexp: natural language remains
        // model-authored content, not a local semantic authority.
        const declaredContact = proposal?.contact && typeof proposal.contact === 'object'
            ? proposal.contact
            : null;
        const interactionTargets = (Array.isArray(proposal?.interactionTargets)
            ? proposal.interactionTargets
            : []).map((target) => ({
            actorId: cleanText(target?.actorId, 180),
            actorName: cleanText(target?.actorName, 160),
        })).filter((target) => target.actorId && target.actorName);
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
        const locationFrom = actor.location.name;
        const locationTo = cleanText(proposal?.location, 180) || locationFrom;
        const proposedTravelTurns = integer(proposal?.travelTurns, 0, 10_000, 0);
        const stateChanges = (Array.isArray(proposal?.stateChanges)
            ? proposal.stateChanges
            : []).map((item) => ({
            kind: cleanText(item?.kind, 80),
            summary: cleanText(item?.summary, 500),
        })).filter((item) => item.kind && item.summary);
        return {
            actorId: actor.id,
            actorName: actor.name,
            actorRef: clone(eligibility.actorRef),
            profileAuthority: clone(eligibility.profileAuthority),
            intent: wait ? 'wait' : replan ? 'replan' : 'execute',
            time: { turn: currentTurn, window: cleanText(proposal?.time, 160) || 'now' },
            location: {
                from: locationFrom,
                to: locationTo,
                travelTurns: locationTo === locationFrom
                    ? 0
                    : Math.max(1, proposedTravelTurns),
            },
            action,
            actionWindow: cleanText(proposal?.actionWindow, 180),
            expectedCost: cleanText(proposal?.expectedCost, 300),
            expectedDuration: cleanText(proposal?.expectedDuration, 180),
            expectedRisk: cleanText(proposal?.expectedRisk, 300),
            // Advance used to omit this field from its own proposal example
            // while ATT validation required it.  Preserve an explicit value
            // when present; otherwise reuse the model's proposed state trace
            // (or the action itself) as an expectation, never as an outcome.
            observableConsequence: cleanText(proposal?.observableConsequence, 500)
                || cleanText(stateChanges[0]?.summary, 500)
                || action,
            stimulusDecisions: clone(proposal?.stimulusDecisions || []),
            stateChanges,
            knowledgeRefs,
            knowledgeBasis: cleanList(proposal?.knowledgeBasis, 12, 500),
            resourceCosts: (Array.isArray(proposal?.resourceCosts)
                ? proposal.resourceCosts
                : []).map((item) => ({
                resourceId: cleanText(item?.resourceId, 100),
                amount: number(item?.amount, 0, 1_000_000_000, 0),
            })),
            capabilityUsed: cleanText(proposal?.capabilityUsed, 160),
            interactionTargets,
            contact: declaredContact && cleanText(declaredContact.mode, 80) !== 'none'
                ? {
                    mode: cleanText(declaredContact.mode, 80),
                    target: cleanText(
                        declaredContact.target || interactionTargets[0]?.actorName || '',
                        180,
                    ),
                    observableConsequence: cleanText(declaredContact.observableConsequence, 500) || action,
                }
                : null,
            planUpdate: cleanText(proposal?.currentGoal, 500),
            currentGoal: cleanText(proposal?.currentGoal, 500),
            waitCondition: wait
                ? cleanText(proposal?.waitCondition, 500) || action
                : '',
            evidence: evidence.length ? evidence : actor.evidence.slice(0, 1),
            sourceThreads: cleanList(proposal?.sourceThreads, 12, 120),
            causalChain: cleanList(proposal?.causalChain, 16, 160),
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

function registeredActorRef(ledger, actor) {
    const actorId = cleanText(actor?.id, 120);
    const entry = Object.values(ledger?.actorRegistry?.registered || {})
        .find((candidate) => cleanText(candidate?.actorRef?.actorId, 120) === actorId);
    if (!entry || cleanText(entry.actorRef?.displayName, 160) !== cleanText(actor?.name, 160)) {
        return null;
    }
    return clone(entry.actorRef);
}

function validateCandidate(ledger, actor, candidate, turn) {
    const reasons = [];
    if (!actor || cleanText(candidate?.actorId, 120) !== actor.id) {
        return ['actor-identity-mismatch'];
    }
    if (!registeredActorRef(ledger, actor)) reasons.push('actor-ref-not-registered');
    if (!actorProfileReadinessInLedger(ledger, actor.id).ready) {
        reasons.push('actor-profile-not-ready');
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
    sourceRef = null,
    target = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const currentTurn = integer(turn, 0, Number.MAX_SAFE_INTEGER, ledger.turn);
    const byId = new Map(ledger.actors.map((item) => [item.id, item]));
    const strictTarget = normalizeActorActionTarget(target || sourceRef);
    const attempts = [];
    const admittedCandidates = [];
    const rejected = [];
    for (const raw of Array.isArray(candidates) ? candidates : []) {
        const candidate = clone(raw);
        const actor = byId.get(cleanText(candidate?.actorId, 120));
        const eligibility = actorActionEligibilityInLedger(
            ledger,
            cleanText(candidate?.actorId, 120),
        );
        const reasons = [
            ...validateCandidate(ledger, actor, candidate, currentTurn),
            ...(eligibility.ready ? [] : [eligibility.reason]),
            ...(candidate?.actionGateFailure ? [cleanText(candidate.actionGateFailure, 160)] : []),
            ...(!strictTarget ? ['actor_attempt.target_missing'] : []),
        ].filter(Boolean);
        if (reasons.length) {
            rejected.push({
                actorId: cleanText(candidate?.actorId, 120),
                phase: 'admission',
                worldAdjudicated: false,
                reasons: [...new Set(reasons)],
            });
            continue;
        }
        candidate.actorRef = clone(eligibility.actorRef);
        candidate.profileAuthority = clone(eligibility.profileAuthority);
        const attempt = createActorActionAttempt(candidate, {
            actor,
            turn: currentTurn,
            actorRef: eligibility.actorRef,
            sourceRef: strictTarget,
            target: strictTarget,
            playerNames,
        });
        attempt.candidateSnapshot = clone(candidate);
        const attemptValidation = validateActorActionAttempt(attempt);
        if (!attemptValidation.valid) {
            rejected.push({
                actorId: actor.id,
                phase: 'admission',
                worldAdjudicated: false,
                reasons: [attemptValidation.reason],
            });
            continue;
        }
        attempts.push(attempt);
        admittedCandidates.push({ ...candidate, attemptId: attempt.id });
    }
    return { ledger, attempts, admittedCandidates, rejected };
}

export function recordActorActionAttempts(value, attempts, {
    target = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const expectedTarget = normalizeActorActionTarget(target);
    const recorded = [];
    const rejected = [];
    const existingByAttempt = new Map(ledger.actionAttempts
        .map((attempt) => [attempt.id, attempt]));
    for (const raw of Array.isArray(attempts) ? attempts : []) {
        const attempt = clone(raw);
        const actor = ledger.actors.find((entry) => entry.id === cleanText(attempt?.actorId, 120));
        const actorRef = registeredActorRef(ledger, actor);
        const attemptTarget = normalizeActorActionTarget(attempt?.target || attempt?.sourceRef);
        const fail = (reason) => rejected.push({
            actorId: cleanText(attempt?.actorId, 120),
            attemptId: cleanText(attempt?.id, 160),
            reason,
        });
        const validation = validateActorActionAttempt(attempt);
        const eligibility = actorActionEligibilityInLedger(ledger, attempt?.actorId);
        if (
            !validation.valid
            || !attempt?.id
            || !actor
            || !actorRef
            || !eligibility.ready
            || !actorRefsMatch(actorRef, attempt?.actorRef)
        ) {
            fail(validation.valid
                ? eligibility.reason || 'action_attempt.actor_ref_mismatch'
                : validation.reason);
            continue;
        }
        if (
            !attemptTarget
            || (expectedTarget && !actorActionTargetMatches(attemptTarget, expectedTarget))
            || attemptTarget.chatId !== ledger.chatId
        ) {
            fail('action_attempt.target_mismatch');
            continue;
        }
        const existing = existingByAttempt.get(attempt.id);
        if (existing) {
            if (
                existing.actorId !== actor.id
                || !actorRefsMatch(existing.actorRef, actorRef)
                || !actorActionTargetMatches(existing.target, attemptTarget)
                || actionAttemptFingerprint(existing) !== actionAttemptFingerprint(attempt)
            ) {
                fail('action_attempt.persisted_collision');
                continue;
            }
            const existingReceipt = ledger.actionReceipts.find((receipt) => (
                receipt.stage === 'attempted'
                && receipt.attemptId === attempt.id
                && receipt.status === 'pending_world'
            ));
            if (
                !existingReceipt
                || !actorRefsMatch(existingReceipt.actorRef, actorRef)
                || !actorActionTargetMatches(existingReceipt.target, attemptTarget)
            ) {
                fail('action_attempt.receipt_missing');
                continue;
            }
            recorded.push(attempt);
            continue;
        }
        const receipt = stageReceipt(attempt.id, actor.id, 'attempted', attempt.turn, {
            attemptId: attempt.id,
            actorRef,
            target: attemptTarget,
            summary: cleanText(attempt.action, 700),
            route: attempt.route,
            status: 'pending_world',
            worldAdjudicated: false,
            semanticProgress: false,
            playerActionSettled: false,
            playerConsentSettled: false,
            playerFeelingSettled: false,
        });
        ledger.actionReceipts.push(receipt);
        ledger.actionAttempts.push(normalizeActionAttempt(attempt));
        existingByAttempt.set(attempt.id, attempt);
        recorded.push(attempt);
    }
    const compactedAttempts = compactActionAttempts(ledger.actionAttempts);
    const compactedReceipts = compactActionReceipts(
        ledger.actionReceipts,
        compactedAttempts.attempts,
    );
    ledger.actionAttempts = compactedAttempts.attempts;
    ledger.actionReceipts = compactedReceipts.receipts;
    ledger.actionAttemptBacklog = {
        ...compactedAttempts.backlog,
        receiptProtectedCount: compactedReceipts.protectedCount,
        receiptTerminalDropped: compactedReceipts.terminalDropped,
        receiptOverCapacity: compactedReceipts.overCapacity,
    };
    if (recorded.length) ledger.updatedAt = Date.now();
    return { ledger, recorded, rejected };
}

export function actorActionAttemptsMatchLedger(value, expected = {}) {
    const ledger = normalizeActorLedger(value, { chatId: expected.chatId || value?.chatId });
    const target = normalizeActorActionTarget(expected.target);
    const mismatches = [];
    for (const attempt of Array.isArray(expected.attempts) ? expected.attempts : []) {
        const receipt = ledger.actionReceipts.find((entry) => (
            entry.stage === 'attempted'
            && entry.attemptId === attempt?.id
            && entry.status === 'pending_world'
        ));
        const journaledAttempt = ledger.actionAttempts.find((entry) => (
            entry.id === attempt?.id && entry.settlementEligible === true
        ));
        if (!receipt || !journaledAttempt) {
            mismatches.push(`attempt:${cleanText(attempt?.id, 160)}`);
            continue;
        }
        if (
            receipt.actorId !== cleanText(attempt?.actorId, 120)
            || !actorRefsMatch(receipt.actorRef, attempt?.actorRef)
            || !actorRefsMatch(journaledAttempt.actorRef, attempt?.actorRef)
            || !actorActionTargetMatches(receipt.target, attempt?.target)
            || (target && !actorActionTargetMatches(receipt.target, target))
            || actionAttemptFingerprint(journaledAttempt) !== actionAttemptFingerprint(attempt)
        ) mismatches.push(`binding:${cleanText(attempt?.id, 160)}`);
    }
    return { ok: mismatches.length === 0, mismatches };
}

export function actorActionSettlementsMatchLedger(value, expected = {}) {
    const ledger = normalizeActorLedger(value, { chatId: expected.chatId || value?.chatId });
    const target = normalizeActorActionTarget(expected.target);
    const mismatches = [];
    for (const result of Array.isArray(expected.results) ? expected.results : []) {
        const journaledAttempt = ledger.actionAttempts.find((entry) => (
            entry.id === cleanText(result?.attemptId, 160)
        ));
        const attemptReceipt = ledger.actionReceipts.find((entry) => (
            entry.stage === 'attempted'
            && entry.attemptId === cleanText(result?.attemptId, 160)
        ));
        if (!journaledAttempt || !attemptReceipt) {
            mismatches.push(`settlement:${cleanText(result?.attemptId, 160)}`);
            continue;
        }
        const expectedReceiptStatus = result?.status === 'pending_player'
            ? 'pending_player'
            : 'adjudicated';
        if (
            journaledAttempt.status !== result?.status
            || journaledAttempt.outcome !== result?.id
            || journaledAttempt.settlementEligible === true
            || fingerprint(JSON.stringify(journaledAttempt.worldAdjudicationResult))
                !== fingerprint(JSON.stringify(result))
            || attemptReceipt.status !== expectedReceiptStatus
            || attemptReceipt.resultId !== result?.id
            || attemptReceipt.worldAdjudicated !== true
            || !actorRefsMatch(journaledAttempt.actorRef, result?.actorRef)
            || !actorRefsMatch(attemptReceipt.actorRef, result?.actorRef)
            || !actorActionTargetMatches(journaledAttempt.target, target)
            || !actorActionTargetMatches(attemptReceipt.target, target)
        ) mismatches.push(`binding:${cleanText(result?.attemptId, 160)}`);
    }
    return { ok: mismatches.length === 0, mismatches };
}

export function pendingActorActionAttempts(value, {
    target = null,
} = {}) {
    const ledger = normalizeActorLedger(value);
    const expectedTarget = normalizeActorActionTarget(target);
    if (!expectedTarget) return { ledger, attempts: [], candidates: [] };
    const attempts = [];
    const candidates = [];
    for (const journaledAttempt of ledger.actionAttempts) {
        const receipt = ledger.actionReceipts.find((entry) => (
            entry.stage === 'attempted'
            && entry.status === 'pending_world'
            && entry.attemptId === journaledAttempt.id
        ));
        if (
            !receipt
            || journaledAttempt.settlementEligible !== true
            || (expectedTarget && !actorActionTargetMatches(receipt.target, expectedTarget))
        ) continue;
        const attempt = actionAttemptPayload(journaledAttempt);
        const candidate = clone(attempt.candidateSnapshot);
        const actor = ledger.actors.find((entry) => entry.id === attempt.actorId);
        const actorRef = registeredActorRef(ledger, actor);
        if (
            !candidate
            || typeof candidate !== 'object'
            || Array.isArray(candidate)
            || !actor
            || !actorRef
            || !actorActionEligibilityInLedger(ledger, actor.id).ready
            || !actorRefsMatch(actorRef, attempt.actorRef)
            || !actorRefsMatch(receipt.actorRef, attempt.actorRef)
            || !actorActionTargetMatches(journaledAttempt.target, receipt.target)
        ) continue;
        attempts.push(attempt);
        candidates.push({ ...candidate, attemptId: attempt.id });
    }
    return { ledger, attempts, candidates };
}

export function planActorAttemptRecovery(value, {
    target = null,
    scheduledActorIds = [],
} = {}) {
    const recovered = pendingActorActionAttempts(value, { target });
    const resumesPersistedAttempts = recovered.attempts.length > 0;
    const recoveredActorIds = [...new Set(
        recovered.attempts
            .map((attempt) => cleanText(attempt?.actorId, 120))
            .filter((actorId) => (
                isActorId(actorId)
                && actorActionEligibilityInLedger(recovered.ledger, actorId).ready
            )),
    )];
    const generatedActorIds = [...new Set(
        cleanList(scheduledActorIds, ACTOR_LEDGER_MAX_ACTORS, 120)
            .filter((actorId) => (
                isActorId(actorId)
                && actorActionEligibilityInLedger(recovered.ledger, actorId).ready
            )),
    )];
    const actorIds = resumesPersistedAttempts ? recoveredActorIds : generatedActorIds;
    return {
        ...recovered,
        mode: resumesPersistedAttempts ? 'resume' : 'generate',
        actorIds,
        recoveredActorIds,
        scheduledActorIds: generatedActorIds,
        shouldRunActorWorker: !resumesPersistedAttempts && actorIds.length > 0,
    };
}

export function settleActorActionCandidates(value, candidates, {
    turn = null,
    attemptedActorIds = [],
    playerNames = [],
    attempts: suppliedAttempts = [],
    target = null,
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
    const expectedTarget = normalizeActorActionTarget(target);
    const suppliedAttemptById = new Map(
        (Array.isArray(suppliedAttempts) ? suppliedAttempts : [])
            .map((attempt) => [cleanText(attempt?.id, 160), clone(attempt)])
            .filter(([attemptId]) => attemptId),
    );
    const adjudicationBatch = validateWorldAdjudicationBatch(
        worldAdjudications,
        suppliedAttempts,
    );
    const adjudicationByAttempt = new Map(
        (adjudicationBatch.valid ? adjudicationBatch.decisions : [])
            .map((entry) => [cleanText(entry?.attemptId, 160), entry])
            .filter(([attemptId]) => attemptId),
    );
    const semanticAcceptedIds = new Set();
    for (const raw of Array.isArray(candidates) ? candidates : []) {
        const requestedAttemptId = cleanText(raw?.attemptId, 160);
        const attempt = suppliedAttemptById.get(requestedAttemptId) || null;
        if (!attempt) {
            rejected.push({
                actorId: cleanText(raw?.actorId, 120),
                phase: 'settlement_admission',
                worldAdjudicated: false,
                reasons: ['action-attempt-missing'],
            });
            continue;
        }
        const candidate = clone(attempt.candidateSnapshot);
        const actor = byId.get(cleanText(attempt?.actorId, 120));
        const eligibility = actorActionEligibilityInLedger(
            ledger,
            cleanText(attempt?.actorId, 120),
        );
        const reasons = [
            ...validateCandidate(ledger, actor, candidate, currentTurn),
            ...(eligibility.ready ? [] : [eligibility.reason]),
            ...(!expectedTarget ? ['action-attempt-target-missing'] : []),
            ...(
                cleanText(raw?.actorId, 120) !== cleanText(attempt?.actorId, 120)
                || requestedAttemptId !== cleanText(attempt?.id, 160)
                    ? ['action-attempt-request-mismatch']
                    : []
            ),
        ].filter(Boolean);
        if (reasons.length) {
            rejected.push({
                actorId: cleanText(attempt?.actorId, 120),
                phase: 'settlement_admission',
                worldAdjudicated: false,
                reasons: [...new Set(reasons)],
            });
            continue;
        }
        const attemptValidation = validateActorActionAttempt(attempt);
        if (
            !attemptValidation.valid
            || !actorRefsMatch(attempt.actorRef, eligibility.actorRef)
            || cleanText(attempt.actorId, 120) !== actor.id
            || cleanText(attempt.action, 700) !== cleanText(candidate.action, 700)
            || integer(attempt.turn, 0, Number.MAX_SAFE_INTEGER, -1) !== currentTurn
        ) {
            rejected.push({
                actorId: actor.id,
                phase: 'settlement_admission',
                worldAdjudicated: false,
                reasons: [attemptValidation.valid
                    ? 'action-attempt-mismatch'
                    : attemptValidation.reason],
            });
            continue;
        }
        const persistedAttemptReceipt = ledger.actionReceipts.find((receipt) => (
            receipt.stage === 'attempted'
            && receipt.status === 'pending_world'
            && receipt.attemptId === attempt.id
        ));
        const journaledAttempt = ledger.actionAttempts.find((entry) => (
            entry.id === attempt.id && entry.settlementEligible === true
        ));
        if (
            !actorActionTargetMatches(attempt.target, expectedTarget)
            || !persistedAttemptReceipt
            || !journaledAttempt
            || !actorRefsMatch(persistedAttemptReceipt.actorRef, eligibility.actorRef)
            || !actorRefsMatch(journaledAttempt.actorRef, eligibility.actorRef)
            || !actorActionTargetMatches(persistedAttemptReceipt.target, expectedTarget)
            || !actorActionTargetMatches(journaledAttempt.target, expectedTarget)
            || actionAttemptFingerprint(journaledAttempt)
                !== actionAttemptFingerprint(attempt)
        ) {
            rejected.push({
                actorId: actor.id,
                phase: 'settlement_admission',
                worldAdjudicated: false,
                reasons: ['action-attempt-not-persisted'],
            });
            continue;
        }
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
        const appliesWorldResult = ['settled', 'partial'].includes(result.status)
            && result.worldAdjudicated === true;
        const adjudicatedDurationTurns = result.worldAdjudicated === true
            ? integer(result.durationTurns, 0, 10_000, 0)
            : integer(candidate.location.travelTurns, 0, 10_000, 0);
        if (appliesWorldResult) {
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
            for (const cost of result.resourceCosts) {
                const resource = next.resources.find(
                    (item) => item.id === cleanText(cost.resourceId, 100),
                );
                if (resource) resource.amount -= number(cost.amount, 0, resource.amount, 0);
            }
            if (
                result.appliedStateChanges.some((change) => change.kind === 'location')
                && candidate.intent === 'execute'
                && candidate.location.to !== next.location.name
            ) {
                next.location = {
                    name: cleanText(candidate.location.to, 180),
                    sinceTurn: currentTurn + adjudicatedDurationTurns,
                    evidence: mergeEvidence(next.location.evidence, candidate.evidence, 8),
                };
            }
        }
        const stateChanges = (Array.isArray(result.appliedStateChanges)
            ? result.appliedStateChanges
            : [])
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
                kind: cleanText(item.kind, 80),
                summary: cleanText(item.summary, 500),
            }))
            .filter((item) => item.kind && item.summary);
        const planWasApplied = appliesWorldResult
            && stateChanges.some((change) => change.kind === 'plan');
        const planUpdate = cleanText(candidate.planUpdate, 500);
        if (planWasApplied && planUpdate) next.plan.summary = planUpdate;
        if (planWasApplied && candidate.intent === 'wait') next.plan.status = 'blocked';
        else if (planWasApplied && candidate.intent === 'replan') next.plan.status = 'active';
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
            adjudicatedDurationTurns,
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
                actorRef: clone(attempt.actorRef || null),
                target: clone(attempt.target || null),
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
        if (adjudicated.receipt.stage === 'world_settled') {
            receipts.push({
                ...adjudicated.receipt,
                worldEventId: event?.id || '',
                observableConsequence: event?.observableConsequence || '',
                semanticProgress,
            });
        }
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
    if (results.length) {
        const resultByAttempt = new Map(results.map((result) => [result.attemptId, result]));
        ledger.actionReceipts = ledger.actionReceipts.map((receipt) => {
            const result = resultByAttempt.get(receipt.attemptId);
            if (!result || receipt.stage !== 'attempted' || receipt.status !== 'pending_world') {
                return receipt;
            }
            if (result.status === 'pending_world') return receipt;
            return {
                ...receipt,
                status: result.status === 'pending_player' ? 'pending_player' : 'adjudicated',
                resultId: result.id,
                worldAdjudicated: result.worldAdjudicated === true,
                resultSummary: result.summary,
                visibility: result.visibility,
                disclosure: result.disclosure,
                risk: result.risk,
                costs: clone(result.costs),
                durationTurns: result.durationTurns,
                observableConsequence: result.observableConsequence,
                revealPath: result.revealPath,
                adjudicatedAt: result.settledAt,
            };
        });
        ledger.actionAttempts = ledger.actionAttempts.map((attempt) => {
            const result = resultByAttempt.get(attempt.id);
            if (!result) return attempt;
            return {
                ...attempt,
                status: result.status,
                outcome: result.id,
                settlementEligible: result.status === 'pending_world',
                adjudicatedAt: result.settledAt,
                worldAdjudicationResult: clone(result),
            };
        });
    }
    const compactedAttempts = compactActionAttempts(ledger.actionAttempts);
    const compactedReceipts = compactActionReceipts(
        [...ledger.actionReceipts, ...receipts],
        compactedAttempts.attempts,
    );
    ledger.actionAttempts = compactedAttempts.attempts;
    ledger.actionReceipts = compactedReceipts.receipts;
    ledger.actionAttemptBacklog = {
        ...compactedAttempts.backlog,
        receiptProtectedCount: compactedReceipts.protectedCount,
        receiptTerminalDropped: compactedReceipts.terminalDropped,
        receiptOverCapacity: compactedReceipts.overCapacity,
    };
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
    if (!ref || ref.compatibilityOnly) return ledger;
    ledger.actionReceipts = ledger.actionReceipts.map((receipt) => {
        if (receipt.stage !== 'injected' || receipt.status !== 'pending') return receipt;
        const target = receipt.target && typeof receipt.target === 'object'
            ? receipt.target
            : null;
        if (!target || !cleanText(target.scopeDigest, 180)) return receipt;
        if (
            (target.chatId && target.chatId !== ref.chatId)
            || (target.messageId && target.messageId !== ref.messageId)
            || (target.swipeId && target.swipeId !== ref.swipeId)
            || (target.generation && target.generation !== ref.generation)
            || (target.scopeDigest && target.scopeDigest !== ref.scopeDigest)
            || (target.hash && target.hash !== ref.hash)
        ) return receipt;
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
        registryVersion: ledger.actorRegistry.version,
        registeredActorCount: Object.keys(ledger.actorRegistry.registered).length,
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
            // This is the diagnostic/export projection, not the dossier UI.
            // Never export either narrative prose or an unfinalized pending
            // profile; the detailed dossier remains inside the chat namespace.
            if (publicActor.profileV6?.profileFormat === 'narrative-v1') {
                publicActor.profileV6 = {
                    version: publicActor.profileV6.version,
                    profileFormat: 'narrative-v1',
                    coverage: publicActor.profileV6.coverage,
                    preparedForAction: publicActor.profileV6.preparedForAction === true,
                    backgroundPending: publicActor.profileV6.backgroundPending === true,
                    baselineCommit: publicActor.profileV6.baselineCommit
                        ? {
                            commitId: cleanText(publicActor.profileV6.baselineCommit.commitId, 180),
                            readbackVerified: publicActor.profileV6.baselineCommit.readbackVerified === true,
                            status: cleanText(publicActor.profileV6.baselineCommit.status, 80),
                        }
                        : null,
                };
            }
            if (publicActor.pendingProfile) {
                publicActor.pendingProfile = {
                    transactionId: cleanText(publicActor.pendingProfile.transactionId, 180),
                    readbackVerified: publicActor.pendingProfile.readbackVerified === true,
                };
            }
            return publicActor;
        }),
        attempts: clone(ledger.actionAttempts),
        receipts: clone(ledger.actionReceipts),
        observationReceipts: clone(ledger.observationReceipts),
        privateThoughtsExposed: false,
    };
}
