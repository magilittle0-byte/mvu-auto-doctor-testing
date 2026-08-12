import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { contentAddressedJsonRef } from '../checkpoint-codec-core.mjs';

import {
    actorRefFrom,
    isActorId,
} from '../actor-ref-core.mjs';
import {
    actorCandidatesForRegistryPromotion,
    actorRegistryDigest,
    actorRegistryMatchesLedger,
    discoverActorsFromTurnSources,
    emptyActorLedger,
    migrateActorLedgerFromContinuity,
    normalizeActorLedger,
    promoteActorCandidatesToRegistry,
    reconcileActorIdentityRevealsFromAcceptedContent,
    runActorRegistryUpsert,
} from '../actor-ledger-core.mjs';
import {
    parseActorShardProposal,
    selectActorShardCandidates,
} from '../actor-shard-core.mjs';
import {
    actorProfileReadyForAction,
    prepareActorProfileV6,
} from '../actor-profile-v6-core.mjs';
import {
    adjudicateActorActionAttempt,
    createActorActionAttempt,
} from '../actor-authority-core.mjs';
import {
    SOVEREIGNTY_TECHNICAL_RECEIPT_HOT_BYTE_BUDGET,
    cancelSovereigntyTaskAsStale,
    claimNextSovereigntyTask,
    commitSovereigntyTask,
    emptySovereigntyRuntime,
    failSovereigntyTask,
    materializeSovereigntyActorTasks,
    normalizeSovereigntyRuntime,
    observeSovereigntyTurn,
    restoreSovereigntyCheckpoint,
    sovereigntyHealthView,
    sovereigntyTechnicalReceipts,
} from '../sovereignty-runtime-core.mjs';
import {
    selectContinuityInjectionCandidates,
    settleContinuityNarrativeReceipts,
} from '../continuity-core.mjs';
import { makeActionReadyLedger } from './helpers/actor-action-ready-fixture.mjs';

