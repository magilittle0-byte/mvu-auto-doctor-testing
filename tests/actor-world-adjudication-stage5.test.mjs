import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    actorActionTargetMatches,
    actorRefsMatch,
    containsForgedPlayerSettlement,
    createActorActionAttempt,
    independentWorldProcessEvent,
    normalizeActorActionTarget,
    validateWorldAdjudication,
    validateWorldAdjudicationBatch,
} from '../actor-authority-core.mjs';
import {
    actorActionAttemptsMatchLedger,
    actorActionSettlementsMatchLedger,
    actorProfileCommitMatchesLedger,
    emptyActorLedger,
    mergeActorWorldEventsIntoContinuity,
    normalizeActorLedger,
    pendingActorActionAttempts,
    planActorAttemptRecovery,
    prepareActorActionAttempts,
    recordActorActionAttempts,
    scheduleActorTurns,
    settleActorActionCandidates,
} from '../actor-ledger-core.mjs';
import { actorIdFromName } from '../actor-ref-core.mjs';
import { actorProfileBaselineDigest } from '../actor-profile-v6-core.mjs';
import { selectActorShardCandidates } from '../actor-shard-core.mjs';
import {
    claimNextSovereigntyTask,
    commitSovereigntyTask,
    emptySovereigntyRuntime,
    materializeSovereigntyActorTasks,
    observeSovereigntyTurn,
    restoreSovereigntyCheckpoint,
} from '../sovereignty-runtime-core.mjs';
import { makeActionReadyActor } from './helpers/actor-action-ready-fixture.mjs';

const CHAT_ID = 'stage5-actor-world';

function target(overrides = {}) {
    return {
        chatId: CHAT_ID,
        logicalIndex: 7,
        index: 7,
        messageId: 'message-7',
        swipeId: 0,
        generation: 11,
        generationSerial: 11,
        generationId: 'generation-11',
        generationType: 'normal',
        identityScopeId: `${CHAT_ID}|character:stage5`,
        contentHash: 'content-hash-11',
        contentFingerprint: 'content-hash-11',
        hash: 'content-hash-11',
        scopeDigest: 'stage5-actor-world-scope',
        ...overrides,
    };
}

function rawActor(name = 'Ada', overrides = {}) {
    const id = actorIdFromName(name);
    return {
        id,
        name,
        tier: 'secondary',
        status: 'active',
        identity: {
            role: 'investigator',
            aliases: [`${name} Alias`],
            traits: ['careful'],
            desires: ['verify the route'],
            boundaries: ['does not decide for the player'],
        },
        longTermGoals: ['keep the route usable'],
        currentGoals: ['verify one warehouse record'],
        constraints: [],
        stimuli: [],
        stateFacts: [],
        knowledge: [{
            id: 'K1',
            claim: 'the warehouse ledger is available at North Port',
            kind: 'observed',
            confidence: 1,
            learnedTurn: 1,
            sourceRef: null,
            propagation: [],
        }],
        location: { name: 'North Port', sinceTurn: 1, evidence: ['E1'] },
        resources: [{ id: 'coin', name: 'coin', amount: 5, unit: 'piece', evidence: ['E1'] }],
        capabilities: ['negotiate'],
        relationships: [],
        commitments: [],
        hidden: { emotionalInertia: [], innerConflicts: [], privateIntentions: [] },
        plan: {
            summary: 'verify one warehouse record',
            steps: ['read the record'],
            status: 'active',
            priority: 'normal',
            nextWindow: 'this turn',
            obstacles: [],
            costs: [],
            alternatives: [],
        },
        lastAction: null,
        actionHistory: [],
        nextActionTurn: 1,
        deadlineTurn: 20,
        lastSemanticTurn: 0,
        semanticProgressCount: 0,
        lastAttemptTurn: 0,
        consecutiveActionFailures: 0,
        initiative: 2,
        opportunity: 2,
        silenceTurns: 0,
        attentionScore: 0,
        evidence: ['E1'],
        version: 1,
        createdTurn: 1,
        updatedTurn: 1,
        settledActionCount: 0,
        ...overrides,
    };
}

function readyActor(name = 'Ada', overrides = {}) {
    return makeActionReadyActor(rawActor(name, overrides), {
        turn: 1,
        sourceRef: target(),
    });
}

function actorRefOf(actor) {
    return {
        kind: 'actor_ref',
        actorId: actor.id,
        displayName: actor.name,
        aliases: actor.identity.aliases,
    };
}

function ledgerFor(actor, {
    registryState = 'registered',
    quarantine = false,
} = {}) {
    const value = {
        ...emptyActorLedger(CHAT_ID),
        turn: 7,
        actors: [actor],
        actorRegistry: {
            version: 1,
            chatId: CHAT_ID,
            identityScopeId: target().identityScopeId,
            scopeDigest: target().scopeDigest,
            entries: [{
                state: registryState,
                actorRef: actorRefOf(actor),
                origin: 'profile_insert_candidate',
                identityKeys: [actor.name.toLocaleLowerCase()],
                lifecycle: { status: actor.status, inactiveReason: '' },
                lineage: {},
                sourceRefs: [target()],
                registeredTurn: 1,
                updatedTurn: 1,
            }],
            updatedAt: 1,
        },
        identityQuarantine: quarantine ? [{
            id: actor.id,
            reason: 'identity_collision',
            actor: { ...actor, name: actor.id },
            quarantinedTurn: 7,
            evidence: ['identity collision'],
        }] : [],
        migrations: {
            ...emptyActorLedger(CHAT_ID).migrations,
            actorRegistryV1: true,
        },
    };
    return normalizeActorLedger(value, {
        chatId: CHAT_ID,
        identityScopeId: target().identityScopeId,
        scopeDigest: target().scopeDigest,
        allowScopeDigestFill: true,
    });
}

