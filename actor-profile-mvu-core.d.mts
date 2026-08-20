export const ACTOR_PROFILE_UPDATE_BLOCK: Readonly<{
    start: string;
    end: string;
    schemaVersion: number;
}>;
export const ACTOR_PROFILE_MVU_FIELDS: Readonly<Record<string, string>>;
export const ACTOR_PROFILE_MVU_ROOT: string;
export const ACTOR_PROFILE_MVU_SCHEMA_VERSION: number;
export const ACTOR_PROFILE_FAILURE_CODES: Readonly<Record<string, string>>;

export interface ActorProfileUpdateEntry {
    mode: 'new' | 'existing';
    actorId: string;
    ticketId: string;
    name: string;
    aliases: string[];
    sourceAnchor: string;
    fields: Record<string, string | string[]>;
}
export interface ActorProfileUpdateParseResult {
    ok: boolean;
    present: boolean;
    block: string;
    entries: ActorProfileUpdateEntry[];
    failures: unknown[];
    quarantined: unknown[];
    repairs: string[];
}
export function extractActorProfileUpdateBlock(output: unknown, options?: object): ActorProfileUpdateParseResult;
export function actorProfileReceiptPlacementAccepted(source: unknown, receiptIndex: number, receiptEnd?: number): boolean;
export function parseActorProfileUpdateBlock(output: unknown, options?: object): ActorProfileUpdateParseResult;
export function bindActorProfileUpdateEntries(parsed: unknown, options?: {
    tickets?: unknown[];
    actors?: unknown[];
    acceptedNarrative?: string;
    acceptedTarget?: Record<string, unknown> | null;
}): {
    ok: boolean;
    entries: ActorProfileUpdateEntry[];
    failures: unknown[];
    quarantined: unknown[];
    source: ActorProfileUpdateParseResult;
};
export function validateActorProfileUpdateEntry(entry: unknown, options?: object): {
    ok: boolean;
    entry: ActorProfileUpdateEntry;
    missingFields: string[];
    failures: unknown[];
    complete: boolean;
};
export function profileReadiness(profile: unknown): {
    ready: boolean;
    complete: boolean;
    readbackReady: boolean;
    missingFields: string[];
    reason: string;
};
export function actorProfileMvuPath(actorId: string, profileRoot: string): string;
export function compileActorProfileMvuPatch(bound: unknown, options: {
    profileRoot: string;
    profileRootPresent?: boolean | null;
    existingProfiles?: Record<string, unknown>;
    sourceRef: Record<string, unknown>;
    now?: number;
    readbackVerified?: boolean;
}): {
    ok: boolean;
    operations: Array<{ op: 'insert' | 'replace'; path: string; value: unknown }>;
    profiles: Record<string, unknown>;
    failures: unknown[];
    quarantined: unknown[];
    committableActorIds: string[];
    emptyOperations: boolean;
    commitStatus: 'committable' | 'partial' | 'quarantined';
    writeSet: Array<Record<string, unknown>>;
    atomic: boolean;
    profileRoot: string;
};
export function markActorProfileReadback(profile: unknown, options?: { verified?: boolean }): object;
export function actorProfileMvuDigest(profile: unknown): string;
export function mergeActorProfileOperationsIntoAcceptedMessage(
    messageText: string,
    operations?: Array<Record<string, unknown>>,
): { ok: boolean; reason?: string; text: string; block?: string; operations: Array<Record<string, unknown>> };
export function preserveActorProfileOperationsOnUpdateBlock(
    messageText: string,
    replacementBlock: string,
): { ok: boolean; reason?: string; block: string; operations?: Array<Record<string, unknown>>; preservedCount?: number };
export function actorProfilePromptProjection(
    profile: unknown,
    options?: { maxCharacters?: number },
): null | { actorId: string; name: string; revision: number; profileDigest: string; summary: string };
export function compileLegacyActorProfileMigration(
    legacyProfiles: Record<string, unknown>,
    options: Record<string, unknown>,
): ReturnType<typeof compileActorProfileMvuPatch> & {
    migration: true;
    legacyPreserved: true;
    migrationEntries: ActorProfileUpdateEntry[];
};
export function actorProfileSemanticRuntimeFingerprint(mutationProbe?: string): string;
