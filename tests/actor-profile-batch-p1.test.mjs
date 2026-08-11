import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    actorProfileReadyForAction,
    bindCharacterCreationTicketsToRegisteredActors,
    buildActorProfileCompletionMessages,
    issueCharacterCreationTicket,
    parseActorProfileCompletionBatchOutput,
    prepareActorLedgerProfilesV6,
    selectActorProfileCompletionCandidates,
} from '../actor-profile-v6-core.mjs';
import { completeActorProfileBatchTransaction } from '../actor-profile-batch-core.mjs';
import {
    discoverActorsFromTurnSources,
    emptyActorLedger,
    normalizeActorLedger,
    promoteActorCandidatesToRegistry,
    runActorRegistryUpsert,
} from '../actor-ledger-core.mjs';

function sourceRef(chatId, generation = 1) {
    return {
        chatId,
        messageId: `message-${generation}`,
        index: generation,
        swipeId: 0,
        generation,
        generationId: `generation-${generation}`,
        generationType: 'normal',
        branchId: 'branch-main',
        identityScopeId: `${chatId}|character:card-main`,
        hash: `hash-${chatId}-${generation}`,
    };
}

function registerNames(ledger, names, ref = sourceRef(ledger.chatId)) {
    const discovery = discoverActorsFromTurnSources(ledger, {
        acceptedContent: names.map((name) => `<actor name="${name}"></actor>`).join('\n'),
        sourceRef: ref,
        turn: ref.generation,
    });
    const upsert = runActorRegistryUpsert(discovery.ledger, discovery.candidates, {
        chatId: ledger.chatId,
        identityScopeId: ref.identityScopeId,
        expectedSourceRef: ref,
        turn: ref.generation,
    });
    const registration = promoteActorCandidatesToRegistry(
        upsert.ledger,
        discovery.candidates,
        {
            chatId: ledger.chatId,
            identityScopeId: ref.identityScopeId,
            expectedSourceRef: ref,
            turn: ref.generation,
        },
    );
    return { discovery, registration, ref };
}

function preGenerationTarget(ref) {
    return {
        chatId: ref.chatId,
        generation: ref.generation,
        generationId: ref.generationId,
        generationType: ref.generationType,
    };
}

function ticketBatch(ref, count) {
    const target = preGenerationTarget(ref);
    return {
        ...target,
        generationSerial: ref.generation,
        capacity: count,
        tickets: Array.from({ length: count }, (_, index) => issueCharacterCreationTicket({
            id: `${ref.generationId}|ticket:${index + 1}`,
            name: `匿名票${index + 1}`,
        }, {
            entropy: `${ref.chatId}|${ref.generationId}|${index + 1}`,
            target,
            order: index + 1,
        })),
    };
}