function candidateFor(actor, overrides = {}) {
    return {
        actorId: actor.id,
        actorName: actor.name,
        actorRef: actorRefOf(actor),
        currentGoal: 'verify one warehouse record',
        intent: 'execute',
        time: { turn: 7, window: 'this bounded action window' },
        location: { from: 'North Port', to: 'North Port', travelTurns: 0 },
        action: 'Ada checks one bounded warehouse record.',
        actionWindow: 'this bounded action window',
        expectedCost: 'one coin and focused attention',
        expectedDuration: 'one turn',
        expectedRisk: 'the inquiry may be noticed',
        observableConsequence: 'one named record is confirmed or rejected',
        knowledgeRefs: ['K1'],
        knowledgeBasis: ['the warehouse ledger is available at North Port'],
        resourceCosts: [{ resourceId: 'coin', amount: 1 }],
        capabilityUsed: 'negotiate',
        stateChanges: [{ kind: 'knowledge', summary: 'one warehouse record gains a verified status' }],
        interactionTargets: [],
        evidence: ['E1', 'K1'],
        sourceThreads: ['THREAD-WAREHOUSE'],
        causalChain: ['E1'],
        waitCondition: '',
        ...overrides,
    };
}

function decisionFor(attempt, status = 'success', overrides = {}) {
    const changes = ['success', 'partial'].includes(status)
        ? attempt.desiredEffects
        : [];
    return {
        attemptId: attempt.id,
        actorRef: structuredClone(attempt.actorRef),
        target: structuredClone(attempt.target),
        status,
        risk: status === 'failure' ? 'the route remains unavailable' : 'the inquiry is noticed',
        costs: status === 'success' ? ['one coin'] : ['one bounded action window'],
        actualResourceCosts: ['success', 'partial'].includes(status)
            ? structuredClone(attempt.resourceCosts)
            : [],
        durationTurns: ['success', 'partial'].includes(status) ? 1 : 0,
        visibility: 'private',
        observerActorIds: [],
        publicSummary: '',
        privateSummary: 'the adjudicated result remains private to the actor',
        resultSummary: `the world returns a ${status} result`,
        observableConsequence: `a bounded ${status} trace exists at the warehouse`,
        revealPath: 'the warehouse record can be inspected in a later relevant scene',
        appliedStateChanges: changes,
        ...overrides,
    };
}

function prepareAndRecord(ledger, actor, candidate = candidateFor(actor)) {
    const prepared = prepareActorActionAttempts(ledger, [candidate], {
        turn: 7,
        sourceRef: target(),
        target: target(),
        playerNames: ['Player'],
    });
    const recorded = recordActorActionAttempts(
        prepared.ledger,
        prepared.attempts,
        { target: target() },
    );
    return { prepared, recorded };
}

function settleRecorded(ledger, actor, status = 'success', decisionOverrides = {}) {
    const { prepared, recorded } = prepareAndRecord(ledger, actor);
    assert.equal(prepared.attempts.length, 1);
    assert.equal(recorded.recorded.length, 1);
    const restarted = normalizeActorLedger(structuredClone(recorded.ledger), { chatId: CHAT_ID });
    const recoveryPlan = planActorAttemptRecovery(restarted, { target: target() });
    assert.equal(recoveryPlan.mode, 'resume');
    assert.equal(recoveryPlan.shouldRunActorWorker, false);
    assert.equal(recoveryPlan.attempts[0].id, recorded.recorded[0].id);
    const { attemptId: recoveredAttemptId, ...recoveredCandidate } = recoveryPlan.candidates[0];
    assert.equal(recoveredAttemptId, recorded.recorded[0].id);
    assert.deepEqual(recoveredCandidate, recorded.recorded[0].candidateSnapshot);
    let actorWorkerCalls = 0;
    if (recoveryPlan.shouldRunActorWorker) actorWorkerCalls += 1;
    assert.equal(actorWorkerCalls, 0);
    const recovered = recoveryPlan;
    assert.equal(recovered.attempts.length, 1);
    const attempt = recovered.attempts[0];
    const settled = settleActorActionCandidates(restarted, recovered.candidates, {
        turn: 7,
        attempts: recovered.attempts,
        target: target(),
        worldAdjudications: [decisionFor(attempt, status, decisionOverrides)],
    });
    return { prepared, recorded, restarted, recovered, attempt, settled };
}

