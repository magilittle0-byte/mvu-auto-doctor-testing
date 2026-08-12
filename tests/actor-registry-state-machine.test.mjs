import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    actorCandidatesForRegistryPromotion,
    actorRegistryDigest,
    actorRegistryMatchesLedger,
    discoverActorsFromTurnSources,
    emptyActorLedger,
    explicitDelimitedActorAliases,
    mergeActorIdentityReveal,
    migrateActorLedgerFromContinuity,
    normalizeActorLedger,
    normalizeActorRegistry,
    parseRegisteredActorGateNames,
    promoteActorCandidatesToRegistry,
    runActorRegistryUpsert,
    runRegisteredActorGate,
} from '../actor-ledger-core.mjs';

function sourceRef(chatId, index = 1, cardId = 'card-main') {
    return {
        chatId,
        messageId: `message-${index}`,
        logicalIndex: index,
        index,
        swipeId: 0,
        generation: index,
        generationSerial: index,
        generationId: `generation-${index}`,
        generationType: 'normal',
        identityScopeId: `${chatId}|character:${cardId}`,
        scopeDigest: `scope:${chatId}|character:${cardId}`,
        hash: `hash-${chatId}-${index}`,
        contentHash: `hash-${chatId}-${index}`,
        contentFingerprint: `hash-${chatId}-${index}`,
    };
}

function discover(ledger, names, ref = sourceRef(ledger.chatId)) {
    const acceptedContent = `<content>${names.map((name) => (
        `<actor name="${name}"></actor>`
    )).join('')}</content>`;
    return discoverActorsFromTurnSources(ledger, {
        acceptedContent,
        sourceRef: ref,
        turn: ref.generation,
    });
}

function upsert(discovery, ref = discovery.candidates[0]?.sourceRef) {
    return runActorRegistryUpsert(discovery.ledger, discovery.candidates, {
        chatId: discovery.ledger.chatId,
        identityScopeId: ref?.identityScopeId,
        scopeDigest: ref?.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: ref,
        turn: ref?.generation,
    });
}

function promote(candidateRegistry, candidates, ref = candidates[0]?.sourceRef) {
    return promoteActorCandidatesToRegistry(candidateRegistry.ledger, candidates, {
        chatId: candidateRegistry.ledger.chatId,
        identityScopeId: ref?.identityScopeId,
        scopeDigest: ref?.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: ref,
        turn: ref?.generation,
    });
}

function registerNames(ledger, names, ref = sourceRef(ledger.chatId)) {
    const discovery = discover(ledger, names, ref);
    const candidates = upsert(discovery, ref);
    return { discovery, candidates, registration: promote(candidates, discovery.candidates, ref) };
}

function runProductionRegistryChain(ledger, names, ref = sourceRef(ledger.chatId)) {
    const discovery = discover(ledger, names, ref);
    const candidates = upsert(discovery, ref);
    const promotionInput = actorCandidatesForRegistryPromotion(
        discovery.candidates,
        candidates,
    );
    const registration = promote(candidates, promotionInput, ref);
    registration.quarantined = [
        ...candidates.quarantined,
        ...registration.quarantined,
    ];
    return { discovery, candidates, promotionInput, registration };
}

function legacyActor(id, name, aliases = []) {
    return {
        id,
        name,
        tier: 'secondary',
        status: 'active',
        identity: { aliases },
        lineage: { rootActorId: id, currentForm: name, forms: [] },
        evidence: ['synthetic'],
    };
}

test('every new named actor is inserted into candidate before copy/delete promotion', () => {
    const initial = emptyActorLedger('chat-candidate');
    const discovery = discover(initial, ['岑遥'], sourceRef(initial.chatId, 3));
    assert.equal(discovery.ledger.actors.length, 0);
    assert.equal(Object.keys(discovery.ledger.actorRegistry.characters).length, 0);

    const candidates = upsert(discovery);
    assert.equal(candidates.ledger.actors.length, 0);
    assert.deepEqual(Object.keys(candidates.ledger.actorRegistry.characters), ['岑遥']);
    assert.equal(Object.keys(candidates.ledger.actorRegistry.registered).length, 0);

    const registration = promote(candidates, discovery.candidates);
    assert.equal(Object.keys(registration.ledger.actorRegistry.characters).length, 0);
    assert.deepEqual(Object.keys(registration.ledger.actorRegistry.registered), ['岑遥']);
    assert.equal(registration.ledger.actors.length, 1);
    assert.equal(registration.promoted[0].boundBy, 'candidate_copy');
});

