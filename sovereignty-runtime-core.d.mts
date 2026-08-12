export type SovereigntyTaskStatus =
    | 'pending'
    | 'running'
    | 'retryable_failed'
    | 'deferred'
    | 'committed'
    | 'cancelled_stale';

export type SovereigntyHealthColor = 'green' | 'yellow' | 'orange' | 'red' | 'blue';

export interface SovereigntySourceRef {
    chatId: string;
    logicalIndex: number;
    messageId: string;
    swipeId: number;
    generation: number;
    generationId: string;
    generationType: string;
    contentHash: string;
    scopeDigest: string;
}

export const SOVEREIGNTY_RUNTIME_VERSION: number;
export const SOVEREIGNTY_CHECKPOINT_VERSION: number;
export const SOVEREIGNTY_CHECKPOINT_BYTE_BUDGET: number;
export const SOVEREIGNTY_TECHNICAL_RECEIPT_HOT_BYTE_BUDGET: number;
export const SOVEREIGNTY_TASK_STATUSES: readonly SovereigntyTaskStatus[];
export const SOVEREIGNTY_MODULES: readonly string[];
export function emptySovereigntyRuntime(chatId?: string, options?: object): object;
export function normalizeSovereigntyRuntime(value: unknown, options?: object): object;
export function normalizeSovereigntySourceRef(value: unknown): SovereigntySourceRef | null;
export function sovereigntySourceKey(value: unknown): string;
export function sovereigntySourceRefsMatch(left: unknown, right: unknown): boolean;
export function observeSovereigntyTurn(value: unknown, options?: object): object;
export function completeSovereigntyObservationGaps(value: unknown, options?: object): object;
export function supersedeSovereigntyObservationSources(value: unknown, options?: object): object;
export function recoverOrphanedSovereigntyTasks(value: unknown, options?: object): object;
export function claimNextSovereigntyTask(value: unknown, options?: object): object;
export function claimDueSovereigntyActorTasks(value: unknown, options?: object): object;
export function materializeSovereigntyActorTasks(value: unknown, options?: object): object;
export function failSovereigntyTask(value: unknown, options?: object): object;
export function commitSovereigntyTask(value: unknown, options?: object): object;
export function cancelSovereigntyTaskAsStale(value: unknown, options?: object): object;
export function requeueSovereigntyTaskForLatestState(value: unknown, options?: object): object;
export function retrySovereigntyTaskNow(value: unknown, options?: object): object;
export function dueSovereigntyTasks(value: unknown, options?: object): object[];
export function sovereigntyRetryDelay(value: unknown, options?: object): number;
export function sovereigntyTechnicalReceipts(value: unknown): object[];
export function restoreSovereigntyCheckpoint(value: unknown, options?: object): object;
export function sovereigntyHealthView(value: unknown): object;
export function combineDoctorSemanticHealth(
    baseValue: unknown,
    signals?: {
        identityPollutionCount?: number;
        identityQuarantineCount?: number;
        profileIncompleteCount?: number;
        profileActorCount?: number;
        profileOptionalPendingCount?: number;
        injectionConsumedCount?: number;
        injectionWaitingCount?: number;
        injectionStalledCount?: number;
    },
): object;
export function extractFirstBalancedJsonObject(output: unknown): object;
export function parseJsonObjectWithSingleRepair(output: unknown, options?: object): Promise<object>;
export function conservativeSovereigntyFallback(options?: object): object;
