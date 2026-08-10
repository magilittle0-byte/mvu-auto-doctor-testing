import { fingerprint } from './core.mjs';
import {
    contentAddressedJsonRef,
    contentAddressedJsonRefFromText,
} from './checkpoint-codec-core.mjs';

export const SOVEREIGNTY_RUNTIME_VERSION = 5;
export const SOVEREIGNTY_CHECKPOINT_VERSION = 3;
export const SOVEREIGNTY_CHECKPOINT_BYTE_BUDGET = 2_000_000;
export const SOVEREIGNTY_TECHNICAL_RECEIPT_HOT_BYTE_BUDGET = 96_000;
export const SOVEREIGNTY_TASK_STATUSES = Object.freeze([
    'pending',
    'running',
    'retryable_failed',
    'deferred',
    'committed',
    'cancelled_stale',
]);
export const SOVEREIGNTY_MODULES = Object.freeze([
    'observation',
    'profile',
    'physiology',
    'actor',
    'world',
    'forum',
    'social',
]);

const STATUS_SET = new Set(SOVEREIGNTY_TASK_STATUSES);
const MODULE_SET = new Set(SOVEREIGNTY_MODULES);
const TERMINAL_STATUSES = new Set(['committed', 'cancelled_stale']);
const CHECKPOINT_DOMAIN_FIELDS = Object.freeze([
    'actorLedger',
    'continuity',
    'worldPressure',
]);
const TECHNICAL_RECEIPT_ARCHIVE_FIELDS = Object.freeze([
    'id',
    'taskId',
    'module',
    'turn',
    'code',
    'retryable',
    'retryCount',
    'nextRetryTurn',
    'at',
    'recovered',
]);

