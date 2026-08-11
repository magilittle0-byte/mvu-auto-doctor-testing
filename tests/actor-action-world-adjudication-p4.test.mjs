import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
    assert.match(collect, /actorShardLeaseManager\.fail\(leaseId,\s*result\.status\)/u);
    assert.doesNotMatch(collect, /status:\s*'completed',\s*\n\s*candidates:/u);

    const persist = source.indexOf('await persistActorActionAttemptsForTurn', end);
    const world = source.indexOf('generateWorldContinuitySingleBatch', persist);
    const settle = source.indexOf('settleActorActionCandidates', world);
    assert.ok(persist > end, 'attempt persistence must exist after actor proposals');
    assert.ok(world > persist, 'P3 world batch must start only after attempt persistence/readback');
    assert.ok(settle > world, 'settlement must occur only after the world batch');
});

test('P4 semantic-zero cannot be published as a successful pool candidate or committed actor task', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const poolStart = source.indexOf('const sovereigntyAgentPool = await runSovereigntyAgentPool');
    const poolEnd = source.indexOf('const adjudicatedBlackboard', poolStart);
    const pool = source.slice(poolStart, poolEnd);
    assert.match(pool, /actorBatch\.status === 'semantic-failed'/u);
    assert.match(pool, /error\.code\s*=\s*actorBatch\.status === 'semantic-failed'\s*\?\s*'ACTOR_BATCH_SEMANTIC_FAILED'/u);
    assert.match(pool, /throw error/u);

    const downstreamStart = source.indexOf('let actorShardStatus =', poolEnd);
    const downstreamEnd = source.indexOf('let worldLaneSchedule =', downstreamStart);
    const downstream = source.slice(downstreamStart, downstreamEnd);
    assert.match(downstream, /\['semantic-failed', 'failed'\]\.includes\(latestActorShardDiagnostics\.status\)/u);
    assert.match(downstream, /semanticActions:\s*0/u);
    assert.match(downstream, /actorTechnicalFailure\s*\|\|=/u);

    const completionStart = source.indexOf('async function completeSovereigntyCycle');
    const completionEnd = source.indexOf('\nfunction ', completionStart + 20);
    const completion = source.slice(completionStart, completionEnd > completionStart
        ? completionEnd
        : source.length);
    assert.match(completion, /success:\s*actorSubtasksSucceeded\s*&&\s*!actorFailure\s*&&\s*persistenceSuccess/u);
    assert.match(completion, /failureCode:\s*persistenceSuccess\s*\?\s*actorFailure\s*\|\|\s*'actor\.technical_failure'/u);
});

test('P4 exact-target recovery schedules zero actor proposal calls and reuses pending attempts', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const recovery = source.indexOf('const recoveredActorAttemptBatch = planActorAttemptRecovery');
    const pool = source.indexOf('const sovereigntyAgentPool = await runSovereigntyAgentPool', recovery);
    const scheduling = source.slice(recovery, pool + 1200);
    assert.match(scheduling, /recoveredActorAttemptBatch\.shouldRunActorWorker\s*\?\s*\[\{/u);
    assert.match(scheduling, /agentType:\s*'actor'/u);

    const recovered = source.indexOf('const pooledActorShardResult = recoveredActorAttemptBatch.attempts.length', pool);
    const recoveredEnd = source.indexOf('const prefetchedWorldOutput', recovered);
    const recoveredBranch = source.slice(recovered, recoveredEnd);
    assert.match(recoveredBranch, /status:\s*'resumed'/u);
    assert.match(recoveredBranch, /recoveredAttempts:\s*recoveredActorAttemptBatch\.attempts/u);
    assert.match(recoveredBranch, /recoveredCandidates:\s*recoveredActorAttemptBatch\.candidates/u);
    assert.doesNotMatch(recoveredBranch, /collectActorShardProposals/u);
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
