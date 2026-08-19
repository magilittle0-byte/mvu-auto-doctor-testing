import {
    extractLastUpdateBlock,
    fingerprint,
    parsePatchBlock,
    replaceUpdateBlocks,
} from './core.mjs';
import { actorRefFrom } from './actor-ref-core.mjs';
import {
    ACTOR_PROFILE_NARRATIVE_SECTION_KEYS,
    normalizeActorProfileV6,
    actorProfileBaselineDigest,
    validateActorProfileInsertCandidate,
} from './actor-profile-v6-core.mjs';

export const ACTOR_PROFILE_UPDATE_BLOCK = Object.freeze({
    start: '<人物档案更新>',
    end: '</人物档案更新>',
    schemaVersion: 1,
});

export const ACTOR_PROFILE_MVU_ROOT = '/人物档案/byActorId';
export const ACTOR_PROFILE_MVU_SCHEMA_VERSION = 1;

export const ACTOR_PROFILE_MVU_FIELDS = Object.freeze({
    displayName: '姓名与别名',
    identityBackground: '身份背景',
    personalityValues: '人格价值观',
    capabilityBoundary: '能力边界',
    physiology: '生理档案',
    longTermGoals: '长期目标',
    relationshipChanges: '关系变化',
    knownInformation: '已知信息',
    longTermPsychologicalChanges: '长期心理变化',
});

const NARRATIVE_KEYS = Object.freeze([
    'person', 'personality', 'history', 'currentState',
    'relationshipsMotives', 'knowledgeCapabilitiesResources',
]);
const FIELD_ALIASES = new Map([
    ['人物信息', 'person'], ['person', 'person'],
    ['生理特征', 'physiology'], ['生理', 'physiology'], ['physiology', 'physiology'],
    ['性格特征', 'personality'], ['personality', 'personality'],
    ['过往经历', 'history'], ['经历', 'history'], ['history', 'history'],
    ['当前状态', 'currentState'], ['状态', 'currentState'], ['现状', 'currentState'], ['currentstate', 'currentState'],
    ['关系与动机', 'relationshipsMotives'], ['关系动机', 'relationshipsMotives'],
    ['relationshipsmotives', 'relationshipsMotives'],
    ['知识、能力与资源', 'knowledgeCapabilitiesResources'],
    ['知识能力与资源', 'knowledgeCapabilitiesResources'],
    ['knowledgecapabilitiesresources', 'knowledgeCapabilitiesResources'],
    ['姓名', 'displayName'], ['姓名与别名', 'displayName'], ['名字', 'displayName'],
    ['名称', 'displayName'], ['name', 'displayName'], ['displayname', 'displayName'],
    ['别名', 'aliases'], ['aliases', 'aliases'],
    ['身份背景', 'identityBackground'], ['身份', 'identityBackground'],
    ['背景', 'identityBackground'], ['identitybackground', 'identityBackground'],
    ['人格价值观', 'personalityValues'], ['人格与价值观', 'personalityValues'],
    ['性格价值观', 'personalityValues'], ['人格', 'personalityValues'],
    ['personalityvalues', 'personalityValues'],
    ['能力边界', 'capabilityBoundary'], ['能力范围', 'capabilityBoundary'],
    ['能力限制', 'capabilityBoundary'], ['能力边界与限制', 'capabilityBoundary'],
    ['capabilityboundary', 'capabilityBoundary'],
    ['长期目标', 'longTermGoals'], ['长期目标与计划', 'longTermGoals'],
    ['目标', 'longTermGoals'], ['longtermgoals', 'longTermGoals'],
    ['关系变化', 'relationshipChanges'], ['关系', 'relationshipChanges'],
    ['relationships', 'relationshipChanges'], ['relationshipchanges', 'relationshipChanges'],
    ['已知信息', 'knownInformation'], ['知识', 'knownInformation'],
    ['knowledge', 'knownInformation'], ['knowninformation', 'knownInformation'],
    ['长期心理变化', 'longTermPsychologicalChanges'], ['心理变化', 'longTermPsychologicalChanges'],
    ['长期心理', 'longTermPsychologicalChanges'],
    ['longtermpsychologicalchanges', 'longTermPsychologicalChanges'],
]);

const TECHNICAL_FAILURE = 'profile_technical_field_model_owned';
const FIXED_FAILURES = Object.freeze({
    DUPLICATE_BLOCK: 'profile_block_duplicate',
    UNCLOSED_BLOCK: 'profile_block_unclosed',
    TOO_LARGE: 'profile_block_too_large',
    NO_ENTRIES: 'profile_block_no_entries',
    NAME_MISSING: 'profile_entry_name_missing',
    TICKET_MISSING: 'profile_entry_ticket_missing',
    ACTOR_ID_MISSING: 'profile_entry_actor_id_missing',
    TICKET_UNKNOWN: 'profile_ticket_unknown',
    TICKET_ACTOR_MISSING: 'profile_ticket_actor_id_missing',
    ACTOR_UNKNOWN: 'profile_actor_id_unknown',
    ACTOR_CONFLICT: 'profile_actor_name_conflict',
    ANCHOR_MISSING: 'profile_source_anchor_missing',
    INCOMPLETE: 'profile_entry_incomplete',
    TECHNICAL: TECHNICAL_FAILURE,
    ROOT_MISSING: 'profile_root_missing',
    SOURCE_INCOMPLETE: 'profile_sourceref_incomplete',
    ACTOR_EXISTS: 'profile_actor_already_exists',
    PATH_INVALID: 'profile_path_invalid',
    BLOCK_POSITION: 'profile_block_position_invalid',
    LOCKED: 'profile_entry_locked',
    MIGRATION_INCOMPLETE: 'profile_legacy_migration_incomplete',
});