function jsonByteLength(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function semanticallyTerminal(task, supersededSourceKeys = new Set()) {
    return task.status === 'committed'
        || (
            task.status === 'cancelled_stale'
            && task.metadata?.cancelReason === 'latest_state_superseded'
            && cleanText(task.metadata?.supersededByTaskId, 120)
        )
        || (
            task.status === 'cancelled_stale'
            && task.metadata?.cancelReason === 'source_replaced'
            && cleanText(task.metadata?.supersededBySourceKey, 80)
            && supersededSourceKeys.has(task.sourceKey)
        );
}

function runtimeSupersededSourceKeys(runtime) {
    return new Set((runtime?.observations || [])
        .filter((entry) => entry?.superseded === true)
        .map((entry) => entry.sourceKey));
}

function runtimeTaskNeedsRetention(task, supersededSourceKeys = new Set()) {
    return !semanticallyTerminal(task, supersededSourceKeys)
        || (
            task?.module === 'observation'
            && task?.metadata?.observationGapRecovery === true
            && task?.metadata?.simulationRequired === true
        );
}

function compactRuntimeBacklog(value, limit = 600, {
    supersededSourceKeys = new Set(),
} = {}) {
    const tasks = Array.isArray(value) ? value : [];
    const protectedTasks = tasks.filter((task) => (
        runtimeTaskNeedsRetention(task, supersededSourceKeys)
    ));
    const protectedIds = new Set(protectedTasks.map((task) => task.id));
    const terminalBudget = Math.max(0, limit - protectedTasks.length);
    const terminalHistory = tasks.filter((task) => !protectedIds.has(task.id));
    const terminalIds = new Set((terminalBudget > 0 ? terminalHistory.slice(-terminalBudget) : [])
        .map((task) => task.id));
    return tasks.filter((task) => protectedIds.has(task.id) || terminalIds.has(task.id));
}

function compactRuntimeObservations(value, backlog, {
    limit = 240,
    cursorSourceKeys = [],
} = {}) {
    const observations = Array.isArray(value) ? value : [];
    const supersededSourceKeys = new Set(observations
        .filter((entry) => entry?.superseded === true)
        .map((entry) => entry.sourceKey));
    const retainedSourceReplacementProofKeys = backlog
        .filter((task) => (
            task?.status === 'cancelled_stale'
            && task?.metadata?.cancelReason === 'source_replaced'
            && semanticallyTerminal(task, supersededSourceKeys)
        ))
        .map((task) => task.sourceKey);
    const protectedKeys = new Set([
        ...cursorSourceKeys.filter(Boolean),
        ...retainedSourceReplacementProofKeys,
        ...backlog.filter((task) => runtimeTaskNeedsRetention(task, supersededSourceKeys))
            .map((task) => task.sourceKey),
    ]);
    const protectedEntries = observations.filter((entry) => protectedKeys.has(entry.sourceKey));
    const retainedKeys = new Set(protectedEntries.map((entry) => entry.sourceKey));
    const historyBudget = Math.max(0, limit - protectedEntries.length);
    const history = observations.filter((entry) => !retainedKeys.has(entry.sourceKey));
    const historyKeys = new Set((historyBudget > 0 ? history.slice(-historyBudget) : [])
        .map((entry) => entry.sourceKey));
    return observations.filter((entry) => (
        retainedKeys.has(entry.sourceKey) || historyKeys.has(entry.sourceKey)
    ));
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value, limit = 300) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

function sourceIdentity(value = {}) {
    const fields = [
        cleanText(value.chatId, 180),
        integer(value.logicalIndex ?? value.index),
        cleanText(value.messageId, 180),
        integer(value.swipeId),
        integer(value.generation),
        cleanText(value.generationId, 180),
        cleanText(value.generationType, 80),
        cleanText(value.branchId, 180),
        cleanText(value.contentHash ?? value.hash, 180),
    ];
    const scopeDigest = cleanText(value.scopeDigest, 180);
    if (scopeDigest) fields.push(scopeDigest);
    return fields.join('|');
}

export function normalizeSovereigntySourceRef(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const required = [
        'chatId',
        'logicalIndex',
        'messageId',
        'swipeId',
        'generation',
        'generationId',
        'generationType',
        'branchId',
        'contentHash',
        'scopeDigest',
    ];
    if (!required.every((field) => Object.hasOwn(value, field))) return null;
    for (const field of ['logicalIndex', 'swipeId', 'generation']) {
        if (!Number.isInteger(Number(value[field])) || Number(value[field]) < 0) return null;
    }
    const source = {
        chatId: cleanText(value.chatId, 180),
        logicalIndex: integer(value.logicalIndex),
        messageId: cleanText(value.messageId, 180),
        swipeId: integer(value.swipeId),
        generation: integer(value.generation),
        generationId: cleanText(value.generationId, 180),
        generationType: cleanText(value.generationType, 80),
        branchId: cleanText(value.branchId, 180),
        contentHash: cleanText(value.contentHash, 180),
        scopeDigest: cleanText(value.scopeDigest, 180),
    };
    if (
        !source.chatId
        || !source.messageId
        || !source.generationId
        || !source.generationType
        || !source.branchId
        || !source.contentHash
        || !source.scopeDigest
    ) {
        return null;
    }
    return source;
}

function normalizeLegacySovereigntySourceRef(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = {
        chatId: cleanText(value.chatId, 180),
        logicalIndex: integer(value.logicalIndex ?? value.index),
        messageId: cleanText(value.messageId, 180),
        swipeId: integer(value.swipeId),
        generation: integer(value.generation),
        ...(cleanText(value.generationId, 180)
            ? { generationId: cleanText(value.generationId, 180) }
            : {}),
        ...(cleanText(value.generationType, 80)
            ? { generationType: cleanText(value.generationType, 80) }
            : {}),
        branchId: cleanText(value.branchId, 180),
        contentHash: cleanText(value.contentHash ?? value.hash, 180),
        scopeDigest: cleanText(value.scopeDigest, 180),
    };
    return source.chatId && source.messageId && source.branchId && source.contentHash
        ? source
        : null;
}

export function sovereigntySourceRefsMatch(left, right) {
    const first = normalizeSovereigntySourceRef(left);
    const second = normalizeSovereigntySourceRef(right);
    if (!first || !second) return false;
    return [
        'chatId',
        'logicalIndex',
        'messageId',
        'swipeId',
        'generation',
        'generationId',
        'generationType',
        'branchId',
        'contentHash',
        'scopeDigest',
    ].every((field) => first[field] === second[field]);
}

export function sovereigntySourceKey(value) {
    const source = normalizeSovereigntySourceRef(value);
    return source ? `SRC-${fingerprint(sourceIdentity(source)).slice(0, 24)}` : '';
}

function normalizeObservationConvergenceTarget(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const required = [
        'chatId',
        'logicalIndex',
        'messageId',
        'swipeId',
        'generation',
        'generationId',
        'generationType',
        'branchId',
        'contentHash',
    ];
    if (!required.every((field) => Object.hasOwn(value, field))) return null;
    for (const field of ['logicalIndex', 'swipeId', 'generation']) {
        if (!Number.isInteger(Number(value[field])) || Number(value[field]) < 0) return null;
    }
    const target = {
        chatId: cleanText(value.chatId, 180),
        logicalIndex: Number(value.logicalIndex),
        messageId: cleanText(value.messageId, 180),
        swipeId: Number(value.swipeId),
        generation: Number(value.generation),
        generationId: cleanText(value.generationId, 180),
        generationType: cleanText(value.generationType, 80),
        branchId: cleanText(value.branchId, 180),
        contentHash: cleanText(value.contentHash, 180),
    };
    return [
        target.chatId,
        target.messageId,
        target.generationId,
        target.generationType,
        target.branchId,
        target.contentHash,
    ].every(Boolean) ? target : null;
}

function emptyCursor() {
    return { turn: 0, sourceKey: '', sourceRef: null, at: 0 };
}

function emptyModuleHealth() {
    return Object.fromEntries(SOVEREIGNTY_MODULES.map((module) => [module, {
        lastSuccessTurn: 0,
        lastSuccessAt: 0,
        technicalFailureCount: 0,
        lastFailureCode: '',
        nextRetryTurn: 0,
    }]));
}

export function emptySovereigntyRuntime(chatId = '', {
    mode = 'active',
    scopeDigest = '',
} = {}) {
    return {
        version: SOVEREIGNTY_RUNTIME_VERSION,
        checkpointVersion: SOVEREIGNTY_CHECKPOINT_VERSION,
        chatId: cleanText(chatId, 180),
        scopeDigest: cleanText(scopeDigest, 180),
        mode: ['legacy', 'shadow', 'active'].includes(mode) ? mode : 'active',
        observedThrough: emptyCursor(),
        simulatedThrough: emptyCursor(),
        observations: [],
        backlog: [],
        checkpoints: [],
        checkpointBlobs: {},
        checkpointBytes: 0,
        checkpointByteBudget: SOVEREIGNTY_CHECKPOINT_BYTE_BUDGET,
        checkpointBudgetOverflow: 0,
        technicalReceipts: [],
        technicalReceiptArchive: {
            version: 1,
            fields: [...TECHNICAL_RECEIPT_ARCHIVE_FIELDS],
            rows: [],
        },
        moduleHealth: emptyModuleHealth(),
        lastRecoveryAt: 0,
        updatedAt: 0,
    };
}

function normalizeCursor(value) {
    const sourceRef = normalizeSovereigntySourceRef(value?.sourceRef);
    const computedSourceKey = sourceRef ? sovereigntySourceKey(sourceRef) : '';
    const storedSourceKey = cleanText(value?.sourceKey, 80);
    const valid = Boolean(sourceRef && storedSourceKey === computedSourceKey);
    return {
        turn: valid ? integer(value?.turn) : 0,
        sourceKey: valid ? storedSourceKey : '',
        sourceRef: valid ? sourceRef : null,
        at: valid ? integer(value?.at) : 0,
    };
}

function normalizeTask(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const sourceRef = normalizeSovereigntySourceRef(value.sourceRef);
    const module = MODULE_SET.has(value.module) ? value.module : '';
    if (!sourceRef || !module) return null;
    const sourceKey = sovereigntySourceKey(sourceRef);
    if (cleanText(value.sourceKey, 80) !== sourceKey) return null;
    const turn = integer(value.turn, 1, Number.MAX_SAFE_INTEGER, 1);
    return {
        id: cleanText(value.id, 100)
            || `JOB-${fingerprint(`${sourceKey}|${turn}|${module}`).slice(0, 24)}`,
        sourceKey,
        sourceRef,
        turn,
        module,
        status: STATUS_SET.has(value.status) ? value.status : 'pending',
        attemptCount: integer(value.attemptCount),
        retryCount: integer(value.retryCount),
        technicalFailureCount: integer(value.technicalFailureCount),
        nextRetryTurn: integer(value.nextRetryTurn, 0, Number.MAX_SAFE_INTEGER, turn),
        claimedAt: integer(value.claimedAt),
        createdAt: integer(value.createdAt),
        updatedAt: integer(value.updatedAt),
        committedAt: integer(value.committedAt),
        lastFailureCode: cleanText(value.lastFailureCode, 160),
        recoveryMode: value.recoveryMode === 'latest_state' ? 'latest_state' : 'source_turn',
        historicalActionAllowed: value.historicalActionAllowed !== false,
        commitRef: cleanText(value.commitRef, 120),
        claimToken: cleanText(value.claimToken, 120),
        metadata: value.metadata && typeof value.metadata === 'object'
            ? clone(value.metadata)
            : {},
    };
}

function normalizeHealth(value) {
    const output = emptyModuleHealth();
    for (const module of SOVEREIGNTY_MODULES) {
        const source = value?.[module] || {};
        output[module] = {
            lastSuccessTurn: integer(source.lastSuccessTurn),
            lastSuccessAt: integer(source.lastSuccessAt),
            technicalFailureCount: integer(source.technicalFailureCount),
            lastFailureCode: cleanText(source.lastFailureCode, 160),
            nextRetryTurn: integer(source.nextRetryTurn),
        };
    }
    return output;
}

function normalizeTechnicalReceipt(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const receipt = {
        id: cleanText(value.id, 120),
        taskId: cleanText(value.taskId, 120),
        module: MODULE_SET.has(value.module) ? value.module : 'world',
        turn: integer(value.turn),
        code: cleanText(value.code, 160),
        retryable: value.retryable !== false,
        retryCount: integer(value.retryCount),
        nextRetryTurn: integer(value.nextRetryTurn),
        at: integer(value.at),
        recovered: value.recovered === true,
    };
    return receipt.id && receipt.taskId && receipt.code ? receipt : null;
}

function unpackTechnicalReceiptArchive(value) {
    if (!value || typeof value !== 'object' || value.version !== 1) return [];
    const fields = Array.isArray(value.fields) ? value.fields.map(String) : [];
    if (!fields.length || !Array.isArray(value.rows)) return [];
    return value.rows.map((row) => {
        if (!Array.isArray(row)) return null;
        const record = {};
        fields.forEach((field, index) => {
            if (row[index] !== undefined) record[field] = row[index];
        });
        return normalizeTechnicalReceipt(record);
    }).filter(Boolean);
}

function tierTechnicalReceipts(value) {
    const archive = unpackTechnicalReceiptArchive(value.technicalReceiptArchive);
    const live = (Array.isArray(value.technicalReceipts) ? value.technicalReceipts : [])
        .map(normalizeTechnicalReceipt)
        .filter(Boolean);
    const receipts = [];
    const seen = new Set();
    for (const receipt of [...archive, ...live]) {
        if (seen.has(receipt.id)) continue;
        seen.add(receipt.id);
        receipts.push(receipt);
    }
    let hotStart = receipts.length;
    let hotBytes = 2;
    while (hotStart > 0) {
        const candidate = receipts[hotStart - 1];
        const candidateBytes = jsonByteLength(candidate) + 1;
        if (
            hotStart < receipts.length
            && hotBytes + candidateBytes > SOVEREIGNTY_TECHNICAL_RECEIPT_HOT_BYTE_BUDGET
        ) break;
        hotStart -= 1;
        hotBytes += candidateBytes;
    }
    const archived = receipts.slice(0, hotStart);
    value.technicalReceipts = receipts.slice(hotStart);
    value.technicalReceiptArchive = {
        version: 1,
        fields: [...TECHNICAL_RECEIPT_ARCHIVE_FIELDS],
        rows: archived.map((receipt) => (
            TECHNICAL_RECEIPT_ARCHIVE_FIELDS.map((field) => receipt[field])
        )),
    };
    return value;
}

export function sovereigntyTechnicalReceipts(value) {
    const runtime = normalizeSovereigntyRuntime(value);
    return clone([
        ...unpackTechnicalReceiptArchive(runtime.technicalReceiptArchive),
        ...runtime.technicalReceipts,
    ]);
}

function checkpointManifest(value) {
    const format = value?.format;
    if (!['mvuad-checkpoint-manifest-v1', 'mvuad-checkpoint-manifest-v2'].includes(format)) {
        return null;
    }
    if (
        !value.inline || typeof value.inline !== 'object' || Array.isArray(value.inline)
        || !value.refs || typeof value.refs !== 'object' || Array.isArray(value.refs)
    ) return null;
    const allowedKeys = format === 'mvuad-checkpoint-manifest-v2'
        ? ['codec', 'format', 'inline', 'refs']
        : ['format', 'inline', 'refs'];
    if (
        Object.keys(value).some((key) => !allowedKeys.includes(key))
        || Object.keys(value.refs).some((key) => !CHECKPOINT_DOMAIN_FIELDS.includes(key))
        || Object.keys(value.inline).some((key) => (
            CHECKPOINT_DOMAIN_FIELDS.includes(key)
            || ['__proto__', 'constructor', 'prototype'].includes(key)
        ))
        || (format === 'mvuad-checkpoint-manifest-v2'
            && value.codec !== 'canonical-json-sha256-v1')
    ) return null;
    return value;
}

function putCheckpointBlob(blobs, payload, {
    now = 0,
    digest = '',
} = {}) {
    const resolvedDigest = cleanText(digest, 160) || contentAddressedJsonRef(payload);
    if (!blobs[resolvedDigest]) {
        blobs[resolvedDigest] = {
            digest: resolvedDigest,
            payload: clone(payload),
            byteLength: jsonByteLength(payload),
            createdAt: integer(now),
            lastUsedAt: integer(now),
        };
    } else {
        blobs[resolvedDigest].lastUsedAt = Math.max(
            integer(blobs[resolvedDigest].lastUsedAt),
            integer(now),
        );
    }
    return resolvedDigest;
}

function storeCheckpointPayload(runtime, payload, now) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return putCheckpointBlob(runtime.checkpointBlobs, payload ?? null, { now });
    }
    const inline = {};
    const refs = {};
    for (const [field, fieldValue] of Object.entries(payload)) {
        if (CHECKPOINT_DOMAIN_FIELDS.includes(field) && fieldValue !== undefined) {
            refs[field] = putCheckpointBlob(runtime.checkpointBlobs, fieldValue, { now });
        } else {
            inline[field] = fieldValue;
        }
    }
    if (!Object.keys(refs).length) {
        return putCheckpointBlob(runtime.checkpointBlobs, payload, { now });
    }
    return putCheckpointBlob(runtime.checkpointBlobs, {
        format: 'mvuad-checkpoint-manifest-v2',
        codec: 'canonical-json-sha256-v1',
        inline,
        refs,
    }, { now });
}

function materializeCheckpointPayload(blobs, payloadRef) {
    const blob = blobs[payloadRef];
    if (!blob) return { found: false, payload: null };
    const manifest = checkpointManifest(blob.payload);
    if (
        !manifest
        && typeof blob.payload?.format === 'string'
        && blob.payload.format.startsWith('mvuad-checkpoint-manifest-')
    ) {
        return { found: false, payload: null, reason: 'checkpoint_manifest_invalid' };
    }
    if (!manifest) return { found: true, payload: clone(blob.payload) };
    const payload = clone(manifest.inline);
    for (const [field, ref] of Object.entries(manifest.refs)) {
        const domain = blobs[ref];
        if (!domain) return { found: false, payload: null };
        payload[field] = clone(domain.payload);
    }
    return { found: true, payload };
}

