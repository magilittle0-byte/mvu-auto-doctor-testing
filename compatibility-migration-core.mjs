import {
    actorActionTargetMatches,
    normalizeActorActionTarget,
} from './actor-authority-core.mjs';
import {
    emptyActorLedger,
    normalizeActorLedger,
} from './actor-ledger-core.mjs';
import {
    actorProfileActionReadiness,
} from './actor-profile-v6-core.mjs';
import {
    contentAddressedJsonRef,
} from './checkpoint-codec-core.mjs';
import {
    SOVEREIGNTY_RUNTIME_VERSION,
    emptySovereigntyRuntime,
    normalizeSovereigntySourceRef,
    normalizeSovereigntyRuntime,
    sovereigntySourceKey,
} from './sovereignty-runtime-core.mjs';

export const ACTOR_SOVEREIGNTY_SCOPE_VERSION = 1;
export const ACTOR_SOVEREIGNTY_MIGRATION_VERSION = 3;
export const ACTOR_SOVEREIGNTY_RETIRED_WRITE_PATHS_VERSION = 1;
export const ACTOR_SOVEREIGNTY_NAMESPACE_WRITE_PATH = 'chat_namespace.actor_sovereignty_v13';

export const RETIRED_ACTOR_WRITE_PATHS = Object.freeze([
    'continuity.actorProfiles',
    'actionReceipts.actionAttempt',
    'settlement.candidate_reconstruction',
    'continuity.name_projection_registration',
    'legacy.targetIndex_action_target',
]);

function clone(value) {
    if (value === undefined) return undefined;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function cleanText(value, limit = 300) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 32, itemLimit = 300) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((entry) => cleanText(entry, itemLimit)).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .slice(0, limit);
}

export function flattenActorSovereigntyScopeValues(value, output = []) {
    if (Array.isArray(value)) {
        for (const entry of value) flattenActorSovereigntyScopeValues(entry, output);
        return output;
    }
    const text = cleanText(value, 300);
    if (text) output.push(text);
    return output;
}

function worldbookEntries(value) {
    if (Array.isArray(value?.entries)) return value.entries;
    if (value?.entries && typeof value.entries === 'object') {
        return Object.values(value.entries);
    }
    return [];
}

const TRANSIENT_WORLDBOOK_ENTRY_FIELDS = new Set([
    '__cache',
    '__source',
    'cachedAt',
    'cached_at',
    'cacheHit',
    'cacheSource',
    'cache_source',
    'fetchedAt',
    'fetched_at',
    'loadedAt',
    'loaded_at',
    'loadTimestamp',
    'sourceMarker',
    'source_marker',
]);

function stableWorldbookJson(value, key = '') {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (Array.isArray(value)) {
        const items = value
            .map((entry) => stableWorldbookJson(entry))
            .filter((entry) => entry !== undefined);
        if (['key', 'keys', 'keysecondary', 'secondaryKeys'].includes(key)) {
            return [...new Set(items.map((entry) => JSON.stringify(entry)))]
                .sort()
                .map((entry) => JSON.parse(entry));
        }
        return items;
    }
    if (!value || typeof value !== 'object') return undefined;
    return Object.fromEntries(Object.keys(value)
        .filter((entryKey) => !TRANSIENT_WORLDBOOK_ENTRY_FIELDS.has(entryKey))
        .sort().flatMap((entryKey) => {
        const normalized = stableWorldbookJson(value[entryKey], entryKey);
        return normalized === undefined ? [] : [[entryKey, normalized]];
        }));
}

export function stableActorSovereigntyWorldbookEntries(book) {
    return worldbookEntries(book).map((entry) => ({
        uid: cleanText(entry?.uid ?? entry?.id, 160),
        world: cleanText(entry?.world, 240),
        comment: cleanText(entry?.comment || entry?.name, 300),
        key: cleanList(flattenActorSovereigntyScopeValues(entry?.key), 64, 300),
        keysecondary: cleanList(
            flattenActorSovereigntyScopeValues(entry?.keysecondary),
            64,
            300,
        ),
        constant: entry?.constant === true,
        disable: entry?.disable === true || entry?.enabled === false,
        order: Number(entry?.order) || 0,
        position: Number(entry?.position) || 0,
        content: String(entry?.content || ''),
        // Keep a canonical projection of every serializable host field. This is
        // deliberately fail-safe: probability, matching, role, depth, cooldown,
        // vector and future host semantics all change the synthetic revision.
        semantic: stableWorldbookJson(entry),
    })).sort((left, right) => (
        left.uid.localeCompare(right.uid)
        || left.comment.localeCompare(right.comment)
        || left.content.localeCompare(right.content)
        || JSON.stringify(left).localeCompare(JSON.stringify(right))
    ));
}

export function actorSovereigntyWorldbookDescriptor(id, book, {
    kind = 'external',
    explicitRevision = '',
} = {}) {
    const revision = [
        book?.revision,
        book?.rev,
        book?.version,
        book?.updated_at,
        book?.updatedAt,
        explicitRevision,
    ].map((value) => cleanText(value, 180)).find(Boolean) || '';
    const entries = stableActorSovereigntyWorldbookEntries(book);
    return {
        id: cleanText(id, 300),
        kind: kind === 'embedded' ? 'embedded' : 'external',
        revision: revision
            ? `host:${revision}`
            : `synthetic:${contentAddressedJsonRef({ entries })}`,
    };
}

export function createActorSovereigntyWorldbookManifest(
    descriptors,
    { status = 'confirmed', reason = '' } = {},
) {
    const normalized = (Array.isArray(descriptors) ? descriptors : [])
        .filter((entry) => entry && typeof entry === 'object' && cleanText(entry.id, 300))
        .map((entry) => ({
            id: cleanText(entry.id, 300),
            kind: entry.kind === 'embedded' ? 'embedded' : 'external',
            revision: cleanText(entry.revision, 240),
        }))
        .sort((left, right) => (
            left.id.localeCompare(right.id)
            || left.kind.localeCompare(right.kind)
            || left.revision.localeCompare(right.revision)
        ));
    const books = normalized.filter((entry, index) => (
        index === 0
        || JSON.stringify(entry) !== JSON.stringify(normalized[index - 1])
    ));
    const ids = [...new Set(books.map((book) => book.id))].sort();
    const confirmed = status === 'confirmed';
    return {
        version: 1,
        status: confirmed ? 'confirmed' : 'unresolved',
        reason: confirmed ? '' : cleanText(reason, 500),
        ids,
        books,
        manifestDigest: confirmed
            ? contentAddressedJsonRef({ version: 1, ids, books })
            : '',
    };
}

