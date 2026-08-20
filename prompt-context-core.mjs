export const PROMPT_CONTEXT_CORE_VERSION = 'prompt-context-core-v1';

const PROFILE_UPDATE_MARKER = '(?:人物档案更新|Actor[_ -]?Profile[_ -]?Update)';
const PROFILE_NO_CHANGE_MARKER = '(?:人物档案无变化|Actor[_ -]?Profile[_ -]?No[_ -]?Change)';

function profileReceiptPatterns() {
    return [
        new RegExp(`<!--\\s*${PROFILE_UPDATE_MARKER}(?:\\s|\\r|\\n|>|$)[\\s\\S]*?-->`, 'giu'),
        new RegExp(`<!--\\s*${PROFILE_NO_CHANGE_MARKER}(?:\\s|\\r|\\n|>|$)[\\s\\S]*?-->`, 'giu'),
        new RegExp(`<(${PROFILE_UPDATE_MARKER})(?=\\s|>)(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`, 'giu'),
        new RegExp(`<(${PROFILE_NO_CHANGE_MARKER})(?=\\s|>)(?:\\s[^>]*)?\\s*/?>`, 'giu'),
        new RegExp(`<(${PROFILE_UPDATE_MARKER})(?=\\s|>)(?:\\s[^>]*)?>[\\s\\S]*$`, 'giu'),
        new RegExp(`<(${PROFILE_NO_CHANGE_MARKER})(?=\\s|>)(?:\\s[^>]*)?\\s*/?>`, 'giu'),
    ];
}

export function stripActorProfileReceiptBlocks(value) {
    let text = String(value ?? '');
    let removed = 0;
    for (const pattern of profileReceiptPatterns()) {
        text = text.replace(pattern, () => {
            removed += 1;
            return '';
        });
    }
    return { text, removed };
}

export function extractActorProfileReceiptBlocks(value) {
    const text = String(value ?? '');
    const blocks = [];
    for (const pattern of profileReceiptPatterns()) {
        for (const match of text.matchAll(pattern)) {
            if (match[0]) blocks.push(match[0]);
        }
    }
    return [...new Set(blocks)];
}

// Normalize only stored assistant text.  Multimodal image/file parts carry no
// assistant prose and are ignored; unknown shapes are rejected so an object is
// never coerced to "[object Object]" in an accepted-final SourceRef.
export function normalizeAssistantStoredText(value) {
    if (typeof value === 'string') {
        const text = value.trim();
        return text ? { ok: true, text } : { ok: false, reason: 'assistant_text_empty' };
    }
    if (!Array.isArray(value) || !value.length) {
        return { ok: false, reason: 'assistant_text_shape_unsupported' };
    }
    const textParts = [];
    for (const part of value) {
        if (typeof part === 'string') {
            textParts.push(part);
            continue;
        }
        if (!part || typeof part !== 'object') {
            return { ok: false, reason: 'assistant_text_part_unsupported' };
        }
        const type = String(part.type || '').toLowerCase();
        if (type === 'text' || (!type && typeof part.text === 'string')) {
            const text = typeof part.text === 'string'
                ? part.text
                : typeof part.content === 'string' ? part.content : null;
            if (text == null) return { ok: false, reason: 'assistant_text_part_unsupported' };
            textParts.push(text);
            continue;
        }
        if (['image', 'audio', 'video', 'file', 'input_audio', 'image_url'].includes(type)) continue;
        return { ok: false, reason: 'assistant_text_part_unsupported' };
    }
    const text = textParts.join('').trim();
    return text ? { ok: true, text } : { ok: false, reason: 'assistant_text_empty' };
}

export function normalizeStoredAssistantMessage(message) {
    const role = String(message?.role || '').toLowerCase();
    if (!message || message.is_system || (role ? role !== 'assistant' : message.is_user !== false)) {
        return { ok: false, reason: 'assistant_role_invalid' };
    }
    const value = Object.hasOwn(message, 'mes') ? message.mes : message.content;
    return normalizeAssistantStoredText(value);
}

function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch { /* fallback below */ }
    }
    return JSON.parse(JSON.stringify(value));
}

