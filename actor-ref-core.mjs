import { fingerprint } from './core.mjs';

export const ACTOR_REF_VERSION = 1;

const ACTOR_ID = /^(?:NPC|ACTOR)(?:[-:][\p{L}\p{N}_.]+)+$/iu;

function cleanText(value, limit = 180) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 12, itemLimit = 180) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const raw of value) {
        const item = cleanText(raw, itemLimit);
        const key = item.toLocaleLowerCase();
        if (!item || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}

export function isActorId(value) {
    return ACTOR_ID.test(cleanText(value));
}

export function actorIdFromName(value) {
    const name = cleanText(value, 160);
    if (!name) return '';
    if (isActorId(name)) return name;
    return `NPC-${fingerprint(name.toLocaleLowerCase()).slice(0, 16)}`;
}

export function actorIdFromScopedIdentity(value, {
    chatId = '',
    identityKey = '',
} = {}) {
    const name = cleanText(value, 160);
    if (!name) return '';
    if (isActorId(name)) return name;
    const scope = cleanText(chatId, 180);
    const key = cleanText(identityKey, 300)
        || `name:${name.toLocaleLowerCase('zh-CN')}`;
    if (!scope) return actorIdFromName(name);
    return `NPC-${fingerprint(`${scope}\u001f${key}`).slice(0, 16)}`;
}

export function actorRefFrom(value, {
    actors = [],
    chatId = '',
    identityKey = '',
    allowCreate = true,
} = {}) {
    const byId = new Map();
    const byName = new Map();
    for (const actor of Array.isArray(actors) ? actors : []) {
        const id = cleanText(actor?.id);
        const name = cleanText(actor?.name, 160);
        if (id) byId.set(id.toLocaleLowerCase(), actor);
        for (const mergedActorId of actor?.lineage?.mergedActorIds || []) {
            const mergedId = cleanText(mergedActorId);
            if (isActorId(mergedId)) byId.set(mergedId.toLocaleLowerCase(), actor);
        }
        for (const candidate of [name, ...(actor?.identity?.aliases || [])]) {
            const key = cleanText(candidate, 160).toLocaleLowerCase();
            if (!key) continue;
            const matches = byName.get(key) || [];
            if (!matches.some((entry) => entry === actor)) matches.push(actor);
            byName.set(key, matches);
        }
    }

    let actorId = '';
    let displayName = '';
    let aliases = [];
    if (typeof value === 'string') {
        const text = cleanText(value);
        if (!text) return null;
        if (isActorId(text)) actorId = text;
        else displayName = text;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        actorId = cleanText(value.actorId || value.id);
        displayName = cleanText(value.displayName || value.name, 160);
        aliases = cleanList(value.aliases);
        if (actorId && !isActorId(actorId)) {
            if (!displayName) displayName = actorId;
            actorId = '';
        }
    } else {
        return null;
    }

    const nameMatches = displayName
        ? byName.get(displayName.toLocaleLowerCase()) || []
        : [];
    const matchedById = actorId ? byId.get(actorId.toLocaleLowerCase()) : null;
    const matched = matchedById
        || (displayName && nameMatches.length === 1 ? nameMatches[0] : null);
    if (!actorId && displayName && nameMatches.length > 1) return null;
    if (matched) {
        actorId = cleanText(matched.id);
        displayName = cleanText(matched.name, 160);
        aliases = cleanList([...aliases, ...(matched.identity?.aliases || [])]);
    } else if (!actorId && displayName && allowCreate) {
        actorId = actorIdFromScopedIdentity(displayName, { chatId, identityKey });
    }
    if (!actorId) return null;
    return {
        kind: 'actor_ref',
        actorId,
        displayName,
        aliases: aliases.filter((item) => item !== displayName),
    };
}

export function normalizeActorRefs(values, options = {}) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const ref = actorRefFrom(value, options);
        if (!ref) continue;
        const key = ref.actorId.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(ref);
    }
    return result;
}