test('exact-target recovery materializes and settles recovered actor A, never newly scheduled actor B', () => {
    const actorA = readyActor('Ada');
    const actorB = readyActor('Borin');
    const base = ledgerFor(actorA);
    const ledger = normalizeActorLedger({
        ...base,
        actors: [...base.actors, actorB],
        actorRegistry: {
            ...base.actorRegistry,
            registered: {
                ...base.actorRegistry.registered,
                [actorB.name]: {
                    actorRef: actorRefOf(actorB),
                    origin: 'profile_insert_candidate',
                    identityKeys: [actorB.name.toLocaleLowerCase()],
                    lifecycle: { status: actorB.status, inactiveReason: '' },
                    lineage: {},
                    sourceRefs: [target()],
                    registeredTurn: 1,
                    updatedTurn: 1,
                },
            },
        },
    }, { chatId: CHAT_ID });
    const { recorded } = prepareAndRecord(ledger, actorA);
    assert.equal(recorded.recorded.length, 1);

    let actorWorkerCalls = 0;
    const recoveryPlan = planActorAttemptRecovery(recorded.ledger, {
        target: target(),
        scheduledActorIds: [actorB.id],
    });
    if (recoveryPlan.shouldRunActorWorker) actorWorkerCalls += 1;
    assert.equal(recoveryPlan.mode, 'resume');
    assert.equal(actorWorkerCalls, 0);
    assert.deepEqual(recoveryPlan.actorIds, [actorA.id]);
    assert.deepEqual(recoveryPlan.recoveredActorIds, [actorA.id]);
    assert.deepEqual(recoveryPlan.scheduledActorIds, [actorB.id]);
    assert.equal(recoveryPlan.attempts[0].id, recorded.recorded[0].id);

    let runtime = observeSovereigntyTurn(emptySovereigntyRuntime(CHAT_ID), {
        sourceRef: target(),
        modules: ['actor'],
        now: 100,
    }).runtime;
    const parent = claimNextSovereigntyTask(runtime, {
        module: 'actor',
        currentTurn: 1,
        now: 110,
    });
    const materialized = materializeSovereigntyActorTasks(parent.runtime, {
        parentTaskId: parent.task.id,
        actorIds: recoveryPlan.actorIds,
        now: 120,
    });
    assert.deepEqual(materialized.tasks.map((task) => task.metadata.actorId), [actorA.id]);
    assert.equal(
        materialized.runtime.backlog.some((task) => task.metadata?.actorId === actorB.id),
        false,
    );
    const taskA = materialized.tasks[0];
    runtime = commitSovereigntyTask(materialized.runtime, {
        taskId: taskA.id,
        claimToken: taskA.claimToken,
        payload: {
            actorId: actorA.id,
            attemptId: recoveryPlan.attempts[0].id,
            settled: true,
        },
        commitRef: recoveryPlan.attempts[0].id,
        now: 130,
    }).runtime;
    const persistedTaskA = runtime.backlog.find((task) => task.id === taskA.id);
    assert.equal(persistedTaskA.status, 'committed');
    const checkpoint = runtime.checkpoints.find((entry) => entry.taskId === taskA.id);
    const restored = restoreSovereigntyCheckpoint(runtime, {
        checkpointId: checkpoint.id,
        now: 140,
    });
    assert.equal(restored.restored, true);
    assert.equal(restored.payload.attemptId, recorded.recorded[0].id);
    assert.equal(runtime.technicalReceipts.some((receipt) => (
        receipt.code === 'actor.output_missing'
        || receipt.taskId === actorB.id
    )), false);
});

test('schedule, select, prepare and settle all reject legacy, partial, unread, mismatched, unregistered and quarantined profiles', () => {
    const base = readyActor();
    const variants = {
        legacy: (() => {
            const actor = structuredClone(base);
            actor.profileV6.baselineCommit = {
                schemaVersion: actor.profileV6.version,
                commitId: '',
                actorRef: { actorId: actor.id, name: actor.name },
                digest: '',
                sourceRef: null,
                committedTurn: 1,
                readbackVerified: false,
                status: 'legacy_persisted',
            };
            actor.profileV6.preparedForAction = true;
            return { actor, options: {} };
        })(),
        partial: (() => {
            const actor = structuredClone(base);
            actor.profileV6.preparedForAction = false;
            actor.profileV6.coverage = 99;
            return { actor, options: {} };
        })(),
        unread: (() => {
            const actor = structuredClone(base);
            actor.profileV6.baselineCommit.readbackVerified = false;
            return { actor, options: {} };
        })(),
        digest_mismatch: (() => {
            const actor = structuredClone(base);
            actor.profileV6.baselineCommit.digest = 'wrong-digest';
            return { actor, options: {} };
        })(),
        unregistered: { actor: structuredClone(base), options: { registryState: 'retired' } },
        quarantined: { actor: structuredClone(base), options: { quarantine: true } },
    };

    for (const [label, variant] of Object.entries(variants)) {
        const ledger = ledgerFor(variant.actor, variant.options);
        assert.equal(scheduleActorTurns(ledger, { turn: 7, maxActors: 1 }).selected.length, 0, label);
        assert.equal(selectActorShardCandidates({
            continuity: { threads: [] },
            actorLedger: ledger,
            schedule: { selected: [{ actorId: variant.actor.id, score: 99 }] },
            maxWorkers: 1,
        }).length, 0, label);
        const prepared = prepareActorActionAttempts(ledger, [candidateFor(variant.actor)], {
            turn: 7,
            sourceRef: target(),
            target: target(),
        });
        assert.equal(prepared.attempts.length, 0, label);
        assert.equal(prepared.rejected[0]?.worldAdjudicated, false, label);

        const forgedAttempt = createActorActionAttempt(candidateFor(variant.actor), {
            actor: variant.actor,
            actorRef: actorRefOf(variant.actor),
            turn: 7,
            sourceRef: target(),
            target: target(),
        });
        const rejectedSettlement = settleActorActionCandidates(
            ledger,
            [{ ...candidateFor(variant.actor), attemptId: forgedAttempt.id }],
            {
                turn: 7,
                attempts: [forgedAttempt],
                target: target(),
                worldAdjudications: [decisionFor(forgedAttempt)],
            },
        );
        assert.equal(rejectedSettlement.accepted.length, 0, label);
        assert.equal(rejectedSettlement.rejected[0]?.worldAdjudicated, false, label);
    }

    const formalLedger = ledgerFor(base);
    assert.equal(scheduleActorTurns(formalLedger, { turn: 7, maxActors: 1 }).selected.length, 1);
    assert.equal(selectActorShardCandidates({
        continuity: { threads: [] },
        actorLedger: formalLedger,
        schedule: { selected: [{ actorId: base.id, score: 99 }] },
        maxWorkers: 1,
    }).length, 1);
    assert.equal(settleRecorded(formalLedger, base).settled.accepted.length, 1);
});