function reachableCheckpointBlobRefs(checkpoints, blobs) {
    const reachable = new Set();
    const pending = checkpoints.map((entry) => entry.payloadRef).filter(Boolean);
    while (pending.length) {
        const ref = pending.pop();
        if (!ref || reachable.has(ref) || !blobs[ref]) continue;
        reachable.add(ref);
        const manifest = checkpointManifest(blobs[ref].payload);
        if (manifest) pending.push(...Object.values(manifest.refs));
    }
    return reachable;
}

function protectedCheckpointIds(runtime) {
    const protectedIds = new Set();
    const checkpoints = runtime.checkpoints || [];
    const latest = checkpoints.at(-1);
    if (latest?.id) protectedIds.add(latest.id);
    const supersededSourceKeys = new Set((runtime.observations || [])
        .filter((entry) => entry.superseded === true)
        .map((entry) => entry.sourceKey));
    for (const task of runtime.backlog || []) {
        if (semanticallyTerminal(task, supersededSourceKeys)) continue;
        const explicitId = cleanText(task.metadata?.recoveryCheckpointId, 120);
        if (explicitId && checkpoints.some((entry) => entry.id === explicitId)) {
            protectedIds.add(explicitId);
            continue;
        }
        const cutTurn = integer(task.metadata?.materializationCut?.turn, 0)
            || integer(task.turn, 0);
        const taskScopeKey = task.module === 'actor' && cleanText(task.metadata?.actorId, 120)
            ? `actor:${cleanText(task.metadata.actorId, 120)}`
            : task.module;
        const baseline = checkpoints
            .filter((entry) => (
                (entry.scopeKey || entry.module) === taskScopeKey
                && entry.turn <= cutTurn
            ))
            .sort((left, right) => right.turn - left.turn || right.createdAt - left.createdAt)[0];
        if (baseline?.id) protectedIds.add(baseline.id);
    }
    return protectedIds;
}

function pruneCheckpointStorage(runtime) {
    const budget = integer(
        runtime.checkpointByteBudget,
        64_000,
        16_000_000,
        SOVEREIGNTY_CHECKPOINT_BYTE_BUDGET,
    );
    runtime.checkpointByteBudget = budget;
    const cleanupBlobs = () => {
        const referenced = reachableCheckpointBlobRefs(
            runtime.checkpoints,
            runtime.checkpointBlobs,
        );
        for (const digest of Object.keys(runtime.checkpointBlobs)) {
            if (!referenced.has(digest)) delete runtime.checkpointBlobs[digest];
        }
        runtime.checkpointBytes = jsonByteLength(runtime.checkpoints)
            + Object.values(runtime.checkpointBlobs)
                .reduce((total, blob) => total + jsonByteLength(blob), 0);
    };
    cleanupBlobs();
    while (runtime.checkpointBytes > budget && runtime.checkpoints.length > 1) {
        const protectedIds = protectedCheckpointIds(runtime);
        const evictableIndex = runtime.checkpoints.findIndex((entry, index) => (
            index < runtime.checkpoints.length - 1 && !protectedIds.has(entry.id)
        ));
        if (evictableIndex < 0) break;
        runtime.checkpoints.splice(evictableIndex, 1);
        cleanupBlobs();
    }
    runtime.checkpointBudgetOverflow = Math.max(
        0,
        runtime.checkpointBytes - budget,
    );
    return runtime;
}

export function normalizeSovereigntyRuntime(value, {
    chatId = '',
    scopeDigest = '',
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceVersion = integer(source.version);
    const observedThrough = normalizeCursor(source.observedThrough);
    const backlog = (Array.isArray(source.backlog) ? source.backlog : [])
        .map(normalizeTask)
        .filter(Boolean);
    const usedTaskIds = new Set();
    const uniqueBacklog = backlog.filter((task) => {
        if (usedTaskIds.has(task.id)) return false;
        usedTaskIds.add(task.id);
        return true;
    });
    const normalizedObservations = (Array.isArray(source.observations)
        ? source.observations
        : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
            turn: integer(entry.turn),
            sourceKey: cleanText(entry.sourceKey, 80),
            sourceRef: normalizeSovereigntySourceRef(entry.sourceRef),
            observedAt: integer(entry.observedAt),
            superseded: entry.superseded === true,
        }))
        .filter((entry) => (
            entry.sourceRef
            && entry.sourceKey === sovereigntySourceKey(entry.sourceRef)
        ));
    const supersededSourceKeys = new Set(normalizedObservations
        .filter((entry) => entry.superseded === true)
        .map((entry) => entry.sourceKey));
    const moduleHealth = normalizeHealth(source.moduleHealth);
    if (sourceVersion < 2) {
        for (const task of uniqueBacklog) {
            if (!['retryable_failed', 'deferred'].includes(task.status)) continue;
            task.nextRetryTurn = Math.min(task.nextRetryTurn, observedThrough.turn);
            task.recoveryMode = 'latest_state';
            task.historicalActionAllowed = false;
        }
        for (const module of SOVEREIGNTY_MODULES) {
            const nextRetryTurns = uniqueBacklog
                .filter((task) => (
                    task.module === module
                    && ['retryable_failed', 'deferred'].includes(task.status)
                ))
                .map((task) => task.nextRetryTurn);
            moduleHealth[module].nextRetryTurn = nextRetryTurns.length
                ? Math.min(...nextRetryTurns)
                : 0;
        }
    }
    if (sourceVersion < 3) {
        const taskScopeKey = (task) => task.module === 'actor' && task.metadata?.actorId
            ? `${task.module}:${cleanText(task.metadata.actorId, 120)}`
            : task.module;
        const committedByScope = new Map();
        for (const task of uniqueBacklog) {
            if (task.status !== 'committed') continue;
            const key = taskScopeKey(task);
            if (!committedByScope.has(key)) committedByScope.set(key, []);
            committedByScope.get(key).push(task);
        }
        for (const committed of committedByScope.values()) {
            committed.sort((left, right) => right.turn - left.turn || right.updatedAt - left.updatedAt);
        }
        // rc.13 recorded many old source replacements as cancelled_stale even
        // after a later latest-state task for the same module had committed.
        // They are not new work: bind them to the real later commit so the v3
        // migration neither advances on cancellation alone nor replays dozens
        // of already-covered historical turns.
        for (const task of uniqueBacklog) {
            if (
                task.status !== 'cancelled_stale'
                || semanticallyTerminal(task, supersededSourceKeys)
            ) continue;
            const replacement = (committedByScope.get(taskScopeKey(task)) || [])
                .find((entry) => entry.turn >= task.turn);
            if (!replacement) continue;
            task.metadata = {
                ...(task.metadata || {}),
                cancelReason: 'latest_state_superseded',
                supersededByTaskId: replacement.id,
                migrationReason: 'legacy_cancel_covered_by_real_commit',
            };
            task.nextRetryTurn = 0;
            task.claimedAt = 0;
            task.recoveryMode = 'latest_state';
            task.historicalActionAllowed = false;
        }
        // Older runtimes used cancelled_stale as if it were a successful
        // semantic completion. Recover against the latest state, but collapse
        // equivalent historical copies to one durable recovery task per module
        // (or per durable actor). Re-queuing every cancelled turn created a
        // migration storm in long chats and let one logical failure occupy all
        // model slots. Historical cancellations remain visibly incomplete
        // until the selected recovery task actually commits.
        const scopes = new Map();
        for (const task of uniqueBacklog) {
            if (
                task.module === 'observation'
                || semanticallyTerminal(task, supersededSourceKeys)
            ) continue;
            const key = taskScopeKey(task);
            if (!scopes.has(key)) scopes.set(key, []);
            scopes.get(key).push(task);
        }
        for (const tasks of scopes.values()) {
            const cancelled = tasks.filter((task) => task.status === 'cancelled_stale');
            if (!cancelled.length) continue;
            const active = tasks
                .filter((task) => !['committed', 'cancelled_stale'].includes(task.status))
                .sort((left, right) => right.turn - left.turn || right.updatedAt - left.updatedAt);
            const selected = active[0]
                || [...cancelled].sort((left, right) => (
                    right.turn - left.turn || right.updatedAt - left.updatedAt
                ))[0];
            if (!selected) continue;
            if (selected.status === 'cancelled_stale') selected.status = 'pending';
            selected.nextRetryTurn = Math.min(
                selected.nextRetryTurn || observedThrough.turn,
                observedThrough.turn,
            );
            selected.recoveryMode = 'latest_state';
            selected.historicalActionAllowed = false;
            selected.metadata = {
                ...(selected.metadata || {}),
                migrationReason: 'legacy_latest_state_recovery_selected',
                collapsedHistoricalTaskCount: Math.max(0, tasks.length - 1),
            };
            for (const task of tasks) {
                if (task.id === selected.id || task.status === 'committed') continue;
                task.status = 'cancelled_stale';
                task.nextRetryTurn = 0;
                task.claimedAt = 0;
                task.recoveryMode = 'latest_state';
                task.historicalActionAllowed = false;
                task.metadata = {
                    ...(task.metadata || {}),
                    cancelReason: 'latest_state_recovery_pending',
                    replacementTaskId: selected.id,
                    migrationReason: 'legacy_duplicate_collapsed',
                };
            }
        }
    }
    const checkpointBlobs = {};
    const inlinePayloadDigests = new WeakMap();
    const contentDigest = (payload) => {
        if (payload && typeof payload === 'object') {
            const existing = inlinePayloadDigests.get(payload);
            if (existing) return existing;
            const digest = contentAddressedJsonRef(payload);
            inlinePayloadDigests.set(payload, digest);
            return digest;
        }
        return contentAddressedJsonRef(payload ?? null);
    };
    for (const [key, raw] of Object.entries(
        source.checkpointBlobs && typeof source.checkpointBlobs === 'object'
            ? source.checkpointBlobs
            : {},
    )) {
        const payload = clone(raw?.payload);
        const digest = cleanText(raw?.digest || key, 160);
        if (!digest || payload === undefined) continue;
        if (
            digest.startsWith('JSON-SHA256-V1-')
            && digest !== contentAddressedJsonRef(payload)
            && digest !== contentAddressedJsonRefFromText(JSON.stringify(payload))
        ) continue;
        checkpointBlobs[digest] = {
            digest,
            payload,
            byteLength: jsonByteLength(payload),
            createdAt: integer(raw?.createdAt),
            lastUsedAt: integer(raw?.lastUsedAt),
        };
    }
    const checkpoints = (Array.isArray(source.checkpoints) ? source.checkpoints : [])
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
            const payload = entry.payload;
            const stateDigest = payload !== undefined
                ? contentDigest(payload)
                : cleanText(entry.stateDigest, 160);
            if (payload !== undefined) putCheckpointBlob(checkpointBlobs, payload, {
                now: entry.createdAt,
                digest: stateDigest,
            });
            const strictSourceRef = normalizeSovereigntySourceRef(entry.sourceRef);
            const sourceRef = strictSourceRef
                || normalizeLegacySovereigntySourceRef(entry.sourceRef);
            const strictSourceKey = strictSourceRef
                ? sovereigntySourceKey(strictSourceRef)
                : '';
            const storedSourceKey = cleanText(entry.sourceKey, 80);
            const compatibilityOnly = entry.compatibilityOnly === true
                || !strictSourceRef
                || storedSourceKey !== strictSourceKey;
            return {
                version: SOVEREIGNTY_CHECKPOINT_VERSION,
                id: cleanText(entry.id, 120),
                taskId: cleanText(entry.taskId, 120),
                module: MODULE_SET.has(entry.module) ? entry.module : 'world',
                scopeKey: cleanText(entry.scopeKey, 160)
                    || (MODULE_SET.has(entry.module) ? entry.module : 'world'),
                turn: integer(entry.turn),
                sourceKey: storedSourceKey || (strictSourceKey
                    ? strictSourceKey
                    : `LEGACY-SRC-${fingerprint(sourceIdentity(sourceRef || {})).slice(0, 24)}`),
                sourceRef,
                scopeDigest: cleanText(entry.scopeDigest || sourceRef?.scopeDigest, 180),
                stateDigest,
                payloadRef: payload !== undefined
                    ? stateDigest
                    : cleanText(entry.payloadRef, 160) || stateDigest,
                createdAt: integer(entry.createdAt),
                compatibilityOnly,
                restorable: compatibilityOnly ? false : entry.restorable !== false,
                compatibilityReason: cleanText(
                    entry.compatibilityReason
                    || (compatibilityOnly ? 'checkpoint.legacy_source_ref_incomplete' : ''),
                    160,
                ),
            };
        })
        .filter((entry) => (
            entry.id
            && entry.sourceRef
            && (
                entry.compatibilityOnly === true
                || entry.sourceKey === sovereigntySourceKey(entry.sourceRef)
            )
        ));
    const normalized = {
        version: SOVEREIGNTY_RUNTIME_VERSION,
        checkpointVersion: SOVEREIGNTY_CHECKPOINT_VERSION,
        chatId: cleanText(chatId || source.chatId, 180),
        scopeDigest: cleanText(scopeDigest || source.scopeDigest, 180),
        mode: ['legacy', 'shadow', 'active'].includes(source.mode)
            ? source.mode
            : 'active',
        observedThrough,
        simulatedThrough: normalizeCursor(source.simulatedThrough),
        observations: normalizedObservations,
        backlog: compactRuntimeBacklog(uniqueBacklog, 600, { supersededSourceKeys }),
        checkpoints,
        checkpointBlobs,
        checkpointBytes: 0,
        checkpointByteBudget: integer(
            source.checkpointByteBudget,
            64_000,
            16_000_000,
            SOVEREIGNTY_CHECKPOINT_BYTE_BUDGET,
        ),
        checkpointBudgetOverflow: integer(source.checkpointBudgetOverflow),
        technicalReceipts: (Array.isArray(source.technicalReceipts)
            ? source.technicalReceipts
            : [])
            .map(normalizeTechnicalReceipt)
            .filter(Boolean),
        technicalReceiptArchive: source.technicalReceiptArchive,
        moduleHealth,
        lastRecoveryAt: integer(source.lastRecoveryAt),
        updatedAt: integer(source.updatedAt),
    };
    normalized.observations = compactRuntimeObservations(
        normalized.observations,
        normalized.backlog,
        {
            cursorSourceKeys: [
                normalized.observedThrough.sourceKey,
                normalized.simulatedThrough.sourceKey,
            ],
        },
    );
    tierTechnicalReceipts(normalized);
    return pruneCheckpointStorage(normalized);
}

