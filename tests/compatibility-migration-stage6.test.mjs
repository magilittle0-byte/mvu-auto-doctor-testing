import assert from 'node:assert/strict';
import test from 'node:test';
import { contentAddressedJsonRef } from '../checkpoint-codec-core.mjs';
import { actorActionTargetMatches } from '../actor-authority-core.mjs';

import {
    ACTOR_SOVEREIGNTY_MIGRATION_VERSION,
    actorSovereigntyMigrationIsCurrent,
    actorSovereigntyScopeDigest,
    actorSovereigntyWorldbookDescriptor,
    createActorSovereigntyScope,
    createActorSovereigntyWorldbookManifest,
    ensureActorSovereigntyMigration,
    migrateActorSovereigntyNamespace,
    prepareActorSovereigntyFieldWriteCandidate,
    rebaseActorSovereigntyFieldWriteAfterMigration,
} from '../compatibility-migration-core.mjs';
import { emptyActorLedger } from '../actor-ledger-core.mjs';
import {
    claimNextSovereigntyTask,
    commitSovereigntyTask,
    completeSovereigntyObservationGaps,
    dueSovereigntyTasks,
    emptySovereigntyRuntime,
    normalizeSovereigntyRuntime,
    observeSovereigntyTurn,
    restoreSovereigntyCheckpoint,
    sovereigntyHealthView,
    sovereigntySourceKey,
    supersedeSovereigntyObservationSources,
} from '../sovereignty-runtime-core.mjs';

function scope(overrides = {}) {
    return createActorSovereigntyScope({
        chatId: 'chat-stage6',
        cardId: 'character:0:card.png',
        worldbookSelectorKeys: ['book-a', 'book-b'],
        runtimeVersion: '2.0.0-rc.14:namespace-13',
        ...overrides,
    });
}

function sourceRef(valueScope = scope(), overrides = {}) {
    return {
        chatId: valueScope.chatId,
        logicalIndex: 4,
        index: 4,
        messageId: 'message-4',
        swipeId: 0,
        generation: 2,
        generationId: 'generation-2',
        generationType: 'normal',
        contentHash: 'hash-4',
        scopeDigest: actorSovereigntyScopeDigest(valueScope),
        ...overrides,
    };
}

function strictTarget(overrides = {}) {
    return {
        chatId: 'chat-stage6',
        logicalIndex: 4,
        messageId: 'message-4',
        swipeId: 0,
        generation: 2,
        generationId: 'generation-2',
        generationType: 'normal',
        contentHash: 'hash-4',
        ...overrides,
    };
}

function namespace(valueScope = scope()) {
    return {
        version: 13,
        rev: 0,
        fieldRevisions: {},
        chatId: valueScope.chatId,
        actorSovereigntyScope: valueScope,
        actorLedger: emptyActorLedger(valueScope.chatId),
        sovereigntyRuntime: emptySovereigntyRuntime(valueScope.chatId, {
            scopeDigest: actorSovereigntyScopeDigest(valueScope),
        }),
        actorLedgerCheckpoint: null,
        actorLedgerCheckpointBlobs: {},
        continuityCheckpoint: null,
    };
}

function inMemoryMigrationAdapter(initial, behavior = {}) {
    let persisted = structuredClone(initial);
    let payloadWrites = 0;
    let markerWrites = 0;
    return {
        get persisted() {
            return structuredClone(persisted);
        },
        get payloadWrites() {
            return payloadWrites;
        },
        get markerWrites() {
            return markerWrites;
        },
        async commitPayload(candidate) {
            payloadWrites += 1;
            if (behavior.failPayload && payloadWrites <= behavior.failPayload) {
                return { ok: false, reason: 'power_loss', readbackNamespace: null };
            }
            persisted = { ...structuredClone(candidate), rev: Number(persisted.rev || 0) + 1 };
            const readbackNamespace = structuredClone(persisted);
            if (behavior.corruptPayloadReadback && payloadWrites === 1) {
                readbackNamespace.actorLedger.turn += 1;
            }
            return { ok: true, readbackNamespace };
        },
        async commitMarker(candidate) {
            markerWrites += 1;
            if (behavior.failMarker && markerWrites <= behavior.failMarker) {
                return { ok: false, reason: 'marker_power_loss', readbackNamespace: null };
            }
            persisted = {
                ...persisted,
                actorSovereigntyMigration: structuredClone(
                    candidate.actorSovereigntyMigration,
                ),
                rev: Number(persisted.rev || 0) + 1,
            };
            return { ok: true, readbackNamespace: structuredClone(persisted) };
        },
    };
}

async function ensureWithAdapter(value, valueScope, adapter) {
    return ensureActorSovereigntyMigration(value, {
        scope: valueScope,
        namespaceVersion: 13,
        commitPayload: adapter.commitPayload.bind(adapter),
        commitMarker: adapter.commitMarker.bind(adapter),
    });
}

test('旧路径与迁移收敛 v4 is deterministic and current Registry blocks continuity identity promotion', () => {
    const valueScope = scope();
    const source = namespace(valueScope);
    source.actorLedger.updatedAt = 120;
    source.actorLedger.actorRegistry.updatedAt = 110;
    source.actorLedger.migrations.continuityV5 = false;
    source.actorLedger.actors = [{
        id: 'NPC-UNREGISTERED-RAW',
        name: '未登记原始人物',
        createdTurn: 1,
        updatedTurn: 1,
    }];
    source.continuity = {
        chatId: valueScope.chatId,
        turn: 3,
        updatedAt: 150,
        threads: [{
            id: 'CONTINUITY-CURRENT-REGISTRY-BLOCK',
            actors: ['连续性越级人物'],
            knowledge: 'observed',
            summary: '这只是连续性中的历史投影。',
            nextBeat: '试图越过候选表登记。',
            sourceRefs: [],
        }],
    };
    const first = migrateActorSovereigntyNamespace(source, { scope: valueScope });
    const second = migrateActorSovereigntyNamespace(source, { scope: valueScope });
    assert.equal(ACTOR_SOVEREIGNTY_MIGRATION_VERSION, 4);
    assert.deepEqual(first.namespace.actorLedger, second.namespace.actorLedger);
    assert.equal(first.report.migratedPayloadDigest, second.report.migratedPayloadDigest);
    assert.equal(first.report.replayKey, second.report.replayKey);
    assert.equal(first.namespace.actorLedger.updatedAt, 150);
    assert.deepEqual(first.namespace.actorLedger.actors, []);
    assert.deepEqual(first.namespace.actorLedger.actorRegistry.registered, {});
    assert.equal(
        first.namespace.actorLedger.actors.some((actor) => actor.name === '连续性越级人物'),
        false,
    );
});

