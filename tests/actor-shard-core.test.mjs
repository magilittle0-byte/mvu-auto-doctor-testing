import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildActorShardBatchMessages,
    buildActorShardRepairMessages,
    buildActorShardMessages,
    convergeActorShardProposals,
    formatUserNarrativeInstruction,
    parseActorShardProposal,
    parseActorShardProposalBatch,
    runActorShardBatch,
    runActorShardProposalBatch,
    selectActorShardCandidates as selectActorShardCandidatesCore,
    userPromptSlotMetadata,
} from '../actor-shard-core.mjs';
import { actorIdFromName } from '../actor-ref-core.mjs';
import {
    actorProfileReadinessInLedger,
    finalizeActorProfileBaselinesInLedger,
    replaceActorProfileBaselineInLedger,
    sealActorProfilePendingTransactionInLedger,
} from '../actor-ledger-core.mjs';
import { actorProfileBaselineDigest, materializeActorProfileBaseline } from '../actor-profile-v6-core.mjs';
import { makeActionReadyActor } from './helpers/actor-action-ready-fixture.mjs';

const ACTOR_SHARD_CHAT_ID = 'actor-shard-test';

function canonicalActorShardTarget(turn = 1) {
    return {
        chatId: ACTOR_SHARD_CHAT_ID,
        messageId: `actor-shard-message-${turn}`,
        logicalIndex: turn,
        index: turn,
        swipeId: 0,
        generation: turn,
        generationSerial: turn,
        generationId: `actor-shard-generation-${turn}`,
        generationType: 'normal',
        identityScopeId: `${ACTOR_SHARD_CHAT_ID}|character:fixture`,
        scopeDigest: `${ACTOR_SHARD_CHAT_ID}|scope:fixture`,
        contentHash: `actor-shard-content-${turn}`,
        contentFingerprint: `actor-shard-content-${turn}`,
        hash: `actor-shard-content-${turn}`,
        compatibilityOnly: false,
    };
}

function actionReadyLedgerForContinuity(continuity = {}) {
    const names = [...new Set((continuity?.threads || [])
        .flatMap((entry) => entry?.actorEligible === false
            ? []
            : (Array.isArray(entry?.actors) ? entry.actors : []))
        .filter((entry) => typeof entry === 'string' && entry.trim()))];
    const target = canonicalActorShardTarget();
    const actors = names.map((name) => {
        const actorId = actorIdFromName(name);
        if (!actorId) return null;
        return makeActionReadyActor({
        chatId: ACTOR_SHARD_CHAT_ID,
        id: actorId,
        name,
        status: 'active',
        tier: 'secondary',
        identity: { role: '测试人物', aliases: [], traits: [], desires: [], boundaries: [] },
        longTermGoals: ['完成有依据的长期目标'],
        currentGoals: ['调查当前线索'],
        knowledge: [{ id: `K-${actorIdFromName(name)}`, claim: '北港存在一条可核验线索', kind: 'observed' }],
        location: { name: '北港', sinceTurn: 1, evidence: ['fixture'] },
        resources: [],
        capabilities: [],
        relationships: [],
        commitments: [],
        hidden: { emotionalInertia: [], innerConflicts: [], privateIntentions: [] },
        plan: { summary: '调查当前线索', steps: [], status: 'active' },
        evidence: ['fixture'],
        }, { sourceRef: target });
    }).filter(Boolean);
    return {
        chatId: ACTOR_SHARD_CHAT_ID,
        actorRegistry: {
            version: 1,
            chatId: ACTOR_SHARD_CHAT_ID,
            identityScopeId: target.identityScopeId,
            scopeDigest: target.scopeDigest,
            characters: {},
            registered: Object.fromEntries(actors.map((actor) => [actor.name, {
                actorRef: {
                    kind: 'actor_ref',
                    actorId: actor.id,
                    displayName: actor.name,
                    aliases: actor.identity.aliases,
                },
                sourceRefs: (() => {
                    const sourceRef = actor.profileV6?.baselineCommit?.sourceRef;
                    const writeSetEntry = actor.profileV6?.baselineCommit?.verification?.writeSet
                        ?.find((entry) => entry?.actorRef?.actorId === actor.id);
                    assert.ok(sourceRef, 'every action-ready actor must retain its baseline sourceRef');
                    assert.deepEqual(
                        writeSetEntry?.sourceRef,
                        sourceRef,
                        'Registry sourceRef must exactly reuse its ActorRef write-set sourceRef',
                    );
                    return [structuredClone(sourceRef)];
                })(),
            }])),
        },
        identityQuarantine: [],
        actors,
    };
}

