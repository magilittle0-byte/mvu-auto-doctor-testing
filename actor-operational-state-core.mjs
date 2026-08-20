export const ACTOR_OPERATIONAL_STATE_CORE_VERSION = 'actor-operational-state-core-v1';

function has(value, key) {
    return value && typeof value === 'object' && Object.hasOwn(value, key);
}

function bounded(value, max = 240) {
    if (Array.isArray(value)) return value.slice(0, 12).map((item) => bounded(item, max));
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).slice(0, 16).map(([key, item]) => [key, bounded(item, max)]),
    );
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    return String(value ?? '').trim().slice(0, max);
}

function exactRuntimeFacts(runtimeByActorId, actorId) {
    if (!runtimeByActorId || typeof runtimeByActorId !== 'object' || !actorId) return null;
    const facts = runtimeByActorId[actorId];
    return facts && typeof facts === 'object' ? facts : null;
}

function worldReceiptsForActor(receipts, actorId) {
    return (Array.isArray(receipts) ? receipts : [])
        .filter((receipt) => String(receipt?.actorId || '') === actorId)
        // An ATT row is an attempt until the same row has a durable world
        // settlement marker and a target/receipt identity that can be traced
        // back to the accepted source.  Generic queue states such as
        // consumed/retained are delivery states, never world outcomes.
        .filter((receipt) => receipt?.worldAdjudicated === true)
        .filter((receipt) => ['adjudicated', 'world_settled', 'world_committed', 'settled']
            .includes(String(receipt?.status || '').toLocaleLowerCase()))
        .filter((receipt) => Boolean(
            receipt?.target
            || receipt?.sourceRef
            || receipt?.receiptId
            || receipt?.id
            || receipt?.attemptId
            || receipt?.actorRef,
        ))
        .sort((left, right) => Number(right?.turn || right?.createdTurn || 0) - Number(left?.turn || left?.createdTurn || 0));
}

function latestActualReceipt(receipts, actorId) {
    return worldReceiptsForActor(receipts, actorId)[0] || null;
}

function receiptForCurrentAttempt(receipts, actorId, attemptId) {
    const id = String(attemptId || '').trim();
    if (!id) return null;
    return worldReceiptsForActor(receipts, actorId)
        .find((receipt) => receiptAttemptId(receipt) === id) || null;
}

function receiptAttemptId(receipt) {
    const direct = String(receipt?.attemptId || '').trim();
    if (direct) return direct;
    const target = receipt?.target || receipt?.sourceRef || receipt?.actorRef;
    const targeted = String(target?.attemptId || target?.id || '').trim();
    return targeted && target?.kind === 'actor_attempt' ? targeted : '';
}

function actorAttemptId(lastAction) {
    if (!lastAction || typeof lastAction !== 'object') return '';
    return String(lastAction.attemptId || lastAction.id || '').trim();
}