function sanitizeTextPart(part) {
    if (typeof part === 'string') return stripActorProfileReceiptBlocks(part);
    if (!part || typeof part !== 'object') return { text: part, removed: 0 };
    if (typeof part.text !== 'string') return { text: part, removed: 0 };
    const result = stripActorProfileReceiptBlocks(part.text);
    return { text: { ...part, text: result.text }, removed: result.removed };
}

function sanitizeAssistantMessage(message) {
    if (!message || typeof message !== 'object') return { message, removed: 0 };
    const role = String(message.role || '').toLowerCase();
    if (role) {
        if (role !== 'assistant') return { message, removed: 0 };
    } else if (message.is_user !== false || message.is_system === true) {
        return { message, removed: 0 };
    }
    const next = { ...message };
    let removed = 0;
    if (typeof next.content === 'string') {
        const result = stripActorProfileReceiptBlocks(next.content);
        next.content = result.text;
        removed += result.removed;
    } else if (Array.isArray(next.content)) {
        next.content = next.content.map((part) => {
            const result = sanitizeTextPart(part);
            removed += result.removed;
            return result.text;
        });
    } else if (typeof next.mes === 'string') {
        const result = stripActorProfileReceiptBlocks(next.mes);
        next.mes = result.text;
        removed += result.removed;
    } else if (Array.isArray(next.mes)) {
        next.mes = next.mes.map((part) => {
            const result = sanitizeTextPart(part);
            removed += result.removed;
            return result.text;
        });
    }
    return { message: next, removed };
}

export function sanitizeOutgoingChatCopy(chat) {
    if (!Array.isArray(chat)) return { chat: clone(chat), removed: 0 };
    let removed = 0;
    const next = chat.map((message) => {
        const result = sanitizeAssistantMessage(message);
        removed += result.removed;
        return result.message;
    });
    return { chat: next, removed };
}

function exactReplaceAll(input, source, replacement) {
    if (!source) return { text: input, count: 0 };
    let text = String(input ?? '');
    let count = 0;
    let offset = 0;
    while (true) {
        const index = text.indexOf(source, offset);
        if (index < 0) break;
        text = `${text.slice(0, index)}${replacement}${text.slice(index + source.length)}`;
        offset = index + replacement.length;
        count += 1;
    }
    return { text, count };
}

function assistantMessageSourceCandidates(message) {
    if (!message || message.is_user || message.is_system) return [];
    const role = String(message.role || '').toLowerCase();
    if (role ? role !== 'assistant' : message.is_user !== false) return [];
    const candidates = [];
    const append = (value) => {
        if (typeof value === 'string') candidates.push(value);
        if (!Array.isArray(value)) return;
        const parts = value
            .map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : ''))
            .filter((part) => typeof part === 'string' && part.length > 0);
        if (parts.length) {
            candidates.push(parts.join(''));
            candidates.push(parts.join('\n'));
        }
    };
    append(message.mes);
    append(message.content);
    return [...new Set(candidates)];
}

function genericMessageSourceCandidates(message) {
    if (!message || typeof message !== 'object') return [];
    const candidates = [];
    const append = (value) => {
        if (typeof value === 'string') candidates.push(value);
        if (!Array.isArray(value)) return;
        const parts = value
            .map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : ''))
            .filter((part) => typeof part === 'string' && part.length > 0);
        if (parts.length) {
            candidates.push(parts.join(''));
            candidates.push(parts.join('\n'));
        }
    };
    append(message.mes);
    append(message.content);
    return [...new Set(candidates)];
}

function messageIsExplicitAssistant(message) {
    if (!message || typeof message !== 'object') return false;
    const role = String(message.role || '').toLowerCase();
    return role === 'assistant' || (!role && message.is_user === false && message.is_system !== true);
}

function receiptMarkerKeys(value) {
    const text = String(value ?? '');
    const keys = [];
    const patterns = [
        /<!--\s*(?:人物档案更新|人物档案无变化|Actor[_ -]?Profile[_ -]?(?:Update|No[_ -]?Change))(?=\s|>|$)/giu,
        /<(?:(?:人物档案更新)|(?:人物档案无变化)|(?:Actor[_ -]?Profile[_ -]?(?:Update|No[_ -]?Change)))(?=\s|>)/giu,
    ];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
        if (match[0]) keys.push(match[0]);
    }
    return [...new Set(keys)];
}

