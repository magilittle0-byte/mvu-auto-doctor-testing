export interface ActorLedgerSourceRef {
    chatId: string;
    messageId: string;
    index: number;
    swipeId: number;
    generation: number;
    branchId: string;
    hash: string;
}

export interface ActorKnowledge {
    id: string;
    claim: string;
    kind: 'observed' | 'reported' | 'inferred';
    confidence: number;
    learnedTurn: number;
    sourceRef: ActorLedgerSourceRef | null;
    propagation: string[];
}

export interface ActorCandidate {
    kind: 'actor_candidate';
    state: 'discovered';
    candidateId: string;
    chatId: string;
    name: string;
    explicitActorId: string;
    identityDisambiguated: boolean;
    identityKey: string;
    sourceKind: 'accepted_narrative' | 'authority_input' | 'mvu_anchor';
    sourceRef: ActorLedgerSourceRef | null;
    evidence: string[];
    present: boolean;
    location: string;
    discoveredTurn: number;
}

export interface ActorRegistryEntry {
    actorRef: {
        kind: 'actor_ref';
        actorId: string;
        displayName: string;
        aliases: string[];
    };
    state: 'registered' | 'retired';
    origin: string;
    identityKeys: string[];
    lifecycle: { status: string; inactiveReason: string };
    lineage: Record<string, unknown>;
    sourceRefs: ActorLedgerSourceRef[];
    registeredTurn: number;
    updatedTurn: number;
}

export interface ActorRegistry {
    version: number;
    chatId: string;
    entries: ActorRegistryEntry[];
    updatedAt: number;
}

export interface ActorLedgerActor {
    id: string;
    name: string;
    tier: 'key' | 'secondary' | 'background';
    status: 'active' | 'dormant' | 'departed' | 'deceased' | 'resolved';
    inactiveReason: '' | 'sleep' | 'absence' | 'quiet';
    identity: {
        role: string;
        aliases: string[];
        traits: string[];
        desires: string[];
        boundaries: string[];
        socialStyle: string;
        decisionStyle: string;
        speechStyle: string;
        copingStyle: string;
        informationStyle: string;
        typicalMisread: string;
        relationshipDistancePattern: string;
        selfImageGap: string;
        learnedCounterDisposition: string;
        pressureResponse: string;
        recoveryPath: string;
        everydayHabits: string[];
        blindSpots: string[];
    };
    lineage: {
        rootActorId: string;
        currentForm: string;
        mergedActorIds: string[];
        forms: Array<{ name: string; turn: number; evidence: string[] }>;
    };
    longTermGoals: string[];
    currentGoals: string[];
    constraints: string[];
    stimuli: Array<{
        id: string;
        kind: 'observation' | 'opportunity' | 'risk';
        summary: string;
        sourceThreadId: string;
        status: 'unreviewed' | 'adopted' | 'ignored' | 'misread' | 'used' | 'opposed';
        observedTurn: number;
        decidedTurn: number;
        decisionReason: string;
        evidence: string[];
    }>;
    stateFacts: Array<{
        id: string;
        kind: string;
        summary: string;
        turn: number;
        evidence: string[];
    }>;
    knowledge: ActorKnowledge[];
    location: { name: string; sinceTurn: number; evidence: string[] };
    resources: Array<{ id: string; name: string; amount: number; unit: string; evidence: string[] }>;
    capabilities: string[];
    relationships: Array<{ actorId: string; summary: string; evidence: string[] }>;
    commitments: Array<{
        id: string;
        summary: string;
        dueTurn: number;
        status: 'open' | 'fulfilled' | 'broken' | 'cancelled';
        targetActorId: string;
        evidence: string[];
    }>;
    hidden: {
        emotionalInertia: string[];
        innerConflicts: string[];
        privateIntentions: string[];
    };
    plan: {
        summary: string;
        steps: string[];
        status: 'active' | 'blocked' | 'completed' | 'abandoned';
        priority: 'low' | 'normal' | 'high' | 'critical';
        nextWindow: string;
        obstacles: string[];
        costs: string[];
        alternatives: string[];
    };
    lastAction: null | { id: string; turn: number; summary: string; outcome: string };
    actionHistory: Array<Record<string, unknown>>;
    profileV6: Record<string, unknown>;
    nextActionTurn: number;
    deadlineTurn: number;
    lastSemanticTurn: number;
    semanticProgressCount: number;
    lastAttemptTurn: number;
    consecutiveActionFailures: number;
    initiative: number;
    opportunity: number;
    silenceTurns: number;
    attentionScore: number;
    evidence: string[];
    version: number;
    createdTurn: number;
    updatedTurn: number;
    settledActionCount: number;
}

