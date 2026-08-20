import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ACTOR_LEDGER_VERSION,
    actorActionCandidatesFromShard,
    actorLedgerView,
    classifyActorRegistryTargetName,
    applyAcceptedContentObservations,
    discoverActorsFromTurnSources,
    emptyActorLedger,
    mergeActorIdentityReveal,
    mergeActorProfilePatches,
    migrateActorLedgerFromContinuity,
    normalizeActorLedger,
    planActorAttemptRecovery,
    prepareActorActionAttempts,
    recordActorActionAttempts,
    runActorRegistryUpsert,
    promoteActorCandidatesToRegistry,
    reconcileActorIdentityRevealsFromAcceptedContent,
    reconcileActorLifecycleFromAcceptedContent,
    reconcileActorMutationLineageFromAcceptedContent,
    scheduleActorTurns,
    settleActorActionCandidates,
    settleActorInjectionReceipts,
} from '../actor-ledger-core.mjs';
import { makeActionReadyActor, makeActionReadyLedger } from './helpers/actor-action-ready-fixture.mjs';
import { parseActorProfileCompletionBatchOutput } from '../actor-profile-v6-core.mjs';

function settleWithWorld(ledger, candidates, options = {}) {
    const turn = Number(options.turn ?? ledger.turn) || 0;
    const target = options.target || sourceRef(turn, ledger.chatId);
    const prepared = prepareActorActionAttempts(ledger, candidates, {
        ...options,
        sourceRef: target,
        target,
    });
    const recorded = recordActorActionAttempts(prepared.ledger, prepared.attempts, { target });
    const recovered = planActorAttemptRecovery(recorded.ledger, { target });
    if (recorded.recorded.length !== recovered.attempts.length) {
        throw new Error(`fixture_recovery_mismatch:${JSON.stringify({
            recorded: recorded.recorded.length,
            recovered: recovered.attempts.length,
            mode: recovered.mode,
            ledger: recorded.ledger.actionAttempts,
        })}`);
    }
    const worldAdjudications = recovered.attempts
        .filter((attempt) => attempt.intent !== 'wait')
        .map((attempt) => ({
            attemptId: attempt.id,
            actorRef: attempt.actorRef,
            target: attempt.target,
            status: 'success',
            risk: 'the attempt may expose the actor or consume the stated resources',
            costs: ['one bounded action window'],
            actualResourceCosts: structuredClone(attempt.resourceCosts),
            durationTurns: 1,
            visibility: 'private',
            observerActorIds: [],
            publicSummary: '',
            privateSummary: `${attempt.action} receives a bounded private result`,
            resultSummary: `${attempt.action} receives a concrete world result`,
            observableConsequence: `${attempt.actorName || attempt.actorId} leaves a verifiable trace`,
            revealPath: 'the trace can be observed in the next relevant scene',
            appliedStateChanges: attempt.desiredEffects,
        }));
    const settled = settleActorActionCandidates(recovered.ledger, recovered.candidates, {
        ...options,
        attempts: recovered.attempts,
        target,
        worldAdjudications,
    });
    settled.rejected = [
        ...prepared.rejected,
        ...recorded.rejected.map((entry) => ({
            actorId: entry.actorId,
            reasons: [entry.reason],
        })),
        ...settled.rejected,
    ];
    return settled;
}

function sourceRef(index = 4, chatId = 'chat-actor-ledger') {
    return {
        chatId,
        messageId: `message-${index}`,
        index,
        logicalIndex: index,
        swipeId: 0,
        generation: index,
        generationSerial: index,
        generationId: `generation-${index}`,
        generationType: 'normal',
        identityScopeId: `${chatId}|character:synthetic`,
        scopeDigest: `scope:${chatId}|character:synthetic`,
        hash: `hash-${index}`,
        contentHash: `hash-${index}`,
        contentFingerprint: `fingerprint-${index}`,
    };
}

function discoverAndPromote(ledger, options = {}) {
    const discovery = discoverActorsFromTurnSources(ledger, options);
    const expectedSourceRef = discovery.candidates[0]?.sourceRef || options.sourceRef;
    const candidateRegistry = runActorRegistryUpsert(
        discovery.ledger,
        discovery.candidates,
        {
            chatId: discovery.ledger.chatId,
            identityScopeId: expectedSourceRef?.identityScopeId,
            scopeDigest: expectedSourceRef?.scopeDigest,
            allowScopeDigestFill: true,
            expectedSourceRef,
            turn: options.turn,
            excludedActorNames: options.excludedActorNames,
        },
    );
    return {
        discovery,
        registration: promoteActorCandidatesToRegistry(
            candidateRegistry.ledger,
            discovery.candidates,
            {
                chatId: discovery.ledger.chatId,
                identityScopeId: expectedSourceRef?.identityScopeId,
                scopeDigest: expectedSourceRef?.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef,
                turn: options.turn,
                excludedActorNames: options.excludedActorNames,
            },
        ),
    };
}

function actor(id, overrides = {}) {
    return {
        id,
        name: id,
        tier: 'secondary',
        status: 'active',
        identity: {
            role: '商人',
            aliases: [],
            traits: ['谨慎'],
            desires: ['维持商路'],
            boundaries: ['不伤害无辜'],
        },
        longTermGoals: ['维持商路'],
        currentGoals: ['按时交货'],
        knowledge: [],
        location: { name: '北港', sinceTurn: 1, evidence: ['fixture'] },
        resources: [{ id: 'coin', name: '银币', amount: 5 }],
        capabilities: ['交涉', '步行'],
        relationships: [],
        commitments: [],
        hidden: {
            emotionalInertia: ['担忧'],
            innerConflicts: ['利润与承诺冲突'],
            privateIntentions: ['避免公开冲突'],
        },
        plan: {
            summary: '前往仓库',
            steps: ['确认货物', '交货'],
            status: 'active',
        },
        lastAction: null,
        nextActionTurn: 2,
        deadlineTurn: 5,
        initiative: 2,
        opportunity: 1,
        silenceTurns: 0,
        attentionScore: 1,
        evidence: ['fixture'],
        version: 1,
        ...overrides,
    };
}

function readyActor(id, overrides = {}) {
    return makeActionReadyActor(actor(id, overrides), {
        turn: Number(overrides.createdTurn) || 1,
    });
}

function scopedLedger(chatId, value = {}) {
    const ref = sourceRef(0, chatId);
    const ledger = normalizeActorLedger({
        ...emptyActorLedger(chatId),
        ...value,
    }, {
        chatId,
        identityScopeId: ref.identityScopeId,
        scopeDigest: ref.scopeDigest,
        allowScopeDigestFill: true,
    });
    return makeActionReadyLedger(ledger, { sourceRef: ref, turn: ledger.turn || 1 });
}