test('three delimited organization identities plus three short names remain exactly three identities', () => {
    const ledger = emptyActorLedger('chat-three');
    const ref = sourceRef(ledger.chatId, 4);
    const names = [
        '北辰商会·阿澜', '阿澜',
        '白塔医局·闻舟', '闻舟',
        '赤湾巡队·洛青', '洛青',
    ];
    const discovery = discover(ledger, names, ref);
    const candidates = upsert(discovery, ref);
    assert.deepEqual(
        Object.keys(candidates.ledger.actorRegistry.characters).sort(),
        ['北辰商会·阿澜', '白塔医局·闻舟', '赤湾巡队·洛青'].sort(),
    );
    assert.equal(Object.keys(candidates.ledger.actorRegistry.registered).length, 0);

    const registration = promote(candidates, discovery.candidates, ref);
    assert.equal(Object.keys(registration.ledger.actorRegistry.characters).length, 0);
    assert.equal(Object.keys(registration.ledger.actorRegistry.registered).length, 3);
    assert.equal(registration.ledger.actors.length, 3);
    assert.deepEqual(explicitDelimitedActorAliases('艾萨克·牛顿'), ['艾萨克', '牛顿']);
});

test('exact candidate name updates, exact registered alias updates, and only no match inserts', () => {
    const ledger = emptyActorLedger('chat-exact');
    const ref = sourceRef(ledger.chatId, 2);
    const first = discover(ledger, ['星港事务所·小禾'], ref);
    const inserted = upsert(first, ref);
    assert.equal(inserted.inserted.length, 1);

    const repeated = upsert(discover(inserted.ledger, ['星港事务所·小禾'], ref), ref);
    assert.equal(repeated.inserted.length, 0);
    assert.equal(repeated.updated[0].table, 'characters');
    const registered = promote(repeated, first.candidates, ref);

    const aliasHit = upsert(discover(registered.ledger, ['小禾'], sourceRef(ledger.chatId, 3)), sourceRef(ledger.chatId, 3));
    assert.equal(aliasHit.inserted.length, 0);
    assert.equal(aliasHit.updated[0].table, 'registered');

    const newName = upsert(discover(aliasHit.ledger, ['顾川'], sourceRef(ledger.chatId, 4)), sourceRef(ledger.chatId, 4));
    assert.equal(newName.inserted.length, 1);
    assert.ok(newName.ledger.actorRegistry.characters['顾川']);
});

test('production chain updates a registered reappearance without promoting or quarantining it', () => {
    const initial = runProductionRegistryChain(
        emptyActorLedger('chat-production-existing'),
        ['小禾'],
        sourceRef('chat-production-existing', 1),
    ).registration;
    const actorId = initial.ledger.actorRegistry.registered['小禾'].actorRef.actorId;

    const repeated = runProductionRegistryChain(
        initial.ledger,
        ['星港事务所·小禾'],
        sourceRef('chat-production-existing', 2),
    );
    assert.equal(repeated.candidates.inserted.length, 0);
    assert.deepEqual(
        repeated.candidates.updated.map(({ candidateId, actorRef, table }) => ({
            candidateId,
            actorId: actorRef.actorId,
            table,
        })),
        [{
            candidateId: repeated.discovery.candidates[0].candidateId,
            actorId,
            table: 'registered',
        }],
    );
    assert.deepEqual(repeated.promotionInput, []);
    assert.equal(repeated.registration.promoted.length, 0);
    assert.equal(repeated.registration.quarantined.length, 0);
    const registered = repeated.registration.ledger.actorRegistry
        .registered['星港事务所·小禾'];
    assert.equal(registered.actorRef.actorId, actorId);
    assert.ok(registered.actorRef.aliases.includes('小禾'));
    assert.equal(registered.updatedTurn, 2);
    assert.ok(registered.sourceRefs.some((ref) => ref.generation === 2));
    assert.ok(repeated.registration.ledger.actors[0].evidence.length > 0);
    assert.equal(repeated.registration.ledger.actors.length, 1);
});

test('production chain still promotes a new accepted actor through characters', () => {
    const result = runProductionRegistryChain(
        emptyActorLedger('chat-production-new'),
        ['新舟'],
        sourceRef('chat-production-new', 3),
    );
    assert.equal(result.candidates.inserted[0].table, 'characters');
    assert.equal(result.promotionInput.length, 1);
    assert.equal(
        result.promotionInput[0].candidateId,
        result.candidates.inserted[0].candidateId,
    );
    assert.equal(result.registration.promoted.length, 1);
    assert.equal(result.registration.quarantined.length, 0);
    assert.equal(Object.keys(result.registration.ledger.actorRegistry.characters).length, 0);
    assert.ok(result.registration.ledger.actorRegistry.registered['新舟']);
});