export interface ActorLedger {
    version: number;
    chatId: string;
    turn: number;
    actors: ActorLedgerActor[];
    actorRegistry: ActorRegistry;
    identityQuarantine: Array<Record<string, unknown>>;
    actionAttempts: Array<Record<string, unknown>>;
    actionAttemptBacklog: {
        status: 'ok' | 'pending_over_capacity';
        pendingCount: number;
        capacity: number;
        terminalRetained: number;
        terminalDropped: number;
        pendingDropped: 0;
        receiptProtectedCount: number;
        receiptTerminalDropped: number;
        receiptOverCapacity: boolean;
    };
    actionReceipts: Array<Record<string, unknown>>;
    observationReceipts: Array<Record<string, unknown>>;
    migrations: {
        continuityV5: boolean;
        actorLedgerV2: boolean;
        actorLedgerV3: boolean;
        actorLedgerV4: boolean;
        actorLedgerV5: boolean;
        actorLedgerV6: boolean;
        actorLedgerV7: boolean;
        actorLedgerV8: boolean;
        actorProfileV6: boolean;
        actorRefV1: boolean;
        actorRegistryV1: boolean;
    };
    updatedAt: number;
}

export const ACTOR_LEDGER_VERSION: number;
export const ACTOR_REGISTRY_VERSION: number;
export const ACTOR_LEDGER_MAX_ACTORS: number;
export const ACTOR_LEDGER_MAX_RECEIPTS: number;
export const ACTOR_LEDGER_MAX_ACTION_ATTEMPTS: number;

