import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    buildContinuityConsumerPayload,
    buildContinuityInjection,
    normalizeContinuityState,
} from '../continuity-core.mjs';

function persistedWorldPacket({
    maxVisible,
    visibleThreadIds,
    producerTarget: suppliedTarget,
    oversized = false,
}) {
    const producerTarget = suppliedTarget || {
        chatId: 'chat-canonical-world',
        messageId: 'message-world-1',
        generationId: 'generation-world-1',
        generationSerial: 1,
        generationType: 'normal',
        scopeDigest: 'scope-canonical-world',
        contentFingerprint: 'content-world-1',
        index: 2,
        swipeId: 0,
    };
    const chatId = producerTarget.chatId;
    const state = normalizeContinuityState({
        chatId,
        threads: Array.from({ length: oversized ? 4 : 1 }, (_, index) => ({
            id: oversized ? `thread-converging-${index}` : 'thread-converging',
            title: `A converging thread ${index}`,
            summary: oversized
                ? `summary-${index}`.padEnd(700, 's')
                : 'A visible consequence approaches.',
            offscreenBeat: oversized ? `offscreen-${index}`.padEnd(500, 'o') : '',
            nextBeat: oversized ? `next-${index}`.padEnd(500, 'n') : '',
            trigger: oversized ? `trigger-${index}`.padEnd(350, 't') : '',
            intersection: oversized ? `intersection-${index}`.padEnd(450, 'i') : '',
            effects: oversized
                ? Array.from({ length: 12 }, (_, effect) => `effect-${effect}`.padEnd(80, 'e'))
                : [],
            stage: 'advancing',
            origin: 'main_derivative',
            relation: 'converging',
            knowledge: 'observed',
        })),
        world: {
            trends: Array.from({ length: oversized ? 12 : 1 }, (_, index) => ({
                id: `trend-world-${index}`,
                name: `World trend ${index}`,
                summary: oversized
                    ? `${index}:`.padEnd(700, String(index % 10))
                    : 'The wider world keeps changing.',
                knowledge: 'observed',
                status: 'active',
            })),
        },
    }, { chatId });
    const options = { director: 'standalone' };
    if (maxVisible !== undefined) options.maxVisible = maxVisible;
    const legacyText = buildContinuityInjection(state, options);
    const saved = normalizeContinuityState({
        ...state,
        nextTurnInjection: {
            version: 1,
            status: 'pending',
            producerTarget,
            sourceContinuityDigest: 'continuity-before-world-1',
            payload: { text: legacyText, visibleThreadIds },
            settlementProof: {
                producerTarget,
                actorLedgerDigest: 'empty-actor-ledger',
                targetActionAuthorityDigest: 'empty-target-action-authority',
                targetActionAttemptCount: 0,
                targetActionReceiptCount: 0,
                digest: 'world-only-settlement',
                orderedResults: [],
            },
            createdAt: 1,
        },
    }, { chatId });
    return { legacyText, saved, packet: saved.nextTurnInjection };
}

async function loadClearLegacyNextTurnSlots(context) {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('function clearLegacyNextTurnSlots() {');
    const end = source.indexOf('\nfunction setNextTurnConsumerFallback', start);
    assert.ok(start >= 0 && end > start);
    const sandbox = {
        getContext: () => context,
        CONTINUITY_INJECTION_NAME: 'mvu-auto-doctor-continuity',
        SOCIAL_INJECTION_NAME: 'mvu-auto-doctor-social-contract',
        SERENDIPITY_INJECTION_NAME: 'mvu-auto-doctor-serendipity-license',
        IN_CHAT_POSITION: 1,
        IN_CHAT_DEPTH: 1,
    };
    vm.runInNewContext(
        `${source.slice(start, end)}\nthis.clearLegacyNextTurnSlots = clearLegacyNextTurnSlots;`,
        sandbox,
    );
    return sandbox.clearLegacyNextTurnSlots;
}