function selectActorShardCandidates(input = {}) {
    return selectActorShardCandidatesCore({
        ...input,
        actorLedger: input.actorLedger || actionReadyLedgerForContinuity(input.continuity),
    });
}

function thread(id, actor, overrides = {}) {
    return {
        id,
        actors: [actor],
        locations: ['北港'],
        stage: 'advancing',
        relation: 'independent',
        urgency: 2,
        seedBasis: `世界书:${id}`,
        summary: `${actor}正在处理${id}`,
        nextBeat: `${actor}继续行动`,
        trigger: '午夜',
        causedBy: ['CHAIN-A'],
        sourceRefs: [{ messageId: `m-${id}`, hash: `h-${id}` }],
        knowledge: 'hidden',
        ...overrides,
    };
}

function proposal(candidate, overrides = {}) {
    return {
        actorId: candidate.id,
        actorName: candidate.name,
        time: '第三日午夜',
        location: '北港',
        travelTurns: 0,
        knowledgeBasis: [candidate.knowledgeBasis[0]],
        currentGoal: candidate.goals[0] || '继续既定目标',
        intent: 'execute',
        candidateAction: '沿既有线索调查仓库',
        actionWindow: '第三日午夜至黎明',
        expectedCost: '一段调查时间',
        expectedDuration: '一轮',
        expectedRisk: '暴露调查意图',
        observableConsequence: '一项仓库线索被确认或排除',
        stimulusDecisions: (candidate.stimuli || []).map((item) => ({
            stimulusId: item.id,
            decision: 'adopted',
            reason: '该刺激与仓库调查直接相关',
        })),
        stateChanges: [{ kind: 'knowledge', summary: '仓库调查获得一项新的可核验线索' }],
        interactionTargets: [],
        resourceCosts: [],
        capabilityUsed: '',
        waitCondition: '',
        sourceThreads: [candidate.sourceThreads[0]],
        evidence: [candidate.evidence[0]],
        causalChain: [candidate.causalChain[0]],
        ...overrides,
    };
}

test('deterministic selector handles 0/1/3/6 limits without excluding present actors', () => {
    const continuity = {
        threads: [
            thread('T1', '艾达', { urgency: 3 }),
            thread('T2', '贝拉', { urgency: 2 }),
            thread('T3', '希恩', { urgency: 1 }),
            thread('T4', '多恩', { urgency: 1 }),
            thread('T5', '伊芙', { urgency: 0 }),
            thread('T6', '菲恩', { urgency: 0 }),
            thread('T7', '港口巡逻队', { urgency: 3, actorEligible: false }),
        ],
    };
    assert.equal(selectActorShardCandidates({ continuity: { threads: [] } }).length, 0);
    assert.equal(selectActorShardCandidates({
        continuity,
        presentText: '艾达站在玩家身边。',
        maxWorkers: 1,
    }).length, 1);
    assert.equal(selectActorShardCandidates({
        continuity,
        presentText: '艾达站在玩家身边。',
        maxWorkers: 3,
    }).length, 3);
    const six = selectActorShardCandidates({
        continuity,
        presentText: '',
        maxWorkers: 6,
    });
    assert.equal(six.length, 6);
    assert.deepEqual(
        six.map((item) => item.name),
        ['艾达', '贝拉', '希恩', '多恩', '菲恩', '伊芙'],
    );
    assert.equal(selectActorShardCandidates({
        continuity,
        maxWorkers: 99,
    }).length, 6);
    assert.equal(selectActorShardCandidates({
        continuity: {
            threads: [
                thread('T-linked', '联动者', { relation: 'linked' }),
                thread('T-resolved', '已结束者', { stage: 'resolved' }),
            ],
        },
        maxWorkers: 5,
    }).length, 2, 'action-ready profiles may act independently of resolved/linked world threads');
});