export const ACTOR_PROFILE_FAILURE_CODES = FIXED_FAILURES;

const TECHNICAL_KEYS = new Set([
    'revision', '修订', 'digest', 'profiledigest', '档案摘要', 'sourceref',
    '来源引用', '来源锚点', 'sourcerefdigest', '来源摘要', 'status',
    'inferredfields', '推断字段', 'commitid', '提交号', 'patch', '补丁',
    'jsonpatch', 'json补丁', 'metadata', 'meta', '技术字段', '技术元数据',
    'version', '版本',
]);
const AMBIGUOUS_TECHNICAL_KEYS = new Set(['状态', '摘要', '来源引用', '来源摘要', '版本']);
const TECHNICAL_STATUS_VALUES = new Set([
    'pending', 'complete', 'readback_ready', 'ready', 'failed', 'quarantined',
    'persist_failed', 'unverified', '待处理', '完整', '已回读', '就绪', '失败', '隔离',
]);

function text(value, max = 1200) {
    return String(value ?? '').replace(/[ \t\r\n]+/gu, ' ').trim().slice(0, max);
}
function nonEmpty(value) {
    return typeof value === 'string' ? Boolean(text(value))
        : Array.isArray(value) ? value.some((item) => Boolean(text(item)))
            : Boolean(value);
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function pointerPart(value) { return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1'); }
function normalizeFieldKey(value) {
    const raw = text(value, 100);
    const key = raw.replace(/[：:。.!！?？、,，\s]/gu, '').toLocaleLowerCase();
    return FIELD_ALIASES.get(key) || FIELD_ALIASES.get(raw) || '';
}
function isTechnicalKey(key) {
    const normalized = String(key ?? '').replace(/[\s_\-]/gu, '').toLocaleLowerCase();
    return TECHNICAL_KEYS.has(normalized);
}
function isAmbiguousTechnicalKey(key) {
    const normalized = String(key ?? '').replace(/[\s_\-]/gu, '').toLocaleLowerCase();
    return AMBIGUOUS_TECHNICAL_KEYS.has(normalized);
}
function looksLikeTechnicalValue(key, value) {
    const normalized = String(key ?? '').replace(/[\s_\-]/gu, '').toLocaleLowerCase();
    if (normalized === '状态') {
        return typeof value === 'string' && TECHNICAL_STATUS_VALUES.has(value.trim().toLocaleLowerCase());
    }
    if (normalized === '版本') {
        return typeof value === 'number' || (typeof value === 'string' && /^v?\d+(?:\.\d+){0,3}$/iu.test(value.trim()));
    }
    if (normalized === '摘要' || normalized === '来源摘要') {
        return Boolean(value && typeof value === 'object' && (
            Object.keys(value).some((childKey) => /digest|hash|摘要|指纹/iu.test(childKey))
        ));
    }
    if (normalized === '来源引用') {
        return Boolean(value && typeof value === 'object' && (
            Object.keys(value).some((childKey) => /chat.?id|message.?id|generation|scope|digest|hash|索引|消息/iu.test(childKey))
        ));
    }
    return false;
}
function containsTechnicalField(value, { semantic = false } = {}) {
    if (Array.isArray(value)) return value.some((item) => containsTechnicalField(item, { semantic }));
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
        const strong = isTechnicalKey(key) && !isAmbiguousTechnicalKey(key);
        const ambiguous = !semantic && isAmbiguousTechnicalKey(key) && looksLikeTechnicalValue(key, child);
        if (strong || ambiguous) return true;
        const normalized = String(key ?? '').replace(/[\s_\-]/gu, '').toLocaleLowerCase();
        const childSemantic = semantic || ['fields', 'stable', 'evolving', '稳定档案', '演化档案', 'narrativesections'].includes(normalized);
        return containsTechnicalField(child, { semantic: childSemantic });
    });
}
function parseList(value) {
    return [...new Set(String(value || '').split(/[；;、,，\n]/u).map((item) => text(item)).filter(Boolean))].slice(0, 24);
}
function fieldMissing(value) { return !nonEmpty(value) || (typeof value === 'string' && text(value).length < 2); }

function parseIdentityHeader(line) {
    const source = text(line, 500).replace(/^[-*•]\s*/u, '');
    const match = source.match(/^(新增人物|已有角色|人物(?!信息|档案)|角色(?!档案)|new|existing)\s*(?:[|｜:]\s*)?(.*)$/iu);
    if (!match) return null;
    const mode = /已有角色|existing/iu.test(match[1]) ? 'existing' : 'new';
    const result = { mode, actorId: '', ticketId: '', name: '', sourceAnchor: '' };
    const payload = text(match[2]);
    const direct = (pattern) => payload.match(pattern)?.[1]?.trim() || '';
    result.actorId = direct(/(?:actor.?id|角色id)\s*[=：:]\s*([^|｜]+)/iu);
    result.ticketId = direct(/(?:ticket|票据)\s*[=：:]\s*([^|｜]+)/iu);
    result.sourceAnchor = direct(/(?:锚点|anchor|正文行)\s*[=：:]\s*([^|｜]+)/iu);
    result.name = direct(/(?:姓名与别名|姓名|名字|名称|name)\s*[=：:]\s*([^|｜]+)/iu);
    for (const part of payload.split(/[|｜]/u).map(text).filter(Boolean)) {
        const pair = part.match(/^([^=：:]+)[=：:](.*)$/u);
        if (!pair) { if (!result.name) result.name = part; continue; }
        const key = text(pair[1], 80).toLocaleLowerCase();
        const value = text(pair[2], 400);
        if (/actor.?id|角色id/iu.test(key)) result.actorId = value;
        else if (/ticket|票据/iu.test(key)) result.ticketId = value;
        else if (/锚点|anchor|正文行/iu.test(key)) result.sourceAnchor = value;
        else if (/姓名|名字|名称|name/iu.test(key)) result.name = value;
    }
    return result;
}

