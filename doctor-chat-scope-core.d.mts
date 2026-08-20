export const DOCTOR_CHAT_SCOPE_CORE_VERSION: string;
export const DOCTOR_PROFILE_FOLD_KEY_PREFIX: string;
export function normalizeChatId(value: unknown): string;
export function doctorProfileFoldStorageKey(chatId: unknown): string;
export function isExactDoctorChatStorageKey(key: unknown, chatId: unknown): boolean;
export function extractDeletedChatId(...payloads: unknown[]): string;
export function planDoctorChatScopeDisposal(chatId: unknown, currentChatId: unknown): Record<string, unknown>;
export function authoritativeOrphanChatIds(existingChatIds: unknown, ownedChatIds: unknown, options?: { authoritative?: boolean }): string[];
export function boundedSetInsert(set: Set<unknown>, value: unknown, max?: number): boolean;
