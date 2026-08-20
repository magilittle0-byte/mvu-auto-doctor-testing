import { fingerprint } from './core.mjs';

export const DOCTOR_CHAT_SCOPE_CORE_VERSION = 'doctor-chat-scope-core-v1';
export const DOCTOR_PROFILE_FOLD_KEY_PREFIX = 'mvu-auto-doctor-profile-fold-v1:';

export function normalizeChatId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const chatId = String(value).trim();
    return chatId && chatId.length <= 512 ? chatId : '';
}

export function doctorProfileFoldStorageKey(chatId) {
    const id = normalizeChatId(chatId);
    return id ? `${DOCTOR_PROFILE_FOLD_KEY_PREFIX}${fingerprint(id || 'no-chat')}` : '';
}

export function isExactDoctorChatStorageKey(key, chatId) {
    return String(key || '') === doctorProfileFoldStorageKey(chatId);
}

export function extractDeletedChatId(...args) {
    const options = args.at(-1)?.__doctorChatScopeOptions === true ? args.pop() : {};
    const allowPositionalString = options.allowPositionalString === true;
    const payloads = args;
    const candidates = [];
    for (const payload of payloads) {
        if (allowPositionalString && typeof payload === 'string') {
            candidates.push(normalizeChatId(payload));
            continue;
        }
        if (!payload || typeof payload !== 'object') continue;
        const values = ['chatId', 'chat_id']
            .filter((key) => Object.hasOwn(payload, key))
            .map((key) => normalizeChatId(payload[key]))
            .filter(Boolean);
        if (values.length && new Set(values).size !== 1) return '';
        candidates.push(values[0] || '');
    }
    const ids = [...new Set(candidates.filter(Boolean))];
    return ids.length === 1 ? ids[0] : '';
}

export function planDoctorChatScopeDisposal(chatId, currentChatId) {
    const id = normalizeChatId(chatId);
    const current = normalizeChatId(currentChatId);
    if (!id) return { ok: false, reason: 'chat_id_missing', current: false, storageKey: '' };
    return {
        ok: true,
        chatId: id,
        current: id === current,
        storageKey: doctorProfileFoldStorageKey(id),
        clearActiveScope: id === current,
        mayTouchDurableChatNamespace: false,
    };
}

export function authoritativeOrphanChatIds(existingChatIds, ownedChatIds, { authoritative = false } = {}) {
    if (!authoritative || !Array.isArray(existingChatIds) || !Array.isArray(ownedChatIds)) return [];
    const existing = new Set(existingChatIds.map(normalizeChatId).filter(Boolean));
    return [...new Set(ownedChatIds.map(normalizeChatId).filter(Boolean))].filter((id) => !existing.has(id));
}

export function boundedSetInsert(set, value, max = 512) {
    if (!(set instanceof Set)) return false;
    set.add(String(value || ''));
    while (set.size > Math.max(1, Math.floor(Number(max) || 1))) {
        const first = set.values().next().value;
        set.delete(first);
    }
    return true;
}