test('旧路径与迁移收敛 reconstructs identity only from raw pre-Registry evidence', () => {
    const valueScope = scope();
    const source = namespace(valueScope);
    source.actorLedger = {
        version: 6,
        chatId: valueScope.chatId,
        turn: 2,
        actors: [],
        migrations: { continuityV5: false, actorRegistryV1: false },
        updatedAt: 200,
        unknownLegacyLedgerField: { preserved: true },
    };
    source.continuity = {
        chatId: valueScope.chatId,
        turn: 3,
        updatedAt: 210,
        threads: [{
            id: 'LEGACY-PRE-REGISTRY',
            actors: ['旧连续性人物'],
            locations: ['旧港口'],
            knowledge: 'observed',
            summary: '旧连续性人物目睹了港口封锁。',
            nextBeat: '核对封锁告示。',
            seedBasis: 'persisted-legacy-thread',
            sourceRefs: [],
        }],
    };
    const migrated = migrateActorSovereigntyNamespace(source, { scope: valueScope });
    assert.deepEqual(migrated.namespace.actorLedger.actors.map((actor) => actor.name), [
        '旧连续性人物',
    ]);
    assert.equal(
        migrated.namespace.actorLedger.actorRegistry.registered['旧连续性人物'].origin,
        'legacy_continuity_migration',
    );
    assert.equal(migrated.namespace.actorLedger.migrations.continuityV5, true);
    assert.equal(migrated.namespace.actorLedger.updatedAt, 210);
    assert.equal(
        migrated.namespace.actorSovereigntyCompatibilityArchive.items.some(
            (item) => item.path.includes('unknownLegacyLedgerField'),
        ),
        true,
    );
});

test('旧路径与迁移收敛 retries a failed marker with an identical payload digest', async () => {
    const valueScope = scope();
    const source = namespace(valueScope);
    source.actorLedger.updatedAt = 300;
    source.continuity = { chatId: valueScope.chatId, turn: 0, threads: [], updatedAt: 310 };
    const adapter = inMemoryMigrationAdapter(source, { failMarker: 1 });
    const failed = await ensureWithAdapter(source, valueScope, adapter);
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'marker_power_loss');
    const failedDigest = failed.report.migratedPayloadDigest;
    const failedReplayKey = failed.report.replayKey;
    const retried = await ensureWithAdapter(adapter.persisted, valueScope, adapter);
    assert.equal(retried.ok, true);
    assert.equal(retried.report.migratedPayloadDigest, failedDigest);
    assert.equal(retried.report.replayKey, failedReplayKey);
});

test('generic field-write guard rejects old scope/state and only rebases identical content', async () => {
    const valueScope = scope();
    const initial = namespace(valueScope);
    initial.repairJournal = [{ id: 'repair-current', value: 'NEW-SCOPE' }];
    const adapter = inMemoryMigrationAdapter(initial);
    const ensured = await ensureWithAdapter(initial, valueScope, adapter);
    assert.equal(ensured.ok, true);
    const current = structuredClone(ensured.namespace);
    current.rev = Math.max(20, Number(current.rev) || 0);
    current.fieldRevisions = {
        ...(current.fieldRevisions || {}),
        repairJournal: current.rev,
        actorLedger: current.rev,
    };

    const identical = structuredClone(current);
    identical.rev = current.rev - 5;
    identical.fieldRevisions.repairJournal = current.rev - 5;
    identical.fieldRevisions.actorLedger = current.rev - 5;
    const safe = prepareActorSovereigntyFieldWriteCandidate(identical, current, {
        scope: valueScope,
        fields: ['repairJournal'],
    });
    assert.equal(safe.allowed, true);
    assert.deepEqual(safe.rebasedFields, ['repairJournal']);
    assert.equal(safe.candidate.fieldRevisions.repairJournal, current.rev);

    const oldRepair = structuredClone(identical);
    oldRepair.repairJournal = [{ id: 'repair-old', value: 'OLD-SCOPE' }];
    const rejectedRepair = prepareActorSovereigntyFieldWriteCandidate(oldRepair, current, {
        scope: valueScope,
        fields: ['repairJournal'],
    });
    assert.equal(rejectedRepair.allowed, false);
    assert.equal(rejectedRepair.reason, 'migration.write_field_revision_stale');
    assert.deepEqual(rejectedRepair.staleFields, ['repairJournal']);

    const oldLedger = structuredClone(identical);
    oldLedger.actorLedger.turn = current.actorLedger.turn + 99;
    const rejectedLedger = prepareActorSovereigntyFieldWriteCandidate(oldLedger, current, {
        scope: valueScope,
        fields: ['actorLedger'],
    });
    assert.equal(rejectedLedger.allowed, false);
    assert.deepEqual(rejectedLedger.staleFields, ['actorLedger']);

    const wrongScope = scope({ cardId: 'character:0:previous-card.png' });
    const oldScopeCandidate = structuredClone(current);
    oldScopeCandidate.actorSovereigntyScope = wrongScope;
    const rejectedScope = prepareActorSovereigntyFieldWriteCandidate(oldScopeCandidate, current, {
        scope: valueScope,
        fields: ['repairJournal'],
    });
    assert.equal(rejectedScope.allowed, false);
    assert.equal(rejectedScope.reason, 'migration.write_scope_mismatch');
    assert.deepEqual(current.repairJournal, [{ id: 'repair-current', value: 'NEW-SCOPE' }]);
    assert.equal(current.actorLedger.turn, 0);
});

