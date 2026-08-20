export const ACTOR_PROFILE_V6_VERSION: number;
export const ACTOR_SOVEREIGNTY_DIVERSITY_CONTRACT: string;
export const ACTOR_PROFILE_COMPLETION_MODES: readonly string[];
export const ACTOR_PROFILE_SOURCES: readonly string[];
export const ACTOR_PROFILE_MODULES: readonly string[];
export const ACTOR_PROFILE_NARRATIVE_SECTION_KEYS: readonly string[];
export const ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION: number;
export const ACTOR_PROFILE_RECOVERY_EVIDENCE_CAPACITY: number;
export const ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS: readonly string[];
export function validateActorProfilePhysiologyCoverage(value: unknown): {
    ok: boolean;
    prose: string;
    missingFields: string[];
    locallyRecovered?: boolean;
};
export const ACTOR_PROFILE_COMPLETION_GROUPS: readonly {
    key: string;
    modules: readonly string[];
}[];
export const ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES: readonly string[];
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
export function validateActorProfileDiscoveryAnchor(candidateRef: unknown, acceptedNarrative: unknown, policy?: unknown): {
    ok: boolean;
    reason: string;
    retryable: boolean;
    offset: number;
    name: string;
    sourceAnchor: string;
};
export function takeActorProfileDiscoveryAnchorPolicies(values: unknown[], context?: object): Map<unknown, unknown>;
export function discardActorProfileDiscoveryProofBatches(value: unknown): void;
export function parseActorProfileCompletionOutput(output: string, options?: object): object;
export interface ActorProfileBatchParseMeta {
    rootType: 'array' | 'object' | 'other' | 'empty' | 'narrative_blocks';
    parsedRowCount: number;
    explicitEmpty: boolean;
    emptyOutput: boolean;
    formatUnrecoverable: boolean;
    repairLabels: string[];
}
export interface ActorProfileCompletionBatchParseResult {
    ok: boolean;
    entries: object[];
    failures: object[];
    unexpected: object[];
    discoveries: object[];
    unresolved: object[];
    explicitEmpty: boolean;
    repairs: string[];
    batchMeta: ActorProfileBatchParseMeta;
}
export function parseActorProfileCompletionBatchOutput(
    output: string,
    options?: object,
): ActorProfileCompletionBatchParseResult;
export function actorProfileCompletionMissingFields(candidate: unknown, context?: object): string[];
export function materializeActorProfileBaseline(
    previousProfile: unknown,
    candidate: unknown,
    options?: object,
): object;
export function actorProfileBaselineDigest(profile: unknown): string;
export function normalizeActorProfileRecoverySourceRef(value: unknown): object;
export function actorProfileRecoverySourceMatches(left: unknown, right: unknown): boolean;
export function actorProfileTicketBatchPersistenceDigest(value: unknown, acceptedTarget?: unknown): string;
export function sealActorProfileTicketBatchForPersistence(value: unknown, acceptedTarget: unknown): object | null;
export function actorProfileTicketBatchPersistenceMatches(value: unknown, options?: object): boolean;
export function createActorProfileRetryReceipt(options?: object): object | null;
export function actorProfileRetryReceiptMatches(value: unknown, options?: object): boolean;
export function actorProfileDiscoveryCoveragePlan(acceptedNarrative: unknown): object;
export function actorProfileDiscoveryCoverageProofMatches(value: unknown): boolean;
export function actorProfileCompletionModuleKey(value: unknown): string;
export function actorProfileCompletionGroupPlan(candidates: unknown[], options?: object): object[];
export function buildActorProfileModuleGroupMessages(group: unknown, options?: object): object[];
export function parseActorProfileModuleGroupOutput(output: unknown, group: unknown, options?: object): object;
export function actorProfileIdentityEvidenceSurface(value: unknown): string;
export function isVagueActorProfileDiscoveryName(name: unknown): boolean;
export function createActorProfileNoCandidatesTerminalProof(options?: object): object | null;
export function actorProfileNoCandidatesTerminalProofMatches(value: unknown, options?: object): boolean;
export function actorProfileRecoveryCriticalFingerprint(overrides?: Record<string, unknown>): string;
export function actorProfileGenerationCriticalFingerprint(overrides?: Record<string, unknown>): string;
export function applyActorProfileCompletionToV6(value: unknown, candidate: unknown, options?: object): object;
export function setActorProfileV6Lock(value: unknown, options?: object): object;
export function applyActorProfileV6Override(value: unknown, options?: object): object;
export function regenerateActorProfileV6Module(value: unknown, actor: unknown, options?: object): object;
export function actorProfileV6View(actor: unknown): object;