function completeCandidate(candidate) {
    const actorId = candidate.actorRef.actorId;
    const name = candidate.actorRef.name;
    return {
        actorRef: { actorId, name },
        identity: {
            role: '在社区里承担具体职责的普通成员',
            species: '人类',
            gender: '女性',
            age: '二十七岁',
            briefIntro: `${name}会依据事实、资源和风险选择下一步。`,
            appearance: `${name}留着齐肩黑发，五官清晰，身形匀称，步态利落。`,
            identityText: `${name}在当前世界拥有稳定身份和可核验的日常职责。`,
            relationState: '与邻里保持互助但不过度亲密的长期关系。',
            attitudeToProtagonist: '愿意交换信息，同时明确保留彼此的决定边界。',
            pastExperience: '曾长期处理社区中的物资登记和路线核对工作。',
        },
        personality: {
            biography: `我叫${name}，平时先把手边事实理顺，再决定承担哪部分责任。`,
            primaryColor: '务实而愿意协作',
            primaryDerivatives: [
                '遇到新任务会先核对人员、时间和能撤回的步骤。',
                '同伴需要帮助时会提出具体分工，不用关心替别人作决定。',
            ],
            primarySentence: '先把能确认的部分列出来。',
            baseColor: '保留个人判断',
            baseDerivatives: [
                '多数人同意时仍会检查被忽略的成本。',
                '发现自己判断有误会直接改方案，但不假装从未犯错。',
            ],
            baseSentence: '我会听，但最后要看证据。',
            accentColor: '略显笨拙的幽默',
            accentDerivatives: [
                '气氛紧张时会用生活里的小差错缓和尴尬。',
                '笑话没人接时会自己收尾，不迁怒在场的人。',
            ],
            accentSentence: '至少这次清单没把我也漏掉。',
            othersVoices: [
                `${name}答应的小事通常都会记得。`,
                `${name}谨慎，但不会拿谨慎当拖延借口。`,
                `${name}不熟时话少，熟悉后偶尔会开干巴巴的玩笑。`,
                `${name}愿意帮忙，也会把边界和代价提前说清。`,
            ],
            authorVoice: `我仍不确定${name}的务实更多来自责任感，还是不愿让事情失去控制。`,
        },
        relationships: {
            entries: [{ name: '社区邻里', relation: '稳定互助', detail: '通过日常值守与物资登记保持往来。' }],
            patterns: ['先通过可核验的小事判断可靠度，再逐步调整关系距离。'],
            coverageState: 'no_confirmed_relationships',
        },
        goals: {
            longTerm: ['建立可持续的生活安排，并保留处理意外的余地。'],
            pursuitPrinciples: ['先确认事实和成本，再逐步增加投入。'],
            strategy: {
                summary: '用可回退的小步骤降低长期风险。',
                steps: ['核对现状', '完成一个可验证的小步骤', '依据结果调整投入'],
                reviewConditions: '地点、资源、风险或关系证据发生变化时复核。',
            },
        },
        knowledge: {
            entries: ['掌握与自身身份相称的社区常识、路线和日常办事流程。'],
            unknownRemainsUnknown: true,
            coverageState: 'no_confirmed_knowledge',
        },
        resourcesCapabilities: {
            resources: [{ kind: '日常资源', detail: '随身记事本、普通通讯工具和少量生活用品。' }],
            capabilities: ['能整理清单、核对路线，并清楚说明已知风险。'],
            noUnconfirmedAbilityGranted: true,
            coverageState: 'no_confirmed_resources_or_capabilities',
        },
        sources: {
            identity: 'hypothesis',
            personality: 'designed_seed',
            relationships: 'hypothesis',
            goals: 'designed_seed',
            knowledge: 'hypothesis',
            resourcesCapabilities: 'hypothesis',
        },
    };
}

function prepareRegisteredBatch(count, {
    chatId = `chat-batch-${count}`,
    capacity = count,
    ticketCapacity = capacity,
    profileCapacity = capacity,
} = {}) {
    const names = Array.from({ length: count }, (_, index) => `新人${index + 1}`);
    if (!count) {
        return {
            ledger: emptyActorLedger(chatId),
            candidates: [],
            registration: { promoted: [] },
            binding: { bindings: [], skipped: [] },
            ref: sourceRef(chatId),
        };
    }
    const registered = registerNames(emptyActorLedger(chatId), names);
    const batch = ticketBatch(registered.ref, ticketCapacity);
    const binding = bindCharacterCreationTicketsToRegisteredActors(
        registered.registration.ledger,
        {
            registration: registered.registration,
            candidates: registered.discovery.candidates,
            batch,
            target: registered.ref,
        },
    );
    const prepared = prepareActorLedgerProfilesV6(binding.ledger, {
        mode: 'full',
        turn: registered.ref.generation,
    });
    const priorityActorIds = [
        ...binding.bindings.map((entry) => entry.actorRef.actorId),
        ...registered.registration.promoted
            .filter((entry) => entry.created)
            .map((entry) => entry.actorRef.actorId)
            .filter((actorId) => !binding.bindings.some((entry) => (
                entry.actorRef.actorId === actorId
            ))),
    ];
    const candidates = selectActorProfileCompletionCandidates(prepared.ledger, {
        maxActors: profileCapacity || 1,
        priorityActorIds,
        turn: registered.ref.generation,
    });
    return {
        ledger: prepared.ledger,
        candidates,
        registration: registered.registration,
        binding,
        ref: registered.ref,
    };
}