test('P3 saved canonical world package projects through the real P4 consumer helper', () => {
    const zero = persistedWorldPacket({ maxVisible: 0, visibleThreadIds: [] });
    assert.match(zero.legacyText, /\n/u, 'P3 renderer starts with its legacy multiline shape');
    assert.doesNotMatch(
        zero.packet.payload.text,
        /\n/u,
        'the production normalizer persists the canonical single-line shape',
    );
    const zeroConsumer = buildContinuityConsumerPayload(zero.saved, zero.packet);
    assert.equal(zeroConsumer.ok, true);
    assert.equal(zeroConsumer.legacy.rawMaxVisible, 0);
    assert.doesNotMatch(zeroConsumer.text, /\n/u);
    assert.match(zeroConsumer.text, /^<World_Continuity_Package> /u);
    assert.match(zeroConsumer.text, / <\/World_Continuity_Package>$/u);

    const defaultTwo = persistedWorldPacket({
        maxVisible: undefined,
        visibleThreadIds: ['thread-converging'],
    });
    const defaultConsumer = buildContinuityConsumerPayload(
        defaultTwo.saved,
        defaultTwo.packet,
    );
    assert.equal(defaultConsumer.ok, true);
    assert.equal(defaultConsumer.legacy.rawMaxVisible, 2);
    assert.match(defaultConsumer.text, /thread-converging/u);
});

test('canonical world projection remains strict about text and visible thread IDs', () => {
    const fixture = persistedWorldPacket({
        maxVisible: undefined,
        visibleThreadIds: ['thread-converging'],
    });
    const textTampered = structuredClone(fixture.packet);
    textTampered.payload.text += ' tampered';
    assert.equal(
        buildContinuityConsumerPayload(fixture.saved, textTampered).ok,
        false,
    );

    const visibleIdsTampered = structuredClone(fixture.packet);
    visibleIdsTampered.payload.visibleThreadIds = [];
    assert.deepEqual(
        buildContinuityConsumerPayload(fixture.saved, visibleIdsTampered),
        { ok: false, reason: 'legacy_projection_mismatch' },
    );

    const oversized = persistedWorldPacket({
        maxVisible: 4,
        visibleThreadIds: Array.from(
            { length: 4 },
            (_, index) => `thread-converging-${index}`,
        ),
        oversized: true,
    });
    assert.ok(
        oversized.legacyText.replace(/\s+/gu, ' ').trim().length > 12000,
        'fixture must cross the production persistence limit',
    );
    assert.equal(oversized.packet.payload.text.length, 12000);
    assert.deepEqual(
        buildContinuityConsumerPayload(oversized.saved, oversized.packet),
        { ok: false, reason: 'legacy_projection_mismatch' },
        'a truncated persisted renderer cannot regain an unseen tail during P4 projection',
    );
});

test('P3 uses local structured recall then one Advance call; no separate actor proposal model or repair path', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const runStart = source.indexOf('async function runContinuityTarget(captured, {');
    const runEnd = source.indexOf('\nfunction sameTargetExceptContent', runStart);
    assert.ok(runStart >= 0 && runEnd > runStart);
    const run = source.slice(runStart, runEnd);
    const recall = run.indexOf('stage3LocalRecallPacket({');
    const advance = run.indexOf('await generateWorldContinuitySingleBatch', recall);
    const rebase = run.indexOf('stage3PersistPreparedActorAttemptsOnFreshLedger', advance);
    const helperStart = source.indexOf('async function stage3PersistPreparedActorAttemptsOnFreshLedger');
    const helperEnd = source.indexOf('async function stage3PersistAttemptlessPreparedWorldCandidate', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    const prepare = helper.indexOf('prepareActorActionAttempts');
    const persist = helper.indexOf('await persistActorActionAttemptsForTurn', prepare);
    assert.ok(recall >= 0 && advance > recall && rebase > advance);
    assert.ok(helperStart >= 0 && helperEnd > helperStart && prepare >= 0 && persist > prepare);
    assert.doesNotMatch(source, /collectActorShardProposals|runActorShardProposalBatch|buildActorShardBatchMessages/u);
    assert.match(source, /stage3Phase: 'world_candidate_prepared'/u);
    assert.match(source, /async function commitPreparedWorldCandidate/u);
});