test('production chain promotes an updated character row by candidateId and strict ActorRef', () => {
    const ledger = emptyActorLedger('chat-production-candidate-update');
    const anchorRef = sourceRef(ledger.chatId, 1);
    const anchorDiscovery = discover(ledger, ['星港事务所·小禾'], anchorRef);
    const anchorCandidates = anchorDiscovery.candidates.map((candidate) => ({
        ...candidate,
        sourceKind: 'mvu_anchor',
    }));
    const anchored = runActorRegistryUpsert(anchorDiscovery.ledger, anchorCandidates, {
        chatId: ledger.chatId,
        identityScopeId: anchorRef.identityScopeId,
        scopeDigest: anchorRef.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: anchorRef,
        turn: 1,
    });
    const storedCandidate = anchored.ledger.actorRegistry.characters['星港事务所·小禾'];
    assert.equal(anchored.inserted[0].table, 'characters');

    const accepted = runProductionRegistryChain(
        anchored.ledger,
        ['小禾'],
        sourceRef(ledger.chatId, 2),
    );
    assert.equal(accepted.candidates.inserted.length, 0);
    assert.equal(accepted.candidates.updated[0].table, 'characters');
    const mismatchedActorRef = {
        ...accepted.candidates,
        updated: accepted.candidates.updated.map((entry) => ({
            ...entry,
            actorRef: { ...entry.actorRef, actorId: 'NPC-FORGED-REF' },
        })),
    };
    assert.deepEqual(
        actorCandidatesForRegistryPromotion(
            accepted.discovery.candidates,
            mismatchedActorRef,
        ),
        [],
    );
    assert.notEqual(
        accepted.discovery.candidates[0].candidateId,
        storedCandidate.candidateId,
    );
    assert.equal(accepted.promotionInput[0].candidateId, storedCandidate.candidateId);
    assert.equal(
        accepted.registration.promoted[0].actorRef.actorId,
        storedCandidate.actorRef.actorId,
    );
    assert.equal(accepted.registration.quarantined.length, 0);
    assert.equal(Object.keys(accepted.registration.ledger.actorRegistry.characters).length, 0);
    assert.equal(
        accepted.registration.ledger.actorRegistry.registered['星港事务所·小禾']
            .actorRef.actorId,
        storedCandidate.actorRef.actorId,
    );
});

test('production chain mixes registered update and new promotion without false quarantine', () => {
    const initial = runProductionRegistryChain(
        emptyActorLedger('chat-production-mixed'),
        ['旧识'],
        sourceRef('chat-production-mixed', 1),
    ).registration;
    const existingActorId = initial.ledger.actorRegistry.registered['旧识'].actorRef.actorId;

    const mixed = runProductionRegistryChain(
        initial.ledger,
        ['旧识', '初见'],
        sourceRef('chat-production-mixed', 2),
    );
    assert.deepEqual(
        mixed.candidates.updated.map((entry) => entry.table),
        ['registered'],
    );
    assert.deepEqual(
        mixed.candidates.inserted.map((entry) => entry.table),
        ['characters'],
    );
    assert.deepEqual(
        mixed.promotionInput.map((candidate) => candidate.name),
        ['初见'],
    );
    assert.deepEqual(
        mixed.registration.promoted.map((entry) => entry.candidateId),
        [mixed.candidates.inserted[0].candidateId],
    );
    assert.equal(mixed.registration.quarantined.length, 0);
    assert.equal(
        mixed.registration.ledger.actorRegistry.registered['旧识'].actorRef.actorId,
        existingActorId,
    );
    assert.ok(mixed.registration.ledger.actorRegistry.registered['初见']);
    assert.equal(mixed.registration.ledger.actors.length, 2);
});