test('all namespace field writers share one migration guard and raw commits stay private', () => {
    const sourceText = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const rawQueueReferences = [...sourceText.matchAll(/\benqueueChatNamespaceWrite\s*\(/gu)];
    assert.equal(
        rawQueueReferences.length,
        3,
        'raw queue must appear only at its definition, guarded writer, and migration closure',
    );
    assert.match(sourceText, /async function writeChatNamespace[\s\S]*ensureActorSovereigntyMigrationPersisted[\s\S]*prepareActorSovereigntyFieldWriteCandidate/u);
    assert.match(sourceText, /const migrationWriteToken = Symbol\('actor-sovereignty-migration-write'\)/u);
    assert.doesNotMatch(sourceText, /export\s+[^;\n]*migrationWriteToken/u);
    const directMetadataWrites = [...sourceText.matchAll(/(?:updateChatMetadata\(\{ \[PLUGIN_ID\]|chatMetadata\[PLUGIN_ID\]\s*=)/gu)];
    assert.equal(
        directMetadataWrites.length,
        4,
        'only performChatNamespaceWrite apply/rollback may touch plugin chat metadata directly',
    );
});

test('旧路径与迁移收敛 leaves one production continuity migration owner and one P1 profile writer', () => {
    const indexText = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const compatibilityText = readFileSync(
        new URL('../compatibility-migration-core.mjs', import.meta.url),
        'utf8',
    );
    const actorLedgerText = readFileSync(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8');
    const batchText = readFileSync(new URL('../actor-profile-batch-core.mjs', import.meta.url), 'utf8');
    const migrationAdapterText = actorLedgerText.slice(
        actorLedgerText.indexOf('export function migrateActorLedgerFromContinuity'),
        actorLedgerText.indexOf('export function discoverActorsFromTurnSources'),
    );
    assert.equal(
        [...indexText.matchAll(/\bmigrateActorLedgerFromContinuity\s*\(/gu)].length,
        0,
        'normal production turns cannot run the legacy continuity adapter',
    );
    assert.equal(
        [...compatibilityText.matchAll(/\bmigrateActorLedgerFromContinuity\s*\(/gu)].length,
        1,
        'compatibility migration is the sole production caller',
    );
    assert.doesNotMatch(
        migrationAdapterText,
        /Date\.now\s*\(/u,
        'the compatibility adapter cannot derive migrated identity state from wall-clock time',
    );
    assert.equal(
        [...indexText.matchAll(/\bmergeActorProfilePatches\s*\(/gu)].length,
        0,
        'P1 and continuity cannot call the retired partial profile writer',
    );
    assert.doesNotMatch(indexText, /legacyClassifyDoctorPressureCandidate/u);
    assert.match(batchText, /buildActorProfileCompletionMessages/u);
    assert.match(batchText, /parseActorProfileCompletionBatchOutput/u);
    assert.match(batchText, /materializeActorProfileBaseline/u);
    assert.match(batchText, /replaceActorProfileBaselineInLedger/u);
    assert.match(batchText, /persistPendingBatch/u);
    assert.match(batchText, /persistFinalizedBatch/u);
    assert.match(batchText, /actorProfileCommitMatchesLedger/u);
    assert.match(indexText, /async function completeActorProfilesForTurn/u);
    assert.match(indexText, /completeActorProfileBatchTransaction/u);
    assert.match(indexText, /persistPendingBatch:\s*async/u);
    assert.match(indexText, /persistFinalizedBatch:\s*async/u);
    assert.match(indexText, /actorProfileCommitMatchesLedger/u);
    assert.match(indexText, /scheduleActorTurns\(actionLedger,\s*\{[\s\S]*?requireProfileReady:\s*true/u);
    assert.match(
        indexText,
        /source = emptyChatNamespace\(context\);[\s\S]*?const archive = archivedActorSovereigntyScope\(stored, report\);[\s\S]*?source\.compatibilityScopeArchives = archives;[\s\S]*?ensureActorSovereigntyMigration\(source/u,
        'scope mismatch must archive the old namespace before creating the empty active scope',
    );
});

function source(index) {
    return {
        chatId: 'rc14-root-invariants',
        logicalIndex: index,
        messageId: `message-${index}`,
        swipeId: 0,
        generation: index,
        generationId: `generation-${index}`,
        generationType: 'normal',
        contentHash: `hash-${index}`,
        scopeDigest: 'rc14-root-invariants-scope',
    };
}

function identitySourceRef(chatId, generation = 5, cardId = 'card-main') {
    return {
        chatId,
        messageId: `identity-message-${generation}`,
        index: generation,
        logicalIndex: generation,
        swipeId: 0,
        generation,
        generationSerial: generation,
        generationId: `identity-generation-${generation}`,
        generationType: 'normal',
        identityScopeId: `${chatId}|character:${cardId}`,
        scopeDigest: `scope:${chatId}|character:${cardId}`,
        hash: `identity-hash-${chatId}-${generation}`,
        contentHash: `identity-hash-${chatId}-${generation}`,
        contentFingerprint: `identity-fingerprint-${chatId}-${generation}`,
    };
}

function quarantinedIdentityFixture(chatId = 'identity-quarantine') {
    const orphanId = 'NPC-orphan:11111111';
    const orphanName = 'NPC-missing:22222222';
    const actor = {
        id: orphanId,
        name: orphanName,
        tier: 'secondary',
        status: 'active',
        identity: {
            role: '旧档案中的夜班记录员',
            profileSummary: '会核对公开记录，并保留每一次行动的证据。',
            aliases: ['旧记录员'],
        },
        lineage: {
            rootActorId: orphanId,
            currentForm: orphanName,
            forms: [{ name: '旧记录员', turn: 2, evidence: ['E-OLD-FORM'] }],
        },
        knowledge: [{ id: 'KN-1', claim: 'kept fact', kind: 'observed' }],
        resources: [{ id: 'RES-1', name: 'kept key', amount: 1 }],
        relationships: [{ actorId: 'NPC-CONTACT:33333333', summary: 'kept relation' }],
        commitments: [{
            id: 'COM-1',
            summary: 'kept promise',
            targetActorId: 'NPC-CONTACT:33333333',
        }],
        stimuli: [{ id: 'STIM-1', kind: 'observation', summary: 'kept stimulus' }],
        stateFacts: [{ id: 'STATE-1', kind: 'condition', summary: 'kept state' }],
        actionHistory: [{ id: 'ACT-1', attempt: 'kept attempt' }],
        currentGoals: ['keep the archive consistent'],
        plan: { summary: 'keep the old recovery plan', steps: ['read the public ledger'] },
        hidden: { privateIntentions: ['keep the old private intention'] },
        evidence: ['E-ORPHAN'],
    };
    actor.profileV6 = prepareActorProfileV6(actor, { mode: 'full', turn: 3, now: 1 });
    const migrated = migrateActorLedgerFromContinuity({
        ...emptyActorLedger(chatId),
        actors: [actor],
        actionReceipts: [{
            receiptId: 'RECEIPT-ORPHAN',
            actorId: orphanId,
            stage: 'world_settled',
            status: 'settled',
            resultSummary: 'kept receipt',
        }],
    }, {
        chatId,
        turn: 4,
        threads: [],
    });
    return { orphanId, orphanName, migrated };
}

function runIdentityRegistryChain(ledger, acceptedContent, ref, expectedSourceRef = ref) {
    const discovery = discoverActorsFromTurnSources(ledger, {
        acceptedContent,
        sourceRef: ref,
        turn: ref.generation,
    });
    const upsert = runActorRegistryUpsert(discovery.ledger, discovery.candidates, {
        chatId: ledger.chatId,
        identityScopeId: expectedSourceRef.identityScopeId,
        scopeDigest: expectedSourceRef.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef,
        turn: ref.generation,
    });
    const promotionInput = actorCandidatesForRegistryPromotion(discovery.candidates, upsert);
    const registration = promoteActorCandidatesToRegistry(
        upsert.ledger,
        promotionInput,
        {
            chatId: ledger.chatId,
            identityScopeId: expectedSourceRef.identityScopeId,
            scopeDigest: expectedSourceRef.scopeDigest,
            allowScopeDigestFill: true,
            expectedSourceRef,
            turn: ref.generation,
        },
    );
    registration.ledger = reconcileActorIdentityRevealsFromAcceptedContent(
        registration.ledger,
        { content: acceptedContent, sourceRef: ref },
    );
    return { discovery, upsert, promotionInput, registration };
}

test('typed ActorRef preserves internal ids and never hashes an id as a name', () => {
    const actorId = 'NPC-7:b001c194';
    assert.equal(isActorId(actorId), true);
    assert.deepEqual(actorRefFrom(actorId), {
        kind: 'actor_ref',
        actorId,
        displayName: '',
        aliases: [],
    });

    const existing = {
        ...emptyActorLedger('typed-ref'),
        actors: [{
            id: actorId,
            name: 'Hank',
            status: 'active',
            tier: 'secondary',
            identity: { aliases: ['Henry'] },
            lineage: { rootActorId: actorId, currentForm: 'Hank', forms: [] },
            location: { name: 'station' },
            currentGoals: ['check the north platform'],
            plan: { summary: 'check the north platform', steps: ['walk there'] },
            evidence: ['E-HANK'],
        }],
    };
    const continuity = {
        chatId: 'typed-ref',
        turn: 8,
        threads: [{
            id: 'PT-HANK',
            actors: [actorId],
            actorRefs: [{ kind: 'actor_ref', actorId, displayName: 'Hank', aliases: [] }],
            stage: 'advancing',
            knowledge: 'hidden',
            locations: ['station'],
            sourceRefs: [],
        }],
    };
    const migrated = migrateActorLedgerFromContinuity(existing, continuity);
    assert.equal(migrated.actors.filter((actor) => actor.id === actorId).length, 1);
    assert.equal(migrated.actors.some((actor) => actor.name === actorId), false);
    const ref = identitySourceRef(migrated.chatId, 8);
    const candidates = selectActorShardCandidates({
        continuity,
        actorLedger: makeActionReadyLedger(normalizeActorLedger({
            ...migrated,
        }, {
            chatId: migrated.chatId,
            identityScopeId: ref.identityScopeId,
            scopeDigest: ref.scopeDigest,
            allowScopeDigestFill: true,
        }), { sourceRef: ref, turn: 8 }),
        maxWorkers: 1,
    });
    assert.equal(candidates[0].id, actorId);
    assert.equal(candidates[0].name, 'Hank');
});

test('multi-generation polluted actor ids merge directly into the canonical actor without data loss', () => {
    const rootId = 'NPC-root:11111111';
    const middleId = 'NPC-middle:22222222';
    const leafId = 'NPC-leaf:33333333';
    const ledger = {
        ...emptyActorLedger('polluted-chain'),
        actors: [{
            id: rootId,
            name: 'Hank',
            identity: {},
            lineage: { rootActorId: rootId, currentForm: 'Hank', forms: [] },
            relationships: [{ actorId: middleId, summary: 'owes a documented favor' }],
            commitments: [{
                id: 'COM-root',
                summary: 'return the borrowed field notes',
                targetActorId: leafId,
            }],
            evidence: ['E-root'],
        }, {
            id: middleId,
            name: rootId,
            identity: {
                desires: ['keep the night shift predictable'],
                informationStyle: 'checks public records before acting',
            },
            lineage: { rootActorId: middleId, currentForm: rootId, forms: [] },
            resources: [{ id: 'RES-middle', name: 'station key', amount: 1 }],
            hidden: { privateIntentions: ['quietly verify the missing entry'] },
            plan: {
                summary: 'verify the missing entry',
                steps: ['check the public ledger'],
                status: 'active',
            },
            evidence: ['E-middle'],
        }, {
            id: leafId,
            name: middleId,
            identity: {},
            lineage: { rootActorId: leafId, currentForm: middleId, forms: [] },
            knowledge: [{ id: 'K-leaf', claim: 'the north gate opens at dawn' }],
            actionHistory: [{
                id: 'ACT-leaf',
                attempt: 'check the north gate lock',
                result: 'fresh oil was observed',
            }],
            evidence: ['E-leaf'],
        }],
        actionReceipts: [{
            receiptId: 'RECEIPT-leaf',
            actorId: leafId,
            stage: 'world_settled',
            status: 'settled',
        }],
    };
    const migrated = migrateActorLedgerFromContinuity(ledger, {
        chatId: 'polluted-chain',
        turn: 2,
        threads: [{
            id: 'PT-POLLUTED-LEAF',
            actorRefs: [{
                kind: 'actor_ref',
                actorId: leafId,
                displayName: '',
                aliases: [],
            }],
            stage: 'advancing',
            knowledge: 'observed',
            summary: 'the public gate notice changed',
            nextBeat: 'read the changed gate notice',
            locations: ['station'],
            sourceRefs: [],
        }],
    });
    assert.equal(migrated.actors.length, 1);
    const [actor] = migrated.actors;
    assert.equal(actor.id, rootId);
    assert.equal(actor.name, 'Hank');
    assert.deepEqual(
        new Set(actor.lineage.mergedActorIds),
        new Set([middleId, leafId]),
    );
    assert.equal(actor.resources.some((item) => item.id === 'RES-middle'), true);
    assert.equal(actor.identity.desires.includes('keep the night shift predictable'), true);
    assert.equal(actor.identity.informationStyle, 'checks public records before acting');
    assert.equal(actor.hidden.privateIntentions.includes('quietly verify the missing entry'), true);
    assert.equal(actor.plan.steps.includes('check the public ledger'), true);
    assert.equal(actor.knowledge.some((item) => item.id === 'K-leaf'), true);
    assert.equal(actor.actionHistory.some((item) => item.id === 'ACT-leaf'), true);
    assert.equal(actor.stimuli.some((item) => (
        item.sourceThreadId === 'PT-POLLUTED-LEAF'
    )), true, 'typed references to a polluted descendant must resolve to the canonical actor');
    assert.equal(actor.relationships[0].actorId, rootId);
    assert.equal(actor.commitments[0].targetActorId, rootId);
    assert.equal(migrated.actionReceipts[0].actorId, rootId);
});

test('unresolvable internal-id names are quarantined without inventing identity and can be restored', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture();
    assert.equal(migrated.actors.length, 0);
    assert.equal(migrated.identityQuarantine.length, 1);
    assert.equal(migrated.identityQuarantine[0].actor.id, orphanId);
    assert.equal(migrated.identityQuarantine[0].actor.knowledge[0].claim, 'kept fact');
    assert.equal(migrated.identityQuarantine[0].actor.actionHistory[0].attempt, 'kept attempt');
    const quarantinedActor = structuredClone(migrated.identityQuarantine[0].actor);
    const ref = identitySourceRef(migrated.chatId);
    const chain = runIdentityRegistryChain(
        migrated,
        `<content><actor id="${orphanId}" name="Recovered Name"></actor></content>`,
        ref,
    );
    assert.equal(chain.discovery.candidates[0].explicitActorId, orphanId);
    assert.equal(chain.upsert.ledger.identityQuarantine.length, 1);
    assert.equal(chain.upsert.ledger.actors.length, 0);
    assert.equal(
        chain.upsert.ledger.actorRegistry.characters['Recovered Name'].actorRef.actorId,
        orphanId,
    );
    assert.equal(chain.promotionInput.length, 1);
    const restored = chain.registration.ledger;
    assert.equal(restored.identityQuarantine.length, 0);
    assert.equal(restored.actors.length, 1);
    assert.equal(restored.actors[0].name, 'Recovered Name');
    assert.equal(restored.actors[0].id, orphanId);
    assert.equal(chain.registration.promoted[0].created, false);
    assert.equal(restored.actorRegistry.characters['Recovered Name'], undefined);
    assert.equal(restored.actorRegistry.registered['Recovered Name'].actorRef.actorId, orphanId);
    assert.deepEqual(restored.actors[0].knowledge, quarantinedActor.knowledge);
    assert.deepEqual(restored.actors[0].resources, quarantinedActor.resources);
    assert.deepEqual(restored.actors[0].relationships, quarantinedActor.relationships);
    assert.deepEqual(restored.actors[0].commitments, quarantinedActor.commitments);
    assert.deepEqual(restored.actors[0].stimuli, quarantinedActor.stimuli);
    assert.deepEqual(restored.actors[0].stateFacts, quarantinedActor.stateFacts);
    assert.equal(restored.actors[0].actionHistory[0].attempt, 'kept attempt');
    assert.deepEqual(restored.actors[0].profileV6.modules, quarantinedActor.profileV6.modules);
    assert.equal(restored.actors[0].lineage.rootActorId, orphanId);
    assert.deepEqual(restored.actors[0].lineage.forms, quarantinedActor.lineage.forms);
    assert.equal(restored.actors[0].lineage.currentForm, 'Recovered Name');
    assert.ok(restored.actors[0].evidence.includes('E-ORPHAN'));
    assert.equal(restored.actionReceipts[0].receiptId, 'RECEIPT-ORPHAN');
    assert.equal(restored.actionReceipts[0].actorId, orphanId);
});

test('quarantine recovery refuses a registered name conflict without touching either identity', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-conflict');
    const occupied = runIdentityRegistryChain(
        migrated,
        '<content><actor name="Occupied Name"></actor></content>',
        identitySourceRef(migrated.chatId, 5),
    ).registration.ledger;
    const ownerId = occupied.actorRegistry.registered['Occupied Name'].actorRef.actorId;
    const attempted = runIdentityRegistryChain(
        occupied,
        `<content><actor id="${orphanId}" name="Occupied Name"></actor></content>`,
        identitySourceRef(migrated.chatId, 6),
    );
    assert.equal(attempted.upsert.quarantined[0].reason, 'actor_candidate.alias_conflict');
    assert.equal(attempted.registration.ledger.identityQuarantine.length, 1);
    assert.equal(attempted.registration.ledger.identityQuarantine[0].actor.id, orphanId);
    assert.equal(attempted.registration.ledger.actors.length, 1);
    assert.equal(attempted.registration.ledger.actors[0].id, ownerId);
    assert.equal(attempted.registration.ledger.actors[0].name, 'Occupied Name');
});

test('stale quarantine recovery source leaves candidate, registry, and payload unchanged', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-stale');
    const ref = identitySourceRef(migrated.chatId, 5);
    const expected = { ...ref, generationId: 'identity-generation-current' };
    const attempted = runIdentityRegistryChain(
        migrated,
        `<content><actor id="${orphanId}" name="Recovered Name"></actor></content>`,
        ref,
        expected,
    );
    assert.equal(attempted.upsert.quarantined[0].reason, 'actor_candidate.source_ref_mismatch');
    assert.equal(attempted.promotionInput.length, 0);
    assert.equal(attempted.registration.ledger.identityQuarantine.length, 1);
    assert.equal(attempted.registration.ledger.actors.length, 0);
    assert.equal(Object.keys(attempted.registration.ledger.actorRegistry.characters).length, 0);
    assert.equal(Object.keys(attempted.registration.ledger.actorRegistry.registered).length, 0);
});

test('multiple quarantine payloads for one ActorId cannot be chosen by position', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-multiple-payloads');
    migrated.identityQuarantine.push({
        ...structuredClone(migrated.identityQuarantine[0]),
        id: 'NPC-orphan-duplicate-quarantine:44444444',
    });
    const attempted = runIdentityRegistryChain(
        migrated,
        `<content><actor id="${orphanId}" name="Recovered Name"></actor></content>`,
        identitySourceRef(migrated.chatId, 5),
    );
    assert.equal(attempted.upsert.quarantined[0].reason, 'actor_candidate.identity_quarantined');
    assert.equal(attempted.promotionInput.length, 0);
    assert.equal(attempted.registration.ledger.identityQuarantine.length, 2);
    assert.equal(attempted.registration.ledger.actors.length, 0);
});

test('wrong explicit ActorId cannot recover a quarantined actor', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-wrong-id');
    const attempted = runIdentityRegistryChain(
        migrated,
        '<content><actor id="NPC-wrong:99999999" name="Recovered Name"></actor></content>',
        identitySourceRef(migrated.chatId, 5),
    );
    assert.equal(attempted.registration.ledger.identityQuarantine.length, 1);
    assert.equal(attempted.registration.ledger.identityQuarantine[0].actor.id, orphanId);
    assert.equal(attempted.registration.ledger.actors.some((actor) => actor.id === orphanId), false);
});

test('a name without explicit ActorId cannot recover a quarantined actor', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-no-id');
    const attempted = runIdentityRegistryChain(
        migrated,
        '<content><actor name="Recovered Name"></actor></content>',
        identitySourceRef(migrated.chatId, 5),
    );
    assert.equal(attempted.registration.ledger.identityQuarantine.length, 1);
    assert.equal(attempted.registration.ledger.identityQuarantine[0].actor.id, orphanId);
    assert.equal(attempted.registration.ledger.actors.some((actor) => actor.id === orphanId), false);
});

test('repeating one explicit accepted recovery event is idempotent', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-repeat');
    const ref = identitySourceRef(migrated.chatId, 5);
    const content = `<content><actor id="${orphanId}" name="Recovered Name"></actor></content>`;
    const first = runIdentityRegistryChain(migrated, content, ref).registration.ledger;
    const snapshot = structuredClone(first.actors[0]);
    const repeated = runIdentityRegistryChain(first, content, ref);
    assert.equal(repeated.upsert.updated[0].table, 'registered');
    assert.equal(repeated.promotionInput.length, 0);
    assert.equal(repeated.registration.promoted.length, 0);
    assert.equal(repeated.registration.ledger.identityQuarantine.length, 0);
    assert.equal(repeated.registration.ledger.actors.length, 1);
    assert.equal(repeated.registration.ledger.actors[0].id, orphanId);
    assert.deepEqual(repeated.registration.ledger.actors[0].knowledge, snapshot.knowledge);
    assert.deepEqual(repeated.registration.ledger.actors[0].actionHistory, snapshot.actionHistory);
});

test('runActorProfileTarget keeps mixed new and quarantine-restored actors in the P1 working ledger until the profile group commits', () => {
    const { orphanId, migrated } = quarantinedIdentityFixture('identity-mixed-persist');
    const ref = identitySourceRef(migrated.chatId, 5);
    const chain = runIdentityRegistryChain(
        migrated,
        [
            '<content>',
            `<actor id="${orphanId}" name="Recovered Name"></actor>`,
            '<actor name="Same Turn Newcomer"></actor>',
            '</content>',
        ].join(''),
        ref,
    );
    assert.equal(chain.upsert.inserted.length, 2);
    assert.equal(chain.promotionInput.length, 2);
    assert.equal(chain.registration.promoted.length, 2);
    assert.deepEqual(
        new Set(chain.registration.promoted.map((entry) => entry.created)),
        new Set([false, true]),
    );

    const runtimeSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const profileStart = runtimeSource.indexOf('async function runActorProfileTarget');
    const continuityStart = runtimeSource.indexOf('async function runContinuityTarget');
    assert.ok(profileStart >= 0 && continuityStart > profileStart);
    const runtime = runtimeSource.slice(profileStart, continuityStart);
    const discoveryAt = runtime.indexOf('discoverActorsFromTurnSources');
    const upsertAt = runtime.indexOf('runActorRegistryUpsert');
    const promotionAt = runtime.indexOf('promoteActorCandidatesToRegistry');
    const registrationLedgerAt = runtime.indexOf('let nextLedger = actorRegistration.ledger');
    const ticketBindingAt = runtime.indexOf('bindCharacterCreationTicketsToRegisteredActors');
    const persistedLedgerAt = runtime.indexOf('const s1Ledger = nextLedger');
    const profileAt = runtime.indexOf('completeActorProfilesForTurn');
    assert.ok(discoveryAt >= 0 && upsertAt > discoveryAt && promotionAt > upsertAt);
    assert.ok(registrationLedgerAt > promotionAt && ticketBindingAt > registrationLedgerAt);
    assert.ok(persistedLedgerAt > ticketBindingAt && profileAt > persistedLedgerAt);
    assert.doesNotMatch(runtime, /persistActorRegistryForTurn/u);
    assert.match(runtime.slice(ticketBindingAt, profileAt), /failed sibling must leave[\s\S]*?pre-generation batch intact/u);

    const continuityRuntime = runtimeSource.slice(
        continuityStart,
        runtimeSource.indexOf('async function confirmDangerousAction', continuityStart),
    );
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'completeActorProfilesForTurn',
    ]) assert.doesNotMatch(continuityRuntime, new RegExp(p1Step, 'u'));

    let actorLedgerWrites = 0;
    const expected = {
        chatId: migrated.chatId,
        actorIds: chain.registration.promoted.map((entry) => entry.actorRef.actorId),
        digest: actorRegistryDigest(chain.registration.ledger.actorRegistry),
    };
    actorLedgerWrites += 1;
    const persisted = normalizeActorLedger(
        structuredClone({ actorLedger: chain.registration.ledger }).actorLedger,
        { chatId: migrated.chatId },
    );
    assert.equal(actorLedgerWrites, 1);
    assert.equal(actorRegistryMatchesLedger(persisted, expected).ok, true);
    assert.equal(persisted.identityQuarantine.length, 0);
    assert.equal(persisted.actors.length, 2);
    assert.equal(persisted.actors.find((actor) => actor.id === orphanId).name, 'Recovered Name');
    assert.equal(
        persisted.actors.find((actor) => actor.id === orphanId).knowledge[0].claim,
        'kept fact',
    );
    assert.ok(persisted.actors.some((actor) => actor.name === 'Same Turn Newcomer'));
});

test('durable and live copies of one stimulus converge to one decision item', () => {
    const actorId = 'NPC-7:b001c194';
    const stimulus = {
        id: 'STIM-shared',
        kind: 'observation',
        summary: 'the public night-shift notice changed',
        sourceThreadId: 'PT-HANK',
        status: 'unreviewed',
    };
    const ledger = {
        ...emptyActorLedger('stimulus-dedup'),
        actors: [{
            id: actorId,
            name: 'Hank',
            status: 'active',
            tier: 'secondary',
            identity: {},
            lineage: { rootActorId: actorId, currentForm: 'Hank', forms: [] },
            location: { name: 'station' },
            knowledge: [{ id: 'K-HANK', claim: 'the schedule is public' }],
            currentGoals: ['verify the altered schedule'],
            plan: { summary: 'verify the altered schedule', steps: ['read the notice'] },
            stimuli: [],
            evidence: ['PT-HANK'],
        }],
    };
    const continuity = {
        chatId: 'stimulus-dedup',
        turn: 8,
        threads: [{
            id: 'PT-HANK',
            actorRefs: [{ kind: 'actor_ref', actorId, displayName: 'Hank', aliases: [] }],
            stage: 'advancing',
            relation: 'independent',
            knowledge: 'observed',
            summary: 'the schedule is public',
            nextBeat: stimulus.summary,
            trigger: '',
            seedBasis: 'public station notice',
            locations: ['station'],
            sourceRefs: [],
        }],
    };
    const migrated = migrateActorLedgerFromContinuity(ledger, continuity);
    const ref = identitySourceRef(migrated.chatId, 8);
    const [candidate] = selectActorShardCandidates({
        continuity,
        actorLedger: makeActionReadyLedger(normalizeActorLedger({
            ...migrated,
        }, {
            chatId: migrated.chatId,
            identityScopeId: ref.identityScopeId,
            scopeDigest: ref.scopeDigest,
            allowScopeDigestFill: true,
        }), { sourceRef: ref, turn: 8 }),
        maxWorkers: 1,
    });
    assert.equal(candidate.stimuli.length, 1);
    assert.equal(new Set(candidate.stimuli.map((item) => item.id)).size, 1);
    assert.equal(candidate.stimuli[0].summary, stimulus.summary);
});

test('explicit cancellation cannot advance simulatedThrough', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('cancel-cursor'), {
        sourceRef: source(1),
        modules: ['actor'],
        now: 100,
    }).runtime;
    const claimed = claimNextSovereigntyTask(runtime, { module: 'actor', now: 110 });
    runtime = cancelSovereigntyTaskAsStale(claimed.runtime, {
        taskId: claimed.task.id,
        reason: 'user_cancelled',
        now: 120,
    }).runtime;
    assert.equal(runtime.simulatedThrough.turn, 0);
    const health = sovereigntyHealthView(runtime);
    assert.equal(health.cancelledIncomplete, 1);
    assert.notEqual(health.color, 'green');
});