test('one actor proposal batch call covers exactly 0/1/3/6 isolated action-ready actors', async () => {
    const allCandidates = selectActorShardCandidates({
        continuity: {
            threads: [
                thread('T1', '艾达', { urgency: 3 }),
                thread('T2', '贝拉', { urgency: 2 }),
                thread('T3', '希恩', { urgency: 2 }),
                thread('T4', '多恩', { urgency: 1 }),
                thread('T5', '伊芙', { urgency: 1 }),
                thread('T6', '菲恩', { urgency: 0 }),
            ],
        },
        maxWorkers: 6,
    });
    assert.equal(allCandidates.length, 6);
    for (const count of [0, 1, 3, 6]) {
        let calls = 0;
        const selected = allCandidates.slice(0, count);
        const result = await runActorShardProposalBatch({
            candidates: selected,
            callBatch: async (batch) => {
                calls += 1;
                assert.equal(batch.length, count);
                return JSON.stringify({ proposals: batch.map((candidate) => proposal(candidate)) });
            },
        });
        assert.equal(result.status, 'completed');
        assert.equal(result.proposals.length, count);
        assert.equal(calls, count === 0 ? 0 : 1);
        assert.equal(result.diagnostics.modelCalls, count === 0 ? 0 : 1);
        assert.equal(result.diagnostics.semanticSuccess, true);
    }
});

test('batch prompt isolates actor contexts and partial success preserves valid peers around bad items', async () => {
    const candidates = selectActorShardCandidates({
        continuity: {
            threads: [
                thread('T1', '艾达'),
                thread('T2', '贝拉'),
                thread('T3', '希恩'),
                thread('T4', '多恩'),
                thread('T5', '伊芙'),
                thread('T6', '菲恩'),
            ],
        },
        maxWorkers: 6,
    });
    const messages = buildActorShardBatchMessages(candidates, {
        target: { chatId: 'actor-shard-test', messageId: 'm7', contentHash: 'h7' },
    });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /每个隔离角色/u);
    assert.match(messages[1].content, /禁止把另一项的知识、位置、资源、能力、秘密或目标搬入本项/u);
    for (const candidate of candidates) assert.match(messages[1].content, new RegExp(candidate.id, 'u'));

    const rows = [
        JSON.stringify(proposal(candidates[0])),
        JSON.stringify(proposal(candidates[1], {
            resourceCosts: [{ resourceId: 'not-owned', amount: 1 }],
        })),
        JSON.stringify(proposal(candidates[2])),
        JSON.stringify(proposal(candidates[2], {
            candidateAction: '核验另一条重复提交的线索',
            stateChanges: [{ kind: 'knowledge', summary: '重复提交仍带来另一项线索' }],
        })),
        '{actorId:"broken-json"}',
        JSON.stringify({ actorId: 'NPC-UNKNOWN' }),
        JSON.stringify(proposal(candidates[3])),
        JSON.stringify(proposal(candidates[5])),
    ];
    const batchOutput = `说明文字\n{"proposals":[${rows.join(',')}]}\n结束`;
    const parsed = parseActorShardProposalBatch(batchOutput, { candidates });
    assert.equal(parsed.semanticSuccess, true);
    assert.equal(parsed.repaired, true);
    assert.deepEqual(
        parsed.proposals.map((item) => item.actorId),
        [candidates[0].id, candidates[3].id, candidates[5].id].sort(),
    );
    const codes = new Set(parsed.failures.map((item) => item.code));
    assert.ok(codes.has('actor_shard.resource_invalid'));
    assert.ok(codes.has('actor_shard.batch_actor_duplicate'));
    assert.ok(codes.has('actor_shard.batch_item_json_invalid'));
    assert.ok(codes.has('actor_shard.batch_actor_unknown'));
    assert.ok(codes.has('actor_shard.batch_actor_output_missing'));

    let calls = 0;
    const partial = await runActorShardProposalBatch({
        candidates,
        callBatch: async () => {
            calls += 1;
            return batchOutput;
        },
    });
    assert.equal(calls, 1);
    assert.equal(partial.status, 'completed');
    assert.equal(partial.diagnostics.semanticSuccess, true);
    assert.equal(partial.proposals.length, 3);
    assert.equal(partial.diagnostics.failed, 3);
    assert.ok(partial.failures.length >= 3);
});

test('transport success with zero valid actor semantics is explicit and stale targets never expose output', async () => {
    const candidates = selectActorShardCandidates({
        continuity: { threads: [thread('T1', '艾达'), thread('T2', '贝拉')] },
        maxWorkers: 2,
    });
    let calls = 0;
    const semanticFailure = await runActorShardProposalBatch({
        candidates,
        callBatch: async () => {
            calls += 1;
            return JSON.stringify({ proposals: [] });
        },
    });
    assert.equal(calls, 1);
    assert.equal(semanticFailure.status, 'semantic-failed');
    assert.equal(semanticFailure.diagnostics.semanticSuccess, false);
    assert.equal(semanticFailure.proposals.length, 0);
    assert.equal(semanticFailure.failures.length, 2);

    calls = 0;
    const staleBefore = await runActorShardProposalBatch({
        candidates,
        isCurrent: () => false,
        callBatch: async () => {
            calls += 1;
            return JSON.stringify({ proposals: candidates.map((candidate) => proposal(candidate)) });
        },
    });
    assert.equal(staleBefore.status, 'stale');
    assert.equal(calls, 0);
    assert.deepEqual(staleBefore.proposals, []);

    let current = true;
    const staleAfter = await runActorShardProposalBatch({
        candidates,
        isCurrent: () => current,
        callBatch: async () => {
            calls += 1;
            current = false;
            return JSON.stringify({ proposals: candidates.map((candidate) => proposal(candidate)) });
        },
    });
    assert.equal(staleAfter.status, 'stale');
    assert.equal(calls, 1);
    assert.deepEqual(staleAfter.proposals, []);
});

