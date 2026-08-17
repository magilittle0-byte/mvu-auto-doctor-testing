export interface ActorLedgerSourceRef {
    chatId: string;
    messageId: string;
    logicalIndex: number;
    index: number;
    swipeId: number;
    generation: number;
    generationSerial: number;
    generationId: string;
    generationType: string;
    identityScopeId: string;
    scopeDigest: string;
    hash: string;
    contentHash: string;
    contentFingerprint: string;
    compatibilityOnly?: boolean;
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
    origin: string;
    sourceRefs: ActorLedgerSourceRef[];
    registeredTurn: number;
    updatedTurn: number;
}

export interface ActorRegistryCandidateRow {
    kind: 'actor_candidate';
    candidateId: string;
    name: string;
    aliases: string[];
    actorRef: ActorRegistryEntry['actorRef'];
    sourceKind: ActorCandidate['sourceKind'];
    sourceRefs: ActorLedgerSourceRef[];
    evidence: string[];
    present: boolean;
    location: string;
    discoveredTurn: number;
    updatedTurn: number;
}

export interface ActorRegistry {
    version: number;
    chatId: string;
    identityScopeId: string;
    scopeDigest: string;
    characters: Record<string, ActorRegistryCandidateRow>;
    registered: Record<string, ActorRegistryEntry>;
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
    pendingProfile?: Record<string, unknown> | null;
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
export function emptyActorRegistry(chatId?: string, identityScopeId?: string, scopeDigest?: string): ActorRegistry;
export function explicitDelimitedActorAliases(value: unknown): string[];
export function resolveActorRegistryTargetName(value: unknown): string;
export function classifyActorRegistryTargetName(
    value: unknown,
    excludedActorNames?: string[] | Set<string>,
): string;
export function acceptedActorSourceRefMatches(
    value: unknown,
    expected: unknown,
    options?: { allowLegacyReadOnly?: boolean },
): boolean;
export function normalizeActorRegistry(
    value: unknown,
    options?: {
        chatId?: string;
        identityScopeId?: string;
        scopeDigest?: string;
        allowScopeDigestFill?: boolean;
        actors?: unknown[];
        migrateLegacy?: boolean;
    },
): ActorRegistry;
export function actorRegistryDigest(value: unknown): string;
export function actorRegistryMatchesLedger(
    value: unknown,
    expected?: { chatId?: string; scopeDigest?: string; digest?: string; actorIds?: string[] },
): { ok: boolean; mismatches: string[] };
export function parseRegisteredActorGateNames(result: unknown, registeredSet: Set<string> | string[]): string[];
export function runRegisteredActorGate(
    value: unknown,
    candidateNames: string[],
): { ok: true; names: string[]; actorRefs: ActorRegistryEntry['actorRef'][] };
export function normalizeActorLedger(
    value: unknown,
    options?: {
        chatId?: string;
        identityScopeId?: string;
        scopeDigest?: string;
        allowScopeDigestFill?: boolean;
        maxActors?: number;
        excludedActorNames?: string[];
    },
): ActorLedger;
export function migrateActorLedgerFromContinuity(
    value: unknown,
    continuity: unknown,
    options?: {
        excludedActorNames?: string[];
        allowLegacyRegistration?: boolean;
        currentRegistryAuthoritative?: boolean;
        migrationTimestamp?: number | null;
    },
): ActorLedger;
export function actorLedgerDigest(value: unknown): string;
export function actorProfilePendingWriteSetProjection(
    value: unknown,
    expectedCommits: unknown[],
    options?: { preparedFieldRevision?: number; transactionId?: string; writeSetDigest?: string },
): Record<string, unknown>;
export function actorProfilePendingWriteSetDigest(
    value: unknown,
    expectedCommits: unknown[],
    options?: { preparedFieldRevision?: number; transactionId?: string; writeSetDigest?: string },
): string;
export function actorProfileWriteSetDigest(expectedCommits: unknown[]): string;
export function actorProfileCommitEvidenceDigest(value?: unknown): string;
export function actorProfileTransactionId(options?: {
    chatId?: string;
    sourceRef?: ActorLedgerSourceRef | null;
    preparedFieldRevision?: number;
    expectedCommits?: unknown[];
}): string;
export function sealActorProfilePendingTransactionInLedger(
    value: unknown,
    expectedCommits: unknown[],
    options?: { transactionId?: string; preparedFieldRevision?: number },
): {
    ledger: ActorLedger;
    sealed: boolean;
    reason?: string;
    transactionId?: string;
    writeSetDigest?: string;
    preparedLedgerDigest?: string;
    preparedFieldRevision?: number;
    writeSet?: Array<Record<string, unknown>>;
};
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
export function finalizeActorProfileBaselinesInLedger(
    value: unknown,
    expectedCommits: unknown[],
    options: {
        preparedLedgerDigest: string;
        preparedFieldRevision: number;
        transactionId?: string;
        writeSetDigest?: string;
    },
): {
    ledger: ActorLedger;
    finalized: boolean;
    reason?: string;
    preparedLedgerDigest?: string;
    preparedFieldRevision?: number;
    transactionId?: string;
    writeSetDigest?: string;
    writeSet?: Array<Record<string, unknown>>;
};
export function actorProfileReadinessInLedger(
    value: unknown,
    actorId: string,
): { ready: boolean; reason: string; migrationRequired?: boolean; mismatches?: string[] };
export function actorProfilePendingTransactionForSource(
    value: unknown,
    options?: { sourceRef?: ActorLedgerSourceRef | null; scopeDigest?: string },
): {
    present: boolean;
    valid: boolean;
    reason?: string;
    reasons?: string[];
    ledger: ActorLedger;
    transactionId?: string;
    writeSetDigest?: string;
    preparedLedgerDigest?: string;
    preparedFieldRevision?: number;
    writeSet?: Array<Record<string, unknown>>;
    actorIds?: string[];
    ledgerDigest?: string;
};
export function acceptedModelProfileDiscoveryFacts(
    content: string,
    discoveries: Array<Record<string, unknown>>,
    sourceRef?: ActorLedgerSourceRef | null,
): {
    facts: Array<Record<string, unknown>>;
    accepted: Array<Record<string, unknown>>;
    unresolved: Array<Record<string, unknown>>;
};
export function discoverActorsFromTurnSources(
    value: unknown,
    options?: {
        userText?: string;
        acceptedContent?: string;
        knownActorNames?: string[];
        excludedActorNames?: string[];
        sourceRef?: ActorLedgerSourceRef | null;
        turn?: number | null;
        modelProfileDiscoveries?: Array<Record<string, unknown>> | null;
    },
): {
    ledger: ActorLedger;
    candidates: ActorCandidate[];
    discovered: Array<{ actorId: string; name: string }>;
    touched: Array<{ actorId: string; name: string }>;
    location: string;
    modelProfileDiscoveries: Array<Record<string, unknown>>;
    unresolved: Array<Record<string, unknown>>;
};
export function promoteActorCandidatesToRegistry(
    value: unknown,
    candidates: ActorCandidate[],
    options?: {
        chatId?: string;
        identityScopeId?: string;
        scopeDigest?: string;
        allowScopeDigestFill?: boolean;
        expectedSourceRef?: ActorLedgerSourceRef | null;
        turn?: number | null;
        excludedActorNames?: string[];
    },
): {
    ledger: ActorLedger;
    promoted: Array<Record<string, unknown>>;
    discovered: Array<{ actorId: string; name: string }>;
    touched: Array<{ actorId: string; name: string }>;
    quarantined: Array<{ candidateId: string; name: string; reason: string }>;
    changed: boolean;
};
export function applyCandidateRegistryResult(
    characters: Record<string, ActorRegistryCandidateRow>,
    result: ActorRegistryCandidateRow,
): ActorRegistryCandidateRow;
export function runActorRegistryUpsert(
    value: unknown,
    candidates: ActorCandidate[],
    options?: {
        chatId?: string;
        identityScopeId?: string;
        scopeDigest?: string;
        allowScopeDigestFill?: boolean;
        expectedSourceRef?: ActorLedgerSourceRef | null;
        turn?: number | null;
        excludedActorNames?: string[];
    },
): {
    ledger: ActorLedger;
    inserted: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
    quarantined: Array<Record<string, unknown>>;
    changed: boolean;
};
export function actorCandidatesForRegistryPromotion(
    candidates: ActorCandidate[],
    upsertResult: {
        ledger?: ActorLedger;
        inserted?: Array<{
            candidateId?: string;
            actorRef?: ActorRegistryEntry['actorRef'];
            table?: string;
        }>;
        updated?: Array<{
            candidateId?: string;
            actorRef?: ActorRegistryEntry['actorRef'];
            table?: string;
        }>;
    },
): ActorCandidate[];
/** @deprecated Fail-closed compatibility reader; P1 ProfileInsertCandidate is the only writer. */
export function mergeActorProfilePatches(
    value: unknown,
    patches: unknown,
    options?: {
        turn?: number | null;
        sourceRef?: ActorLedgerSourceRef | null;
        maxPatches?: number;
        evidenceCorpus?: string;
        mergeMode?: 'append' | 'consolidate';
    },
): {
    ledger: ActorLedger;
    accepted: [];
    rejected: Array<{
        actorId: string;
        name?: string;
        inputIndex: number;
        startIndex?: number;
        count?: number;
        total?: number;
        reason: string;
    }>;
    inputCount: number;
    processedCount: number;
    overflowCount: number;
    retired: true;
};
export function mergeActorIdentityReveal(
    value: unknown,
    options: {
        actorId: string;
        revealedName: string;
        aliases?: string[];
        evidence?: string[];
        sourceRef?: ActorLedgerSourceRef | null;
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
