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

test('P4 production uses one actor proposal batch, no per-actor or repair model path, before P3 world batch', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function collectActorShardProposals');
    const end = source.indexOf('\nasync function persistActorRegistryForTurn', start);
    assert.ok(start >= 0 && end > start);
    const collect = source.slice(start, end);
    assert.match(collect, /runActorShardProposalBatch\s*\(/u);
    assert.match(collect, /buildActorShardBatchMessages\s*\(/u);
    assert.match(collect, /callBatch:\s*async/u);
    assert.match(collect, /failover:\s*false/u);
    assert.match(collect, /maxFailovers:\s*0/u);
    assert.doesNotMatch(collect, /runActorShardBatch\s*\(/u);
    assert.doesNotMatch(collect, /callWorker\s*:/u);
    assert.doesNotMatch(collect, /repairWorker\s*:/u);
    assert.doesNotMatch(collect, /buildActorShardRepairMessages/u);
    assert.match(collect, /status:\s*result\.status/u);
    assert.match(collect, /const current = \(\) =>/u);
    assert.match(
        collect,
        /actorActionTargetMatches\(\s*target,\s*actorShardLeaseFingerprint\(fresh\),?\s*\)/u,
    );
    assert.doesNotMatch(collect, /TaskLeaseManager|actorShardLeaseManager|leaseId|branchId/u);
    assert.doesNotMatch(collect, /status:\s*'completed',\s*\n\s*candidates:/u);

    const persist = source.indexOf('await persistActorActionAttemptsForTurn', end);
    const world = source.indexOf('generateWorldContinuitySingleBatch', persist);
    const settle = source.indexOf('settleActorActionCandidates', world);
    assert.ok(persist > end, 'attempt persistence must exist after actor proposals');
    assert.ok(world > persist, 'P3 world batch must start only after attempt persistence/readback');
    assert.ok(settle > world, 'settlement must occur only after the world batch');
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

test('P4 six-actor capacity is wired through selector, scheduler, settings and UI without changing defaults', async () => {
    const [shard, ledger, source] = await Promise.all([
        readFile(new URL('../actor-shard-core.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../index.js', import.meta.url), 'utf8'),
    ]);
    assert.match(shard, /ACTOR_SHARD_MAX_WORKERS\s*=\s*6/u);
    assert.match(ledger, /integer\(maxActors,\s*0,\s*6,\s*2\)/u);
    assert.match(source, /actorShardMaxWorkers:\s*2/u);
    assert.match(source, /actorLedgerMaxActorsPerTurn:\s*2/u);
    assert.match(source, /mvuad-actor-shard-workers[^>]+max="6"/u);
});
