export interface ActorShardCandidate {
    id: string;
    name: string;
    actorRef: {
        kind: 'actor_ref';
        actorId: string;
        displayName: string;
        aliases: string[];
    };
    score: number;
    locations: string[];
    knowledgeBasis: string[];
    goals: string[];
    stimuli: Array<{
        id: string;
        kind: string;
        summary: string;
        status: string;
        sourceThreadId: string;
    }>;
    sourceThreads: string[];
    evidence: string[];
    causalChain: string[];
}

export interface ActorShardProposal {
    actorId: string;
    actorName: string;
    time: string;
    location: string;
    travelTurns: number;
    knowledgeBasis: string[];
    currentGoal: string;
    intent: 'execute' | 'replan' | 'wait';
    candidateAction: string;
    actionWindow: string;
    expectedCost: string;
    expectedDuration: string;
    expectedRisk: string;
    observableConsequence: string;
    stimulusDecisions: Array<{
        stimulusId: string;
        decision: 'adopted' | 'ignored' | 'misread' | 'used' | 'opposed';
        reason: string;
    }>;
    stateChanges: Array<{
        kind: 'location' | 'plan' | 'resource' | 'knowledge' | 'relationship'
            | 'risk' | 'condition' | 'commitment' | 'environment';
        summary: string;
    }>;
    interactionTargets: Array<{ actorId: string; actorName: string }>;
    resourceCosts: Array<{ resourceId: string; amount: number }>;
    capabilityUsed: string;
    waitCondition: string;
    sourceThreads: string[];
    evidence: string[];
    causalChain: string[];
}

export interface ActorShardConvergence {
    jointEvents: Array<{
        id: string;
        actorIds: string[];
        time: string;
        location: string;
        sharedCausalChain: string[];
        proposals: ActorShardProposal[];
    }>;
    independent: Array<{
        proposal: ActorShardProposal;
        reasons: string[];
    }>;
}

export const ACTOR_SHARD_MAX_WORKERS: 6;
export const ACTOR_SHARD_PROMPT_MAX_CHARS: 6000;

export function normalizeUserPromptSlot(value: unknown, maxChars?: number): string;
export function userPromptSlotMetadata(value: unknown): {
    enabled: boolean;
    length: number;
    hash: string;
};
export function formatUserNarrativeInstruction(label: unknown, value: unknown): string;
export function selectActorShardCandidates(input?: {
    continuity?: { threads?: Array<Record<string, unknown>> };
    actorLedger?: { actors?: Array<Record<string, unknown>> };
    schedule?: { selected?: Array<Record<string, unknown>> };
    presentText?: string;
    maxWorkers?: number;
    excludedActorNames?: string[];
}): ActorShardCandidate[];

export function actorNarrativeShardBasis(actor?: unknown): {
    knowledgeBasis: string[];
    goals: string[];
};
export function buildActorShardMessages(
    candidate: ActorShardCandidate,
    options?: {
        target?: Record<string, unknown>;
        customPrompt?: string;
    },
): Array<{ role: 'system' | 'user'; content: string }>;
export function buildActorShardBatchMessages(
    candidates: ActorShardCandidate[],
    options?: {
        target?: Record<string, unknown>;
        customPrompt?: string;
    },
): Array<{ role: 'system' | 'user'; content: string }>;
export function parseActorShardProposal(
    output: unknown,
    options: { candidate: ActorShardCandidate },
): {
    proposal?: ActorShardProposal;
    error?: string;
    repaired?: boolean;
    repairKinds?: string[];
};
export function parseActorShardProposalBatch(
    output: unknown,
    options: { candidates: ActorShardCandidate[] },
): {
    proposals: ActorShardProposal[];
    failures: Array<{ actorId: string; itemIndex?: number; code: string }>;
    repaired: boolean;
    repairKinds: string[];
    semanticSuccess: boolean;
    error: string;
    diagnostics: {
        selected: number;
        completed: number;
        succeeded: number;
        failed: number;
        semanticSuccess: boolean;
    };
};
export function actorShardCompatibility(
    left: ActorShardProposal,
    right: ActorShardProposal,
): { compatible: boolean; reasons: string[]; sharedCausalChain: string[] };
export function convergeActorShardProposals(
    proposals: ActorShardProposal[],
): ActorShardConvergence;
export function runActorShardBatch(options: {
    candidates?: ActorShardCandidate[];
    maxConcurrency?: number;
    timeoutMs?: number;
    callWorker: (
        candidate: ActorShardCandidate,
        context: { signal: AbortSignal },
    ) => Promise<unknown>;
    repairWorker?: (
        output: unknown,
        candidate: ActorShardCandidate,
        context: { signal: AbortSignal; error?: string },
    ) => Promise<unknown>;
    isCurrent?: () => boolean;
    onProgress?: (progress: {
        total: number;
        completed: number;
        succeeded: number;
        failed: number;
    }) => void;
    signal?: AbortSignal | null;
}): Promise<{
    status: 'completed' | 'stale';
    proposals: ActorShardProposal[];
    convergence: ActorShardConvergence;
    failures?: Array<{ actorId: string; code: string }>;
    diagnostics: {
        selected: number;
        completed: number;
        succeeded: number;
        failed: number;
    };
}>;
export function runActorShardProposalBatch(options: {
    candidates?: ActorShardCandidate[];
    callBatch: (
        candidates: ActorShardCandidate[],
        context: { signal: AbortSignal | null },
    ) => Promise<unknown>;
    isCurrent?: () => boolean;
    onProgress?: (progress: {
        total: number;
        completed: number;
        succeeded: number;
        failed: number;
        modelCalls: number;
        semanticSuccess: boolean;
    }) => void;
    signal?: AbortSignal | null;
}): Promise<{
    status: 'completed' | 'semantic-failed' | 'failed' | 'stale';
    proposals: ActorShardProposal[];
    convergence: ActorShardConvergence;
    failures: Array<{ actorId: string; code: string }>;
    diagnostics: {
        selected: number;
        completed: number;
        succeeded: number;
        failed: number;
        modelCalls: number;
        semanticSuccess: boolean;
    };
}>;