export function createActorSovereigntyScope({
    chatId = '',
    cardId = '',
    cardVersion = '',
    cardStatus = 'confirmed',
    worldbookIds = [],
    worldbookVersion = '',
    worldbookStatus = 'confirmed',
    runtimeVersion = '',
} = {}) {
    return {
        version: ACTOR_SOVEREIGNTY_SCOPE_VERSION,
        chatId: cleanText(chatId, 180),
        cardId: cleanText(cardId, 240),
        cardVersion: cleanText(cardVersion, 120) || 'unversioned',
        cardStatus: cardStatus === 'confirmed' ? 'confirmed' : 'unresolved',
        worldbookIds: cleanList(worldbookIds, 32, 240),
        worldbookVersion: cleanText(worldbookVersion, 120) || 'unversioned',
        worldbookStatus: worldbookStatus === 'confirmed' ? 'confirmed' : 'unresolved',
        runtimeVersion: cleanText(runtimeVersion, 120),
    };
}

export function actorSovereigntyScopeDigest(value) {
    return contentAddressedJsonRef(createActorSovereigntyScope(value));
}

export function actorSovereigntyScopesMatch(left, right) {
    const first = createActorSovereigntyScope(left);
    const second = createActorSovereigntyScope(right);
    return first.version === second.version
        && first.chatId === second.chatId
        && first.cardId === second.cardId
        && first.cardVersion === second.cardVersion
        && first.cardStatus === second.cardStatus
        && first.worldbookVersion === second.worldbookVersion
        && first.worldbookStatus === second.worldbookStatus
        && first.runtimeVersion === second.runtimeVersion
        && JSON.stringify(first.worldbookIds) === JSON.stringify(second.worldbookIds);
}

export function prepareActorSovereigntyFieldWriteCandidate(candidateValue, currentValue, {
    scope = currentValue?.actorSovereigntyScope,
    fields = [],
} = {}) {
    const candidate = candidateValue && typeof candidateValue === 'object'
        && !Array.isArray(candidateValue)
        ? clone(candidateValue)
        : null;
    const current = currentValue && typeof currentValue === 'object'
        && !Array.isArray(currentValue)
        ? currentValue
        : null;
    const expectedScope = createActorSovereigntyScope(scope);
    const selectedFields = [...new Set((Array.isArray(fields) ? fields : [])
        .map((field) => cleanText(field, 180))
        .filter(Boolean))];
    const blocked = (reason, staleFields = []) => ({
        allowed: false,
        reason,
        candidate: null,
        rebasedFields: [],
        staleFields: [...staleFields],
    });
    if (!candidate || !current || !selectedFields.length) {
        return blocked('migration.write_candidate_invalid');
    }
    if (!actorSovereigntyMigrationIsCurrent(current, expectedScope)) {
        return blocked('migration.current_readback_required');
    }
    if (
        cleanText(candidate.chatId, 180) !== expectedScope.chatId
        || cleanText(current.chatId, 180) !== expectedScope.chatId
        || !actorSovereigntyScopesMatch(candidate.actorSovereigntyScope, expectedScope)
        || !actorSovereigntyScopesMatch(current.actorSovereigntyScope, expectedScope)
    ) {
        return blocked('migration.write_scope_mismatch');
    }
    const currentFieldRevisions = current.fieldRevisions
        && typeof current.fieldRevisions === 'object'
        && !Array.isArray(current.fieldRevisions)
        ? current.fieldRevisions
        : {};
    const candidateFieldRevisions = candidate.fieldRevisions
        && typeof candidate.fieldRevisions === 'object'
        && !Array.isArray(candidate.fieldRevisions)
        ? { ...candidate.fieldRevisions }
        : {};
    const staleFields = [];
    const rebasedFields = [];
    for (const field of selectedFields) {
        const currentRevision = Math.max(0, Number(currentFieldRevisions[field]) || 0);
        const candidateRevision = Math.max(
            0,
            Number(candidateFieldRevisions[field]) || Number(candidate.rev) || 0,
        );
        if (currentRevision <= candidateRevision) continue;
        const candidateProjection = {
            present: Object.hasOwn(candidate, field),
            value: Object.hasOwn(candidate, field) ? candidate[field] : null,
        };
        const currentProjection = {
            present: Object.hasOwn(current, field),
            value: Object.hasOwn(current, field) ? current[field] : null,
        };
        if (
            contentAddressedJsonRef(candidateProjection)
            !== contentAddressedJsonRef(currentProjection)
        ) {
            staleFields.push(field);
            continue;
        }
        candidateFieldRevisions[field] = currentRevision;
        rebasedFields.push(field);
    }
    if (staleFields.length) {
        return blocked('migration.write_field_revision_stale', staleFields);
    }
    candidate.fieldRevisions = candidateFieldRevisions;
    candidate.rev = Math.max(
        0,
        Number(candidate.rev) || 0,
        Number(current.rev) || 0,
    );
    return {
        allowed: true,
        reason: '',
        candidate,
        rebasedFields,
        staleFields: [],
    };
}

function strictTargetForScope(value, scope) {
    const target = normalizeActorActionTarget(value);
    return target && target.chatId === scope.chatId ? target : null;
}

function quarantineAttempt(attempt, reason) {
    return {
        ...attempt,
        settlementEligible: false,
        compatibilityOnly: true,
        compatibilityReason: reason,
        migrationQuarantined: true,
    };
}

