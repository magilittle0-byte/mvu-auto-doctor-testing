import { fingerprint } from './core.mjs';

export const ACTOR_ACTION_ROUTES = Object.freeze([
    'foreground_offer',
    'foreground_attempt',
    'background_private',
    'background_public',
]);

const ROUTE_SET = new Set(ACTOR_ACTION_ROUTES);
const WORLD_STATE_CHANGE_KINDS = new Set([
    'knowledge',
    'location',
    'plan',
    'resource',
    'relationship',
    'risk',
    'condition',
    'commitment',
    'environment',
]);
const PLAYER_SETTLEMENT = /(?:玩家|主角|user|player).{0,24}(?:接受|同意|参与|感到|觉得|支付|交出|服从|移动|到达|回答|承诺|决定)/iu;
const OFFER = /(?:邀请|请求|询问|提议|报价|递交|展示|说明|警告|劝告|尝试说服)/u;
const PUBLIC_ACTION = /(?:公告|布告|公开|广播|游行|演说|当众|市场|道路|交通|价格|舆论)/u;

export const ACTION_ATTEMPT_KIND = 'action_attempt';
export const WORLD_ADJUDICATION_RESULT_KIND = 'world_adjudication_result';

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 700) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 16, itemLimit = 300) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((entry) => cleanText(entry, itemLimit)).filter(Boolean))]
        .slice(0, limit);
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function normalizedNames(value) {
    return new Set(cleanList(value, 32, 160).map((entry) => entry.toLocaleLowerCase()));
}

function normalizeActorRef(value, fallback = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const actorId = cleanText(source.actorId || source.id || fallbackSource.actorId
        || fallbackSource.id, 120);
    const displayName = cleanText(
        source.displayName || source.name || fallbackSource.displayName || fallbackSource.name,
        160,
    );
    if (!actorId) return null;
    return {
        kind: 'actor_ref',
        actorId,
        displayName,
        aliases: cleanList(source.aliases || fallbackSource.aliases, 12, 160)
            .filter((item) => item !== displayName),
    };
}

export function actorRefsMatch(left, right) {
    if (cleanText(left?.kind, 40) !== 'actor_ref' || cleanText(right?.kind, 40) !== 'actor_ref') {
        return false;
    }
    const first = normalizeActorRef(left);
    const second = normalizeActorRef(right);
    if (!first || !second) return false;
    const firstAliases = [...new Set(first.aliases.map((entry) => entry.toLocaleLowerCase()))]
        .sort((a, b) => a.localeCompare(b));
    const secondAliases = [...new Set(second.aliases.map((entry) => entry.toLocaleLowerCase()))]
        .sort((a, b) => a.localeCompare(b));
    return first.kind === second.kind
        && first.actorId === second.actorId
        && first.displayName === second.displayName
        && JSON.stringify(firstAliases) === JSON.stringify(secondAliases);
}

