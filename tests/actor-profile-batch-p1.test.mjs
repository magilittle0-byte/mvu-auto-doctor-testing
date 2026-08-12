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
        scopeDigest: `scope:${chatId}|character:card-main`,
        hash: `hash-${chatId}-${generation}`,
        compatibilityOnly: false,
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
    allowDiscovery = false,
    discoveryContext = null,
    resolveDiscoveries = null,
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
    const result = await completeActorProfileBatchTransaction({
        ledger: fixture.ledger,
        candidates: fixture.candidates,
        evidenceText: '这是完全合成的P1档案测试材料。',
        turn: fixture.ref.generation,
        target: { ...fixture.ref, sourceRef: fixture.ref },
        semanticRetry,
        allowDiscovery,
        discoveryContext,
        requestBatch,
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
        persistPendingBatch: persisted,
        persistFinalizedBatch: persisted,
        isTargetCurrent,
    });
    return { result, saveCount, readbackCount, persistencePayloads };
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
    assert.ok(replacementSystem.includes('唯一精确出现'));
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
    assert.equal(run.result.batchFormatReplacementAttempted, true);
    assert.equal(run.result.batchMeta.parsedRowCount, 1);
    assert.equal(run.saveCount, 2);
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
    assert.equal(run.result.failures[0].reason, 'actor_profile.format_unrecoverable');
    assert.equal(run.result.batchFormatReplacementAttempted, true);
    assert.equal(run.result.batchMeta.formatUnrecoverable, true);
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
    assert.ok(run.result.accepted[0].repairs.includes('embedded_profile_container_parsed'));
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
    assert.deepEqual(calls[1], [fixture.candidates[1].actorId]);
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
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
    assert.equal(run.saveCount, 2);
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
    assert.equal(run.saveCount, 2);
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
    assert.equal(run.saveCount, 2);
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
    assert.equal(partial.saveCount, 2);

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
    assert.equal(Object.values(pendingActor.pendingProfile.profileV6.narrativeSections).every((section) => (
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
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'persistActorRegistryForTurn',
        'completeActorProfilesForTurn',
    ]) assert.match(entryFunction, new RegExp(p1Step, 'u'));
    for (const p1Step of [
        'discoverActorsFromTurnSources',
        'runActorRegistryUpsert',
        'promoteActorCandidatesToRegistry',
        'persistActorRegistryForTurn',
        'completeActorProfilesForTurn',
    ]) assert.doesNotMatch(continuityFunction, new RegExp(p1Step, 'u'));
});