async function runBatch(fixture, {
    requestBatch = ({ candidates }) => JSON.stringify(candidates.map(completeCandidate)),
    persistBatch = null,
    semanticRetry = true,
    isTargetCurrent = () => true,
} = {}) {
    let saveCount = 0;
    let readbackCount = 0;
    const persisted = persistBatch || (async ({ ledger }) => {
        saveCount += 1;
        readbackCount += 1;
        return { ok: true, ledger: structuredClone(ledger), persistenceMeta: { rev: 1 } };
    });
    const result = await completeActorProfileBatchTransaction({
        ledger: fixture.ledger,
        candidates: fixture.candidates,
        evidenceText: '这是完全合成的P1档案测试材料。',
        turn: fixture.ref.generation,
        target: { ...fixture.ref, sourceRef: fixture.ref },
        semanticRetry,
        requestBatch,
        persistBatch: persisted,
        isTargetCurrent,
    });
    return { result, saveCount, readbackCount };
}

for (const count of [0, 1, 3, 6, 8]) {
    test(`P1 registers, binds and completes ${count} new actors in one batch`, async () => {
        const fixture = prepareRegisteredBatch(count);
        assert.equal(fixture.registration.promoted.length, count);
        assert.equal(fixture.binding.bindings.length, count);
        const calls = [];
        const run = await runBatch(fixture, {
            requestBatch: ({ candidates }) => {
                calls.push(candidates.map((candidate) => candidate.actorId));
                return JSON.stringify(candidates.map(completeCandidate));
            },
        });
        assert.equal(calls.length, count ? 1 : 0);
        assert.equal(run.saveCount, count ? 1 : 0);
        assert.equal(run.readbackCount, count ? 1 : 0);
        assert.equal(run.result.accepted.length, count);
        const refreshed = normalizeActorLedger(structuredClone(run.result.ledger), {
            chatId: fixture.ledger.chatId,
        });
        assert.equal(refreshed.actors.length, count);
        assert.ok(refreshed.actors.every(actorProfileReadyForAction));
        if (count) {
            const first = refreshed.actors[0];
            assert.ok(first.relationships.length > 0);
            assert.ok(first.knowledge.length > 0);
            assert.ok(first.resources.length > 0);
            assert.equal(
                first.profileV6.fieldSources['modules.knowledge.data.entries'],
                'hypothesis',
            );
        }
    });
}

test('P1 completes the exhausted actor from accepted evidence without a post-generation personality roll', async () => {
    const fixture = prepareRegisteredBatch(3, {
        ticketCapacity: 2,
        profileCapacity: 8,
    });
    assert.equal(fixture.registration.promoted.length, 3);
    assert.equal(fixture.binding.bindings.length, 2);
    assert.equal(fixture.binding.ticketPool.exhausted, true);
    assert.equal(fixture.candidates.length, 3);
    const exhaustedActorId = fixture.binding.ticketPool.exhaustedActorRefs[0].actorId;
    const exhaustedCandidate = fixture.candidates.find(
        (candidate) => candidate.actorId === exhaustedActorId,
    );
    assert.equal(exhaustedCandidate.designRolls, null);

    const run = await runBatch(fixture);
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 1, 'all three complete profiles commit atomically in one batch save');
    const refreshed = normalizeActorLedger(run.result.ledger, {
        chatId: fixture.ledger.chatId,
    });
    assert.equal(refreshed.actors.length, 3);
    assert.ok(refreshed.actors.every(actorProfileReadyForAction));
    assert.equal(
        refreshed.actors.find((actor) => actor.id === exhaustedActorId).profileV6.designRolls,
        null,
        'P1 creative completion must not invent a replacement ticket',
    );
});

test('mixed accepted markers keep the real first-appearance order', () => {
    const chatId = 'chat-mixed-order';
    const discovered = discoverActorsFromTurnSources(emptyActorLedger(chatId), {
        acceptedContent: [
            '先遇见<npc name="乙舟"></npc>。',
            '接着是【人物档案：甲岚】。',
            '最后<actor name="丙川"></actor>才进门。',
        ].join(''),
        sourceRef: sourceRef(chatId),
        turn: 1,
    });
    assert.deepEqual(discovered.candidates.map((entry) => entry.name), ['乙舟', '甲岚', '丙川']);
});