test('attempt is a complete stable proposal and persistence does not apply its desired outcome', () => {
    const actor = readyActor();
    const ledger = ledgerFor(actor);
    const beforeActor = structuredClone(ledger.actors[0]);
    const { prepared, recorded } = prepareAndRecord(ledger, actor);
    const attempt = prepared.attempts[0];
    assert.ok(actorRefsMatch(attempt.actorRef, actorRefOf(actor)));
    assert.ok(actorActionTargetMatches(attempt.target, target()));
    assert.deepEqual(Object.keys(attempt.target).sort(), [
        'chatId', 'compatibilityOnly', 'contentHash', 'generation',
        'generationId', 'generationType', 'hash', 'index', 'logicalIndex', 'messageId',
        'scopeDigest', 'swipeId',
    ].sort());
    assert.equal(attempt.expectedCost, 'one coin and focused attention');
    assert.equal(attempt.expectedDuration, 'one turn');
    assert.equal(attempt.expectedRisk, 'the inquiry may be noticed');
    assert.equal(attempt.expectedObservableConsequence, 'one named record is confirmed or rejected');
    assert.deepEqual(attempt.knowledgeRefs, ['K1']);
    assert.equal(attempt.knownFacts[0].id, 'K1');
    assert.equal(attempt.resourceBasis[0].availableAmount, 5);
    assert.equal(attempt.timeProposal.turn, 7);
    assert.equal(recorded.ledger.actors[0].resources[0].amount, beforeActor.resources[0].amount);
    assert.deepEqual(recorded.ledger.actors[0].location, beforeActor.location);
    assert.equal(recorded.ledger.actionAttempts.length, 1);
    assert.equal(Object.hasOwn(recorded.ledger.actionReceipts[0], 'actionAttempt'), false);
    assert.equal(recorded.ledger.actionReceipts[0].worldAdjudicated, false);
    assert.equal(actorActionAttemptsMatchLedger(recorded.ledger, {
        chatId: CHAT_ID,
        target: target(),
        attempts: recorded.recorded,
    }).ok, true);
});

test('success, partial, failure, delayed and blocked outcomes retain actual cost, time, risk and observability', () => {
    const expected = new Map([
        ['success', 'settled'],
        ['partial', 'partial'],
        ['failure', 'rejected'],
        ['delayed', 'held'],
        ['blocked', 'blocked'],
    ]);
    for (const [decision, status] of expected) {
        const actor = readyActor(`Actor ${decision}`);
        const ledger = ledgerFor(actor);
        const { settled } = settleRecorded(ledger, actor, decision);
        assert.equal(settled.pendingWorld.length, 0, decision);
        assert.equal(settled.results[0].status, status, decision);
        assert.equal(settled.results[0].worldAdjudicated, true, decision);
        assert.ok(settled.results[0].risk, decision);
        assert.ok(Array.isArray(settled.results[0].costs), decision);
        assert.ok(Number.isFinite(settled.results[0].durationTurns), decision);
        assert.ok(settled.results[0].observableConsequence, decision);
        assert.equal(
            settled.ledger.actors[0].resources[0].amount,
            ['success', 'partial'].includes(decision) ? 4 : 5,
            decision,
        );
        if (['failure', 'delayed', 'blocked'].includes(decision)) {
            assert.equal(settled.ledger.actors[0].stateFacts.length, 0, decision);
            assert.equal(settled.ledger.actors[0].location.name, 'North Port', decision);
            assert.equal(
                settled.ledger.actors[0].plan.summary,
                'verify one warehouse record',
                decision,
            );
        }
    }
});