function normalizeCheckpointTarget(checkpoint, scope, {
    sourceScopeProven = false,
    scopeDigest = actorSovereigntyScopeDigest(scope),
} = {}) {
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return checkpoint;
    const output = clone(checkpoint);
    const target = strictTargetForScope(output.target, scope);
    const checkpointScopeDigest = cleanText(
        output.scopeDigest || output.sourceRef?.scopeDigest,
        180,
    );
    if (target && sourceScopeProven && checkpointScopeDigest === scopeDigest) {
        output.target = target;
        output.scopeDigest = scopeDigest;
        output.compatibilityOnly = false;
        output.restorable = true;
        delete output.compatibilityReason;
        return output;
    }
    output.compatibilityOnly = true;
    output.restorable = false;
    output.compatibilityReason = !sourceScopeProven
        ? 'checkpoint.legacy_scope_missing'
        : checkpointScopeDigest !== scopeDigest
            ? 'checkpoint.scope_digest_missing_or_mismatch'
            : output.target || Object.hasOwn(output, 'targetIndex')
                ? 'checkpoint.legacy_target_incomplete'
                : 'checkpoint.target_missing';
    return output;
}

function attemptIsActive(attempt) {
    return ['attempted', 'pending_world', 'pending_player'].includes(attempt?.status);
}

function taskIsActive(task) {
    return ['pending', 'running', 'retryable_failed', 'deferred'].includes(task?.status);
}

function checkpointBlobInvalid(raw, key) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
    const digest = cleanText(raw.digest || key, 160);
    if (!digest || raw.payload === undefined) return true;
    if (digest.startsWith('JSON-SHA256-V1-') && digest !== contentAddressedJsonRef(raw.payload)) {
        return true;
    }
    const format = cleanText(raw.payload?.format, 80);
    if (
        format.startsWith('mvuad-checkpoint-manifest-')
        && (
            format !== 'mvuad-checkpoint-manifest-v1'
            && format !== 'mvuad-checkpoint-manifest-v2'
            || (format === 'mvuad-checkpoint-manifest-v2'
                && raw.payload?.codec !== 'canonical-json-sha256-v1')
        )
    ) return true;
    return false;
}

const LEDGER_ROOT_FIELDS = new Set([
    'version', 'chatId', 'turn', 'actors', 'actorRegistry', 'identityQuarantine',
    'actionAttempts', 'actionAttemptBacklog', 'actionReceipts',
    'observationReceipts', 'migrations', 'updatedAt',
]);
const RUNTIME_ROOT_FIELDS = new Set([
    'version', 'checkpointVersion', 'chatId', 'scopeDigest', 'mode',
    'observedThrough', 'simulatedThrough', 'observations', 'backlog',
    'checkpoints', 'checkpointBlobs', 'checkpointBytes', 'checkpointByteBudget',
    'checkpointBudgetOverflow', 'technicalReceipts', 'technicalReceiptArchive',
    'moduleHealth', 'lastRecoveryAt', 'updatedAt',
]);

function compatibilityArchiveItem(kind, path, reason, raw) {
    const contentDigest = contentAddressedJsonRef(raw ?? null);
    return {
        version: 1,
        id: `COMPAT-${contentAddressedJsonRef({ kind, path, reason, contentDigest }).slice(-32)}`,
        kind: cleanText(kind, 120),
        path: cleanText(path, 500),
        reason: cleanText(reason, 200),
        contentDigest,
        actionReady: false,
        settlementEligible: false,
        restorable: false,
        raw: clone(raw),
    };
}

function collectUnknownObjectFields(raw, normalized, path, items, {
    ignoredFields = new Set(),
} = {}) {
    if (
        !raw || typeof raw !== 'object' || Array.isArray(raw)
        || !normalized || typeof normalized !== 'object' || Array.isArray(normalized)
    ) return;
    for (const [key, rawValue] of Object.entries(raw)) {
        if (ignoredFields.has(key)) continue;
        const childPath = `${path}.${key}`;
        if (!Object.hasOwn(normalized, key)) {
            items.push(compatibilityArchiveItem(
                'unknown_field',
                childPath,
                'normalizer_field_unrecognized',
                rawValue,
            ));
            continue;
        }
        const normalizedValue = normalized[key];
        if (
            rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
            && normalizedValue && typeof normalizedValue === 'object'
            && !Array.isArray(normalizedValue)
        ) {
            collectUnknownObjectFields(rawValue, normalizedValue, childPath, items);
            continue;
        }
        if (contentAddressedJsonRef(rawValue ?? null) !== contentAddressedJsonRef(
            normalizedValue ?? null,
        )) {
            items.push(compatibilityArchiveItem(
                'changed_value',
                childPath,
                'normalizer_value_changed',
                rawValue,
            ));
        }
    }
}

function firstByIdentity(items, identityOf) {
    const output = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const identity = cleanText(identityOf(item), 240);
        if (identity && !output.has(identity)) output.set(identity, item);
    }
    return output;
}

function collectArrayCompatibilityLosses({
    raw,
    normalized,
    path,
    kind,
    identityOf,
    ignoredFields = new Set(),
}) {
    const items = [];
    const available = new Map();
    for (const entry of Array.isArray(normalized) ? normalized : []) {
        const identity = cleanText(identityOf(entry), 240);
        if (!identity) continue;
        if (!available.has(identity)) available.set(identity, []);
        available.get(identity).push(entry);
    }
    for (const [index, entry] of (Array.isArray(raw) ? raw : []).entries()) {
        const identity = cleanText(identityOf(entry), 240);
        const matches = identity ? available.get(identity) : null;
        const match = matches?.shift() || null;
        if (!match) {
            items.push(compatibilityArchiveItem(
                kind,
                `${path}[${index}]`,
                identity ? 'normalizer_rejected_or_conflicted' : 'identity_unusable',
                entry,
            ));
            continue;
        }
        collectUnknownObjectFields(
            entry,
            match,
            `${path}[${index}]`,
            items,
            { ignoredFields },
        );
    }
    return items;
}

