import type { ActorProfileBatchParseMeta } from './actor-profile-v6-core.mjs';

export interface ActorProfileBatchTransactionResult {
    ledger: Record<string, unknown>;
    candidates: object[];
    accepted: object[];
    rejected: object[];
    failures: object[];
    persistenceMeta: object | null;
    modelCalls: number;
    persistenceStatus?: 'pending_readback' | 'atomic_readback' | 'not_completed' | string;
    readbackVerified?: boolean;
    transactionId?: string;
    writeSetDigest?: string;
    preparedLedgerDigest?: string;
    preparedFieldRevision?: number;
    pendingLedger?: Record<string, unknown> | null;
    finalLedger?: Record<string, unknown> | null;
    batchMeta?: ActorProfileBatchParseMeta | null;
    batchFormatReplacementAttempted?: boolean;
    recoveryProgress?: ActorProfileRecoveryProgress | null;
    timings?: {
        totalMs: number;
        modelMs: number;
        parseMs: number;
        persistMs: number;
    };
}

export interface ActorProfileRecoveryProgressRow {
    actorId: string;
    name: string;
    discovery: boolean;
    sourceAnchor: string;
    modules: Record<string, string>;
    identityReveal?: object;
}

export interface ActorProfileRecoveryProgress {
    version: 1;
    identityAttempted: boolean;
    identityLocked: boolean;
    rows: ActorProfileRecoveryProgressRow[];
    verifiedFieldCount: number;
}

export interface ActorProfileBatchPersistenceContext {
    ledger: Record<string, unknown>;
    expectedCommits: object[];
    expectedState: object | null;
    transactionId?: string;
    writeSetDigest?: string;
    preparedLedgerDigest?: string;
    preparedFieldRevision?: number;
    readShadowLedger?: Record<string, unknown> | null;
}

export type ActorProfileBatchPersistenceCallback =
    (context: ActorProfileBatchPersistenceContext) => Promise<{
        ok: boolean;
        ledger?: Record<string, unknown>;
        snapshot?: object | null;
        persistenceMeta?: object | null;
        reason?: string;
    }>;

export function actorProfileBatchSemanticFingerprint(overrides?: Record<string, unknown>): string;
export const ACTOR_PROFILE_GROUP_TRANSPORT_ROWS: number;
export function actorProfileModuleGroupChunks(group: object, rowLimit?: number): object[];
export function actorProfileGroupFailureDiagnostic(
    group: object,
    attempt: number,
    parsed: object,
    failures?: object[],
): object | null;
export function actorProfileResolverPromotionClosure(options?: Record<string, unknown>): object[];
export function actorProfileFinalCandidateClosure(options?: Record<string, unknown>): {
    allCandidates: object[];
    resolutionFailures: object[];
    groupRowFailures: object[];
};
export function normalizeActorProfileRecoveryProgress(
    value: unknown,
): ActorProfileRecoveryProgress | null;
export function actorProfileRecoveryProgressDigest(
    value: unknown,
    sourceDigest?: string,
): string;

export function completeActorProfileBatchTransaction(options?: {
    persistPendingBatch?: ActorProfileBatchPersistenceCallback;
    persistFinalizedBatch?: ActorProfileBatchPersistenceCallback;
    requestBatch?: (context: object) => Promise<unknown>;
    preflightDiscoveries?: (context: object) => Promise<object>;
    resolveDiscoveries?: (context: object) => Promise<object>;
    recoveryProgress?: ActorProfileRecoveryProgress | null;
    [key: string]: unknown;
}): Promise<ActorProfileBatchTransactionResult>;