test('a committed latest-state retry semantically supersedes older user-cancelled work', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('cancel-recovery'), {
        sourceRef: source(1),
        modules: ['world'],
        now: 100,
    }).runtime;
    const first = claimNextSovereigntyTask(runtime, { module: 'world', now: 110 });
    runtime = cancelSovereigntyTaskAsStale(first.runtime, {
        taskId: first.task.id,
        reason: 'user_cancelled',
        now: 120,
    }).runtime;
    runtime = observeSovereigntyTurn(runtime, {
        sourceRef: source(2),
        modules: ['world'],
        now: 200,
    }).runtime;
    const second = claimNextSovereigntyTask(runtime, {
        module: 'world',
        currentTurn: 2,
        now: 210,
    });
    runtime = failSovereigntyTask(second.runtime, {
        taskId: second.task.id,
        failureCode: 'synthetic_retry',
        nextRetryTurn: 2,
        now: 220,
    }).runtime;
    const retry = claimNextSovereigntyTask(runtime, {
        module: 'world',
        currentTurn: 2,
        now: 230,
    });
    const committed = commitSovereigntyTask(retry.runtime, {
        taskId: retry.task.id,
        payload: { settled: true },
        now: 240,
    });
    const older = committed.runtime.backlog.find((task) => task.id === first.task.id);
    assert.equal(older.status, 'cancelled_stale');
    assert.equal(older.metadata.cancelReason, 'latest_state_superseded');
    assert.equal(older.metadata.supersededByTaskId, retry.task.id);
    assert.equal(committed.runtime.simulatedThrough.turn, 2);
    assert.equal(sovereigntyHealthView(committed.runtime).cancelledIncomplete, 0);
});