test('manifest entry imports only current v2 leaf modules, not retired aggregate graphs', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const receipts = await readFile(new URL('../v2/runtime/continuity-receipts.mjs', import.meta.url), 'utf8');
    const diagnostics = await readFile(new URL('../v2/surface/diagnostics.mjs', import.meta.url), 'utf8');
    assert.match(source, /from '\.\/v2\/runtime\/continuity-receipts\.mjs'/u);
    assert.match(source, /from '\.\/v2\/surface\/diagnostics\.mjs'/u);
    assert.doesNotMatch(source, /from '\.\/v2\/(?:runtime|surface)\/index\.mjs'/u);
    assert.doesNotMatch(receipts, /branchId|mvu_auto_doctor_branch_id|barrierHistory/u);
    assert.doesNotMatch(diagnostics, /from '\.\.\/transaction\/index\.mjs'|from '\.\/core\.mjs'/u);
});

test('P4 has one Doctor-owned exact-once consumer for the verified world package plus ticket payload', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function precomposeNextTurnConsumer(session)');
    const end = source.indexOf('async function commitNextTurnConsumer(session, envelope)', start);
    assert.ok(start >= 0 && end > start);
    const consumer = source.slice(start, end);
    const clearAt = consumer.indexOf('clearLegacyNextTurnSlots()');
    const verifyAt = consumer.indexOf('verifiedNextTurnWorldPackage');
    const projectAt = consumer.indexOf('buildContinuityConsumerPayload', verifyAt);
    const ticketAt = consumer.indexOf('npcDesignTicketPrompt');
    const payloadAt = consumer.indexOf('immutableNextTurnConsumerPayload', ticketAt);
    const leaseAt = consumer.indexOf('writeNextTurnConsumerLease(', payloadAt);
    const fallbackAt = consumer.indexOf('setNextTurnConsumerFallback(payload.text)', leaseAt);
    assert.ok(clearAt >= 0 && verifyAt > clearAt && projectAt > verifyAt);
    assert.ok(ticketAt > projectAt && payloadAt > ticketAt && leaseAt > payloadAt);
    assert.ok(fallbackAt > leaseAt);
    assert.match(consumer, /providerId: DOCTOR_NEXT_TURN_PROVIDER_ID/u);
    assert.match(consumer, /recordNextTurnConsumerInspection\(session,[\s\S]*?worldPackage: packet \? 'verified' : 'ticket_only'/u);
    assert.doesNotMatch(
        consumer,
        /runSovereigntyAgentPool|CONTINUITY_INJECTION_NAME|SOCIAL_INJECTION_NAME|SERENDIPITY_INJECTION_NAME/u,
    );

    assert.doesNotMatch(source, /registerNextTurnConsumerProvider|selectNextTurnConsumerProvider|configureNextTurnConsumerProviderPreference/u);
});