test('first post-migration field write safely replays caller value only on an unchanged base', async () => {
    const valueScope = scope();
    const before = namespace(valueScope);
    before.rev = 0;
    before.characterCreationTicketBatches = [];
    before.fieldRevisions = { characterCreationTicketBatches: 0 };
    const caller = structuredClone(before);
    caller.characterCreationTicketBatches = [{ generationId: 'generation-1', tickets: ['T1'] }];

    const adapter = inMemoryMigrationAdapter(before);
    const migrated = await ensureWithAdapter(before, valueScope, adapter);
    assert.equal(migrated.ok, true);
    assert.ok(migrated.namespace.rev > before.rev);

    const replay = rebaseActorSovereigntyFieldWriteAfterMigration(
        caller,
        before,
        migrated.namespace,
        { scope: valueScope, fields: ['characterCreationTicketBatches'] },
    );
    assert.equal(replay.allowed, true);
    assert.deepEqual(replay.candidate.characterCreationTicketBatches, caller.characterCreationTicketBatches);
    assert.equal(
        replay.candidate.fieldRevisions.characterCreationTicketBatches,
        migrated.namespace.fieldRevisions.characterCreationTicketBatches
            || migrated.namespace.rev,
    );
    const prepared = prepareActorSovereigntyFieldWriteCandidate(
        replay.candidate,
        migrated.namespace,
        { scope: valueScope, fields: ['characterCreationTicketBatches'] },
    );
    assert.equal(prepared.allowed, true);

    const concurrentlyChanged = structuredClone(migrated.namespace);
    concurrentlyChanged.characterCreationTicketBatches = [{ generationId: 'other', tickets: [] }];
    concurrentlyChanged.rev += 1;
    concurrentlyChanged.fieldRevisions.characterCreationTicketBatches = concurrentlyChanged.rev;
    const blocked = rebaseActorSovereigntyFieldWriteAfterMigration(
        caller,
        before,
        concurrentlyChanged,
        { scope: valueScope, fields: ['characterCreationTicketBatches'] },
    );
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, 'migration.write_rebase_field_changed');
    assert.deepEqual(blocked.staleFields, ['characterCreationTicketBatches']);
});

test('legacy namespace without full scope quarantines active work and preserves history only', () => {
    let runtime = emptySovereigntyRuntime('chat-stage6');
    const legacySourceRef = { ...sourceRef(), scopeDigest: '' };
    runtime.version = 4;
    runtime.observedThrough = {
        turn: 1,
        sourceKey: 'SRC-LEGACY-NO-SCOPE',
        sourceRef: legacySourceRef,
        at: 10,
    };
    runtime.observations = [{
        turn: 1,
        sourceKey: 'SRC-LEGACY-NO-SCOPE',
        sourceRef: legacySourceRef,
        observedAt: 10,
    }];
    runtime.backlog = ['profile', 'actor', 'world'].map((module) => ({
        id: `legacy-${module}`,
        sourceKey: 'SRC-LEGACY-NO-SCOPE',
        sourceRef: legacySourceRef,
        turn: 1,
        module,
        status: 'pending',
        nextRetryTurn: 1,
        createdAt: 10,
        updatedAt: 10,
    }));
    runtime.checkpoints.push({
        id: 'legacy-inline',
        taskId: 'legacy-world',
        module: 'world',
        turn: 1,
        sourceRef: { ...sourceRef(), scopeDigest: '' },
        payload: { actorLedger: { turn: 1 } },
        createdAt: 11,
    });
    const ledger = emptyActorLedger('chat-stage6');
    ledger.actionReceipts.push({
        id: 'receipt-legacy',
        actionAttempt: { id: 'attempt-embedded', status: 'pending_world' },
    });
    const migrated = migrateActorSovereigntyNamespace({
        version: 8,
        chatId: 'chat-stage6',
        actorLedger: ledger,
        sovereigntyRuntime: runtime,
        continuityCheckpoint: { targetIndex: 4, state: { turn: 3 } },
    }, { scope: scope() });
    assert.equal(migrated.applicable, true);
    assert.equal(migrated.report.status, 'migrated_pending_persist');
    assert.equal(migrated.report.counts.embeddedAttemptCount, 1);
    assert.equal(migrated.report.counts.quarantinedTaskCount, 3);
    assert.equal(dueSovereigntyTasks(migrated.namespace.sovereigntyRuntime).length, 0);
    assert.equal(claimNextSovereigntyTask(
        migrated.namespace.sovereigntyRuntime,
        { module: 'world', currentTurn: 99 },
    ).task, null);
    assert.equal(migrated.namespace.sovereigntyRuntime.checkpoints[0].compatibilityOnly, true);
    assert.equal(migrated.namespace.sovereigntyRuntime.checkpoints[0].restorable, false);
    assert.equal(migrated.namespace.continuityCheckpoint.compatibilityOnly, true);
    assert.equal(migrated.namespace.continuityCheckpoint.restorable, false);
    assert.equal(
        migrated.namespace.actorLedger.actionReceipts.some(
            (receipt) => Object.hasOwn(receipt, 'actionAttempt'),
        ),
        false,
    );
    const liftedAttempt = migrated.namespace.actorLedger.actionAttempts.find(
        (attempt) => attempt.id === 'attempt-embedded',
    );
    assert.ok(liftedAttempt, 'embedded historical attempt must be lifted before receipt cleanup');
    assert.equal(liftedAttempt.compatibilityOnly, true);
    assert.equal(liftedAttempt.settlementEligible, false);
    assert.equal(liftedAttempt.migratedFromLegacyReceipt, true);
});