test('broken outer array salvages two good rows while isolating one bad row', () => {
    const fixture = prepareRegisteredBatch(3);
    const first = JSON.stringify(completeCandidate(fixture.candidates[0]));
    const second = JSON.stringify(completeCandidate(fixture.candidates[1]));
    const broken = `[\n${first},\nTHIS ROW IS BROKEN,\n${second}`;
    const parsed = parseActorProfileCompletionBatchOutput(broken, {
        candidates: fixture.candidates,
    });
    assert.deepEqual(parsed.entries.map((entry) => entry.actorId), [
        fixture.candidates[0].actorId,
        fixture.candidates[1].actorId,
    ]);
    assert.equal(parsed.failures.length, 1);
    assert.equal(parsed.failures[0].reason, 'actor_profile.missing_candidate');
    assert.ok(parsed.repairs.includes('array_row_salvaged'));
});

test('a locally repairable batch needs one model call', async () => {
    const fixture = prepareRegisteredBatch(3);
    let calls = 0;
    const run = await runBatch(fixture, {
        requestBatch: ({ candidates }) => {
            calls += 1;
            const json = JSON.stringify(candidates.map(completeCandidate));
            return `说明文字\n\`\`\`json\n${json.replace('"actorRef":', 'actorRef:').replace(/\]$/u, ',]')}\n\`\`\``;
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 1);
});

test('one incomplete actor gets one subset replacement while valid peers stay accepted', async () => {
    const fixture = prepareRegisteredBatch(3);
    const calls = [];
    const run = await runBatch(fixture, {
        requestBatch: ({ candidates, attempt }) => {
            calls.push(candidates.map((candidate) => candidate.actorId));
            const rows = candidates.map(completeCandidate);
            if (attempt === 0) delete rows[1].identity.role;
            return JSON.stringify(rows);
        },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], [fixture.candidates[1].actorId]);
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 1);
    assert.equal(run.readbackCount, 1);
});

test('duplicate output retries only that ActorRef and unknown output never blocks valid saves', async () => {
    const fixture = prepareRegisteredBatch(2);
    const calls = [];
    const run = await runBatch(fixture, {
        requestBatch: ({ candidates, attempt }) => {
            calls.push(candidates.map((candidate) => candidate.actorId));
            if (attempt === 1) return JSON.stringify(candidates.map(completeCandidate));
            const first = completeCandidate(candidates[0]);
            const second = completeCandidate(candidates[1]);
            const unknown = structuredClone(first);
            unknown.actorRef = { actorId: 'NPC-UNKNOWN', name: '未知额外人物' };
            return JSON.stringify([first, structuredClone(first), second, unknown]);
        },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], [fixture.candidates[0].actorId]);
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.result.rejected[0].reason, 'actor_profile.actor_ref_unknown');
    assert.equal(run.saveCount, 1);
});

test('duplicate input ActorIds fail closed instead of being swallowed by Map', async () => {
    const fixture = prepareRegisteredBatch(2);
    fixture.candidates = [
        fixture.candidates[0],
        structuredClone(fixture.candidates[0]),
        fixture.candidates[1],
    ];
    const calls = [];
    const run = await runBatch(fixture, {
        requestBatch: ({ candidates }) => {
            calls.push(candidates.map((candidate) => candidate.actorId));
            return JSON.stringify(candidates.map(completeCandidate));
        },
    });
    assert.deepEqual(calls, [[fixture.candidates[2].actorId]]);
    assert.equal(run.result.accepted.length, 1);
    assert.equal(run.result.failures[0].reason, 'actor_profile.input_actor_ref_duplicate');
    assert.equal(run.saveCount, 1);
});

