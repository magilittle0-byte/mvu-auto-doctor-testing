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
        generationSerial: generation,
        logicalIndex: generation,
        identityScopeId: `${chatId}|character:card-main`,
        scopeDigest: `scope:${chatId}|character:card-main`,
        hash: `hash-${chatId}-${generation}`,
        contentHash: `hash-${chatId}-${generation}`,
        contentFingerprint: `hash-${chatId}-${generation}`,
        compatibilityOnly: false,
    };
}

function narrativeDiscoverySourceRef(ref) {
    return {
        ...ref,
        logicalIndex: ref.index,
        generationSerial: ref.generation,
        contentHash: ref.hash,
        contentFingerprint: ref.hash,
    };
}

function registryPreflight(fixture, acceptedNarrative, {
    excludedActorNames = [],
} = {}) {
    const source = narrativeDiscoverySourceRef(fixture.ref);
    return async ({ discoveries }) => {
        const discovered = discoverActorsFromTurnSources(fixture.ledger, {
            acceptedContent: acceptedNarrative,
            excludedActorNames,
            sourceRef: source,
            turn: fixture.ref.generation,
            modelProfileDiscoveries: structuredClone(discoveries),
        });
        const upsert = runActorRegistryUpsert(discovered.ledger, discovered.candidates, {
            chatId: fixture.ledger.chatId,
            identityScopeId: fixture.ref.identityScopeId,
            scopeDigest: fixture.ref.scopeDigest,
            allowScopeDigestFill: true,
            expectedSourceRef: fixture.ref,
            turn: fixture.ref.generation,
            excludedActorNames,
        });
        const failures = [...(discovered.unresolved || []), ...(upsert.quarantined || [])];
        const deterministic = new Set([
            'actor_candidate.identity_missing_or_short',
            'actor_candidate.identity_system',
            'actor_candidate.identity_group',
            'actor_candidate.identity_excluded',
            'actor_candidate.identity_internal_id',
            'actor_candidate.identity_registry_conflict',
        ]);
        const validCandidateCount = (upsert.inserted || []).length + (upsert.updated || []).length;
        return {
            ok: failures.length === 0 && discovered.candidates.length === discoveries.length,
            failures,
            validCandidateCount,
            allDiscoveriesDeterministicallyInvalid: discoveries.length > 0
                && validCandidateCount === 0
                && failures.length > 0
                && failures.every((entry) => deterministic.has(entry.reason)),
        };
    };
}

const NARRATIVE_SECTION_TITLES = [
    '\u4eba\u7269\u4fe1\u606f', '\u751f\u7406\u7279\u5f81', '\u6027\u683c\u7279\u5f81', '\u8fc7\u5f80\u7ecf\u5386',
    '\u5f53\u524d\u72b6\u6001', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90',
];