function countOccurrences(text, needle) {
    const source = String(text ?? '');
    const target = String(needle ?? '');
    if (!target) return 0;
    let count = 0;
    let offset = 0;
    while (true) {
        const index = source.indexOf(target, offset);
        if (index < 0) return count;
        count += 1;
        offset = index + Math.max(1, target.length);
    }
}

export function sanitizeFlatPromptByExactAssistantSource(prompt, sourceChat) {
    const original = String(prompt ?? '');
    let text = original;
    let replaced = 0;
    let unsupported = false;
    const catalog = (Array.isArray(sourceChat) ? sourceChat : []).flatMap((message) => (
        genericMessageSourceCandidates(message).map((source) => ({
            source,
            assistant: messageIsExplicitAssistant(message),
        }))
    ));
    for (const message of Array.isArray(sourceChat) ? sourceChat : []) {
        const candidates = assistantMessageSourceCandidates(message);
        let hadReceipt = false;
        let messageProved = false;
        for (const source of candidates) {
            const cleaned = stripActorProfileReceiptBlocks(source);
            if (!cleaned.removed) continue;
            // An exact source shared with user/system/unknown content has no
            // role provenance once flattened. Do not globally erase it.
            if (catalog.some((entry) => !entry.assistant && entry.source === source)) {
                unsupported = true;
                continue;
            }
            hadReceipt = true;
            const result = exactReplaceAll(text, source, cleaned.text);
            if (!result.count) continue;
            replaced += result.count;
            text = result.text;
            // One exact full-source candidate proves this assistant message;
            // another multimodal join variant may legitimately miss.
            messageProved = true;
            break;
        }
        if (hadReceipt && !messageProved) {
            const receiptStillPresent = candidates
                .flatMap((source) => extractActorProfileReceiptBlocks(source))
                .some((block) => text.includes(block));
            // A clipped assistant history is not a leak. Only an exact
            // dedicated receipt that remains without its full source is
            // ambiguous and therefore blocks the outgoing payload.
            if (receiptStillPresent) unsupported = true;
        }
    }
    return unsupported
        ? { prompt: original, replaced: 0, unsupported: true }
        : { prompt: text, replaced, unsupported: false };
}

export function inspectFlatPromptAfterAssistantChatSanitized(
    prompt,
    sourceChat,
    { assistantSanitized = false } = {},
) {
    const text = String(prompt ?? '');
    const assistantSources = [];
    const nonAssistantSources = [];
    for (const message of Array.isArray(sourceChat) ? sourceChat : []) {
        const target = messageIsExplicitAssistant(message) ? assistantSources : nonAssistantSources;
        target.push(...genericMessageSourceCandidates(message));
    }
    if (assistantSanitized) {
        const baselineMarkers = new Map();
        // A multimodal message has multiple formatter candidates, but it is
        // still one source message. Count the largest provable occurrence for
        // that message, then add messages; never add join variants as copies.
        for (const message of Array.isArray(sourceChat) ? sourceChat : []) {
            if (messageIsExplicitAssistant(message)) continue;
            const perMessage = new Map();
            for (const source of genericMessageSourceCandidates(message)) {
                for (const marker of receiptMarkerKeys(source)) {
                    const count = countOccurrences(source, marker);
                    perMessage.set(marker, Math.max(perMessage.get(marker) || 0, count));
                }
            }
            for (const [marker, count] of perMessage) {
                baselineMarkers.set(marker, (baselineMarkers.get(marker) || 0) + count);
            }
        }
        for (const source of assistantSources) {
            for (const marker of receiptMarkerKeys(source)) {
                const flatCount = countOccurrences(text, marker);
                const safeSystemCount = baselineMarkers.get(marker) || 0;
                if (flatCount > safeSystemCount) {
                    return { prompt: text, replaced: 0, unsupported: true };
                }
            }
        }
        return { prompt: text, replaced: 0, unsupported: false };
    }
    for (const source of assistantSources) {
        if (stripActorProfileReceiptBlocks(source).removed && text.includes(source)) {
            return { prompt: text, replaced: 0, unsupported: true };
        }
        for (const marker of receiptMarkerKeys(source)) {
            if (text.includes(marker)) return { prompt: text, replaced: 0, unsupported: true };
        }
    }
    return { prompt: text, replaced: 0, unsupported: false };
}