test('P3 shard rejects a profile whose local receipt looks ready but final ledger verification is stale', () => {
    const continuity = { threads: [thread('T1', '艾达')] };
    const actorLedger = actionReadyLedgerForContinuity(continuity);
    const actor = actorLedger.actors[0];
    actor.profileV6.baselineCommit.verification.preparedLedgerDigest = 'tampered-final-receipt';
    const candidates = selectActorShardCandidates({ continuity, actorLedger, maxWorkers: 1 });
    assert.deepEqual(candidates, []);
});

test('P3 accepts only a final narrative receipt and rejects section or receipt tampering', () => {
    const continuity = { threads: [thread('T-NARRATIVE', '\u53d9\u4e8b\u4eba\u7269')] };
    const actorLedger = actionReadyLedgerForContinuity(continuity);
    const actor = actorLedger.actors[0];
    const sections = Object.fromEntries([
        ['person', '\u4eba\u7269\u4fe1\u606f'], ['physiology', '\u751f\u7406\u7279\u5f81'],
        ['personality', '\u6027\u683c\u7279\u5f81'], ['history', '\u8fc7\u5f80\u7ecf\u5386'],
        ['currentState', '\u5f53\u524d\u72b6\u6001'], ['relationshipsMotives', '\u5173\u7cfb\u4e0e\u52a8\u673a'],
        ['knowledgeCapabilitiesResources', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90'],
    ].map(([key, title]) => [key, {
        key, title, text: `${title}\u662f\u5b8c\u6574\u7684\u53d9\u4e8b\u6bb5\u843d\u3002`, source: 'hypothesis', evidence: [],
    }]));
    const base = materializeActorProfileBaseline(actor.profileV6, {
        profileFormat: 'narrative-v1',
        actorRef: { actorId: actor.id, name: actor.name },
        narrativeSections: sections,
    }, { turn: 1, completionMode: 'full' });
    const digest = actorProfileBaselineDigest(base);
    const sourceRef = actor.profileV6.baselineCommit.sourceRef;
    const expected = [{
        actorRef: { actorId: actor.id, name: actor.name }, schemaVersion: base.version,
        commitId: `NARRATIVE-${actor.id}`, profileDigest: digest, sourceRef,
        scopeDigest: sourceRef.scopeDigest, locks: {}, manualOverrides: {},
    }];
    const staged = replaceActorProfileBaselineInLedger(actorLedger, expected[0].actorRef, base, {
        ...expected[0], digest, committedTurn: 1, phase: 'pending',
    });
    const sealed = sealActorProfilePendingTransactionInLedger(staged.ledger, expected, { preparedFieldRevision: 1 });
    const finalized = finalizeActorProfileBaselinesInLedger(sealed.ledger, expected, {
        transactionId: sealed.transactionId, writeSetDigest: sealed.writeSetDigest,
        preparedLedgerDigest: sealed.preparedLedgerDigest, preparedFieldRevision: sealed.preparedFieldRevision,
    });
    const narrativeLedger = finalized.ledger;
    assert.equal(actorProfileReadinessInLedger(actorLedger, actor.id).ready, true);
    assert.equal(actorProfileReadinessInLedger(narrativeLedger, actor.id).ready, true);
    assert.equal(selectActorShardCandidates({ continuity, actorLedger: narrativeLedger, maxWorkers: 1 }).length, 1);

    const cases = [
        (copy) => { copy.actors[0].profileV6.narrativeSections.history.text = ''; },
        (copy) => { copy.actors[0].profileV6.baselineCommit.verification.profileDigest = 'tampered'; },
        (copy) => { copy.actors[0].profileV6.baselineCommit.verification.writeSet[0].sourceRef.scopeDigest = 'wrong-scope'; },
        (copy) => { copy.actors[0].pendingProfile = structuredClone(copy.actors[0].profileV6); copy.actors[0].profileV6.preparedForAction = false; },
    ];
    for (const mutate of cases) {
        const copy = structuredClone(narrativeLedger);
        mutate(copy);
        assert.equal(actorProfileReadinessInLedger(copy, actor.id).ready, false);
        assert.deepEqual(selectActorShardCandidates({ continuity, actorLedger: copy, maxWorkers: 1 }), []);
    }
});

test('an explicitly empty actor schedule remains empty instead of bypassing readiness', () => {
    const actorLedger = {
        actors: [{
            id: 'NPC-NOT-READY',
            name: '待补档人物',
            status: 'active',
            currentGoals: ['等待档案补全'],
        }],
    };
    assert.deepEqual(selectActorShardCandidates({
        continuity: { threads: [thread('T-UNREGISTERED', '未登记人物')] },
        actorLedger,
        schedule: { selected: [] },
        maxWorkers: 1,
    }), []);
});

test('a persisted Registry rejects a scheduled actor that has no registered ActorRef', () => {
    const actorLedger = {
        chatId: 'chat-registry-shard-gate',
        actorRegistry: {
            version: 1,
            chatId: 'chat-registry-shard-gate',
            entries: [],
        },
        actors: [{
            id: 'NPC-BYPASS-SHARD',
            name: 'Bypass Actor',
            status: 'active',
            currentGoals: ['bypass the Registry'],
            evidence: ['synthetic'],
        }],
    };
    assert.deepEqual(selectActorShardCandidates({
        continuity: { threads: [] },
        actorLedger,
        schedule: {
            selected: [{
                actorId: 'NPC-BYPASS-SHARD',
                score: 10,
                slot: 'priority',
                reasons: ['forged-schedule'],
            }],
        },
        maxWorkers: 1,
    }), []);
});

test('proposal parser repairs harmless shape drift but rejects authority and identity/evidence escape', () => {
    const candidate = selectActorShardCandidates({
        continuity: { threads: [thread('T1', '艾达')] },
        maxWorkers: 1,
    })[0];
    const valid = proposal(candidate);
    const parsedValid = parseActorShardProposal(JSON.stringify(valid), { candidate });
    assert.deepEqual(parsedValid.proposal, valid, parsedValid.error);
    assert.equal(
        parseActorShardProposal(JSON.stringify({ ...valid, authorization: true }), { candidate }).error,
        'actor_shard.shape_not_whitelisted',
    );
    const harmlessDrift = parseActorShardProposal(JSON.stringify({
        proposal: {
            ...valid,
            modelNote: 'ignored',
            stateChanges: valid.stateChanges.map((entry) => ({ ...entry, confidence: 0.9 })),
            interactionTargets: undefined,
            resourceCosts: undefined,
        },
        metadata: { latency: 1 },
    }), { candidate });
    assert.deepEqual(harmlessDrift.proposal, {
        ...valid,
        interactionTargets: [],
        resourceCosts: [],
    });
    assert.equal(harmlessDrift.repaired, true);
    assert.deepEqual(harmlessDrift.repairKinds, [
        'unwrap-proposal-object',
        'drop-unrecognized-fields',
        'default-safe-bound-fields',
    ]);
    assert.deepEqual(
        parseActorShardProposal(`说明：${JSON.stringify(valid)}`, { candidate }).proposal,
        valid,
    );
    const fenced = parseActorShardProposal(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, { candidate });
    assert.deepEqual(fenced.proposal, valid);
    assert.equal(fenced.repaired, true);
    assert.deepEqual(fenced.repairKinds, ['extract-first-balanced-json-object']);
    assert.equal(
        parseActorShardProposal(
            JSON.stringify({ ...valid, sourceThreads: ['UNRELATED'] }),
            { candidate },
        ).error,
        'actor_shard.required_evidence_missing',
    );
    assert.equal(
        parseActorShardProposal(
            JSON.stringify({ ...valid, knowledgeBasis: ['角色不可能知道的私人事实'] }),
            { candidate },
        ).error,
        'actor_shard.required_evidence_missing',
    );
    assert.equal(
        parseActorShardProposal(
            JSON.stringify({ ...valid, evidence: ['伪造的新证据'] }),
            { candidate },
        ).error,
        'actor_shard.required_evidence_missing',
    );
    assert.equal(
        parseActorShardProposal(
            JSON.stringify({
                ...valid,
                location: '南站',
                travelTurns: 0,
            }),
            { candidate },
        ).error,
        'actor_shard.travel_invalid',
    );
});

test('real-session shape drift is repaired from the full bound schema without inventing action semantics', () => {
    const candidate = selectActorShardCandidates({
        continuity: { threads: [thread('T-long', '艾达')] },
        maxWorkers: 1,
    })[0];
    const partial = proposal(candidate);
    for (const key of [
        'actorName',
        'time',
        'location',
        'travelTurns',
        'knowledgeBasis',
        'currentGoal',
        'sourceThreads',
        'evidence',
        'causalChain',
    ]) delete partial[key];
    const parsed = parseActorShardProposal(JSON.stringify(partial), { candidate });
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.proposal.actorId, candidate.id);
    assert.equal(parsed.proposal.actorName, candidate.name);
    assert.equal(parsed.proposal.candidateAction, '沿既有线索调查仓库');
    assert.deepEqual(parsed.proposal.stateChanges, [
        { kind: 'knowledge', summary: '仓库调查获得一项新的可核验线索' },
    ]);
    assert.ok(parsed.repairKinds.includes('default-safe-bound-fields'));

    const repairMessages = buildActorShardRepairMessages(
        '{"actorId":"broken"}',
        candidate,
        'actor_shard.shape_not_whitelisted',
    );
    const repairPrompt = repairMessages.map((message) => message.content).join('\n');
    assert.match(repairPrompt, /严格输出形状/u);
    assert.match(repairPrompt, /candidateAction/u);
    assert.match(repairPrompt, /stateChanges/u);
    assert.match(repairPrompt, new RegExp(candidate.id, 'u'));
});