test('location, resources, knowledge and capability are local admission constraints, not world decisions', () => {
    const actor = readyActor();
    const ledger = ledgerFor(actor);
    const invalid = [
        candidateFor(actor, {
            location: { from: 'Elsewhere', to: 'North Port', travelTurns: 0 },
        }),
        candidateFor(actor, { resourceCosts: [{ resourceId: 'coin', amount: 99 }] }),
        candidateFor(actor, { knowledgeRefs: ['PRIVATE-UNKNOWN'] }),
        candidateFor(actor, { capabilityUsed: 'teleport' }),
    ];
    const prepared = prepareActorActionAttempts(ledger, invalid, {
        turn: 7,
        sourceRef: target(),
        target: target(),
    });
    assert.equal(prepared.attempts.length, 0);
    assert.equal(prepared.rejected.length, 4);
    assert.ok(prepared.rejected.every((entry) => entry.worldAdjudicated === false));
    assert.ok(prepared.rejected.some((entry) => entry.reasons.includes('location-or-travel-invalid')));
    assert.ok(prepared.rejected.some((entry) => entry.reasons.includes('resource-insufficient')));
    assert.ok(prepared.rejected.some((entry) => entry.reasons.includes('knowledge-out-of-bounds')));
    assert.ok(prepared.rejected.some((entry) => entry.reasons.includes('capability-out-of-bounds')));
});

test('offscreen private results stay undisclosed while public results expose only observable summaries', () => {
    const privateActor = readyActor('Private Actor');
    const privateRun = settleRecorded(ledgerFor(privateActor), privateActor, 'success');
    assert.equal(privateRun.settled.results[0].visibility, 'private');
    assert.equal(privateRun.settled.results[0].disclosure, 'pending');
    assert.equal(privateRun.settled.worldEvents[0].observableConsequence, '');

    const publicActor = readyActor('Public Actor');
    const ledger = ledgerFor(publicActor);
    const publicCandidate = candidateFor(publicActor, { public: true });
    const { prepared, recorded } = prepareAndRecord(ledger, publicActor, publicCandidate);
    const recovered = pendingActorActionAttempts(recorded.ledger, { target: target() });
    const attempt = recovered.attempts[0];
    const settled = settleActorActionCandidates(recorded.ledger, recovered.candidates, {
        turn: 7,
        attempts: recovered.attempts,
        target: target(),
        worldAdjudications: [decisionFor(attempt, 'success', {
            visibility: 'public',
            publicSummary: 'a public warehouse notice is posted',
        })],
    });
    assert.equal(prepared.attempts[0].route, 'background_public');
    assert.equal(settled.results[0].disclosure, 'disclosed');
    assert.equal(settled.worldEvents[0].observableConsequence, 'a public warehouse notice is posted');
    assert.doesNotMatch(settled.worldEvents[0].observableConsequence, /private to the actor/u);
});

test('player-targeted attempts never settle player action, consent, feeling or resource payment', () => {
    const actor = readyActor();
    const ledger = ledgerFor(actor);
    const candidate = candidateFor(actor, {
        action: 'Ada asks Player to enter the warehouse.',
        resourceCosts: [],
        stateChanges: [{ kind: 'plan', summary: 'Ada makes a bounded invitation' }],
    });
    const { recorded } = prepareAndRecord(ledger, actor, candidate);
    const recovered = pendingActorActionAttempts(recorded.ledger, { target: target() });
    const attempt = recovered.attempts[0];
    const forged = decisionFor(attempt, 'success', { playerConsentSettled: true });
    assert.equal(containsForgedPlayerSettlement(forged), true);
    assert.equal(validateWorldAdjudication(forged, attempt).valid, false);

    const settled = settleActorActionCandidates(recorded.ledger, recovered.candidates, {
        turn: 7,
        attempts: recovered.attempts,
        target: target(),
        worldAdjudications: [decisionFor(attempt)],
    });
    assert.equal(settled.results[0].status, 'pending_player');
    assert.deepEqual(settled.results[0].appliedStateChanges, []);
    assert.equal(settled.results[0].playerActionSettled, false);
    assert.equal(settled.results[0].playerConsentSettled, false);
    assert.equal(settled.results[0].playerFeelingSettled, false);
});

test('strict target and full Registry ActorRef ignore legacy branch while failing closed across chat, swipe, generation and hash', () => {
    const actor = readyActor();
    const { recorded } = prepareAndRecord(ledgerFor(actor), actor);
    const attempt = recorded.recorded[0];
    const actorMismatches = [
        { ...attempt.actorRef, kind: 'actor_candidate' },
        { ...attempt.actorRef, displayName: 'Wrong Display' },
        { ...attempt.actorRef, aliases: ['Wrong Alias'] },
    ];
    for (const actorRef of actorMismatches) {
        assert.equal(validateWorldAdjudication(
            decisionFor(attempt, 'success', { actorRef }),
            attempt,
        ).reason, 'world_adjudication_actor_ref_mismatch');
    }
    const targetMismatches = [
        { chatId: 'another-chat' },
        { logicalIndex: 8, index: 8 },
        { messageId: 'another-message' },
        { swipeId: 1 },
        { generation: 12 },
        { generationId: 'generation-12' },
        { generationType: 'swipe' },
        { contentHash: 'another-hash', hash: 'another-hash' },
    ];
    assert.equal(
        actorActionTargetMatches(attempt.target, { ...target(), branchId: 'legacy-branch' }),
        true,
        'legacy branch data is ignored when the canonical target still matches exactly',
    );
    for (const change of targetMismatches) {
        const changed = target(change);
        assert.equal(actorActionTargetMatches(attempt.target, changed), false);
        assert.equal(validateWorldAdjudication(
            decisionFor(attempt, 'success', { target: changed }),
            attempt,
        ).reason, 'world_adjudication_target_mismatch');
        assert.equal(pendingActorActionAttempts(recorded.ledger, { target: changed }).attempts.length, 0);
    }
    for (const missing of ['generationId', 'generationType', 'logicalIndex']) {
        const incomplete = target();
        delete incomplete[missing];
        if (missing === 'logicalIndex') delete incomplete.index;
        assert.equal(normalizeActorActionTarget(incomplete), null, missing);
    }
});