function narrativeProfileBlock(name, {
    actorId = '',
    omitTitle = '',
    extra = '',
} = {}) {
    return [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${name}\u3011`,
        actorId ? `ActorRef: ${actorId}` : '',
        ...NARRATIVE_SECTION_TITLES
            .filter((title) => title !== omitTitle)
            .map((title) => `\u3010${title}\u3011\u4fdd\u6301\u5b8c\u6574\u7684\u81ea\u7136\u4e2d\u6587\u6863\u6848\u6bb5\u843d\u3002`),
        extra,
    ].filter(Boolean).join('\n');
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
        scopeDigest: ref.scopeDigest,
        allowScopeDigestFill: true,
        expectedSourceRef: ref,
        turn: ref.generation,
    });
    const registration = promoteActorCandidatesToRegistry(
        upsert.ledger,
        discovery.candidates,
        {
            chatId: ledger.chatId,
            identityScopeId: ref.identityScopeId,
            scopeDigest: ref.scopeDigest,
            allowScopeDigestFill: true,
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
    const profile = {
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
    // This synthetic row remains subject to the same production quality floor
    // as real batch output; the long fields make that floor explicit.
    return {
        ...profile,
        identity: {
            ...profile.identity,
            pastExperience: `${name} has spent several years reconciling community supplies, routes, handovers, and the consequences of missed commitments.`,
        },
        personality: {
            ...profile.personality,
            biography: `${name} starts by sorting evidence, names the cost of each option, and changes course openly when a small test contradicts an earlier assumption. This habit grew from repeated responsibility for shared work, not from a claim to control anyone else.`,
            primaryDerivatives: [
                'This person compares people, time, resources, and a reversible exit before committing.',
                'This person offers bounded work and leaves every partner free to choose.',
            ],
            baseDerivatives: [
                'This person checks hidden cost, missing evidence, and a practical revision.',
                'This person corrects the record and next step without denying a mistake.',
            ],
            accentDerivatives: [
                'This person makes a small joke, then returns to evidence and responsibility.',
                'This person lets a failed joke go without turning embarrassment into anger.',
            ],
            primarySentence: 'I will first separate what we know from what still needs a small, checkable test.',
            baseSentence: 'I can listen to every view, but the final choice must still follow the available evidence.',
            accentSentence: 'At least this list did not lose me too, so we can fix the next line together.',
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
        initialActorIds: priorityActorIds,
        maintenanceMaxActors: profileCapacity || 1,
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
    persistPendingBatch = null,
    persistFinalizedBatch = null,
    semanticRetry = true,
    isTargetCurrent = () => true,
    allowDiscovery = false,
    discoveryContext = null,
    preflightDiscoveries = async () => ({ ok: true, failures: [] }),
    resolveDiscoveries = null,
    moduleProtocol = false,
} = {}) {
    let saveCount = 0;
    let readbackCount = 0;
    const persistencePayloads = [];
    const persisted = async (payload) => {
        persistencePayloads.push(structuredClone(payload));
        if (persistBatch) return persistBatch(payload);
        saveCount += 1;
        readbackCount += 1;
        return { ok: true, ledger: structuredClone(payload.ledger), persistenceMeta: { rev: 1 } };
    };
    // Historical assertions below still describe the pre-module fixture shape.
    // Keep their evidence useful through a test-only adapter; production has
    // no legacy dossier fallback. New module-group tests call the transaction
    // directly and assert the wire protocol itself.
    let cachedLegacy = null;
    let cachedAttempt = -1;
    const legacyModuleText = (candidate, key) => {
        const narrative = candidate?.narrativeSections?.[key]?.text;
        if (narrative) return `${narrative} ${'这是测试适配器保留的完整自然中文模块内容。'.repeat(4)}`;
        const source = key === 'person' ? candidate?.identity
            : key === 'personality' ? candidate?.personality
                : key === 'history' ? candidate?.identity?.pastExperience
                    : key === 'currentState' ? candidate?.goals
                        : key === 'relationshipsMotives' ? { relationships: candidate?.relationships, goals: candidate?.goals }
                            : key === 'knowledgeCapabilitiesResources' ? { knowledge: candidate?.knowledge, resources: candidate?.resourcesCapabilities }
                                : candidate?.physiology;
        return `这是测试适配器投影的${key}模块：${JSON.stringify(source || {})}。${'内容保持自然、完整并可供行动使用。'.repeat(4)}`;
    };
    const adaptedRequestBatch = async (args) => {
        if (!args.groupKey) return requestBatch(args);
        if (args.groupKey === 'identity_bootstrap' && (cachedAttempt !== args.attempt || !cachedLegacy)) {
            const raw = await requestBatch(args);
            cachedAttempt = args.attempt;
            if (/^\s*无人(?:物)?档案/u.test(String(raw || ''))) {
                cachedLegacy = { explicitEmpty: true, entries: [], discoveries: [] };
            } else {
                cachedLegacy = parseActorProfileCompletionBatchOutput(raw, {
                    candidates: args.candidates,
                    discoveryContext,
                });
            }
        }
        if (!cachedLegacy) {
            const raw = await requestBatch(args);
            cachedAttempt = args.attempt;
            cachedLegacy = parseActorProfileCompletionBatchOutput(raw, {
                candidates: args.candidates,
                discoveryContext,
            });
        }
        if (cachedLegacy.explicitEmpty) return '无人物档案';
        const parsedRows = [
            ...(cachedLegacy.entries || []).map((entry) => ({ actorId: entry.actorId, name: entry.name, candidate: entry.candidate })),
            ...(cachedLegacy.discoveries || []).map((entry) => ({ actorId: 'new', name: entry.candidateRef?.name, candidate: entry.candidate })),
        ];
        const rows = args.groupKey === 'identity_bootstrap'
            ? parsedRows
            : args.candidates.map((candidate) => {
                const name = candidate.actorRef?.name || candidate.name;
                const parsed = parsedRows.find((entry) => entry.name === name);
                return parsed ? { ...parsed, actorId: candidate.actorRef?.actorId || candidate.actorId } : null;
            }).filter(Boolean);
        return rows.map((row) => [
            `<profile-target actor="${row.actorId}" name="${row.name}">`,
            ...args.moduleKeys.map((key) => `<module key="${key}">${legacyModuleText(row.candidate, key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n');
    };
    const result = await completeActorProfileBatchTransaction({
        ledger: fixture.ledger,
        candidates: fixture.candidates,
        evidenceText: '这是完全合成的P1档案测试材料。',
        turn: fixture.ref.generation,
        target: { ...fixture.ref, sourceRef: fixture.ref },
        semanticRetry,
        allowDiscovery,
        discoveryContext,
        preflightDiscoveries,
        requestBatch: moduleProtocol ? requestBatch : adaptedRequestBatch,
        resolveDiscoveries: resolveDiscoveries || (async () => ({
            ok: true,
            ledger: structuredClone(fixture.ledger),
            candidates: [],
            entries: [],
            rejected: [],
            failures: [],
            registry: fixture.registration,
            snapshot: { fieldRevision: 0 },
        })),
        persistPendingBatch: persistPendingBatch || persisted,
        persistFinalizedBatch: persistFinalizedBatch || persisted,
        isTargetCurrent,
    });
    return { result, saveCount, readbackCount, persistencePayloads };
}

function assertSingleAtomicPeerReadback(run, actorId) {
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
    assert.equal(run.persistencePayloads.length, 2);
    const [pendingSave, finalSave] = run.persistencePayloads;
    const pendingActor = pendingSave.ledger.actors.find((actor) => actor.id === actorId);
    const finalActor = finalSave.ledger.actors.find((actor) => actor.id === actorId);
    assert.ok(pendingActor?.pendingProfile);
    assert.equal(pendingActor.pendingProfile.readbackVerified, false);
    assert.equal(pendingActor.profileV6.baselineCommit, null);
    assert.equal(pendingActor.profileV6.preparedForAction, false);
    assert.equal(finalActor?.pendingProfile, null);
    assert.equal(finalActor?.profileV6.baselineCommit?.readbackVerified, true);
    assert.equal(finalActor?.profileV6.preparedForAction, true);
    assert.equal(actorProfileReadyForAction(finalActor), true);
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
        assert.equal(run.saveCount, count ? 2 : 0);
        assert.equal(run.readbackCount, count ? 2 : 0);
        assert.equal(run.result.accepted.length, count);
        if (count) {
            assert.equal(run.persistencePayloads.length, 2);
            const [pendingSave, finalSave] = run.persistencePayloads;
            const pendingProfiles = pendingSave.ledger.actors.map((actor) => actor.pendingProfile);
            const pending = pendingProfiles[0];
            assert.equal(pendingProfiles.length, count);
            assert.ok(pending?.transactionId, 'pending transaction must have an identity');
            assert.ok(pending?.writeSetDigest, 'pending transaction must bind its full write set');
            assert.ok(pending?.preparedLedgerDigest, 'pending transaction must bind its prepared ledger');
            assert.equal(pending?.writeSet.length, count, 'pending transaction must carry the full batch');
            assert.deepEqual(
                pending?.writeSet.map((entry) => entry.actorRef.actorId).sort(),
                pendingSave.ledger.actors.map((actor) => actor.id).sort(),
                'pending write set must cover every staged actor exactly once',
            );
            for (const [index, actor] of pendingSave.ledger.actors.entries()) {
                const staged = actor.pendingProfile;
                assert.ok(
                    staged
                    && staged.readbackVerified === false
                    && actor.profileV6.preparedForAction === false
                    && actor.profileV6.baselineCommit === null,
                    'first persistence is the sealed pending projection, never a live profile replacement',
                );
                assert.equal(staged.transactionId, pending.transactionId);
                assert.equal(staged.writeSetDigest, pending.writeSetDigest);
                assert.equal(staged.preparedLedgerDigest, pending.preparedLedgerDigest);
                assert.equal(staged.preparedFieldRevision, pending.preparedFieldRevision);
                assert.deepEqual(staged.writeSet, pending.writeSet);
                assert.equal(staged.actorRef.actorId, actor.id);
                for (const entry of staged.writeSet) {
                    assert.ok(entry.sourceRef, `pending write set ${index} must retain its source ref`);
                    assert.ok(entry.scopeDigest, `pending write set ${index} must retain its scope digest`);
                    assert.deepEqual(
                        entry.sourceRef,
                        fixture.ref,
                        `pending write set ${index} must retain the complete canonical source ref`,
                    );
                    assert.equal(entry.sourceRef.scopeDigest, entry.scopeDigest);
                    assert.equal(entry.scopeDigest, fixture.ref.scopeDigest);
                }
            }
            for (const actor of finalSave.ledger.actors) {
                const finalCommit = actor.profileV6.baselineCommit;
                const verification = finalCommit?.verification;
                const staged = pendingProfiles.find((entry) => entry?.actorRef.actorId === actor.id);
                assert.ok(
                    actor.pendingProfile === null
                    && actor.profileV6.preparedForAction === true
                    && finalCommit?.readbackVerified === true
                    && actorProfileReadyForAction(actor),
                    'only the second readback publishes the finalized action-ready profile',
                );
                assert.ok(verification, 'final baseline commit must retain pending verification metadata');
                assert.equal(verification.transactionId, staged.transactionId);
                assert.equal(verification.writeSetDigest, staged.writeSetDigest);
                assert.equal(verification.preparedLedgerDigest, staged.preparedLedgerDigest);
                assert.equal(verification.preparedFieldRevision, staged.preparedFieldRevision);
                assert.equal(verification.commitId, staged.commitId);
                assert.equal(verification.profileDigest, staged.profileDigest);
                assert.deepEqual(verification.writeSet, staged.writeSet);
            }
        }
        const refreshed = normalizeActorLedger(structuredClone(run.result.ledger), {
            chatId: fixture.ledger.chatId,
        });
        assert.equal(refreshed.actors.length, count);
        assert.ok(refreshed.actors.every(actorProfileReadyForAction));
        if (count) {
            const first = refreshed.actors[0];
            assert.equal(first.relationships.length, 0, 'natural modules do not fabricate structured relationship facts');
            assert.equal(first.knowledge.length, 0, 'natural modules do not fabricate structured knowledge facts');
            assert.equal(first.resources.length, 0, 'natural modules do not fabricate structured resource facts');
            assert.ok(first.profileV6.narrativeSections.relationshipsMotives.text.length > 70);
            assert.ok(first.profileV6.narrativeSections.knowledgeCapabilitiesResources.text.length > 70);
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
    assert.equal(run.saveCount, 2, 'all three complete profiles commit through pending and final atomic readbacks');
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

test('TavernDB-compatible quote normalization recovers full-width CJK JSON quotes locally', () => {
    const fixture = prepareRegisteredBatch(1);
    let quote = 0;
    const output = JSON.stringify([completeCandidate(fixture.candidates[0])])
        .replace(/"/gu, () => (quote++ % 2 === 0 ? '「' : '」'));
    const parsed = parseActorProfileCompletionBatchOutput(output, {
        candidates: fixture.candidates,
    });
    assert.equal(parsed.entries.length, 1);
    assert.ok(parsed.batchMeta.repairLabels.includes('fullwidth_quote_normalized'));
});

test('TavernDB loose-value subset repairs nested single quotes and an object comma locally', () => {
    const fixture = prepareRegisteredBatch(1);
    const candidate = completeCandidate(fixture.candidates[0]);
    let loose = JSON.stringify([candidate])
        .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/gu, '$1:')
        .replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gu, (_match, value) => `'${value}'`);
    loose = loose.replace(
        /(actorRef:\s*\{[^{}]*\}),(\s*identity:)/u,
        '$1$2',
    );
    const parsed = parseActorProfileCompletionBatchOutput(loose, {
        candidates: fixture.candidates,
    });
    assert.equal(parsed.entries.length, 1);
    assert.ok(parsed.batchMeta.repairLabels.includes('loose_single_quotes_normalized'));
    assert.ok(parsed.batchMeta.repairLabels.includes('loose_missing_property_comma_added'));
});

test('embedded profile containers require a complete matching JSON value', () => {
    const fixture = prepareRegisteredBatch(1);
    const suffixCandidate = completeCandidate(fixture.candidates[0]);
    suffixCandidate.personality.primaryDerivatives = `${JSON.stringify(
        suffixCandidate.personality.primaryDerivatives,
    )} trailing prose`;
    const suffixParsed = parseActorProfileCompletionBatchOutput(JSON.stringify([suffixCandidate]), {
        candidates: fixture.candidates,
    });
    assert.equal(suffixParsed.entries.length, 0);
    assert.equal(suffixParsed.failures.length, 1);
    assert.equal(suffixParsed.batchMeta.repairLabels.includes('embedded_profile_container_parsed'), false);

    const proseCandidate = completeCandidate(fixture.candidates[0]);
    proseCandidate.personality.primaryDerivatives = '{"ordinary":"prose, not a derivative list"}';
    const proseParsed = parseActorProfileCompletionBatchOutput(JSON.stringify([proseCandidate]), {
        candidates: fixture.candidates,
    });
    assert.equal(proseParsed.entries.length, 0);
    assert.equal(proseParsed.failures.length, 1);
    assert.equal(proseParsed.batchMeta.repairLabels.includes('embedded_profile_container_parsed'), false);

    const quotedBatch = JSON.stringify(JSON.stringify([completeCandidate(fixture.candidates[0])]));
    const quotedParsed = parseActorProfileCompletionBatchOutput(quotedBatch, {
        candidates: fixture.candidates,
    });
    assert.equal(quotedParsed.entries.length, 0);
    assert.equal(quotedParsed.failures.length, 1);
    assert.equal(quotedParsed.batchMeta.repairLabels.includes('embedded_profile_container_parsed'), false);

    const escapedQuoted = '"ordinary prose with an escaped \\"[{not:a,profile:b}]\\" marker"';
    const escapedParsed = parseActorProfileCompletionBatchOutput(escapedQuoted, {
        candidates: fixture.candidates,
    });
    assert.equal(escapedParsed.entries.length, 0);
    assert.equal(escapedParsed.failures.length, 1);
});

test('discovery format replacement keeps discovery enabled while subset retries stay retry-only', () => {
    const acceptedNarrative = '新人1 enters the scene.';
    const replacement = buildActorProfileCompletionMessages([], {
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            discoveryEnabled: true,
            discoveryRetryOnly: false,
        },
    });
    const replacementSystem = replacement.find((message) => message.role === 'system').content;
    const replacementUser = replacement.find((message) => message.role === 'user').content;
    assert.equal(replacementSystem.includes('不得重新发现正文人物'), false);
    assert.ok(replacementUser.includes('最终正文'));
    assert.ok(replacementSystem.includes('逐字复用'));
    assert.equal(replacementSystem.includes('唯一精确出现'), false);
    assert.equal(replacementUser.includes('candidateRef.sourceAnchor'), false);

    const subset = buildActorProfileCompletionMessages([], {
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            discoveryEnabled: true,
            discoveryRetryOnly: true,
        },
        discoveryRetryTargets: [{ name: '新人1', sourceAnchor: acceptedNarrative }],
    });
    const subsetSystem = subset.find((message) => message.role === 'system').content;
    assert.ok(subsetSystem.includes('不得重新发现正文人物'));
});

test('rowless nonempty batch output keeps only bounded parse metadata', () => {
    const parsed = parseActorProfileCompletionBatchOutput('not a profile array', {
        candidates: [],
    });
    assert.deepEqual(parsed.batchMeta, {
        rootType: 'other',
        parsedRowCount: 0,
        explicitEmpty: false,
        emptyOutput: false,
        formatUnrecoverable: true,
        repairLabels: [],
    });
    assert.equal(parsed.entries.length, 0);
    assert.equal(parsed.failures.length, 0);
    assert.equal(parsed.unexpected.length, 0);
});

test('rowless current-source discovery response gets one full replacement and then atomic readback', async () => {
    const fixture = prepareRegisteredBatch(1);
    const resolvedCandidates = structuredClone(fixture.candidates);
    const anchor = `新人1 enters the scene.`;
    const discoveryRow = completeCandidate(fixture.candidates[0]);
    delete discoveryRow.actorRef;
    discoveryRow.candidateRef = {
        name: fixture.candidates[0].actorRef.name,
        sourceAnchor: anchor,
    };
    const calls = [];
    let resolverCalls = 0;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative: anchor, completionMode: 'full' },
        requestBatch: ({ candidates, attempt }) => {
            calls.push({ attempt, count: candidates.length });
            return attempt === 0 ? 'not a profile array' : JSON.stringify([discoveryRow]);
        },
        resolveDiscoveries: async ({ discoveries }) => {
            resolverCalls += 1;
            assert.equal(discoveries.length, 1);
            return {
                ok: true,
                ledger: structuredClone(fixture.ledger),
                candidates: structuredClone(resolvedCandidates),
                entries: [{
                    actorRef: structuredClone(resolvedCandidates[0].actorRef),
                    candidate: structuredClone(discoveries[0].candidate),
                }],
                rejected: [],
                failures: [],
                registry: fixture.registration,
                snapshot: { fieldRevision: 0 },
            };
        },
    });
    assert.deepEqual(calls, [{ attempt: 0, count: 0 }, { attempt: 1, count: 0 }]);
    assert.equal(resolverCalls, 1);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.result.batchMeta.protocol, 'module-groups-v1');
    assert.equal(run.saveCount, 2);
});