test('fresh-chat P3 build, normalize and P4 projection receive the current generation lease after P1 evolution', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const identityStart = source.indexOf('function runtimeGenerationSerialFloor(context) {');
    const identityEnd = source.indexOf('\nfunction cardScopeIdentity(context, character)', identityStart);
    const verifyStart = source.indexOf('function verifiedNextTurnWorldPackage(context, namespace, packet, frozenScope, decisionSink = null)');
    const verifyEnd = source.indexOf('\nasync function precomposeNextTurnConsumer(session)', verifyStart);
    const leaseStart = source.indexOf('async function writeNextTurnConsumerLease(session, scopeDigest, payload)');
    const leaseEnd = source.indexOf('\nfunction persistedNextTurnConsumerCleanup(lease)', leaseStart);
    assert.ok(identityStart >= 0 && identityEnd > identityStart);
    assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
    assert.ok(leaseStart >= 0 && leaseEnd > leaseStart);

    const previous = {
        chatId: 'chat-fresh-world', index: 2, messageId: 'message-2', swipeId: 0,
        generationSerial: 1, generationId: 'generation-1', generationType: 'normal',
        scopeDigest: 'scope-fresh-world', contentFingerprint: 'content-1',
    };
    const oldReply = {
        mes: 'old accepted reply', is_user: false, is_system: false, swipe_id: 0,
        extra: {
            mvu_auto_doctor_source_id: previous.messageId,
            mvu_auto_doctor_generation_id: previous.generationId,
            mvu_auto_doctor_generation_serial: previous.generationSerial,
            mvu_auto_doctor_generation_type: previous.generationType,
        },
    };
    const context = {
        chatId: previous.chatId,
        chat: [
            { mes: 'opening', is_user: false, is_system: false },
            { mes: 'player one', is_user: true, is_system: false },
            oldReply,
            { mes: 'player two', is_user: true, is_system: false },
        ],
    };
    const persistedWorld = persistedWorldPacket({
        maxVisible: 0,
        visibleThreadIds: [],
        producerTarget: previous,
    });
    const packet = persistedWorld.packet;
    const evolvedLedger = { actors: [{ id: 'NPC-P1-NEW', profileStatus: 'ready' }] };
    const namespace = { actorLedger: evolvedLedger, continuity: persistedWorld.saved };
    let persistedOptions = null;
    const sandbox = {
        currentSwipeInfo: () => null,
        fingerprint: (value) => `fp:${String(value)}`,
        actorSovereigntyScopeDigest: (scope) => scope.id,
        frozenIdentityScopeId: () => 'identity-scope',
        normalizeActorLedger: (ledger) => ledger,
        stage3AcceptedTarget: (target) => target,
        stage3AcceptedTargetsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
        captureTarget: (_context, index) => {
            const before = structuredClone(oldReply.extra);
            const identity = sandbox.ensureRuntimeTargetIdentity(
                context, oldReply, index, previous.messageId,
            );
            assert.deepEqual(oldReply.extra, before, 'P4 read must not rewrite the old producer extra');
            return { ...previous, ...identity };
        },
        stage3PersistedPackageDecision: (_continuity, ledger, captured, options) => {
            assert.equal(ledger, evolvedLedger);
            assert.deepEqual(captured, previous);
            persistedOptions = structuredClone(options);
            return options?.allowUnrelatedLedgerEvolution === true
                ? { ok: true, code: 'ok', packet }
                : { ok: false, code: 'ledger_digest_mismatch', packet: null };
        },
        getContext: () => context,
        currentActorSovereigntyScope: () => ({ id: previous.scopeDigest }),
        readChatNamespace: () => namespace,
        deepClone: (value) => structuredClone(value),
        activeGenerationSession: null,
        nextTurnLeaseMatches: (lease, session) => (
            lease?.state === 'reserved'
            && lease.generationId === session.id
            && lease.generationSerial === session.serial
        ),
        writeChatNamespace: async (next, _chatId, options) => {
            if (!options.precondition()) return false;
            namespace.continuity = structuredClone(next.continuity);
            return options.contentValidator(namespace);
        },
        Date: { now: () => 3 },
        NEXT_TURN_CONSUMER_INJECTION_NAME: 'mvu-auto-doctor-next-turn-consumer',
        DOCTOR_NEXT_TURN_PROVIDER_ID: 'doctor-extension-prompt',
    };
    vm.runInNewContext(
        `${source.slice(identityStart, identityEnd)}\n${source.slice(verifyStart, verifyEnd)}`
        + `\n${source.slice(leaseStart, leaseEnd)}`
        + '\nthis.ensureRuntimeTargetIdentity = ensureRuntimeTargetIdentity;'
        + 'this.verifiedNextTurnWorldPackage = verifiedNextTurnWorldPackage;'
        + 'this.writeNextTurnConsumerLease = writeNextTurnConsumerLease;',
        sandbox,
    );
    const verified = sandbox.verifiedNextTurnWorldPackage(
        context, namespace, packet, { id: previous.scopeDigest },
    );
    assert.ok(verified);
    assert.deepEqual(persistedOptions, { allowUnrelatedLedgerEvolution: true });
    const projection = buildContinuityConsumerPayload(namespace.continuity, verified.packet);
    assert.equal(projection.ok, true);
    assert.ok(projection.text);

    const session = {
        id: 'generation-2', serial: 2, type: 'normal', chatId: previous.chatId,
        frozenScopeDigest: previous.scopeDigest, start: { index: 3 },
    };
    sandbox.activeGenerationSession = session;
    const lease = await sandbox.writeNextTurnConsumerLease(
        session,
        previous.scopeDigest,
        { digest: 'payload-digest', text: projection.text },
    );
    assert.equal(lease.ok, true);
    assert.equal(namespace.continuity.nextTurnInjection.consumerLease.state, 'reserved');
    assert.equal(namespace.continuity.nextTurnInjection.consumerLease.generationId, session.id);
    assert.equal(namespace.continuity.nextTurnInjection.consumerLease.generationSerial, session.serial);
});