function buildCompatibilityArchive(
    source,
    rawLedger,
    actorLedger,
    rawRuntime,
    runtime,
    observationWal,
) {
    const items = [];
    const existing = source?.actorSovereigntyCompatibilityArchive;
    for (const item of Array.isArray(existing?.items) ? existing.items : []) {
        if (item?.id && item?.contentDigest && Object.hasOwn(item, 'raw')) items.push(clone(item));
    }
    for (const [key, raw] of Object.entries(rawLedger || {})) {
        if (!LEDGER_ROOT_FIELDS.has(key)) {
            items.push(compatibilityArchiveItem(
                'ledger_unknown_root',
                `actorLedger.${key}`,
                'normalizer_root_unrecognized',
                raw,
            ));
        }
    }
    for (const [key, raw] of Object.entries(rawRuntime || {})) {
        if (!RUNTIME_ROOT_FIELDS.has(key)) {
            items.push(compatibilityArchiveItem(
                'runtime_unknown_root',
                `sovereigntyRuntime.${key}`,
                'normalizer_root_unrecognized',
                raw,
            ));
        }
    }
    collectUnknownObjectFields(
        rawRuntime?.observedThrough,
        runtime?.observedThrough,
        'sovereigntyRuntime.observedThrough',
        items,
    );
    collectUnknownObjectFields(
        rawRuntime?.simulatedThrough,
        runtime?.simulatedThrough,
        'sovereigntyRuntime.simulatedThrough',
        items,
    );
    items.push(...collectArrayCompatibilityLosses({
        raw: rawLedger?.actors,
        normalized: actorLedger?.actors,
        path: 'actorLedger.actors',
        kind: 'ledger_actor_quarantine',
        identityOf: (entry) => entry?.id,
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawLedger?.actionAttempts,
        normalized: actorLedger?.actionAttempts,
        path: 'actorLedger.actionAttempts',
        kind: 'ledger_attempt_quarantine',
        identityOf: (entry) => entry?.id || entry?.attemptId,
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawLedger?.actionReceipts,
        normalized: actorLedger?.actionReceipts,
        path: 'actorLedger.actionReceipts',
        kind: 'ledger_receipt_quarantine',
        identityOf: (entry) => entry?.receiptId || entry?.id,
        ignoredFields: new Set(['actionAttempt']),
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawLedger?.observationReceipts,
        normalized: actorLedger?.observationReceipts,
        path: 'actorLedger.observationReceipts',
        kind: 'ledger_observation_receipt_quarantine',
        identityOf: (entry) => entry?.id || contentAddressedJsonRef(entry ?? null),
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawLedger?.actorRegistry?.entries,
        normalized: actorLedger?.actorRegistry?.entries,
        path: 'actorLedger.actorRegistry.entries',
        kind: 'actor_registry_quarantine',
        identityOf: (entry) => entry?.actorRef?.actorId || entry?.actorId,
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawRuntime?.backlog,
        normalized: runtime?.backlog,
        path: 'sovereigntyRuntime.backlog',
        kind: 'runtime_task_quarantine',
        identityOf: (entry) => entry?.id,
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawRuntime?.checkpoints,
        normalized: runtime?.checkpoints,
        path: 'sovereigntyRuntime.checkpoints',
        kind: 'runtime_checkpoint_quarantine',
        identityOf: (entry) => entry?.id,
        // A valid inline payload is moved to the content-addressed blob store.
        ignoredFields: new Set(['payload']),
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: rawRuntime?.technicalReceipts,
        normalized: runtime?.technicalReceipts,
        path: 'sovereigntyRuntime.technicalReceipts',
        kind: 'runtime_technical_receipt_quarantine',
        identityOf: (entry) => entry?.id,
    }));
    items.push(...collectArrayCompatibilityLosses({
        raw: source?.actorSovereigntyObservationWAL,
        normalized: observationWal,
        path: 'actorSovereigntyObservationWAL',
        kind: 'namespace_observation_wal_quarantine',
        identityOf: (entry) => entry?.id || entry?.sourceKey,
    }));
    const normalizedObservationByIdentity = firstByIdentity(
        runtime?.observations,
        (entry) => entry?.sourceKey,
    );
    for (const [index, observation] of (Array.isArray(rawRuntime?.observations)
        ? rawRuntime.observations
        : []).entries()) {
        const candidates = [...normalizedObservationByIdentity.values()];
        const match = candidates.find((entry) => (
            entry?.sourceRef?.chatId === observation?.sourceRef?.chatId
            && entry?.sourceRef?.messageId === observation?.sourceRef?.messageId
            && Number(entry?.sourceRef?.swipeId) === Number(observation?.sourceRef?.swipeId)
            && entry?.sourceRef?.contentHash
                === (observation?.sourceRef?.contentHash || observation?.sourceRef?.hash)
        ));
        if (!match) items.push(compatibilityArchiveItem(
            'runtime_observation_quarantine',
            `sovereigntyRuntime.observations[${index}]`,
            'normalizer_rejected_or_compacted',
            observation,
        ));
    }
    for (const [key, raw] of Object.entries(
        rawRuntime?.checkpointBlobs && typeof rawRuntime.checkpointBlobs === 'object'
            ? rawRuntime.checkpointBlobs
            : {},
    )) {
        const digest = cleanText(raw?.digest || key, 160);
        if (checkpointBlobInvalid(raw, key) || !runtime?.checkpointBlobs?.[digest]) {
            items.push(compatibilityArchiveItem(
                'runtime_checkpoint_blob_quarantine',
                `sovereigntyRuntime.checkpointBlobs.${key}`,
                checkpointBlobInvalid(raw, key)
                    ? 'checkpoint_blob_invalid'
                    : 'checkpoint_blob_unreferenced_or_compacted',
                raw,
            ));
        }
    }
    const deduplicated = [...new Map(items.map((item) => [item.id, item])).values()]
        .sort((left, right) => left.id.localeCompare(right.id));
    return {
        version: 1,
        mode: 'read_only_compatibility_quarantine',
        actionReady: false,
        settlementEligible: false,
        restorable: false,
        items: deduplicated,
        count: deduplicated.length,
        digest: contentAddressedJsonRef(deduplicated.map((item) => ({
            id: item.id,
            kind: item.kind,
            path: item.path,
            reason: item.reason,
            contentDigest: item.contentDigest,
        }))),
    };
}