function sourceMatchesRuntimeScope(sourceRef, runtime) {
    const expected = cleanText(runtime?.scopeDigest, 180);
    if (!expected) return true;
    return cleanText(sourceRef?.scopeDigest, 180) === expected;
}

function taskMatchesRuntimeScope(task, runtime) {
    return sourceMatchesRuntimeScope(task?.sourceRef, runtime);
}

function checkpointMatchesRuntimeScope(checkpoint, runtime) {
    const expected = cleanText(runtime?.scopeDigest, 180);
    if (!expected) return true;
    return cleanText(checkpoint?.scopeDigest || checkpoint?.sourceRef?.scopeDigest, 180)
        === expected;
}

function technicalReceipt(task, code, {
    now,
    retryable = true,
    recovered = false,
} = {}) {
    return {
        id: `TECH-${fingerprint(`${task.id}|${code}|${task.retryCount}|${now}`).slice(0, 24)}`,
        taskId: task.id,
        module: task.module,
        turn: task.turn,
        code: cleanText(code, 160) || 'technical_failure',
        retryable,
        retryCount: task.retryCount,
        nextRetryTurn: task.nextRetryTurn,
        at: integer(now),
        recovered,
    };
}

function recomputeSimulatedThrough(runtime) {
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const observations = runtime.observations
        .filter((entry) => entry.superseded !== true)
        .sort((left, right) => left.turn - right.turn);
    let cursor = emptyCursor();
    for (const observation of observations) {
        const tasks = runtime.backlog.filter((task) => (
            task.turn === observation.turn
            && task.sourceKey === observation.sourceKey
            && task.module !== 'observation'
        ));
        const observationTask = runtime.backlog.find((task) => (
            task.turn === observation.turn
            && task.sourceKey === observation.sourceKey
            && task.module === 'observation'
        ));
        const observationOnlyFinal = tasks.length === 0
            && observationTask?.status === 'committed'
            && observationTask?.metadata?.simulationRequired === false
            && observationTask?.metadata?.observationOnlyFinal === true;
        if (
            observationOnlyFinal
            || (
                tasks.length
                && tasks.every((task) => semanticallyTerminal(task, supersededSourceKeys))
            )
        ) {
            cursor = {
                turn: observation.turn,
                sourceKey: observation.sourceKey,
                sourceRef: clone(observation.sourceRef),
                at: Math.max(
                    observationTask?.committedAt || observationTask?.updatedAt || 0,
                    ...tasks.map((task) => task.committedAt || task.updatedAt || 0),
                ),
            };
            continue;
        }
        break;
    }
    runtime.simulatedThrough = cursor;
}

export function observeSovereigntyTurn(value, {
    sourceRef,
    modules = ['profile', 'actor', 'world'],
    observationOnlyFinal = null,
    now = Date.now(),
} = {}) {
    const source = normalizeSovereigntySourceRef(sourceRef);
    const runtime = normalizeSovereigntyRuntime(value, {
        chatId: source?.chatId,
        scopeDigest: value?.scopeDigest || source?.scopeDigest,
    });
    if (!source) return { runtime, observed: false, reason: 'source_ref_invalid', tasks: [] };
    if (!sourceMatchesRuntimeScope(source, runtime)) {
        return { runtime, observed: false, reason: 'source_scope_mismatch', tasks: [] };
    }
    if (!runtime.scopeDigest && source.scopeDigest) runtime.scopeDigest = source.scopeDigest;
    const sourceKey = sovereigntySourceKey(source);
    const existingObservation = runtime.observations.find((entry) => entry.sourceKey === sourceKey);
    if (existingObservation) {
        return {
            runtime,
            observed: false,
            reason: 'duplicate',
            turn: existingObservation.turn,
            tasks: runtime.backlog.filter((task) => task.sourceKey === sourceKey),
        };
    }

    const staleLogicalIndex = source.logicalIndex;
    const replacedObservation = runtime.observations
        .filter((observation) => (
            observation.sourceRef?.chatId === source.chatId
            && observation.sourceRef?.logicalIndex === staleLogicalIndex
            && observation.sourceKey !== sourceKey
        ))
        .sort((left, right) => right.observedAt - left.observedAt)[0] || null;
    for (const observation of runtime.observations) {
        if (
            observation.sourceRef?.chatId === source.chatId
            && observation.sourceRef?.logicalIndex === staleLogicalIndex
            && observation.sourceKey !== sourceKey
        ) observation.superseded = true;
    }
    for (const task of runtime.backlog) {
        if (
            task.sourceRef.chatId === source.chatId
            && task.sourceRef.logicalIndex === staleLogicalIndex
            && task.sourceKey !== sourceKey
            && !TERMINAL_STATUSES.has(task.status)
        ) {
            task.status = 'cancelled_stale';
            task.updatedAt = now;
            task.historicalActionAllowed = false;
            task.metadata = {
                ...(task.metadata || {}),
                cancelReason: 'source_replaced',
                supersededBySourceKey: sourceKey,
                cancelledAt: now,
            };
        }
    }

    // A swipe/regenerate replaces one accepted logical reply. Reusing that
    // observation turn prevents a reroll from advancing NPC/world time or
    // inflating lag merely because the content hash changed.
    const turn = replacedObservation?.turn || (runtime.observations.length
        ? Math.max(...runtime.observations.map((entry) => entry.turn)) + 1
        : 1);
    runtime.observations.push({ turn, sourceKey, sourceRef: source, observedAt: now });
    runtime.observations = compactRuntimeObservations(
        runtime.observations,
        runtime.backlog,
        { cursorSourceKeys: [sourceKey, runtime.simulatedThrough.sourceKey] },
    );
    runtime.observedThrough = { turn, sourceKey, sourceRef: source, at: now };
    const normalizedModules = [...new Set(['observation', ...modules])]
        .filter((module) => MODULE_SET.has(module));
    const finalObservationOnly = observationOnlyFinal === null
        ? normalizedModules.every((module) => module === 'observation')
        : observationOnlyFinal === true;
    const tasks = normalizedModules.map((module) => normalizeTask({
        sourceKey,
        sourceRef: source,
        turn,
        module,
        status: module === 'observation' ? 'committed' : 'pending',
        nextRetryTurn: turn,
        createdAt: now,
        updatedAt: now,
        committedAt: module === 'observation' ? now : 0,
        commitRef: module === 'observation' ? `OBS-${sourceKey}` : '',
        metadata: module === 'observation'
            ? {
                localOnly: true,
                modelRequired: false,
                simulationRequired: !finalObservationOnly,
                observationOnlyFinal: finalObservationOnly,
            }
            : { latestStateRequired: true },
    }));
    runtime.backlog.push(...tasks);
    runtime.backlog = compactRuntimeBacklog(runtime.backlog, 600, {
        supersededSourceKeys: runtimeSupersededSourceKeys(runtime),
    });
    runtime.observations = compactRuntimeObservations(
        runtime.observations,
        runtime.backlog,
        { cursorSourceKeys: [sourceKey, runtime.simulatedThrough.sourceKey] },
    );
    runtime.moduleHealth.observation.lastSuccessTurn = turn;
    runtime.moduleHealth.observation.lastSuccessAt = now;
    runtime.updatedAt = now;
    recomputeSimulatedThrough(runtime);
    return { runtime, observed: true, turn, tasks: clone(tasks) };
}