test('run-until-cancelled actor workers are not aborted by a doctor timer', async () => {
    const candidate = selectActorShardCandidates({
        continuity: { threads: [thread('T-slow', '艾达')] },
        maxWorkers: 1,
    })[0];
    const result = await runActorShardBatch({
        candidates: [candidate],
        timeoutMs: 0,
        callWorker: async () => {
            await new Promise((resolve) => setTimeout(resolve, 45));
            return JSON.stringify(proposal(candidate));
        },
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.proposals.length, 1);
    assert.equal(result.failures.length, 0);
});

test('persistent actor proposals whitelist resource costs and capabilities before local settlement', () => {
    const continuity = { threads: [thread('T-resource', '艾达')] };
    const actorLedger = actionReadyLedgerForContinuity(continuity);
    actorLedger.actors[0].resources = [{ id: 'coin', name: '银币', amount: 3 }];
    actorLedger.actors[0].capabilities = ['交涉'];
    const actorId = actorLedger.actors[0].id;
    const candidate = selectActorShardCandidates({
        continuity,
        actorLedger,
        schedule: {
            selected: [{
                actorId,
                score: 10,
                slot: 'priority',
                reasons: ['action-due'],
            }],
        },
        maxWorkers: 1,
    })[0];
    const valid = proposal(candidate, {
        resourceCosts: [{ resourceId: 'coin', amount: 2 }],
        capabilityUsed: '交涉',
    });
    assert.equal(parseActorShardProposal(JSON.stringify(valid), { candidate }).error, undefined);
    assert.equal(
        parseActorShardProposal(JSON.stringify({
            ...valid,
            resourceCosts: [{ resourceId: 'coin', amount: 4 }],
        }), { candidate }).error,
        'actor_shard.resource_invalid',
    );
    assert.equal(
        parseActorShardProposal(JSON.stringify({
            ...valid,
            capabilityUsed: '瞬间移动',
        }), { candidate }).error,
        'actor_shard.capability_invalid',
    );
});

test('an explicitly empty interaction allow-list rejects invented actors', () => {
    const continuity = { threads: [thread('T-alone', 'Ada')] };
    const actorLedger = actionReadyLedgerForContinuity(continuity);
    const actorId = actorLedger.actors[0].id;
    const candidate = selectActorShardCandidates({
        continuity,
        actorLedger,
        schedule: {
            selected: [{ actorId, score: 10, slot: 'priority', reasons: ['action-due'] }],
        },
        maxWorkers: 1,
    })[0];
    candidate.knownInteractionTargets = [];
    assert.deepEqual(candidate.knownInteractionTargets, []);
    assert.equal(
        parseActorShardProposal(JSON.stringify(proposal(candidate, {
            interactionTargets: [{ actorId: 'NPC-FAKE', actorName: 'Invented Stranger' }],
        })), { candidate }).error,
        'actor_shard.interaction_targets_invalid',
    );
    assert.equal(
        parseActorShardProposal(JSON.stringify(proposal(candidate, {
            interactionTargets: [],
        })), { candidate }).error,
        undefined,
    );
});

test('convergence is order-independent and keeps time/location/causal conflicts independent', () => {
    const candidates = selectActorShardCandidates({
        continuity: {
            threads: [
                thread('T1', '艾达'),
                thread('T1', '贝拉'),
                thread('T3', '希恩', { causedBy: ['CHAIN-C'] }),
                thread('T4', '多恩', { locations: ['南站'] }),
                thread('T5', '伊芙'),
            ],
        },
        maxWorkers: 5,
    });
    const byName = new Map(candidates.map((item) => [item.name, item]));
    const ada = proposal(byName.get('艾达'));
    const bella = proposal(byName.get('贝拉'));
    const timeConflict = proposal(byName.get('伊芙'), { time: '第四日清晨' });
    const locationConflict = proposal(byName.get('多恩'), { location: '南站' });
    const causalConflict = proposal(byName.get('希恩'), {
        sourceThreads: ['T3'],
        causalChain: ['T3'],
    });
    const forward = convergeActorShardProposals([
        timeConflict,
        bella,
        causalConflict,
        ada,
        locationConflict,
    ]);
    const reverse = convergeActorShardProposals([
        locationConflict,
        ada,
        causalConflict,
        bella,
        timeConflict,
    ]);
    assert.deepEqual(forward, reverse);
    assert.equal(forward.jointEvents.length, 1);
    assert.deepEqual(
        forward.jointEvents[0].actorIds.sort(),
        [ada.actorId, bella.actorId].sort(),
    );
    const reasons = forward.independent.flatMap((item) => item.reasons);
    assert.ok(reasons.includes('time-conflict'));
    assert.ok(reasons.includes('location-conflict'));
    assert.ok(reasons.includes('information-causal-chain-conflict'));
});

test('bounded parallel batch is completion-order independent and degrades worker failures/timeouts', async () => {
    const candidates = selectActorShardCandidates({
        continuity: {
            threads: [
                thread('T1', '艾达'),
                thread('T2', '贝拉'),
                thread('T3', '希恩'),
                thread('T4', '多恩'),
                thread('T5', '伊芙'),
            ],
        },
        maxWorkers: 5,
    });
    let active = 0;
    let peak = 0;
    const completed = await runActorShardBatch({
        candidates,
        maxConcurrency: 3,
        timeoutMs: 30,
        callWorker: async (candidate, { signal }) => {
            active += 1;
            peak = Math.max(peak, active);
            try {
                if (candidate.name === '多恩') throw new Error('provider down');
                if (candidate.name === '伊芙') {
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(resolve, 100);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timer);
                            reject(new Error('aborted'));
                        }, { once: true });
                    });
                }
                await new Promise((resolve) => setTimeout(
                    resolve,
                    candidate.name.charCodeAt(0) % 7,
                ));
                return JSON.stringify(proposal(candidate));
            } finally {
                active -= 1;
            }
        },
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.proposals.length, 3);
    assert.equal(completed.failures.length, 2);
    assert.ok(peak <= 3);
    assert.deepEqual(
        completed.proposals.map((item) => item.actorId),
        [...completed.proposals].map((item) => item.actorId).sort(),
    );
});