test('one unrecoverable actor does not block another valid actor', async () => {
    const fixture = prepareRegisteredBatch(2);
    const run = await runBatch(fixture, {
        semanticRetry: false,
        requestBatch: ({ candidates }) => {
            const good = completeCandidate(candidates[0]);
            const crossActor = completeCandidate(candidates[1]);
            crossActor.actorRef.name = '错误姓名';
            return JSON.stringify([good, crossActor]);
        },
    });
    assert.equal(run.result.accepted.length, 1);
    assert.equal(run.result.failures[0].reason, 'actor_profile.actor_ref_mismatch');
    assert.equal(run.saveCount, 1);
});

test('transport failure has no outer retry and performs no save', async () => {
    const fixture = prepareRegisteredBatch(3);
    let calls = 0;
    const run = await runBatch(fixture, {
        requestBatch: () => {
            calls += 1;
            throw new Error('synthetic transport failure');
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.result.failures.length, 3);
    assert.equal(run.saveCount, 0);
});

test('partial validation still saves once, while save/readback failure claims nobody', async () => {
    const fixture = prepareRegisteredBatch(2);
    const partial = await runBatch(fixture, {
        semanticRetry: false,
        requestBatch: ({ candidates }) => {
            const rows = candidates.map(completeCandidate);
            rows[1].knowledge.entries = [];
            return JSON.stringify(rows);
        },
    });
    assert.equal(partial.result.accepted.length, 1);
    assert.equal(partial.saveCount, 1);

    for (const persistBatch of [
        async () => ({ ok: false, reason: 'host_save_rejected' }),
        async () => ({ ok: true, ledger: fixture.ledger }),
    ]) {
        const failed = await runBatch(fixture, { persistBatch });
        assert.equal(failed.result.accepted.length, 0);
        assert.equal(failed.result.ledger.actors.some(actorProfileReadyForAction), false);
    }
});

test('stale target before or after model response performs zero writes', async () => {
    const fixture = prepareRegisteredBatch(2);
    let calls = 0;
    const before = await runBatch(fixture, {
        isTargetCurrent: () => false,
        requestBatch: () => {
            calls += 1;
            return '[]';
        },
    });
    assert.equal(calls, 0);
    assert.equal(before.saveCount, 0);

    let currentChecks = 0;
    const after = await runBatch(fixture, {
        isTargetCurrent: () => {
            currentChecks += 1;
            return currentChecks === 1;
        },
    });
    assert.equal(after.result.modelCalls, 1);
    assert.equal(after.saveCount, 0);
});

test('capacity overflow keeps every actor registered and leaves overflow pending', async () => {
    const fixture = prepareRegisteredBatch(9, { capacity: 8 });
    assert.equal(fixture.registration.promoted.length, 9);
    assert.equal(fixture.binding.bindings.length, 8);
    assert.ok(fixture.binding.skipped.some((entry) => entry.endsWith(':ticket_pool_exhausted')));
    assert.equal(fixture.candidates.length, 8);
    const overflowId = fixture.registration.promoted[8].actorRef.actorId;
    const run = await runBatch(fixture);
    const refreshed = normalizeActorLedger(run.result.ledger, { chatId: fixture.ledger.chatId });
    assert.equal(refreshed.actors.length, 9);
    const overflow = refreshed.actors.find((actor) => actor.id === overflowId);
    assert.equal(actorProfileReadyForAction(overflow), false);
    assert.equal(overflow.profileV6.backgroundPending, true);
});

test('newly created actors outrank historical profile backlog at limited capacity', () => {
    const chatId = 'chat-priority';
    const old = registerNames(emptyActorLedger(chatId), ['旧一', '旧二', '旧三'], sourceRef(chatId, 1));
    const newer = registerNames(old.registration.ledger, ['新一', '新二', '新三'], sourceRef(chatId, 2));
    const prepared = prepareActorLedgerProfilesV6(newer.registration.ledger, {
        mode: 'full',
        turn: 2,
    });
    const priorityActorIds = newer.registration.promoted
        .filter((entry) => entry.created)
        .map((entry) => entry.actorRef.actorId);
    const selected = selectActorProfileCompletionCandidates(prepared.ledger, {
        maxActors: 2,
        priorityActorIds,
        turn: 2,
    });
    assert.deepEqual(selected.map((entry) => entry.name), ['新一', '新二']);
});

test('shared narrative and worldbook evidence appears once for an eight-actor batch', () => {
    const fixture = prepareRegisteredBatch(8);
    const sentinel = `WORLD_ANCHOR_${'X'.repeat(10000)}`;
    const messages = buildActorProfileCompletionMessages(fixture.candidates, {
        evidenceText: sentinel,
    });
    const userPrompt = messages.find((message) => message.role === 'user').content;
    assert.equal(userPrompt.split(sentinel).length - 1, 1);
    assert.ok(userPrompt.includes('本批共享正文、世界观与高优先级锚点'));
    assert.ok(userPrompt.length < 70000, '公共证据不得按8个人物线性复制');
});

test('prompt keeps confirmed facts hard and routes hypotheses to editable draft', () => {
    const fixture = prepareRegisteredBatch(1);
    const candidate = structuredClone(fixture.candidates[0]);
    candidate.previousProfile.modules.relationships.data.entries = [{
        actorId: 'NPC-CONFIRMED',
        name: '已确认关系人',
        summary: 'CONFIRMED_RELATION_SENTINEL',
        evidence: ['synthetic'],
    }];
    candidate.fieldSources['modules.relationships.data.entries'] = 'confirmed';
    candidate.previousProfile.modules.knowledge.data.entries = [{
        claim: 'HYPOTHESIS_KNOWLEDGE_SENTINEL',
        kind: 'inferred',
    }];
    candidate.fieldSources['modules.knowledge.data.entries'] = 'hypothesis';
    const userPrompt = buildActorProfileCompletionMessages([candidate], {
        evidenceText: 'WORLD_BOOK_HIGH_PRIORITY_SENTINEL',
    })[1].content;
    assert.match(
        userPrompt,
        /"confirmedAnchors":\{.*CONFIRMED_RELATION_SENTINEL.*"editableDraft":\{.*HYPOTHESIS_KNOWLEDGE_SENTINEL/su,
    );
    assert.equal(userPrompt.split('WORLD_BOOK_HIGH_PRIORITY_SENTINEL').length - 1, 1);
});

test('legacy colon ActorId keeps its full identity in ticket exhaustion diagnostics', () => {
    const ref = sourceRef('chat-legacy-id');
    const actorId = 'NPC:legacy-actor';
    const candidate = {
        candidateId: 'candidate-legacy',
        name: '旧式人物',
        sourceKind: 'accepted_narrative',
        sourceRef: ref,
    };
    const result = bindCharacterCreationTicketsToRegisteredActors({
        chatId: ref.chatId,
        actors: [{ id: actorId, name: candidate.name }],
    }, {
        registration: {
            promoted: [{
                candidateId: candidate.candidateId,
                actorRef: { actorId, displayName: candidate.name, aliases: [] },
                created: true,
            }],
        },
        candidates: [candidate],
        batch: ticketBatch(ref, 0),
        target: ref,
    });
    assert.deepEqual(result.skipped, [`${actorId}:ticket_pool_exhausted`]);
});

test('production path uses independent capacity, created-only priority and one batch save/readback', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const profileFunction = source.slice(
        source.indexOf('async function completeActorProfilesForTurn'),
        source.indexOf('async function runContinuityTarget'),
    );
    assert.match(profileFunction, /maxActors: settings\.actorProfileBatchCapacity/u);
    assert.match(profileFunction, /completeActorProfileBatchTransaction/u);
    assert.match(profileFunction, /maxTokens: 0/u);
    assert.match(profileFunction, /readbackAttempts: 1/u);
    assert.doesNotMatch(profileFunction, /Promise\.all\(candidates\.map|parallelLane|actorShardMaxTokens/u);
    const transaction = source.slice(source.indexOf('const characterCreationTicketBinding'));
    assert.match(transaction, /actorRegistration\.promoted\s*\.filter\(\(entry\) => entry\.created === true\)/u);
    assert.match(transaction, /priorityActorIds,/u);
    assert.match(transaction, /ticket_pool_exhausted/u);
    assert.match(transaction, /recordModelDiagnostic/u);
    assert.match(profileFunction, /worldContext\.text/u);
    assert.match(transaction, /lastIndexOf\(':'\)/u);
});