test('only an exact persisted scopeDigest keeps tasks and checkpoints recoverable', () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    let runtime = emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest });
    runtime = observeSovereigntyTurn(runtime, {
        sourceRef: sourceRef(valueScope),
        modules: ['world'],
        now: 20,
    }).runtime;
    runtime.checkpoints.push({
        id: 'checkpoint-exact',
        taskId: runtime.backlog.find((task) => task.module === 'world').id,
        module: 'world',
        turn: 1,
        sourceKey: sovereigntySourceKey(sourceRef(valueScope)),
        sourceRef: sourceRef(valueScope),
        scopeDigest: digest,
        payload: { continuity: { turn: 1 } },
        createdAt: 21,
    });
    const migrated = migrateActorSovereigntyNamespace({
        ...namespace(valueScope),
        sovereigntyRuntime: runtime,
        continuityCheckpoint: {
            scopeDigest: digest,
            target: strictTarget({ scopeDigest: digest }),
            state: { turn: 1 },
        },
    }, { scope: valueScope });
    assert.equal(migrated.report.counts.quarantinedTaskCount, 0);
    assert.equal(migrated.report.counts.quarantinedCheckpointCount, 0);
    assert.equal(dueSovereigntyTasks(migrated.namespace.sovereigntyRuntime).length, 1);
    assert.equal(migrated.namespace.continuityCheckpoint.restorable, true);
    assert.equal(
        restoreSovereigntyCheckpoint(
            migrated.namespace.sovereigntyRuntime,
            { checkpointId: 'checkpoint-exact' },
        ).restored,
        true,
    );
    assert.equal(
        migrated.namespace.actorSovereigntyCompatibilityArchive.items.some(
            (entry) => entry.path === 'sovereigntyRuntime.checkpoints[0]',
        ),
        false,
        'a valid inline checkpoint is content-addressed, not duplicated into quarantine',
    );
});

test('lossy legacy normalization archives rejected raw data exactly and idempotently', () => {
    const valueScope = scope();
    const source = namespace(valueScope);
    source.actorLedger.orphanLedgerRecord = {
        owner: 'unknown-legacy-writer',
        nested: { keep: ['alpha', 'beta'] },
    };
    source.actorLedger.actors.push({
        id: '',
        name: '',
        nestedUnknown: { exact: 17 },
    });
    const overlongActorName = 'L'.repeat(320);
    source.actorLedger.actors.push({
        id: 'NPC-LONG-NAME',
        name: overlongActorName,
        status: 'active',
    });
    source.actorLedger.actionReceipts.push({
        id: 'malformed-receipt',
        unknownReceiptPayload: { exact: 'receipt-history' },
    });
    source.sovereigntyRuntime.orphanRuntimeRecord = {
        exact: { retry: false, reason: 'legacy-conflict' },
    };
    source.sovereigntyRuntime.backlog.push({
        id: 'malformed-task',
        module: 'unknown-module',
        status: 'pending',
        sourceRef: sourceRef(valueScope),
        opaque: { exact: 'task-history' },
    });
    const legacyMissingGenerationType = sourceRef(valueScope);
    delete legacyMissingGenerationType.generationType;
    source.sovereigntyRuntime.backlog.push({
        id: 'legacy-task-missing-generation-type',
        module: 'actor',
        status: 'pending',
        sourceKey: 'SRC-LEGACY-MISSING-GENERATION-TYPE',
        sourceRef: legacyMissingGenerationType,
        turn: 1,
        opaque: { exact: 'legacy-nine-field-gap' },
    });
    source.sovereigntyRuntime.checkpoints.push({
        id: 'malformed-checkpoint',
        taskId: 'malformed-task',
        module: 'world',
        sourceRef: null,
        payload: { exact: 'checkpoint-history' },
    });
    source.sovereigntyRuntime.checkpointBlobs = {
        'JSON-SHA256-V1-invalid': {
            digest: 'JSON-SHA256-V1-invalid',
            payload: { exact: 'invalid-blob-history' },
        },
    };
    const first = migrateActorSovereigntyNamespace(source, { scope: valueScope });
    const archive = first.namespace.actorSovereigntyCompatibilityArchive;
    assert.equal(archive.mode, 'read_only_compatibility_quarantine');
    assert.equal(archive.actionReady, false);
    assert.equal(archive.settlementEligible, false);
    assert.equal(archive.restorable, false);
    assert.equal(
        first.namespace.actorLedger.actors.some((actor) => actor.id === 'NPC-LONG-NAME'),
        false,
    );
    assert.equal(
        first.namespace.sovereigntyRuntime.backlog.some((task) => task.id === 'malformed-task'),
        false,
    );
    assert.equal(
        first.namespace.sovereigntyRuntime.checkpoints.some(
            (checkpoint) => checkpoint.id === 'malformed-checkpoint',
        ),
        false,
    );
    const byPath = new Map(archive.items.map((entry) => [entry.path, entry]));
    assert.deepEqual(
        byPath.get('actorLedger.orphanLedgerRecord')?.raw,
        source.actorLedger.orphanLedgerRecord,
    );
    assert.deepEqual(
        byPath.get('actorLedger.actors[0]')?.raw,
        source.actorLedger.actors[0],
    );
    assert.deepEqual(
        byPath.get('actorLedger.actors[1]')?.raw,
        source.actorLedger.actors[1],
        'an unregistered current-scope actor must remain exact read-only history',
    );
    assert.equal(
        byPath.get('actorLedger.actors[1]')?.reason,
        'normalizer_rejected_or_conflicted',
    );
    assert.deepEqual(
        byPath.get('actorLedger.actionReceipts[0]')?.raw,
        source.actorLedger.actionReceipts[0],
    );
    assert.deepEqual(
        byPath.get('sovereigntyRuntime.orphanRuntimeRecord')?.raw,
        source.sovereigntyRuntime.orphanRuntimeRecord,
    );
    assert.deepEqual(
        byPath.get('sovereigntyRuntime.backlog[0]')?.raw,
        source.sovereigntyRuntime.backlog[0],
    );
    assert.deepEqual(
        byPath.get('sovereigntyRuntime.backlog[1]')?.raw,
        source.sovereigntyRuntime.backlog[1],
        'legacy sourceRef missing generationType must be archived verbatim, never inferred',
    );
    assert.deepEqual(
        byPath.get('sovereigntyRuntime.checkpoints[0]')?.raw,
        source.sovereigntyRuntime.checkpoints[0],
    );
    assert.deepEqual(
        byPath.get('sovereigntyRuntime.checkpointBlobs.JSON-SHA256-V1-invalid')?.raw,
        source.sovereigntyRuntime.checkpointBlobs['JSON-SHA256-V1-invalid'],
    );
    assert.equal(first.report.counts.archivedCompatibilityCount, archive.count);
    assert.equal(first.report.compatibilityArchiveDigest, archive.digest);

    const replay = migrateActorSovereigntyNamespace(first.namespace, { scope: valueScope });
    assert.equal(replay.namespace.actorSovereigntyCompatibilityArchive.count, archive.count);
    assert.equal(replay.namespace.actorSovereigntyCompatibilityArchive.digest, archive.digest);
    assert.deepEqual(replay.namespace.actorSovereigntyCompatibilityArchive.items, archive.items);
});