export function composeActorOperationalState({
    actor = {}, actorId = '', mvuRuntimeByActorId = {}, receipts = [], currentTurn = 0,
    profileEvolution = null,
    profileReady = null,
    openThreads = [],
} = {}) {
    const id = String(actorId || actor?.id || actor?.actorId || '');
    const runtime = exactRuntimeFacts(mvuRuntimeByActorId, id);
    const receipt = latestActualReceipt(receipts, id);
    const evolution = profileEvolution && typeof profileEvolution === 'object' ? profileEvolution : {};
    const current = (key) => runtime && has(runtime, key) ? runtime[key] : 'unknown/unbound';
    const sourceFor = (key) => runtime && has(runtime, key) ? 'mvu_runtime' : 'unbound';
    const fromProfile = (...keys) => keys.map((key) => evolution?.[key]).find((value) => value != null && value !== '') ?? '';
    const durableProfileReady = typeof profileReady === 'boolean'
        ? profileReady
        : actor?.status === 'active'
            && actor?.profileRef?.status === 'ready'
            && actor?.profileRef?.readbackVerified === true;
    const lastAttemptTurn = Number(actor?.lastAttemptTurn || actor?.lastAction?.turn || 0) || 0;
    const attempted = Boolean(actor?.lastAction);
    const currentAttemptId = actorAttemptId(actor?.lastAction)
        || String(actor?.lastAttemptId || '').trim();
    const currentAttemptReceipt = receiptForCurrentAttempt(receipts, id, currentAttemptId);
    // A currently pending attempt must not inherit an unrelated same-turn
    // outcome. Once its exact receipt exists, that receipt is the observable
    // action/outcome for this projection; otherwise retain the latest older
    // durable world fact without treating it as the new attempt's result.
    const effectiveReceipt = currentAttemptReceipt || receipt;
    const settledAttemptId = receiptAttemptId(currentAttemptReceipt);
    // A turn is not an identity.  If both sides carry an attempt id it must
    // match; legacy rows without a typed id remain pending (fail closed).
    const pendingAttempt = attempted && (
        !currentAttemptReceipt
        || !currentAttemptId
        || !settledAttemptId
        || currentAttemptId !== settledAttemptId
        || lastAttemptTurn > Number(currentAttemptReceipt?.turn || currentAttemptReceipt?.createdTurn || 0)
    );
    const runtimeActionable = runtime && has(runtime, 'actionable')
        ? runtime.actionable === true
        : actor?.status === 'active';
    const runtimeTurn = Number(
        runtime?.turn ?? runtime?.updatedTurn ?? runtime?.lastEffectiveChangeTurn ?? 0,
    ) || 0;
    const receiptTurn = Number(effectiveReceipt?.turn || effectiveReceipt?.createdTurn || 0) || 0;
    const actorChangeTurn = Number(actor?.lastEffectiveChangeTurn || 0) || 0;
    const lastEffectiveChangeTurn = Math.max(receiptTurn, runtimeTurn, actorChangeTurn);
    const lastEffectiveChangeSource = receiptTurn >= runtimeTurn && receiptTurn >= actorChangeTurn
        ? (receiptTurn ? 'world_receipt' : 'unbound')
        : runtimeTurn >= actorChangeTurn
            ? 'mvu_runtime'
            : actorChangeTurn ? 'legacy_observation' : 'unbound';
    const state = {
        actorId: id,
        location: current('location'),
        // A current MVU flag can restrict an already durable-ready profile,
        // but it can never promote a missing/failed strict profile gate.
        actionable: durableProfileReady && runtimeActionable,
        goal: fromProfile('goal', 'currentGoal', 'currentGoals', 'goals'),
        blocker: fromProfile('blocker', 'blockers', 'constraints', 'inactiveReason'),
        resources: current('resources'),
        injury: current('injury'),
        condition: current('condition'),
        knowledgeBoundary: fromProfile('knowledgeBoundary', 'knowledge', 'knownFacts'),
        commitments: fromProfile('commitments', 'promises'),
        relationshipStance: fromProfile('relationshipStance', 'relationships', 'relationshipEvolution'),
        lastAction: effectiveReceipt?.summary || '',
        lastOutcome: effectiveReceipt?.resultSummary || '',
        lastAttempt: bounded(actor?.lastAction, 180),
        lastAttemptId: currentAttemptId,
        settledAttemptId,
        lastAttemptTurn,
        lastAttemptPending: pendingAttempt,
        lastOutcomeStatus: effectiveReceipt ? String(effectiveReceipt?.status || '').toLowerCase() : '',
        openThreads: (Array.isArray(openThreads) ? openThreads : [])
            .filter((thread) => {
                const refs = Array.isArray(thread?.actorRefs)
                    ? thread.actorRefs.map((ref) => String(ref?.actorId || '')).filter(Boolean)
                    : [];
                const ids = Array.isArray(thread?.actorIds)
                    ? thread.actorIds.map(String)
                    : [];
                return refs.includes(id) || ids.includes(id);
            })
            .slice(0, 8)
            .map((thread) => ({ id: String(thread.id || ''), title: bounded(thread.title || thread.summary, 160), stage: String(thread.stage || '') })),
        cooldownUntilTurn: Number(actor?.nextActionTurn || 0) || 0,
        deadlineTurn: Number(actor?.deadlineTurn || 0) || 0,
        lastEffectiveChangeTurn,
        fieldSources: {
            location: sourceFor('location'),
            actionable: runtime && has(runtime, 'actionable') ? 'mvu_runtime' : 'derived_readiness',
            resources: sourceFor('resources'),
            injury: sourceFor('injury'),
            condition: sourceFor('condition'),
            lastAction: receipt ? 'world_receipt' : 'unbound',
            lastOutcome: receipt ? 'world_receipt' : 'unbound',
            lastAttempt: actor?.lastAction ? 'actor_attempt_observation' : 'unbound',
            lastAttemptId: actor?.lastAction ? 'actor_attempt_observation' : 'unbound',
            lastEffectiveChangeTurn: lastEffectiveChangeSource,
            profile: 'profile_evolution',
        },
        fieldTurns: {
            location: Number(runtime?.turn || 0) || 0,
            resources: Number(runtime?.turn || 0) || 0,
            injury: Number(runtime?.turn || 0) || 0,
            condition: Number(runtime?.turn || 0) || 0,
            lastAction: Number(effectiveReceipt?.turn || 0) || 0,
            lastOutcome: Number(effectiveReceipt?.turn || 0) || 0,
            lastAttempt: lastAttemptTurn,
            lastAttemptId: lastAttemptTurn,
            lastEffectiveChangeTurn,
        },
    };
    const boundedState = Object.fromEntries(
        Object.entries(state).map(([key, value]) => [key, bounded(value, key === 'fieldSources' || key === 'fieldTurns' ? 80 : 520)]),
    );
    boundedState.cooldownUntilTurn = Number(state.cooldownUntilTurn || 0) || 0;
    boundedState.lastAttemptPending = state.lastAttemptPending === true;
    boundedState.lastAttemptId = String(state.lastAttemptId || '');
    boundedState.settledAttemptId = String(state.settledAttemptId || '');
    return boundedState;
}