test('unseparated suffixes never merge and a multiply owned exact alias is quarantined', () => {
    const ledger = emptyActorLedger('chat-conflict');
    const first = upsert(discover(ledger, ['远山闻舟', '闻舟'], sourceRef(ledger.chatId, 1)));
    assert.equal(Object.keys(first.ledger.actorRegistry.characters).length, 2);

    const seeded = normalizeActorLedger({
        chatId: ledger.chatId,
        actors: [
            legacyActor('NPC-EAST', '东塔执事', ['共同称呼']),
            legacyActor('NPC-WEST', '西塔执事', ['共同称呼']),
        ],
        migrations: { actorRegistryV1: false },
    });
    const ref = sourceRef(ledger.chatId, 5);
    const conflictDiscovery = discover(seeded, ['共同称呼'], ref);
    const conflict = upsert(conflictDiscovery, ref);
    assert.equal(conflict.quarantined[0].reason, 'actor_candidate.alias_conflict');
    assert.deepEqual(
        actorCandidatesForRegistryPromotion(conflictDiscovery.candidates, conflict),
        [],
    );
    assert.equal(conflict.ledger.actors.length, 2);
    assert.equal(Object.keys(conflict.ledger.actorRegistry.characters).length, 0);
    assert.equal(conflict.ledger.identityQuarantine.at(-1).conflictingActorIds.length, 2);
});

test('true-name reveal updates the registered row, keeps ActorId, and moves old name to aliases', () => {
    const result = registerNames(
        emptyActorLedger('chat-reveal'),
        ['蒙面旅人'],
        sourceRef('chat-reveal', 2),
    ).registration;
    const actorId = result.ledger.actors[0].id;
    const revealed = mergeActorIdentityReveal(result.ledger, {
        actorId,
        revealedName: '林昭',
        evidence: ['synthetic reveal'],
        turn: 3,
    });
    assert.equal(revealed.actors[0].id, actorId);
    assert.equal(revealed.actors[0].name, '林昭');
    assert.ok(revealed.actors[0].identity.aliases.includes('蒙面旅人'));
    assert.equal(revealed.actorRegistry.registered['林昭'].actorRef.actorId, actorId);
});

test('gate is one local registeredSet intersection with dedupe and unknown filtering', () => {
    const registration = registerNames(
        emptyActorLedger('chat-gate'),
        ['林昭', '顾川'],
        sourceRef('chat-gate', 2),
    ).registration;
    assert.deepEqual(
        parseRegisteredActorGateNames(
            { characters: ['林昭', '未知者', '林昭', '顾川'] },
            new Set(['林昭', '顾川']),
        ),
        ['林昭', '顾川'],
    );
    const gate = runRegisteredActorGate(
        registration.ledger.actorRegistry,
        ['顾川', '未知者', '顾川'],
    );
    assert.deepEqual(gate.names, ['顾川']);
    assert.equal(gate.actorRefs.length, 1);
});

test('identity scope rejects cross-chat, cross-card, and wrong generation source refs', () => {
    const ledger = emptyActorLedger('chat-scope');
    const ref = sourceRef(ledger.chatId, 2, 'card-a');
    const discovery = discover(ledger, ['苏叶'], ref);

    const wrongCard = upsert(discovery, sourceRef(ledger.chatId, 2, 'card-b'));
    assert.equal(wrongCard.quarantined[0].reason, 'actor_candidate.source_ref_mismatch');
    assert.equal(Object.keys(wrongCard.ledger.actorRegistry.characters).length, 0);
    assert.deepEqual(actorCandidatesForRegistryPromotion(discovery.candidates, wrongCard), []);

    const wrongGeneration = { ...ref, generationId: 'generation-other' };
    const stale = upsert(discovery, wrongGeneration);
    assert.equal(stale.quarantined[0].reason, 'actor_candidate.source_ref_mismatch');

    const foreign = runActorRegistryUpsert(emptyActorLedger('chat-other'), discovery.candidates, {
        chatId: 'chat-other',
        identityScopeId: 'chat-other|character:card-a',
        expectedSourceRef: sourceRef('chat-other', 2, 'card-a'),
        turn: 2,
    });
    assert.equal(foreign.quarantined[0].reason, 'actor_candidate.chat_mismatch');
    assert.deepEqual(actorCandidatesForRegistryPromotion(discovery.candidates, foreign), []);
});

test('ActorId depends only on chat plus card scope and canonical name', () => {
    const firstRef = sourceRef('chat-id', 1, 'card-a');
    const secondRef = {
        ...sourceRef('chat-id', 9, 'card-a'),
        swipeId: 3,
        hash: 'hash-reroll',
    };
    const first = registerNames(emptyActorLedger('chat-id'), ['许澄'], firstRef).registration;
    const second = registerNames(emptyActorLedger('chat-id'), ['许澄'], secondRef).registration;
    const otherCard = registerNames(
        emptyActorLedger('chat-id'),
        ['许澄'],
        sourceRef('chat-id', 1, 'card-b'),
    ).registration;
    assert.equal(first.ledger.actors[0].id, second.ledger.actors[0].id);
    assert.notEqual(first.ledger.actors[0].id, otherCard.ledger.actors[0].id);
});