test('a valid identity retry still fails closed when resolver drops its discovery', async () => {
    const fixture = prepareRegisteredBatch(1);
    const registered = fixture.candidates[0];
    const literalName = '\u6b63\u6587\u65b0\u4eba';
    const successfulDiscoveryName = '\u5df2\u51fa\u573a\u540c\u4f34';
    const acceptedNarrative = `${literalName}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c\u4e0e${successfulDiscoveryName}\u4fdd\u6301\u8b66\u89c9\u3002`;
    const calls = [];
    const run = await runBatch(fixture, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        requestBatch: ({ candidates, attempt, messages }) => {
            calls.push({
                attempt,
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
                messages,
            });
            return attempt === 0
                ? [
                    narrativeProfileBlock(registered.actorRef.name, { actorId: registered.actorRef.actorId }),
                    narrativeProfileBlock(successfulDiscoveryName),
                    narrativeProfileBlock('\u865a\u6784\u540d\u5b57'),
                ].join('\n')
                : narrativeProfileBlock(literalName);
        },
    });
    assert.deepEqual(calls.map(({ attempt, actorIds }) => ({ attempt, actorIds })), [
        { attempt: 0, actorIds: [registered.actorRef.actorId] },
    ]);
    assert.equal(run.result.modelCalls, 3);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
});

test('invalid narrative discovery rows fail closed before Registry or profile persistence', async () => {
    const fixture = prepareRegisteredBatch(0);
    const literalName = '\u6b63\u6587\u65b0\u4eba';
    const acceptedNarrative = `${literalName}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c\u4fdd\u6301\u8b66\u89c9\u3002`;
    const initial = narrativeProfileBlock('\u865a\u6784\u540d\u5b57');
    const legacyTemplate = completeCandidate(prepareRegisteredBatch(1).candidates[0]);
    delete legacyTemplate.actorRef;
    legacyTemplate.candidateRef = { name: literalName, sourceAnchor: literalName };
    const cases = [
        ['missing', '\u65e0\u4eba\u7269\u6863\u6848'],
        ['extra', [narrativeProfileBlock(literalName), narrativeProfileBlock('\u53e6\u4e00\u540d')].join('\n')],
        ['duplicate', [narrativeProfileBlock(literalName), narrativeProfileBlock(literalName)].join('\n')],
        ['actor-ref-mixed', narrativeProfileBlock(literalName, { actorId: 'NPC-UNEXPECTED' })],
        ['still-missing', narrativeProfileBlock('\u4ecd\u662f\u865a\u6784\u540d')],
        ['legacy-json', JSON.stringify([legacyTemplate])],
    ];
    for (const [label, replacement] of cases) {
        const calls = [];
        let resolverCalls = 0;
        const run = await runBatch({ ...fixture, candidates: [] }, {
            allowDiscovery: true,
            discoveryContext: {
                acceptedNarrative,
                completionMode: 'full',
                sourceRef: narrativeDiscoverySourceRef(fixture.ref),
            },
            requestBatch: ({ attempt }) => {
                calls.push(attempt);
                return attempt === 0 ? initial : replacement;
            },
            resolveDiscoveries: async () => {
                resolverCalls += 1;
                return {
                    ok: true,
                    ledger: structuredClone(fixture.ledger),
                    candidates: [],
                    entries: [],
                    rejected: [],
                    failures: [],
                    registry: fixture.registration,
                    snapshot: { fieldRevision: 0 },
                };
            },
        });
        assert.deepEqual(calls, [0, 1], label);
        assert.ok(run.result.modelCalls >= 2 && run.result.modelCalls <= 4, label);
        assert.equal(run.result.persistenceStatus, 'not_completed', label);
        assert.equal(run.result.readbackVerified, false, `${label}: must not issue a P3 no-candidate permit`);
        assert.deepEqual(
            run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1).map((entry) => entry.groupKey),
            ['identity_bootstrap'],
            label,
        );
        assert.equal(resolverCalls, 1, label);
        assert.equal(run.saveCount, 0, label);
        assert.equal(run.readbackCount, 0, label);
        assert.equal(run.persistencePayloads.length, 0, label);
        assert.equal(run.result.accepted.length, 0, label);
        assert.equal(run.result.ledger.actors.some((actor) => actor.name === literalName), false, label);
    }
});

test('a rejected narrative discovery blocks a first-pass ActorRef peer from durable commit', async () => {
    const fixture = prepareRegisteredBatch(1);
    const registered = fixture.candidates[0];
    const literalName = '\u6b63\u6587\u65b0\u4eba';
    const acceptedNarrative = `${literalName}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c\u4fdd\u6301\u8b66\u89c9\u3002`;
    const legacyTemplate = completeCandidate(registered);
    delete legacyTemplate.actorRef;
    legacyTemplate.candidateRef = { name: literalName, sourceAnchor: literalName };
    const calls = [];
    let resolverCalls = 0;
    const run = await runBatch(fixture, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        requestBatch: ({ attempt, candidates }) => {
            calls.push({ attempt, actorIds: candidates.map((candidate) => candidate.actorRef.actorId) });
            return attempt === 0
                ? [
                    narrativeProfileBlock(registered.actorRef.name, { actorId: registered.actorRef.actorId }),
                    narrativeProfileBlock('\u865a\u6784\u540d\u5b57'),
                ].join('\n')
                : JSON.stringify([legacyTemplate]);
        },
        resolveDiscoveries: async ({ discoveries, unresolved }) => {
            resolverCalls += 1;
            assert.equal(discoveries.length, 0);
            assert.match(unresolved[0].reason, /^actor_profile\.discovery_/u);
            return {
                ok: true,
                ledger: structuredClone(fixture.ledger),
                candidates: [],
                entries: [],
                rejected: [],
                failures: [],
                registry: fixture.registration,
                snapshot: { fieldRevision: 0 },
            };
        },
    });
    assert.deepEqual(calls, [{ attempt: 0, actorIds: [registered.actorRef.actorId] }]);
    assert.equal(resolverCalls, 1);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.accepted.length, 0);
    assert.equal(run.saveCount, 0);
    assert.deepEqual(run.result.ledger, fixture.ledger);
    assert.equal(run.result.ledger.actors.some((actor) => actor.name === literalName), false);
    assert.equal(run.persistencePayloads.every((payload) => (
        payload.ledger.actors.every((actor) => actor.name !== literalName)
    )), true);
    assert.ok(run.result.failures.length > 0);
});

test('a rejected narrative discovery blocks a first-pass discovery peer from durable promotion', async () => {
    const fixture = prepareRegisteredBatch(0);
    const successfulDiscoveryName = '\u5df2\u51fa\u573a\u540c\u4f34';
    const literalName = '\u6b63\u6587\u65b0\u4eba';
    const acceptedNarrative = `${successfulDiscoveryName}\u4e0e${literalName}\u90fd\u51fa\u73b0\u5728\u8d70\u5eca\u3002`;
    const promoted = registerNames(
        fixture.ledger,
        [successfulDiscoveryName],
        narrativeDiscoverySourceRef(fixture.ref),
    );
    const promotedPrepared = prepareActorLedgerProfilesV6(promoted.registration.ledger, {
        mode: 'full',
        turn: fixture.ref.generation,
    });
    const promotedCandidate = selectActorProfileCompletionCandidates(promotedPrepared.ledger, {
        maxActors: 1,
        turn: fixture.ref.generation,
    })[0];
    const legacyTemplate = completeCandidate(prepareRegisteredBatch(1).candidates[0]);
    delete legacyTemplate.actorRef;
    legacyTemplate.candidateRef = { name: literalName, sourceAnchor: literalName };
    const calls = [];
    let resolverCalls = 0;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        requestBatch: ({ attempt, candidates }) => {
            calls.push({ attempt, actorIds: candidates.map((candidate) => candidate.actorRef.actorId) });
            return attempt === 0
                ? [
                    narrativeProfileBlock(successfulDiscoveryName),
                    narrativeProfileBlock('\u865a\u6784\u540d\u5b57'),
                ].join('\n')
                : JSON.stringify([legacyTemplate]);
        },
        resolveDiscoveries: async ({ discoveries, unresolved }) => {
            resolverCalls += 1;
            assert.equal(discoveries.length, 1);
            assert.equal(discoveries[0].candidateRef.name, successfulDiscoveryName);
            assert.match(unresolved[0].reason, /^actor_profile\.discovery_/u);
            return {
                ok: true,
                ledger: structuredClone(promotedPrepared.ledger),
                candidates: [structuredClone(promotedCandidate)],
                entries: [{
                    actorRef: structuredClone(promotedCandidate.actorRef),
                    candidate: structuredClone(discoveries[0].candidate),
                }],
                rejected: [],
                failures: [],
                registry: promoted.registration,
                snapshot: { fieldRevision: 0 },
            };
        },
    });
    assert.deepEqual(calls, [{ attempt: 0, actorIds: [] }]);
    assert.equal(resolverCalls, 1);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.accepted.length, 0);
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.ledger.actors.length, 0, 'the S0 group has no promoted discovery peer');
    assert.equal(run.result.ledger.actors.some((actor) => actor.name === literalName), false);
    assert.equal(run.persistencePayloads.every((payload) => (
        payload.ledger.actors.every((actor) => actor.name !== literalName)
    )), true);
    assert.ok(run.result.failures.length > 0 || run.result.rejected.length > 0);
});