test('same chat rejects card, worldbook selector membership and runtime changes', () => {
    const original = scope();
    const source = namespace(original);
    for (const changed of [
        scope({ cardId: 'character:0:other-card.png' }),
        scope({ worldbookSelectorKeys: ['book-a', 'book-c'] }),
        scope({ runtimeVersion: '2.0.0-rc.15:namespace-14' }),
    ]) {
        const migrated = migrateActorSovereigntyNamespace(source, { scope: changed });
        assert.equal(migrated.applicable, false);
        assert.equal(migrated.reason, 'migration.scope_mismatch');
    }
    assert.equal(
        actorSovereigntyScopeDigest(scope({ worldbookSelectorKeys: ['book-b', 'book-a'] })),
        actorSovereigntyScopeDigest(original),
        'worldbook order must not change scope',
    );
});

test('worldbook manifest hashes real content canonically and honors host revision authority', () => {
    const firstBook = {
        entries: [
            { uid: 2, comment: 'B', key: ['beta', 'alpha'], content: 'second' },
            { uid: 1, comment: 'A', key: ['root'], content: 'first' },
        ],
    };
    const reorderedSameBook = {
        entries: [
            { uid: 1, comment: 'A', key: ['root'], content: 'first' },
            { uid: 2, comment: 'B', key: ['alpha', 'beta'], content: 'second' },
        ],
    };
    const changedBook = {
        entries: [
            { uid: 1, comment: 'A', key: ['root'], content: 'changed' },
            { uid: 2, comment: 'B', key: ['alpha', 'beta'], content: 'second' },
        ],
    };
    const first = actorSovereigntyWorldbookDescriptor('same-book', firstBook);
    const reordered = actorSovereigntyWorldbookDescriptor('same-book', reorderedSameBook);
    const changed = actorSovereigntyWorldbookDescriptor('same-book', changedBook);
    assert.equal(first.revision, reordered.revision);
    assert.notEqual(first.revision, changed.revision);
    const coldKeyOrder = actorSovereigntyWorldbookDescriptor('same-book', {
        entries: [{
            content: 'first',
            key: ['root'],
            comment: 'A',
            uid: 1,
            probability: 100,
            loadedAt: 1,
            cacheSource: 'cold-load',
        }],
    });
    const hotKeyOrder = actorSovereigntyWorldbookDescriptor('same-book', {
        entries: [{
            cacheSource: 'hot-cache',
            loadedAt: 999,
            probability: 100,
            uid: 1,
            comment: 'A',
            key: ['root'],
            content: 'first',
        }],
    });
    assert.equal(
        coldKeyOrder.revision,
        hotKeyOrder.revision,
        'unchanged canonical semantics must survive hot/cold cache and object key order',
    );
    assert.notEqual(
        hotKeyOrder.revision,
        actorSovereigntyWorldbookDescriptor('same-book', {
            entries: [{
                probability: 90,
                uid: 1,
                comment: 'A',
                key: ['root'],
                content: 'first',
            }],
        }).revision,
        'one injection-semantic field change must change the synthetic revision',
    );
    assert.notEqual(
        actorSovereigntyWorldbookDescriptor('same-book', {
            entries: [{ uid: 1, content: 'same', probability: 10, role: 0 }],
        }).revision,
        actorSovereigntyWorldbookDescriptor('same-book', {
            entries: [{ uid: 1, content: 'same', probability: 20, role: 0 }],
        }).revision,
        'host matching semantics must participate in a synthetic revision',
    );

    const second = actorSovereigntyWorldbookDescriptor('second-book', {
        entries: [{ uid: 1, content: 'other' }],
    });
    const manifestA = createActorSovereigntyWorldbookManifest([first, second]);
    const manifestReordered = createActorSovereigntyWorldbookManifest([second, reordered]);
    assert.equal(manifestA.manifestDigest, manifestReordered.manifestDigest);
    assert.notEqual(
        manifestA.manifestDigest,
        createActorSovereigntyWorldbookManifest([changed, second]).manifestDigest,
    );
    assert.notEqual(
        manifestA.manifestDigest,
        createActorSovereigntyWorldbookManifest([first]).manifestDigest,
    );

    const hostA = actorSovereigntyWorldbookDescriptor('same-book', firstBook, {
        explicitRevision: '42',
    });
    const hostB = actorSovereigntyWorldbookDescriptor('same-book', changedBook, {
        explicitRevision: '42',
    });
    assert.equal(hostA.revision, 'host:42');
    assert.deepEqual(hostA, hostB);
    assert.equal(
        createActorSovereigntyWorldbookManifest([hostA]).manifestDigest,
        createActorSovereigntyWorldbookManifest([hostB]).manifestDigest,
    );

    const unresolvedScope = scope({ worldbookSelectorKeys: ['book-a', 'unresolved-book'] });
    assert.equal(
        migrateActorSovereigntyNamespace(namespace(scope()), {
            scope: unresolvedScope,
        }).applicable,
        false,
    );
    assert.equal(
        actorSovereigntyMigrationIsCurrent(namespace(scope()), unresolvedScope),
        false,
    );
});

