export interface ActorRef {
    kind: 'actor_ref';
    actorId: string;
    displayName: string;
    aliases: string[];
}

export declare const ACTOR_REF_VERSION: 1;
export declare function isActorId(value: unknown): boolean;
export declare function actorIdFromName(value: unknown): string;
export declare function actorIdFromScopedIdentity(
    value: unknown,
    options?: { chatId?: string; identityKey?: string },
): string;
export declare function actorRefFrom(
    value: unknown,
    options?: {
        actors?: unknown[];
        chatId?: string;
        identityKey?: string;
        allowCreate?: boolean;
    },
): ActorRef | null;
export declare function normalizeActorRefs(
    values: unknown,
    options?: {
        actors?: unknown[];
        chatId?: string;
        identityKey?: string;
        allowCreate?: boolean;
    },
): ActorRef[];
