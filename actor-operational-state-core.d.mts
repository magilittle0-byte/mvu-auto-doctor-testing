export const ACTOR_OPERATIONAL_STATE_CORE_VERSION: string;
export function composeActorOperationalState(options?: Record<string, unknown>): Record<string, unknown>;
export function operationalActorEligible(state: unknown, turn?: number): boolean;
export function actorOperationalPromptProjection(state: unknown, options?: { maxChars?: number; maxTokens?: number }): { projection: Record<string, unknown>; usedChars: number; usedTokens: number; omitted: string[] };