test('two-phase migration retries write failures and readback mismatch without claiming success', async () => {
    const valueScope = scope();
    const legacy = namespace(valueScope);
    delete legacy.actorSovereigntyMigration;
    const powerLoss = inMemoryMigrationAdapter(legacy, { failPayload: 1 });
    const failed = await ensureWithAdapter(legacy, valueScope, powerLoss);
    assert.equal(failed.ok, false);
    assert.equal(failed.report.status, 'blocked');
    const retried = await ensureWithAdapter(powerLoss.persisted, valueScope, powerLoss);
    assert.equal(retried.ok, true);
    assert.equal(actorSovereigntyMigrationIsCurrent(retried.namespace, valueScope), true);

    const mismatch = inMemoryMigrationAdapter(legacy, { corruptPayloadReadback: true });
    const rejected = await ensureWithAdapter(legacy, valueScope, mismatch);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'migration.payload_readback_mismatch');

    const markerLoss = inMemoryMigrationAdapter(legacy, { failMarker: 1 });
    const markerFailed = await ensureWithAdapter(legacy, valueScope, markerLoss);
    assert.equal(markerFailed.ok, false);
    assert.equal(markerFailed.report.readbackVerified, false);
    const markerRetried = await ensureWithAdapter(markerLoss.persisted, valueScope, markerLoss);
    assert.equal(markerRetried.ok, true);
});

test('current marker is not invalidated by valid dynamic receipts, tasks or checkpoints', async () => {
    const valueScope = scope();
    const adapter = inMemoryMigrationAdapter(namespace(valueScope));
    const migrated = await ensureWithAdapter(adapter.persisted, valueScope, adapter);
    assert.equal(migrated.ok, true);
    const digest = actorSovereigntyScopeDigest(valueScope);
    let dynamic = structuredClone(migrated.namespace);
    dynamic.actorLedger.actionReceipts.push({
        id: 'receipt-after-migration',
        attemptId: 'attempt-after-migration',
        stage: 'world_settled',
        status: 'settled',
    });
    dynamic.sovereigntyRuntime = observeSovereigntyTurn(dynamic.sovereigntyRuntime, {
        sourceRef: sourceRef(valueScope, {
            logicalIndex: 5,
            messageId: 'message-5',
            contentHash: 'hash-5',
        }),
        modules: ['world'],
        now: 30,
    }).runtime;
    const claimed = claimNextSovereigntyTask(dynamic.sovereigntyRuntime, {
        module: 'world',
        currentTurn: 2,
        now: 31,
    });
    dynamic.sovereigntyRuntime = commitSovereigntyTask(claimed.runtime, {
        taskId: claimed.task.id,
        claimToken: claimed.task.claimToken,
        payload: { continuity: { turn: 2 } },
        now: 32,
    }).runtime;
    assert.equal(dynamic.sovereigntyRuntime.scopeDigest, digest);
    const noWrites = inMemoryMigrationAdapter(dynamic);
    const replayed = await ensureWithAdapter(dynamic, valueScope, noWrites);
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayed, true);
    assert.equal(noWrites.payloadWrites, 0);
    assert.equal(noWrites.markerWrites, 0);

    dynamic.actorLedger.version = 7;
    const schemaUpgrade = inMemoryMigrationAdapter(dynamic);
    const upgraded = await ensureWithAdapter(dynamic, valueScope, schemaUpgrade);
    assert.equal(upgraded.ok, true);
    assert.equal(schemaUpgrade.payloadWrites, 1);
    assert.equal(upgraded.report.version, ACTOR_SOVEREIGNTY_MIGRATION_VERSION);
});

test('P3 checkpoint phases keep the production migration guard current only with a strict target', async () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    const adapter = inMemoryMigrationAdapter(namespace(valueScope));
    const migrated = await ensureWithAdapter(adapter.persisted, valueScope, adapter);
    assert.equal(migrated.ok, true);
    assert.equal(actorSovereigntyMigrationIsCurrent(migrated.namespace, valueScope), true);

    const expectedTarget = strictTarget({ scopeDigest: digest });
    const legacy = structuredClone(migrated.namespace);
    legacy.continuityCheckpoint = {
        scopeDigest: digest,
        stage3Phase: 'world_call_reserved',
        stage3ProducerTarget: { generationId: expectedTarget.generationId },
    };
    assert.equal(actorSovereigntyMigrationIsCurrent(legacy, valueScope), false);

    for (const stage3Phase of [
        'world_call_reserved',
        'world_candidate_prepared',
        'world_committed',
    ]) {
        const candidate = structuredClone(migrated.namespace);
        candidate.continuityCheckpoint = {
            scopeDigest: digest,
            target: structuredClone(expectedTarget),
            stage3Phase,
            stage3ProducerTarget: { generationId: expectedTarget.generationId },
        };
        assert.equal(
            actorSovereigntyMigrationIsCurrent(candidate, valueScope),
            true,
            `${stage3Phase} candidate must not invalidate guarded writer precondition`,
        );
        assert.equal(
            actorActionTargetMatches(candidate.continuityCheckpoint.target, expectedTarget),
            true,
        );
    }

    for (const [field, changed] of [
        ['chatId', 'chat-drift'],
        ['logicalIndex', 5],
        ['messageId', 'message-drift'],
        ['swipeId', 1],
        ['generation', 3],
        ['generationId', 'generation-drift'],
        ['generationType', 'swipe'],
        ['scopeDigest', 'scope-drift'],
        ['contentHash', 'content-drift'],
    ]) {
        const candidate = structuredClone(migrated.namespace);
        candidate.continuityCheckpoint = {
            scopeDigest: digest,
            target: { ...expectedTarget, [field]: changed },
            stage3Phase: 'world_candidate_prepared',
        };
        const guardedTargetMatches = actorSovereigntyMigrationIsCurrent(candidate, valueScope)
            && actorActionTargetMatches(candidate.continuityCheckpoint.target, expectedTarget);
        assert.equal(guardedTargetMatches, false, field);
    }
});