export function emptyActorLedger(chatId?: string): ActorLedger;
export function emptyActorRegistry(chatId?: string): ActorRegistry;
export function normalizeActorRegistry(
    value: unknown,
    options?: { chatId?: string; actors?: unknown[]; migrateLegacy?: boolean },
): ActorRegistry;
export function actorRegistryDigest(value: unknown): string;
export function actorRegistryMatchesLedger(
    value: unknown,
    expected?: { chatId?: string; digest?: string; actorIds?: string[] },
): { ok: boolean; mismatches: string[] };
export function normalizeActorLedger(
    value: unknown,
    options?: { chatId?: string; maxActors?: number; excludedActorNames?: string[] },
): ActorLedger;
export function migrateActorLedgerFromContinuity(
    value: unknown,
    continuity: unknown,
    options?: { excludedActorNames?: string[]; allowLegacyRegistration?: boolean },
): ActorLedger;
export function replaceActorProfileBaselineInLedger(
    value: unknown,
    actorRef: { actorId: string; name?: string } | string,
    baseline: unknown,
    commitMeta: object,
): {
    ledger: ActorLedger;
    committed: boolean;
    reason?: string;
    actorId?: string;
    commit?: Record<string, unknown>;
};
export function actorProfileCommitMatchesLedger(
    value: unknown,
    expected: object,
): { ok: boolean; mismatches: string[] };
export function discoverActorsFromTurnSources(
    value: unknown,
    options?: {
        userText?: string;
        acceptedContent?: string;
        knownActorNames?: string[];
        excludedActorNames?: string[];
        sourceRef?: ActorLedgerSourceRef | null;
        turn?: number | null;
    },
): {
    ledger: ActorLedger;
    candidates: ActorCandidate[];
    discovered: Array<{ actorId: string; name: string }>;
    touched: Array<{ actorId: string; name: string }>;
    location: string;
};
export function promoteActorCandidatesToRegistry(
    value: unknown,
    candidates: ActorCandidate[],
    options?: { chatId?: string; turn?: number | null; excludedActorNames?: string[] },
): {
    ledger: ActorLedger;
    promoted: Array<Record<string, unknown>>;
    discovered: Array<{ actorId: string; name: string }>;
    touched: Array<{ actorId: string; name: string }>;
    quarantined: Array<{ candidateId: string; name: string; reason: string }>;
    changed: boolean;
};
export function mergeActorProfilePatches(
    value: unknown,
    patches: unknown[],
    options?: {
        turn?: number | null;
        sourceRef?: ActorLedgerSourceRef | null;
        maxPatches?: number;
        evidenceCorpus?: string;
        mergeMode?: 'append' | 'consolidate';
    },
): {
    ledger: ActorLedger;
    accepted: Array<{ actorId: string; name: string; evidence: string[] }>;
    rejected: Array<{ actorId: string; name?: string; reason: string }>;
};
export function mergeActorIdentityReveal(
    value: unknown,
    options: {
        actorId: string;
        revealedName: string;
        aliases?: string[];
        evidence?: string[];
        turn?: number | null;
    },
): ActorLedger;
export function reconcileActorIdentityRevealsFromAcceptedContent(
    value: unknown,
    options?: { content?: string; sourceRef?: ActorLedgerSourceRef | null },
): ActorLedger;
export function reconcileActorMutationLineageFromAcceptedContent(
    value: unknown,
    options?: { content?: string; sourceRef?: ActorLedgerSourceRef | null },
): ActorLedger;
export function reconcileActorLifecycleFromAcceptedContent(
    value: unknown,
    options?: { content?: string; sourceRef?: ActorLedgerSourceRef | null },
): ActorLedger;
export function applyAcceptedContentObservations(
    value: unknown,
    options?: {
        content?: string;
        sourceRef?: ActorLedgerSourceRef | null;
        observerActorIds?: string[];
    },
): ActorLedger;
export function inferObserverActorIds(value: unknown, content: string): string[];
export function scheduleActorTurns(
    value: unknown,
    options?: {
        turn?: number | null;
        maxActors?: number;
        explorationSlots?: number;
        excludedActorNames?: string[];
        requireProfileReady?: boolean;
    },
): {
    turn: number;
    selected: Array<{
        actorId: string;
        actorName: string;
        slot: 'priority' | 'exploration';
        score: number;
        reasons: string[];
    }>;
    deferredActorIds: string[];
};
export function actorActionCandidatesFromShard(
    value: unknown,
    proposals: unknown[],
    options?: { turn?: number | null; collisionIntensity?: number },
): unknown[];
export function prepareActorActionAttempts(
    value: unknown,
    candidates: unknown[],
    options?: {
        turn?: number | null;
        playerNames?: string[];
        sourceRef?: ActorLedgerSourceRef | null;
        target?: Record<string, unknown> | null;
    },
): {
    ledger: ActorLedger;
    admittedCandidates: unknown[];
    attempts: unknown[];
    rejected: Array<{ actorId: string; reasons: string[] }>;
};
export function actorActionEligibility(value: unknown, actorId: string): {
    ready: boolean;
    reason: string;
    actor: ActorLedgerActor | null;
    actorRef: Record<string, unknown> | null;
    migrationRequired?: boolean;
    profileAuthority?: Record<string, unknown>;
};
export function recordActorActionAttempts(
    value: unknown,
    attempts: unknown[],
    options?: { target?: Record<string, unknown> | null },
): {
    ledger: ActorLedger;
    recorded: unknown[];
    rejected: Array<{ actorId: string; attemptId: string; reason: string }>;
};
export function actorActionAttemptsMatchLedger(
    value: unknown,
    expected?: {
        chatId?: string;
        target?: Record<string, unknown> | null;
        attempts?: unknown[];
    },
): { ok: boolean; mismatches: string[] };
export function actorActionSettlementsMatchLedger(
    value: unknown,
    expected?: {
        chatId?: string;
        target?: Record<string, unknown> | null;
        results?: unknown[];
    },
): { ok: boolean; mismatches: string[] };
export function pendingActorActionAttempts(
    value: unknown,
    options?: { target?: Record<string, unknown> | null },
): { ledger: ActorLedger; attempts: unknown[]; candidates: unknown[] };
export function planActorAttemptRecovery(
    value: unknown,
    options?: {
        target?: Record<string, unknown> | null;
        scheduledActorIds?: string[];
    },
): {
    ledger: ActorLedger;
    attempts: unknown[];
    candidates: unknown[];
    mode: 'resume' | 'generate';
    actorIds: string[];
    recoveredActorIds: string[];
    scheduledActorIds: string[];
    shouldRunActorWorker: boolean;
};
export function settleActorActionCandidates(
    value: unknown,
    candidates: unknown[],
    options?: {
        turn?: number | null;
        attemptedActorIds?: string[];
        playerNames?: string[];
        attempts?: unknown[];
        target?: Record<string, unknown> | null;
        worldAdjudications?: unknown[];
    },
): {
    ledger: ActorLedger;
    accepted: unknown[];
    rejected: Array<{ actorId: string; reasons: string[] }>;
    worldEvents: unknown[];
    receipts: unknown[];
    attempts: unknown[];
    results: unknown[];
    pendingWorld: unknown[];
    technicalFailures: unknown[];
};
export function mergeActorWorldEventsIntoContinuity(
    continuity: unknown,
    worldEvents: unknown[],
): unknown;
export function settleActorInjectionReceipts(
    value: unknown,
    options?: { content?: string; sourceRef?: ActorLedgerSourceRef | null },
): ActorLedger;
export function actorLedgerView(value: unknown): {
    version: number;
    turn: number;
    actorCount: number;
    registryVersion: number;
    registeredActorCount: number;
    activeCount: number;
    dormantCount: number;
    semanticProgressCount: number;
    maxSemanticSilence: number;
    stalledDueCount: number;
    consecutiveFailureCount: number;
    actors: Array<Omit<ActorLedgerActor, 'hidden'>>;
    attempts: unknown[];
    receipts: unknown[];
    observationReceipts: unknown[];
    privateThoughtsExposed: false;
};