function migrationProjection(namespace, scope) {
    return {
        scope,
        worldbookManifest: namespace.actorSovereigntyWorldbookManifest || null,
        actorLedger: namespace.actorLedger,
        actorLedgerCheckpoint: namespace.actorLedgerCheckpoint || null,
        actorLedgerCheckpointBlobs: namespace.actorLedgerCheckpointBlobs || {},
        continuity: namespace.continuity || null,
        continuityCheckpoint: namespace.continuityCheckpoint || null,
        sovereigntyRuntime: namespace.sovereigntyRuntime,
        observationWal: namespace.actorSovereigntyObservationWAL || [],
        compatibilityArchive: namespace.actorSovereigntyCompatibilityArchive || null,
        worldPressure: namespace.worldPressure || null,
    };
}

export function actorSovereigntyMigrationDigest(namespace, scope = namespace?.actorSovereigntyScope) {
    return contentAddressedJsonRef(migrationProjection(
        namespace && typeof namespace === 'object' ? namespace : {},
        createActorSovereigntyScope(scope),
    ));
}

function migrationCommitId({ migratedPayloadDigest, scopeDigest, payloadRev }) {
    return contentAddressedJsonRef({
        migrationVersion: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
        migratedPayloadDigest,
        scopeDigest,
        payloadRev: Math.max(0, Number(payloadRev) || 0),
    });
}

function migrationSchemaIsCurrent(namespace, scope, scopeDigest) {
    const ledger = namespace?.actorLedger;
    const runtime = namespace?.sovereigntyRuntime;
    if (
        Number(namespace?.version) < 13
        || Number(ledger?.version) < 8
        || Number(runtime?.version) < SOVEREIGNTY_RUNTIME_VERSION
        || Number(runtime?.checkpointVersion) < 3
        || cleanText(runtime?.scopeDigest, 180) !== scopeDigest
    ) return false;
    const archive = namespace?.actorSovereigntyCompatibilityArchive;
    const archiveItems = Array.isArray(archive?.items) ? archive.items : null;
    if (
        archive?.version !== 1
        || archive?.mode !== 'read_only_compatibility_quarantine'
        || archive?.actionReady !== false
        || archive?.settlementEligible !== false
        || archive?.restorable !== false
        || !archiveItems
        || Number(archive.count) !== archiveItems.length
        || archiveItems.some((item) => (
            item?.actionReady !== false
            || item?.settlementEligible !== false
            || item?.restorable !== false
            || !item?.id
            || !Object.hasOwn(item, 'raw')
            || item.contentDigest !== contentAddressedJsonRef(item.raw ?? null)
        ))
        || archive.digest !== contentAddressedJsonRef(archiveItems.map((item) => ({
            id: item.id,
            kind: item.kind,
            path: item.path,
            reason: item.reason,
            contentDigest: item.contentDigest,
        })))
    ) return false;
    if ((Array.isArray(ledger?.actionReceipts) ? ledger.actionReceipts : []).some(
        (receipt) => Object.hasOwn(receipt || {}, 'actionAttempt'),
    )) return false;
    if ((Array.isArray(ledger?.actionAttempts) ? ledger.actionAttempts : []).some((attempt) => (
        attemptIsActive(attempt) && !strictTargetForScope(attempt?.target, scope)
    ))) return false;
    if ((Array.isArray(runtime?.backlog) ? runtime.backlog : []).some((task) => (
        taskIsActive(task)
        && (
            task?.metadata?.migrationQuarantined === true
                ? task.status !== 'deferred' || task.nextRetryTurn !== Number.MAX_SAFE_INTEGER
                : !normalizeSovereigntySourceRef(task?.sourceRef)
                    || sovereigntySourceKey(task?.sourceRef) !== task?.sourceKey
                    || cleanText(task?.sourceRef?.scopeDigest, 180) !== scopeDigest
        )
    ))) return false;
    for (const observation of Array.isArray(runtime?.observations)
        ? runtime.observations
        : []) {
        const sourceRef = normalizeSovereigntySourceRef(observation?.sourceRef);
        if (!sourceRef || sovereigntySourceKey(sourceRef) !== observation?.sourceKey) return false;
    }
    for (const cursor of [runtime?.observedThrough, runtime?.simulatedThrough]) {
        if (!cursor?.sourceKey && !cursor?.sourceRef) continue;
        const sourceRef = normalizeSovereigntySourceRef(cursor?.sourceRef);
        if (!sourceRef || sovereigntySourceKey(sourceRef) !== cursor?.sourceKey) return false;
    }
    for (const entry of Array.isArray(namespace?.actorSovereigntyObservationWAL)
        ? namespace.actorSovereigntyObservationWAL
        : []) {
        const sourceRef = normalizeSovereigntySourceRef(entry?.sourceRef);
        const target = normalizeActorActionTarget(entry?.target);
        if (
            !sourceRef
            || !target
            || sourceRef.scopeDigest !== scopeDigest
            || sovereigntySourceKey(sourceRef) !== entry?.sourceKey
            || !actorActionTargetMatches(target, sourceRef)
        ) return false;
    }
    if ((Array.isArray(runtime?.checkpoints) ? runtime.checkpoints : []).some((checkpoint) => (
        checkpoint?.compatibilityOnly !== true
        && checkpoint?.restorable !== false
        && (
            !normalizeSovereigntySourceRef(checkpoint?.sourceRef)
            || sovereigntySourceKey(checkpoint?.sourceRef) !== checkpoint?.sourceKey
            || cleanText(checkpoint?.scopeDigest || checkpoint?.sourceRef?.scopeDigest, 180)
                !== scopeDigest
        )
    ))) return false;
    for (const checkpoint of [
        namespace?.continuityCheckpoint,
        namespace?.actorLedgerCheckpoint,
    ].filter(Boolean)) {
        if (checkpoint.compatibilityOnly === true || checkpoint.restorable === false) continue;
        if (
            cleanText(checkpoint.scopeDigest, 180) !== scopeDigest
            || !strictTargetForScope(checkpoint.target, scope)
        ) return false;
    }
    return true;
}