test('ledger preserves only parser-trusted narrative first-literal discovery and orders distinct names by source offset', () => {
    const chatId = 'chat-narrative-first-literal';
    const target = sourceRef(5, chatId);
    const firstName = '\u7532\u4e00';
    const secondName = '\u4e59\u4e8c';
    const acceptedContent = `${firstName}\u5148\u5728\u901a\u9053\u51fa\u73b0\uff0c${secondName}\u7a0d\u540e\u52a0\u5165\uff0c${firstName}\u518d\u6b21\u63d0\u9192\u540c\u4f34\uff0c${secondName}\u4fdd\u6301\u8b66\u6212\u3002`;
    const titles = [
        '\u4eba\u7269\u4fe1\u606f', '\u751f\u7406\u7279\u5f81', '\u6027\u683c\u7279\u5f81', '\u8fc7\u5f80\u7ecf\u5386',
        '\u5f53\u524d\u72b6\u6001', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90',
    ];
    const block = (name) => [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${name}\u3011`,
        ...titles.map((title) => `\u3010${title}\u3011\u6b64\u5904\u4fdd\u7559\u5b8c\u6574\u81ea\u7136\u4e2d\u6587\u4eba\u7269\u6863\u6848\u6bb5\u843d\u3002`),
    ].join('\n');
    const parsed = parseActorProfileCompletionBatchOutput([
        block(secondName), block(firstName),
    ].join('\n'), {
        candidates: [],
        discoveryContext: { acceptedNarrative: acceptedContent, completionMode: 'full', sourceRef: target },
    });
    assert.equal(parsed.discoveries.length, 2);
    const trusted = discoverActorsFromTurnSources(emptyActorLedger(chatId), {
        acceptedContent,
        sourceRef: target,
        turn: 5,
        modelProfileDiscoveries: structuredClone(parsed.discoveries),
    });
    assert.deepEqual(trusted.candidates.map((candidate) => candidate.name), [firstName, secondName]);
    assert.deepEqual(trusted.modelProfileDiscoveries.map((entry) => entry.sourceOffset), [
        acceptedContent.indexOf(firstName), acceptedContent.indexOf(secondName),
    ]);
    assert.notEqual(trusted.candidates[0].candidateId, trusted.candidates[1].candidateId);
    assert.equal(
        Object.hasOwn(trusted.modelProfileDiscoveries[0], '__narrativeFirstLiteralProof'),
        false,
        'the short-lived parser proof cannot reach ledger output or persistence',
    );

    const replay = discoverActorsFromTurnSources(emptyActorLedger(chatId), {
        acceptedContent,
        sourceRef: target,
        turn: 5,
        modelProfileDiscoveries: structuredClone(parsed.discoveries),
    });
    assert.equal(replay.candidates.length, 2, 'the resolver is pure; caller-owned batch transaction controls dedupe');

    // Parsed discovery rows are ordinary in-call data, not a cross-target
    // proof store. The caller supplies the current frozen SourceRef when it
    // resolves them; only the literal anchor is revalidated here.
    const contentBatch = parseActorProfileCompletionBatchOutput(block(firstName), {
        candidates: [],
        discoveryContext: { acceptedNarrative: acceptedContent, completionMode: 'full', sourceRef: target },
    });
    const changedContent = acceptedContent.replace('\u901a\u9053', '\u5e7f\u573a');
    const rejectedContent = discoverActorsFromTurnSources(emptyActorLedger(chatId), {
        acceptedContent: changedContent,
        sourceRef: target,
        turn: 5,
        modelProfileDiscoveries: structuredClone(contentBatch.discoveries),
    });
    assert.equal(rejectedContent.candidates.length, 1, 'current-call rows are revalidated by literal name/anchor, not a persisted proof token');

    const repeatedLiteral = discoverActorsFromTurnSources(emptyActorLedger(chatId), {
        acceptedContent,
        sourceRef: target,
        turn: 5,
        modelProfileDiscoveries: [{
            candidate: { profileFormat: 'narrative-v1' },
            candidateRef: { name: firstName, sourceAnchor: firstName },
        }],
    });
    assert.equal(repeatedLiteral.candidates.length, 1);
    assert.equal(repeatedLiteral.candidates[0].name, firstName);
});

test('default and null actor projection limits retain every actor and Registry row', () => {
    const source = {
        ...emptyActorLedger('chat-projection-default'),
        actors: [
            actor('NPC-PROJECTION-1', { name: '投影甲' }),
            actor('NPC-PROJECTION-2', { name: '投影乙' }),
            actor('NPC-PROJECTION-3', { name: '投影丙' }),
        ],
    };
    for (const options of [{}, { maxActors: null }, { maxActors: undefined }]) {
        const ledger = normalizeActorLedger(source, options);
        assert.deepEqual(ledger.actors.map((entry) => entry.id), [
            'NPC-PROJECTION-1',
            'NPC-PROJECTION-2',
            'NPC-PROJECTION-3',
        ]);
        assert.equal(Object.keys(ledger.actorRegistry.registered).length, 3);
    }
});

test('explicit maxActors zero remains an empty compatibility projection', () => {
    const source = {
        ...emptyActorLedger('chat-projection-zero'),
        actors: [
            actor('NPC-PROJECTION-1', { name: '投影甲' }),
            actor('NPC-PROJECTION-2', { name: '投影乙' }),
        ],
    };
    const ledger = normalizeActorLedger(source, { maxActors: 0 });
    assert.deepEqual(ledger.actors, []);
    assert.deepEqual(ledger.actorRegistry.registered, {});
});

test('turn-source discovery creates candidates before deterministic registry promotion', () => {
    const userText = [
        '<act>',
        '### 罗伊',
        '- 动作: 观察四周',
        '### 神秘短发女人',
        '- 说话: 这里有一份悬赏',
        '### 陈锋',
        '- 动作: 护住林雨',
        '### 林雨',
        '- 动作: 留在陈锋身后',
        '</act>',
        '<scene>Day 1,00:12 | 地点：赛博都市街口 | 在场：罗伊、陈锋、林雨、士兵A、士兵B</scene>',
    ].join('\n');
    const { discovery, registration: result } = discoverAndPromote(
        emptyActorLedger('chat-discovery'), {
        userText,
        acceptedContent: '<content>【敌方档案：企业安保士兵A】</content>',
        knownActorNames: ['陈锋', '林雨', '王大锤', '企业安保士兵A', '企业安保士兵B'],
        excludedActorNames: ['罗伊'],
        sourceRef: sourceRef(12, 'chat-discovery'),
        turn: 6,
    });
    assert.equal(discovery.ledger.actors.length, 0, 'candidates cannot become formal actors');
    assert.ok(discovery.candidates.every((entry) => (
        entry.kind === 'actor_candidate' && entry.state === 'discovered'
    )));
    const names = result.ledger.actors.map((entry) => entry.name).sort();
    assert.deepEqual(names, ['企业安保士兵A']);
    assert.deepEqual(Object.keys(result.ledger.actorRegistry.characters).sort(), [
        '企业安保士兵B', '士兵A', '士兵B', '林雨', '王大锤', '神秘短发女人', '陈锋',
    ].sort());
    assert.equal(names.includes('罗伊'), false);
    for (const name of ['企业安保士兵A']) {
        assert.equal(
            result.ledger.actors.find((entry) => entry.name === name)?.location.name,
            '赛博都市街口',
        );
    }
    assert.equal(
        result.ledger.observationReceipts.some((entry) => entry.kind === 'actor-registration'),
        true,
    );
    assert.equal(Object.keys(result.ledger.actorRegistry.registered).length, names.length);
});

test('turn-source discovery ignores a guide explicitly converted into a system prompt', () => {
    const { registration: result } = discoverAndPromote(emptyActorLedger('chat-system-guide'), {
        userText: [
            '<act>',
            '### 新人引导者',
            '- 说话: 合成音（转为系统提示）',
            '### 林雨',
            '- 动作: 退到门后',
            '</act>',
        ].join('\n'),
        sourceRef: sourceRef(2, 'chat-system-guide'),
        turn: 2,
    });
    assert.deepEqual(result.ledger.actors.map((entry) => entry.name), []);
    assert.deepEqual(Object.keys(result.ledger.actorRegistry.characters), ['林雨']);
});

test('turn-source discovery never registers system broadcast headings as NPCs', () => {
    const { registration: result } = discoverAndPromote(
        emptyActorLedger('chat-system-broadcast'), {
        userText: [
            '<act>',
            '### 系统播报',
            'now：无 beat：无 initiative：无 then：等待玩家选择',
            '### 林雨',
            'now：靠在门边 beat：查看门锁 then：等待回应',
            '</act>',
            '<scene>Day 1,00:15 | 地点：废弃走廊 | 在场：Roy、林雨</scene>',
        ].join('\n'),
        knownActorNames: ['系统播报', '林雨'],
        excludedActorNames: ['Roy'],
        sourceRef: sourceRef(2, 'chat-system-broadcast'),
        turn: 2,
    });
    assert.deepEqual(result.ledger.actors.map((entry) => entry.name), []);
    assert.deepEqual(Object.keys(result.ledger.actorRegistry.characters), ['林雨']);
});

test('legacy continuity migration creates stable actors only from attributable non-hidden evidence', () => {
    const continuity = {
        turn: 7,
        updatedAt: 73,
        threads: [
            {
                id: 'PUBLIC',
                actors: ['艾达'],
                locations: ['北港'],
                stage: 'advancing',
                knowledge: 'observed',
                summary: '艾达公开接下了护送任务',
                nextBeat: '在第八日出发',
                seedBasis: 'message-4:hash-4',
                sourceRefs: [sourceRef()],
            },
            {
                id: 'SECRET',
                actors: ['艾达', '贝拉'],
                locations: ['密室'],
                stage: 'seeded',
                knowledge: 'hidden',
                summary: '贝拉其实是卧底',
                seedBasis: '不可传播的幕后真相',
                sourceRefs: [sourceRef(5)],
            },
        ],
    };
    const rawLedger = emptyActorLedger('chat-actor-ledger');
    rawLedger.updatedAt = 11;
    rawLedger.actorRegistry.updatedAt = 29;
    const migrated = migrateActorLedgerFromContinuity(
        rawLedger,
        continuity,
        { allowLegacyRegistration: true },
    );
    const repeated = migrateActorLedgerFromContinuity(
        rawLedger,
        continuity,
        { allowLegacyRegistration: true },
    );
    assert.deepEqual(repeated, migrated);
    assert.equal(migrated.updatedAt, continuity.updatedAt);
    assert.equal(migrated.actorRegistry.updatedAt, continuity.updatedAt);
    assert.deepEqual(migrated.actors.map((item) => item.name), ['艾达', '贝拉']);
    const ada = migrated.actors.find((item) => item.name === '艾达');
    const bella = migrated.actors.find((item) => item.name === '贝拉');
    assert.equal(ada.currentGoals.includes('在第八日出发'), false);
    assert.equal(ada.stimuli.some((item) => item.summary === '在第八日出发'), true);
    assert.equal(ada.knowledge.some((item) => item.claim.includes('护送任务')), true);
    assert.equal(ada.knowledge.some((item) => item.claim.includes('卧底')), false);
    assert.equal(bella.knowledge.some((item) => item.claim.includes('卧底')), false);
    assert.equal(migrated.migrations.continuityV5, true);
});

test('retired profile patch API rejects grounded input without touching profile or receipts', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 6,
        actors: [actor('ADA', {
            name: '艾达',
            identity: {
                role: '商人',
                aliases: [],
                traits: ['谨慎'],
                desires: [],
                boundaries: [],
            },
        })],
    });
    const merged = mergeActorProfilePatches(ledger, [{
        actorId: 'ADA',
        name: '艾达',
        evidence: ['她先核对交货清单，再问能否留一条撤离路线；她自称不擅长交涉，却用多年柜台经验安抚了争执'],
        identity: {
            role: '情报官',
            traits: ['谨慎', '好奇'],
            desires: ['按时完成自己的交货'],
            boundaries: ['不把同伴当诱饵'],
            socialStyle: '先保持礼貌距离，再用具体问题试探',
            decisionStyle: '先核价并确认退路',
            speechStyle: '句子短，通常先问条件',
            copingStyle: '压力上升时转向核对清单和可控步骤',
            informationStyle: '先核对书面清单，再用具体问题补缺口',
            typicalMisread: '容易把临时善意先当成附带条件的交易',
            relationshipDistancePattern: '先保持礼貌距离，确认对方履约后才主动靠近',
            selfImageGap: '自称不擅长交涉，实际能用柜台经验安抚争执',
            learnedCounterDisposition: '不喜欢临场交涉，却因多年柜台经验能稳住争执',
            pressureResponse: '压力上升时先缩小问题并核对可控步骤',
            recoveryPath: '确认退路和责任边界后恢复正常交流',
            everydayHabits: ['说话前摸一下清单边角'],
            blindSpots: ['低估临时起意的善意'],
        },
        longTermGoals: ['保住北港商路'],
        hidden: {
            innerConflicts: ['想帮助同伴但不愿承担无上限风险'],
        },
    }], {
        turn: 7,
        sourceRef: sourceRef(7),
        evidenceCorpus: '她先核对交货清单，再问能否留一条撤离路线；她自称不擅长交涉，却用多年柜台经验安抚了争执。',
    });
    assert.equal(merged.retired, true);
    assert.equal(merged.inputCount, 1);
    assert.equal(merged.processedCount, 1);
    assert.equal(merged.overflowCount, 0);
    assert.deepEqual(merged.accepted, []);
    assert.equal(merged.rejected[0].reason, 'actor_profile.legacy_patch_retired');
    assert.deepEqual(merged.ledger, ledger, 'retired API cannot write profile or receipt state');
    assert.equal(
        merged.ledger.observationReceipts.some((item) => item.kind === 'profile-enrichment'),
        false,
    );
});

test('retired profile patch API rejects every bounded item without resolving actor names', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        actors: [actor('ADA', { name: '艾达' })],
    });
    const merged = mergeActorProfilePatches(ledger, [
        { actorId: 'UNKNOWN', name: '陌生人', evidence: ['猜测'], identity: { traits: ['冷酷'] } },
        { actorId: 'ADA', name: '艾达', evidence: [], identity: { traits: ['绝望'] } },
    ]);
    assert.equal(merged.accepted.length, 0);
    assert.deepEqual(merged.rejected.map((item) => item.reason), [
        'actor_profile.legacy_patch_retired',
        'actor_profile.legacy_patch_retired',
    ]);
    assert.equal(merged.processedCount + merged.overflowCount, merged.inputCount);
    assert.deepEqual(merged.ledger.actors[0].identity.traits, ['谨慎']);
});

test('retired profile patch API explicitly accounts for overflow and invalid containers', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-profile-retired-bounds'),
        actors: [actor('ADA', { name: '艾达' })],
    });
    const patches = Array.from({ length: 40 }, (_, inputIndex) => ({
        actorId: `ACTOR-${inputIndex}`,
        name: `人物${inputIndex}`,
    }));
    const bounded = mergeActorProfilePatches(ledger, patches, { maxPatches: 3 });
    assert.equal(bounded.inputCount, 40);
    assert.equal(bounded.processedCount, 3);
    assert.equal(bounded.overflowCount, 37);
    assert.equal(bounded.processedCount + bounded.overflowCount, bounded.inputCount);
    assert.deepEqual(
        bounded.rejected.slice(0, 3).map((item) => item.reason),
        Array(3).fill('actor_profile.legacy_patch_retired'),
    );
    assert.deepEqual(bounded.rejected.at(-1), {
        actorId: '',
        inputIndex: 3,
        startIndex: 3,
        count: 37,
        total: 40,
        reason: 'actor_profile.legacy_patch_overflow',
    });
    assert.deepEqual(bounded.ledger, ledger);

    const invalid = mergeActorProfilePatches(ledger, { actorId: 'ADA' });
    assert.equal(invalid.inputCount, 0);
    assert.equal(invalid.processedCount, 0);
    assert.equal(invalid.overflowCount, 0);
    assert.equal(invalid.rejected[0].reason, 'actor_profile.legacy_patch_input_invalid');
    assert.deepEqual(invalid.accepted, []);
    assert.deepEqual(invalid.ledger, ledger);
});

test('retired consolidated patch mode cannot reinterpret legacy placeholder fields', () => {
    const evidence = '艾达在港口核对了货单。';
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-placeholders'),
        actors: [actor('ADA', {
            name: '艾达',
            identity: {
                role: '未登记',
                gender: '未设定',
                age: '未知',
                aliases: [],
                traits: [],
                desires: [],
                boundaries: [],
            },
        })],
    });
    const merged = mergeActorProfilePatches(ledger, [{
        actorId: 'ADA',
        name: '艾达',
        evidence: [evidence],
        identity: {
            role: '港口货运代理',
            gender: '女',
            age: '31岁',
        },
    }], {
        evidenceCorpus: evidence,
        mergeMode: 'consolidate',
    });
    assert.equal(merged.accepted.length, 0);
    assert.equal(merged.rejected[0].reason, 'actor_profile.legacy_patch_retired');
    assert.equal(merged.ledger.actors[0].identity.role, '未登记');
    assert.equal(merged.ledger.actors[0].identity.gender, '未设定');
    assert.equal(merged.ledger.actors[0].identity.age, '未知');
});

test('retired profile patch API rejects fabricated and formerly filtered profile payloads alike', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        actors: [actor('ADA', { name: '艾达' })],
    });
    const rejected = mergeActorProfilePatches(ledger, [{
        actorId: 'ADA',
        evidence: ['她残忍地威胁了所有人'],
        identity: { traits: ['冷酷'] },
    }], {
        evidenceCorpus: '艾达核对清单后询问了撤离路线。',
    });
    assert.equal(rejected.accepted.length, 0);
    assert.equal(rejected.rejected[0].reason, 'actor_profile.legacy_patch_retired');

    const filtered = mergeActorProfilePatches(ledger, [{
        actorId: 'ADA',
        evidence: ['艾达核对清单后询问了撤离路线'],
        identity: {
            traits: ['冷酷', 'INTJ 5w4 回避型依恋'],
            decisionStyle: '先核对事实，再为撤离保留余地',
            informationStyle: 'INTJ式直觉判断',
        },
    }], {
        evidenceCorpus: '艾达核对清单后询问了撤离路线。',
    });
    assert.equal(filtered.accepted.length, 0);
    assert.equal(filtered.rejected[0].reason, 'actor_profile.legacy_patch_retired');
    assert.equal(filtered.ledger.actors[0].identity.traits.includes('冷酷'), false);
    assert.equal(filtered.ledger.actors[0].identity.traits.includes('INTJ 5w4 回避型依恋'), false);
    assert.equal(filtered.ledger.actors[0].identity.informationStyle, '');
    assert.equal(filtered.ledger.actors[0].identity.decisionStyle, '');
});

test('v3 actor ledgers migrate to current semantic fields and Registry without inventing personality', () => {
    const legacy = {
        ...emptyActorLedger('chat-actor-ledger'),
        version: 3,
        migrations: { continuityV5: true, actorLedgerV2: true, actorLedgerV3: true },
        actors: [actor('ADA', {
            name: '艾达',
            identity: {
                role: '商人',
                aliases: [],
                traits: ['谨慎'],
                desires: ['按时交货'],
                boundaries: ['不拿同伴当诱饵'],
                copingStyle: '受压时先核对清单',
            },
        })],
    };
    const migrated = normalizeActorLedger(legacy);
    assert.equal(migrated.version, ACTOR_LEDGER_VERSION);
    assert.equal(migrated.migrations.actorLedgerV4, true);
    assert.equal(migrated.migrations.actorRegistryV1, true);
    assert.equal(Object.values(migrated.actorRegistry.registered)[0].actorRef.actorId, 'ADA');
    assert.equal(migrated.actors[0].identity.copingStyle, '受压时先核对清单');
    assert.equal(migrated.actors[0].identity.informationStyle, '');
    assert.equal(migrated.actors[0].identity.typicalMisread, '');
    assert.equal(migrated.actors[0].identity.relationshipDistancePattern, '');
    assert.equal(migrated.actors[0].identity.selfImageGap, '');
    assert.equal(migrated.actors[0].identity.learnedCounterDisposition, '');
    assert.equal(migrated.actors[0].identity.pressureResponse, '');
    assert.equal(migrated.actors[0].identity.recoveryPath, '');
});

test('retired profile patch API cannot extend an existing behavior pattern', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        actors: [actor('ADA', {
            name: '艾达',
            identity: {
                role: '商人', aliases: [], traits: [], desires: [], boundaries: [],
                informationStyle: '先查书面记录',
            },
        })],
    });
    const merged = mergeActorProfilePatches(ledger, [{
        actorId: 'ADA',
        evidence: ['记录缺页时，她转而询问亲历者并比较两份说法'],
        identity: { informationStyle: '记录缺页时询问亲历者并交叉比较说法' },
    }], {
        evidenceCorpus: '记录缺页时，她转而询问亲历者并比较两份说法。',
    });
    assert.equal(merged.accepted.length, 0);
    assert.equal(merged.rejected[0].reason, 'actor_profile.legacy_patch_retired');
    assert.equal(merged.ledger.actors[0].identity.informationStyle, '先查书面记录');
});

test('accepted content updates only named observers and excludes private/internal narration', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 3,
        actors: [actor('ADA', { name: '艾达' }), actor('BELLA', { name: '贝拉' })],
    });
    const next = applyAcceptedContentObservations(ledger, {
        content: '<content>艾达看见码头仓库起火。玩家心想钥匙藏在靴子里。贝拉不在场。</content>',
        sourceRef: sourceRef(6),
        observerActorIds: ['ADA'],
    });
    const ada = next.actors.find((item) => item.id === 'ADA');
    const bella = next.actors.find((item) => item.id === 'BELLA');
    assert.equal(ada.knowledge.some((item) => item.claim.includes('仓库起火')), true);
    assert.equal(ada.knowledge.some((item) => item.claim.includes('钥匙')), false);
    assert.equal(bella.knowledge.length, 0);
    assert.equal(next.observationReceipts.at(-1).observerActorIds.includes('ADA'), true);
});

test('accepted content writes back only direct observations and is idempotent for one target identity', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 3,
        actors: [actor('ADA', { name: '艾达' }), actor('BELLA', { name: '贝拉' })],
    });
    const payload = {
        content: [
            '<content>',
            '艾达看见码头仓库起火。',
            '贝拉在另一处密室把钥匙藏进靴子，艾达对此一无所知。',
            '旁白知道第三方候选准备伏击，但消息尚未传播。',
            '</content>',
        ].join(''),
        sourceRef: sourceRef(9),
        observerActorIds: ['ADA'],
    };
    const first = applyAcceptedContentObservations(ledger, payload);
    const second = applyAcceptedContentObservations(first, payload);
    const ada = second.actors.find((item) => item.id === 'ADA');
    assert.equal(ada.knowledge.some((item) => item.claim.includes('仓库起火')), true);
    assert.equal(ada.knowledge.some((item) => item.claim.includes('钥匙')), false);
    assert.equal(ada.knowledge.some((item) => item.claim.includes('伏击')), false);
    assert.equal(second.observationReceipts.length, 1);
});

test('identity reveal keeps the original stable actor id and merges aliases', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 4,
        actors: [actor('NPC-MASKED-01', {
            name: '蒙面女人',
            identity: {
                role: '身份未知',
                aliases: ['红围巾'],
                traits: [],
                desires: [],
                boundaries: [],
            },
        })],
    });
    const next = mergeActorIdentityReveal(ledger, {
        actorId: 'NPC-MASKED-01',
        revealedName: '艾达·王',
        aliases: ['蒙面女人', '红围巾'],
        evidence: ['message-10:hash-10'],
        turn: 5,
    });
    assert.equal(next.actors.length, 1);
    assert.equal(next.actors[0].id, 'NPC-MASKED-01');
    assert.equal(next.actors[0].name, '艾达·王');
    assert.equal(next.actors[0].identity.aliases.includes('蒙面女人'), true);
});

test('accepted identity reveal quarantines a registered name conflict and preserves both actors', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 5,
        actionAttempts: [{
            id: 'ATT-ADA-PRESERVE',
            actorId: 'NPC-ADA-DUPLICATE',
            status: 'settled',
            resultSummary: '既有行动历史不得因身份冲突丢失',
        }],
        actionReceipts: [{
            receiptId: 'REC-ADA-PRESERVE',
            actionId: 'ATT-ADA-PRESERVE',
            attemptId: 'ATT-ADA-PRESERVE',
            actorId: 'NPC-ADA-DUPLICATE',
            stage: 'world_settled',
            status: 'settled',
            resultSummary: '既有回执不得因身份冲突丢失',
            createdTurn: 5,
        }],
        actors: [
            actor('NPC-MASKED-01', { name: '蒙面女人' }),
            actor('NPC-ADA-DUPLICATE', {
                name: '艾达',
                relationships: [{ actorId: 'NPC-CONTACT', summary: '旧关系记录' }],
                actionHistory: [{
                    id: 'H-ADA',
                    turn: 4,
                    route: 'background_private',
                    attempt: '核对北港仓单',
                    resultStatus: 'settled',
                    resultSummary: '已核对一份仓单',
                    evidence: ['synthetic-history'],
                }],
                knowledge: [{
                    id: 'K-ADA',
                    claim: '北港仓库起火',
                    kind: 'reported',
                    confidence: 0.6,
                    learnedTurn: 5,
                    sourceRef: sourceRef(10),
                    propagation: [],
                }],
            }),
        ],
    });
    assert.equal(ledger.actors[1].relationships.length, 1);
    assert.equal(ledger.actors[1].actionHistory.length, 1);
    assert.equal(ledger.actionAttempts.length, 1);
    assert.equal(ledger.actionReceipts.length, 1);
    const next = reconcileActorIdentityRevealsFromAcceptedContent(ledger, {
        content: '<content>蒙面女人摘下面具，确认自己的真实身份是艾达。</content>',
        sourceRef: sourceRef(10),
    });
    assert.equal(next.actors.length, 2);
    assert.deepEqual(next.actors, ledger.actors);
    assert.deepEqual(next.actorRegistry.registered, ledger.actorRegistry.registered);
    assert.deepEqual(next.actionAttempts, ledger.actionAttempts);
    assert.deepEqual(next.actionReceipts, ledger.actionReceipts);
    const conflict = next.identityQuarantine.find((item) => (
        item.reason === 'actor_candidate.alias_conflict' && item.name === '艾达'
    ));
    assert.ok(conflict);
    assert.deepEqual(
        new Set(conflict.conflictingActorIds),
        new Set(['NPC-MASKED-01', 'NPC-ADA-DUPLICATE']),
    );
    assert.equal(next.actors.find((item) => item.id === 'NPC-ADA-DUPLICATE')
        .knowledge.some((item) => item.id === 'K-ADA'), true);
});

test('identity reveal also quarantines an exact registered alias owner', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 5,
        actors: [
            actor('NPC-MASKED-ALIAS', { name: '戴帽旅人' }),
            actor('NPC-ADA-ALIAS-OWNER', {
                name: '艾达·王',
                identity: {
                    role: '商人',
                    aliases: ['艾达'],
                    traits: ['谨慎'],
                    desires: ['维持商路'],
                    boundaries: ['不伤害无辜'],
                },
            }),
        ],
    });
    const next = mergeActorIdentityReveal(ledger, {
        actorId: 'NPC-MASKED-ALIAS',
        revealedName: '艾达',
        evidence: ['message-11:hash-11'],
        sourceRef: sourceRef(11),
        turn: 6,
    });
    assert.deepEqual(next.actors, ledger.actors);
    assert.deepEqual(next.actorRegistry.registered, ledger.actorRegistry.registered);
    const conflict = next.identityQuarantine.find((item) => item.name === '艾达');
    assert.equal(conflict.reason, 'actor_candidate.alias_conflict');
    assert.deepEqual(
        new Set(conflict.conflictingActorIds),
        new Set(['NPC-MASKED-ALIAS', 'NPC-ADA-ALIAS-OWNER']),
    );
});

test('migration excludes player system environment and group labels from the actor pool', () => {
    const migrated = migrateActorLedgerFromContinuity(
        emptyActorLedger('chat-actor-ledger'),
        {
            turn: 7,
            threads: [{
                id: 'PUBLIC',
                actors: ['艾达', '玩家', '系统', '环境', '码头商会'],
                locations: ['北港'],
                stage: 'advancing',
                knowledge: 'observed',
                summary: '公开调度信息。',
                nextBeat: '第八日出发',
                seedBasis: 'message-4:hash-4',
                sourceRefs: [sourceRef()],
            }],
        },
        { allowLegacyRegistration: true },
    );
    assert.deepEqual(migrated.actors.map((item) => item.name), ['艾达']);
});

test('Registry row keys accept stable literal individual labels while rejecting structural non-actors', () => {
    for (const name of ['\u6821\u957f', '\u9ed1\u5e02\u5546\u4eba', '\u58eb\u5175A', '\u53d7\u4f24\u7684\u8b66\u536b', '\u53d7\u4f24\u7684\u5546\u6237']) {
        assert.equal(classifyActorRegistryTargetName(name), '', name);
    }
    for (const name of ['\u4ed6\u4eec', '\u4f17\u4eba', '\u67d0\u67d0', '\u7cfb\u7edf\u63d0\u793a', '\u67d0\u67d0\u516c\u53f8']) {
        assert.notEqual(classifyActorRegistryTargetName(name), '', name);
    }
    for (const vague of ['\u8def\u4eba', '\u964c\u751f\u4eba', '\u7537\u4eba', '\u5973\u4eba', '\u5b69\u5b50', '\u8001\u4eba']) {
        assert.notEqual(classifyActorRegistryTargetName(vague), '', vague);
    }
});

test('runtime migration removes the named player and converts event beats into stimuli instead of goals', () => {
    const existing = normalizeActorLedger({
        ...emptyActorLedger('chat-player-filter'),
        turn: 14,
        actors: [
            actor('PLAYER-ROY', { name: 'Roy', currentGoals: ['Roy决定下一步行动'] }),
            actor('GROUP', { name: '恶魔旅团' }),
            actor('VALEN', {
                name: '瓦伦',
                currentGoals: ['Roy联系瓦伦后再决定如何处置'],
            }),
        ],
    });
    const migrated = migrateActorLedgerFromContinuity(existing, {
        chatId: 'chat-player-filter',
        turn: 30,
        threads: [{
            id: 'EVT-VALEN',
            actors: ['Roy', '瓦伦', '恶魔旅团'],
            locations: ['哈克南宅邸'],
            knowledge: 'observed',
            summary: '瓦伦已经回家接受治疗。',
            nextBeat: '等待Roy主动联系瓦伦。',
            trigger: 'Roy决定是否召唤瓦伦。',
            seedBasis: 'synthetic-valen-branch',
            sourceRefs: [sourceRef(30)],
        }],
    }, { excludedActorNames: ['Roy'] });
    assert.deepEqual(migrated.actors.map((item) => item.name), ['瓦伦']);
    assert.deepEqual(migrated.actors[0].currentGoals, []);
    assert.equal(migrated.actors[0].constraints.length, 1);
    assert.equal(migrated.actors[0].constraints.every((item) => /Roy/u.test(item)), true);
    assert.equal(migrated.actors[0].stimuli.length, 2);
    assert.equal(migrated.actors[0].stimuli.every((item) => /Roy/u.test(item.summary)), true);
});

test('mutation-form identity conflict is quarantined without merging registered actors', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-actor-ledger'),
        turn: 12,
        actors: [
            actor('NPC-GAO', { name: '高阳' }),
            actor('NPC-MUTANT-DUP', { name: '暴食者·生化温床' }),
        ],
    });
    const next = reconcileActorMutationLineageFromAcceptedContent(ledger, {
        content: '<content>高阳在病毒冲击下异变为暴食者·生化温床。</content>',
        sourceRef: sourceRef(13),
    });
    assert.equal(next.actors.length, 2);
    assert.deepEqual(next.actors, ledger.actors);
    assert.deepEqual(next.actorRegistry.registered, ledger.actorRegistry.registered);
    const conflict = next.identityQuarantine.find((item) => (
        item.reason === 'actor_candidate.alias_conflict'
        && item.name === '暴食者·生化温床'
    ));
    assert.ok(conflict);
    assert.deepEqual(
        new Set(conflict.conflictingActorIds),
        new Set(['NPC-GAO', 'NPC-MUTANT-DUP']),
    );
});

test('death departure sleep and wake transitions stop or resume scheduling without reviving the dead', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        turn: 8,
        actors: [
            readyActor('NPC-ADA', { name: '艾达', nextActionTurn: 8 }),
            readyActor('NPC-BELLA', { name: '贝拉', nextActionTurn: 8 }),
            readyActor('NPC-CARLO', { name: '卡洛', nextActionTurn: 8 }),
        ],
    });
    const terminal = reconcileActorLifecycleFromAcceptedContent(ledger, {
        content: '<content>艾达已经死亡。贝拉已经离开港区。卡洛陷入昏迷。</content>',
        sourceRef: sourceRef(11),
    });
    assert.equal(terminal.actors.find((item) => item.id === 'NPC-ADA').status, 'deceased');
    assert.equal(terminal.actors.find((item) => item.id === 'NPC-BELLA').status, 'departed');
    assert.equal(terminal.actors.find((item) => item.id === 'NPC-CARLO').status, 'dormant');
    assert.equal(scheduleActorTurns(terminal, { turn: 8, maxActors: 3 }).selected.length, 0);

    const woke = reconcileActorLifecycleFromAcceptedContent(terminal, {
        content: '<content>卡洛苏醒并重新回到岗位。艾达的尸体被搬走。</content>',
        sourceRef: sourceRef(12),
    });
    assert.equal(woke.actors.find((item) => item.id === 'NPC-CARLO').status, 'active');
    assert.equal(woke.actors.find((item) => item.id === 'NPC-ADA').status, 'deceased');
    assert.deepEqual(
        scheduleActorTurns(woke, { turn: 9, maxActors: 3 }).selected.map((item) => item.actorId),
        ['NPC-CARLO'],
    );
});

test('an observed terminal death sequence cannot become an offscreen survival action', () => {
    const ledger = normalizeActorLedger({
        ...emptyActorLedger('chat-observed-death'),
        turn: 3,
        actors: [actor('ZHANG', { name: '张伟', nextActionTurn: 3 })],
    });
    const terminal = reconcileActorLifecycleFromAcceptedContent(ledger, {
        content: [
            '<content>',
            '张伟挤进方块门后，门内立刻传出沉重利刃切开血肉的声音。',
            '一截断裂的手指从门缝滚出，鲜血喷在地面上。',
            '张伟的惨叫声在几秒内越来越微弱，最终彻底归于死寂。',
            '这是一条人命验证出的死路。',
            '</content>',
        ].join(''),
        sourceRef: sourceRef(4),
    });
    assert.equal(terminal.actors[0].status, 'deceased');
    assert.deepEqual(scheduleActorTurns(terminal, { turn: 4, maxActors: 1 }).selected, []);
});

test('scheduler prioritizes due/deadline/commitment and reserves a bounded low-attention exploration slot', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        turn: 10,
        actors: [
            readyActor('NPC-DUE', {
                nextActionTurn: 10,
                deadlineTurn: 10,
                commitments: [{ id: 'C1', summary: '今夜交货', dueTurn: 10, status: 'open' }],
            }),
            readyActor('NPC-POPULAR', {
                nextActionTurn: 20,
                attentionScore: 99,
                initiative: 3,
            }),
            readyActor('NPC-QUIET', {
                tier: 'background',
                status: 'dormant',
                nextActionTurn: 30,
                attentionScore: 0,
                silenceTurns: 20,
                opportunity: 2,
            }),
        ],
    });
    const schedule = scheduleActorTurns(ledger, {
        turn: 10,
        maxActors: 2,
        explorationSlots: 1,
    });
    assert.deepEqual(schedule.selected.map((item) => item.actorId), ['NPC-DUE', 'NPC-QUIET', 'NPC-POPULAR']);
    assert.equal(schedule.selected[0].reasons.includes('action-due'), true);
    assert.equal(schedule.selected[1].slot, 'priority');
});

test('scheduler keeps every due or overdue actor in must selection beyond optional 6/10 prompt budgets', () => {
    const ledger = scopedLedger('chat-all-due', {
        turn: 20,
        actors: Array.from({ length: 12 }, (_, index) => readyActor(`NPC-DUE-${index + 1}`, {
            nextActionTurn: 20,
            deadlineTurn: index === 10 ? 20 : 0,
            commitments: index === 11
                ? [{ id: 'C-LAST', summary: '后台承诺到期', dueTurn: 20, status: 'open' }]
                : [],
            lastSemanticTurn: 1,
            silenceTurns: 20,
        })),
    });
    const schedule = scheduleActorTurns(ledger, {
        turn: 20,
        maxActors: 2,
        explorationSlots: 1,
    });
    assert.equal(schedule.selected.length, 12);
    assert.deepEqual(
        new Set(schedule.selected.map((entry) => entry.actorId)),
        new Set(ledger.actors.map((actor) => actor.id)),
    );
    assert.equal(schedule.deferredActorIds.length, 0);
});

test('scheduler makes active-goal starvation and overdue commitments must actors without reading goal prose', () => {
    const ledger = scopedLedger('chat-goal-clock', {
        turn: 20,
        actors: [
            readyActor('NPC-GOAL', {
                nextActionTurn: 99,
                currentGoals: ['守住旧承诺'],
                plan: { status: 'active', summary: '既有计划' },
                lastSemanticTurn: 1,
                silenceTurns: 20,
            }),
            readyActor('NPC-COMMIT', {
                nextActionTurn: 99,
                commitments: [{ id: 'C-DUE', summary: '到期承诺', dueTurn: 20, status: 'open' }],
                lastSemanticTurn: 19,
                silenceTurns: 0,
            }),
        ],
    });
    const schedule = scheduleActorTurns(ledger, { turn: 20, maxActors: 0, explorationSlots: 0 });
    assert.deepEqual(new Set(schedule.selected.map((entry) => entry.actorId)), new Set(['NPC-GOAL', 'NPC-COMMIT']));
    assert.equal(schedule.selected.find((entry) => entry.actorId === 'NPC-GOAL').reasons.includes('current-goal-due'), true);
    assert.equal(schedule.selected.find((entry) => entry.actorId === 'NPC-COMMIT').reasons.includes('commitment-due'), true);
});

test('local settlement blocks player sovereignty, teleportation, unknown facts and overspending', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        turn: 4,
        actors: [readyActor('NPC-ADA', {
            name: '艾达',
            knowledge: [{
                id: 'K1',
                claim: '北港仓库起火',
                kind: 'observed',
                confidence: 1,
                learnedTurn: 3,
                sourceRef: sourceRef(3),
                propagation: [],
            }],
        })],
    });
    const common = {
        actorId: 'NPC-ADA',
        actorName: '艾达',
        intent: 'execute',
        time: { turn: 4, window: 'now' },
        location: { from: '北港', to: '北港', travelTurns: 0 },
        action: '艾达寄出一封求助信',
        actionWindow: '本轮后台行动窗口',
        expectedCost: '一枚银币和一次行动机会',
        expectedDuration: '一轮',
        expectedRisk: '信件可能无人回应并留下可追踪痕迹',
        observableConsequence: '信件送达旅店',
        stateChanges: [{ kind: 'commitment', summary: '求助信已经寄出，等待对方处理' }],
        knowledgeRefs: ['K1'],
        resourceCosts: [{ resourceId: 'coin', amount: 1 }],
        capabilityUsed: '交涉',
        contact: { mode: 'letter', target: '玩家', observableConsequence: '信件送达旅店' },
        planUpdate: '等待回信',
        waitCondition: '',
        evidence: ['K1'],
    };
    const result = settleWithWorld(ledger, [
        common,
        { ...common, action: '艾达让玩家接受委托并支付十枚银币' },
        {
            ...common,
            action: '艾达瞬间抵达南境并购买坐骑',
            location: { from: '北港', to: '南境', travelTurns: 0 },
            resourceCosts: [{ resourceId: 'coin', amount: 99 }],
        },
        { ...common, knowledgeRefs: ['UNKNOWN'], evidence: ['UNKNOWN'] },
    ], { turn: 4 });
    assert.equal(result.accepted.length, 1, JSON.stringify(result.rejected));
    assert.equal(result.rejected.length, 3);
    assert.deepEqual(
        new Set(result.rejected.flatMap((item) => item.reasons)),
        new Set([
            'player-sovereignty',
            'location-or-travel-invalid',
            'resource-insufficient',
            'knowledge-out-of-bounds',
            'evidence-out-of-bounds',
        ]),
    );
});

test('proposal mapping normalizes travel structure without changing destination or world authority', () => {
    const actor = readyActor('NPC-TRAVEL', { name: '旅人' });
    const ledger = scopedLedger('chat-travel-normalization', {
        turn: 4,
        actors: [actor],
    });
    const proposal = {
        actorId: actor.id,
        candidateAction: '旅人按既有路线前往南境查验公开路标',
        intent: 'execute',
        time: '本轮后台行动窗口',
        location: '南境',
        travelTurns: 0,
        expectedCost: '一次行动机会',
        expectedDuration: '至少一轮',
        expectedRisk: '途中可能暴露行踪',
        observableConsequence: '南境路标附近留下可见足迹',
        stateChanges: [{ kind: 'plan', summary: '开始沿路线前往南境查验路标' }],
        knowledgeBasis: [],
        resourceCosts: [],
        evidence: actor.evidence,
        capabilityUsed: '',
        planUpdate: '到达后查验路标',
    };
    const [different] = actorActionCandidatesFromShard(ledger, [proposal], { turn: 4 });
    assert.equal(different.location.from, actor.location.name);
    assert.equal(different.location.to, '南境');
    assert.equal(different.location.travelTurns, 1);
    const prepared = prepareActorActionAttempts(ledger, [different], {
        turn: 4,
        sourceRef: sourceRef(4, ledger.chatId),
        target: sourceRef(4, ledger.chatId),
    });
    assert.equal(prepared.rejected.length, 0, JSON.stringify(prepared.rejected));
    assert.equal(prepared.attempts.length, 1);
    assert.equal(
        Object.hasOwn(prepared.attempts[0], 'worldAdjudicationResult'),
        false,
        'local normalization only admits an ATT candidate; world outcome remains independently absent',
    );

    const proposalWithoutExplicitObservable = { ...proposal };
    delete proposalWithoutExplicitObservable.observableConsequence;
    const [locallyRepaired] = actorActionCandidatesFromShard(
        ledger,
        [proposalWithoutExplicitObservable],
        { turn: 4 },
    );
    const repairedAttempt = prepareActorActionAttempts(ledger, [locallyRepaired], {
        turn: 4,
        sourceRef: sourceRef(4, ledger.chatId),
        target: sourceRef(4, ledger.chatId),
    });
    assert.equal(repairedAttempt.rejected.length, 0, JSON.stringify(repairedAttempt.rejected));
    assert.equal(repairedAttempt.attempts.length, 1);
    assert.equal(
        repairedAttempt.attempts[0].expectedObservableConsequence,
        proposal.stateChanges[0].summary,
        'the documented proposal shape must remain ATT-usable when the model omits the redundant observable field',
    );
    assert.equal(
        Object.hasOwn(repairedAttempt.attempts[0], 'worldAdjudicationResult'),
        false,
        'local expectation repair must never fabricate a world outcome',
    );

    const [same] = actorActionCandidatesFromShard(ledger, [{
        ...proposal,
        location: actor.location.name,
        travelTurns: 8,
    }], { turn: 4 });
    assert.equal(same.location.to, actor.location.name);
    assert.equal(same.location.travelTurns, 0);

    const [stillInvalid] = actorActionCandidatesFromShard(ledger, [{
        ...proposal,
        actorId: 'UNKNOWN-ACTOR',
    }], { turn: 4 });
    const rejected = prepareActorActionAttempts(ledger, [stillInvalid], {
        turn: 4,
        sourceRef: sourceRef(4, ledger.chatId),
        target: sourceRef(4, ledger.chatId),
    });
    assert.equal(rejected.attempts.length, 0);
    assert.ok(rejected.rejected.length > 0);
});

test('due actor must execute, replan, or wait on a concrete unmet condition and receives full receipts', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        turn: 5,
        actors: [readyActor('NPC-ADA', { name: '艾达', nextActionTurn: 5 })],
    });
    const invalidWait = settleWithWorld(ledger, [{
        actorId: 'NPC-ADA',
        actorName: '艾达',
        intent: 'wait',
        time: { turn: 5, window: 'now' },
        location: { from: '北港', to: '北港', travelTurns: 0 },
        action: '等待',
        stateChanges: [],
        knowledgeRefs: [],
        resourceCosts: [],
        capabilityUsed: '',
        contact: null,
        planUpdate: '',
        waitCondition: '暂时不动',
        evidence: ['fixture'],
    }], { turn: 5 });
    assert.equal(invalidWait.accepted.length, 0);
    assert.equal(invalidWait.rejected[0].reasons.includes('wait-condition-not-concrete'), true);

    const executed = settleWithWorld(ledger, [{
        actorId: 'NPC-ADA',
        actorName: '艾达',
        intent: 'execute',
        time: { turn: 5, window: 'now' },
        location: { from: '北港', to: '北港', travelTurns: 0 },
        action: '艾达把公开告示贴到北港布告栏',
        actionWindow: '本轮后台行动窗口',
        expectedCost: '一枚银币和一次行动机会',
        expectedDuration: '一轮',
        expectedRisk: '公开行动可能暴露艾达的所在位置',
        observableConsequence: '布告栏出现告示',
        stateChanges: [{ kind: 'environment', summary: '北港布告栏新增一张公开告示' }],
        knowledgeRefs: [],
        resourceCosts: [{ resourceId: 'coin', amount: 1 }],
        capabilityUsed: '交涉',
        contact: {
            mode: 'public_notice',
            target: '北港居民',
            observableConsequence: '布告栏出现告示',
        },
        planUpdate: '等待线索',
        waitCondition: '',
        evidence: ['fixture'],
    }], { turn: 5 });
    assert.equal(executed.accepted.length, 1, JSON.stringify(executed.rejected));
    assert.equal(executed.worldEvents.length, 1);
    assert.deepEqual(
        executed.ledger.actionReceipts.map((item) => item.stage),
        ['attempted', 'world_settled', 'injected'],
    );
    assert.equal(executed.ledger.actors[0].resources[0].amount, 4);
    const persisted = normalizeActorLedger(executed.ledger);
    const history = persisted.actors[0].actionHistory.at(-1);
    assert.deepEqual(history.cost, ['one bounded action window']);
    assert.equal(history.durationTurns, 1);
    assert.match(history.risk, /expose the actor/u);
    assert.match(history.resultSummary, /receives a concrete world result/u);
    assert.match(history.observableConsequence, /verifiable trace/u);
    assert.equal(history.worldAdjudicated, true);
    const receipt = persisted.actionReceipts.find((item) => item.stage === 'world_settled');
    assert.deepEqual(receipt.costs, ['one bounded action window']);
    assert.match(receipt.resultSummary, /receives a concrete world result/u);
    assert.equal(receipt.worldAdjudicated, true);
});

test('injection settlement marks observable consequences consumed and keeps unrelated actions private', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        actionReceipts: [
            {
                receiptId: 'R1',
                actionId: 'A1',
                actorId: 'ADA',
                stage: 'injected',
                status: 'pending',
                observableConsequence: '布告栏出现告示',
                createdTurn: 5,
                target: sourceRef(7),
            },
            {
                receiptId: 'R2',
                actionId: 'A2',
                actorId: 'BELLA',
                stage: 'world_settled',
                status: 'settled',
                observableConsequence: '',
                createdTurn: 5,
            },
        ],
    });
    const next = settleActorInjectionReceipts(ledger, {
        content: '<content>旅店门口的布告栏出现告示，引起了议论。</content>',
        sourceRef: sourceRef(7),
    });
    assert.equal(next.actionReceipts.find((item) => item.receiptId === 'R1').status, 'consumed');
    assert.equal(next.actionReceipts.find((item) => item.receiptId === 'R2').stage, 'world_settled');
    assert.equal(actorLedgerView(next).privateThoughtsExposed, false);
});

test('actor injection receipts are settled only by the exact generation branch and swipe', () => {
    const ledger = scopedLedger('chat-actor-ledger', {
        actionReceipts: [{
            receiptId: 'R-BRANCH',
            actionId: 'A-BRANCH',
            actorId: 'ADA',
            stage: 'injected',
            status: 'pending',
            observableConsequence: '布告栏出现告示',
            createdTurn: 5,
            target: {
                ...sourceRef(20),
                swipeId: 1,
                generation: 4,
                generationSerial: 4,
            },
        }],
    });
    const stale = settleActorInjectionReceipts(ledger, {
        content: '<content>布告栏出现告示。</content>',
        sourceRef: {
            ...sourceRef(20),
            swipeId: 0,
            generation: 3,
            generationSerial: 3,
        },
    });
    assert.equal(stale.actionReceipts[0].status, 'pending');
    const exact = settleActorInjectionReceipts(stale, {
        content: '<content>布告栏出现告示。</content>',
        sourceRef: {
            ...sourceRef(20),
            swipeId: 1,
            generation: 4,
            generationSerial: 4,
        },
    });
    assert.equal(exact.actionReceipts[0].status, 'consumed');
});

test('optional exploration stays bounded while all due actors bypass that budget', () => {
    const ledger = scopedLedger('chat-long-actor-ledger', {
        actors: Array.from({ length: 12 }, (_, index) => ({ ...readyActor(`NPC-${index + 1}`, {
            tier: index < 2 ? 'secondary' : 'background',
            nextActionTurn: 200,
            lastSemanticTurn: 79,
            silenceTurns: 0,
            attentionScore: index < 2 ? 50 : 0,
            deadlineTurn: 0,
            commitments: [],
            lastAction: null,
            lastAttemptTurn: 80,
            lastSemanticTurn: 80,
        }), currentGoals: [], plan: { status: 'idle' } })),
    });
    const optional = scheduleActorTurns(ledger, {
        turn: 80,
        maxActors: 2,
        explorationSlots: 1,
    });
    assert.equal(optional.selected.length <= 2, true);
    const dueLedger = structuredClone(ledger);
    dueLedger.actors.forEach((actor) => { actor.nextActionTurn = 80; });
    const due = scheduleActorTurns(dueLedger, {
        turn: 80,
        maxActors: 2,
        explorationSlots: 1,
    });
    assert.equal(due.selected.length, 12);
    assert.equal(due.deferredActorIds.length, 0);
});

test('production scheduler consumes operational pending, cooldown, outcome, blocker and open-thread state', () => {
    const turn = 20;
    const ledger = scopedLedger('chat-operational-scheduler', {
        turn,
        actors: [
            readyActor('NPC-PENDING', { nextActionTurn: turn, attentionScore: 50 }),
            readyActor('NPC-COOLDOWN', { nextActionTurn: turn, attentionScore: 49 }),
            readyActor('NPC-REPLAN', { nextActionTurn: turn, attentionScore: 10 }),
            readyActor('NPC-NORMAL', { nextActionTurn: turn, attentionScore: 9 }),
        ],
    });
    const schedule = scheduleActorTurns(ledger, {
        turn, maxActors: 2, explorationSlots: 0,
        operationalStatesByActorId: {
            'NPC-PENDING': {
                actionable: true, profileReady: true, lastAttempt: { id: 'ATT-PENDING' },
                lastAttemptTurn: turn, lastAction: null, lastOutcome: '',
                lastOutcomeStatus: '', lastAttemptPending: true,
                blocker: '', openThreads: [], cooldownUntilTurn: turn,
            },
            'NPC-COOLDOWN': {
                actionable: true, profileReady: true, lastAttempt: null,
                lastAttemptTurn: 0, lastAction: null, lastOutcome: '', lastOutcomeStatus: '',
                blocker: '', openThreads: [], cooldownUntilTurn: turn + 2,
            },
            'NPC-REPLAN': {
                actionable: true, profileReady: true, lastAttempt: null,
                lastAttemptTurn: turn - 3,
                lastAction: '旧行动', lastOutcome: '受阻', lastOutcomeStatus: 'blocked',
                blocker: '北门封锁', openThreads: [{ id: 'THREAD-OPEN' }],
                cooldownUntilTurn: turn,
            },
            'NPC-NORMAL': {
                actionable: true, profileReady: true, lastAttempt: null,
                lastAttemptTurn: 0, lastAction: null, lastOutcome: '', lastOutcomeStatus: '',
                blocker: '', openThreads: [], cooldownUntilTurn: turn,
            },
        },
    });
    const ids = schedule.selected.map((entry) => entry.actorId);
    assert.deepEqual(new Set(ids), new Set(['NPC-REPLAN', 'NPC-NORMAL']));
    const replan = schedule.selected.find((entry) => entry.actorId === 'NPC-REPLAN');
    assert.equal(replan.reasons.includes('operational-blocker-replan'), true);
    assert.equal(replan.reasons.includes('operational-open-thread'), true);
    assert.equal(replan.reasons.includes('operational-last-outcome-replan'), true);
    assert.equal(ids.includes('NPC-PENDING'), false);
    assert.equal(ids.includes('NPC-COOLDOWN'), false);
});

test('an all-worker technical failure leaves character silence plans and failure counters untouched', () => {
    let ledger = scopedLedger('chat-failed-workers', {
        turn: 20,
        actors: ['A', 'B', 'C'].map((id) => readyActor(`NPC-${id}`, {
            name: `人物${id}`,
            nextActionTurn: 1,
            lastSemanticTurn: 1,
            silenceTurns: 12,
            lastAttemptTurn: 0,
        })),
    });
    const first = scheduleActorTurns(ledger, {
        turn: 20,
        maxActors: 1,
        explorationSlots: 0,
    });
    ledger = settleActorActionCandidates(ledger, [], {
        turn: 20,
        attemptedActorIds: first.selected.map((item) => item.actorId),
    }).ledger;
    const next = scheduleActorTurns(ledger, {
        turn: 21,
        maxActors: 1,
        explorationSlots: 0,
    });
    assert.equal(next.selected[0].actorId, first.selected[0].actorId);
    assert.equal(
        ledger.actors.find((item) => item.id === first.selected[0].actorId)
            .consecutiveActionFailures,
        0,
    );
    assert.equal(ledger.actors.every((item) => item.silenceTurns === 12), true);
});

test('diagnostic actor ledger projection excludes narrative dossier prose and pending dossier bodies', () => {
    const actor = makeActionReadyActor({
        id: 'NPC-NARRATIVE-DIAG',
        name: '\u8bca\u65ad\u4eba\u7269',
        status: 'active',
    });
    const canary = 'NARRATIVE_PRIVATE_CANARY_DO_NOT_EXPORT';
    actor.profileV6.profileFormat = 'narrative-v1';
    actor.profileV6.narrativeSections = {
        person: { key: 'person', title: '\u4eba\u7269\u4fe1\u606f', text: canary, source: 'hypothesis', evidence: [] },
    };
    actor.pendingProfile = {
        transactionId: 'pending-diagnostic', readbackVerified: false,
        profileV6: { narrativeSections: { person: { text: canary } } },
    };
    const view = actorLedgerView({ chatId: 'diag-narrative', actors: [actor] });
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes(canary), false);
    assert.deepEqual(view.actors[0].pendingProfile, {
        transactionId: 'pending-diagnostic', readbackVerified: false,
    });
    assert.equal(view.actors[0].profileV6.narrativeSections, undefined);
});