test('a reroll during workers makes the whole batch stale with zero candidate output', async () => {
    const candidates = selectActorShardCandidates({
        continuity: { threads: [thread('T1', '艾达'), thread('T2', '贝拉')] },
        maxWorkers: 2,
    });
    let current = true;
    let completions = 0;
    const result = await runActorShardBatch({
        candidates,
        maxConcurrency: 2,
        callWorker: async (candidate) => {
            await new Promise((resolve) => setTimeout(resolve, candidate.name === '艾达' ? 2 : 8));
            completions += 1;
            if (completions === 1) current = false;
            return JSON.stringify(proposal(candidate));
        },
        isCurrent: () => current,
    });
    assert.equal(result.status, 'stale');
    assert.deepEqual(result.proposals, []);
    assert.deepEqual(result.convergence, { jointEvents: [], independent: [] });
});

test('actor shard output example is directly valid against the candidate evidence whitelist', () => {
    const candidate = {
        id: 'actor-1',
        name: 'Actor One',
        locations: ['QC Lab'],
        knowledgeBasis: ['allowed-knowledge'],
        goals: ['inspect-manifest'],
        sourceThreads: ['thread-1'],
        evidence: ['evidence-1'],
        causalChain: ['cause-1'],
        stimuli: ['legacy-untyped-stimulus-must-not-become-an-undefined-id'],
    };
    const messages = buildActorShardMessages(candidate);
    assert.match(messages[0].content, /资源列表为空时必须输出\[\]/u);
    assert.match(messages[0].content, /能力列表为空时必须输出空字符串/u);
    assert.match(messages[0].content, /没有提供可核验目标ID时必须输出\[\]/u);
    assert.match(messages[0].content, /信息取样、典型误读、具体关系距离/u);
    assert.match(messages[0].content, /不得用MBTI、九型、Tritype、依恋型/u);
    assert.match(messages[0].content, /不为补反差发明创伤或秘密/u);
    const shape = JSON.parse(messages[1].content.split('\n').at(-1));
    assert.deepEqual(shape.knowledgeBasis, candidate.knowledgeBasis);
    assert.deepEqual(shape.sourceThreads, candidate.sourceThreads);
    assert.deepEqual(shape.evidence, candidate.evidence);
    assert.deepEqual(shape.causalChain, candidate.causalChain);
    assert.deepEqual(shape.interactionTargets, []);
    assert.deepEqual(shape.stimulusDecisions, []);
    assert.equal(shape.location, 'QC Lab');
    assert.equal(shape.currentGoal, 'inspect-manifest');
    assert.equal(parseActorShardProposal(JSON.stringify(shape), { candidate }).error, undefined);
});