test('content-addressed checkpoints deduplicate payloads and stay inside byte budget', () => {
    let runtime = emptySovereigntyRuntime('checkpoint-budget');
    const payload = { repeated: 'x'.repeat(48_000), stable: true };
    for (let turn = 1; turn <= 30; turn += 1) {
        runtime = observeSovereigntyTurn(runtime, {
            sourceRef: source(turn),
            modules: ['actor'],
            now: 1_000 + turn,
        }).runtime;
        const claimed = claimNextSovereigntyTask(runtime, {
            module: 'actor',
            currentTurn: turn,
            now: 2_000 + turn,
        });
        runtime = commitSovereigntyTask(claimed.runtime, {
            taskId: claimed.task.id,
            payload,
            now: 3_000 + turn,
        }).runtime;
    }
    assert.equal(Object.keys(runtime.checkpointBlobs).length, 1);
    assert.ok(runtime.checkpointBytes <= runtime.checkpointByteBudget);
    assert.ok(JSON.stringify(runtime).length < 250_000);
});

test('rc13 inline checkpoint migration collapses the 45MB repetition into one bounded blob', () => {
    const payload = {
        actorLedger: { actors: [{ id: 'NPC-A', evidence: ['E-A'] }] },
        continuity: { threads: [], padding: 'x'.repeat(570_000) },
    };
    const sourceRef = {
        ...source(1),
        chatId: 'rc13-inline-checkpoints',
    };
    const legacy = {
        version: 2,
        chatId: 'rc13-inline-checkpoints',
        observedThrough: { turn: 1, sourceRef },
        simulatedThrough: { turn: 1, sourceRef },
        observations: [{ turn: 1, sourceRef, sourceKey: 'legacy', observedAt: 1 }],
        backlog: [],
        checkpoints: Array.from({ length: 80 }, (_, index) => ({
            id: `LEGACY-${index}`,
            taskId: `TASK-${index}`,
            module: 'actor',
            turn: 1,
            sourceKey: 'legacy',
            sourceRef,
            stateDigest: 'sha256:shared-legacy-payload',
            payload,
            createdAt: index + 1,
        })),
    };
    const startedAt = performance.now();
    const migrated = normalizeSovereigntyRuntime(legacy);
    const durationMs = performance.now() - startedAt;
    assert.equal(Object.keys(migrated.checkpointBlobs).length, 1);
    assert.equal(migrated.checkpoints.length, 80, 'all lightweight refs remain while the payload is shared');
    assert.ok(migrated.checkpointBytes <= migrated.checkpointByteBudget);
    assert.ok(JSON.stringify(migrated).length < 2_100_000);
    assert.ok(durationMs < 1_500, `migration took ${durationMs}ms`);
    const restored = restoreSovereigntyCheckpoint(migrated);
    assert.equal(restored.restored, false);
    assert.equal(
        migrated.checkpoints.every((checkpoint) => (
            checkpoint.compatibilityOnly === true && checkpoint.restorable === false
        )),
        true,
        'legacy checkpoints keep lightweight history but cannot impersonate strict nine-field recovery',
    );
    assert.equal(
        migrated.checkpoints.every((checkpoint) => (
            migrated.checkpointBlobs[checkpoint.payloadRef]
        )),
        true,
        'the historical payload remains content-addressed and readable without becoming restorable',
    );

    const crossChat = restoreSovereigntyCheckpoint({
        ...migrated,
        chatId: 'another-chat',
    });
    assert.equal(crossChat.restored, false, 'checkpoint history never restores across chats');
    assert.equal(crossChat.checkpoint, undefined);
});