export function actorSovereigntyMigrationIsCurrent(
    namespace,
    scope = namespace?.actorSovereigntyScope,
) {
    if (!namespace || typeof namespace !== 'object' || Array.isArray(namespace)) return false;
    const expectedScope = createActorSovereigntyScope(scope);
    const report = namespace.actorSovereigntyMigration;
    const scopeDigest = actorSovereigntyScopeDigest(expectedScope);
    const payloadRev = Math.max(0, Number(report?.payloadRev) || 0);
    const migratedPayloadDigest = cleanText(report?.migratedPayloadDigest, 180);
    return report?.version === ACTOR_SOVEREIGNTY_MIGRATION_VERSION
        && report?.status === 'current'
        && report?.writeRequired === false
        && report?.readbackVerified === true
        && report?.payloadReadbackVerified === true
        && report?.markerReadbackVerified === true
        && actorSovereigntyScopesMatch(namespace.actorSovereigntyScope, expectedScope)
        && report?.scopeDigest === scopeDigest
        && report?.retiredWritePathsVersion === ACTOR_SOVEREIGNTY_RETIRED_WRITE_PATHS_VERSION
        && migrationSchemaIsCurrent(namespace, expectedScope, scopeDigest)
        && Boolean(migratedPayloadDigest)
        && payloadRev > 0
        && report?.commitId === migrationCommitId({
            migratedPayloadDigest,
            scopeDigest,
            payloadRev,
        });
}

export function markActorSovereigntyMigrationCurrent(namespace, {
    scope = namespace?.actorSovereigntyScope,
    payloadRev = namespace?.rev,
} = {}) {
    const output = clone(namespace);
    const expectedScope = createActorSovereigntyScope(scope);
    const migratedPayloadDigest = actorSovereigntyMigrationDigest(output, expectedScope);
    const scopeDigest = actorSovereigntyScopeDigest(expectedScope);
    const normalizedPayloadRev = Math.max(0, Number(payloadRev) || 0);
    output.actorSovereigntyMigration = {
        ...(output.actorSovereigntyMigration || {}),
        version: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
        status: 'current',
        reason: '',
        scope: expectedScope,
        scopeDigest,
        migratedPayloadDigest,
        retiredWritePathsVersion: ACTOR_SOVEREIGNTY_RETIRED_WRITE_PATHS_VERSION,
        payloadRev: normalizedPayloadRev,
        readbackVerified: true,
        // `markActorSovereigntyMigrationCurrent` is only reached after the
        // migrated payload commit has passed its digest/scope/revision
        // readback. The current marker itself is retained only when the
        // marker commit subsequently passes `actorSovereigntyMigrationIsCurrent`
        // against host readback; a failed marker write rolls back to pending.
        payloadReadbackVerified: true,
        markerReadbackVerified: true,
        commitId: migrationCommitId({
            migratedPayloadDigest,
            scopeDigest,
            payloadRev: normalizedPayloadRev,
        }),
        writeRequired: false,
    };
    return output;
}