export function completeSovereigntyObservationGaps(value, {
    scopeDigest = value?.scopeDigest || '',
    proof = null,
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value, { scopeDigest });
    const completed = [];
    const proofEntries = Array.isArray(proof?.entries) ? proof.entries : [];
    const normalizedProof = {
        version: Number(proof?.version) || 0,
        kind: cleanText(proof?.kind, 80),
        scopeDigest: cleanText(proof?.scopeDigest, 180),
        entries: proofEntries.map((entry) => {
            const sourceKey = cleanText(entry?.sourceKey, 80);
            const target = normalizeObservationConvergenceTarget(entry?.target);
            const sourceRef = target ? normalizeSovereigntySourceRef({
                ...target,
                scopeDigest: cleanText(proof?.scopeDigest, 180),
            }) : null;
            return { sourceKey, target, sourceRef };
        }).filter((entry) => (
            entry.sourceKey
            && entry.target
            && entry.sourceRef
            && sovereigntySourceKey(entry.sourceRef) === entry.sourceKey
        )).map(({ sourceKey, target }) => ({ sourceKey, target })),
        latestSourceKey: cleanText(proof?.latestSourceKey, 80),
    };
    const proofDigest = cleanText(proof?.proofDigest, 180);
    const computedProofDigest = contentAddressedJsonRef(normalizedProof);
    const proofValid = (
        normalizedProof.version === 1
        && normalizedProof.kind === 'current_chat_observation_convergence'
        && normalizedProof.scopeDigest
        && normalizedProof.scopeDigest === runtime.scopeDigest
        && normalizedProof.entries.length === proofEntries.length
        && proofDigest === computedProofDigest
        && normalizedProof.latestSourceKey
        && normalizedProof.entries.at(-1)?.sourceKey === normalizedProof.latestSourceKey
    );
    for (const task of runtime.backlog) {
        if (
            task.module !== 'observation'
            || task.status !== 'committed'
            || task.metadata?.observationGapRecovery !== true
            || task.metadata?.simulationRequired !== true
            || !taskMatchesRuntimeScope(task, runtime)
        ) continue;
        const expectedKeys = [...new Set(
            (Array.isArray(task.metadata?.convergenceCoversSourceKeys)
                ? task.metadata.convergenceCoversSourceKeys
                : [])
                .map((entry) => cleanText(entry, 80))
                .filter(Boolean),
        )];
        const expectedTargets = (Array.isArray(task.metadata?.convergenceTargets)
            ? task.metadata.convergenceTargets
            : [])
            .map((entry) => {
                const sourceKey = cleanText(entry?.sourceKey, 80);
                const target = normalizeObservationConvergenceTarget(entry?.target);
                const sourceRef = target ? normalizeSovereigntySourceRef({
                    ...target,
                    scopeDigest: runtime.scopeDigest,
                }) : null;
                return { sourceKey, target, sourceRef };
            })
            .filter((entry) => (
                entry.sourceKey
                && entry.target
                && entry.sourceRef
                && sovereigntySourceKey(entry.sourceRef) === entry.sourceKey
            ));
        const proofMatches = proofValid
            && expectedKeys.length > 0
            && expectedKeys.length === normalizedProof.entries.length
            && expectedTargets.length === expectedKeys.length
            && expectedKeys.every((entry, index) => (
                normalizedProof.entries[index]?.sourceKey === entry
                && expectedTargets[index]?.sourceKey === entry
                && JSON.stringify(normalizedProof.entries[index].target)
                    === JSON.stringify(expectedTargets[index].target)
            ))
            && cleanText(task.metadata?.convergenceLatestSourceKey, 80)
                === normalizedProof.latestSourceKey;
        if (!proofMatches) continue;
        task.metadata = {
            ...(task.metadata || {}),
            simulationRequired: false,
            observationOnlyFinal: true,
            observationGapRecovery: false,
            recoveryMode: 'latest_state',
            actorActionsAllowed: false,
            convergedAt: now,
            convergenceSourceKey: normalizedProof.latestSourceKey,
            convergenceProofDigest: proofDigest,
            convergenceProofCoverageCount: normalizedProof.entries.length,
        };
        task.commitRef = task.commitRef
            || `OBS-GAP-${fingerprint(`${task.id}|${proofDigest}`).slice(0, 20)}`;
        task.updatedAt = now;
        completed.push(task.id);
    }
    if (completed.length) {
        runtime.updatedAt = now;
        recomputeSimulatedThrough(runtime);
    }
    return {
        runtime,
        completed,
        proofAccepted: proofValid && completed.length > 0,
        reason: completed.length
            ? ''
            : proofValid
                ? 'observation_gap.proof_mismatch'
                : 'observation_gap.proof_missing_or_invalid',
    };
}

export function supersedeSovereigntyObservationSources(value, {
    scopeDigest = value?.scopeDigest || '',
    replacements = [],
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value, { scopeDigest });
    const accepted = new Map((Array.isArray(replacements) ? replacements : [])
        .map((entry) => {
            const sourceRef = normalizeSovereigntySourceRef(entry?.sourceRef);
            const currentSourceRef = normalizeSovereigntySourceRef(entry?.currentSourceRef);
            const sourceKey = cleanText(entry?.sourceKey, 80);
            const currentSourceKey = cleanText(entry?.currentSourceKey, 80);
            const logicalIndex = integer(entry?.logicalIndex);
            if (
                !sourceRef
                || !currentSourceRef
                || sourceKey !== sovereigntySourceKey(sourceRef)
                || currentSourceKey !== sovereigntySourceKey(currentSourceRef)
                || sourceKey === currentSourceKey
                || sourceRef.scopeDigest !== runtime.scopeDigest
                || currentSourceRef.scopeDigest !== runtime.scopeDigest
                || sourceRef.chatId !== currentSourceRef.chatId
                || sourceRef.logicalIndex !== logicalIndex
                || currentSourceRef.logicalIndex !== logicalIndex
            ) return null;
            return [sourceKey, { currentSourceKey, logicalIndex, sourceRef, currentSourceRef }];
        })
        .filter(Boolean));
    const superseded = [];
    for (const observation of runtime.observations) {
        const replacement = accepted.get(observation.sourceKey);
        if (
            !replacement
            || observation.sourceRef?.logicalIndex !== replacement.logicalIndex
            || !sovereigntySourceRefsMatch(observation.sourceRef, replacement.sourceRef)
        ) continue;
        observation.superseded = true;
        superseded.push(observation.sourceKey);
    }
    for (const task of runtime.backlog) {
        const replacement = accepted.get(task.sourceKey);
        const coveredSourceKeys = Array.isArray(task.metadata?.convergenceCoversSourceKeys)
            ? task.metadata.convergenceCoversSourceKeys.map((entry) => cleanText(entry, 80))
            : [];
        const replacedCoveredSourceKeys = coveredSourceKeys.filter((entry) => accepted.has(entry));
        if (
            (
                !replacement
                || task.sourceRef?.logicalIndex !== replacement.logicalIndex
                || !sovereigntySourceRefsMatch(task.sourceRef, replacement.sourceRef)
            )
            && !replacedCoveredSourceKeys.length
        ) continue;
        if (!replacement && replacedCoveredSourceKeys.length) {
            const remainingSourceKeys = coveredSourceKeys.filter((entry) => !accepted.has(entry));
            const remainingTargets = (Array.isArray(task.metadata?.convergenceTargets)
                ? task.metadata.convergenceTargets
                : []).filter((entry) => !accepted.has(cleanText(entry?.sourceKey, 80)));
            if (remainingSourceKeys.length && remainingTargets.length === remainingSourceKeys.length) {
                task.updatedAt = now;
                task.metadata = {
                    ...(task.metadata || {}),
                    convergenceCoversSourceKeys: remainingSourceKeys,
                    convergenceTargets: remainingTargets,
                    convergenceLatestSourceKey: remainingSourceKeys.at(-1),
                    supersededCoveredSourceKeys: [...new Set([
                        ...(Array.isArray(task.metadata?.supersededCoveredSourceKeys)
                            ? task.metadata.supersededCoveredSourceKeys
                            : []),
                        ...replacedCoveredSourceKeys,
                    ])],
                };
                continue;
            }
        }
        task.status = 'cancelled_stale';
        task.claimedAt = 0;
        task.claimToken = '';
        task.historicalActionAllowed = false;
        task.updatedAt = now;
        task.metadata = {
            ...(task.metadata || {}),
            observationGapRecovery: false,
            simulationRequired: false,
            observationOnlyFinal: false,
            actorActionsAllowed: false,
            cancelReason: 'source_replaced',
            supersededBySourceKey: replacement?.currentSourceKey
                || accepted.get(replacedCoveredSourceKeys[0])?.currentSourceKey
                || '',
            supersededCoveredSourceKeys: replacedCoveredSourceKeys,
            supersededAt: now,
        };
    }
    if (superseded.length) {
        runtime.updatedAt = now;
        recomputeSimulatedThrough(runtime);
    }
    return { runtime, superseded: [...new Set(superseded)] };
}

