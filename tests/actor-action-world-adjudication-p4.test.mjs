import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

test('P3 uses Recall then one Advance call; no separate actor proposal model or repair path', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const runStart = source.indexOf('async function runContinuityTarget(captured, {');
    const runEnd = source.indexOf('\nfunction sameTargetExceptContent', runStart);
    assert.ok(runStart >= 0 && runEnd > runStart);
    const run = source.slice(runStart, runEnd);
    const recall = run.indexOf('await generateWorldRecallPacket');
    const advance = run.indexOf('await generateWorldContinuitySingleBatch', recall);
    const prepare = run.indexOf('prepareActorActionAttempts', advance);
    const persist = run.indexOf('await persistActorActionAttemptsForTurn', prepare);
    assert.ok(recall >= 0 && advance > recall && prepare > advance && persist > prepare);
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

test('P4 has one strict next-turn consumer: verified world package plus ticket payload, provider or ST fallback', async () => {
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
    const providerAt = consumer.indexOf('selectNextTurnConsumerProvider()', payloadAt);
    const fallbackAt = consumer.indexOf('setNextTurnConsumerFallback(payload.text)', providerAt);
    assert.ok(clearAt >= 0 && verifyAt > clearAt && projectAt > verifyAt);
    assert.ok(ticketAt > projectAt && payloadAt > ticketAt && providerAt > payloadAt);
    assert.ok(fallbackAt > providerAt);
    assert.match(consumer, /receipt\?\.placementConfirmed !== true[\s\S]*?receipt\?\.consumerPayloadDigest !== payload\.digest/u);
    assert.match(consumer, /providerId: 'sillytavern-fallback'/u);
    assert.doesNotMatch(
        consumer,
        /runSovereigntyAgentPool|CONTINUITY_INJECTION_NAME|SOCIAL_INJECTION_NAME|SERENDIPITY_INJECTION_NAME/u,
    );

    const providerRegistration = source.slice(
        source.indexOf('function registerNextTurnConsumerProvider(provider)'),
        source.indexOf('function nextTurnConsumerProviderView()', source.indexOf('function registerNextTurnConsumerProvider(provider)')),
    );
    assert.match(providerRegistration, /typeof provider\?\.precompose !== 'function'/u);
    assert.match(providerRegistration, /typeof provider\?\.cleanup !== 'function'/u);
    assert.doesNotMatch(providerRegistration, /window\.|Stitches|TavernDB|combined/u);
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
        /refreshedPacket\?\.consumerLease\?\.state === 'reserved'[\s\S]*?convergePersistedStaleNextTurnWorldLease\([\s\S]*?packet = null;[\s\S]*?worldText = ''[\s\S]*?selected = \{ provider: null, conflict: false \}/u,
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

test('P3 keeps due actors outside optional budgets through Recall and Advance, while P4 stays a single consumer', async () => {
    const [ledger, source] = await Promise.all([
        readFile(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
    ]);
    assert.match(ledger, /const mustInclude = scored\.filter\(isMustInclude\)/u);
    assert.match(ledger, /const optional = scored\.filter\(\(item\) => !isMustInclude\(item\)\)\.slice\(0, coreLimit\)/u);
    assert.match(source, /scheduledActorIds = actorSchedule\.selected\.map\(\(actor\) => actor\.actorId\)/u);
    assert.match(source, /await generateWorldRecallPacket[\s\S]*?await generateWorldContinuitySingleBatch/u);
    assert.match(source, /await persistActorActionAttemptsForTurn[\s\S]*?stage3Phase: 'world_candidate_prepared'/u);
    assert.doesNotMatch(source, /collectActorShardProposals|runActorShardProposalBatch/u);
    assert.match(source, /precomposeNextTurnConsumer/u);
});