test('P4 clears exactly the three retired host slots before the sole consumer is placed', async () => {
    const calls = [];
    const clearLegacyNextTurnSlots = await loadClearLegacyNextTurnSlots({
        setExtensionPrompt(...args) {
            calls.push(args);
        },
    });
    assert.equal(clearLegacyNextTurnSlots(), true);
    assert.deepEqual(
        calls.map(([key]) => key),
        [
            'mvu-auto-doctor-continuity',
            'mvu-auto-doctor-social-contract',
            'mvu-auto-doctor-serendipity-license',
        ],
    );
    for (const [, content, position, depth, isChatDisabled, order] of calls) {
        assert.equal(content, '');
        assert.equal(position, 1);
        assert.equal(depth, 1);
        assert.equal(isChatDisabled, false);
        assert.equal(order, 0);
    }
});

test('P4 cleanup failure fails closed and never restarts a producer or legacy bridge', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function precomposeNextTurnConsumer(session)');
    const end = source.indexOf('async function commitNextTurnConsumer(session, envelope)', start);
    const consumer = source.slice(start, end);
    assert.match(
        consumer,
        /packet\?\.consumerLease\?\.state === 'cleanup_failed'[\s\S]*?lastInjectionInspection\.status = 'blocked';[\s\S]*?return;/u,
    );
    assert.match(
        consumer,
        /packet\.consumerLease\?\.state === 'reserved'[\s\S]*?convergePersistedStaleNextTurnWorldLease\([\s\S]*?packet = null;[\s\S]*?prepareNpcDesignTicketBatch\(\)/u,
    );
    assert.match(
        consumer,
        /refreshedPacket\?\.consumerLease\?\.state === 'reserved'[\s\S]*?convergePersistedStaleNextTurnWorldLease\([\s\S]*?packet = null;[\s\S]*?worldText = ''[\s\S]*?immutableNextTurnConsumerPayload/u,
    );
    assert.doesNotMatch(consumer, /releaseStaleNextTurnWorldLease/u);
    assert.match(
        consumer,
        /refreshedPacket\?\.consumerLease\?\.state === 'cleanup_failed'[\s\S]*?lastInjectionInspection\.status = 'blocked';[\s\S]*?return;/u,
    );
    assert.doesNotMatch(
        consumer,
        /collectActorShardProposals|planActorAttemptRecovery|runSovereigntyAgentPool|applyContinuityInjection/u,
    );
});

test('P3 keeps due actors outside optional budgets through local recall and one Advance, while P4 stays a single consumer', async () => {
    const [ledger, source] = await Promise.all([
        readFile(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
    ]);
    assert.match(ledger, /const mustInclude = scored\.filter\(isMustInclude\)/u);
    assert.match(ledger, /const optional = scored\.filter\(\(item\) => !isMustInclude\(item\)\)\.slice\(0, coreLimit\)/u);
    assert.match(
        source,
        /scheduledActors = actorSchedule\.selected;[\s\S]*?scheduledActorIds = scheduledActors\.map\(\(actor\) => actor\.actorId\)\.filter\(Boolean\)/u,
    );
    assert.match(source, /stage3LocalRecallPacket\(\{[\s\S]*?await generateWorldContinuitySingleBatch/u);
    assert.match(source, /stage3PersistPreparedActorAttemptsOnFreshLedger[\s\S]*?stage3PreparedWorldCheckpoint[\s\S]*?await persistActorActionAttemptsForTurn/u);
    assert.doesNotMatch(source, /collectActorShardProposals|runActorShardProposalBatch/u);
    assert.match(source, /precomposeNextTurnConsumer/u);
});