export function operationalActorEligible(state, turn = 0) {
    if (!state || state.actionable !== true) return false;
    if (Number(state.cooldownUntilTurn || 0) > Number(turn || 0)) return false;
    if (state.lastAction && state.lastOutcome === '' && Number(state.lastEffectiveChangeTurn || 0) >= Number(turn || 0)) return false;
    if (state.lastAttemptPending === true) return false;
    return true;
}

export function actorOperationalPromptProjection(state, { maxChars = 720, maxTokens = 180 } = {}) {
    const source = state || {};
    const output = {
        identity: String(source.identity || source.name || '').slice(0, 120),
        relationship: bounded(source.relationshipStance, 180),
        location: source.location === 'unknown/unbound' ? 'unknown/unbound' : bounded(source.location, 120),
        actionable: source.actionable === true,
        goal: bounded(source.goal, 180),
        blocker: bounded(source.blocker, 160),
        resources: source.resources === 'unknown/unbound' ? 'unknown/unbound' : bounded(source.resources, 180),
        injury: source.injury === 'unknown/unbound' ? 'unknown/unbound' : bounded(source.injury, 140),
        condition: source.condition === 'unknown/unbound' ? 'unknown/unbound' : bounded(source.condition, 140),
        knowledgeBoundary: bounded(source.knowledgeBoundary, 180),
        commitments: bounded(source.commitments, 160),
        lastAction: bounded(source.lastAction, 160),
        lastOutcome: bounded(source.lastOutcome, 180),
        lastAttempt: bounded(source.lastAttempt, 180),
        lastAttemptTurn: Number(source.lastAttemptTurn || 0) || 0,
        lastAttemptPending: source.lastAttemptPending === true,
        lastOutcomeStatus: bounded(source.lastOutcomeStatus, 80),
        openThreads: bounded(source.openThreads, 220),
        cooldownUntilTurn: Number(source.cooldownUntilTurn || 0),
        lastEffectiveChangeTurn: Number(source.lastEffectiveChangeTurn || 0) || 0,
    };
    const result = {};
    const charBudget = Math.max(0, Number(maxChars) || 0);
    const tokenBudget = Math.max(1, Math.floor(Number(maxTokens) || 1));
    const estimateTokens = (value) => [...String(value)].reduce(
        (sum, char) => sum + (char.charCodeAt(0) > 0x7f ? 1 : 0.25),
        0,
    );
    let usedChars = 2;
    let usedTokens = 1;
    const omitted = [];
    for (const [key, value] of Object.entries(output)) {
        const encoded = JSON.stringify(value);
        const nextChars = usedChars + key.length + encoded.length + 4;
        const nextTokens = usedTokens + estimateTokens(key) + estimateTokens(encoded) + 1;
        if (nextChars > charBudget || nextTokens > tokenBudget) {
            omitted.push(key);
            continue;
        }
        result[key] = value;
        usedChars = nextChars;
        usedTokens = nextTokens;
    }
    return { projection: result, usedChars, usedTokens, omitted };
}