test('valid existing plus valid discovery silently dropped by resolver keeps the whole group at S0', async () => {
    const malformedFixture = prepareRegisteredBatch(0);
    const literalName = '\u6b63\u6587\u65b0\u4eba';
    const acceptedNarrative = `${literalName}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c\u4fdd\u6301\u8b66\u89c9\u3002`;
    const malformed = await runBatch({ ...malformedFixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(malformedFixture.ref),
        },
        requestBatch: () => narrativeProfileBlock('\u865a\u6784\u540d\u5b57', {
            omitTitle: NARRATIVE_SECTION_TITLES[0],
        }),
    });
    assert.equal(malformed.result.modelCalls, 2);
    assert.equal(malformed.saveCount, 0);

    const mixedCalls = [];
    const mixed = await runBatch({ ...malformedFixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative: `${acceptedNarrative}\n\u53e6\u4e00\u4eba\u4e5f\u5728\u73b0\u573a\u3002`,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(malformedFixture.ref),
        },
        requestBatch: ({ attempt }) => {
            mixedCalls.push(attempt);
            return [
                narrativeProfileBlock('\u865a\u6784\u540d\u5b57'),
                narrativeProfileBlock('\u53e6\u4e00\u4eba', { extra: '\u3010\u672a\u77e5\u6bb5\u3011\u4e0d\u80fd\u9759\u9ed8\u541e\u6389\u3002' }),
            ].join('\n');
        },
    });
    assert.deepEqual(mixedCalls, [0]);
    assert.equal(mixed.result.modelCalls, 3);
    assert.equal(mixed.saveCount, 0);

    const fixture = prepareRegisteredBatch(1);
    const registered = fixture.candidates[0];
    const calls = [];
    const moduleText = (label) => `${label}。${'这是完整自然中文模块内容，包含足够稳定细节与限制。'.repeat(5)}`;
    const combined = await runBatch(fixture, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        requestBatch: ({ attempt, candidates, groupKey, moduleKeys }) => {
            calls.push({ attempt, groupKey, actorIds: candidates.map((candidate) => candidate.actorRef.actorId) });
            const rows = candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n'));
            if (groupKey === 'identity_bootstrap') rows.push([
                `<profile-target actor="new" name="${literalName}">`,
                `<module key="person">${moduleText('人物信息')}</module>`,
                '</profile-target>',
            ].join('\n'));
            return rows.join('\n');
        },
        resolveDiscoveries: async ({ discoveries }) => ({
            ok: true,
            ledger: structuredClone(fixture.ledger),
            candidates: [],
            entries: [],
            rejected: [],
            failures: [],
            registry: fixture.registration,
            snapshot: { fieldRevision: 0 },
        }),
    });
    assert.equal(combined.result.modelCalls, 3);
    assert.deepEqual(combined.result.batchMeta.moduleGroups.map((entry) => entry.groupKey), [
        'identity_bootstrap', 'character_core', 'operational_profile',
    ]);
    assert.equal(combined.result.persistenceStatus, 'not_completed');
    assert.equal(combined.saveCount, 0);
    assert.ok(combined.result.failures.some((failure) => (
        failure.reason === 'actor_profile.discovery_promotion_mapping_missing'
    )));
    assert.deepEqual(combined.result.ledger, fixture.ledger);
});

test('module protocol carries working identity, ticket authority and targeted retry feedback into atomic readback', async () => {
    const fixture = prepareRegisteredBatch(1);
    fixture.candidates[0].characterCreationTicket = {
        id: 'ticket-working-context', designRolls: { temperament: 'patient' },
    };
    fixture.candidates[0].confirmed = { canonRole: 'locked-role' };
    fixture.candidates[0].locks = { canonRole: true };
    const observed = [];
    const moduleText = (label) => `${label}。${'这是完整自然中文模块内容，包含稳定事实、限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        requestBatch: ({ attempt, candidates, groupKey, moduleKeys, messages }) => {
            const prompt = messages.map((entry) => entry.content).join('\n');
            observed.push({ attempt, groupKey, prompt });
            const emittedKeys = groupKey === 'character_core' && attempt === 0
                ? moduleKeys.filter((key) => key !== 'history')
                : moduleKeys;
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...emittedKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    const coreFirst = observed.find((entry) => entry.groupKey === 'character_core' && entry.attempt === 0);
    const coreRetry = observed.find((entry) => entry.groupKey === 'character_core' && entry.attempt === 1);
    const operational = observed.find((entry) => entry.groupKey === 'operational_profile');
    assert.match(coreFirst.prompt, /ticket-working-context/u);
    assert.match(coreFirst.prompt, /locked-role/u);
    assert.match(coreFirst.prompt, /person/u);
    assert.match(coreRetry.prompt, /actor_profile\.module_missing/u);
    assert.match(coreRetry.prompt, /history/u);
    assert.match(operational.prompt, /personality/u);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.readbackVerified, true);
    assert.equal(run.saveCount, 2);
    assert.deepEqual(fixture.candidates[0].confirmed, { canonRole: 'locked-role' });
    assert.deepEqual(fixture.candidates[0].locks, { canonRole: true });
});

test('identity preflight retries only bootstrap with the exact safe local reason before later groups', async () => {
    const fixture = prepareRegisteredBatch(0);
    const invalidName = '系统';
    const validName = '合成人物甲';
    const acceptedNarrative = `${invalidName}广播后，${validName}走进大厅并报上姓名。`;
    const calls = [];
    const moduleText = (key) => `${key}：${'这是结构完整的合成中文档案内容，包含明确事实、限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ attempt, candidates, groupKey, moduleKeys, messages }) => {
            calls.push({ attempt, groupKey, prompt: messages.map((entry) => entry.content).join('\n') });
            if (groupKey === 'identity_bootstrap') {
                const name = attempt === 0 ? invalidName : validName;
                return [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText('person')}</module>`,
                    '</profile-target>',
                ].join('\n');
            }
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(calls.slice(0, 2).map(({ groupKey, attempt }) => ({ groupKey, attempt })), [
        { groupKey: 'identity_bootstrap', attempt: 0 },
        { groupKey: 'identity_bootstrap', attempt: 1 },
    ]);
    assert.match(calls[1].prompt, /actor_candidate\.identity_system/u);
    assert.ok(calls.slice(2).every((entry) => entry.groupKey !== 'identity_bootstrap'));
    assert.deepEqual(calls.slice(2).map((entry) => entry.groupKey), [
        'character_core', 'operational_profile',
    ]);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_profile.discovery_promotion_mapping_missing'
    )));
});

test('all deterministic identity false positives may retry to strict no-candidates without later groups', async () => {
    const fixture = prepareRegisteredBatch(0);
    const invalidName = '系统';
    const acceptedNarrative = `${invalidName}广播出现在这段合成材料中。`;
    const calls = [];
    const moduleText = `${'这是长度充足但身份不合格的合成档案内容。'.repeat(8)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ attempt, groupKey, messages }) => {
            calls.push({ attempt, groupKey, prompt: messages.map((entry) => entry.content).join('\n') });
            if (attempt === 1) return '无人物档案';
            return [
                `<profile-target actor="new" name="${invalidName}">`,
                `<module key="person">${moduleText}</module>`,
                '</profile-target>',
            ].join('\n');
        },
    });
    assert.deepEqual(calls.map(({ groupKey, attempt }) => ({ groupKey, attempt })), [
        { groupKey: 'identity_bootstrap', attempt: 0 },
        { groupKey: 'identity_bootstrap', attempt: 1 },
    ]);
    assert.match(calls[1].prompt, /actor_candidate\.identity_system/u);
    assert.equal(run.result.persistenceStatus, 'no_candidates');
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.failures.length, 0);
});

test('mixed valid and deterministic-invalid identity candidates cannot be erased by retry empty', async () => {
    const fixture = prepareRegisteredBatch(0);
    const invalidName = '系统';
    const validName = '合成人物乙';
    const acceptedNarrative = `${invalidName}广播后，${validName}走进大厅。`;
    const calls = [];
    const moduleText = `${'这是长度充足的合成档案模块内容。'.repeat(10)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ attempt, groupKey }) => {
            calls.push({ attempt, groupKey });
            if (attempt === 1) return '无人物档案';
            return [invalidName, validName].map((name) => [
                `<profile-target actor="new" name="${name}">`,
                `<module key="person">${moduleText}</module>`,
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(calls, [
        { groupKey: 'identity_bootstrap', attempt: 0 },
        { groupKey: 'identity_bootstrap', attempt: 1 },
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_candidate.identity_system'
    )));
});

test('identity module or format failure cannot be erased by retry empty', async () => {
    const fixture = prepareRegisteredBatch(0);
    const acceptedNarrative = '合成人物丙走进大厅。';
    const calls = [];
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ attempt, groupKey }) => {
            calls.push({ attempt, groupKey });
            return attempt === 0
                ? '这是没有任何目标路由标签的格式错误合成输出。'
                : '无人物档案';
        },
    });
    assert.deepEqual(calls, [
        { groupKey: 'identity_bootstrap', attempt: 0 },
        { groupKey: 'identity_bootstrap', attempt: 1 },
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_profile.identity_retry_erased_failure'
    )));
});

test('protected identity context drives a semantic retry while another newcomer completes pending and final readback', async () => {
    const fixture = prepareRegisteredBatch(0);
    const protectedName = '\u73a9\u5bb6\u7532';
    const validName = '\u5c91\u9065';
    const excludedActorNames = [protectedName];
    const acceptedNarrative = `${protectedName}\u7ad9\u5728\u95e8\u8fb9\uff0c${validName}\u968f\u540e\u8d70\u8fdb\u5927\u5385\u5e76\u6e05\u695a\u62a5\u4e0a\u59d3\u540d\u3002`;
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const calls = [];
    const moduleText = (key, name) => `${name}${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u7a33\u5b9a\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u3001\u9009\u62e9\u4f9d\u636e\u4e0e\u540e\u7eed\u53d1\u5c55\u7a7a\u95f4\u3002'.repeat(4)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: source,
            registeredActorIndex: [],
            excludedActorNames: [protectedName, protectedName],
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative, {
            excludedActorNames,
        }),
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt, messages }) => {
            calls.push({ groupKey, attempt, candidates: structuredClone(candidates), messages });
            if (groupKey === 'identity_bootstrap') {
                const name = attempt === 0 ? protectedName : validName;
                return [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText('person', name)}</module>`,
                    '</profile-target>',
                ].join('\n');
            }
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.name), [validName]);
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
        resolveDiscoveries: async ({ discoveries }) => {
            assert.deepEqual(discoveries.map((entry) => entry.candidateRef.name), [validName]);
            const discovered = discoverActorsFromTurnSources(fixture.ledger, {
                acceptedContent: acceptedNarrative,
                excludedActorNames,
                sourceRef: source,
                turn: fixture.ref.generation,
                modelProfileDiscoveries: structuredClone(discoveries),
            });
            const upsert = runActorRegistryUpsert(discovered.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId,
                identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref,
                turn: fixture.ref.generation,
                excludedActorNames,
            });
            const registration = promoteActorCandidatesToRegistry(
                upsert.ledger,
                discovered.candidates,
                {
                    chatId: fixture.ledger.chatId,
                    identityScopeId: fixture.ref.identityScopeId,
                    scopeDigest: fixture.ref.scopeDigest,
                    allowScopeDigestFill: true,
                    expectedSourceRef: fixture.ref,
                    turn: fixture.ref.generation,
                    excludedActorNames,
                },
            );
            const prepared = prepareActorLedgerProfilesV6(registration.ledger, {
                mode: 'full', turn: fixture.ref.generation,
            }).ledger;
            const promotedIds = registration.promoted.map((entry) => entry.actorRef.actorId);
            const candidates = selectActorProfileCompletionCandidates(prepared, {
                initialActorIds: promotedIds,
                maintenanceMaxActors: 0,
                turn: fixture.ref.generation,
            });
            return {
                ok: true,
                ledger: registration.ledger,
                candidates,
                entries: registration.promoted.map((promotion) => ({
                    candidateId: promotion.candidateId,
                    actorRef: {
                        actorId: promotion.actorRef.actorId,
                        name: promotion.actorRef.displayName,
                    },
                    candidate: discoveries.find((entry) => (
                        entry.candidateRef.name === promotion.actorRef.displayName
                    )).candidate,
                    repairs: [],
                })),
                failures: [],
                rejected: [],
                snapshot: { fieldRevision: 0 },
                registry: registration,
            };
        },
    });
    const identityCalls = calls.filter((entry) => entry.groupKey === 'identity_bootstrap');
    assert.equal(identityCalls.length, 2);
    const firstUserPrompt = identityCalls[0].messages.find((entry) => entry.role === 'user').content;
    assert.equal((firstUserPrompt.match(/\u672c\u5730\u53d7\u4fdd\u62a4\u8eab\u4efd\u7d22\u5f15\uff08\u7981\u6b62\u4f5c\u4e3a new\uff09/g) || []).length, 1);
    assert.match(firstUserPrompt, /\u672c\u5730\u53d7\u4fdd\u62a4\u8eab\u4efd\u7d22\u5f15\uff08\u7981\u6b62\u4f5c\u4e3a new\uff09\uff1a\["\u73a9\u5bb6\u7532"\]/u);
    const retrySystemPrompt = identityCalls[1].messages.find((entry) => entry.role === 'system').content;
    assert.match(retrySystemPrompt, /actor_candidate\.identity_excluded/u);
    assert.match(retrySystemPrompt, /\u5220\u9664\u8be5\u53d7\u4fdd\u62a4\u8eab\u4efd\u5019\u9009/u);
    assert.match(retrySystemPrompt, /\u65e0\u4eba\u7269\u6863\u6848/u);
    assert.doesNotMatch(retrySystemPrompt, new RegExp(protectedName, 'u'));
    for (const call of calls.filter((entry) => entry.groupKey !== 'identity_bootstrap')) {
        const prompt = call.messages.map((entry) => entry.content).join('\n');
        assert.doesNotMatch(prompt, /\u672c\u5730\u53d7\u4fdd\u62a4\u8eab\u4efd\u7d22\u5f15\uff08\u7981\u6b62\u4f5c\u4e3a new\uff09/u);
    }
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.readbackVerified, true);
    assert.equal(run.saveCount, 2);
    assert.ok(run.persistencePayloads[0].ledger.actors[0]?.pendingProfile);
    assert.equal(run.persistencePayloads[1].ledger.actors[0]?.pendingProfile, null);
    assert.equal(run.persistencePayloads[1].ledger.actors[0]?.name, validName);
    assert.equal(actorProfileReadyForAction(run.persistencePayloads[1].ledger.actors[0]), true);
});

test('identity retry feedback replaces an untrusted preflight reason with a bounded local code', async () => {
    const fixture = prepareRegisteredBatch(0);
    const name = '\u5c91\u9065';
    const acceptedNarrative = `${name}\u8d70\u8fdb\u5927\u5385\u5e76\u62a5\u4e0a\u59d3\u540d\u3002`;
    const secretReason = 'private transport detail must not return to model';
    let retryPrompt = '';
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: async () => ({
            ok: false,
            failures: [{ reason: secretReason }],
            validCandidateCount: 0,
            allDiscoveriesDeterministicallyInvalid: false,
        }),
        requestBatch: ({ attempt, groupKey, messages }) => {
            if (groupKey === 'identity_bootstrap' && attempt === 1) {
                retryPrompt = messages.map((entry) => entry.content).join('\n');
            }
            return [
                `<profile-target actor="new" name="${name}">`,
                `<module key="person">${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u8eab\u4efd\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u660e\u786e\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u4e0e\u540e\u7eed\u884c\u52a8\u4f9d\u636e\u3002'.repeat(4)}</module>`,
                '</profile-target>',
            ].join('\n');
        },
    });
    assert.doesNotMatch(retryPrompt, new RegExp(secretReason, 'u'));
    assert.match(retryPrompt, /actor_profile\.module_invalid/u);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
});

