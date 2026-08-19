export interface ActorProfileSurfaceCard {
    actorId: string;
    name: string;
    aliases: string[];
    status: {
        key: string;
        color: 'green' | 'yellow' | 'red';
        label: string;
        repairable: boolean;
        migratable: boolean;
        ready: boolean;
    };
    changeLabel: string;
    groups: Array<{
        key: string;
        title: string;
        sections: Array<{ key: string; title: string; text: string; source: string }>;
    }>;
    physiology: null | { key: string; title: string; text: string; source: string };
    missingSectionCount: number;
    sourceLegal: boolean;
    legacyOnly: boolean;
}

export function createActorProfileSurfaceView(options?: Record<string, unknown>): {
    cards: readonly ActorProfileSurfaceCard[];
    counts: Readonly<Record<string, number>>;
    summary: string;
    readError: string;
};
export function renderActorProfileAccordion(
    document: Document,
    host: Element,
    view: ReturnType<typeof createActorProfileSurfaceView>,
    options?: Record<string, unknown>,
): { cards: readonly HTMLDetailsElement[] };
export function collapseActorProfileAccordion(host: Element, onExpanded?: (actorId: string) => void): void;
export function actorProfileSurfaceRuntimeFingerprint(mutationProbe?: string): string;
export const ACTOR_PROFILE_SURFACE_GROUPS: readonly unknown[];
