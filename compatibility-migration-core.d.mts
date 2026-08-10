export const ACTOR_SOVEREIGNTY_SCOPE_VERSION: number;
export const ACTOR_SOVEREIGNTY_MIGRATION_VERSION: number;
export const ACTOR_SOVEREIGNTY_RETIRED_WRITE_PATHS_VERSION: number;
export const ACTOR_SOVEREIGNTY_NAMESPACE_WRITE_PATH: string;
export const RETIRED_ACTOR_WRITE_PATHS: readonly string[];

export function flattenActorSovereigntyScopeValues(value: unknown, output?: string[]): string[];
export function stableActorSovereigntyWorldbookEntries(value: unknown): object[];
export function actorSovereigntyWorldbookDescriptor(
    id: string,
    book: unknown,
    options?: { kind?: 'external' | 'embedded'; explicitRevision?: string },
): Record<string, unknown>;
export function createActorSovereigntyWorldbookManifest(
    descriptors: unknown[],
    options?: { status?: 'confirmed' | 'unresolved'; reason?: string },
): Record<string, unknown>;
export function createActorSovereigntyScope(value?: object): Record<string, unknown>;
export function actorSovereigntyScopeDigest(value: unknown): string;
export function actorSovereigntyScopesMatch(left: unknown, right: unknown): boolean;
export function prepareActorSovereigntyFieldWriteCandidate(
    candidate: unknown,
    current: unknown,
    options?: { scope?: unknown; fields?: string[] },
): {
    allowed: boolean;
    reason: string;
    candidate: Record<string, unknown> | null;
    rebasedFields: string[];
    staleFields: string[];
};
export function actorSovereigntyMigrationDigest(namespace: unknown, scope?: unknown): string;
export function actorSovereigntyMigrationIsCurrent(namespace: unknown, scope?: unknown): boolean;
export function markActorSovereigntyMigrationCurrent(
    namespace: Record<string, unknown>,
    options?: { scope?: unknown; payloadRev?: number },
): Record<string, unknown>;
export function migrateActorSovereigntyNamespace(
    value: unknown,
    options?: { scope?: unknown; namespaceVersion?: number },
): {
    applicable: boolean;
    reason: string;
    namespace: Record<string, unknown> | null;
    report: Record<string, unknown>;
};
export function ensureActorSovereigntyMigration(
    value: unknown,
    options?: {
        scope?: unknown;
        namespaceVersion?: number;
        commitPayload?: (
            namespace: Record<string, unknown>,
            evidence: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>;
        commitMarker?: (
            namespace: Record<string, unknown>,
            evidence: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>;
    },
): Promise<{
    ok: boolean;
    current: boolean;
    replayed: boolean;
    reason: string;
    namespace: Record<string, unknown> | null;
    report: Record<string, unknown>;
}>;