export function sanitizeActorProfilePromptPayload(eventData, sourceChat) {
    if (!eventData || typeof eventData !== 'object') {
        return { eventData, removed: 0, replaced: 0, unsupported: true, apiType: 'unknown' };
    }
    const next = clone(eventData);
    if (Array.isArray(eventData.chat)) {
        const result = sanitizeOutgoingChatCopy(eventData.chat);
        next.chat = result.chat;
        return { eventData: next, ...result, replaced: result.removed, unsupported: false, apiType: 'chat' };
    }
    if (typeof eventData.prompt === 'string') {
        const result = sanitizeFlatPromptByExactAssistantSource(eventData.prompt, sourceChat);
        next.prompt = result.prompt;
        return { eventData: next, removed: result.replaced, ...result, apiType: 'prompt' };
    }
    return { eventData: next, removed: 0, replaced: 0, unsupported: true, apiType: 'unknown' };
}

export function sanitizeActorProfilePromptPayloadInPlace(eventData, sourceChat) {
    const result = sanitizeActorProfilePromptPayload(eventData, sourceChat);
    if (result.unsupported) {
        if (typeof eventData?.prompt === 'string') eventData.prompt = '';
        if (Array.isArray(eventData?.chat)) eventData.chat = [];
        return result;
    }
    if (Array.isArray(result.eventData?.chat)) eventData.chat = result.eventData.chat;
    if (typeof result.eventData?.prompt === 'string') eventData.prompt = result.eventData.prompt;
    return result;
}

function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) || values instanceof Set ? [...values] : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

export function selectBoundedRelevantActorIds({
    inSceneActorIds = [], mentionedActorIds = [], eventActorIds = [],
    attemptedActorIds = [], receiptActorIds = [], relatedActorIds = [],
    maxActors = 6, maxChars = 3600, maxTokens = 900,
} = {}) {
    const ordered = [inSceneActorIds, mentionedActorIds, eventActorIds, attemptedActorIds, receiptActorIds, relatedActorIds];
    const ids = [];
    for (const group of ordered) for (const id of uniqueStrings(group)) if (!ids.includes(id)) ids.push(id);
    const actors = Math.max(0, Math.min(32, Math.floor(Number(maxActors) || 0)));
    const chars = Math.max(0, Math.min(20000, Math.floor(Number(maxChars) || 0)));
    const tokens = Math.max(0, Math.min(5000, Math.floor(Number(maxTokens) || 0)));
    return {
        actorIds: ids.slice(0, actors),
        maxActors: actors,
        maxChars: chars,
        maxTokens: tokens,
        omittedActorCount: Math.max(0, ids.length - actors),
    };
}

function text(value, max = 240) {
    return String(value ?? '').trim().slice(0, Math.max(0, max));
}

export function actorProfilePromptProjectionBounded(state, { maxChars = 600 } = {}) {
    const source = state && typeof state === 'object' ? state : {};
    const projection = {
        identity: text(source.identity || source.name || '', 160),
        relationship: text(source.relationship || source.relationshipStance || '', 180),
        location: text(source.location || '', 120),
        actionable: source.actionable === true,
        goal: text(source.goal || '', 180),
        blocker: text(source.blocker || '', 180),
        lastAction: text(source.lastAction || '', 180),
        lastOutcome: text(source.lastOutcome || '', 180),
        knowledge: text(source.knowledgeBoundary || source.knowledge || '', 200),
        capabilities: text(source.capabilities || source.ability || '', 180),
        resources: text(source.resources || '', 180),
    };
    const output = {};
    let used = 0;
    for (const [key, value] of Object.entries(projection)) {
        const candidate = `${key}=${typeof value === 'boolean' ? value : value}`;
        if (used + candidate.length > Math.max(0, Number(maxChars) || 0)) break;
        output[key] = value;
        used += candidate.length + 1;
    }
    return output;
}