function normalizeEntry(entry) {
    const next = {
        mode: entry?.mode === 'existing' ? 'existing' : 'new',
        actorId: text(entry?.actorId, 160), ticketId: text(entry?.ticketId, 160),
        ticketMetadata: null, name: text(entry?.name, 160), aliases: [],
        sourceAnchor: text(entry?.sourceAnchor, 1200), fields: {},
    };
    next.aliases = [...new Set((Array.isArray(entry?.aliases) ? entry.aliases : [])
        .map((item) => text(item, 160)).filter(Boolean))].slice(0, 12);
    for (const [rawKey, value] of Object.entries(entry?.fields || {})) {
        if (!nonEmpty(value)) continue;
        if (isTechnicalKey(rawKey)) continue;
        const key = normalizeFieldKey(rawKey) || text(rawKey, 80);
        next.fields[key] = Array.isArray(value) ? parseList(value.join('；')) : text(value, 4000);
    }
    if (next.fields.displayName && !next.name) next.name = text(next.fields.displayName, 160);
    delete next.fields.displayName;
    if (next.fields.aliases) {
        next.aliases = [...new Set([...next.aliases, ...parseList(next.fields.aliases)])].slice(0, 12);
        delete next.fields.aliases;
    }
    return next;
}

function structuredEntries(block) {
    const source = String(block || '').replace(/^```(?:json|markdown|text)?\s*/iu, '').replace(/\s*```$/u, '').trim();
    if (!/^[\[{]/u.test(source)) return null;
    let parsed;
    try { parsed = JSON.parse(source); } catch { return null; }
    const root = Array.isArray(parsed) ? parsed : parsed?.['人物档案更新'] || parsed?.profileUpdates || parsed?.entries || parsed;
    const rows = Array.isArray(root) ? root : [root];
    if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) return null;
    return rows.map((row) => {
        const stable = row.稳定档案 || row.stable || {};
        const evolving = row.演化档案 || row.evolving || {};
        const fields = { ...row.fields, ...row.narrativeSections, ...stable, ...evolving };
        return {
            mode: /existing|已有|更新/iu.test(String(row.mode || row.type || '')) ? 'existing' : 'new',
            actorId: row.actorId || row.actor_id || row.ActorId || '',
            ticketId: row.ticketId || row.ticket || row['票据'] || '',
            name: row.name || row.displayName || row['姓名'] || '',
            aliases: row.aliases || row['别名'] || [],
            sourceAnchor: row.sourceAnchor || row.anchor || row['正文锚点'] || '',
            fields,
            __technical: containsTechnicalField({ ...row, fields }),
        };
    });
}

function acceptedProfileBlockFloor(source) {
    const tokens = [
        '</content>', '</options>', '</updatevariable>', '<statusplaceholderimpl',
    ];
    const lower = String(source || '').toLocaleLowerCase();
    return tokens.reduce((floor, token) => Math.max(floor, lower.lastIndexOf(token)), -1);
}

export function extractActorProfileUpdateBlock(output, {
    maxCharacters = 48000,
    requireAcceptedTail = true,
    repairUnclosedAtEof = true,
} = {}) {
    const source = String(output ?? '');
    const matches = [
        ...source.matchAll(/<人物档案更新(?:\s[^>]*)?>/gu),
        ...source.matchAll(/<!--[ \t]*人物档案更新(?:[ \t\r\n]|$)/gu),
    ].sort((a, b) => a.index - b.index);
    if (!matches.length) return {
        ok: true, present: false, block: '', entries: [], failures: [], repairs: [],
    };
    if (matches.length !== 1) return { ok: false, present: true, block: '', entries: [], failures: [FIXED_FAILURES.DUPLICATE_BLOCK] };
    const opener = matches[0][0];
    if (requireAcceptedTail && matches[0].index < acceptedProfileBlockFloor(source)) {
        return {
            ok: false,
            present: true,
            block: '',
            entries: [],
            failures: [FIXED_FAILURES.BLOCK_POSITION],
            repairs: [],
        };
    }
    const start = matches[0].index + opener.length;
    const endToken = opener.startsWith('<!--') ? '-->' : ACTOR_PROFILE_UPDATE_BLOCK.end;
    let end = source.indexOf(endToken, start);
    const repairs = [];
    if (end < 0 && repairUnclosedAtEof) {
        const tail = source.slice(start).trim();
        const hasForeignControlTail = /<(?:content|options|updatevariable|statusplaceholderimpl)\b/iu.test(tail);
        if (tail && !hasForeignControlTail && tail.length <= maxCharacters) {
            end = source.length;
            repairs.push('profile_block_closed_at_eof');
        }
    }
    if (end < 0) return { ok: false, present: true, block: '', entries: [], failures: [FIXED_FAILURES.UNCLOSED_BLOCK], repairs };
    const block = source.slice(start, end).trim();
    if (block.length > maxCharacters) return { ok: false, present: true, block: '', entries: [], failures: [FIXED_FAILURES.TOO_LARGE] };
    return { ok: true, present: true, block, entries: [], failures: [], repairs };
}

export function parseActorProfileUpdateBlock(output, options = {}) {
    const extracted = options.extracted || extractActorProfileUpdateBlock(output, options);
    if (!extracted.ok || !extracted.present) {
        return { ...extracted, entries: [], quarantined: [], repairs: extracted.repairs || [] };
    }
    const structured = structuredEntries(extracted.block);
    if (structured) {
        const entries = [];
        const quarantined = [];
        for (const [index, row] of structured.entries()) {
            const entry = normalizeEntry(row);
            const failures = [];
            if (row.__technical) failures.push(TECHNICAL_FAILURE);
            if (!entry.name) failures.push(FIXED_FAILURES.NAME_MISSING);
            if (entry.mode === 'new' && !entry.ticketId) failures.push(FIXED_FAILURES.TICKET_MISSING);
            if (entry.mode === 'existing' && !entry.actorId) failures.push(FIXED_FAILURES.ACTOR_ID_MISSING);
            if (failures.length) quarantined.push({ index, entry, reason: failures[0], failures });
            else entries.push(entry);
        }
        const failures = entries.length || quarantined.length
            ? [] : [FIXED_FAILURES.NO_ENTRIES];
        return {
            ...extracted,
            ok: entries.length > 0 && failures.length === 0,
            entries,
            quarantined,
            failures,
            repairs: [...new Set([...(extracted.repairs || []), 'profile_json_wrapper_parsed'])],
        };
    }
    const lines = extracted.block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const rawEntries = []; let current = null; let activeSection = '';
    for (const line of lines) {
        const header = parseIdentityHeader(line);
        if (header) {
            if (current) rawEntries.push(current);
            current = { ...header, fields: {}, __failures: [] };
            activeSection = '';
            continue;
        }
        if (!current) continue;
        if (/^(稳定档案|基础档案|stable)\s*[：:]?$/iu.test(line)) { activeSection = 'stable'; continue; }
        if (/^(演化档案|长期演化|evolving)\s*[：:]?$/iu.test(line)) { activeSection = 'evolving'; continue; }
        const pair = line.match(/^(?:[-*•]\s*)?([^：:]{1,80})\s*[：:＝=]\s*(.*)$/u);
        if (!pair) continue;
        const rawKey = text(pair[1], 80); const rawValue = text(pair[2], 4000);
        if ((isTechnicalKey(rawKey) && !isAmbiguousTechnicalKey(rawKey))
            || (isAmbiguousTechnicalKey(rawKey) && looksLikeTechnicalValue(rawKey, rawValue))) {
            current.__failures.push(TECHNICAL_FAILURE); continue;
        }
        const key = normalizeFieldKey(rawKey);
        if (/actor.?id|角色id/iu.test(rawKey)) current.actorId = rawValue;
        else if (/ticket|票据/iu.test(rawKey)) current.ticketId = rawValue;
        else if (/锚点|anchor|正文行/iu.test(rawKey)) current.sourceAnchor = rawValue;
        else if (/^(姓名|名字|名称|name)$/iu.test(rawKey)) current.name = rawValue;
        else if (/^别名|aliases?$/iu.test(rawKey)) current.aliases = parseList(rawValue);
        else if (key) current.fields[key] = current.fields[key] ? `${current.fields[key]}；${rawValue}` : rawValue;
        else if (activeSection && !isTechnicalKey(activeSection)) current.fields[activeSection] = current.fields[activeSection]
            ? `${current.fields[activeSection]}；${rawValue}` : rawValue;
    }
    if (current) rawEntries.push(current);
    const entries = [];
    const quarantined = [];
    for (const [index, raw] of rawEntries.entries()) {
        const entry = normalizeEntry(raw);
        const failures = [...new Set(raw.__failures || [])];
        if (!entry.name) failures.push(FIXED_FAILURES.NAME_MISSING);
        if (entry.mode === 'new' && !entry.ticketId) failures.push(FIXED_FAILURES.TICKET_MISSING);
        if (entry.mode === 'existing' && !entry.actorId) failures.push(FIXED_FAILURES.ACTOR_ID_MISSING);
        if (containsTechnicalField(entry.fields)) failures.push(TECHNICAL_FAILURE);
        if (failures.length) quarantined.push({ index, entry, reason: failures[0], failures });
        else entries.push(entry);
    }
    const failures = rawEntries.length ? [] : [FIXED_FAILURES.NO_ENTRIES];
    return {
        ...extracted,
        ok: entries.length > 0 && failures.length === 0,
        entries,
        quarantined,
        failures,
        repairs: [...new Set(extracted.repairs || [])],
    };
}

function ticketIdentity(ticket) {
    const reserved = ticket?.reservedActorRef || ticket?.stableActorRef
        || (ticket?.binding?.status === 'reserved' ? ticket.binding.actorRef : null);
    const ref = reserved ? actorRefFrom(reserved, { allowCreate: false }) : null;
    const reservation = ticket?.reservation;
    const actorId = ref && reservation?.status === 'reserved'
        && String(reservation.actorId || '') === ref.actorId ? ref.actorId : '';
    const ticketId = text(ticket?.ticketId || ticket?.id, 160);
    const order = Number(ticket?.issuance?.order || ticket?.order);
    return {
        ticketId,
        ticketAliases: [ticketId, ticketId.replace(/^NPC-DICE[-_:]?/iu, ''),
            Number.isInteger(order) && order > 0 ? String(order) : '',
            Number.isInteger(order) && order > 0 ? `票据${order}` : '']
            .map((item) => text(item, 160).toLocaleLowerCase()).filter(Boolean),
        actorId,
        name: text(ticket?.name || ticket?.actorRef?.name || ref?.displayName, 160),
        ticketMetadata: ticket?.metadata || ticket?.ticketMetadata || null,
        reservation,
    };
}

export function bindActorProfileUpdateEntries(parsed, { tickets = [], actors = [], acceptedNarrative = '', acceptedTarget = null } = {}) {
    const source = parsed && Array.isArray(parsed.entries) ? parsed : parseActorProfileUpdateBlock(parsed);
    const byTicket = new Map();
    for (const ticket of Array.isArray(tickets) ? tickets : []) {
        const identity = ticketIdentity(ticket);
        if (acceptedTarget && identity.reservation) {
            const reservation = identity.reservation;
            const mismatched = (
                String(reservation.chatId || '') !== String(acceptedTarget.chatId || '')
                || String(reservation.generationId || '') !== String(acceptedTarget.generationId || '')
                || Number(reservation.generationSerial) !== Number(acceptedTarget.generationSerial)
                || (reservation.generationType
                    && String(reservation.generationType) !== String(acceptedTarget.generationType || acceptedTarget.type || ''))
                || (reservation.scopeDigest
                    && String(reservation.scopeDigest) !== String(acceptedTarget.scopeDigest || ''))
            );
            if (reservation.status !== 'reserved' || mismatched) continue;
        }
        for (const alias of identity.ticketAliases) byTicket.set(alias, [...(byTicket.get(alias) || []), identity]);
    }
    const byActor = new Map((Array.isArray(actors) ? actors : []).map((actor) => [
        text(actor?.id || actor?.actorId, 160),
        { actorId: text(actor?.id || actor?.actorId, 160), name: text(actor?.name, 160) },
    ]).filter(([id]) => id));
    const entries = [];
    const failures = [...(source.failures || [])];
    const quarantined = [...(source.quarantined || [])];
    for (const raw of source.entries || []) {
        const entry = normalizeEntry(raw); let identity = null;
        if (entry.mode === 'new') {
            const key = text(entry.ticketId, 160).toLocaleLowerCase().replace(/^票据\s*/u, '');
            const matches = byTicket.get(key) || [];
            if (matches.length !== 1) {
                quarantined.push({
                    entry,
                    reason: FIXED_FAILURES.TICKET_UNKNOWN,
                    failures: [FIXED_FAILURES.TICKET_UNKNOWN],
                });
                continue;
            }
            identity = matches[0];
            if (!identity.actorId) {
                quarantined.push({ entry, reason: FIXED_FAILURES.TICKET_ACTOR_MISSING,
                    failures: [FIXED_FAILURES.TICKET_ACTOR_MISSING] });
                continue;
            }
            if (entry.sourceAnchor && acceptedNarrative && !acceptedNarrative.includes(entry.sourceAnchor)) {
                quarantined.push({ entry, reason: FIXED_FAILURES.ANCHOR_MISSING,
                    failures: [FIXED_FAILURES.ANCHOR_MISSING] });
                continue;
            }
        } else {
            identity = byActor.get(entry.actorId);
            if (!identity) {
                quarantined.push({ entry, reason: FIXED_FAILURES.ACTOR_UNKNOWN,
                    failures: [FIXED_FAILURES.ACTOR_UNKNOWN] });
                continue;
            }
            if (identity.name && entry.name && identity.name !== entry.name) {
                quarantined.push({ entry, reason: FIXED_FAILURES.ACTOR_CONFLICT,
                    failures: [FIXED_FAILURES.ACTOR_CONFLICT] });
                continue;
            }
        }
        entries.push({ ...entry, actorId: identity.actorId, name: identity.name || entry.name,
            ticketId: identity.ticketId || entry.ticketId, ticketMetadata: identity.ticketMetadata || null });
    }
    return {
        ok: failures.length === 0 && entries.length > 0,
        entries,
        failures: [...new Set(failures)],
        quarantined,
        source,
    };
}

export function validateActorProfileUpdateEntry(entry, { mode = entry?.mode || 'new' } = {}) {
    const rawFields = entry?.fields || {};
    const technical = containsTechnicalField(rawFields)
        || Object.entries(rawFields).some(([key, value]) => (
            (isTechnicalKey(key) && !isAmbiguousTechnicalKey(key))
            || (isAmbiguousTechnicalKey(key) && looksLikeTechnicalValue(key, value))
        ));
    const normalized = normalizeEntry({ ...entry, mode });
    const missingFields = mode === 'new'
        ? NARRATIVE_KEYS.filter((field) => fieldMissing(normalized.fields[field]))
        : Object.keys(normalized.fields).length ? [] : ['delta'];
    return {
        ok: !technical && missingFields.length === 0,
        entry: normalized,
        missingFields,
        failures: technical ? [TECHNICAL_FAILURE] : [],
        complete: missingFields.length === 0 && !technical,
    };
}

export function profileReadiness(profile) {
    const source = profile && typeof profile === 'object' ? profile : {};
    if (source.profileFormat !== 'narrative-v1') return { ready: false, complete: false, readbackReady: false, missingFields: NARRATIVE_KEYS, reason: 'profile_format_invalid' };
    const sections = source.narrativeSections || {};
    const missingFields = NARRATIVE_KEYS.filter((key) => fieldMissing(sections[key]?.text || sections[key])
        || !['confirmed', 'designed_seed', 'hypothesis'].includes(text(sections[key]?.source, 40)));
    const meta = source.本地元数据 || source.localMetadata || {};
    const readbackReady = meta.readbackVerified === true;
    const complete = missingFields.length === 0;
    return {
        ready: complete && readbackReady && ['complete', 'readback_ready'].includes(text(meta.status, 40)),
        complete, readbackReady, missingFields,
        reason: !complete ? 'profile_incomplete' : !readbackReady ? 'profile_readback_unverified' : '',
    };
}

export function actorProfileMvuPath(actorId, profileRoot = '') {
    const root = String(profileRoot || '').replace(/\/$/u, '');
    return root && text(actorId, 160) ? `${root}/${pointerPart(text(actorId, 160))}` : '';
}

function sourceRefComplete(value) {
    return Boolean(value && text(value.chatId, 180) && text(value.messageId, 180)
        && Number.isInteger(Number(value.index ?? value.logicalIndex))
        && text(value.generationId, 180) && Number.isFinite(Number(value.generationSerial ?? value.generation))
        && text(value.generationType, 80) && text(value.scopeDigest, 180)
        && text(value.contentFingerprint || value.contentHash || value.hash, 180));
}
function profileSections(entry, old = null) {
    const oldSections = old?.narrativeSections || {};
    const value = (key, fallback = '') => text(entry.fields[key] || fallback, 4000);
    const combined = (a, b) => [a, b].filter(Boolean).join('；');
    const sections = {};
    const fallback = {
        person: entry.fields.person || entry.fields.identityBackground || oldSections.person?.text || '',
        personality: entry.fields.personality || entry.fields.personalityValues || oldSections.personality?.text || '',
        history: entry.fields.history || oldSections.history?.text || '',
        currentState: entry.fields.currentState || entry.fields.longTermPsychologicalChanges || oldSections.currentState?.text || '',
        relationshipsMotives: entry.fields.relationshipsMotives
            || combined(entry.fields.longTermGoals, entry.fields.relationshipChanges)
            || oldSections.relationshipsMotives?.text || '',
        knowledgeCapabilitiesResources: entry.fields.knowledgeCapabilitiesResources
            || combined(entry.fields.capabilityBoundary, entry.fields.knownInformation)
            || oldSections.knowledgeCapabilitiesResources?.text || '',
        physiology: oldSections.physiology?.text || '',
    };
    for (const key of [...NARRATIVE_KEYS, 'physiology']) {
        let mapped = key;
        if (key === 'person') mapped = 'identityBackground';
        if (key === 'history') mapped = 'history';
        if (key === 'personality') mapped = 'personality';
        if (key === 'currentState') mapped = 'currentState';
        if (key === 'relationshipsMotives') mapped = 'relationshipsMotives';
        if (key === 'knowledgeCapabilitiesResources') mapped = 'knowledgeCapabilitiesResources';
        if (entry.mode === 'existing' && oldSections[key] && !entry.fields[mapped]
            && !(key === 'person' && entry.fields.identityBackground)
            && !(key === 'history' && entry.fields.identityBackground)
            && !(key === 'personality' && entry.fields.personalityValues)
            && !(key === 'currentState' && (entry.fields.currentState || entry.fields.longTermPsychologicalChanges))
            && !(key === 'relationshipsMotives' && (entry.fields.longTermGoals || entry.fields.relationshipChanges))
            && !(key === 'knowledgeCapabilitiesResources' && (entry.fields.capabilityBoundary || entry.fields.knownInformation))) {
            sections[key] = { ...oldSections[key] };
            continue;
        }
        const direct = value(mapped, fallback[key]);
        const mappedValue = key === 'person' || key === 'history'
            ? value('identityBackground', fallback[key])
            : key === 'personality'
                ? value('personalityValues', fallback[key])
            : key === 'relationshipsMotives'
                ? combined(value('longTermGoals'), value('relationshipChanges')) || fallback[key]
                : key === 'knowledgeCapabilitiesResources'
                    ? combined(value('capabilityBoundary'), value('knownInformation')) || fallback[key]
                    : key === 'currentState'
                        ? value('currentState', fallback[key]) || value('longTermPsychologicalChanges', fallback[key])
                    : direct;
        sections[key] = { key, title: key, text: mappedValue, source: 'hypothesis', evidence: [] };
    }
    return sections;
}

function sectionLocked(profile, key) {
    const locks = profile?.locks || {};
    return locks.actor === true || locks[key] === true
        || locks[`narrativeSections.${key}`] === true
        || locks[`narrativeSections.${key}.text`] === true;
}

function changedNarrativeKeys(entry) {
    const fields = entry?.fields || {};
    return NARRATIVE_KEYS.filter((key) => {
        if (fields[key]) return true;
        if (key === 'person') return Boolean(fields.identityBackground);
        if (key === 'personality') return Boolean(fields.personalityValues);
        if (key === 'currentState') return Boolean(fields.longTermPsychologicalChanges);
        if (key === 'relationshipsMotives') return Boolean(fields.longTermGoals || fields.relationshipChanges);
        if (key === 'knowledgeCapabilitiesResources') return Boolean(fields.capabilityBoundary || fields.knownInformation);
        return false;
    });
}

export function compileActorProfileMvuPatch(bound, {
    profileRoot = ACTOR_PROFILE_MVU_ROOT,
    profileRootPresent = null,
    existingProfiles = {},
    sourceRef = {},
    now = Date.now(),
    readbackVerified = false,
} = {}) {
    const source = bound && Array.isArray(bound.entries) ? bound : { entries: [], failures: ['profile_binding_missing'] };
    const failures = [...(source.failures || [])];
    const quarantined = [...(source.quarantined || [])];
    const operations = []; const profiles = {}; const writeSet = [];
    if (!String(profileRoot || '').trim()) failures.push(FIXED_FAILURES.ROOT_MISSING);
    if (!sourceRefComplete(sourceRef)) failures.push(FIXED_FAILURES.SOURCE_INCOMPLETE);
    if (!String(profileRoot || '').trim() || !sourceRefComplete(sourceRef)) {
        return { ok: false, operations: [], profiles: {}, failures: [...new Set(failures)], quarantined: [...new Set(failures)], committableActorIds: [], emptyOperations: true, commitStatus: 'quarantined', writeSet: [], atomic: false, profileRoot };
    }
    const shouldCreateRoot = profileRoot === ACTOR_PROFILE_MVU_ROOT
        && (profileRootPresent === false
            || (profileRootPresent == null && Object.keys(existingProfiles || {}).length === 0));
    if (shouldCreateRoot) {
        operations.push({
            op: 'insert',
            path: '/人物档案',
            value: { schemaVersion: ACTOR_PROFILE_MVU_SCHEMA_VERSION, byActorId: {} },
        });
    }
    for (const [index, raw] of source.entries.entries()) {
        const validation = validateActorProfileUpdateEntry(raw);
        if (!validation.ok) {
            const reason = validation.failures[0] || FIXED_FAILURES.INCOMPLETE;
            failures.push(reason); quarantined.push({ index, actorId: text(raw?.actorId, 160), reason, missingFields: validation.missingFields.slice(0, 12) });
            continue;
        }
        const entry = validation.entry; const actorId = entry.actorId;
        const old = existingProfiles?.[actorId] && typeof existingProfiles[actorId] === 'object' ? existingProfiles[actorId] : null;
        if (entry.mode === 'new' && old) {
            const priorTicket = text(old?.本地元数据?.ticketId || old?.localMetadata?.ticketId, 160);
            // A durable profile may already exist when message replay or
            // Registry projection failed after the MVU write. The same exact
            // ticket is an idempotent retry; a different ticket remains an
            // identity conflict and cannot overwrite the actor.
            if (!priorTicket || priorTicket !== entry.ticketId) {
                failures.push(FIXED_FAILURES.ACTOR_EXISTS);
                quarantined.push({ index, actorId, reason: FIXED_FAILURES.ACTOR_EXISTS });
                continue;
            }
        }
        const lockedKey = old && changedNarrativeKeys(entry).find((key) => sectionLocked(old, key));
        if (lockedKey) {
            failures.push(FIXED_FAILURES.LOCKED);
            quarantined.push({ index, actorId, reason: FIXED_FAILURES.LOCKED, lockedField: lockedKey });
            continue;
        }
        const sections = profileSections(entry, old);
        const candidate = {
            profileFormat: 'narrative-v1',
            actorRef: { kind: 'actor_ref', actorId, name: entry.name },
            narrativeSections: sections,
            locks: old?.locks || {},
            manualOverrides: old?.manualOverrides || {},
        };
        const checked = validateActorProfileInsertCandidate(candidate, { actorRef: { actorId, name: entry.name }, completionMode: 'basic' });
        if (!checked.ok) { failures.push(FIXED_FAILURES.INCOMPLETE); quarantined.push({ index, actorId, reason: FIXED_FAILURES.INCOMPLETE, missingFields: checked.missingFields?.slice(0, 12) || [] }); continue; }
        const profile = normalizeActorProfileV6({ ...checked.candidate, actorId, name: entry.name, completionMode: 'basic' }, { actorId, name: entry.name, mode: 'basic' });
        profile.actorRef = { kind: 'actor_ref', actorId, name: entry.name, aliases: entry.aliases };
        profile.姓名与别名 = { 姓名: entry.name, 别名: [...new Set([...(old?.姓名与别名?.别名 || []), ...entry.aliases])] };
        profile.本地元数据 = {
            ticketId: entry.ticketId || old?.本地元数据?.ticketId || '',
            ticketMetadata: entry.ticketMetadata || old?.本地元数据?.ticketMetadata || null,
            sourceRef: { ...sourceRef },
            sourceRefDigest: `profile-source:${fingerprint(JSON.stringify(canonical(sourceRef)))}`,
            revision: Number.isInteger(old?.本地元数据?.revision) ? old.本地元数据.revision + 1 : 1,
            status: 'complete', readbackVerified: Boolean(readbackVerified), inferredFields: [], updatedAt: new Date(now).toISOString(),
        };
        const path = actorProfileMvuPath(actorId, profileRoot);
        if (!path) { failures.push(FIXED_FAILURES.PATH_INVALID); quarantined.push({ index, actorId, reason: FIXED_FAILURES.PATH_INVALID }); continue; }
        operations.push({ op: old ? 'replace' : 'insert', path, value: profile }); profiles[actorId] = profile;
        writeSet.push({ actorId, path, revision: profile.本地元数据.revision, status: 'complete', profileDigest: actorProfileBaselineDigest(profile), sourceRef: { ...sourceRef } });
    }
    const committableActorIds = writeSet.map((row) => row.actorId);
    const meaningfulOperations = operations.filter((op) => op.path !== '/人物档案');
    if (!meaningfulOperations.length) operations.length = 0;
    const partial = failures.length > 0 || quarantined.length > 0;
    return { ok: operations.length > 0, operations, profiles, failures: [...new Set(failures)], quarantined, committableActorIds, emptyOperations: operations.length === 0, commitStatus: operations.length === 0 ? 'quarantined' : partial ? 'partial' : 'committable', writeSet, atomic: !partial, profileRoot };
}

export function markActorProfileReadback(profile, { verified = true } = {}) {
    const next = structuredClone(profile || {}); const meta = next.本地元数据 || next.localMetadata || {};
    next.本地元数据 = { ...meta, status: verified ? 'readback_ready' : 'persist_failed', readbackVerified: Boolean(verified) };
    delete next.localMetadata; return next;
}
export function actorProfileMvuDigest(profile) { return actorProfileBaselineDigest(profile); }

function profileOperation(op) {
    const path = String(op?.path || op?.to || '');
    const from = String(op?.from || '');
    return path === '/人物档案' || path.startsWith('/人物档案/')
        || from === '/人物档案' || from.startsWith('/人物档案/');
}

function renderUpdateVariableBlock(operations, analysis = '') {
    const safeAnalysis = text(analysis, 2000)
        .replace(/<\/?(?:UpdateVariable|JSONPatch)>/giu, '');
    return [
        '<UpdateVariable>', '<Analysis>', safeAnalysis, '</Analysis>', '<JSONPatch>',
        JSON.stringify(operations, null, 2), '</JSONPatch>', '</UpdateVariable>',
    ].join('\n');
}

export function mergeActorProfileOperationsIntoAcceptedMessage(messageText, operations = []) {
    const incoming = (Array.isArray(operations) ? operations : []).filter(profileOperation);
    if (!incoming.length) return { ok: false, reason: 'profile_zero_write', text: String(messageText || ''), operations: [] };
    const currentBlock = extractLastUpdateBlock(messageText);
    const parsed = currentBlock ? parsePatchBlock(currentBlock) : { ops: [] };
    if (parsed.error) return { ok: false, reason: 'profile_host_patch_unreadable', text: String(messageText || ''), operations: [] };
    const merged = [...(parsed.ops || []).filter((op) => !profileOperation(op)), ...incoming];
    const analysis = currentBlock.match(/<Analysis>([\s\S]*?)<\/Analysis>/iu)?.[1] || '';
    const block = renderUpdateVariableBlock(merged, analysis);
    return { ok: true, text: replaceUpdateBlocks(messageText, block), block, operations: merged };
}

export function preserveActorProfileOperationsOnUpdateBlock(messageText, replacementBlock) {
    const currentBlock = extractLastUpdateBlock(messageText);
    const current = currentBlock ? parsePatchBlock(currentBlock) : { ops: [] };
    const replacement = parsePatchBlock(replacementBlock);
    if (replacement.error) return { ok: false, reason: 'profile_replacement_patch_unreadable', block: String(replacementBlock || '') };
    if (current.error) return { ok: false, reason: 'profile_host_patch_unreadable', block: String(replacementBlock || '') };
    const preserved = (current.ops || []).filter(profileOperation);
    const next = [...(replacement.ops || []).filter((op) => !profileOperation(op)), ...preserved];
    const analysis = String(replacementBlock || '').match(/<Analysis>([\s\S]*?)<\/Analysis>/iu)?.[1] || '';
    return { ok: true, block: renderUpdateVariableBlock(next, analysis), operations: next, preservedCount: preserved.length };
}

export function actorProfilePromptProjection(profile, { maxCharacters = 900 } = {}) {
    const readiness = profileReadiness(profile);
    if (!readiness.ready) return null;
    const sections = profile.narrativeSections || {};
    const summary = NARRATIVE_KEYS.map((key) => text(sections[key]?.text || sections[key], 220))
        .filter(Boolean).join('；');
    return {
        actorId: text(profile?.actorRef?.actorId || profile?.actorId, 160),
        name: text(profile?.actorRef?.name || profile?.name || profile?.姓名与别名?.姓名, 160),
        revision: Number(profile?.本地元数据?.revision || 0),
        profileDigest: actorProfileBaselineDigest(profile),
        summary: text(summary, maxCharacters),
    };
}

export function compileLegacyActorProfileMigration(legacyProfiles, options = {}) {
    const entries = [];
    const quarantined = [];
    for (const [actorId, raw] of Object.entries(legacyProfiles || {})) {
        const profile = normalizeActorProfileV6(raw, { actorId, name: raw?.name || raw?.actorRef?.name, mode: 'basic' });
        const verified = raw?.baselineCommit?.readbackVerified === true
            || raw?.本地元数据?.readbackVerified === true;
        const sections = profile.narrativeSections || {};
        const missing = NARRATIVE_KEYS.filter((key) => fieldMissing(sections[key]?.text || sections[key]));
        if (!verified || profile.profileFormat !== 'narrative-v1' || missing.length) {
            quarantined.push({ actorId, reason: FIXED_FAILURES.MIGRATION_INCOMPLETE, missingFields: missing });
            continue;
        }
        entries.push({
            mode: 'existing', actorId, name: profile.name || raw?.name || raw?.actorRef?.name,
            aliases: raw?.actorRef?.aliases || [],
            fields: Object.fromEntries(NARRATIVE_KEYS.map((key) => [key, sections[key]?.text || sections[key]])),
            legacyProfile: raw,
        });
    }
    const compiled = compileActorProfileMvuPatch({ entries, failures: [], quarantined }, options);
    return { ...compiled, migration: true, legacyPreserved: true, migrationEntries: entries };
}

export function actorProfileSemanticRuntimeFingerprint(mutationProbe = '') {
    const contract = [
        ACTOR_PROFILE_MVU_SCHEMA_VERSION,
        ACTOR_PROFILE_UPDATE_BLOCK.schemaVersion,
        extractActorProfileUpdateBlock,
        parseActorProfileUpdateBlock,
        bindActorProfileUpdateEntries,
        compileActorProfileMvuPatch,
        markActorProfileReadback,
        mergeActorProfileOperationsIntoAcceptedMessage,
        preserveActorProfileOperationsOnUpdateBlock,
        actorProfilePromptProjection,
        compileLegacyActorProfileMigration,
        mutationProbe,
    ].map((item) => typeof item === 'function' ? item.toString() : String(item)).join('\n');
    return `actor-profile-semantic:${fingerprint(contract)}`;
}