export function recoverOrphanedSovereigntyTasks(value, {
    now = Date.now(),
    staleAfterMs = 35_000,
    excludeTaskIds = [],
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const excluded = new Set((Array.isArray(excludeTaskIds) ? excludeTaskIds : []).map(String));
    const recovered = [];
    for (const task of runtime.backlog) {
        if (
            task.status !== 'running'
            || task.metadata?.migrationQuarantined === true
            || !taskMatchesRuntimeScope(task, runtime)
            || excluded.has(task.id)
            || now - task.claimedAt < Math.max(1_000, Number(staleAfterMs) || 35_000)
        ) continue;
        task.status = 'retryable_failed';
        task.retryCount += 1;
        task.technicalFailureCount += 1;
        task.nextRetryTurn = Math.max(task.turn, runtime.observedThrough.turn);
        task.lastFailureCode = 'orphaned_running_recovered';
        task.recoveryMode = 'latest_state';
        task.historicalActionAllowed = false;
        task.updatedAt = now;
        runtime.technicalReceipts.push(technicalReceipt(task, task.lastFailureCode, {
            now,
            recovered: true,
        }));
        const health = runtime.moduleHealth[task.module];
        health.technicalFailureCount += 1;
        health.lastFailureCode = task.lastFailureCode;
        health.nextRetryTurn = task.nextRetryTurn;
        recovered.push(task.id);
    }
    tierTechnicalReceipts(runtime);
    runtime.lastRecoveryAt = recovered.length ? now : runtime.lastRecoveryAt;
    runtime.updatedAt = recovered.length ? now : runtime.updatedAt;
    return { runtime, recovered };
}

export function claimNextSovereigntyTask(value, {
    module = '',
    actorId = null,
    currentTurn = null,
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const turn = currentTurn === null || currentTurn === undefined || currentTurn === ''
        ? runtime.observedThrough.turn
        : integer(currentTurn, 0, Number.MAX_SAFE_INTEGER, runtime.observedThrough.turn);
    const candidate = runtime.backlog
        .filter((task) => (
            task.module !== 'observation'
            && task.metadata?.migrationQuarantined !== true
            && taskMatchesRuntimeScope(task, runtime)
            && (!module || task.module === module)
            && (
                module !== 'actor'
                || actorId !== null
                || !cleanText(task.metadata?.actorId, 120)
            )
            && (
                actorId === null
                || cleanText(task.metadata?.actorId, 120) === cleanText(actorId, 120)
            )
            && ['pending', 'retryable_failed', 'deferred'].includes(task.status)
            && task.nextRetryTurn <= turn
        ))
        .sort((left, right) => (
            Number(right.status === 'retryable_failed') - Number(left.status === 'retryable_failed')
            || left.turn - right.turn
            || left.id.localeCompare(right.id)
        ))[0];
    if (!candidate) return { runtime, task: null };
    candidate.status = 'running';
    candidate.attemptCount += 1;
    candidate.claimedAt = now;
    candidate.updatedAt = now;
    candidate.metadata = {
        ...(candidate.metadata || {}),
        materializationCut: clone(runtime.observedThrough),
    };
    candidate.claimToken = `FENCE-${fingerprint([
        candidate.id,
        candidate.attemptCount,
        candidate.metadata.materializationCut?.sourceKey || '',
        now,
    ].join('|')).slice(0, 28)}`;
    if (candidate.turn < runtime.observedThrough.turn || candidate.retryCount > 0) {
        candidate.recoveryMode = 'latest_state';
        candidate.historicalActionAllowed = false;
    }
    runtime.updatedAt = now;
    return { runtime, task: clone(candidate) };
}

export function claimDueSovereigntyActorTasks(value, {
    actorIds = null,
    limit = 5,
    currentTurn = null,
    now = Date.now(),
} = {}) {
    let runtime = normalizeSovereigntyRuntime(value);
    const turn = currentTurn === null || currentTurn === undefined || currentTurn === ''
        ? runtime.observedThrough.turn
        : integer(currentTurn, 0, Number.MAX_SAFE_INTEGER, runtime.observedThrough.turn);
    const requestedActorIds = Array.isArray(actorIds)
        ? new Set(actorIds.map((actorId) => cleanText(actorId, 120)).filter(Boolean))
        : null;
    const dueActorIds = [];
    const seen = new Set();
    for (const task of runtime.backlog
        .filter((entry) => (
            entry.module === 'actor'
            && entry.metadata?.migrationQuarantined !== true
            && taskMatchesRuntimeScope(entry, runtime)
            && cleanText(entry.metadata?.actorId, 120)
            && ['pending', 'retryable_failed', 'deferred'].includes(entry.status)
            && entry.nextRetryTurn <= turn
        ))
        .sort((left, right) => (
            Number(right.status === 'retryable_failed')
                - Number(left.status === 'retryable_failed')
            || left.turn - right.turn
            || left.id.localeCompare(right.id)
        ))) {
        const actorId = cleanText(task.metadata?.actorId, 120);
        if (
            seen.has(actorId)
            || (requestedActorIds && !requestedActorIds.has(actorId))
        ) continue;
        seen.add(actorId);
        dueActorIds.push(actorId);
        if (dueActorIds.length >= integer(limit, 1, 32, 5)) break;
    }
    const tasks = [];
    for (const actorId of dueActorIds) {
        const claimed = claimNextSovereigntyTask(runtime, {
            module: 'actor',
            actorId,
            currentTurn: turn,
            now,
        });
        runtime = claimed.runtime;
        if (claimed.task) tasks.push(claimed.task);
    }
    return { runtime, tasks };
}

export function materializeSovereigntyActorTasks(value, {
    parentTaskId = '',
    actorIds = [],
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const parent = runtime.backlog.find((task) => task.id === parentTaskId);
    if (
        !parent
        || parent.module !== 'actor'
        || parent.metadata?.migrationQuarantined === true
        || !taskMatchesRuntimeScope(parent, runtime)
    ) return { runtime, tasks: [] };
    const uniqueActorIds = [...new Set((Array.isArray(actorIds) ? actorIds : [])
        .map((actorId) => cleanText(actorId, 120))
        .filter(Boolean))].sort();
    const tasks = [];
    for (const actorId of uniqueActorIds) {
        let task = runtime.backlog.find((entry) => (
            entry.module === 'actor'
            && entry.sourceKey === parent.sourceKey
            && cleanText(entry.metadata?.actorId, 120) === actorId
        ));
        if (!task) {
            task = normalizeTask({
                ...parent,
                id: `JOB-${fingerprint(`${parent.id}|actor|${actorId}`).slice(0, 24)}`,
                status: 'running',
                attemptCount: 1,
                claimedAt: now,
                createdAt: now,
                updatedAt: now,
                metadata: {
                    actorId,
                    parentTaskId: parent.id,
                    durableActorTask: true,
                    materializationCut: clone(
                        parent.metadata?.materializationCut || runtime.observedThrough,
                    ),
                },
            });
            task.claimToken = `FENCE-${fingerprint([
                task.id,
                task.attemptCount,
                task.metadata?.materializationCut?.sourceKey || '',
                now,
            ].join('|')).slice(0, 28)}`;
            runtime.backlog.push(task);
        } else if (['pending', 'retryable_failed', 'deferred'].includes(task.status)) {
            task.status = 'running';
            task.attemptCount += 1;
            task.claimedAt = now;
            task.updatedAt = now;
            task.metadata = {
                ...(task.metadata || {}),
                parentTaskId: parent.id,
                durableActorTask: true,
                materializationCut: clone(
                    parent.metadata?.materializationCut || runtime.observedThrough,
                ),
            };
            task.claimToken = `FENCE-${fingerprint([
                task.id,
                task.attemptCount,
                task.metadata?.materializationCut?.sourceKey || '',
                now,
            ].join('|')).slice(0, 28)}`;
        }
        tasks.push(clone(task));
    }
    runtime.backlog = compactRuntimeBacklog(runtime.backlog, 600, {
        supersededSourceKeys: runtimeSupersededSourceKeys(runtime),
    });
    runtime.updatedAt = now;
    return { runtime, tasks };
}

export function failSovereigntyTask(value, {
    taskId,
    claimToken = '',
    failureCode = 'technical_failure',
    retryable = true,
    deferred = false,
    nextRetryTurn = null,
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const task = runtime.backlog.find((entry) => entry.id === taskId);
    if (
        !task
        || !taskMatchesRuntimeScope(task, runtime)
        || task.metadata?.migrationQuarantined === true
        || semanticallyTerminal(task, supersededSourceKeys)
    ) return { runtime, changed: false };
    const expectedClaimToken = cleanText(claimToken, 120);
    if (expectedClaimToken && task.claimToken && task.claimToken !== expectedClaimToken) {
        return { runtime, changed: false, reason: 'claim_fence_mismatch' };
    }
    task.retryCount += retryable || deferred ? 1 : 0;
    task.technicalFailureCount += 1;
    task.status = deferred ? 'deferred' : retryable ? 'retryable_failed' : 'deferred';
    task.nextRetryTurn = nextRetryTurn === null || nextRetryTurn === undefined
        ? Math.max(task.turn + 1, runtime.observedThrough.turn + 1)
        : integer(nextRetryTurn, 0, Number.MAX_SAFE_INTEGER, task.turn + 1);
    task.lastFailureCode = cleanText(failureCode, 160) || 'technical_failure';
    task.recoveryMode = 'latest_state';
    task.historicalActionAllowed = false;
    task.updatedAt = now;
    const health = runtime.moduleHealth[task.module];
    health.technicalFailureCount += 1;
    health.lastFailureCode = task.lastFailureCode;
    health.nextRetryTurn = task.nextRetryTurn;
    runtime.technicalReceipts.push(technicalReceipt(task, task.lastFailureCode, {
        now,
        retryable,
    }));
    tierTechnicalReceipts(runtime);
    runtime.updatedAt = now;
    return { runtime, changed: true, task: clone(task) };
}

export function commitSovereigntyTask(value, {
    taskId,
    claimToken = '',
    payload = null,
    commitRef = '',
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const task = runtime.backlog.find((entry) => entry.id === taskId);
    if (
        !task
        || !taskMatchesRuntimeScope(task, runtime)
        || task.metadata?.migrationQuarantined === true
        || task.status === 'cancelled_stale'
    ) return { runtime, changed: false };
    const expectedClaimToken = cleanText(claimToken, 120);
    if (expectedClaimToken && task.claimToken && task.claimToken !== expectedClaimToken) {
        return { runtime, changed: false, reason: 'claim_fence_mismatch' };
    }
    if (task.status === 'committed') {
        return {
            runtime,
            changed: false,
            task: clone(task),
            checkpoint: clone(runtime.checkpoints.find((entry) => entry.taskId === task.id) || null),
            supersededTaskIds: [],
        };
    }
    const fixedCut = normalizeCursor(task.metadata?.materializationCut);
    const cutCursor = fixedCut.sourceRef && fixedCut.turn >= task.turn
        ? fixedCut
        : {
            turn: task.turn,
            sourceKey: task.sourceKey,
            sourceRef: task.sourceRef,
            at: task.claimedAt || task.updatedAt,
        };
    const latestStateCoverage = (
        task.recoveryMode === 'latest_state'
        && cutCursor.turn >= task.turn
    );
    const coveredThroughTurn = latestStateCoverage
        ? cutCursor.turn
        : task.turn;
    const coveredCursor = latestStateCoverage && cutCursor.sourceRef
        ? cutCursor
        : {
            turn: task.turn,
            sourceKey: task.sourceKey,
            sourceRef: task.sourceRef,
        };
    task.status = 'committed';
    task.committedAt = now;
    task.updatedAt = now;
    task.nextRetryTurn = 0;
    task.lastFailureCode = '';
    const supersededTaskIds = [];
    if (latestStateCoverage) {
        const actorScope = cleanText(task.metadata?.actorId, 120);
        for (const entry of runtime.backlog) {
            if (
                entry.id === task.id
                || entry.module !== task.module
                || (
                    task.module === 'actor'
                    && cleanText(entry.metadata?.actorId, 120) !== actorScope
                )
                || entry.turn > coveredThroughTurn
                || semanticallyTerminal(entry, supersededSourceKeys)
            ) continue;
            entry.status = 'cancelled_stale';
            entry.historicalActionAllowed = false;
            entry.claimedAt = 0;
            entry.updatedAt = now;
            entry.metadata = {
                ...(entry.metadata || {}),
                cancelReason: 'latest_state_superseded',
                supersededByTaskId: task.id,
                supersededAt: now,
            };
            supersededTaskIds.push(entry.id);
        }
        task.metadata = {
            ...(task.metadata || {}),
            coveredThroughTurn,
            supersededTaskCount: supersededTaskIds.length,
        };
    }
    const stateDigest = storeCheckpointPayload(runtime, payload, now);
    task.commitRef = cleanText(commitRef, 120)
        || `COMMIT-${fingerprint(`${task.id}|${coveredCursor.sourceKey}|${stateDigest}`).slice(0, 20)}`;
    const checkpoint = {
        version: SOVEREIGNTY_CHECKPOINT_VERSION,
        id: `SCP-${fingerprint(`${task.id}|${task.commitRef}|${stateDigest}`).slice(0, 24)}`,
        taskId: task.id,
        module: task.module,
        scopeKey: task.module === 'actor' && cleanText(task.metadata?.actorId, 120)
            ? `actor:${cleanText(task.metadata.actorId, 120)}`
            : task.module,
        turn: coveredCursor.turn,
        sourceKey: coveredCursor.sourceKey,
        sourceRef: clone(coveredCursor.sourceRef),
        scopeDigest: runtime.scopeDigest,
        stateDigest,
        payloadRef: stateDigest,
        createdAt: now,
    };
    const existingCheckpointIndex = runtime.checkpoints.findIndex(
        (entry) => entry.id === checkpoint.id,
    );
    if (existingCheckpointIndex >= 0) runtime.checkpoints[existingCheckpointIndex] = checkpoint;
    else runtime.checkpoints.push(checkpoint);
    pruneCheckpointStorage(runtime);
    const health = runtime.moduleHealth[task.module];
    health.lastSuccessTurn = Math.max(health.lastSuccessTurn, coveredThroughTurn);
    health.lastSuccessAt = now;
    health.lastFailureCode = '';
    const remainingRetryTurns = runtime.backlog
        .filter((entry) => (
            entry.module === task.module
            && ['retryable_failed', 'deferred'].includes(entry.status)
        ))
        .map((entry) => entry.nextRetryTurn);
    health.nextRetryTurn = remainingRetryTurns.length
        ? Math.min(...remainingRetryTurns)
        : 0;
    runtime.updatedAt = now;
    recomputeSimulatedThrough(runtime);
    return {
        runtime,
        changed: true,
        task: clone(task),
        checkpoint: clone(checkpoint),
        supersededTaskIds,
    };
}

export function cancelSovereigntyTaskAsStale(value, {
    taskId,
    reason = 'target_stale',
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const task = runtime.backlog.find((entry) => entry.id === taskId);
    if (!task || task.status === 'committed') return { runtime, changed: false };
    task.status = 'cancelled_stale';
    task.historicalActionAllowed = false;
    task.metadata = {
        ...(task.metadata || {}),
        cancelReason: cleanText(reason, 160) || 'target_stale',
        cancelledAt: now,
    };
    task.updatedAt = now;
    runtime.updatedAt = now;
    recomputeSimulatedThrough(runtime);
    return { runtime, changed: true, task: clone(task) };
}

export function requeueSovereigntyTaskForLatestState(value, {
    taskId,
    reason = 'target_advanced',
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const task = runtime.backlog.find((entry) => entry.id === taskId);
    if (
        !task
        || !taskMatchesRuntimeScope(task, runtime)
        || task.metadata?.migrationQuarantined === true
        || TERMINAL_STATUSES.has(task.status)
    ) return { runtime, changed: false };
    task.status = 'pending';
    task.nextRetryTurn = runtime.observedThrough.turn;
    task.recoveryMode = 'latest_state';
    task.historicalActionAllowed = false;
    task.claimedAt = 0;
    task.updatedAt = now;
    task.metadata = {
        ...(task.metadata || {}),
        requeueReason: cleanText(reason, 160) || 'target_advanced',
        requeuedAt: now,
    };
    runtime.updatedAt = now;
    return { runtime, changed: true, task: clone(task) };
}

export function retrySovereigntyTaskNow(value, {
    taskId = '',
    module = '',
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const tasks = runtime.backlog.filter((task) => (
        (!taskId || task.id === taskId)
        && (!module || task.module === module)
        && task.metadata?.migrationQuarantined !== true
        && taskMatchesRuntimeScope(task, runtime)
        && (
            ['retryable_failed', 'deferred'].includes(task.status)
            || (
                task.status === 'cancelled_stale'
                && !semanticallyTerminal(task, supersededSourceKeys)
            )
        )
    ));
    for (const task of tasks) {
        task.status = 'pending';
        task.nextRetryTurn = runtime.observedThrough.turn;
        task.updatedAt = now;
    }
    runtime.updatedAt = tasks.length ? now : runtime.updatedAt;
    return { runtime, retried: tasks.map((task) => task.id) };
}

export function dueSovereigntyTasks(value, { currentTurn = null } = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const turn = currentTurn === null || currentTurn === undefined || currentTurn === ''
        ? runtime.observedThrough.turn
        : integer(currentTurn, 0, Number.MAX_SAFE_INTEGER, runtime.observedThrough.turn);
    return clone(runtime.backlog.filter((task) => (
        ['pending', 'retryable_failed', 'deferred'].includes(task.status)
        && task.metadata?.migrationQuarantined !== true
        && taskMatchesRuntimeScope(task, runtime)
        && task.nextRetryTurn <= turn
    )));
}

export function sovereigntyRetryDelay(value, {
    baseMs = 2_000,
    maximumMs = 30_000,
} = {}) {
    const due = dueSovereigntyTasks(value);
    if (!due.length) return 0;
    const retryCount = Math.min(
        ...due.map((task) => Math.max(1, task.retryCount || task.attemptCount || 1)),
    );
    return Math.min(
        Math.max(1_000, integer(maximumMs, 1_000, 300_000, 30_000)),
        Math.max(250, integer(baseMs, 250, 60_000, 2_000))
            * (2 ** Math.min(4, Math.max(0, retryCount - 1))),
    );
}

export function restoreSovereigntyCheckpoint(value, {
    checkpointId = '',
    now = Date.now(),
} = {}) {
    const runtime = normalizeSovereigntyRuntime(value);
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const checkpoint = checkpointId
        ? runtime.checkpoints.find((entry) => entry.id === checkpointId)
        : [...runtime.checkpoints].reverse().find((entry) => (
            entry.compatibilityOnly !== true && entry.restorable !== false
        ));
    if (!checkpoint) return { runtime, restored: false, payload: null };
    if (
        checkpoint.compatibilityOnly === true
        || checkpoint.restorable === false
        || (runtime.chatId && checkpoint.sourceRef?.chatId !== runtime.chatId)
        || !checkpointMatchesRuntimeScope(checkpoint, runtime)
    ) {
        return {
            runtime,
            restored: false,
            payload: null,
            reason: checkpoint.compatibilityReason || 'checkpoint.scope_mismatch',
        };
    }
    const blob = runtime.checkpointBlobs[checkpoint.payloadRef];
    if (!blob) return { runtime, restored: false, payload: null, reason: 'checkpoint_blob_missing' };
    const materialized = materializeCheckpointPayload(
        runtime.checkpointBlobs,
        checkpoint.payloadRef,
    );
    if (!materialized.found) {
        return {
            runtime,
            restored: false,
            payload: null,
            reason: materialized.reason || 'checkpoint_domain_blob_missing',
        };
    }
    blob.lastUsedAt = now;
    for (const task of runtime.backlog) {
        if (
            task.turn <= checkpoint.turn
            || semanticallyTerminal(task, supersededSourceKeys)
        ) continue;
        task.status = 'pending';
        task.nextRetryTurn = runtime.observedThrough.turn;
        task.recoveryMode = 'latest_state';
        task.historicalActionAllowed = false;
        task.updatedAt = now;
        task.metadata = {
            ...(task.metadata || {}),
            recoveryCheckpointId: checkpoint.id,
            materializationCut: clone(runtime.observedThrough),
        };
    }
    runtime.simulatedThrough = {
        turn: checkpoint.turn,
        sourceKey: checkpoint.sourceKey,
        sourceRef: clone(checkpoint.sourceRef),
        at: now,
    };
    runtime.updatedAt = now;
    return {
        runtime,
        restored: true,
        checkpoint: clone(checkpoint),
        payload: materialized.payload,
    };
}

export function sovereigntyHealthView(value) {
    const runtime = normalizeSovereigntyRuntime(value);
    const supersededSourceKeys = runtimeSupersededSourceKeys(runtime);
    const active = runtime.backlog.filter((task) => (
        !semanticallyTerminal(task, supersededSourceKeys)
    ));
    const observationGapCount = runtime.backlog.filter((task) => (
        task.module === 'observation'
        && task.metadata?.observationGapRecovery === true
        && task.metadata?.simulationRequired === true
    )).length;
    const running = active.filter((task) => task.status === 'running');
    const failed = active.filter((task) => task.status === 'retryable_failed');
    const deferred = active.filter((task) => task.status === 'deferred');
    const pending = active.filter((task) => task.status === 'pending');
    const cancelledIncomplete = runtime.backlog.filter((task) => (
        task.status === 'cancelled_stale'
        && !semanticallyTerminal(task, supersededSourceKeys)
    ));
    const failingModules = [...new Set([
        ...failed,
        ...deferred,
        ...cancelledIncomplete,
    ].map((task) => task.module))];
    const engagedModules = [...new Set([
        ...runtime.backlog.map((task) => task.module),
        ...Object.entries(runtime.moduleHealth)
            .filter(([, entry]) => entry.lastSuccessTurn > 0 || entry.lastFailureCode)
            .map(([module]) => module),
    ])];
    const moduleLastSuccess = Object.fromEntries(engagedModules.map((module) => [
        module,
        runtime.moduleHealth[module]?.lastSuccessTurn || 0,
    ]));
    const lastSuccessTurn = engagedModules.length
        ? Math.min(...Object.values(moduleLastSuccess))
        : 0;
    const nextRetryTurn = Math.min(
        ...[...failed, ...deferred].map((task) => task.nextRetryTurn),
        Number.MAX_SAFE_INTEGER,
    );
    const lag = Math.max(0, runtime.observedThrough.turn - runtime.simulatedThrough.turn);
    const missingCheckpointBlobCount = runtime.checkpoints.filter((entry) => (
        !materializeCheckpointPayload(runtime.checkpointBlobs, entry.payloadRef).found
    )).length;
    const migrationQuarantinedCheckpointCount = runtime.checkpoints.filter((entry) => (
        entry.compatibilityOnly === true || entry.restorable === false
    )).length;
    const color = missingCheckpointBlobCount > 0
        || migrationQuarantinedCheckpointCount > 0
        || observationGapCount > 0
        ? 'red'
        : failingModules.some((module) => !moduleLastSuccess[module])
            ? 'red'
            : cancelledIncomplete.length
                ? 'red'
                : runtime.checkpointBudgetOverflow > 0
                    ? 'orange'
                    : failed.length || deferred.length
                        ? 'orange'
                        : running.length
                            ? 'blue'
                            : pending.length || lag > 0
                                ? 'yellow'
                                : 'green';
    return {
        color,
        mode: runtime.mode,
        observedThrough: clone(runtime.observedThrough),
        simulatedThrough: clone(runtime.simulatedThrough),
        lastSuccessTurn,
        moduleLastSuccess,
        moduleHealth: clone(runtime.moduleHealth),
        backlog: active.length,
        pending: pending.length,
        running: running.length,
        retryableFailed: failed.length,
        deferred: deferred.length,
        cancelledIncomplete: cancelledIncomplete.length,
        lag,
        failingModules,
        nextRetryTurn: Number.isFinite(nextRetryTurn) && nextRetryTurn < Number.MAX_SAFE_INTEGER
            ? nextRetryTurn
            : 0,
        lastFailureCodes: [...new Set([...failed, ...deferred]
            .map((task) => task.lastFailureCode)
            .filter(Boolean))].slice(0, 8),
        checkpointCount: runtime.checkpoints.length,
        checkpointBytes: runtime.checkpointBytes,
        checkpointByteBudget: runtime.checkpointByteBudget,
        checkpointBudgetOverflow: runtime.checkpointBudgetOverflow,
        missingCheckpointBlobCount,
        migrationQuarantinedCheckpointCount,
        observationGapCount,
        technicalReceiptCount: runtime.technicalReceipts.length
            + integer(runtime.technicalReceiptArchive?.rows?.length),
        technicalReceiptHotCount: runtime.technicalReceipts.length,
        technicalReceiptArchiveCount: integer(runtime.technicalReceiptArchive?.rows?.length),
        technicalReceiptHotBytes: jsonByteLength(runtime.technicalReceipts),
        technicalReceiptArchiveBytes: jsonByteLength(runtime.technicalReceiptArchive),
    };
}

export function combineDoctorSemanticHealth(baseValue, {
    identityPollutionCount = 0,
    identityQuarantineCount = 0,
    profileIncompleteCount = 0,
    profileActorCount = 0,
    profileOptionalPendingCount = 0,
    injectionConsumedCount = 0,
    injectionWaitingCount = 0,
    injectionStalledCount = 0,
} = {}) {
    const base = baseValue && typeof baseValue === 'object'
        ? clone(baseValue)
        : sovereigntyHealthView(null);
    const identityPollution = integer(
        identityPollutionCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const identityQuarantine = integer(
        identityQuarantineCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const profilesIncomplete = integer(
        profileIncompleteCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const profileActors = integer(profileActorCount, 0, Number.MAX_SAFE_INTEGER, 0);
    const profilesOptionalPending = integer(
        profileOptionalPendingCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const injectionConsumed = integer(
        injectionConsumedCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const injectionWaiting = integer(
        injectionWaitingCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    const injectionStalled = integer(
        injectionStalledCount,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
    );
    // One shared severity projection is consumed by the panel, floating orb,
    // diagnostics and public API. Semantic corruption must never be hidden by
    // a locally successful observer module or a different UI aggregation.
    const color = base.color === 'red'
        || identityPollution > 0
        || identityQuarantine > 0
        ? 'red'
        : base.color === 'orange' || injectionStalled > 0
            ? 'orange'
            : base.color === 'yellow'
                || profilesIncomplete > 0
                || profilesOptionalPending > 0
                ? 'yellow'
                : base.color === 'blue' || injectionWaiting > 0
                    ? 'blue'
                    : 'green';
    return {
        ...base,
        color,
        identityPollution,
        identityQuarantine,
        profilesIncomplete,
        profilesOptionalPending,
        profileActorCount: profileActors,
        injectionConsumed,
        injectionWaiting,
        injectionStalled,
    };
}

export function extractFirstBalancedJsonObject(output) {
    const text = String(output ?? '');
    for (let start = 0; start < text.length; start += 1) {
        if (text[start] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < text.length; index += 1) {
            const character = text[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === '{') depth += 1;
            else if (character === '}') depth -= 1;
            if (depth !== 0) continue;
            const source = text.slice(start, index + 1);
            try {
                const value = JSON.parse(source);
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    return { value, source, start, end: index + 1 };
                }
            } catch {
                break;
            }
            break;
        }
    }
    return { error: 'json_object_missing' };
}

export async function parseJsonObjectWithSingleRepair(output, {
    repair = null,
} = {}) {
    const first = extractFirstBalancedJsonObject(output);
    if (!first.error) return { ...first, repaired: false, repairAttempts: 0 };
    if (typeof repair !== 'function') return { ...first, repaired: false, repairAttempts: 0 };
    let repairedOutput = '';
    try {
        repairedOutput = await repair(String(output ?? ''));
    } catch {
        return { error: 'json_repair_failed', repaired: false, repairAttempts: 1 };
    }
    const second = extractFirstBalancedJsonObject(repairedOutput);
    return second.error
        ? { error: 'json_repair_invalid', repaired: false, repairAttempts: 1 }
        : { ...second, repaired: true, repairAttempts: 1 };
}

export function conservativeSovereigntyFallback({
    module = 'world',
    reason = 'model_unavailable',
    turn = 0,
} = {}) {
    return {
        module: MODULE_SET.has(module) ? module : 'world',
        turn: integer(turn),
        semanticChanges: [],
        actionAttempts: [],
        worldResults: [],
        deferred: true,
        retryable: true,
        reason: cleanText(reason, 160),
        historicalActionFabricated: false,
        playerActionFabricated: false,
    };
}
