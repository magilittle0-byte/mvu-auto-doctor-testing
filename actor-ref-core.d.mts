export interface ActorRef {
    kind: 'actor_ref';
    actorId: string;
    displayName: string;
    aliases: string[];
}

export declare const ACTOR_REF_VERSION: 1;
export declare function isActorId(value: unknown): boolean;
export declare function actorIdFromName(value: unknown): string;
export declare function actorRefFrom(
    value: unknown,
    options?: { actors?: unknown[] },
): ActorRef | null;
export declare function normalizeActorRefs(
    values: unknown,
    options?: { actors?: unknown[] },
): ActorRef[];