test('legacy inline checkpoints recompute content digests instead of trusting a colliding claim', () => {
    const sourceRef = source(1);
    const migrated = normalizeSovereigntyRuntime({
        version: 2,
        chatId: 'checkpoint-collision',
        checkpoints: [{
            id: 'LEGACY-A',
            taskId: 'TASK-A',
            module: 'actor',
            turn: 1,
            sourceKey: 'legacy',
            sourceRef,
            stateDigest: 'sha256:untrusted-shared-claim',
            payload: { actor: 'A', evidence: ['E-A'] },
            createdAt: 1,
        }, {
            id: 'LEGACY-B',
            taskId: 'TASK-B',
            module: 'actor',
            turn: 1,
            sourceKey: 'legacy',
            sourceRef,
            stateDigest: 'sha256:untrusted-shared-claim',
            payload: { actor: 'B', evidence: ['E-B'] },
            createdAt: 2,
        }],
    });
    assert.equal(migrated.checkpoints.length, 2);
    assert.equal(Object.keys(migrated.checkpointBlobs).length, 2);
    assert.notEqual(
        migrated.checkpoints[0].payloadRef,
        migrated.checkpoints[1].payloadRef,
    );
    assert.deepEqual(
        migrated.checkpointBlobs[migrated.checkpoints[0].payloadRef].payload,
        { actor: 'A', evidence: ['E-A'] },
    );
    assert.deepEqual(
        migrated.checkpointBlobs[migrated.checkpoints[1].payloadRef].payload,
        { actor: 'B', evidence: ['E-B'] },
    );
});