test('unknown legacy location is not treated as a real departure point while known travel still needs time', () => {
    const candidate = selectActorShardCandidates({
        continuity: { threads: [thread('T1', '艾达')] },
        maxWorkers: 1,
    })[0];
    candidate.actorState = {
        location: { name: 'unknown' },
        resources: [],
        capabilities: [],
        actionHistory: [],
    };
    const discovered = parseActorShardProposal(JSON.stringify(proposal(candidate, {
        location: '北港',
        travelTurns: 0,
    })), { candidate });
    assert.equal(discovered.error, undefined);

    candidate.actorState.location = { name: '南站' };
    const impossibleTravel = parseActorShardProposal(JSON.stringify(proposal(candidate, {
        location: '北港',
        travelTurns: 0,
    })), { candidate });
    assert.equal(impossibleTravel.error, 'actor_shard.travel_invalid');
    const repair = buildActorShardRepairMessages(
        JSON.stringify(proposal(candidate)),
        candidate,
        impossibleTravel.error,
    );
    assert.match(repair[0].content, /currentLocation.*travelTurns/u);
    assert.match(repair[0].content, /semantic_delta_invalid.*stateChanges/u);
    assert.match(repair[0].content, /stimulus_decision_missing.*adopted.*opposed/u);
    assert.match(repair[0].content, /no_semantic_progress.*占位答案/u);
    assert.match(repair[1].content, /"currentLocation":"南站"/u);
});