test('all seven controlled identity failures receive bounded executable retry semantics', async () => {
    const fixture = prepareRegisteredBatch(0);
    const name = '\u5c91\u9065';
    const acceptedNarrative = `${name}\u8d70\u8fdb\u5927\u5385\u5e76\u62a5\u4e0a\u59d3\u540d\u3002`;
    const codes = [
        'actor_candidate.identity_missing_or_short',
        'actor_candidate.identity_system',
        'actor_candidate.identity_group',
        'actor_candidate.identity_excluded',
        'actor_candidate.identity_internal_id',
        'actor_candidate.identity_registry_conflict',
        'actor_candidate.identity_quarantined',
    ];
    for (const code of codes) {
        let retryPrompt = '';
        const run = await runBatch({ ...fixture, candidates: [] }, {
            moduleProtocol: true,
            allowDiscovery: true,
            discoveryContext: { acceptedNarrative, completionMode: 'full' },
            preflightDiscoveries: async () => ({
                ok: false,
                failures: [{ reason: code }],
                validCandidateCount: 0,
                allDiscoveriesDeterministicallyInvalid: false,
            }),
            requestBatch: ({ attempt, messages }) => {
                if (attempt === 1) retryPrompt = messages.map((entry) => entry.content).join('\n');
                return [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u8eab\u4efd\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u660e\u786e\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u4e0e\u540e\u7eed\u884c\u52a8\u4f9d\u636e\u3002'.repeat(4)}</module>`,
                    '</profile-target>',
                ].join('\n');
            },
        });
        assert.match(retryPrompt, new RegExp(code.replaceAll('.', '\\.').replaceAll('-', '\\-'), 'u'), code);
        assert.match(retryPrompt, /\u5220\u9664/u, code);
        assert.match(retryPrompt, /\u4fdd\u7559\u672c\u7ec4\u5176\u4ed6\u6709\u6548\u65b0\u4eba/u, code);
        assert.match(retryPrompt, /\u65e0\u4eba\u7269\u6863\u6848/u, code);
        assert.equal(run.saveCount, 0, code);
    }
});

test('module protocol sorts reversed discoveries by accepted first offset before provisional and final ticket binding', async () => {
    const fixture = prepareRegisteredBatch(0);
    const names = ['\u7532\u660e', '\u4e59\u5b81'];
    const acceptedNarrative = '\u7532\u660e\u5148\u8d70\u8fdb\u5927\u5385\u5e76\u62a5\u4e0a\u59d3\u540d\u3002\u8fc7\u4e86\u7247\u523b\uff0c\u4e59\u5b81\u624d\u4ece\u4fa7\u95e8\u51fa\u73b0\u5e76\u4e0e\u4f17\u4eba\u4ea4\u8c08\u3002';
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const batch = ticketBatch(fixture.ref, 2);
    const ticketIds = batch.tickets.map((ticket) => ticket.ticketId);
    const seenLaterGroups = [];
    const moduleText = (key, name) => `${name}${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u7a33\u5b9a\u4e8b\u5b9e\u3001\u9650\u5236\u3001\u9009\u62e9\u4f9d\u636e\u4e0e\u540e\u7eed\u53d1\u5c55\u7a7a\u95f4\u3002'.repeat(4)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: source,
            characterCreationTickets: structuredClone(batch.tickets),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            if (groupKey === 'identity_bootstrap') {
                return [...names].reverse().map((name) => [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText('person', name)}</module>`,
                    '</profile-target>',
                ].join('\n')).join('\n');
            }
            seenLaterGroups.push({
                groupKey,
                rows: candidates.map((candidate) => ({
                    name: candidate.actorRef.name,
                    ticketId: candidate.characterCreationTicket?.ticketId,
                })),
            });
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
        resolveDiscoveries: async ({ discoveries }) => {
            assert.deepEqual(discoveries.map((entry) => entry.candidateRef.name), names);
            const discovered = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
                acceptedContent: acceptedNarrative,
                sourceRef: source,
                turn: fixture.ref.generation,
                modelProfileDiscoveries: structuredClone(discoveries),
            });
            const upsert = runActorRegistryUpsert(discovered.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId,
                identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref,
                turn: fixture.ref.generation,
            });
            const registration = promoteActorCandidatesToRegistry(
                upsert.ledger,
                discovered.candidates,
                {
                    chatId: fixture.ledger.chatId,
                    identityScopeId: fixture.ref.identityScopeId,
                    scopeDigest: fixture.ref.scopeDigest,
                    allowScopeDigestFill: true,
                    expectedSourceRef: fixture.ref,
                    turn: fixture.ref.generation,
                },
            );
            const binding = bindCharacterCreationTicketsToRegisteredActors(registration.ledger, {
                registration,
                candidates: discovered.candidates,
                batch,
                target: fixture.ref,
            });
            assert.deepEqual(
                binding.bindings.map((entry) => entry.ticketId),
                ticketIds,
                JSON.stringify({ skipped: binding.skipped, promoted: registration.promoted }),
            );
            const prepared = prepareActorLedgerProfilesV6(binding.ledger, {
                mode: 'full', turn: fixture.ref.generation,
            }).ledger;
            const promotedIds = registration.promoted.map((entry) => entry.actorRef.actorId);
            const candidates = selectActorProfileCompletionCandidates(prepared, {
                initialActorIds: promotedIds,
                maintenanceMaxActors: 0,
                turn: fixture.ref.generation,
            });
            const discoveryByName = new Map(discoveries.map((entry) => [entry.candidateRef.name, entry]));
            return {
                ok: true,
                ledger: binding.ledger,
                candidates,
                entries: registration.promoted.map((promotion) => ({
                    candidateId: promotion.candidateId,
                    actorRef: {
                        actorId: promotion.actorRef.actorId,
                        name: promotion.actorRef.displayName,
                    },
                    candidate: discoveryByName.get(promotion.actorRef.displayName).candidate,
                    repairs: [],
                })),
                failures: [],
                rejected: [],
                snapshot: { fieldRevision: 0 },
                registry: {
                    ...registration,
                    ticketBound: true,
                    ticketBindingCount: binding.bindings.length,
                },
            };
        },
    });
    assert.ok(seenLaterGroups.length >= 2);
    for (const group of seenLaterGroups) {
        assert.deepEqual(group.rows, [
            { name: names[0], ticketId: ticketIds[0] },
            { name: names[1], ticketId: ticketIds[1] },
        ], group.groupKey);
    }
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify({
        failures: run.result.failures,
        rejected: run.result.rejected,
        candidates: run.result.candidates?.map((entry) => entry.actorRef),
    }));
    assert.deepEqual(run.result.ledger.actors.map((actor) => ({
        name: actor.name,
        ticketId: actor.profileV6?.designRolls?.ticketId,
    })), [
        { name: names[0], ticketId: ticketIds[0] },
        { name: names[1], ticketId: ticketIds[1] },
    ]);
});