test('new checkpoints share actor, continuity and pressure domains and restore exactly', () => {
    const actorLedger = {
        version: 6,
        actors: [{
            id: 'NPC-7:b001c194',
            name: 'Hank',
            aliases: ['Henry'],
            lineage: ['NPC-root'],
            knowledge: [{ claim: 'harbor schedule', evidence: ['E-1'] }],
            resources: [{ name: 'launch key', quantity: 1 }],
            actionHistory: [{ id: 'ACT-1', receiptId: 'R-1' }],
            privateArchiveFixture: 'actor-ledger-domain'.repeat(2_000),
        }],
        actionReceipts: [{ receiptId: 'R-1', stage: 'world_settled' }],
    };
    const continuity = { threads: [{ id: 'PT-1', evidence: ['E-1'] }] };
    const worldPressure = { total: 1, receipts: [{ id: 'WP-1' }] };
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('domain-sharing'), {
        sourceRef: source(1),
        modules: ['profile', 'actor', 'world'],
        now: 100,
    }).runtime;
    for (const module of ['profile', 'actor', 'world']) {
        const claimed = claimNextSovereigntyTask(runtime, { module, now: 110 });
        runtime = commitSovereigntyTask(claimed.runtime, {
            taskId: claimed.task.id,
            payload: {
                module,
                actorLedger,
                continuity,
                worldPressure,
            },
            now: 120,
        }).runtime;
    }
    const naiveBytes = 3 * Buffer.byteLength(JSON.stringify({
        actorLedger,
        continuity,
        worldPressure,
    }));
    assert.ok(runtime.checkpointBytes < naiveBytes * 0.6);
    assert.equal(runtime.checkpointBudgetOverflow, 0);
    const restored = restoreSovereigntyCheckpoint(runtime);
    assert.equal(restored.restored, true);
    assert.deepEqual(restored.payload.actorLedger, actorLedger);
    assert.deepEqual(restored.payload.continuity, continuity);
    assert.deepEqual(restored.payload.worldPressure, worldPressure);
});

test('a late observation cannot widen an in-flight materialization cut or duplicate a commit', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('fixed-cut'), {
        sourceRef: source(1),
        modules: ['actor'],
        now: 100,
    }).runtime;
    const claimed = claimNextSovereigntyTask(runtime, { module: 'actor', now: 110 });
    runtime = observeSovereigntyTurn(claimed.runtime, {
        sourceRef: source(2),
        modules: ['actor'],
        now: 120,
    }).runtime;
    const committed = commitSovereigntyTask(runtime, {
        taskId: claimed.task.id,
        payload: { actorLedger: { actors: [{ id: 'NPC-fixed-cut' }] } },
        now: 130,
    });
    assert.equal(committed.changed, true);
    assert.equal(committed.checkpoint.turn, 1);
    assert.equal(committed.checkpoint.sourceKey, claimed.task.sourceKey);
    assert.equal(committed.runtime.observations.at(-1).turn, 2);
    const repeated = commitSovereigntyTask(committed.runtime, {
        taskId: claimed.task.id,
        payload: { actorLedger: { actors: [{ id: 'NPC-fixed-cut' }] } },
        now: 999,
    });
    assert.equal(repeated.changed, false);
    assert.equal(repeated.runtime.checkpoints.length, committed.runtime.checkpoints.length);
    assert.equal(repeated.checkpoint.id, committed.checkpoint.id);
});

test('a stale claimant cannot settle a task after a newer fencing token owns it', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('claim-fence'), {
        sourceRef: source(1),
        modules: ['world'],
        now: 100,
    }).runtime;
    const first = claimNextSovereigntyTask(runtime, { module: 'world', now: 110 });
    runtime = first.runtime;
    const stored = runtime.backlog.find((task) => task.id === first.task.id);
    stored.status = 'pending';
    stored.claimedAt = 0;
    const second = claimNextSovereigntyTask(runtime, { module: 'world', now: 120 });
    assert.notEqual(first.task.claimToken, second.task.claimToken);
    const staleCommit = commitSovereigntyTask(second.runtime, {
        taskId: first.task.id,
        claimToken: first.task.claimToken,
        payload: { continuity: { turn: 1, fabricated: true } },
        now: 130,
    });
    assert.equal(staleCommit.changed, false);
    assert.equal(staleCommit.reason, 'claim_fence_mismatch');
    assert.equal(staleCommit.runtime.checkpoints.length, 0);
    const currentCommit = commitSovereigntyTask(second.runtime, {
        taskId: second.task.id,
        claimToken: second.task.claimToken,
        payload: { continuity: { turn: 1, fabricated: false } },
        now: 140,
    });
    assert.equal(currentCommit.changed, true);
});

test('byte budget keeps the last recoverable checkpoint and reports an explicit oversize state', () => {
    let runtime = observeSovereigntyTurn({
        ...emptySovereigntyRuntime('oversize-budget'),
        checkpointByteBudget: 64_000,
    }, {
        sourceRef: source(1),
        modules: ['world'],
        now: 100,
    }).runtime;
    const claimed = claimNextSovereigntyTask(runtime, { module: 'world', now: 110 });
    const payload = {
        continuity: {
            receipts: Array.from({ length: 1_000 }, (_, index) => ({
                id: `RCPT-${index}`,
                evidence: `lossless-evidence-${index}-${'x'.repeat(80)}`,
            })),
        },
    };
    runtime = commitSovereigntyTask(claimed.runtime, {
        taskId: claimed.task.id,
        payload,
        now: 120,
    }).runtime;
    assert.equal(runtime.checkpoints.length, 1);
    assert.ok(runtime.checkpointBytes > runtime.checkpointByteBudget);
    assert.equal(
        runtime.checkpointBudgetOverflow,
        runtime.checkpointBytes - runtime.checkpointByteBudget,
    );
    assert.equal(sovereigntyHealthView(runtime).color, 'orange');
    assert.deepEqual(restoreSovereigntyCheckpoint(runtime).payload, payload);
});

test('a hash-mismatched domain blob is quarantined as explicit red health, never half-restored', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('corrupt-domain'), {
        sourceRef: source(1),
        modules: ['actor'],
        now: 100,
    }).runtime;
    const claimed = claimNextSovereigntyTask(runtime, { module: 'actor', now: 110 });
    runtime = commitSovereigntyTask(claimed.runtime, {
        taskId: claimed.task.id,
        payload: {
            actorLedger: {
                actors: [{ id: 'NPC-safe', aliases: ['Safe Alias'], evidence: ['E-safe'] }],
            },
        },
        now: 120,
    }).runtime;
    const manifest = runtime.checkpointBlobs[runtime.checkpoints[0].payloadRef].payload;
    runtime.checkpointBlobs[manifest.refs.actorLedger].payload.actors[0].aliases = ['Tampered'];
    const normalized = normalizeSovereigntyRuntime(runtime);
    const restored = restoreSovereigntyCheckpoint(normalized);
    assert.equal(restored.restored, false);
    assert.equal(restored.reason, 'checkpoint_domain_blob_missing');
    assert.equal(sovereigntyHealthView(normalized).color, 'red');
    assert.equal(sovereigntyHealthView(normalized).missingCheckpointBlobCount, 1);
});