test('two stable actors cannot swap display identity and settlements read back against one journal', () => {
    const ada = readyActor('Ada');
    const bella = readyActor('Bella');
    const combined = normalizeActorLedger({
        ...emptyActorLedger(CHAT_ID),
        turn: 7,
        actors: [ada, bella],
        actorRegistry: {
            version: 1,
            chatId: CHAT_ID,
            identityScopeId: target().identityScopeId,
            scopeDigest: target().scopeDigest,
            characters: {},
            registered: Object.fromEntries([ada, bella].map((actor) => [actor.name, {
                actorRef: actorRefOf(actor),
                origin: 'profile_insert_candidate',
                sourceRefs: [target()],
                registeredTurn: 1,
                updatedTurn: 1,
            }])),
            updatedAt: 1,
        },
        migrations: { ...emptyActorLedger(CHAT_ID).migrations, actorRegistryV1: true },
    }, {
        chatId: CHAT_ID,
        identityScopeId: target().identityScopeId,
        scopeDigest: target().scopeDigest,
        allowScopeDigestFill: true,
    });
    const prepared = prepareActorActionAttempts(combined, [candidateFor(ada), candidateFor(bella, {
        action: 'Bella checks a second warehouse record.',
    })], { turn: 7, sourceRef: target(), target: target() });
    assert.deepEqual(prepared.rejected, [], 'both canonical Registry rows must admit their finalized profiles');
    const recorded = recordActorActionAttempts(prepared.ledger, prepared.attempts, { target: target() });
    assert.equal(recorded.recorded.length, 2);
    assert.notEqual(recorded.recorded[0].actorRef.actorId, recorded.recorded[1].actorRef.actorId);
    const swapped = decisionFor(recorded.recorded[0], 'success', {
        actorRef: recorded.recorded[1].actorRef,
    });
    assert.equal(validateWorldAdjudicationBatch([swapped], [recorded.recorded[0]]).valid, false);

    const recovered = pendingActorActionAttempts(recorded.ledger, { target: target() });
    const decisions = recovered.attempts.map((attempt) => decisionFor(attempt));
    const settled = settleActorActionCandidates(recorded.ledger, recovered.candidates, {
        turn: 7,
        attempts: recovered.attempts,
        target: target(),
        worldAdjudications: decisions,
    });
    assert.equal(settled.results.length, 2);
    assert.equal(actorActionSettlementsMatchLedger(settled.ledger, {
        chatId: CHAT_ID,
        target: target(),
        results: settled.results,
    }).ok, true);
    assert.ok(settled.ledger.actionReceipts.every((receipt) => !Object.hasOwn(receipt, 'actionAttempt')));
});

test('missing, malformed or refused adjudication remains retryable and is not mislabeled as a world decision', () => {
    const actor = readyActor();
    const { recorded } = prepareAndRecord(ledgerFor(actor), actor);
    const restarted = normalizeActorLedger(structuredClone(recorded.ledger), { chatId: CHAT_ID });
    const recovered = pendingActorActionAttempts(restarted, { target: target() });
    const attempt = recovered.attempts[0];
    const malformed = decisionFor(attempt, 'success', { actualResourceCosts: 'one coin' });
    assert.equal(validateWorldAdjudication(malformed, attempt).valid, false);
    const pending = settleActorActionCandidates(restarted, recovered.candidates, {
        turn: 7,
        attempts: recovered.attempts,
        target: target(),
        worldAdjudications: [],
    });
    assert.equal(pending.pendingWorld.length, 1);
    assert.equal(pending.results[0].worldAdjudicated, false);
    assert.equal(pending.results[0].status, 'pending_world');
    const retried = pendingActorActionAttempts(pending.ledger, { target: target() });
    assert.equal(retried.attempts.length, 1);
    assert.equal(retried.attempts[0].id, attempt.id);

    const localRejection = prepareActorActionAttempts(restarted, [candidateFor(actor, {
        resourceCosts: [{ resourceId: 'missing', amount: 1 }],
    })], { turn: 7, sourceRef: target(), target: target() });
    assert.equal(localRejection.rejected[0].phase, 'admission');
    assert.equal(localRejection.rejected[0].worldAdjudicated, false);
});

