export const ACTOR_PROFILE_V6_VERSION: number;
export const ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT: string;
export const ACTOR_PROFILE_COMPLETION_MODES: readonly string[];
export const ACTOR_PROFILE_SOURCES: readonly string[];
export const ACTOR_PROFILE_MODULES: readonly string[];
export const CHARACTER_CREATION_TICKET_VERSION: number;
export const CHARACTER_CREATION_TICKET_AXIS_NAMES: readonly string[];
export function emptyActorProfileV6(actorId?: string, name?: string, options?: object): object;
export function normalizeActorProfileV6(value: unknown, options?: object): object;
export function prepareActorProfileV6(actor: unknown, options?: object): object;
export function prepareActorLedgerProfilesV6(value: unknown, options?: object): object;
export function actorProfileReadyForAction(actor: unknown): boolean;
export function actorProfileActionReadiness(actor: unknown): {
    ready: boolean;
    reason: string;
    migrationRequired: boolean;
};
export function issueCharacterCreationTicket(actor: unknown, options?: object): object;
export function rollActorProfileDiversity(actor: unknown, options?: object): object;
export function normalizeActorProfileDesignRolls(value: unknown): object | null;
export function bindCharacterCreationTicket(ticket: unknown, options?: object): object | null;
export function bindActorProfileDesignRolls(actor: unknown, designRolls: unknown): object;
export function bindCharacterCreationTicketsToRegisteredActors(
    value: unknown,
    options?: object,
): object;
export function selectActorProfileCompletionCandidates(value: unknown, options?: object): object[];
export function buildActorProfileEvidenceBank(evidenceText: string, options?: object): object[];
export function buildActorProfileCompletionMessages(candidates: unknown[], options?: object): object[];
export function repairActorProfileInsertLocally(output: string, context?: object): object;
export function validateActorProfileInsertCandidate(candidate: unknown, context?: object): object;
export function parseActorProfileCompletionOutput(output: string, options?: object): object;
export function parseActorProfileCompletionBatchOutput(output: string, options?: object): object;
export function actorProfileCompletionMissingFields(candidate: unknown, context?: object): string[];
export function materializeActorProfileBaseline(
    previousProfile: unknown,
    candidate: unknown,
    options?: object,
): object;
export function actorProfileBaselineDigest(profile: unknown): string;
export function applyActorProfileCompletionToV6(value: unknown, candidate: unknown, options?: object): object;
export function setActorProfileV6Lock(value: unknown, options?: object): object;
export function applyActorProfileV6Override(value: unknown, options?: object): object;
export function regenerateActorProfileV6Module(value: unknown, actor: unknown, options?: object): object;
export function actorProfileV6View(actor: unknown): object;