test('a correctly hashed but unknown checkpoint codec fails closed', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('unknown-codec'), {
        sourceRef: source(1),
        modules: ['world'],
        now: 100,
    }).runtime;
    const claimed = claimNextSovereigntyTask(runtime, { module: 'world', now: 110 });
    runtime = commitSovereigntyTask(claimed.runtime, {
        taskId: claimed.task.id,
        payload: { continuity: { threads: [{ id: 'PT-safe' }] } },
        now: 120,
    }).runtime;
    const checkpoint = runtime.checkpoints[0];
    const manifestBlob = runtime.checkpointBlobs[checkpoint.payloadRef];
    const invalidManifest = { ...manifestBlob.payload, codec: 'unknown-codec-v99' };
    const invalidRef = contentAddressedJsonRef(invalidManifest);
    delete runtime.checkpointBlobs[checkpoint.payloadRef];
    runtime.checkpointBlobs[invalidRef] = {
        ...manifestBlob,
        digest: invalidRef,
        payload: invalidManifest,
    };
    checkpoint.payloadRef = invalidRef;
    checkpoint.stateDigest = invalidRef;
    const normalized = normalizeSovereigntyRuntime(runtime);
    const restored = restoreSovereigntyCheckpoint(normalized);
    assert.equal(restored.restored, false);
    assert.equal(restored.reason, 'checkpoint_manifest_invalid');
    assert.equal(sovereigntyHealthView(normalized).color, 'red');
});

test('technical receipts move to a reversible byte-bounded archive without loss', () => {
    const sourceRef = source(1);
    const receipts = Array.from({ length: 700 }, (_, index) => ({
        id: `TECH-${index}`,
        taskId: `TASK-${index}`,
        module: index % 2 ? 'actor' : 'world',
        turn: index + 1,
        code: `synthetic.failure.${index}`,
        retryable: true,
        retryCount: index % 5,
        nextRetryTurn: index + 2,
        at: 1_000 + index,
        recovered: index % 3 === 0,
    }));
    const migrated = normalizeSovereigntyRuntime({
        ...emptySovereigntyRuntime('receipt-archive'),
        observedThrough: { turn: 1, sourceRef },
        technicalReceipts: receipts,
    });
    const health = sovereigntyHealthView(migrated);
    assert.equal(health.technicalReceiptCount, receipts.length);
    assert.ok(health.technicalReceiptArchiveCount > 0);
    assert.ok(
        health.technicalReceiptHotBytes
        <= SOVEREIGNTY_TECHNICAL_RECEIPT_HOT_BYTE_BUDGET + 1_000,
    );
    const roundTripped = JSON.parse(JSON.stringify(migrated));
    assert.deepEqual(
        sovereigntyTechnicalReceipts(roundTripped).map((receipt) => receipt.id),
        receipts.map((receipt) => receipt.id),
    );
});

test('generic placeholder actions are rejected as no semantic progress', () => {
    const actorId = 'NPC-actor-1';
    const candidate = {
        id: actorId,
        name: 'Actor One',
        locations: ['QC Lab'],
        knowledgeBasis: ['manifest is present'],
        goals: ['inspect the manifest'],
        stimuli: [],
        sourceThreads: ['PT-1'],
        evidence: ['E-1'],
        causalChain: ['PT-1'],
        actorState: {
            location: { name: 'QC Lab' },
            resources: [],
            capabilities: [],
            plan: { summary: 'inspect the manifest' },
            stateFacts: [],
            lastAction: null,
            actionHistory: [],
        },
    };
    const placeholder = {
        actorId,
        actorName: 'Actor One',
        time: 'next window',
        location: 'QC Lab',
        travelTurns: 0,
        knowledgeBasis: ['manifest is present'],
        currentGoal: 'inspect the manifest',
        intent: 'execute',
        candidateAction: 'continue acting around the current goal (candidate)',
        actionWindow: 'next window',
        expectedCost: 'none',
        expectedDuration: 'none',
        expectedRisk: 'none',
        observableConsequence: 'continue the plan',
        stimulusDecisions: [],
        stateChanges: [{ kind: 'plan', summary: 'continue the current plan' }],
        interactionTargets: [],
        resourceCosts: [],
        capabilityUsed: '',
        waitCondition: '',
        sourceThreads: ['PT-1'],
        evidence: ['E-1'],
        causalChain: ['PT-1'],
    };
    assert.equal(
        parseActorShardProposal(JSON.stringify(placeholder), { candidate }).error,
        'actor_shard.no_semantic_progress',
    );
});

test('a plausible-sounding action with only a restated state is still rejected as a no-op', () => {
    const actorId = 'NPC-actor-noop';
    const candidate = {
        id: actorId,
        name: 'Noop Actor',
        locations: ['QC Lab'],
        knowledgeBasis: ['the manifest is already known'],
        goals: ['inspect the manifest'],
        stimuli: [],
        sourceThreads: ['PT-NOOP'],
        evidence: ['E-NOOP'],
        causalChain: ['PT-NOOP'],
        actorState: {
            location: { name: 'QC Lab' },
            resources: [],
            capabilities: [],
            plan: { summary: 'inspect the manifest' },
            stateFacts: [{ summary: 'the manifest is already known' }],
            lastAction: null,
            actionHistory: [],
        },
    };
    const proposal = {
        actorId,
        actorName: candidate.name,
        time: 'next window',
        location: 'QC Lab',
        travelTurns: 0,
        knowledgeBasis: candidate.knowledgeBasis,
        currentGoal: candidate.goals[0],
        intent: 'execute',
        candidateAction: 'open the manifest and review the familiar first page',
        actionWindow: 'next window',
        expectedCost: 'one minute',
        expectedDuration: 'one minute',
        expectedRisk: 'none identified',
        observableConsequence: 'the manifest is already known',
        stimulusDecisions: [],
        stateChanges: [{ kind: 'knowledge', summary: 'the manifest is already known' }],
        interactionTargets: [],
        resourceCosts: [],
        capabilityUsed: '',
        waitCondition: '',
        sourceThreads: candidate.sourceThreads,
        evidence: candidate.evidence,
        causalChain: candidate.causalChain,
    };
    assert.equal(
        parseActorShardProposal(JSON.stringify(proposal), { candidate }).error,
        'actor_shard.no_semantic_progress',
    );
});

test('profile coverage cannot remain 100 while any required field is unknown', () => {
    const profile = prepareActorProfileV6({
        id: 'NPC-profile-1',
        name: 'Profile One',
        identity: {},
        lineage: {},
        location: { name: 'harbor' },
        resources: [],
        capabilities: [],
        relationships: [],
        actionHistory: [],
        evidence: ['E-PROFILE'],
    }, { mode: 'full', turn: 1, now: 1 });
    profile.modules.relationships.unknownFields = ['relationship_entries'];
    profile.coverage = 100;
    profile.preparedForAction = true;
    assert.equal(actorProfileReadyForAction({
        id: 'NPC-profile-1',
        name: 'Profile One',
        profileV6: profile,
    }), false);

    const completeProfile = prepareActorProfileV6({
        id: 'NPC-profile-1',
        name: 'Profile One',
        identity: {},
        lineage: {},
        location: { name: 'harbor' },
        resources: [],
        capabilities: [],
        relationships: [],
        actionHistory: [],
        evidence: ['E-PROFILE'],
    }, { mode: 'full', turn: 1, now: 1 });
    for (const [module, field] of [
        ['relationships', 'entries'],
        ['knowledge', 'entries'],
        ['resourcesCapabilities', 'resources'],
        ['actionHistory', 'entries'],
    ]) {
        const emptyWithoutSemanticState = structuredClone(completeProfile);
        emptyWithoutSemanticState.modules[module].unknownFields = [];
        emptyWithoutSemanticState.modules[module].data[field] = [];
        delete emptyWithoutSemanticState.modules[module].data.coverageState;
        emptyWithoutSemanticState.preparedForAction = true;
        emptyWithoutSemanticState.coverage = 100;
        assert.equal(actorProfileReadyForAction({
            id: 'NPC-profile-1',
            name: 'Profile One',
            profileV6: emptyWithoutSemanticState,
        }), false, `${module} cannot pass on an unlabeled empty array`);
    }
});