test('the authoritative journal preserves every pending attempt and matching receipt beyond history capacity', () => {
    const actor = readyActor();
    const ledger = ledgerFor(actor);
    const attempts = [];
    for (let index = 0; index < 245; index += 1) {
        const item = candidateFor(actor, {
            action: index === 0
                ? 'Ada asks Player to inspect bounded warehouse record zero.'
                : `Ada checks bounded warehouse record ${index}.`,
            ...(index === 0 ? {
                resourceCosts: [],
                stateChanges: [{ kind: 'plan', summary: 'Ada makes a bounded invitation' }],
            } : {}),
        });
        attempts.push(createActorActionAttempt(item, {
            actor,
            actorRef: actorRefOf(actor),
            turn: 7,
            sourceRef: target(),
            target: target(),
            playerNames: ['Player'],
        }));
    }
    const recorded = recordActorActionAttempts(ledger, attempts, { target: target() });
    assert.equal(recorded.recorded.length, 245);
    assert.equal(recorded.ledger.actionAttempts.length, 245);
    assert.equal(recorded.ledger.actionReceipts.length, 245);
    assert.equal(recorded.ledger.actionAttemptBacklog.status, 'pending_over_capacity');
    assert.equal(recorded.ledger.actionAttemptBacklog.pendingDropped, 0);
    assert.equal(recorded.ledger.actionAttemptBacklog.receiptOverCapacity, true);
    const firstAttempt = recorded.recorded[0];
    const playerPending = settleActorActionCandidates(recorded.ledger, [{
        ...firstAttempt.candidateSnapshot,
        attemptId: firstAttempt.id,
    }], {
        turn: 7,
        attempts: [firstAttempt],
        target: target(),
        worldAdjudications: [decisionFor(firstAttempt)],
    });
    assert.equal(playerPending.results[0].status, 'pending_player');
    assert.equal(playerPending.ledger.actionAttempts.length, 245);

    const terminalAttempts = [];
    const terminalReceipts = [];
    for (let index = 0; index < 300; index += 1) {
        const terminal = structuredClone(recorded.recorded[1]);
        terminal.id = `ATT-TERMINAL-${String(index).padStart(3, '0')}`;
        terminal.status = index % 2 ? 'settled' : 'rejected';
        terminal.outcome = `RESULT-TERMINAL-${index}`;
        terminalAttempts.push(terminal);
        terminalReceipts.push({
            receiptId: `terminal-receipt-${index}`,
            actionId: terminal.id,
            attemptId: terminal.id,
            actorId: actor.id,
            actorRef: actorRefOf(actor),
            target: target(),
            stage: 'attempted',
            status: 'adjudicated',
            resultId: terminal.outcome,
            worldAdjudicated: true,
        });
    }
    const restarted = normalizeActorLedger({
        ...playerPending.ledger,
        actionAttempts: [...playerPending.ledger.actionAttempts, ...terminalAttempts],
        actionReceipts: [...playerPending.ledger.actionReceipts, ...terminalReceipts],
    }, { chatId: CHAT_ID });
    assert.equal(restarted.actionAttempts.length, 245 + 120);
    assert.equal(restarted.actionAttemptBacklog.pendingCount, 245);
    assert.equal(restarted.actionAttemptBacklog.terminalRetained, 120);
    assert.equal(restarted.actionAttemptBacklog.terminalDropped, 180);
    assert.equal(restarted.actionAttemptBacklog.pendingDropped, 0);
    assert.equal(restarted.actionAttemptBacklog.receiptTerminalDropped, 60);
    const recovered = planActorAttemptRecovery(restarted, { target: target() });
    assert.equal(recovered.attempts.length, 244, 'pending_player is retained but not world-settled again');
    assert.equal(
        restarted.actionAttempts.filter((entry) => entry.status === 'pending_player').length,
        1,
    );
    const pendingIds = new Set(restarted.actionAttempts
        .filter((entry) => ['attempted', 'pending_world', 'pending_player'].includes(entry.status))
        .map((entry) => entry.id));
    const referencedPendingIds = new Set(restarted.actionReceipts
        .filter((entry) => pendingIds.has(entry.attemptId))
        .map((entry) => entry.attemptId));
    assert.deepEqual(referencedPendingIds, pendingIds);

    const nextCandidate = candidateFor(actor, { action: 'Ada checks the next bounded record.' });
    const nextAttempt = createActorActionAttempt(nextCandidate, {
        actor,
        actorRef: actorRefOf(actor),
        turn: 7,
        sourceRef: target(),
        target: target(),
    });
    const appended = recordActorActionAttempts(restarted, [nextAttempt], { target: target() });
    assert.equal(appended.recorded.length, 1);
    assert.equal(appended.ledger.actionAttemptBacklog.pendingDropped, 0);
    assert.equal(appended.ledger.actionAttempts.some((entry) => entry.id === nextAttempt.id), true);

    const settledFailure = settleActorActionCandidates(appended.ledger, [{
        ...nextAttempt.candidateSnapshot,
        attemptId: nextAttempt.id,
    }], {
        turn: 7,
        attempts: [nextAttempt],
        target: target(),
        worldAdjudications: [decisionFor(nextAttempt, 'failure')],
    });
    assert.equal(settledFailure.results[0].status, 'rejected');
    assert.equal(settledFailure.ledger.actionAttemptBacklog.pendingDropped, 0);
    assert.equal(
        settledFailure.ledger.actionAttempts.some((entry) => (
            entry.id === nextAttempt.id && entry.status === 'rejected'
        )),
        true,
        'new terminal result remains available for durable readback',
    );
});