export function migrateActorSovereigntyNamespace(value, {
    scope,
    namespaceVersion = 13,
} = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
    const expectedScope = createActorSovereigntyScope(scope);
    if (
        !expectedScope.chatId
        || !expectedScope.cardId
        || !expectedScope.runtimeVersion
        || expectedScope.cardStatus !== 'confirmed'
        || expectedScope.worldbookStatus !== 'confirmed'
    ) {
        return {
            applicable: false,
            reason: 'migration.scope_incomplete',
            namespace: null,
            report: {
                version: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
                status: 'blocked',
                reason: 'migration.scope_incomplete',
                scope: expectedScope,
            },
        };
    }
    const sourceScope = source.actorSovereigntyScope
        ? createActorSovereigntyScope(source.actorSovereigntyScope)
        : null;
    if (sourceScope && !actorSovereigntyScopesMatch(sourceScope, expectedScope)) {
        return {
            applicable: false,
            reason: 'migration.scope_mismatch',
            namespace: null,
            report: {
                version: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
                status: 'isolated',
                reason: 'migration.scope_mismatch',
                sourceScope,
                scope: expectedScope,
                sourceDigest: contentAddressedJsonRef(source),
                writePath: ACTOR_SOVEREIGNTY_NAMESPACE_WRITE_PATH,
                retiredWritePaths: [...RETIRED_ACTOR_WRITE_PATHS],
            },
        };
    }
    const expectedScopeDigest = actorSovereigntyScopeDigest(expectedScope);
    const sourceScopeProven = Boolean(
        sourceScope && actorSovereigntyScopesMatch(sourceScope, expectedScope),
    );

    const rawLedger = source.actorLedger && typeof source.actorLedger === 'object'
        ? source.actorLedger
        : emptyActorLedger(expectedScope.chatId);
    const rawRuntime = source.sovereigntyRuntime && typeof source.sovereigntyRuntime === 'object'
        ? source.sovereigntyRuntime
        : emptySovereigntyRuntime(expectedScope.chatId);
    const embeddedAttemptCount = (Array.isArray(rawLedger.actionReceipts)
        ? rawLedger.actionReceipts
        : []).filter((receipt) => receipt?.actionAttempt).length;
    const legacyInlineCheckpointCount = (Array.isArray(rawRuntime.checkpoints)
        ? rawRuntime.checkpoints
        : []).filter((checkpoint) => checkpoint?.payload !== undefined).length;
    const invalidCheckpointBlobCount = Object.entries(
        rawRuntime.checkpointBlobs && typeof rawRuntime.checkpointBlobs === 'object'
            ? rawRuntime.checkpointBlobs
            : {},
    ).filter(([key, raw]) => checkpointBlobInvalid(raw, key)).length;

    const actorLedger = normalizeActorLedger(rawLedger, { chatId: expectedScope.chatId });
    let quarantinedAttemptCount = 0;
    actorLedger.actionAttempts = actorLedger.actionAttempts.map((attempt) => {
        const strictTarget = strictTargetForScope(attempt.target, expectedScope);
        if (!strictTarget || (attemptIsActive(attempt) && !sourceScopeProven)) {
            quarantinedAttemptCount += 1;
            return quarantineAttempt(
                attempt,
                !sourceScopeProven && attemptIsActive(attempt)
                    ? 'action_attempt.legacy_scope_missing'
                    : attempt.target?.chatId && attempt.target.chatId !== expectedScope.chatId
                    ? 'action_attempt.scope_mismatch'
                    : attempt.compatibilityReason || 'action_attempt.legacy_target_incomplete',
            );
        }
        return { ...attempt, target: strictTarget };
    });
    let quarantinedReceiptCount = 0;
    actorLedger.actionReceipts = actorLedger.actionReceipts.map((receipt) => {
        const target = strictTargetForScope(receipt.target, expectedScope);
        if (target) return { ...receipt, target };
        if (!receipt.target && !receipt.attemptId) return receipt;
        quarantinedReceiptCount += 1;
        return {
            ...receipt,
            compatibilityOnly: true,
            settlementEligible: false,
            compatibilityReason: receipt.target?.chatId
                && receipt.target.chatId !== expectedScope.chatId
                ? 'action_receipt.scope_mismatch'
                : 'action_receipt.legacy_target_incomplete',
        };
    });

    const sovereigntyRuntime = normalizeSovereigntyRuntime(rawRuntime, {
        chatId: expectedScope.chatId,
        scopeDigest: expectedScopeDigest,
    });
    const actorSovereigntyObservationWAL = (Array.isArray(
        source.actorSovereigntyObservationWAL,
    ) ? source.actorSovereigntyObservationWAL : []).filter((entry) => {
        const sourceRef = normalizeSovereigntySourceRef(entry?.sourceRef);
        const target = normalizeActorActionTarget(entry?.target);
        return entry?.chatId === expectedScope.chatId
            && entry?.scopeDigest === expectedScopeDigest
            && sourceRef?.scopeDigest === expectedScopeDigest
            && sovereigntySourceKey(sourceRef) === entry?.sourceKey
            && target
            && actorActionTargetMatches(target, sourceRef);
    }).map(clone);
    const normalizedTaskIds = new Set(sovereigntyRuntime.backlog.map((task) => task.id));
    let quarantinedTaskCount = (Array.isArray(rawRuntime?.backlog)
        ? rawRuntime.backlog
        : []).filter((task) => (
        taskIsActive(task) && !normalizedTaskIds.has(cleanText(task?.id, 100))
    )).length;
    for (const task of sovereigntyRuntime.backlog) {
        if (!taskIsActive(task)) continue;
        const taskScopeDigest = cleanText(task.sourceRef?.scopeDigest, 180);
        const strictSourceRef = normalizeSovereigntySourceRef(task.sourceRef);
        if (
            sourceScopeProven
            && strictSourceRef
            && sovereigntySourceKey(strictSourceRef) === task.sourceKey
            && task.sourceRef?.chatId === expectedScope.chatId
            && taskScopeDigest === expectedScopeDigest
        ) continue;
        quarantinedTaskCount += 1;
        task.status = 'deferred';
        task.nextRetryTurn = Number.MAX_SAFE_INTEGER;
        task.claimedAt = 0;
        task.claimToken = '';
        task.recoveryMode = 'latest_state';
        task.historicalActionAllowed = false;
        task.metadata = {
            ...(task.metadata || {}),
            migrationQuarantined: true,
            migrationQuarantineReason: !sourceScopeProven
                ? 'task.legacy_scope_missing'
                : !strictSourceRef
                    ? 'task.legacy_source_ref_incomplete'
                    : sovereigntySourceKey(strictSourceRef) !== task.sourceKey
                        ? 'task.source_key_mismatch'
                : taskScopeDigest !== expectedScopeDigest
                    ? 'task.scope_digest_missing_or_mismatch'
                    : 'task.scope_mismatch',
        };
    }
    let quarantinedCheckpointCount = 0;
    sovereigntyRuntime.checkpoints = sovereigntyRuntime.checkpoints.map((checkpoint) => {
        const checkpointScopeDigest = cleanText(
            checkpoint.scopeDigest || checkpoint.sourceRef?.scopeDigest,
            180,
        );
        const blobPresent = Boolean(
            checkpoint.payloadRef && sovereigntyRuntime.checkpointBlobs[checkpoint.payloadRef],
        );
        if (
            sourceScopeProven
            && checkpoint.sourceRef?.chatId === expectedScope.chatId
            && checkpointScopeDigest === expectedScopeDigest
            && blobPresent
        ) return { ...checkpoint, scopeDigest: expectedScopeDigest };
        quarantinedCheckpointCount += 1;
        return {
            ...checkpoint,
            compatibilityOnly: true,
            restorable: false,
            compatibilityReason: !sourceScopeProven
                ? 'checkpoint.legacy_scope_missing'
                : checkpointScopeDigest !== expectedScopeDigest
                    ? 'checkpoint.scope_digest_missing_or_mismatch'
                    : !blobPresent
                        ? 'checkpoint_blob_missing_or_invalid'
                        : 'checkpoint.scope_mismatch',
        };
    });
    const compatibilityArchive = buildCompatibilityArchive(
        source,
        rawLedger,
        actorLedger,
        rawRuntime,
        sovereigntyRuntime,
        actorSovereigntyObservationWAL,
    );

    const namespace = {
        ...source,
        version: Math.max(Number(namespaceVersion) || 13, 13),
        chatId: expectedScope.chatId,
        actorSovereigntyScope: expectedScope,
        actorLedger,
        sovereigntyRuntime,
        actorSovereigntyObservationWAL,
        actorSovereigntyCompatibilityArchive: compatibilityArchive,
        continuityCheckpoint: normalizeCheckpointTarget(
            source.continuityCheckpoint,
            expectedScope,
            { sourceScopeProven, scopeDigest: expectedScopeDigest },
        ),
        actorLedgerCheckpoint: normalizeCheckpointTarget(
            source.actorLedgerCheckpoint,
            expectedScope,
            { sourceScopeProven, scopeDigest: expectedScopeDigest },
        ),
    };
    const readiness = actorLedger.actors.map((actor) => actorProfileActionReadiness(actor));
    const legacyProfileCount = actorLedger.actors.filter((actor) => (
        actor.profileV6?.baselineCommit?.status === 'legacy_persisted'
    )).length;
    const incompleteProfileCount = readiness.filter((entry) => !entry.ready).length;
    const pendingTaskCount = sovereigntyRuntime.backlog.filter((task) => (
        ['pending', 'running', 'retryable_failed', 'deferred'].includes(task.status)
        && task.metadata?.migrationQuarantined !== true
    )).length;
    const failedTaskCount = sovereigntyRuntime.backlog.filter((task) => (
        task.status === 'retryable_failed'
    )).length;
    const profileBacklogCount = sovereigntyRuntime.backlog.filter((task) => (
        ['profile', 'physiology'].includes(task.module)
        && !['committed', 'cancelled_stale'].includes(task.status)
    )).length;
    const sourceDigest = contentAddressedJsonRef(migrationProjection(source, expectedScope));
    const contentDigest = actorSovereigntyMigrationDigest(namespace, expectedScope);
    const sourceCurrent = actorSovereigntyMigrationIsCurrent(source, expectedScope);
    const writeRequired = Number(source.version) < Number(namespace.version)
        || !sourceScopeProven
        || !sourceCurrent;
    const pendingReport = {
        version: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
        status: 'migrated_pending_persist',
        reason: 'legacy_state_normalized',
        scope: expectedScope,
        scopeDigest: expectedScopeDigest,
        sourceDigest,
        migratedPayloadDigest: contentDigest,
        replayKey: contentAddressedJsonRef({
            migrationVersion: ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
            sourceDigest,
            scopeDigest: expectedScopeDigest,
        }),
        readbackVerified: false,
        payloadReadbackVerified: false,
        markerReadbackVerified: false,
        writeRequired: true,
        writePath: ACTOR_SOVEREIGNTY_NAMESPACE_WRITE_PATH,
        retiredWritePathsVersion: ACTOR_SOVEREIGNTY_RETIRED_WRITE_PATHS_VERSION,
        retiredWritePaths: [...RETIRED_ACTOR_WRITE_PATHS],
        counts: {
            legacyProfileCount,
            incompleteProfileCount,
            actionReadyProfileCount: readiness.filter((entry) => entry.ready).length,
            embeddedAttemptCount,
            quarantinedAttemptCount,
            quarantinedReceiptCount,
            legacyInlineCheckpointCount,
            invalidCheckpointBlobCount,
            quarantinedCheckpointCount,
            pendingTaskCount,
            failedTaskCount,
            profileBacklogCount,
            quarantinedTaskCount,
            archivedCompatibilityCount: compatibilityArchive.count,
        },
        compatibilityArchiveDigest: compatibilityArchive.digest,
    };
    namespace.actorSovereigntyMigration = writeRequired
        ? pendingReport
        : clone(source.actorSovereigntyMigration);
    return {
        applicable: true,
        reason: '',
        namespace,
        report: clone(namespace.actorSovereigntyMigration),
    };
}