test('worldbook digest changes do not rebuild identity', () => {
    const registration = registerNames(
        emptyActorLedger('chat-worldbook'),
        ['沈岚'],
        sourceRef('chat-worldbook', 3),
    ).registration;
    const registry = registration.ledger.actorRegistry;
    const before = actorRegistryDigest(registry);
    const normalized = normalizeActorRegistry({ ...registry, worldbookDigest: 'changed' }, {
        chatId: registry.chatId,
        identityScopeId: registry.identityScopeId,
    });
    assert.equal(actorRegistryDigest(normalized), before);
    assert.equal(Object.values(normalized.registered)[0].actorRef.actorId, registration.ledger.actors[0].id);
});

test('legacy persisted actors project into registered without changing ActorId', () => {
    const legacy = normalizeActorLedger({
        version: 6,
        chatId: 'chat-legacy-registry',
        turn: 4,
        actors: [legacyActor('NPC-LEGACY-01', '旧人物', ['旧称'])],
        migrations: { actorRegistryV1: false },
    });
    const entry = legacy.actorRegistry.registered['旧人物'];
    assert.equal(entry.actorRef.actorId, 'NPC-LEGACY-01');
    assert.equal(entry.origin, 'legacy_persisted');
    const digest = actorRegistryDigest(legacy.actorRegistry);
    assert.equal(actorRegistryMatchesLedger(legacy, {
        chatId: legacy.chatId,
        actorIds: ['NPC-LEGACY-01'],
        digest,
    }).ok, true);
});

test('continuity projections and direct promotion cannot bypass candidate insertion', () => {
    const ledger = emptyActorLedger('chat-continuity-gate');
    const continuity = {
        chatId: ledger.chatId,
        turn: 4,
        threads: [{
            id: 'PLAN-ONLY',
            actors: ['PlanOnlyActor'],
            locations: ['unknown'],
            stage: 'seeded',
            knowledge: 'hidden',
            summary: 'synthetic planning only',
            seedBasis: 'synthetic-plan-only',
            sourceRefs: [],
        }],
    };
    const migrated = migrateActorLedgerFromContinuity(ledger, continuity);
    assert.equal(migrated.actors.length, 0);
    assert.equal(Object.keys(migrated.actorRegistry.registered).length, 0);

    const discovery = discover(ledger, ['越级人物'], sourceRef(ledger.chatId, 4));
    const rejected = promoteActorCandidatesToRegistry(ledger, discovery.candidates, {
        chatId: ledger.chatId,
        identityScopeId: discovery.candidates[0].sourceRef.identityScopeId,
        scopeDigest: discovery.candidates[0].sourceRef.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: discovery.candidates[0].sourceRef,
        turn: 4,
    });
    assert.equal(rejected.ledger.actors.length, 0);
    assert.equal(rejected.quarantined[0].reason, 'actor_candidate.candidate_missing');

    const registered = registerNames(ledger, ['既有人物'], sourceRef(ledger.chatId, 5)).registration;
    const repeated = discover(registered.ledger, ['既有人物'], sourceRef(ledger.chatId, 6));
    const stillRejected = promoteActorCandidatesToRegistry(registered.ledger, repeated.candidates, {
        chatId: ledger.chatId,
        identityScopeId: repeated.candidates[0].sourceRef.identityScopeId,
        scopeDigest: repeated.candidates[0].sourceRef.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: repeated.candidates[0].sourceRef,
        turn: 6,
    });
    assert.equal(stillRejected.promoted.length, 0);
    assert.equal(stillRejected.quarantined[0].reason, 'actor_candidate.candidate_missing');
});