test('legacy embedded attempts migrate to compatibility history without creating a second authoritative source', () => {
    const legacy = emptyActorLedger(CHAT_ID);
    legacy.actionReceipts = [{
        receiptId: 'legacy-receipt',
        actionId: 'legacy-attempt',
        attemptId: 'legacy-attempt',
        stage: 'attempted',
        status: 'pending_world',
        actionAttempt: { kind: 'action_attempt', id: 'legacy-attempt' },
    }];
    const migrated = normalizeActorLedger(legacy, { chatId: CHAT_ID });
    assert.equal(migrated.actionAttempts.length, 1);
    assert.equal(migrated.actionAttempts[0].compatibilityOnly, true);
    assert.equal(migrated.actionAttempts[0].settlementEligible, false);
    assert.equal(migrated.actionAttempts[0].compatibilityReason, 'action_attempt.legacy_embedded_receipt');
    assert.equal(Object.hasOwn(migrated.actionReceipts[0], 'actionAttempt'), false);
    assert.equal(pendingActorActionAttempts(migrated, { target: target() }).attempts.length, 0);
});

test('no new actor action creates no progress while an independent world process cannot rewrite profiles', () => {
    const actor = readyActor();
    const legacyActor = structuredClone(actor);
    legacyActor.profileV6.baselineCommit.status = 'legacy_persisted';
    legacyActor.profileV6.baselineCommit.readbackVerified = false;
    legacyActor.profileV6.baselineCommit.commitId = '';
    legacyActor.profileV6.baselineCommit.digest = '';
    const ledger = ledgerFor(legacyActor);
    const profileBefore = structuredClone(ledger.actors[0]?.profileV6 || legacyActor.profileV6);
    assert.equal(scheduleActorTurns(ledger, { turn: 7, maxActors: 1 }).selected.length, 0);
    assert.equal(prepareActorActionAttempts(ledger, [], {
        turn: 7,
        sourceRef: target(),
        target: target(),
    }).attempts.length, 0);
    const event = independentWorldProcessEvent({
        processId: 'WEATHER-1',
        turn: 7,
        summary: 'rain closes one road without defining any actor identity',
        visibility: 'observed',
    });
    const continuity = mergeActorWorldEventsIntoContinuity({ turn: 7, threads: [] }, [event]);
    assert.equal(continuity.threads.length, 1);
    assert.deepEqual(ledger.actors[0]?.profileV6 || legacyActor.profileV6, profileBefore);
});

test('production persists supplied attempts before adjudication and settle has no reconstruction fallback', async () => {
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const ledgerSource = await readFile(new URL('../actor-ledger-core.mjs', import.meta.url), 'utf8');
    const runtimeStart = indexSource.indexOf('const prepared = prepareActorActionAttempts');
    const persistAt = indexSource.indexOf('await persistActorActionAttemptsForTurn', runtimeStart);
    const settleAt = indexSource.indexOf('settleActorActionCandidates(', persistAt);
    assert.ok(runtimeStart >= 0 && persistAt > runtimeStart && settleAt > persistAt);
    const runtime = indexSource.slice(runtimeStart, settleAt + 800);
    assert.match(runtime, /recordActorActionAttempts/u);
    assert.match(runtime, /attempts: recorded\.recorded/u);
    assert.match(runtime, /sourceRef: actorActionTargetOf\(captured\)/u);
    assert.match(runtime, /target: actionTarget/u);
    assert.match(indexSource, /actorActionSettlementsMatchLedger/u);
    assert.match(indexSource, /requireReadback: true,\s*readbackAttempts: 1,\s*failureSink/u);
    assert.match(indexSource, /actorSchedule\.selected\.length/u);
    assert.match(indexSource, /pendingActorActionAttempts\(actionLedger, \{ target: actionTarget \}\)/u);
    assert.match(indexSource, /world_task_owner_changed/u);

    const settleStart = ledgerSource.indexOf('export function settleActorActionCandidates');
    const settleEnd = ledgerSource.indexOf('export function settleActorInjectionReceipts', settleStart);
    const settleSource = ledgerSource.slice(settleStart, settleEnd);
    assert.doesNotMatch(settleSource, /createActorActionAttempt\(/u);
    assert.match(settleSource, /suppliedAttemptById/u);
    assert.match(settleSource, /journaledAttempt/u);

    const recordStart = ledgerSource.indexOf('export function recordActorActionAttempts');
    const recordEnd = ledgerSource.indexOf('export function actorActionAttemptsMatchLedger', recordStart);
    const recordSource = ledgerSource.slice(recordStart, recordEnd);
    assert.doesNotMatch(recordSource, /actionAttempt:\s*attempt/u);
    assert.match(recordSource, /ledger\.actionAttempts\.push/u);
});

test('formal profile receipt remains self-consistent after the stage5 action flow', () => {
    const actor = readyActor();
    const ledger = ledgerFor(actor);
    const commit = actor.profileV6.baselineCommit;
    assert.equal(commit.status, 'committed');
    assert.equal(commit.readbackVerified, true);
    assert.equal(commit.digest, actorProfileBaselineDigest(actor.profileV6));
    assert.equal(actorProfileCommitMatchesLedger(ledger, {
        chatId: CHAT_ID,
        actorId: actor.id,
        actorRef: commit.actorRef,
        schemaVersion: commit.schemaVersion,
        commitId: commit.commitId,
        digest: commit.digest,
    }).ok, true);
});