function normalizeActorActionTargetInternal(value, { legacy = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const chatId = cleanText(value.chatId, 180);
    const messageId = cleanText(value.messageId, 180);
    const scopeDigest = cleanText(value.scopeDigest, 180);
    const contentHash = cleanText(value.contentHash || value.hash, 120);
    const generationId = cleanText(value.generationId, 180);
    const generationType = cleanText(value.generationType, 80);
    const generation = Number(value.generation ?? value.generationSerial);
    const swipeId = Number(value.swipeId);
    const logicalIndexValue = Number(value.logicalIndex ?? value.index);
    const hasLogicalIndex = Object.hasOwn(value, 'logicalIndex') || Object.hasOwn(value, 'index');
    if (
        !chatId
        || (!legacy && !hasLogicalIndex)
        || !messageId
        || !contentHash
        || (!legacy && !scopeDigest)
        || (!legacy && (!generationId || !generationType))
        || (!legacy && (!Number.isInteger(logicalIndexValue) || logicalIndexValue < 0))
        || (legacy && hasLogicalIndex
            && (!Number.isInteger(logicalIndexValue) || logicalIndexValue < 0))
        || !Number.isInteger(generation)
        || generation < 0
        || !Number.isInteger(swipeId)
        || swipeId < 0
    ) return null;
    const logicalIndex = hasLogicalIndex ? integer(logicalIndexValue) : 0;
    return {
        chatId,
        logicalIndex,
        index: logicalIndex,
        messageId,
        swipeId: integer(swipeId),
        generation: integer(generation),
        generationId,
        generationType,
        scopeDigest,
        contentHash,
        hash: contentHash,
        compatibilityOnly: legacy && !scopeDigest,
    };
}

export function normalizeActorActionTarget(value) {
    return normalizeActorActionTargetInternal(value, { legacy: false });
}

// Historical receipts remain readable, but this adapter is intentionally not
// used by attempt creation, adjudication validation or settlement.
export function normalizeLegacyActorActionTarget(value) {
    return normalizeActorActionTargetInternal(value, { legacy: true });
}

export function actorActionTargetMatches(left, right) {
    const first = normalizeActorActionTarget(left);
    const second = normalizeActorActionTarget(right);
    if (!first || !second) return false;
    return [
        'chatId',
        'logicalIndex',
        'messageId',
        'swipeId',
        'generation',
        'generationId',
        'generationType',
        'scopeDigest',
        'contentHash',
    ].every((field) => first[field] === second[field]);
}

function targetsPlayer(candidate, playerNames = []) {
    const names = normalizedNames(['玩家', '主角', 'user', 'player', ...playerNames]);
    const action = cleanText(candidate?.action || candidate?.candidateAction, 700).toLocaleLowerCase();
    if ([...names].some((name) => name && action.includes(name))) return true;
    return (Array.isArray(candidate?.interactionTargets) ? candidate.interactionTargets : [])
        .some((target) => names.has(cleanText(target?.actorName, 160).toLocaleLowerCase()));
}

export function routeActorActionAttempt(candidate, {
    playerNames = [],
} = {}) {
    const action = cleanText(candidate?.action || candidate?.candidateAction, 700);
    if (targetsPlayer(candidate, playerNames)) {
        return OFFER.test(action) ? 'foreground_offer' : 'foreground_attempt';
    }
    if (candidate?.contact || candidate?.foreground === true) return 'foreground_attempt';
    if (candidate?.public === true || PUBLIC_ACTION.test(action)) return 'background_public';
    return 'background_private';
}

export function createActorActionAttempt(candidate, {
    actor = null,
    turn = 0,
    sourceRef = null,
    actorRef = null,
    target = null,
    playerNames = [],
} = {}) {
    const action = cleanText(candidate?.action || candidate?.candidateAction, 700);
    const actorId = cleanText(candidate?.actorId || actor?.id, 120);
    const route = routeActorActionAttempt(candidate, { playerNames });
    const boundActorRef = normalizeActorRef(actorRef, {
        actorId,
        displayName: candidate?.actorName || actor?.name,
        aliases: actor?.identity?.aliases,
    });
    const boundTarget = normalizeActorActionTarget(target || sourceRef);
    const knowledgeRefs = cleanList(candidate?.knowledgeRefs, 24, 120);
    const knownFacts = (Array.isArray(actor?.knowledge) ? actor.knowledge : [])
        .filter((entry) => knowledgeRefs.includes(cleanText(entry?.id, 120)))
        .map((entry) => ({
            id: cleanText(entry?.id, 120),
            claim: cleanText(entry?.claim, 500),
            kind: cleanText(entry?.kind, 80),
        }))
        .filter((entry) => entry.id && entry.claim);
    const proposedResourceCosts = (Array.isArray(candidate?.resourceCosts)
        ? candidate.resourceCosts
        : []).map((entry) => ({
        resourceId: cleanText(entry?.resourceId, 100),
        amount: Math.max(0, Number(entry?.amount) || 0),
    })).filter((entry) => entry.resourceId && entry.amount > 0);
    const resourceBasis = (Array.isArray(actor?.resources) ? actor.resources : [])
        .filter((entry) => proposedResourceCosts.some(
            (cost) => cost.resourceId === cleanText(entry?.id, 100),
        ))
        .map((entry) => ({
            resourceId: cleanText(entry?.id, 100),
            availableAmount: Math.max(0, Number(entry?.amount) || 0),
        }));
    const id = `ATT-${fingerprint(JSON.stringify([
        actorId,
        turn,
        action,
        route,
        boundActorRef,
        boundTarget || sourceRef,
    ])).slice(0, 24)}`;
    return {
        kind: ACTION_ATTEMPT_KIND,
        id,
        actorId,
        actorName: cleanText(candidate?.actorName || actor?.name, 160),
        actorRef: boundActorRef,
        profileAuthority: candidate?.profileAuthority
            && typeof candidate.profileAuthority === 'object'
            ? clone(candidate.profileAuthority)
            : null,
        target: boundTarget,
        turn: integer(turn),
        timeProposal: {
            turn: integer(candidate?.time?.turn ?? turn),
            window: cleanText(candidate?.time?.window || candidate?.actionWindow, 180),
            expectedDuration: cleanText(candidate?.expectedDuration, 180),
        },
        route,
        action,
        goal: cleanText(candidate?.currentGoal || candidate?.planUpdate, 500),
        intent: ['execute', 'replan', 'wait'].includes(candidate?.intent)
            ? candidate.intent
            : 'execute',
        desiredEffects: (Array.isArray(candidate?.stateChanges)
            ? candidate.stateChanges
            : []).map((entry) => ({
            kind: cleanText(entry?.kind, 80),
            summary: cleanText(entry?.summary, 500),
        })).filter((entry) => entry.kind && entry.summary),
        // Compatibility alias. It remains a proposed effect and is never
        // applied until a bound WorldAdjudicationResult authorizes it.
        proposedStateChanges: (Array.isArray(candidate?.stateChanges)
            ? candidate.stateChanges
            : []).map((entry) => ({
            kind: cleanText(entry?.kind, 80),
            summary: cleanText(entry?.summary, 500),
        })).filter((entry) => entry.kind && entry.summary),
        resourceCosts: proposedResourceCosts,
        resourceBasis,
        capabilityUsed: cleanText(candidate?.capabilityUsed, 160),
        interactionTargets: clone(candidate?.interactionTargets || []),
        location: clone(candidate?.location || null),
        knowledgeRefs,
        knownFacts,
        knowledgeBasis: cleanList(candidate?.knowledgeBasis, 12, 500),
        expectedCost: cleanText(candidate?.expectedCost, 300),
        expectedDuration: cleanText(candidate?.expectedDuration, 180),
        expectedRisk: cleanText(candidate?.expectedRisk, 300),
        expectedObservableConsequence: cleanText(candidate?.observableConsequence, 500),
        evidence: cleanList(candidate?.evidence, 16, 300),
        sourceThreads: cleanList(candidate?.sourceThreads, 12, 120),
        causalChain: cleanList(candidate?.causalChain, 16, 160),
        candidateSnapshot: clone(candidate),
        sourceRef: clone(boundTarget || sourceRef),
        playerTargeted: targetsPlayer(candidate, playerNames),
        playerActionSettled: false,
        playerConsentSettled: false,
        playerFeelingSettled: false,
        status: 'attempted',
        outcome: null,
    };
}

// The world model receives the complete proposal contract but never the
// private persistence snapshot or compatibility-only source container.
export function actorActionAttemptWorldView(attempt) {
    return {
        kind: attempt?.kind,
        id: attempt?.id,
        actorRef: clone(attempt?.actorRef || null),
        profileAuthority: clone(attempt?.profileAuthority || null),
        target: clone(attempt?.target || null),
        turn: attempt?.turn,
        timeProposal: clone(attempt?.timeProposal || null),
        route: attempt?.route,
        actorName: attempt?.actorName,
        action: attempt?.action,
        goal: attempt?.goal,
        intent: attempt?.intent,
        desiredEffects: clone(attempt?.desiredEffects || []),
        resourceCosts: clone(attempt?.resourceCosts || []),
        resourceBasis: clone(attempt?.resourceBasis || []),
        capabilityUsed: attempt?.capabilityUsed,
        interactionTargets: clone(attempt?.interactionTargets || []),
        location: clone(attempt?.location || null),
        knowledgeRefs: clone(attempt?.knowledgeRefs || []),
        knownFacts: clone(attempt?.knownFacts || []),
        knowledgeBasis: clone(attempt?.knowledgeBasis || []),
        expectedCost: attempt?.expectedCost,
        expectedDuration: attempt?.expectedDuration,
        expectedRisk: attempt?.expectedRisk,
        expectedObservableConsequence: attempt?.expectedObservableConsequence,
        evidence: clone(attempt?.evidence || []),
        sourceThreads: clone(attempt?.sourceThreads || []),
        causalChain: clone(attempt?.causalChain || []),
        playerTargeted: attempt?.playerTargeted === true,
    };
}

export function validateActorActionAttempt(value) {
    const attempt = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (!attempt || attempt.kind !== ACTION_ATTEMPT_KIND || !cleanText(attempt.id, 160)) {
        return { valid: false, reason: 'actor_attempt.invalid' };
    }
    const actorRef = normalizeActorRef(attempt.actorRef);
    if (
        cleanText(attempt.actorRef?.kind, 40) !== 'actor_ref'
        || !actorRef
        || !actorRef.displayName
        || actorRef.actorId !== cleanText(attempt.actorId, 120)
    ) {
        return { valid: false, reason: 'actor_attempt.actor_ref_missing' };
    }
    const strictTarget = normalizeActorActionTarget(attempt.target || attempt.sourceRef);
    if (!strictTarget) {
        return { valid: false, reason: 'actor_attempt.target_missing' };
    }
    if (!ROUTE_SET.has(attempt.route) || !cleanText(attempt.action, 700)) {
        return { valid: false, reason: 'actor_attempt.action_invalid' };
    }
    if (
        !attempt.timeProposal
        || Number(attempt.timeProposal.turn) !== Number(attempt.turn)
        || !cleanText(attempt.timeProposal.window, 180)
    ) return { valid: false, reason: 'actor_attempt.time_missing' };
    if (
        !cleanText(attempt.expectedCost, 300)
        || !cleanText(attempt.expectedDuration, 180)
        || !cleanText(attempt.expectedRisk, 300)
        || !cleanText(attempt.expectedObservableConsequence, 500)
    ) return { valid: false, reason: 'actor_attempt.expectation_missing' };
    if (
        !Array.isArray(attempt.knowledgeRefs)
        || !Array.isArray(attempt.knownFacts)
        || !Array.isArray(attempt.knowledgeBasis)
        || !Array.isArray(attempt.resourceCosts)
        || !Array.isArray(attempt.resourceBasis)
        || !attempt.location
        || typeof attempt.location !== 'object'
    ) {
        return { valid: false, reason: 'actor_attempt.basis_missing' };
    }
    return { valid: true, reason: '' };
}

function availableResource(actor, resourceId) {
    return (Array.isArray(actor?.resources) ? actor.resources : [])
        .find((entry) => cleanText(entry?.id, 100) === resourceId);
}

function knownCapability(actor, capability) {
    if (!capability) return true;
    return (Array.isArray(actor?.capabilities) ? actor.capabilities : [])
        .some((entry) => cleanText(entry, 160) === capability);
}

export function validateWorldAdjudication(value, attempt) {
    const decision = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (!decision) return { valid: false, reason: 'world_adjudication_missing' };
    if (cleanText(decision.attemptId, 160) !== cleanText(attempt?.id, 160)) {
        return { valid: false, reason: 'world_adjudication_attempt_mismatch' };
    }
    const strictTarget = normalizeActorActionTarget(attempt?.target || attempt?.sourceRef);
    const decisionActorRef = normalizeActorRef(decision.actorRef);
    if (
        strictTarget && !actorRefsMatch(decision.actorRef, attempt?.actorRef)
    ) return { valid: false, reason: 'world_adjudication_actor_ref_mismatch' };
    const decisionTarget = normalizeActorActionTarget(decision.target);
    if (strictTarget && !actorActionTargetMatches(decisionTarget, strictTarget)) {
        return { valid: false, reason: 'world_adjudication_target_mismatch' };
    }
    if (containsForgedPlayerSettlement(decision)) {
        return { valid: false, reason: 'world_adjudication_player_sovereignty' };
    }
    const rawStatus = cleanText(decision.status || decision.decision, 40);
    const status = ({
        success: 'settled',
        succeeded: 'settled',
        settled: 'settled',
        partial: 'partial',
        failure: 'rejected',
        failed: 'rejected',
        rejected: 'rejected',
        delay: 'held',
        delayed: 'held',
        held: 'held',
        blocked: 'blocked',
    })[rawStatus];
    if (!status) {
        return { valid: false, reason: 'world_adjudication_status_invalid' };
    }
    const canonicalDecision = ({
        settled: 'success',
        partial: 'partial',
        rejected: 'failure',
        held: 'delayed',
        blocked: 'blocked',
    })[status];
    const durationTurns = Number(decision.durationTurns);
    const visibility = cleanText(
        decision.visibility,
        40,
    ) || (strictTarget
        ? ''
        : attempt?.route === 'background_public' ? 'public' : 'private');
    const observerActorIds = cleanList(decision.observerActorIds, 24, 120);
    const rawActualResourceCosts = Array.isArray(decision.actualResourceCosts)
        ? decision.actualResourceCosts
        : [];
    const actualResourceCosts = rawActualResourceCosts.map((entry) => ({
        resourceId: cleanText(entry?.resourceId, 100),
        amount: Math.max(0, Number(entry?.amount) || 0),
    })).filter((entry) => entry.resourceId && entry.amount > 0);
    const proposedResourceCosts = new Map((Array.isArray(attempt?.resourceCosts)
        ? attempt.resourceCosts
        : []).map((entry) => [
        cleanText(entry?.resourceId, 100),
        Math.max(0, Number(entry?.amount) || 0),
    ]));
    const resourceCostsWithinAttempt = actualResourceCosts.every((entry) => (
        proposedResourceCosts.has(entry.resourceId)
        && entry.amount <= proposedResourceCosts.get(entry.resourceId)
    ));
    const rawStateChanges = Array.isArray(decision.appliedStateChanges)
        ? decision.appliedStateChanges
        : [];
    const appliedStateChanges = rawStateChanges.filter((entry) => (
            entry && typeof entry === 'object'
            && WORLD_STATE_CHANGE_KINDS.has(cleanText(entry.kind, 80))
            && cleanText(entry.summary, 500).length >= 4
        ));
    if (
        !cleanText(decision.risk, 300)
        || !Array.isArray(decision.costs)
        || !Array.isArray(decision.actualResourceCosts)
        || decision.costs.some((entry) => (
            typeof entry !== 'string' || !cleanText(entry, 300)
        ))
        || rawStateChanges.length !== appliedStateChanges.length
        || rawActualResourceCosts.length !== actualResourceCosts.length
        || !resourceCostsWithinAttempt
        || !['public', 'private', 'observer_limited'].includes(visibility)
        || (visibility === 'observer_limited' && !observerActorIds.length)
        || (strictTarget && visibility === 'public' && !cleanText(decision.publicSummary, 700))
        || !Number.isFinite(durationTurns)
        || durationTurns < 0
        || !cleanText(decision.resultSummary, 700)
        || (['settled', 'partial'].includes(status) && !appliedStateChanges.length)
        || (
            ['settled', 'partial'].includes(status)
            && attempt?.intent !== 'wait'
            && durationTurns < 1
        )
        || !cleanText(decision.observableConsequence, 500)
        || (
            ['background_private', 'background_public'].includes(attempt?.route)
            && visibility !== 'public'
            && !cleanText(decision.revealPath, 500)
        )
    ) return { valid: false, reason: 'world_adjudication_contract_invalid' };
    return {
        valid: true,
        decision: {
            kind: WORLD_ADJUDICATION_RESULT_KIND,
            attemptId: cleanText(decision.attemptId, 160),
            actorRef: clone(decisionActorRef || attempt?.actorRef || null),
            target: clone(decisionTarget || strictTarget || null),
            status,
            decision: canonicalDecision,
            risk: cleanText(decision.risk, 300),
            costs: cleanList(decision.costs, 12, 300),
            actualResourceCosts,
            durationTurns: integer(durationTurns, 0, 10_000, 0),
            resultSummary: cleanText(decision.resultSummary, 700),
            publicSummary: cleanText(decision.publicSummary, 700),
            privateSummary: cleanText(decision.privateSummary, 700),
            visibility,
            observerActorIds,
            observableConsequence: cleanText(decision.observableConsequence, 500),
            revealPath: cleanText(decision.revealPath, 500),
            appliedStateChanges: appliedStateChanges.map((entry) => ({
                kind: cleanText(entry.kind, 80),
                summary: cleanText(entry.summary, 500),
            })),
        },
    };
}

export function validateWorldAdjudicationBatch(values, attempts) {
    const attemptList = Array.isArray(attempts) ? attempts : [];
    const attemptById = new Map(attemptList.map((attempt) => [
        cleanText(attempt?.id, 160),
        attempt,
    ]).filter(([attemptId]) => attemptId));
    const decisions = Array.isArray(values) ? values : [];
    const decisionById = new Map();
    const errors = [];
    for (const decision of decisions) {
        const attemptId = cleanText(decision?.attemptId, 160);
        if (!attemptId || !attemptById.has(attemptId)) {
            errors.push({ attemptId, reason: 'world_adjudication_unknown_attempt' });
            continue;
        }
        if (decisionById.has(attemptId)) {
            errors.push({ attemptId, reason: 'world_adjudication_duplicate_attempt' });
            continue;
        }
        decisionById.set(attemptId, decision);
    }
    const normalized = [];
    for (const attempt of attemptList) {
        const checked = validateWorldAdjudication(decisionById.get(attempt.id), attempt);
        if (!checked.valid) {
            errors.push({ attemptId: attempt.id, reason: checked.reason });
            continue;
        }
        normalized.push(checked.decision);
    }
    return {
        valid: errors.length === 0 && normalized.length === attemptList.length,
        decisions: normalized,
        errors,
    };
}

export function adjudicateActorActionAttempt(attempt, {
    actor = null,
    risk = 'ordinary',
    cost = [],
    durationTurns = 0,
    worldDecision = null,
    now = Date.now(),
} = {}) {
    const value = clone(attempt || {});
    const reasons = [];
    const attemptValidation = validateActorActionAttempt(value);
    if (!attemptValidation.valid) reasons.push(attemptValidation.reason);
    if (!knownCapability(actor, value.capabilityUsed)) reasons.push('capability_unconfirmed');
    for (const entry of value.resourceCosts || []) {
        const resource = availableResource(actor, entry.resourceId);
        if (!resource || Number(resource.amount) < Number(entry.amount)) {
            reasons.push('resource_unavailable');
        }
    }
    const playerBoundary = value.playerTargeted === true;
    const adjudication = validateWorldAdjudication(worldDecision, value);
    const outcomeStatus = reasons.length
        ? 'rejected'
        : value.intent === 'wait'
            ? 'held'
            : !adjudication.valid
                ? 'pending_world'
                : ['rejected', 'held', 'blocked'].includes(adjudication.decision.status)
                    ? adjudication.decision.status
                : playerBoundary
                    ? 'pending_player'
                    : adjudication.decision.status;
    const appliesStateChanges = ['settled', 'partial'].includes(outcomeStatus)
        && adjudication.valid;
    const playerSafeAttemptChanges = [];
    const result = {
        kind: WORLD_ADJUDICATION_RESULT_KIND,
        id: `RESULT-${fingerprint(`${value.id}|${outcomeStatus}`).slice(0, 24)}`,
        attemptId: value.id,
        actorId: value.actorId,
        actorName: value.actorName,
        actorRef: clone(value.actorRef || null),
        target: clone(value.target || null),
        turn: integer(value.turn),
        route: value.route,
        status: outcomeStatus,
        reasons: [...new Set(reasons)],
        appliedStateChanges: appliesStateChanges
            ? clone(adjudication.decision.appliedStateChanges)
            : playerSafeAttemptChanges,
        playerActionSettled: false,
        playerConsentSettled: false,
        playerFeelingSettled: false,
        visibility: adjudication.valid
            ? adjudication.decision.visibility
            : value.route.startsWith('foreground_') ? 'attempt_only' : 'hidden',
        disclosure: adjudication.valid && adjudication.decision.visibility === 'public'
            ? 'disclosed'
            : value.route.startsWith('foreground_') ? 'attempt_visible' : 'pending',
        risk: adjudication.valid
            ? adjudication.decision.risk
            : cleanText(risk, 80) || 'ordinary',
        costs: adjudication.valid ? clone(adjudication.decision.costs) : clone(cost),
        resourceCosts: appliesStateChanges
            ? clone(adjudication.decision.actualResourceCosts || [])
            : [],
        durationTurns: adjudication.valid
            ? adjudication.decision.durationTurns
            : integer(durationTurns),
        capabilityUsed: appliesStateChanges ? value.capabilityUsed : '',
        evidence: cleanList(value.evidence, 16, 300),
        settledAt: integer(now),
        summary: adjudication.valid ? adjudication.decision.resultSummary : '',
        publicSummary: adjudication.valid ? adjudication.decision.publicSummary : '',
        privateSummary: adjudication.valid ? adjudication.decision.privateSummary : '',
        observerActorIds: adjudication.valid
            ? clone(adjudication.decision.observerActorIds)
            : [],
        actualResult: adjudication.valid ? adjudication.decision.resultSummary : '',
        observableConsequence: adjudication.valid
            ? adjudication.decision.observableConsequence
            : '',
        revealPath: adjudication.valid ? adjudication.decision.revealPath : '',
        worldAdjudicated: reasons.length === 0 && adjudication.valid,
        worldAdjudicationFailure: adjudication.valid ? '' : adjudication.reason,
        historicalAbilityInvented: false,
    };
    const receipt = {
        receiptId: `AR-${fingerprint(`${result.id}|world_settled`).slice(0, 24)}`,
        actionId: value.id,
        actorId: value.actorId,
        attemptId: value.id,
        actorRef: clone(value.actorRef || null),
        target: clone(value.target || null),
        stage: reasons.length || ['pending_world', 'pending_player'].includes(outcomeStatus)
            ? 'attempted'
            : 'world_settled',
        status: outcomeStatus,
        route: value.route,
        resultId: result.id,
        visibility: result.visibility,
        disclosure: result.disclosure,
        risk: result.risk,
        costs: clone(result.costs),
        durationTurns: result.durationTurns,
        resourceCosts: clone(result.resourceCosts),
        playerActionSettled: false,
        playerConsentSettled: false,
        playerFeelingSettled: false,
        createdTurn: integer(value.turn),
        settledAt: integer(now),
        evidence: cleanList(result.evidence, 16, 300),
        resultSummary: result.summary,
        observableConsequence: result.observableConsequence,
        revealPath: result.revealPath,
        worldAdjudicated: result.worldAdjudicated,
        admissionRejected: reasons.length > 0,
    };
    return { attempt: value, result, receipt };
}

export function actorActionNarrativeInjection(attempt, result) {
    const route = ROUTE_SET.has(attempt?.route) ? attempt.route : result?.route;
    if (route === 'foreground_offer' || route === 'foreground_attempt') {
        return {
            route,
            text: cleanText(attempt?.action, 700),
            includesAttempt: true,
            includesResult: false,
            includesPlayerAction: false,
            includesPlayerConsent: false,
            includesPlayerFeeling: false,
        };
    }
    const disclosed = result?.disclosure === 'disclosed';
    return {
        route,
        text: disclosed
            ? cleanText(result?.publicSummary || result?.summary, 700)
            : '',
        includesAttempt: disclosed,
        includesResult: disclosed,
        includesPlayerAction: false,
        includesPlayerConsent: false,
        includesPlayerFeeling: false,
    };
}

export function discloseActorActionResult(result, {
    evidence = '',
    sourceRef = null,
    publicSummary = '',
    now = Date.now(),
} = {}) {
    const next = clone(result || {});
    const disclosureEvidence = cleanText(evidence, 700);
    if (!next.id || !disclosureEvidence) {
        return { result: next, disclosed: false };
    }
    next.disclosure = 'disclosed';
    next.visibility = 'observed';
    next.disclosureEvidence = disclosureEvidence;
    next.disclosureSourceRef = clone(sourceRef);
    next.publicSummary = cleanText(publicSummary, 700);
    next.disclosedAt = integer(now);
    return { result: next, disclosed: true };
}

export function worldEventFromSettledActionReceipt(receipt, {
    result = null,
} = {}) {
    if (
        receipt?.stage !== 'world_settled'
        || !['settled', 'partial'].includes(receipt?.status)
        || !receipt?.resultId
    ) return null;
    return {
        id: `EVENT-${fingerprint(`${receipt.receiptId}|${receipt.resultId}`).slice(0, 24)}`,
        sourceKind: 'settled_action_receipt',
        sourceReceiptId: cleanText(receipt.receiptId, 120),
        actorId: cleanText(receipt.actorId, 120),
        actorRef: clone(receipt.actorRef || result?.actorRef || null),
        attemptId: cleanText(receipt.attemptId || receipt.actionId, 160),
        target: clone(receipt.target || result?.target || null),
        route: cleanText(receipt.route, 80),
        visibility: cleanText(result?.visibility || receipt.visibility, 80),
        disclosure: cleanText(result?.disclosure || receipt.disclosure, 80),
        summary: cleanText(result?.publicSummary || result?.summary, 700),
        createdTurn: integer(receipt.createdTurn),
    };
}

export function independentWorldProcessEvent(value) {
    const source = value && typeof value === 'object' ? value : {};
    const summary = cleanText(source.summary, 700);
    if (!summary || !cleanText(source.processId, 120)) return null;
    return {
        id: `EVENT-${fingerprint(`${source.processId}|${source.turn}|${summary}`).slice(0, 24)}`,
        sourceKind: 'independent_world_process',
        sourceReceiptId: '',
        actorId: '',
        route: 'background_public',
        visibility: source.visibility === 'observed' ? 'observed' : 'hidden',
        disclosure: source.visibility === 'observed' ? 'disclosed' : 'pending',
        summary,
        createdTurn: integer(source.turn),
    };
}

export function containsForgedPlayerSettlement(value) {
    const serialized = JSON.stringify(value ?? {});
    return PLAYER_SETTLEMENT.test(serialized)
        || value?.playerActionSettled === true
        || value?.playerConsentSettled === true
        || value?.playerFeelingSettled === true;
}