test('format-unrecoverable module retry receives safe group feedback and retries no successful group', async () => {
    const fixture = prepareRegisteredBatch(1);
    const calls = [];
    const moduleText = (key) => `${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u7684\u81ea\u7136\u4e2d\u6587\u6a21\u5757\uff0c\u5305\u542b\u7a33\u5b9a\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u3001\u9009\u62e9\u4f9d\u636e\u548c\u540e\u7eed\u884c\u52a8\u7a7a\u95f4\u3002'.repeat(4)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt, messages }) => {
            const prompt = messages.map((message) => message.content).join('\n');
            calls.push({ groupKey, attempt, prompt });
            if (groupKey === 'character_core' && attempt === 0) {
                return moduleText('unrouted dossier prose');
            }
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    const retry = calls.find((entry) => entry.groupKey === 'character_core' && entry.attempt === 1);
    assert.match(retry.prompt, /actor_profile\.format_unrecoverable/u);
    assert.match(retry.prompt, /character_core/u);
    assert.deepEqual(calls.map(({ groupKey, attempt }) => [groupKey, attempt]), [
        ['identity_bootstrap', 0],
        ['character_core', 0],
        ['character_core', 1],
        ['operational_profile', 0],
    ]);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
});

test('one narrative response carries more than 256 ordinary discoveries through one real ledger resolution', async () => {
    const fixture = prepareRegisteredBatch(0);
    const names = Array.from({ length: 257 }, (_, index) => `\u4eba\u7269${String(index + 1).padStart(3, '0')}`);
    const acceptedNarrative = names.map((name) => (
        `${name}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c${name}\u6682\u65f6\u4fdd\u6301\u89c2\u5bdf\u3002`
    )).join('\n');
    const titles = [
        '\u4eba\u7269\u4fe1\u606f', '\u751f\u7406\u7279\u5f81', '\u6027\u683c\u7279\u5f81', '\u8fc7\u5f80\u7ecf\u5386',
        '\u5f53\u524d\u72b6\u6001', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90',
    ];
    const output = names.map((name) => [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${name}\u3011`,
        ...titles.map((title) => `\u3010${title}\u3011\u4fdd\u6301\u5b8c\u6574\u7684\u81ea\u7136\u4e2d\u6587\u6863\u6848\u6bb5\u843d\u3002`),
    ].join('\n')).join('\n');
    const discoverySourceRef = narrativeDiscoverySourceRef(fixture.ref);
    let resolverVerified = false;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: discoverySourceRef,
        },
        requestBatch: () => output,
        resolveDiscoveries: async ({ discoveries }) => {
            assert.equal(discoveries.length, 257);
            const verified = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
                acceptedContent: acceptedNarrative,
                sourceRef: discoverySourceRef,
                turn: fixture.ref.generation,
                modelProfileDiscoveries: structuredClone(discoveries),
            });
            assert.equal(verified.candidates.length, 257);
            assert.equal(verified.modelProfileDiscoveries.length, 257);
            assert.deepEqual(verified.candidates.map((candidate) => candidate.name), names);
            assert.deepEqual(
                verified.modelProfileDiscoveries.map((entry) => entry.sourceOffset),
                names.map((name) => acceptedNarrative.indexOf(name)),
            );
            assert.equal(new Set(verified.candidates.map((candidate) => candidate.candidateId)).size, 257);
            const serialized = JSON.stringify(verified);
            assert.equal(serialized.includes('narrativeFirstLiteral'), false);
            resolverVerified = true;
            return {
                ok: true,
                ledger: structuredClone(fixture.ledger),
                candidates: [],
                entries: [],
                rejected: [],
                failures: [],
                registry: null,
                snapshot: { fieldRevision: 0 },
            };
        },
    });
    assert.equal(resolverVerified, true);
    assert.equal(run.result.modelCalls, 3);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(
        (run.result.failures || []).some((failure) => failure?.reason === 'actor_profile.discovery_failed'),
        false,
    );
    assert.equal(
        (run.result.rejected || []).some((rejection) => rejection?.reason === 'actor_profile.discovery_failed'),
        false,
    );
});

test('parsed narrative discoveries remain ordinary local data within one resolution call', async () => {
    const fixture = prepareRegisteredBatch(0);
    const name = '\u4eba\u7269\u6e05\u7406';
    const acceptedNarrative = `${name}\u51fa\u73b0\u5728\u8d70\u5eca\uff0c${name}\u6682\u65f6\u4fdd\u6301\u89c2\u5bdf\u3002`;
    const titles = [
        '\u4eba\u7269\u4fe1\u606f', '\u751f\u7406\u7279\u5f81', '\u6027\u683c\u7279\u5f81', '\u8fc7\u5f80\u7ecf\u5386',
        '\u5f53\u524d\u72b6\u6001', '\u5173\u7cfb\u4e0e\u52a8\u673a', '\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90',
    ];
    const output = [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${name}\u3011`,
        ...titles.map((title) => `\u3010${title}\u3011\u4fdd\u6301\u5b8c\u6574\u7684\u81ea\u7136\u4e2d\u6587\u6863\u6848\u6bb5\u843d\u3002`),
    ].join('\n');
    const discoverySourceRef = narrativeDiscoverySourceRef(fixture.ref);
    let capturedDiscoveries = [];
    const run = await runBatch({ ...fixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: discoverySourceRef,
        },
        requestBatch: () => output,
        resolveDiscoveries: async ({ discoveries }) => {
            capturedDiscoveries = structuredClone(discoveries);
            assert.equal(discoveries.length, 1);
            return {
                ok: true,
                ledger: structuredClone(fixture.ledger),
                candidates: [],
                entries: [],
                rejected: [],
                failures: [],
                registry: null,
                snapshot: { fieldRevision: 0 },
            };
        },
    });
    assert.equal(run.result.modelCalls, 3);
    const replay = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
        acceptedContent: acceptedNarrative,
        sourceRef: discoverySourceRef,
        turn: fixture.ref.generation,
        modelProfileDiscoveries: capturedDiscoveries,
    });
    assert.equal(replay.candidates.length, 1, 'the resolver revalidates ordinary local rows against the current narrative');
});

test('a second rowless discovery response fails closed with a fixed parse code and no save', async () => {
    const fixture = prepareRegisteredBatch(1);
    const calls = [];
    const run = await runBatch({ ...fixture, candidates: [] }, {
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative: 'Candidate One enters the scene.', completionMode: 'full' },
        requestBatch: ({ candidates, attempt }) => {
            calls.push({ attempt, count: candidates.length });
            return 'not a profile array';
        },
    });
    assert.deepEqual(calls, [{ attempt: 0, count: 0 }, { attempt: 1, count: 0 }]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.saveCount, 0);
});

test('an explicit empty discovery batch stays no-candidates and never consumes the replacement', async () => {
    const fixture = prepareRegisteredBatch(0);
    let calls = 0;
    const run = await runBatch(fixture, {
        allowDiscovery: true,
        requestBatch: () => {
            calls += 1;
            return '[]';
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.result.persistenceStatus, 'no_candidates');
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.saveCount, 0);
});

test('a parsed row with an expected ActorRef keeps the existing row path and no batch replacement', async () => {
    const fixture = prepareRegisteredBatch(1);
    const calls = [];
    const run = await runBatch(fixture, {
        allowDiscovery: true,
        requestBatch: ({ candidates, attempt }) => {
            calls.push({ attempt, count: candidates.length });
            return JSON.stringify(candidates.map(completeCandidate));
        },
    });
    assert.deepEqual(calls, [{ attempt: 0, count: 1 }]);
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
});

test('a locally repairable batch needs one model call', async () => {
    const fixture = prepareRegisteredBatch(3);
    let calls = 0;
    const run = await runBatch(fixture, {
        requestBatch: ({ candidates }) => {
            calls += 1;
            const rows = candidates.map(completeCandidate);
            rows[0].personality.primaryDerivatives = JSON.stringify(
                rows[0].personality.primaryDerivatives,
            );
            const json = JSON.stringify(rows);
            return `Here's the profile JSON:\n\`\`\`json\n${json.replace('"actorRef":', 'actorRef:').replace(/\]$/u, ',]')}\n\`\`\``;
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.result.batchMeta.protocol, 'module-groups-v1');
    assert.equal(run.saveCount, 2);
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
    assert.deepEqual(calls[1], fixture.candidates.map((candidate) => candidate.actorId));
    assert.deepEqual(
        run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1).map((entry) => entry.groupKey),
        ['identity_bootstrap'],
    );
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
});

test('duplicate or unknown output retries only the failed group and then commits atomically', async () => {
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
    assert.deepEqual(calls[1], fixture.candidates.map((candidate) => candidate.actorId));
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.saveCount, 2);
    assert.deepEqual(
        run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1).map((entry) => entry.groupKey),
        ['identity_bootstrap'],
    );
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
    assert.equal(run.result.accepted.length, 0);
    assert.equal(run.result.failures[0].reason, 'actor_profile.input_actor_ref_duplicate');
    assert.equal(run.saveCount, 0);
    assert.deepEqual(run.result.ledger, fixture.ledger);
});

