export const ACTOR_ACTION_ROUTES: readonly string[];
export const ACTION_ATTEMPT_KIND: 'action_attempt';
export const WORLD_ADJUDICATION_RESULT_KIND: 'world_adjudication_result';
export interface ActorActionTarget {
    chatId: string;
    logicalIndex: number;
    index: number;
    messageId: string;
    swipeId: number;
    generation: number;
    generationId: string;
    generationType: string;
    branchId: string;
    scopeDigest: string;
    contentHash: string;
    hash: string;
    compatibilityOnly?: boolean;
}
export function routeActorActionAttempt(candidate: unknown, options?: object): string;
export function createActorActionAttempt(candidate: unknown, options?: object): object;
export function actorActionAttemptWorldView(attempt: unknown): object;
export function normalizeActorActionTarget(value: unknown): ActorActionTarget | null;
export function normalizeLegacyActorActionTarget(value: unknown): ActorActionTarget | null;
export function actorActionTargetMatches(left: unknown, right: unknown): boolean;
export function actorRefsMatch(left: unknown, right: unknown): boolean;
export function validateActorActionAttempt(value: unknown): {
    valid: boolean;
    reason: string;
};
export function validateWorldAdjudication(value: unknown, attempt: unknown): {
    valid: boolean;
    reason: string;
    decision?: object;
};
export function validateWorldAdjudicationBatch(values: unknown, attempts: unknown): {
    valid: boolean;
    decisions: object[];
    errors: Array<{ attemptId: string; reason: string }>;
};
export function adjudicateActorActionAttempt(attempt: unknown, options?: object): object;
export function actorActionNarrativeInjection(attempt: unknown, result: unknown): object;
export function discloseActorActionResult(result: unknown, options?: object): object;
export function worldEventFromSettledActionReceipt(receipt: unknown, options?: object): object | null;
export function independentWorldProcessEvent(value: unknown): object | null;
export function containsForgedPlayerSettlement(value: unknown): boolean;