test('current Registry blocks compatibility promotion of unregistered ledger and continuity names', () => {
    const base = emptyActorLedger('chat-current-registry-gate');
    base.migrations.continuityV5 = false;
    base.actors = [legacyActor('NPC-UNREGISTERED', '未登记旧人物')];
    const continuity = {
        chatId: base.chatId,
        turn: 7,
        updatedAt: 42,
        threads: [{
            id: 'CONTINUITY-NOT-REGISTRY',
            actors: ['连续性越级人物'],
            knowledge: 'observed',
            summary: '只存在于连续性投影。',
            nextBeat: '试图越过候选表登记。',
            sourceRefs: [],
        }],
    };
    const migrated = migrateActorLedgerFromContinuity(base, continuity, {
        allowLegacyRegistration: false,
        currentRegistryAuthoritative: true,
        migrationTimestamp: 42,
    });
    assert.deepEqual(migrated.actors, []);
    assert.deepEqual(migrated.actorRegistry.registered, {});
    assert.equal(migrated.actors.some((actor) => actor.name === '连续性越级人物'), false);

    const registered = registerNames(
        emptyActorLedger(base.chatId),
        ['已登记人物'],
        sourceRef(base.chatId, 6),
    ).registration.ledger;
    registered.migrations.continuityV5 = false;
    const preserved = migrateActorLedgerFromContinuity(registered, continuity, {
        allowLegacyRegistration: false,
        currentRegistryAuthoritative: true,
        migrationTimestamp: 42,
    });
    assert.deepEqual(preserved.actors.map((actor) => actor.name), ['已登记人物']);
    assert.deepEqual(Object.keys(preserved.actorRegistry.registered), ['已登记人物']);
});

test('production builds Registry/promotion in the P1 working ledger, then commits it only with the profile group', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const profileStart = source.indexOf('async function runActorProfileTarget');
    const continuityStart = source.indexOf('async function runContinuityTarget');
    assert.ok(profileStart >= 0 && continuityStart > profileStart);
    const runtime = source.slice(profileStart, continuityStart);
    const discoveryAt = runtime.indexOf('discoverActorsFromTurnSources');
    const candidateAt = runtime.indexOf('runActorRegistryUpsert');
    const promotionAt = runtime.indexOf('promoteActorCandidatesToRegistry');
    const profileAt = runtime.indexOf('await completeActorProfilesForTurn');
    assert.ok(discoveryAt >= 0 && candidateAt > discoveryAt && promotionAt > candidateAt);
    assert.ok(profileAt > promotionAt);
    assert.equal(runtime.includes('persistActorRegistryForTurn'), false);

    const continuityEnd = source.indexOf('async function confirmDangerousAction', continuityStart);
    assert.ok(continuityEnd > continuityStart);
    const continuityRuntime = source.slice(continuityStart, continuityEnd);
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'completeActorProfilesForTurn',
    ]) {
        assert.equal(continuityRuntime.includes(p1Step), false, `P3 must not repeat P1 step ${p1Step}`);
    }

    const core = await readFile(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8');
    const selectionStart = core.indexOf('export function actorCandidatesForRegistryPromotion');
    const selectionEnd = core.indexOf('// caikis second_npc', selectionStart);
    const selectionSource = core.slice(selectionStart, selectionEnd);
    assert.match(selectionSource, /result\?\.table !== 'characters'/u);
    assert.match(selectionSource, /acceptedByCandidateId\.get\(candidateId\)/u);
    assert.match(selectionSource, /actorRefsMatch\(row\?\.actorRef, result\?\.actorRef\)/u);
    assert.doesNotMatch(selectionSource, /row\?\.name|candidate\?\.name/u);
    const gateStart = core.indexOf('export function runRegisteredActorGate');
    const gateEnd = core.indexOf('\n}\n', gateStart) + 3;
    const gateSource = core.slice(gateStart, gateEnd);
    assert.match(gateSource, /new Set\(Object\.keys\(registry\.registered\)\)/u);
    assert.match(gateSource, /parseRegisteredActorGateNames/u);
    assert.doesNotMatch(gateSource, /callApi|callOpenAI|model/u);

    const shard = await readFile(new URL('../actor-shard-core.mjs', import.meta.url), 'utf8');
    const selectorStart = shard.indexOf('export function selectActorShardCandidates');
    const selectorEnd = shard.indexOf('export function buildActorShardMessages', selectorStart);
    const selector = shard.slice(selectorStart, selectorEnd);
    assert.match(selector, /runRegisteredActorGate/u);
    assert.match(selector, /actorProfileReadinessInLedger\(actorLedger, id\)\.ready/u);
    assert.match(selector, /scheduleProvided && scheduledIds\.size === 0/u);

    const persistStart = source.indexOf('async function persistActorRegistryForTurn');
    const persistEnd = source.indexOf('async function completeActorProfilesForTurn', persistStart);
    const persistence = source.slice(persistStart, persistEnd);
    assert.match(persistence, /fields: \['actorLedger'\]/u);
    assert.match(persistence, /durable: true/u);
    assert.match(persistence, /requireReadback: true/u);
    assert.match(persistence, /contentValidator: \(persisted\) => actorRegistryMatchesLedger/u);
});