export async function ensureActorSovereigntyMigration(value, {
    scope,
    namespaceVersion = 13,
    commitPayload,
    commitMarker,
} = {}) {
    const migrated = migrateActorSovereigntyNamespace(value, { scope, namespaceVersion });
    if (!migrated.applicable || !migrated.namespace) {
        return {
            ok: false,
            current: false,
            replayed: false,
            reason: migrated.reason || 'migration.not_applicable',
            namespace: migrated.namespace,
            report: migrated.report,
        };
    }
    if (actorSovereigntyMigrationIsCurrent(migrated.namespace, scope)) {
        return {
            ok: true,
            current: true,
            replayed: true,
            reason: '',
            namespace: migrated.namespace,
            report: clone(migrated.namespace.actorSovereigntyMigration),
        };
    }
    const blocked = (reason, namespace = migrated.namespace) => {
        const output = clone(namespace);
        output.actorSovereigntyMigration = {
            ...(output.actorSovereigntyMigration || migrated.report || {}),
            status: 'blocked',
            writeRequired: true,
            readbackVerified: false,
            lastFailure: cleanText(reason, 160) || 'migration.persistence_failed',
        };
        return {
            ok: false,
            current: false,
            replayed: false,
            reason: output.actorSovereigntyMigration.lastFailure,
            namespace: output,
            report: clone(output.actorSovereigntyMigration),
        };
    };
    if (typeof commitPayload !== 'function' || typeof commitMarker !== 'function') {
        return blocked('migration.persistence_adapter_missing');
    }
    const expectedContentDigest = migrated.report.migratedPayloadDigest;
    const expectedScopeDigest = migrated.report.scopeDigest;
    let payloadCommit;
    try {
        payloadCommit = await commitPayload(clone(migrated.namespace), {
            contentDigest: expectedContentDigest,
            scopeDigest: expectedScopeDigest,
        });
    } catch {
        return blocked('migration.payload_write_failed');
    }
    const payloadReadback = payloadCommit?.readbackNamespace;
    const payloadRev = Math.max(0, Number(payloadReadback?.rev) || 0);
    if (
        payloadCommit?.ok !== true
        || !payloadReadback
        || payloadRev < 1
        || !actorSovereigntyScopesMatch(payloadReadback.actorSovereigntyScope, scope)
        || actorSovereigntyScopeDigest(payloadReadback.actorSovereigntyScope)
            !== expectedScopeDigest
        || actorSovereigntyMigrationDigest(payloadReadback, scope) !== expectedContentDigest
    ) {
        return blocked(payloadCommit?.reason || 'migration.payload_readback_mismatch');
    }
    const current = markActorSovereigntyMigrationCurrent(payloadReadback, {
        scope,
        payloadRev,
    });
    let markerCommit;
    try {
        markerCommit = await commitMarker(clone(current), {
            contentDigest: expectedContentDigest,
            scopeDigest: expectedScopeDigest,
            payloadRev,
            commitId: current.actorSovereigntyMigration.commitId,
        });
    } catch {
        return blocked('migration.marker_write_failed', payloadReadback);
    }
    const finalReadback = markerCommit?.readbackNamespace;
    if (
        markerCommit?.ok !== true
        || !finalReadback
        || !actorSovereigntyMigrationIsCurrent(finalReadback, scope)
        || actorSovereigntyMigrationDigest(finalReadback, scope) !== expectedContentDigest
    ) {
        return blocked(markerCommit?.reason || 'migration.marker_readback_mismatch', payloadReadback);
    }
    return {
        ok: true,
        current: true,
        replayed: false,
        reason: '',
        namespace: clone(finalReadback),
        report: clone(finalReadback.actorSovereigntyMigration),
    };
}