test('twenty-two evidence-poor actors stay incomplete until the profile model writes real dossiers', () => {
    const profiles = Array.from({ length: 22 }, (_, index) => prepareActorProfileV6({
        id: `NPC-seed-${index + 1}`,
        name: `Seed Actor ${index + 1}`,
        identity: {},
        lineage: {},
        location: { name: 'shared district' },
        resources: [],
        capabilities: [],
        relationships: [],
        actionHistory: [],
        evidence: [`E-SEED-${index + 1}`],
    }, { mode: 'full', turn: 1, now: 1 }));
    assert.equal(profiles.every((profile) => (
        profile.modules.goals.data.longTerm.length === 0
        && profile.modules.goals.data.current.length === 0
        && profile.modules.goals.source !== 'designed_seed'
        && profile.preparedForAction === false
        && profile.coverage < 100
    )), true);
});

test('an actor attempt stays pending until a validated world adjudication exists', () => {
    const actor = {
        id: 'NPC-world-1',
        name: 'World One',
        resources: [],
        capabilities: [],
    };
    const attempt = createActorActionAttempt({
        actorId: actor.id,
        actorName: actor.name,
        candidateAction: 'inspect the sealed door hinge for recent tool marks',
        actionWindow: 'one bounded action window',
        expectedCost: 'ten minutes of focused work',
        expectedDuration: 'one turn',
        expectedRisk: 'the inspection may leave visible traces',
        observableConsequence: 'fresh inspection dust may remain on the hinge',
        location: { from: 'sealed door', to: 'sealed door', travelTurns: 0 },
        intent: 'execute',
        stateChanges: [{ kind: 'knowledge', summary: 'tool marks are confirmed or excluded' }],
        evidence: ['E-DOOR'],
    }, {
        actor,
        turn: 4,
        actorRef: {
            kind: 'actor_ref',
            actorId: actor.id,
            displayName: actor.name,
            aliases: [],
        },
        target: source(4),
    });
    const pending = adjudicateActorActionAttempt(attempt, { actor });
    assert.equal(pending.result.status, 'pending_world');
    assert.deepEqual(pending.result.appliedStateChanges, []);
    assert.equal(pending.receipt.stage, 'attempted');

    const settled = adjudicateActorActionAttempt(attempt, {
        actor,
        worldDecision: {
            attemptId: attempt.id,
            actorRef: attempt.actorRef,
            target: attempt.target,
            status: 'settled',
            risk: 'the inspection may leave visible traces',
            costs: ['ten minutes of focused work'],
            actualResourceCosts: [],
            durationTurns: 1,
            visibility: 'private',
            observerActorIds: [],
            publicSummary: '',
            privateSummary: 'fresh tool marks are confirmed privately',
            resultSummary: 'fresh tool marks are found under the lower hinge',
            observableConsequence: 'the lower hinge now bears fresh inspection dust',
            revealPath: 'visible on the next close examination',
            appliedStateChanges: [{
                kind: 'knowledge',
                summary: 'fresh tool marks are confirmed under the lower hinge',
            }],
        },
    });
    assert.equal(settled.result.status, 'settled');
    assert.equal(settled.receipt.stage, 'world_settled');
    assert.equal(settled.result.durationTurns, 1);
});

test('actor work is materialized as independent durable tasks so partial success cannot mask failure', () => {
    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime('actor-subtasks'), {
        sourceRef: source(1),
        modules: ['actor'],
        now: 100,
    }).runtime;
    const parent = claimNextSovereigntyTask(runtime, { module: 'actor', now: 110 });
    runtime = parent.runtime;
    const materialized = materializeSovereigntyActorTasks(runtime, {
        parentTaskId: parent.task.id,
        actorIds: ['NPC-A', 'NPC-B'],
        now: 120,
    });
    assert.deepEqual(
        materialized.tasks.map((task) => task.metadata.actorId),
        ['NPC-A', 'NPC-B'],
    );
    runtime = commitSovereigntyTask(materialized.runtime, {
        taskId: materialized.tasks[0].id,
        payload: { actorId: 'NPC-A', result: 'settled' },
        now: 130,
    }).runtime;
    runtime = cancelSovereigntyTaskAsStale(runtime, {
        taskId: materialized.tasks[1].id,
        reason: 'worker_failed',
        now: 140,
    }).runtime;
    assert.equal(runtime.simulatedThrough.turn, 0);
    assert.equal(sovereigntyHealthView(runtime).cancelledIncomplete, 1);
});

test('continuity candidates deduplicate, cool down, and require narrative acknowledgement', () => {
    const candidates = [{
        threadId: 'THREAD-A',
        priority: 60,
    }, {
        threadId: 'THREAD-A',
        priority: 90,
    }, {
        threadId: 'THREAD-B',
        priority: 70,
    }];
    const prior = [{
        receiptId: 'R-OLD-A',
        threadId: 'THREAD-A',
        status: 'consumed',
        targetTurn: 5,
        expiresTurn: 5,
        injectedAt: 100,
    }];
    assert.deepEqual(
        selectContinuityInjectionCandidates(candidates, prior, { targetTurn: 7 })
            .map((item) => item.threadId),
        ['THREAD-B'],
        'a consumed thread remains on a two-turn cooldown and duplicates collapse',
    );
    assert.deepEqual(
        selectContinuityInjectionCandidates(candidates, prior, { targetTurn: 8 })
            .map((item) => item.threadId),
        ['THREAD-A', 'THREAD-B'],
    );

    const captured = {
        generationId: 'GEN-8',
        generationSerial: 8,
        chatId: 'continuity-ack',
        messageId: 'message-8',
        index: 8,
        swipeId: 0,
        contentFingerprint: 'sha256:ack',
    };
    const settled = settleContinuityNarrativeReceipts([{
        receiptId: 'R-A',
        generationId: captured.generationId,
        generationSerial: captured.generationSerial,
        chatId: captured.chatId,
        threadId: 'THREAD-A',
        status: 'landed',
        targetTurn: 8,
        expiresTurn: 10,
        semanticEvidenceTerms: ['the public night-shift notice changed'],
        stages: [],
    }, {
        receiptId: 'R-B',
        generationId: captured.generationId,
        generationSerial: captured.generationSerial,
        chatId: captured.chatId,
        threadId: 'THREAD-B',
        status: 'landed',
        targetTurn: 8,
        expiresTurn: 10,
        semanticEvidenceTerms: ['an unrelated harbor bell'],
        stages: [],
    }], [{
        generationId: captured.generationId,
        generationSerial: captured.generationSerial,
        status: 'landed',
    }], {
        captured,
        content: 'At dawn, the public night-shift notice changed beside the station gate.',
        now: 500,
    });
    assert.equal(settled.changed, true);
    assert.equal(settled.consumed, 1);
    assert.equal(settled.retained, 1);
    assert.equal(settled.queue.find((item) => item.receiptId === 'R-A').status, 'consumed');
    assert.equal(settled.queue.find((item) => item.receiptId === 'R-B').status, 'retained');
    assert.equal(settled.batches[0].status, 'narrative_acknowledged');
    assert.equal(settled.queue.find((item) => item.receiptId === 'R-A')
        .consumedBy.contentFingerprint, captured.contentFingerprint);
});