test('observation-only advances without actions while an explicit gap waits for convergence', () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    const pure = observeSovereigntyTurn(
        emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest }),
        {
            sourceRef: sourceRef(valueScope),
            modules: [],
            observationOnlyFinal: true,
            now: 40,
        },
    ).runtime;
    assert.equal(pure.backlog.filter((task) => task.module !== 'observation').length, 0);
    assert.equal(pure.simulatedThrough.turn, 1);

    let gap = observeSovereigntyTurn(
        emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest }),
        {
            sourceRef: sourceRef(valueScope),
            modules: [],
            observationOnlyFinal: false,
            now: 50,
        },
    ).runtime;
    const observationTask = gap.backlog.find((task) => task.module === 'observation');
    const target = strictTarget();
    observationTask.metadata.observationGapRecovery = true;
    observationTask.metadata.simulationRequired = true;
    observationTask.metadata.actorActionsAllowed = false;
    observationTask.metadata.convergenceCoversSourceKeys = [observationTask.sourceKey];
    observationTask.metadata.convergenceTargets = [{
        sourceKey: observationTask.sourceKey,
        target,
    }];
    observationTask.metadata.convergenceLatestSourceKey = observationTask.sourceKey;
    assert.equal(gap.simulatedThrough.turn, 0);
    const missingProof = completeSovereigntyObservationGaps(gap, {
        scopeDigest: digest,
        now: 51,
    });
    assert.equal(missingProof.completed.length, 0);
    assert.equal(missingProof.runtime.simulatedThrough.turn, 0);

    const changedBody = {
        version: 1,
        kind: 'current_chat_observation_convergence',
        scopeDigest: digest,
        entries: [{
            sourceKey: observationTask.sourceKey,
            target: { ...target, contentHash: 'changed-current-content' },
        }],
        latestSourceKey: observationTask.sourceKey,
    };
    const changedSource = completeSovereigntyObservationGaps(gap, {
        scopeDigest: digest,
        proof: {
            ...changedBody,
            proofDigest: contentAddressedJsonRef(changedBody),
        },
        now: 52,
    });
    assert.equal(changedSource.completed.length, 0);
    assert.equal(changedSource.runtime.simulatedThrough.turn, 0);

    const currentSource = sourceRef(valueScope, { contentHash: 'changed-current-content' });
    const superseded = supersedeSovereigntyObservationSources(gap, {
        scopeDigest: digest,
        replacements: [{
            sourceKey: observationTask.sourceKey,
            currentSourceKey: sovereigntySourceKey(currentSource),
            logicalIndex: currentSource.logicalIndex,
            scopeDigest: digest,
            sourceRef: sourceRef(valueScope),
            currentSourceRef: currentSource,
        }],
        now: 52,
    });
    assert.deepEqual(superseded.superseded, [observationTask.sourceKey]);
    assert.equal(superseded.runtime.observations[0].superseded, true);
    assert.equal(superseded.runtime.backlog[0].status, 'cancelled_stale');
    assert.equal(
        superseded.runtime.backlog[0].metadata.cancelReason,
        'source_replaced',
    );
    assert.equal(superseded.runtime.simulatedThrough.turn, 0);
    assert.equal(sovereigntyHealthView(superseded.runtime).backlog, 0);
    assert.equal(sovereigntyHealthView(superseded.runtime).cancelledIncomplete, 0);

    const missingObservationEvidence = structuredClone(superseded.runtime);
    missingObservationEvidence.observations[0].superseded = false;
    assert.equal(sovereigntyHealthView(missingObservationEvidence).backlog, 1);
    assert.equal(sovereigntyHealthView(missingObservationEvidence).cancelledIncomplete, 1);

    const currentObserved = observeSovereigntyTurn(superseded.runtime, {
        sourceRef: currentSource,
        modules: [],
        observationOnlyFinal: true,
        now: 53,
    });
    assert.equal(currentObserved.observed, true);
    assert.equal(currentObserved.turn, 1);
    assert.equal(currentObserved.runtime.simulatedThrough.turn, 1);
    assert.equal(sovereigntyHealthView(currentObserved.runtime).backlog, 0);
    assert.equal(sovereigntyHealthView(currentObserved.runtime).cancelledIncomplete, 0);

    const currentBusiness = observeSovereigntyTurn(superseded.runtime, {
        sourceRef: currentSource,
        modules: ['actor'],
        now: 53,
    });
    assert.equal(currentBusiness.observed, true);
    assert.equal(currentBusiness.runtime.simulatedThrough.turn, 0);
    const currentActorTask = currentBusiness.runtime.backlog.find((task) => (
        task.sourceKey === sovereigntySourceKey(currentSource) && task.module === 'actor'
    ));
    const currentCommitted = commitSovereigntyTask(currentBusiness.runtime, {
        taskId: currentActorTask.id,
        payload: { actorLedger: { turn: 1 } },
        commitRef: 'CURRENT-SOURCE-COMMIT',
        now: 54,
    });
    assert.equal(currentCommitted.changed, true);
    assert.equal(currentCommitted.runtime.simulatedThrough.turn, 1);
    assert.equal(sovereigntyHealthView(currentCommitted.runtime).backlog, 0);
    assert.equal(sovereigntyHealthView(currentCommitted.runtime).cancelledIncomplete, 0);

    const proofBody = {
        version: 1,
        kind: 'current_chat_observation_convergence',
        scopeDigest: digest,
        entries: [{ sourceKey: observationTask.sourceKey, target }],
        latestSourceKey: observationTask.sourceKey,
    };
    const converged = completeSovereigntyObservationGaps(gap, {
        scopeDigest: digest,
        proof: {
            ...proofBody,
            proofDigest: contentAddressedJsonRef(proofBody),
        },
        now: 53,
    });
    gap = converged.runtime;
    assert.equal(converged.completed.length, 1, JSON.stringify(converged.completed));
    assert.equal(gap.backlog.filter((task) => task.module !== 'observation').length, 0);
    assert.equal(gap.simulatedThrough.turn, 1);
    assert.equal(
        gap.backlog.find((task) => task.module === 'observation')
            ?.metadata?.actorActionsAllowed,
        false,
    );
});