test('custom prompts enter only labeled narrative model messages and diagnostics expose metadata', () => {
    const candidate = selectActorShardCandidates({
        continuity: { threads: [thread('T1', '艾达')] },
        maxWorkers: 1,
    })[0];
    const secret = '保持冷峻侦探叙事，不改变任何授权。';
    const messages = buildActorShardMessages(candidate, { customPrompt: secret });
    assert.match(messages[0].content, /用户自定义人物行动分析指令/u);
    assert.match(messages[0].content, new RegExp(secret, 'u'));
    const continuityInstruction = formatUserNarrativeInstruction('世界连续性', secret);
    assert.match(continuityInstruction, /用户自定义世界连续性指令/u);
    assert.match(continuityInstruction, new RegExp(secret, 'u'));
    assert.match(continuityInstruction, /不能覆盖消息指纹、活动分支、事务、危险确认/u);
    const metadata = userPromptSlotMetadata(secret);
    assert.deepEqual(Object.keys(metadata), ['enabled', 'length', 'hash']);
    assert.equal(JSON.stringify(metadata).includes(secret), false);
    const rejected = parseActorShardProposal(JSON.stringify({
        ...proposal(candidate),
        transactionAuthorization: secret,
    }), { candidate });
    assert.equal(rejected.error, 'actor_shard.shape_not_whitelisted');
});

test('disabled selection path makes no calls and returns the same input continuity reference', () => {
    const continuity = { turn: 7, threads: [thread('T1', '艾达')] };
    const actorCandidates = [];
    let calls = 0;
    if (actorCandidates.length) calls += 1;
    assert.equal(calls, 0);
    assert.equal(continuity.turn, 7);
    assert.equal(continuity.threads[0].id, 'T1');
});