test('one unrecoverable actor keeps the whole current-source group at S0', async () => {
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
    assert.equal(run.result.accepted.length, 0);
    assert.ok(['actor_profile.actor_ref_mismatch', 'actor_profile.module_missing'].includes(run.result.failures[0].reason));
    assert.equal(run.saveCount, 0);
    assert.deepEqual(run.result.ledger, fixture.ledger);
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

test('P2 preserves fail-closed local and transport categories without raw error detail', async () => {
    const fixture = prepareRegisteredBatch(2);
    const cases = [
        ['scope_stale', false],
        ['target_stale', false],
        ['cancelled', false],
        ['http', true],
        ['timeout', true],
        ['empty', true],
        ['protocol', true],
        ['transport', true],
    ];
    for (const [category, requestStarted] of cases) {
        let calls = 0;
        const run = await runBatch(fixture, {
            semanticRetry: false,
            requestBatch: () => {
                calls += 1;
                const error = new Error('secret-like raw failure detail must never escape');
                error.failureKind = category;
                error.routeDiagnostic = {
                    channel: 'fast',
                    slot: 1,
                    model: 'safe-profile-model',
                    failover: category === 'http',
                    jsonMode: false,
                    requestKind: 'actor_profile_batch',
                    requestStarted,
                    inputLengthBucket: 'large',
                    httpStatus: category === 'http' ? 502 : 0,
                    failureKind: category,
                    body: 'must-not-survive',
                    url: 'https://must-not-survive.invalid',
                };
                throw error;
            },
        });
        assert.equal(calls, 1, category);
        assert.equal(run.saveCount, 0, category);
        assert.equal(run.result.accepted.length, 0, category);
        assert.equal(run.result.failures.length, 2, category);
        assert.ok(run.result.failures.every((failure) => (
            failure.reason === `actor_profile.${category}`
        )), category);
        const diagnostic = run.result.failures[0].routeDiagnostic;
        assert.deepEqual(diagnostic, {
            channel: 'fast',
            slot: 1,
            model: 'safe-profile-model',
            failover: category === 'http',
            jsonMode: false,
            requestStarted,
            inputLengthBucket: 'large',
            httpStatus: category === 'http' ? 502 : 0,
            failureKind: category,
        }, category);
        assert.doesNotMatch(JSON.stringify(run.result), /secret-like|must-not-survive/u, category);
        if (['scope_stale', 'target_stale', 'cancelled'].includes(category)) {
            assert.equal(run.result.modelCalls, 0, `${category} must not claim a route call`);
        }
    }

    const probeTagged = await runBatch(fixture, {
        semanticRetry: false,
        requestBatch: () => {
            const error = new Error('probe failure must not enter P2 route receipt');
            error.failureKind = 'http';
            error.routeDiagnostic = {
                channel: 'fast',
                requestKind: 'connection_probe',
                requestStarted: true,
                failureKind: 'http',
                httpStatus: 500,
            };
            throw error;
        },
    });
    assert.equal(probeTagged.saveCount, 0);
    assert.equal(probeTagged.result.failures[0].reason, 'actor_profile.http');
    assert.equal(probeTagged.result.failures[0].routeDiagnostic, null);
});

test('a cancelled in-flight P2 request performs no failover or write', async () => {
    const fixture = prepareRegisteredBatch(2);
    let calls = 0;
    const run = await runBatch(fixture, {
        semanticRetry: false,
        requestBatch: () => {
            calls += 1;
            const error = new Error('cancelled');
            error.name = 'AbortError';
            error.failureKind = 'cancelled';
            error.routeDiagnostic = {
                channel: 'fast',
                slot: 0,
                model: 'safe-profile-model',
                failover: false,
                jsonMode: false,
                requestKind: 'actor_profile_batch',
                requestStarted: true,
                inputLengthBucket: 'large',
                httpStatus: 0,
                failureKind: 'cancelled',
            };
            throw error;
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.modelCalls, 1);
    assert.ok(run.result.failures.every((failure) => (
        failure.reason === 'actor_profile.cancelled'
        && failure.routeDiagnostic?.failover === false
        && failure.routeDiagnostic?.requestStarted === true
    )));
});

test('partial validation and Phase-1 save/readback failures keep the current-source group at S0', async () => {
    const fixture = prepareRegisteredBatch(2);
    const partial = await runBatch(fixture, {
        semanticRetry: false,
        requestBatch: ({ candidates }) => {
            const rows = candidates.map(completeCandidate);
            rows[1].knowledge.entries = [];
            return JSON.stringify(rows);
        },
    });
    assert.equal(partial.result.accepted.length, 0);
    assert.equal(partial.saveCount, 0);
    assert.deepEqual(partial.result.ledger, fixture.ledger);

    for (const persistBatch of [
        async () => ({ ok: false, reason: 'host_save_rejected' }),
        async () => ({ ok: true, ledger: fixture.ledger }),
    ]) {
        const failed = await runBatch(fixture, { persistBatch });
        assert.equal(failed.result.accepted.length, 0);
        assert.equal(failed.result.ledger.actors.some(actorProfileReadyForAction), false);
    }
});

test('Phase-1 failures return S0, while only a post-readback Phase-2 failure exposes recoverable S2', async () => {
    const fixture = prepareRegisteredBatch(1);
    const originalActor = structuredClone(fixture.ledger.actors[0]);
    for (const pendingOutcome of [
        async () => ({ ok: false, reason: 'host_save_rejected' }),
        async () => ({ ok: true, ledger: structuredClone(fixture.ledger), persistenceMeta: { rev: 1 } }),
    ]) {
        let finalCalls = 0;
        const failed = await runBatch(fixture, {
            persistPendingBatch: pendingOutcome,
            persistFinalizedBatch: async () => {
                finalCalls += 1;
                return { ok: true, ledger: structuredClone(fixture.ledger) };
            },
        });
        assert.equal(finalCalls, 0);
        assert.equal(failed.result.persistenceStatus, 'not_completed');
        assert.deepEqual(failed.result.ledger.actors[0], originalActor);
        assert.equal(failed.result.ledger.actors[0].pendingProfile, null);
        assert.equal(actorProfileReadyForAction(failed.result.ledger.actors[0]), false);
    }

    let pendingPayload = null;
    const phase2Failure = await runBatch(fixture, {
        persistPendingBatch: async (payload) => {
            pendingPayload = structuredClone(payload.ledger);
            return { ok: true, ledger: structuredClone(payload.ledger), persistenceMeta: { rev: 1 } };
        },
        persistFinalizedBatch: async () => ({ ok: false, reason: 'host_save_rejected' }),
    });
    assert.ok(pendingPayload?.actors[0]?.pendingProfile);
    assert.equal(pendingPayload.actors[0].profileV6.baselineCommit, null);
    assert.equal(phase2Failure.result.persistenceStatus, 'not_completed');
    assert.ok(phase2Failure.result.ledger.actors[0].pendingProfile);
    assert.equal(phase2Failure.result.ledger.actors[0].profileV6.baselineCommit, null);
    assert.equal(actorProfileReadyForAction(phase2Failure.result.ledger.actors[0]), false);
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
    assert.equal(after.result.modelCalls, 0);
    assert.equal(after.saveCount, 0);
});

test('ticket overflow keeps every actor registered and still completes the exhausted profile from accepted evidence', async () => {
    const fixture = prepareRegisteredBatch(9, { capacity: 8 });
    assert.equal(fixture.registration.promoted.length, 9);
    assert.equal(fixture.binding.bindings.length, 8);
    assert.ok(fixture.binding.skipped.some((entry) => entry.endsWith(':ticket_pool_exhausted')));
    assert.equal(fixture.candidates.length, 9);
    const overflowId = fixture.registration.promoted[8].actorRef.actorId;
    const run = await runBatch(fixture);
    const refreshed = normalizeActorLedger(run.result.ledger, { chatId: fixture.ledger.chatId });
    assert.equal(refreshed.actors.length, 9);
    const overflow = refreshed.actors.find((actor) => actor.id === overflowId);
    assert.equal(actorProfileReadyForAction(overflow), true);
    assert.equal(overflow.profileV6.backgroundPending, false);
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
    assert.deepEqual(selected.map((entry) => entry.name), [
        '新一',
        '新二',
        '新三',
        '旧二',
        '旧一',
    ]);
});

test('shared narrative and worldbook evidence appears once for an eight-actor batch', () => {
    const fixture = prepareRegisteredBatch(8);
    const sentinel = `WORLD_ANCHOR_${'X'.repeat(10000)}`;
    const messages = buildActorProfileCompletionMessages(fixture.candidates, {
        evidenceText: sentinel,
    });
    const userPrompt = messages.find((message) => message.role === 'user').content;
    assert.equal(userPrompt.split(sentinel).length - 1, 1);
    assert.ok(userPrompt.includes('权威材料'));
    assert.ok(userPrompt.length < 70000, '公共证据不得按8个人物线性复制');
});

test('narrative prompt keeps authority local and never requests legacy fact tables', () => {
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
    assert.equal(userPrompt.includes('CONFIRMED_RELATION_SENTINEL'), false);
    assert.equal(userPrompt.includes('HYPOTHESIS_KNOWLEDGE_SENTINEL'), false);
    assert.equal(userPrompt.includes('relationships'), false);
    assert.equal(userPrompt.includes('coverageState'), false);
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

test('narrative-v1 batch keeps one complete dossier atomic and never projects prose into ledger facts', async () => {
    const fixture = prepareRegisteredBatch(1);
    const target = fixture.candidates[0];
    const output = [
        `\u3010\u4eba\u7269\u6863\u6848\uff1a${target.actorRef.name}\u3011`,
        `ActorRef: ${target.actorRef.actorId}`,
        '\u3010\u4eba\u7269\u4fe1\u606f\u3011\u4e00\u540d\u6709\u81ea\u5df1\u65e5\u5e38\u804c\u8d23\u7684\u65b0\u4eba\u7269\u3002',
        '\u3010\u751f\u7406\u7279\u5f81\u3011\u8eab\u4f53\u7279\u5f81\u4e0e\u7269\u79cd\u8bbe\u5b9a\u4fdd\u6301\u4e00\u81f4\u3002',
        '\u3010\u6027\u683c\u7279\u5f81\u3011\u8bf4\u8bdd\u514b\u5236\uff0c\u4f1a\u5148\u786e\u8ba4\u98ce\u9669\u3002',
        '\u3010\u8fc7\u5f80\u7ecf\u5386\u3011\u66fe\u5728\u65e5\u5e38\u5de5\u4f5c\u4e2d\u627f\u62c5\u7a33\u5b9a\u8d23\u4efb\u3002',
        '\u3010\u5f53\u524d\u72b6\u6001\u3011\u5f53\u524d\u72b6\u6001\u53ea\u8bb0\u5f55\u957f\u671f\u6d3b\u52a8\u80cc\u666f\u3002',
        '\u3010\u5173\u7cfb\u4e0e\u52a8\u673a\u3011\u613f\u610f\u5408\u4f5c\uff0c\u4e0d\u66ff\u4ed6\u4eba\u51b3\u5b9a\u3002',
        '\u3010\u77e5\u8bc6\u3001\u80fd\u529b\u4e0e\u8d44\u6e90\u3011\u53ef\u9605\u8bfb\u7684\u7ecf\u9a8c\u4e0d\u7b49\u4e8e\u8d26\u672c\u6388\u6743\u7684\u80fd\u529b\u3002',
    ].join('\n');
    const run = await runBatch(fixture, { requestBatch: () => output });
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.saveCount, 2);
    const [pendingSave, finalSave] = run.persistencePayloads;
    const pendingActor = pendingSave.ledger.actors.find((entry) => entry.id === target.actorRef.actorId);
    const finalActor = finalSave.ledger.actors.find((entry) => entry.id === target.actorRef.actorId);
    assert.equal(pendingActor.profileV6.profileFormat, undefined, 'pending readback never replaces live profile');
    assert.equal(pendingActor.pendingProfile.profileV6.profileFormat, 'narrative-v1');
    assert.equal(pendingActor.pendingProfile.profileV6.preparedForAction, false);
    assert.equal(pendingActor.pendingProfile.readbackVerified, false);
    assert.equal(Object.entries(pendingActor.pendingProfile.profileV6.narrativeSections)
        .filter(([key]) => key !== 'physiology').every(([, section]) => (
            typeof section.text === 'string' && section.text.length > 0
        )), true);
    const verification = finalActor.profileV6.baselineCommit.verification;
    assert.equal(finalActor.pendingProfile, null);
    assert.equal(finalActor.profileV6.preparedForAction, true);
    assert.equal(verification.transactionId, pendingActor.pendingProfile.transactionId);
    assert.equal(verification.writeSetDigest, pendingActor.pendingProfile.writeSetDigest);
    assert.equal(verification.preparedLedgerDigest, pendingActor.pendingProfile.preparedLedgerDigest);
    assert.equal(verification.profileDigest, pendingActor.pendingProfile.profileDigest);
    assert.deepEqual(verification.writeSet, pendingActor.pendingProfile.writeSet);
    assert.deepEqual(verification.writeSet[0].sourceRef, fixture.ref);
    assert.equal(verification.writeSet[0].scopeDigest, fixture.ref.scopeDigest);
    const actor = run.result.ledger.actors.find((entry) => entry.id === target.actorRef.actorId);
    assert.equal(actor.profileV6.profileFormat, 'narrative-v1');
    assert.deepEqual(actor.capabilities, [], 'narrative prose never becomes a capability fact');
});

test('public narrative profile mutations are read-only before migration or namespace persistence', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const publicMutation = source.slice(
        source.indexOf('async function mutateActorProfileV6'),
        source.indexOf('async function initialize'),
    );
    const buildMutation = new Function(
        'getContext',
        'normalizeActorLedger',
        'readChatNamespace',
        'ensureActorSovereigntyMigrationPersisted',
        'writeChatNamespace',
        'renderActorProfiles',
        `${publicMutation}\nreturn mutateActorProfileV6;`,
    );
    const publicProfileApi = source.slice(
        source.indexOf('setActorProfileV6Lock: (actorId, path, locked = true)'),
        source.indexOf('getActorActionReceipts:'),
    );
    const buildPublicProfileApi = new Function(
        'mutateActorProfileV6',
        'setActorProfileV6Lock',
        'applyActorProfileV6Override',
        'regenerateActorProfileV6Module',
        'getSettings',
        `return ({${publicProfileApi}});`,
    );
    const narrativeLedger = {
        actors: [{
            id: 'actor-narrative',
            profileV6: { profileFormat: 'narrative-v1' },
        }],
    };
    let migrationCalls = 0;
    let namespaceWrites = 0;
    const mutateNarrative = buildMutation(
        () => ({ chatId: 'chat-narrative' }),
        (ledger) => ledger,
        () => ({ actorLedger: narrativeLedger }),
        async () => {
            migrationCalls += 1;
            return { ok: true, namespace: { actorLedger: narrativeLedger } };
        },
        async () => {
            namespaceWrites += 1;
            return true;
        },
        () => assert.fail('read-only narrative mutation must not render a saved result'),
    );
    const unexpectedCoreMutation = () => assert.fail('narrative public API must not invoke its core mutation');
    const api = buildPublicProfileApi(
        mutateNarrative,
        unexpectedCoreMutation,
        unexpectedCoreMutation,
        unexpectedCoreMutation,
        () => assert.fail('narrative public API must not read mutation settings'),
    );
    for (const [operation, args] of [
        ['overrideActorProfileV6', ['actor-narrative', 'modules.identity.role', 'ignored']],
        ['regenerateActorProfileV6Module', ['actor-narrative', 'identity']],
        ['setActorProfileV6Lock', ['actor-narrative', 'modules.identity', true]],
    ]) {
        const result = await api[operation](...args);
        assert.deepEqual(result, {
            applied: false,
            saved: false,
            reason: 'narrative_read_only',
        }, `${operation} must reject before calling its core mutation`);
    }
    assert.equal(migrationCalls, 0);
    assert.equal(namespaceWrites, 0);

    const legacyLedger = { actors: [{ id: 'actor-legacy', profileV6: { profileFormat: 'v6' } }] };
    let legacyWrites = 0;
    const mutateLegacy = buildMutation(
        () => ({ chatId: 'chat-legacy' }),
        (ledger) => ledger,
        () => ({ actorLedger: legacyLedger }),
        async () => ({ ok: true, namespace: { actorLedger: legacyLedger } }),
        async () => {
            legacyWrites += 1;
            return true;
        },
        () => {},
    );
    const legacyResult = await mutateLegacy('actor-legacy', () => ({
        profile: { profileFormat: 'v6', legacy: true },
        applied: true,
    }));
    assert.equal(legacyResult.applied, true);
    assert.equal(legacyResult.saved, true);
    assert.equal(legacyWrites, 1, 'legacy V6 mutation still reaches its existing writer');
});

test('production path keeps current-source profiles untruncated and commits through pending plus final readbacks', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const publicMutation = source.slice(
        source.indexOf('async function mutateActorProfileV6'),
        source.indexOf('async function initialize'),
    );
    const publicProfileApi = source.slice(
        source.indexOf('setActorProfileV6Lock: (actorId, path, locked = true)'),
        source.indexOf('getActorActionReceipts:'),
    );
    const narrativeReadOnly = "preflightActor?.profileV6?.profileFormat === 'narrative-v1'";
    assert.ok(publicMutation.indexOf(narrativeReadOnly) > publicMutation.indexOf('const preflightActor'));
    assert.ok(publicMutation.indexOf(narrativeReadOnly) < publicMutation.indexOf('ensureActorSovereigntyMigrationPersisted'));
    assert.match(publicMutation, /reason: 'narrative_read_only'/u);
    assert.match(publicMutation, /if \(result\?\.applied !== true\) \{[\s\S]*?saved: false,[\s\S]*?reason: result\?\.reason \|\| 'profile_not_applied'/u);
    assert.ok(publicMutation.indexOf('if (result?.applied !== true)') < publicMutation.indexOf('writeChatNamespace(namespace'));
    for (const api of ['setActorProfileV6Lock:', 'overrideActorProfileV6:', 'regenerateActorProfileV6Module:']) {
        assert.match(publicProfileApi, new RegExp(api, 'u'));
    }
    const publicLock = publicProfileApi.slice(
        publicProfileApi.indexOf('setActorProfileV6Lock: (actorId, path, locked = true)'),
        publicProfileApi.indexOf('overrideActorProfileV6:'),
    );
    assert.match(publicLock, /nextProfile\?\.profileFormat === 'narrative-v1'[\s\S]*?applied: false,[\s\S]*?reason: 'narrative_read_only'/u);
    assert.doesNotMatch(publicLock, /profile: setActorProfileV6Lock\(profile, \{ path, locked \}\),\s*applied: true/u);
    const entryFunction = source.slice(
        source.indexOf('async function runActorProfileTarget'),
        source.indexOf('async function runContinuityTarget'),
    );
    const profileFunction = source.slice(
        source.indexOf('async function completeActorProfilesForTurn'),
        source.indexOf('async function runActorProfileTarget'),
    );
    const continuityFunction = source.slice(
        source.indexOf('async function runContinuityTarget'),
        source.indexOf('async function confirmDangerousAction'),
    );
    assert.match(profileFunction, /initialActorIds,/u);
    assert.match(profileFunction, /maintenanceMaxActors: includeMaintenance/u);
    assert.match(profileFunction, /completeActorProfileBatchTransaction/u);
    assert.match(profileFunction, /maxTokens: 0/u);
    assert.match(profileFunction, /requestKind: 'actor_profile_batch'/u);
    assert.match(profileFunction, /maxFailovers: 1/u);
    assert.match(profileFunction, /noTimeout: true/u);
    assert.match(profileFunction, /localBatchFailure\('scope_stale'\)/u);
    assert.match(profileFunction, /localBatchFailure\('target_stale'\)/u);
    assert.match(profileFunction, /readbackAttempts: 3/u);
    assert.match(profileFunction, /persistPendingBatch/u);
    assert.match(profileFunction, /persistFinalizedBatch/u);
    assert.doesNotMatch(profileFunction, /Promise\.all\(candidates\.map|parallelLane|actorShardMaxTokens/u);
    const profileRender = source.slice(
        source.indexOf('function renderActorProfiles'),
        source.indexOf('function renderContinuityLedger'),
    );
    assert.match(profileRender, /if \(profile\.profileFormat !== 'narrative-v1'\) \{\s*const actorLock[\s\S]*?applyActorProfileUiMutation/u);
    const narrativeRender = profileRender.slice(profileRender.indexOf("if (profile.profileFormat === 'narrative-v1')"));
    assert.doesNotMatch(narrativeRender, /mvuad-profile-actor-lock|applyActorProfileUiMutation|regenerateActorProfileV6Module/u);
    assert.match(profileRender, /const narrativeCount = actors\.filter/u);
    assert.match(profileRender, /叙事档案 \$\{narrativeCount\} 人/u);
    assert.match(profileRender, /平均覆盖 \$\{coverage\}%/u);
    const transaction = source.slice(source.indexOf('const promotedActorIds = actorRegistration.promoted'));
    assert.match(transaction, /actorRegistration\.promoted\s*\.map\(\(entry\) => entry\.actorRef\.actorId\)/u);
    assert.match(transaction, /initialActorIds: promotedActorIds/u);
    assert.match(transaction, /ticketPoolExhausted/u);
    assert.match(transaction, /recordModelDiagnostic/u);
    assert.match(profileFunction, /worldContext\.text/u);
    assert.match(profileFunction, /scopeDigest: captured\.scopeDigest/u);
    assert.match(profileFunction, /const discoverySourceRef = \{[\s\S]*?logicalIndex: captured\.index,[\s\S]*?generationSerial: captured\.generationSerial,[\s\S]*?contentHash: captured\.contentFingerprint \|\| captured\.fingerprint,[\s\S]*?contentFingerprint: captured\.contentFingerprint \|\| captured\.fingerprint,/u);
    assert.match(profileFunction, /discoveryContext: \{[\s\S]*?sourceRef: discoverySourceRef,/u);
    assert.match(entryFunction, /const excludedActorNames = currentPlayerActorNames\(context\)/u);
    assert.match(entryFunction, /classifyActorRegistryTargetName\([\s\S]*?entry\?\.candidateRef\?\.name,[\s\S]*?excludedActorNames,/u);
    assert.match(entryFunction, /discoveryContext: \{[\s\S]*?excludedActorNames: deepClone\(excludedActorNames\),/u);
    const diagnosticProjection = source.slice(
        source.indexOf('const narrativeValidationDiagnostic'),
        source.indexOf('const quarantined'),
    );
    assert.match(source, /function compactActorProfileFailureCode\(value\) \{[\s\S]*?String\(value \?\? ''\)\.trim\(\)\.slice\(0, 120\)/u);
    assert.match(diagnosticProjection, /compactActorProfileFailureCode\(failure\?\.reason\)/u);
    assert.doesNotMatch(diagnosticProjection, /cleanText\(failure\?\.reason/u);
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'completeActorProfilesForTurn',
    ]) assert.match(entryFunction, new RegExp(p1Step, 'u'));
    assert.doesNotMatch(entryFunction, /persistActorRegistryForTurn/u);
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'completeActorProfilesForTurn',
    ]) assert.doesNotMatch(continuityFunction, new RegExp(p1Step, 'u'));
});