test('generation identity is part of strict source keys, replacement and restart readback', () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    const original = sourceRef(valueScope, {
        generationId: 'generation-original',
        generationType: 'normal',
    });
    const generationIdChanged = sourceRef(valueScope, {
        generationId: 'generation-rerolled',
        generationType: 'normal',
    });
    const generationTypeChanged = sourceRef(valueScope, {
        generationId: 'generation-original',
        generationType: 'regenerate',
    });
    assert.notEqual(sovereigntySourceKey(original), sovereigntySourceKey(generationIdChanged));
    assert.notEqual(sovereigntySourceKey(original), sovereigntySourceKey(generationTypeChanged));

    const replaceOnce = (replacement) => {
        let runtime = observeSovereigntyTurn(
            emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest }),
            { sourceRef: original, modules: ['actor'], now: 100 },
        ).runtime;
        const previousKey = sovereigntySourceKey(original);
        const currentKey = sovereigntySourceKey(replacement);
        const replaced = observeSovereigntyTurn(runtime, {
            sourceRef: replacement,
            modules: ['actor'],
            now: 101,
        });
        runtime = replaced.runtime;
        assert.equal(replaced.observed, true);
        assert.equal(replaced.turn, 1, 'same logical reply replacement must reuse its turn');
        assert.equal(
            runtime.observations.find((entry) => entry.sourceKey === previousKey)?.superseded,
            true,
        );
        assert.equal(
            runtime.backlog.find((task) => (
                task.sourceKey === previousKey && task.module === 'actor'
            ))?.metadata?.supersededBySourceKey,
            currentKey,
        );
        const claimed = claimNextSovereigntyTask(runtime, {
            module: 'actor',
            currentTurn: 1,
            now: 102,
        });
        runtime = commitSovereigntyTask(claimed.runtime, {
            taskId: claimed.task.id,
            claimToken: claimed.task.claimToken,
            payload: { actorLedger: { turn: 1 } },
            commitRef: `COMMIT-${currentKey}`,
            now: 103,
        }).runtime;
        const restarted = normalizeSovereigntyRuntime(
            JSON.parse(JSON.stringify(runtime)),
            { chatId: valueScope.chatId, scopeDigest: digest },
        );
        const expectedByKey = new Map([
            [previousKey, original],
            [currentKey, replacement],
        ]);
        for (const entry of [
            ...restarted.observations,
            ...restarted.backlog,
            ...restarted.checkpoints,
            restarted.observedThrough,
            restarted.simulatedThrough,
        ]) {
            const ref = entry.sourceRef;
            assert.ok(ref);
            const expected = expectedByKey.get(entry.sourceKey);
            assert.ok(expected);
            assert.deepEqual(
                Object.fromEntries([
                    'chatId',
                    'logicalIndex',
                    'messageId',
                    'swipeId',
                    'generation',
                    'generationId',
                    'generationType',
                    'contentHash',
                ].map((field) => [field, ref[field]])),
                Object.fromEntries([
                    'chatId',
                    'logicalIndex',
                    'messageId',
                    'swipeId',
                    'generation',
                    'generationId',
                    'generationType',
                    'contentHash',
                ].map((field) => [field, expected[field]])),
            );
            assert.ok(ref.generationId);
            assert.ok(ref.generationType);
            assert.equal(ref.scopeDigest, digest);
        }
        assert.equal(restarted.observedThrough.sourceKey, currentKey);
        assert.equal(restarted.observedThrough.sourceRef.generationId, replacement.generationId);
        assert.equal(restarted.observedThrough.sourceRef.generationType, replacement.generationType);
    };
    replaceOnce(generationIdChanged);
    replaceOnce(generationTypeChanged);

    for (const missingField of ['generationId', 'generationType']) {
        const invalid = { ...original };
        delete invalid[missingField];
        const rejected = observeSovereigntyTurn(
            emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest }),
            { sourceRef: invalid, modules: ['actor'], now: 102 },
        );
        assert.equal(rejected.observed, false);
        assert.equal(rejected.reason, 'source_ref_invalid');
    }
});

test('verified source replacements are terminal history and obey normal capacity bounds', () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    const runtime = emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest });
    for (let index = 0; index < 680; index += 1) {
        const oldSource = sourceRef(valueScope, {
            logicalIndex: index + 1,
            messageId: `old-message-${index}`,
            generation: 1,
            contentHash: `old-hash-${index}`,
        });
        const oldSourceKey = sovereigntySourceKey(oldSource);
        runtime.observations.push({
            turn: index + 1,
            sourceKey: oldSourceKey,
            sourceRef: oldSource,
            observedAt: index + 1,
            superseded: true,
        });
        runtime.backlog.push({
            id: `old-task-${index}`,
            sourceKey: oldSourceKey,
            sourceRef: oldSource,
            turn: index + 1,
            module: 'actor',
            status: 'cancelled_stale',
            updatedAt: index + 1,
            metadata: {
                cancelReason: 'source_replaced',
                supersededBySourceKey: `current-source-${index}`,
            },
        });
    }
    const normalized = normalizeSovereigntyRuntime(runtime, { scopeDigest: digest });
    assert.equal(normalized.backlog.length, 600);
    assert.equal(normalized.observations.length, 600);
    assert.equal(sovereigntyHealthView(normalized).backlog, 0);
    assert.equal(sovereigntyHealthView(normalized).cancelledIncomplete, 0);
});

test('unconverged observation gaps survive the normal backlog and observation history caps', () => {
    const valueScope = scope();
    const digest = actorSovereigntyScopeDigest(valueScope);
    const first = sourceRef(valueScope, {
        logicalIndex: 1,
        messageId: 'message-gap',
        generation: 1,
        contentHash: 'hash-gap',
    });
    let runtime = observeSovereigntyTurn(
        emptySovereigntyRuntime(valueScope.chatId, { scopeDigest: digest }),
        {
            sourceRef: first,
            modules: [],
            observationOnlyFinal: false,
            now: 1,
        },
    ).runtime;
    const gapTask = runtime.backlog.find((task) => task.module === 'observation');
    gapTask.metadata.observationGapRecovery = true;
    gapTask.metadata.simulationRequired = true;
    for (let index = 2; index <= 650; index += 1) {
        runtime = observeSovereigntyTurn(runtime, {
            sourceRef: sourceRef(valueScope, {
                logicalIndex: index,
                messageId: `message-${index}`,
                generation: index,
                contentHash: `hash-${index}`,
            }),
            modules: [],
            observationOnlyFinal: true,
            now: index,
        }).runtime;
    }
    assert.ok(runtime.backlog.some((task) => task.id === gapTask.id));
    assert.ok(runtime.observations.some((entry) => entry.sourceKey === gapTask.sourceKey));
    assert.equal(
        runtime.backlog.find((task) => task.id === gapTask.id)?.metadata?.simulationRequired,
        true,
    );
});
