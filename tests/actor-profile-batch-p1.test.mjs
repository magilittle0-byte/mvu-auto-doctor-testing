import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { actorActionTargetMatches } from '../actor-authority-core.mjs';

import {
    ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES,
    actorProfileReadyForAction,
    actorProfileDiscoveryCoveragePlan,
    bindCharacterCreationTicketsToRegisteredActors,
    buildActorProfileCompletionMessages,
    issueCharacterCreationTicket,
    actorProfileRecoverySourceMatches,
    actorProfileRetryReceiptMatches,
    actorProfileTicketBatchPersistenceMatches,
    createActorProfileRetryReceipt,
    parseActorProfileCompletionBatchOutput,
    prepareActorLedgerProfilesV6,
    sealActorProfileTicketBatchForPersistence,
    selectActorProfileCompletionCandidates,
} from '../actor-profile-v6-core.mjs';
import {
    actorProfileDiscoverySourceOrder,
    actorProfileRecoveryProgressDigest,
    completeActorProfileBatchTransaction,
    migrateActorProfileLegacyDuplicateOffsetRecoveryProgress,
    normalizeActorProfileRecoveryProgress,
} from '../actor-profile-batch-core.mjs';
import {
    discoverActorsFromTurnSources,
    actorLedgerDigest,
    actorRegistryDigest,
    actorRegistryMatchesLedger,
    actorProfileCommitMatchesLedger,
    emptyActorLedger,
    mergeActorIdentityReveal,
    normalizeActorLedger,
    prepareActorActionAttempts,
    promoteActorCandidatesToRegistry,
    recordActorActionAttempts,
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

test('P1 recovery progress seals only bounded ActorRef fields against the current source', () => {
    const progress = normalizeActorProfileRecoveryProgress({
        identityLocked: true,
        rows: [{
            actorId: 'NPC-recovery-1',
            name: '合成人物',
            discovery: true,
            sourceAnchor: '合成正文中的合成人物首次出现。',
            coverageUnitId: 'CU-002',
            sourceUnitOffset: 420,
            sourceOffset: 438,
            sourceOrdinal: 1,
            modules: {
                person: '这是已经通过本地解析与目标行校验的身份档案字段。',
                personality: '这是已经通过本地解析与目标行校验的性格档案字段。',
                unexpected: '不得进入恢复回执。',
            },
        }],
    });
    assert.equal(progress.identityLocked, true);
    assert.equal(progress.verifiedFieldCount, 2);
    assert.deepEqual(Object.keys(progress.rows[0].modules), ['person', 'personality']);
    assert.deepEqual({
        coverageUnitId: progress.rows[0].coverageUnitId,
        sourceUnitOffset: progress.rows[0].sourceUnitOffset,
        sourceOffset: progress.rows[0].sourceOffset,
        sourceOrdinal: progress.rows[0].sourceOrdinal,
    }, {
        coverageUnitId: 'CU-002',
        sourceUnitOffset: 420,
        sourceOffset: 438,
        sourceOrdinal: 1,
    });
    const digest = actorProfileRecoveryProgressDigest(progress, 'profile-source:one');
    assert.match(digest, /^profile-recovery-progress:/u);
    assert.notEqual(
        digest,
        actorProfileRecoveryProgressDigest(progress, 'profile-source:two'),
        'the same verified fields cannot be replayed under another SourceRef digest',
    );
});

test('production P1 uses the background lane and host-only foreground preemption', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const callModelSource = source.slice(
        source.indexOf('async function callModel'),
        source.indexOf('async function probeModelChannelConnections'),
    );
    assert.match(callModelSource, /const runUntilCancelled = options\.runUntilCancelled === true/u);
    assert.match(callModelSource, /`\$\{modelConnectionKey\(profile\)\}:channel:\$\{channel\}`/u);
    assert.doesNotMatch(callModelSource, /channel:\$\{channel\}:slot:\$\{slotIndex\}/u);
    assert.match(callModelSource, /mvuadUsesHostGenerateRaw/u);
    assert.match(source, /FOREGROUND_PREEMPTED/u);
    const profileSource = source.slice(
        source.indexOf('async function completeActorProfilesForTurn'),
        source.indexOf('function actorProfileTransientResult'),
    );
    assert.match(profileSource, /runUntilCancelled: true/u);
    assert.match(
        profileSource,
        /moduleKeys\.every\(\(moduleKey\) => moduleKey === 'physiology'\)/u,
        'mixed core plus physiology must stay on the profile lane',
    );
    const generationSource = source.slice(
        source.indexOf('function bindEvents'),
        source.indexOf('function bindUiEvents'),
    );
    assert.match(
        generationSource,
        /preemptHostBackgroundModelControllersForForegroundGeneration\(\)/u,
    );
});

test('foreground preemption resumes only fields missing after validated transport chunks', async () => {
    const fixture = prepareRegisteredBatch(7);
    const moduleText = (actorId, moduleKey) => (
        `${actorId} ${moduleKey}：${'这是完整、自然、可读且仅属于当前目标字段的合成档案内容。'.repeat(6)}`
    );
    const outputFor = ({ candidates, moduleKeys }) => candidates.map((candidate) => [
        `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
        ...moduleKeys.map((moduleKey) => (
            `<module key="${moduleKey}">${moduleText(candidate.actorRef.actorId, moduleKey)}</module>`
        )),
        '</profile-target>',
    ].join('\n')).join('\n');
    let firstChunkCount = 0;
    const first = await runBatch(fixture, {
        moduleProtocol: 'raw',
        semanticRetry: false,
        requestBatch: async (request) => {
            firstChunkCount += 1;
            if (firstChunkCount === 1) return outputFor(request);
            const error = new Error('foreground_preempted');
            error.failureKind = 'foreground_preempted';
            error.profileBatchFailureCategory = 'foreground_preempted';
            throw error;
        },
    });
    assert.equal(first.result.persistenceStatus, 'not_completed');
    assert.equal(first.saveCount, 0, 'a partial working clone is never public ledger state');
    assert.equal(first.result.recoveryProgress.verifiedFieldCount, 36);

    const resumedTargets = [];
    const resumed = await runBatch(fixture, {
        moduleProtocol: 'raw',
        semanticRetry: false,
        recoveryProgress: first.result.recoveryProgress,
        requestBatch: async (request) => {
            resumedTargets.push(...request.candidates.map((candidate) => candidate.actorRef.actorId));
            return outputFor(request);
        },
    });
    assert.equal(resumed.result.persistenceStatus, 'atomic_readback');
    assert.equal(resumed.saveCount, 2);
    assert.deepEqual(
        resumedTargets,
        [fixture.candidates[6].actorRef.actorId],
        'the six validated rows must not be regenerated after foreground preemption',
    );
});

test('production actor-row transport runs bounded direct waves and stops before the next wave on failure', async () => {
    const fixture = prepareRegisteredBatch(5, { chatId: 'chat-profile-bounded-waves' });
    const moduleText = (key, actorId) => `${actorId} ${key}. ${'Complete stable dossier prose records facts limits choices and usable future context. '.repeat(6)}`;
    const outputFor = ({ candidates, moduleKeys }) => candidates.map((candidate) => [
        `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
        ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.actorId)}</module>`),
        '</profile-target>',
    ].join('\n')).join('\n');
    let active = 0;
    let maxActive = 0;
    const calls = [];
    const succeeded = await runBatch(fixture, {
        moduleProtocol: 'raw',
        transportActorLimit: 1,
        transportConcurrency: 2,
        transportRouteSlots: [0, 2],
        requestBatch: async (request) => {
            calls.push({
                actorIds: request.candidates.map((candidate) => candidate.actorRef.actorId),
                routeSlotIndex: request.routeSlotIndex,
                occupied: request.occupiedRouteSlotIndices,
            });
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return outputFor(request);
        },
    });
    assert.equal(calls.length, 5);
    assert.ok(calls.every(({ actorIds }) => actorIds.length === 1));
    assert.deepEqual(calls.slice(0, 2).map((entry) => entry.routeSlotIndex), [0, 2]);
    assert.ok(calls.slice(0, 2).every((entry) => (
        JSON.stringify(entry.occupied) === JSON.stringify([0, 2])
    )));
    assert.equal(maxActive, 2, 'the route-level concurrency bound must be enforced');
    assert.equal(succeeded.result.persistenceStatus, 'atomic_readback');
    assert.equal(succeeded.saveCount, 2, 'all rows still share one pending/final transaction');

    const failedCalls = [];
    const failed = await runBatch(fixture, {
        moduleProtocol: 'raw',
        semanticRetry: false,
        transportActorLimit: 1,
        transportConcurrency: 2,
        transportRouteSlots: [0, 2],
        requestBatch: async (request) => {
            const index = failedCalls.length;
            failedCalls.push(request.candidates[0].actorRef.actorId);
            if (index === 1) throw new Error('synthetic bounded-wave failure');
            await new Promise((resolve) => setTimeout(resolve, 5));
            return outputFor(request);
        },
    });
    assert.deepEqual(failedCalls, fixture.candidates.slice(0, 2)
        .map((candidate) => candidate.actorRef.actorId));
    assert.equal(failed.saveCount, 0);
    assert.equal(failed.result.persistenceStatus, 'not_completed');
    assert.equal(failed.result.recoveryProgress.verifiedFieldCount, 6);
});

test('production profile route plan freezes one healthy slot per distinct direct connection key', () => {
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const helperSource = source.slice(
        source.indexOf('function actorProfileTransportRoutePlan'),
        source.indexOf('function modelTaskPriority'),
    );
    const profiles = [
        { slotIndex: 0, profile: { provider: 'direct', key: 'A' } },
        { slotIndex: 1, profile: { provider: 'direct', key: 'A' } },
        { slotIndex: 2, profile: { provider: 'direct', key: 'B' } },
        { slotIndex: 3, profile: { provider: 'direct', key: 'C' } },
    ];
    const plan = Function(
        'channelConnectionProfiles',
        'modelRouteHealthRecord',
        'modelConnectionKey',
        `${helperSource}; return actorProfileTransportRoutePlan;`,
    )(
        () => profiles,
        (_channel, slotIndex) => ({ openedUntil: slotIndex === 3 ? 999 : 0 }),
        (profile) => profile.key,
    )({}, 100);
    assert.deepEqual([...plan.slotIndices], [0, 2]);
    assert.equal(plan.concurrency, 2);

    const mixed = Function(
        'channelConnectionProfiles',
        'modelRouteHealthRecord',
        'modelConnectionKey',
        `${helperSource}; return actorProfileTransportRoutePlan;`,
    )(
        () => [{ slotIndex: 0, profile: { provider: 'tavern' } }],
        () => ({ openedUntil: 0 }),
        () => 'host',
    )({}, 100);
    assert.deepEqual([...mixed.slotIndices], []);
    assert.equal(mixed.concurrency, 1);
});

test('identity bootstrap failure calls the full accepted narrative model once and writes no partial profile', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-identity-once' });
    let identityCalls = 0;
    const options = {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative: '\u5c91\u9065\u8d70\u8fdb\u5927\u5385\u5e76\u6e05\u695a\u62a5\u4e0a\u59d3\u540d\u3002',
            completionMode: 'full',
        },
        requestBatch: ({ groupKey }) => {
            assert.equal(groupKey, 'identity_bootstrap');
            identityCalls += 1;
            return 'not a recoverable identity route';
        },
    };
    const first = await runBatch({ ...fixture, candidates: [] }, options);
    assert.equal(identityCalls, 1);
    assert.equal(first.result.modelCalls, 1);
    assert.equal(first.result.persistenceStatus, 'not_completed');
    assert.equal(first.saveCount, 0);
    assert.equal(first.result.ledger.actors.length, 0);
    assert.equal(Object.keys(first.result.ledger.actorRegistry?.registered || {}).length, 0);
    assert.equal(first.result.recoveryProgress?.identityAttempted, true);
    assert.equal(first.result.recoveryProgress?.identityLocked, false);

    const resumed = await runBatch({ ...fixture, candidates: [] }, {
        ...options,
        recoveryProgress: first.result.recoveryProgress,
    });
    assert.equal(identityCalls, 1, 'sealed recovery must not resend the accepted narrative');
    assert.equal(resumed.result.modelCalls, 0);
    assert.equal(resumed.result.persistenceStatus, 'not_completed');
    assert.equal(resumed.saveCount, 0);
    assert.equal(resumed.result.ledger.actors.length, 0);
    assert.equal(Object.keys(resumed.result.ledger.actorRegistry?.registered || {}).length, 0);
    assert.ok(resumed.result.failures.some((failure) => (
        failure.reason === 'actor_profile.identity_bootstrap_already_attempted'
    )));
});

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

function resolveLiteralDiscoveries(fixture, acceptedNarrative, {
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
    recoveryProgress = null,
    transportActorLimit = undefined,
    transportConcurrency = undefined,
    transportRouteSlots = undefined,
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
    const wrapIdentityCoverage = (raw) => {
        const text = String(raw || '').trim();
        if (/<coverage-unit\b/iu.test(text)) return text;
        const coverage = actorProfileDiscoveryCoveragePlan(discoveryContext?.acceptedNarrative || '');
        if (!coverage.units.length) return text;
        const targets = [...text.matchAll(/<profile-target\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?(?:<\/profile-target>|$)/giu)]
            .map((match) => ({ name: match[1], text: match[0] }));
        const strictEmpty = /^\s*(?:\[\s*\]|\u65e0\u4eba\u7269\u6863\u6848)\s*$/u.test(text);
        if (!targets.length && !strictEmpty) return text;
        return coverage.units.map((unit, unitIndex) => {
            const rows = targets.filter((target) => (
                unit.text.includes(target.name)
                || (unitIndex === 0 && !coverage.units.some((candidate) => candidate.text.includes(target.name)))
            ));
            return `<coverage-unit id="${unit.id}" digest="${unit.digest}">\n${rows.length ? rows.map((row) => row.text).join('\n') : '<no-new/>'}\n</coverage-unit>`;
        }).join('\n');
    };
    const adaptedRequestBatch = async (args) => {
        if (!args.groupKey) return requestBatch(args);
        if (args.groupKey === 'identity_bootstrap') {
            const raw = await requestBatch(args);
            if (/^\s*\u65e0\u4eba\u7269\u6863\u6848/u.test(String(raw || ''))) {
                return wrapIdentityCoverage('\u65e0\u4eba\u7269\u6863\u6848');
            }
            if (/^\s*[\[{]/u.test(String(raw || '')) && !/^\s*\[\s*\]\s*$/u.test(String(raw || ''))) {
                return raw;
            }
            const discoveryOnly = parseActorProfileCompletionBatchOutput(raw, {
                candidates: [],
                discoveryContext,
            });
            if (discoveryOnly.batchMeta?.formatUnrecoverable) return raw;
            const routes = [
                ...(discoveryOnly.discoveries || []),
                ...(discoveryOnly.unresolved || []).filter((entry) => entry?.candidateRef?.name),
            ].map((entry) => (
                `<profile-target actor="new" name="${entry.candidateRef?.name}"></profile-target>`
            ));
            for (const entry of discoveryOnly.unresolved || []) {
                if (entry?.reason === 'actor_profile.discovery_ref_duplicate' && entry?.candidateRef?.name) {
                    routes.push(`<profile-target actor="new" name="${entry.candidateRef.name}"></profile-target>`);
                }
            }
            return wrapIdentityCoverage(routes.length ? routes.join('\n') : '\u65e0\u4eba\u7269\u6863\u6848');
        }
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
        const cachedNames = new Set([
            ...(cachedLegacy?.entries || []).map((entry) => entry.name),
            ...(cachedLegacy?.discoveries || []).map((entry) => entry.candidateRef?.name),
        ]);
        if (!cachedLegacy || args.candidates.some((candidate) => (
            !cachedNames.has(candidate.actorRef?.name || candidate.name)
        ))) {
            const raw = await requestBatch(args);
            cachedAttempt = args.attempt;
            const nextLegacy = parseActorProfileCompletionBatchOutput(raw, {
                candidates: args.candidates,
                discoveryContext,
            });
            cachedLegacy = cachedLegacy
                ? {
                    ...cachedLegacy,
                    entries: [...(cachedLegacy.entries || []), ...(nextLegacy.entries || [])],
                    discoveries: [...(cachedLegacy.discoveries || []), ...(nextLegacy.discoveries || [])],
                    unresolved: [...(cachedLegacy.unresolved || []), ...(nextLegacy.unresolved || [])],
                }
                : nextLegacy;
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
    const moduleRequestBatch = async (args) => {
        const raw = await requestBatch(args);
        if (args.groupKey !== 'identity_bootstrap') return raw;
        return wrapIdentityCoverage(!String(raw || '').trim() ? '\u65e0\u4eba\u7269\u6863\u6848' : raw);
    };
    const result = await completeActorProfileBatchTransaction({
        ledger: fixture.ledger,
        candidates: fixture.candidates,
        evidenceText: '这是完全合成的P1档案测试材料。',
        turn: fixture.ref.generation,
        target: { ...fixture.ref, sourceRef: fixture.ref },
        semanticRetry,
        transportActorLimit,
        transportConcurrency,
        transportRouteSlots,
        allowDiscovery,
        discoveryContext,
        recoveryProgress,
        preflightDiscoveries,
        requestBatch: moduleProtocol === 'raw'
            ? requestBatch
            : moduleProtocol ? moduleRequestBatch : adaptedRequestBatch,
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
        assert.equal(calls.length, count ? Math.ceil(count / 6) : 0);
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

test('rowless current-source identity response fails after one model call with zero writes', async () => {
    const fixture = prepareRegisteredBatch(1);
    const resolvedCandidates = structuredClone(fixture.candidates);
    const name = fixture.candidates[0].actorRef.name;
    const anchor = `${name} enters the scene.`;
    const calls = [];
    let resolverCalls = 0;
    const moduleText = (key) => `${key}：${'这是完整自然中文模块内容，包含稳定事实、现实限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative: anchor, completionMode: 'full' },
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt, count: candidates.length });
            if (groupKey === 'identity_bootstrap') {
                return attempt === 0
                    ? 'not a profile array'
                    : `<profile-target actor="new" name="${name}"></profile-target>`;
            }
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
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
    assert.deepEqual(calls, [
        { groupKey: 'identity_bootstrap', attempt: 0, count: 0 },
    ]);
    assert.equal(resolverCalls, 1);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.saveCount, 0);
});

test('flat identity routes bind locally and complete Registry through atomic pending-final readback', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-flat-identity-atomic' });
    const names = ['合成人物甲', '合成人物乙', '合成人物丙'];
    const acceptedNarrative = `${names[0]}先到场。${'景'.repeat(430)}。${names[1]}与${names[2]}随后分别到场。`;
    const calls = [];
    const moduleText = (key, name) => (
        `${name}${key}：${'这是完整、自然且可长期使用的合成人物档案内容，包含稳定事实、现实限制、选择依据与后续发展空间。'.repeat(4)}`
    );
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt, count: candidates.length });
            if (groupKey === 'identity_bootstrap') return [
                '识别结果如下：',
                ...names.map((name) => `<profile-target actor="new" name="${name}"/>`),
            ].join('\n');
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(calls.filter((entry) => entry.groupKey === 'identity_bootstrap').length, 1);
    assert.equal(run.result.modelCalls, 2);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.readbackVerified, true);
    assert.equal(run.result.accepted.length, names.length);
    assert.equal(run.result.failures.length, 0);
    assert.equal(run.saveCount, 2);
    assert.equal(run.persistencePayloads[0].ledger.actors.filter((actor) => (
        actor.profileV6?.preparedForAction === false
    )).length, names.length);
    assert.equal(run.persistencePayloads[1].ledger.actors.filter((actor) => (
        actor.profileV6?.preparedForAction === true
    )).length, names.length);
});

test('holdout invented discovery name fails once without resending accepted narrative', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-holdout-literal-retry' });
    const literalName = '\u9646\u7d20\u82e9';
    const inventedName = '\u6c88\u96fe\u9065';
    const probeNoise = 'PROBE_MODULE_MUST_NEVER_ENTER_WORKING_PROFILE';
    const lockedCore = 'LOCKED_CHARACTER_CORE_PERSON';
    const acceptedNarrative = `\u5e18\u5b50\u88ab\u6311\u8d77\u65f6\uff0c${literalName}\u62b1\u7740\u4e00\u53e0\u8d26\u9875\u8d70\u8fdb\u6765\uff0c\u6e05\u695a\u5730\u62a5\u4e0a\u81ea\u5df1\u7684\u59d3\u540d\u3002`;
    const calls = [];
    const moduleText = (key, name) => `${name}${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u6863\u6848\u6bb5\u843d\uff0c\u5305\u542b\u660e\u786e\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u3001\u884c\u52a8\u4f9d\u636e\u4e0e\u540e\u7eed\u53d1\u5c55\u7a7a\u95f4\u3002'.repeat(4)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt, messages }) => {
            calls.push({ groupKey, attempt, messages });
            if (groupKey === 'identity_bootstrap') {
                const name = attempt === 0 ? inventedName : literalName;
                return [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText(probeNoise, name)}</module>`,
                    '</profile-target>',
                ].join('\n');
            }
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key === 'person' ? lockedCore : key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(calls.map(({ groupKey, attempt }) => ({ groupKey, attempt })), [
        { groupKey: 'identity_bootstrap', attempt: 0 },
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.readbackVerified, false);
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.ledger.actors.length, 0);
});

test('an invented-only identity answer fails once and cannot become strict no-candidates', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-holdout-empty-retry' });
    const inventedName = '\u97e9\u77f3\u8c61';
    const acceptedNarrative = '\u7a7a\u8d70\u5eca\u91cc\u53ea\u6709\u98ce\u5439\u52a8\u5e18\u5b50\uff0c\u6ca1\u6709\u4efb\u4f55\u5177\u540d\u4eba\u7269\u51fa\u573a\u3002';
    let retryPrompt = '';
    let identityCalls = 0;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full' },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ attempt, messages }) => {
            identityCalls += 1;
            if (attempt === 1) {
                retryPrompt = messages.map((entry) => entry.content).join('\n');
                return '\u65e0\u4eba\u7269\u6863\u6848';
            }
            return [
                `<profile-target actor="new" name="${inventedName}">`,
                `<module key="person">${'\u8fd9\u662f\u957f\u5ea6\u8db3\u591f\u4f46\u59d3\u540d\u5e76\u4e0d\u5b58\u5728\u4e8e\u6b63\u6587\u7684\u8eab\u4efd\u6a21\u5757\u5185\u5bb9\u3002'.repeat(6)}</module>`,
                '</profile-target>',
            ].join('\n');
        },
    });
    assert.equal(retryPrompt, '');
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.ok(run.result.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_name_not_in_narrative'
    )));
    assert.equal(run.result.readbackVerified, false);
    assert.equal(run.saveCount, 0);
    assert.equal(identityCalls, 1);
});

test('full unit coverage with no-new still fills an existing incomplete ActorRef', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-covered-empty-existing' });
    const calls = [];
    const moduleText = (key) => `${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u81ea\u7136\u4e2d\u6587\u6a21\u5757\u5185\u5bb9\uff0c\u5305\u542b\u7a33\u5b9a\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u4e0e\u540e\u7eed\u884c\u52a8\u4f9d\u636e\u3002'.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative: '\u73b0\u573a\u6ca1\u6709\u65b0\u4eba\u7269\u51fa\u573a\u3002', completionMode: 'full' },
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt });
            if (groupKey === 'identity_bootstrap') return '\u65e0\u4eba\u7269\u6863\u6848';
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(calls[0].groupKey, 'identity_bootstrap');
    assert.deepEqual(calls.slice(1).map((entry) => entry.groupKey), ['character_core']);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.accepted.length, 1);
    assert.equal(run.saveCount, 2);
});

test('one naked empty identity answer stays fail-closed without a second full-narrative call', async () => {
    for (const mode of ['empty', 'transport', 'format']) {
        const fixture = prepareRegisteredBatch(0, { chatId: `chat-empty-${mode}` });
        let calls = 0;
        const run = await runBatch(fixture, {
            moduleProtocol: 'raw',
            allowDiscovery: true,
            discoveryContext: { acceptedNarrative: '\u53ea\u6709\u7a7a\u8d70\u5eca\u4e0e\u98ce\u58f0\u3002', completionMode: 'full' },
            requestBatch: ({ attempt }) => {
                calls += 1;
                if (attempt === 0 || mode === 'empty') return '\u65e0\u4eba\u7269\u6863\u6848';
                if (mode === 'transport') {
                    const error = new Error('synthetic coverage transport failure');
                    error.routeDiagnostic = {
                        requestKind: 'actor_profile_batch',
                        requestStarted: true,
                        failureKind: 'transport',
                    };
                    throw error;
                }
                return 'not a profile route';
            },
        });
        assert.equal(calls, 1, mode);
        assert.equal(run.result.modelCalls, 1, mode);
        assert.equal(run.result.persistenceStatus, 'not_completed', mode);
        assert.equal(run.saveCount, 0, mode);
        assert.ok(run.result.failures.length > 0, mode);
    }
});

test('an invalid first identity answer fails before resolver or profile groups', async () => {
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
        { attempt: 0, actorIds: [] },
    ]);
    assert.equal(run.result.modelCalls, 1);
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
        assert.deepEqual(calls, [0], label);
        assert.equal(run.result.modelCalls, 1, label);
        assert.equal(run.result.persistenceStatus, 'not_completed', label);
        assert.equal(run.result.readbackVerified, false, `${label}: must not issue a P3 no-candidate permit`);
        assert.deepEqual(
            run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1),
            [],
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
    assert.deepEqual(calls, [
        { attempt: 0, actorIds: [] },
    ]);
    assert.ok(calls.every((entry) => entry.actorIds.length === 0));
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
    assert.deepEqual(calls, [
        { attempt: 0, actorIds: [] },
    ]);
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
    assert.equal(malformed.result.modelCalls, 1);
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
    assert.equal(mixed.result.modelCalls, 1);
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
    assert.equal(combined.result.modelCalls, 2);
    assert.deepEqual(combined.result.batchMeta.moduleGroups.map((entry) => entry.groupKey), [
        'identity_bootstrap', 'character_core',
    ]);
    assert.equal(combined.result.persistenceStatus, 'not_completed');
    assert.equal(combined.saveCount, 0);
    assert.ok(combined.result.failures.some((failure) => (
        failure.reason === 'actor_profile.discovery_promotion_mapping_missing'
    )));
    assert.equal(combined.result.failures.some((failure) => (
        failure.reason === 'actor_profile.group_row_missing'
    )), false);
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
    assert.doesNotMatch(coreFirst.prompt, /ticket-working-context/u);
    assert.match(coreFirst.prompt, /characterCreationTicket/u);
    assert.match(coreFirst.prompt, /locked-role/u);
    assert.match(coreFirst.prompt, /person/u);
    assert.match(coreRetry.prompt, /actor_profile\.module_missing/u);
    assert.match(coreRetry.prompt, /history/u);
    assert.doesNotMatch(coreRetry.prompt, /"personality":\[/u);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.readbackVerified, true);
    assert.equal(run.saveCount, 2);
    assert.deepEqual(fixture.candidates[0].confirmed, { canonRole: 'locked-role' });
    assert.deepEqual(fixture.candidates[0].locks, { canonRole: true });
});

test('explicit row-key reveal keeps one ActorId, aliases the old label and atomically refreshes one dossier', async () => {
    const chatId = 'chat-identity-reveal-escapee';
    const fixture = prepareRegisteredBatch(1, { chatId });
    const actorId = fixture.candidates[0].actorRef.actorId;
    const firstRef = narrativeDiscoverySourceRef(fixture.ref);
    const renamedLedger = mergeActorIdentityReveal(fixture.ledger, {
        actorId,
        revealedName: '\u9003\u4ea1\u8005',
        sourceRef: firstRef,
        turn: 1,
    });
    const initialCandidates = selectActorProfileCompletionCandidates(renamedLedger, {
        initialActorIds: [actorId],
        maintenanceMaxActors: 0,
    });
    const proseFor = (key, name) => `${name}${key}\uff1a${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u6863\u6848\u53e5\u5b50\uff0c\u5305\u542b\u73b0\u5b9e\u4f9d\u636e\u3001\u5c40\u9650\u3001\u52a8\u673a\u4e0e\u540e\u7eed\u53d1\u5c55\u7a7a\u95f4\u3002'.repeat(4)}`;
    const baseline = await runBatch({
        ...fixture,
        ledger: renamedLedger,
        candidates: initialCandidates,
    }, {
        moduleProtocol: true,
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${proseFor(key, candidate.actorRef.name)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    assert.equal(baseline.result.persistenceStatus, 'atomic_readback');
    const baselineActor = baseline.result.ledger.actors.find((actor) => actor.id === actorId);
    assert.equal(baselineActor.name, '\u9003\u4ea1\u8005');

    const secondRef = sourceRef(chatId, 2);
    const acceptedNarrative = '\u9003\u4ea1\u8005\u63a5\u4e0b\u6e7f\u900f\u7684\u5934\u5dfe\uff0c\u7ec8\u4e8e\u8bf4\u51fa\u771f\u540d\uff1a\u201c\u6211\u53eb\u6770\u514b\u3002\u201d';
    const registeredProfileCandidates = selectActorProfileCompletionCandidates(
        baseline.result.ledger,
        {
            initialActorIds: [actorId],
            includeReadyActorIds: [actorId],
            maintenanceMaxActors: 0,
        },
    );
    const registeredActorIndex = [{
        actorId,
        displayName: '\u9003\u4ea1\u8005',
        aliases: baselineActor.identity.aliases,
    }];
    const applyReveal = (ledger, reveal) => mergeActorIdentityReveal(ledger, {
        actorId: reveal.actorId,
        revealedName: reveal.revealedName,
        aliases: [reveal.previousName],
        evidence: ['identity-reveal-test'],
        sourceRef: secondRef,
        turn: 2,
    });
    const revealed = await runBatch({
        ledger: baseline.result.ledger,
        candidates: registeredProfileCandidates,
        registration: fixture.registration,
        binding: fixture.binding,
        ref: secondRef,
    }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(secondRef),
            registeredActorIndex,
            registeredProfileCandidates,
        },
        preflightDiscoveries: async ({ discoveries, identityReveals }) => {
            assert.deepEqual(discoveries, []);
            assert.equal(identityReveals.length, 1);
            const merged = applyReveal(baseline.result.ledger, identityReveals[0]);
            const actorAfter = merged.actors.find((actor) => actor.id === actorId);
            return {
                ok: actorAfter?.name === '\u6770\u514b'
                    && actorAfter.identity.aliases.includes('\u9003\u4ea1\u8005'),
                failures: [],
                validCandidateCount: 1,
                allDiscoveriesDeterministicallyInvalid: false,
            };
        },
        resolveDiscoveries: async ({ discoveries, identityReveals }) => {
            assert.deepEqual(discoveries, []);
            const reveal = identityReveals[0];
            const ledger = applyReveal(baseline.result.ledger, reveal);
            const sourceCandidate = registeredProfileCandidates[0];
            return {
                ok: true,
                ledger,
                candidates: [{
                    ...structuredClone(sourceCandidate),
                    actorRef: { actorId, name: '\u6770\u514b' },
                    actorId,
                    name: '\u6770\u514b',
                    refreshProfileModules: [...ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES],
                }],
                entries: [],
                rejected: [],
                failures: [],
                registry: {
                    mutated: true,
                    promotedActorIds: [],
                    identityRevealedActorIds: [actorId],
                },
                snapshot: { fieldRevision: 0 },
            };
        },
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            if (groupKey === 'identity_bootstrap') {
                return '<profile-target actor="' + actorId + '" name="\u6770\u514b"><identity-evidence>'
                    + acceptedNarrative
                    + '</identity-evidence></profile-target>';
            }
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.actorId), [actorId]);
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.name), ['\u6770\u514b']);
            return candidates.map((candidate) => [
                `<profile-target actor="${actorId}" name="\u6770\u514b">`,
                ...moduleKeys.map((key) => `<module key="${key}">${proseFor(key, '\u6770\u514b')}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(
        revealed.result.persistenceStatus,
        'atomic_readback',
        JSON.stringify(revealed.result.failures || []),
    );
    assert.equal(revealed.saveCount, 2);
    assert.equal(revealed.result.ledger.actors.length, 1);
    const finalActor = revealed.result.ledger.actors[0];
    assert.equal(finalActor.id, actorId);
    assert.equal(finalActor.name, '\u6770\u514b');
    assert.equal(finalActor.identity.aliases.includes('\u9003\u4ea1\u8005'), true);
    assert.equal(finalActor.profileV6.name, '\u6770\u514b');
    assert.match(finalActor.profileV6.narrativeSections.person.text, /\u6770\u514b/u);
    assert.equal(Object.keys(revealed.result.ledger.actorRegistry.registered).includes('\u6770\u514b'), true);
    assert.equal(Object.keys(revealed.result.ledger.actorRegistry.registered).includes('\u9003\u4ea1\u8005'), false);
    assert.equal(actorProfileReadyForAction(finalActor), true);
});

test('identity preflight failure performs one bootstrap call and no later group', async () => {
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
    assert.deepEqual(calls.map(({ groupKey, attempt }) => ({ groupKey, attempt })), [
        { groupKey: 'identity_bootstrap', attempt: 0 },
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_candidate.identity_system'
    )));
});

test('a deterministic-invalid identity row fails after one call and zero writes', async () => {
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
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.length > 0);
    assert.ok(run.result.failures.some((failure) => failure.groupKey === 'identity_bootstrap'));
});

test('mixed valid and invalid identity candidates fail atomically after one call', async () => {
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
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_candidate.identity_system'
    )));
});

test('identity module or format failure gets no second model call', async () => {
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
    ]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.ok(run.result.failures.some((failure) => (
        failure.groupKey === 'identity_bootstrap' && String(failure.reason || '').length > 0
    )));
});

test('protected identity failure stops after one bootstrap call and keeps the ledger at S0', async () => {
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
    assert.equal(identityCalls.length, 1);
    const firstUserPrompt = identityCalls[0].messages.find((entry) => entry.role === 'user').content;
    assert.equal((firstUserPrompt.match(/\u672c\u5730\u53d7\u4fdd\u62a4\u8eab\u4efd\u7d22\u5f15\uff08\u7981\u6b62\u4f5c\u4e3a new\uff09/g) || []).length, 1);
    assert.match(firstUserPrompt, /\u672c\u5730\u53d7\u4fdd\u62a4\u8eab\u4efd\u7d22\u5f15\uff08\u7981\u6b62\u4f5c\u4e3a new\uff09\uff1a\["\u73a9\u5bb6\u7532"\]/u);
    assert.equal(calls.filter((entry) => entry.groupKey !== 'identity_bootstrap').length, 0);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.readbackVerified, false);
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.ledger.actors.length, 0);
    assert.equal(Object.keys(run.result.ledger.actorRegistry?.registered || {}).length, 0);
});

test('identity preflight failure reports a bounded local code without retrying the model', async () => {
    const fixture = prepareRegisteredBatch(0);
    const name = '\u5c91\u9065';
    const acceptedNarrative = `${name}\u8d70\u8fdb\u5927\u5385\u5e76\u62a5\u4e0a\u59d3\u540d\u3002`;
    const secretReason = 'private transport detail must not return to model';
    let calls = 0;
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
        requestBatch: () => {
            calls += 1;
            return [
                `<profile-target actor="new" name="${name}">`,
                `<module key="person">${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u8eab\u4efd\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u660e\u786e\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u4e0e\u540e\u7eed\u884c\u52a8\u4f9d\u636e\u3002'.repeat(4)}</module>`,
                '</profile-target>',
            ].join('\n');
        },
    });
    assert.equal(calls, 1);
    assert.ok(run.result.failures.length > 0);
    assert.ok(run.result.failures.every((failure) => failure.reason !== secretReason));
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
});

test('all seven controlled identity failures report locally without a second model call', async () => {
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
        let calls = 0;
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
            requestBatch: () => {
                calls += 1;
                return [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${'\u8fd9\u662f\u5b8c\u6574\u3001\u81ea\u7136\u4e14\u53ef\u7528\u7684\u4e2d\u6587\u4eba\u7269\u8eab\u4efd\u6863\u6848\u5185\u5bb9\uff0c\u5305\u542b\u660e\u786e\u4e8b\u5b9e\u3001\u73b0\u5b9e\u9650\u5236\u4e0e\u540e\u7eed\u884c\u52a8\u4f9d\u636e\u3002'.repeat(4)}</module>`,
                    '</profile-target>',
                ].join('\n');
            },
        });
        assert.equal(calls, 1, code);
        assert.ok(run.result.failures.some((failure) => failure.reason === code), code);
        assert.equal(run.saveCount, 0, code);
    }
});

test('verified legacy duplicate-offset receipt unlocks identity once and completes three actors atomically', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-legacy-duplicate-offset-recovery' });
    const currentSourceRef = narrativeDiscoverySourceRef(fixture.ref);
    const batch = ticketBatch(fixture.ref, 3);
    const sealedBatch = sealActorProfileTicketBatchForPersistence(batch, currentSourceRef);
    assert.ok(sealedBatch);
    const lockedEmpty = normalizeActorProfileRecoveryProgress({
        identityLocked: true,
        identityAttempted: true,
        rows: [],
    });
    const oldReceipt = createActorProfileRetryReceipt({
        sourceRef: currentSourceRef,
        ticketBatch: sealedBatch,
        outcomeStatus: 'not_completed',
        failingModules: [],
        failureCodes: ['actor_profile.discovery_source_offset_duplicate'],
        updatedAt: 27,
    });
    oldReceipt.recoveryProgress = structuredClone(lockedEmpty);
    oldReceipt.recoveryProgressDigest = actorProfileRecoveryProgressDigest(
        lockedEmpty,
        oldReceipt.sourceDigest,
    );
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const recoverySource = indexSource.slice(
        indexSource.indexOf('function actorProfileRecoveryProgressFromReceipt'),
        indexSource.indexOf('async function persistActorProfileRecoveryState'),
    );
    const fromNamespace = Function(
        'actorProfileRecoverySourceMatches',
        'normalizeActorProfileRecoveryProgress',
        'actorProfileRecoveryProgressDigest',
        'actorProfileRetryReceiptMatches',
        'actorProfileTicketBatchPersistenceMatches',
        'migrateActorProfileLegacyDuplicateOffsetRecoveryProgress',
        `${recoverySource}; return actorProfileRecoveryProgressFromNamespace;`,
    )(
        actorProfileRecoverySourceMatches,
        normalizeActorProfileRecoveryProgress,
        actorProfileRecoveryProgressDigest,
        actorProfileRetryReceiptMatches,
        actorProfileTicketBatchPersistenceMatches,
        migrateActorProfileLegacyDuplicateOffsetRecoveryProgress,
    );
    const namespace = {
        characterCreationTicketBatches: [structuredClone(sealedBatch)],
        actorProfileRetryReceipt: structuredClone(oldReceipt),
    };
    const recovered = fromNamespace(namespace, currentSourceRef);
    assert.deepEqual({
        identityLocked: recovered.identityLocked,
        identityAttempted: recovered.identityAttempted,
        rows: recovered.rows,
    }, { identityLocked: false, identityAttempted: false, rows: [] });

    assert.equal(fromNamespace(namespace, {
        ...currentSourceRef,
        contentFingerprint: 'different-content',
        contentHash: 'different-content',
    }), null, 'another accepted source must not consume the compatibility migration');
    const damagedNamespace = structuredClone(namespace);
    damagedNamespace.characterCreationTicketBatches[0].tickets[0].ticketId = 'damaged-ticket';
    assert.equal(fromNamespace(damagedNamespace, currentSourceRef), null);
    const otherReceipt = createActorProfileRetryReceipt({
        sourceRef: currentSourceRef,
        ticketBatch: sealedBatch,
        outcomeStatus: 'not_completed',
        failingModules: [],
        failureCodes: ['actor_profile.module_missing'],
        updatedAt: 28,
    });
    otherReceipt.recoveryProgress = structuredClone(lockedEmpty);
    otherReceipt.recoveryProgressDigest = actorProfileRecoveryProgressDigest(
        lockedEmpty,
        otherReceipt.sourceDigest,
    );
    const genericLocked = fromNamespace({
        characterCreationTicketBatches: [structuredClone(sealedBatch)],
        actorProfileRetryReceipt: otherReceipt,
    }, currentSourceRef);
    assert.equal(genericLocked.identityLocked, true);
    assert.equal(genericLocked.identityAttempted, true);

    const names = ['\u7532\u660e', '\u4e59\u5b81', '\u4e19\u8861'];
    const acceptedNarrative = names.map((name) => `${name}在本回合独立出现。`).join('');
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    let identityCalls = 0;
    const moduleText = (key, name) => `${name} ${key}. ${'Complete natural dossier prose records stable facts constraints choices and usable action context. '.repeat(6)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        allowDiscovery: true,
        recoveryProgress: recovered,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: currentSourceRef,
            characterCreationTickets: structuredClone(sealedBatch.tickets),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            if (groupKey === 'identity_bootstrap') {
                identityCalls += 1;
                return coverage.units.map((unit) => [
                    `<coverage-unit id="${unit.id}" digest="${unit.digest}">`,
                    ...names.filter((name) => unit.text.includes(name))
                        .map((name) => `<profile-target actor="new" name="${name}"></profile-target>`),
                    '</coverage-unit>',
                ].join('\n')).join('\n');
            }
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(identityCalls, 1);
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify(run.result.failures));
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
    assert.equal(run.result.accepted.length, 3);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
});

test('module protocol sorts reversed discoveries by accepted first offset before provisional and final ticket binding', async () => {
    const fixture = prepareRegisteredBatch(0);
    const names = ['\u7532\u660e', '\u4e59\u5b81'];
    const acceptedNarrative = '\u7532\u660e\u5148\u8d70\u8fdb\u5927\u5385\u5e76\u62a5\u4e0a\u59d3\u540d\u3002\u8fc7\u4e86\u7247\u523b\uff0c\u4e59\u5b81\u624d\u4ece\u4fa7\u95e8\u51fa\u73b0\u5e76\u4e0e\u4f17\u4eba\u4ea4\u8c08\u3002';
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const batch = ticketBatch(fixture.ref, 2);
    batch.tickets.forEach((ticket, index) => {
        ticket.rawEnvelopeMarker = `RAW_DISC_TICKET_${index + 1}`;
    });
    const ticketIds = batch.tickets.map((ticket) => ticket.ticketId);
    const ticketAxisValues = batch.tickets.map((ticket) => ticket.axes.temperament.result);
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
        requestBatch: ({ candidates, groupKey, moduleKeys, messages }) => {
            if (groupKey === 'identity_bootstrap') {
                return [...names].reverse().map((name) => [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText('person', name)}</module>`,
                    '</profile-target>',
                ].join('\n')).join('\n');
            }
            seenLaterGroups.push({
                groupKey,
                prompt: messages.map((message) => message.content).join('\n'),
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
            const registration = promoteActorCandidatesToRegistry(upsert.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId,
                identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref,
                turn: fixture.ref.generation,
            });
            const binding = bindCharacterCreationTicketsToRegisteredActors(registration.ledger, {
                registration,
                candidates: discovered.candidates,
                batch,
                target: fixture.ref,
            });
            assert.deepEqual(binding.bindings.map((entry) => entry.ticketId), ticketIds);
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
    assert.ok(seenLaterGroups.length >= 1);
    for (const group of seenLaterGroups) {
        assert.deepEqual(group.rows, [
            { name: names[0], ticketId: ticketIds[0] },
            { name: names[1], ticketId: ticketIds[1] },
        ], group.groupKey);
    }
    const corePrompt = seenLaterGroups.find((group) => group.groupKey === 'character_core')?.prompt || '';
    for (let index = 0; index < ticketIds.length; index += 1) {
        assert.equal(corePrompt.split(ticketIds[index]).length - 1, 1);
        assert.match(corePrompt, new RegExp(ticketAxisValues[index].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
    assert.doesNotMatch(corePrompt, /RAW_DISC_TICKET_/u);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.deepEqual(run.result.ledger.actors.map((actor) => ({
        name: actor.name,
        ticketId: actor.profileV6?.designRolls?.ticketId,
    })), [
        { name: names[0], ticketId: ticketIds[0] },
        { name: names[1], ticketId: ticketIds[1] },
    ]);
});

test('nested short discovery uses its later independent offset through tickets and atomic readback', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-three-nested-discovery-offsets' });
    const names = ['\u963f\u9752\u9e3e', '\u4e19\u8861', '\u963f\u9752'];
    const acceptedNarrative = `${names[0]}先进入大厅。随后${names[1]}从侧门现身。最后${names[2]}独自抵达。`;
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const sourceAnchor = acceptedNarrative;
    const order = actorProfileDiscoverySourceOrder(names.map((name) => ({
        name,
        sourceAnchor,
        sourceUnitOffset: 0,
        sections: {},
    })), acceptedNarrative);
    assert.deepEqual(order.failures, []);
    assert.deepEqual(order.ordered.map(({ entry }) => entry.name), names);
    const expectedOffsets = names.map((name) => acceptedNarrative.lastIndexOf(name));
    assert.deepEqual(order.ordered.map(({ anchor }) => anchor.offset), expectedOffsets);
    assert.equal(new Set(order.ordered.map(({ anchor }) => anchor.offset)).size, 3);

    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    const batch = ticketBatch(fixture.ref, names.length);
    const ticketIds = batch.tickets.map((ticket) => ticket.ticketId);
    const identityModelOrder = [names[2], names[0], names[1]];
    const laterRows = [];
    let identityCalls = 0;
    let preflightChecked = false;
    const runPreflight = registryPreflight(fixture, acceptedNarrative);
    const moduleText = (key, name) => `${name} ${key}. ${'Complete natural dossier prose records stable facts constraints choices and usable action context. '.repeat(6)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        allowDiscovery: true,
        transportActorLimit: 1,
        transportConcurrency: 2,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: source,
            characterCreationTickets: structuredClone(batch.tickets),
        },
        preflightDiscoveries: async (args) => {
            assert.deepEqual(args.discoveries.map((entry) => entry.candidateRef.name), names);
            assert.deepEqual(
                args.discoveries.map((entry) => entry.candidateRef.sourceOffset),
                expectedOffsets,
            );
            preflightChecked = true;
            return runPreflight(args);
        },
        resolveDiscoveries: async ({ discoveries }) => {
            assert.deepEqual(discoveries.map((entry) => entry.candidateRef.name), names);
            assert.deepEqual(
                discoveries.map((entry) => entry.candidateRef.sourceOffset),
                expectedOffsets,
            );
            assert.ok(discoveries.every((entry) => (
                entry.candidateRef.coverageUnitId === coverage.units[0].id
                && entry.candidateRef.sourceUnitOffset === 0
            )));
            const discovered = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
                acceptedContent: acceptedNarrative,
                sourceRef: source,
                turn: fixture.ref.generation,
                modelProfileDiscoveries: structuredClone(discoveries),
            });
            assert.deepEqual(
                discovered.modelProfileDiscoveries.map((entry) => entry.candidateRef.name),
                names,
            );
            assert.deepEqual(
                discovered.modelProfileDiscoveries.map((entry) => entry.sourceOffset),
                expectedOffsets,
            );
            const upsert = runActorRegistryUpsert(discovered.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId,
                identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref,
                turn: fixture.ref.generation,
            });
            const registration = promoteActorCandidatesToRegistry(upsert.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId,
                identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest,
                allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref,
                turn: fixture.ref.generation,
            });
            const binding = bindCharacterCreationTicketsToRegisteredActors(registration.ledger, {
                registration,
                candidates: discovered.candidates,
                batch,
                target: fixture.ref,
            });
            assert.deepEqual(binding.bindings.map((entry) => entry.ticketId), ticketIds);
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
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            if (groupKey === 'identity_bootstrap') {
                identityCalls += 1;
                return coverage.units.map((unit) => [
                    `<coverage-unit id="${unit.id}" digest="${unit.digest}">`,
                    ...identityModelOrder.filter((name) => unit.text.includes(name))
                        .map((name) => `<profile-target actor="new" name="${name}"></profile-target>`),
                    '</coverage-unit>',
                ].join('\n')).join('\n');
            }
            laterRows.push(candidates.map((candidate) => ({
                name: candidate.actorRef.name,
                ticketId: candidate.characterCreationTicket?.ticketId,
            })));
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify(run.result.failures));
    assert.equal(identityCalls, 1);
    assert.equal(preflightChecked, true);
    assert.equal(run.result.accepted.length, 3);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    assert.equal(run.saveCount, 2);
    assert.ok(laterRows.length >= 1);
    assert.ok(laterRows.every((rows) => rows.every((row) => (
        ticketIds[names.indexOf(row.name)] === row.ticketId
    ))));
    assert.deepEqual(run.result.ledger.actors.map((actor) => ({
        name: actor.name,
        ticketId: actor.profileV6?.designRolls?.ticketId,
    })), names.map((name, index) => ({ name, ticketId: ticketIds[index] })));
    const refreshed = normalizeActorLedger(structuredClone(run.result.ledger), {
        chatId: fixture.ledger.chatId,
    });
    assert.ok(refreshed.actors.every(actorProfileReadyForAction));
    assert.deepEqual(refreshed.actors.map((actor) => actor.profileV6?.designRolls?.ticketId), ticketIds);
});

test('later coverage unit preserves leading whitespace offsets across recovery and ledger readback', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-leading-whitespace-coverage-recovery' });
    const names = ['\u963f\u9752\u9e3e', '\u4e19\u8861', '\u963f\u9752'];
    const acceptedNarrative = `${'X'.repeat(420)}\n  ${names[0]}先进入大厅。${names[1]}随后出现。${names[2]}最后独自抵达。`;
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    assert.ok(coverage.units.length >= 2);
    assert.equal(coverage.units[1].text.startsWith('\n  '), true);
    const expectedUnitOffset = coverage.units[0].text.length;
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const identityModelOrder = [names[2], names[0], names[1]];
    let identityCalls = 0;
    const identityOutput = () => coverage.units.map((unit) => {
        const targets = identityModelOrder.filter((name) => unit.text.includes(name));
        return [
            `<coverage-unit id="${unit.id}" digest="${unit.digest}">`,
            ...(targets.length
                ? targets.map((name) => `<profile-target actor="new" name="${name}"></profile-target>`)
                : ['<no-new/>']),
            '</coverage-unit>',
        ].join('\n');
    }).join('\n');
    const first = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        semanticRetry: false,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: source,
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ groupKey }) => {
            if (groupKey === 'identity_bootstrap') {
                identityCalls += 1;
                return identityOutput();
            }
            const error = new Error('foreground_preempted');
            error.failureKind = 'foreground_preempted';
            error.profileBatchFailureCategory = 'foreground_preempted';
            throw error;
        },
    });
    assert.equal(first.result.persistenceStatus, 'not_completed');
    assert.equal(first.saveCount, 0);
    assert.equal(first.result.recoveryProgress.identityLocked, true);
    assert.equal(first.result.recoveryProgress.rows.length, 3);
    assert.ok(first.result.recoveryProgress.rows.every((row) => (
        row.coverageUnitId === coverage.units[1].id
        && row.sourceUnitOffset === expectedUnitOffset
        && row.sourceAnchor === coverage.units[1].text
        && row.sourceAnchor.startsWith('\n  ')
    )));
    assert.deepEqual(
        first.result.recoveryProgress.rows.map((row) => row.sourceOrdinal).sort((a, b) => a - b),
        [0, 1, 2],
    );

    const moduleText = (key, name) => `${name} ${key}. ${'Complete natural dossier prose records stable facts constraints choices and usable action context. '.repeat(6)}`;
    const resumed = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        semanticRetry: false,
        allowDiscovery: true,
        recoveryProgress: structuredClone(first.result.recoveryProgress),
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: source,
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            assert.notEqual(groupKey, 'identity_bootstrap');
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(identityCalls, 1);
    assert.equal(resumed.result.persistenceStatus, 'atomic_readback', JSON.stringify(resumed.result.failures));
    assert.equal(resumed.saveCount, 2);
    assert.equal(resumed.readbackCount, 2);
    assert.equal(resumed.result.accepted.length, 3);
    const refreshed = normalizeActorLedger(structuredClone(resumed.result.ledger), {
        chatId: fixture.ledger.chatId,
    });
    assert.ok(refreshed.actors.every(actorProfileReadyForAction));
});

test('short discovery occurring only inside a longer key fails closed with no partial profile write', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-nested-only-discovery-ambiguous' });
    const longName = '\u963f\u9752\u9e3e';
    const shortName = '\u963f\u9752';
    const acceptedNarrative = `${longName}独自进入大厅并清楚报上姓名。`;
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    let identityCalls = 0;
    let fillCalls = 0;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        resolveDiscoveries: resolveLiteralDiscoveries(fixture, acceptedNarrative),
        requestBatch: ({ groupKey }) => {
            if (groupKey === 'identity_bootstrap') {
                identityCalls += 1;
                return coverage.units.map((unit) => [
                    `<coverage-unit id="${unit.id}" digest="${unit.digest}">`,
                    `<profile-target actor="new" name="${longName}"></profile-target>`,
                    `<profile-target actor="new" name="${shortName}"></profile-target>`,
                    '</coverage-unit>',
                ].join('\n')).join('\n');
            }
            fillCalls += 1;
            return '';
        },
    });
    assert.equal(identityCalls, 1);
    assert.equal(fillCalls, 0);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.equal(run.result.ledger.actors.length, 0);
    assert.ok(run.result.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_source_offset_ambiguous'
    )), JSON.stringify(run.result.failures));
});

test('more than six discoveries map DISC completions to final ActorRefs across transport chunks', async () => {
    const fixture = prepareRegisteredBatch(0);
    const names = Array.from({ length: 8 }, (_, index) => `\u884c\u952e${index + 1}`);
    const acceptedNarrative = names.map((name, index) => (
        `${name}\u5728\u573a\u666f\u4e2d\u7b2c${index + 1}\u6b21\u660e\u786e\u51fa\u573a\u5e76\u5b8c\u6210\u4e86\u53ef\u89c2\u5bdf\u7684\u4ea4\u8c08\u3002`
    )).join('');
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const batch = ticketBatch(fixture.ref, names.length);
    batch.tickets.forEach((ticket, index) => {
        ticket.rawEnvelopeMarker = `RAW_DISC_TICKET_${index + 1}`;
    });
    const ticketIds = batch.tickets.map((ticket) => ticket.ticketId);
    const ticketAxisValues = batch.tickets.map((ticket) => ticket.axes.temperament.result);
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
        requestBatch: ({ candidates, groupKey, moduleKeys, messages }) => {
            if (groupKey === 'identity_bootstrap') {
                return [...names].reverse().map((name) => [
                    `<profile-target actor="new" name="${name}">`,
                    `<module key="person">${moduleText('person', name)}</module>`,
                    '</profile-target>',
                ].join('\n')).join('\n');
            }
            seenLaterGroups.push({
                groupKey,
                prompt: messages.map((message) => message.content).join('\n'),
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
    const rowsByGroup = new Map();
    for (const group of seenLaterGroups) {
        if (!rowsByGroup.has(group.groupKey)) rowsByGroup.set(group.groupKey, []);
        rowsByGroup.get(group.groupKey).push(...group.rows);
    }
    for (const rows of rowsByGroup.values()) {
        assert.deepEqual(rows, names.map((name, index) => ({
            name, ticketId: ticketIds[index],
        })));
    }
    const corePrompt = seenLaterGroups
        .filter((group) => group.groupKey === 'character_core')
        .map((group) => group.prompt).join('\n');
    for (let index = 0; index < ticketIds.length; index += 1) {
        assert.equal(corePrompt.split(ticketIds[index]).length - 1, 1);
        assert.match(corePrompt, new RegExp(ticketAxisValues[index].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }
    assert.doesNotMatch(corePrompt, /RAW_DISC_TICKET_/u);
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify({
        failures: run.result.failures,
        rejected: run.result.rejected,
        candidates: run.result.candidates?.map((entry) => entry.actorRef),
    }));
    assert.deepEqual(run.result.ledger.actors.map((actor) => ({
        name: actor.name,
        ticketId: actor.profileV6?.designRolls?.ticketId,
    })), names.map((name, index) => ({ name, ticketId: ticketIds[index] })));
});

test('one omitted final promotion mapping among seven DISC rows is explicit and keeps S0', async () => {
    const fixture = prepareRegisteredBatch(0, { chatId: 'chat-seven-disc-mapping-missing' });
    const names = Array.from({ length: 7 }, (_, index) => `\u6620\u5c04\u884c${index + 1}`);
    const acceptedNarrative = names.map((name) => `${name}\u660e\u786e\u51fa\u573a\u5e76\u88ab\u5355\u72ec\u8bc6\u522b\u3002`).join('');
    const source = narrativeDiscoverySourceRef(fixture.ref);
    const batch = ticketBatch(fixture.ref, names.length);
    const before = normalizeActorLedger(fixture.ledger);
    const moduleText = (key, name) => `${name}${key}. ${'Complete stable dossier prose includes facts constraints choices and future action context. '.repeat(7)}`;
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative, completionMode: 'full', sourceRef: source,
            characterCreationTickets: structuredClone(batch.tickets),
        },
        preflightDiscoveries: registryPreflight(fixture, acceptedNarrative),
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            if (groupKey === 'identity_bootstrap') return names.map((name) => (
                `<profile-target actor="new" name="${name}"></profile-target>`
            )).join('\n');
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
        resolveDiscoveries: async ({ discoveries }) => {
            const discovered = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
                acceptedContent: acceptedNarrative, sourceRef: source,
                turn: fixture.ref.generation, modelProfileDiscoveries: structuredClone(discoveries),
            });
            const upsert = runActorRegistryUpsert(discovered.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId, identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest, allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref, turn: fixture.ref.generation,
            });
            const registration = promoteActorCandidatesToRegistry(upsert.ledger, discovered.candidates, {
                chatId: fixture.ledger.chatId, identityScopeId: fixture.ref.identityScopeId,
                scopeDigest: fixture.ref.scopeDigest, allowScopeDigestFill: true,
                expectedSourceRef: fixture.ref, turn: fixture.ref.generation,
            });
            const binding = bindCharacterCreationTicketsToRegisteredActors(registration.ledger, {
                registration, candidates: discovered.candidates, batch, target: fixture.ref,
            });
            const prepared = prepareActorLedgerProfilesV6(binding.ledger, {
                mode: 'full', turn: fixture.ref.generation,
            }).ledger;
            const promotedIds = registration.promoted.map((entry) => entry.actorRef.actorId);
            const candidates = selectActorProfileCompletionCandidates(prepared, {
                initialActorIds: promotedIds, maintenanceMaxActors: 0, turn: fixture.ref.generation,
            });
            const discoveryByName = new Map(discoveries.map((entry) => [entry.candidateRef.name, entry]));
            return {
                ok: true, ledger: binding.ledger, candidates,
                entries: registration.promoted.slice(0, -1).map((promotion) => ({
                    candidateId: promotion.candidateId,
                    actorRef: {
                        actorId: promotion.actorRef.actorId,
                        name: promotion.actorRef.displayName,
                    },
                    candidate: discoveryByName.get(promotion.actorRef.displayName).candidate,
                    repairs: [],
                })),
                failures: [], rejected: [], snapshot: { fieldRevision: 0 },
                registry: registration,
            };
        },
    });
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.saveCount, 0);
    assert.equal(run.readbackCount, 0);
    assert.deepEqual(run.result.ledger, before);
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_profile.discovery_promotion_mapping_missing'
    )));
    assert.equal(run.result.failures.some((failure) => (
        failure.reason === 'actor_profile.group_row_missing'
    )), false);
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
        ['character_core', 0],
        ['character_core', 1],
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
    assert.equal(run.result.modelCalls, 1 + Math.ceil(names.length / 6));
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
    assert.equal(run.result.modelCalls, 2);
    const replay = discoverActorsFromTurnSources(emptyActorLedger(fixture.ledger.chatId), {
        acceptedContent: acceptedNarrative,
        sourceRef: discoverySourceRef,
        turn: fixture.ref.generation,
        modelProfileDiscoveries: capturedDiscoveries,
    });
    assert.equal(replay.candidates.length, 1, 'the resolver revalidates ordinary local rows against the current narrative');
});

test('a rowless identity response fails closed after one call with no save', async () => {
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
    assert.deepEqual(calls, [{ attempt: 0, count: 0 }]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.equal(run.result.batchFormatReplacementAttempted, false);
    assert.equal(run.saveCount, 0);
});

test('a complete unit-level no-new response is sufficient for strict no-candidates', async () => {
    const fixture = prepareRegisteredBatch(0);
    let calls = 0;
    const run = await runBatch(fixture, {
        allowDiscovery: true,
        discoveryContext: {
            acceptedNarrative: '\u53ea\u6709\u7a7a\u8d70\u5eca\u4e0e\u98ce\u58f0\u3002',
            completionMode: 'full',
        },
        requestBatch: () => {
            calls += 1;
            return '[]';
        },
    });
    assert.equal(calls, 1);
    assert.equal(run.result.persistenceStatus, 'no_candidates');
    assert.ok(run.result.coverageProof);
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
    assert.deepEqual(calls, [
        { attempt: 0, count: 0 },
        { attempt: 0, count: 1 },
    ]);
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

test('one incomplete actor retries only its missing module while valid peers stay in the local clone', async () => {
    const fixture = prepareRegisteredBatch(3);
    const calls = [];
    const moduleText = (key) => `${key}：${'这是完整自然中文模块内容，包含稳定事实、现实限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt, actorIds: candidates.map((candidate) => candidate.actorRef.actorId) });
            return candidates.map((candidate, index) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.filter((key) => !(groupKey === 'character_core' && attempt === 0 && index === 1 && key === 'person'))
                    .map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    const coreCalls = calls.filter((entry) => entry.groupKey === 'character_core');
    assert.deepEqual(coreCalls.map((entry) => entry.attempt), [0, 1]);
    assert.deepEqual(coreCalls[1].actorIds, [fixture.candidates[1].actorRef.actorId]);
    assert.deepEqual(
        run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1).map((entry) => entry.groupKey),
        ['character_core'],
    );
    assert.equal(run.result.accepted.length, 3);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
});

test('six actors keep validated profile modules in the transaction-local clone and retry only missing modules', async () => {
    const fixture = prepareRegisteredBatch(6, { chatId: 'chat-six-local-module-merge' });
    const calls = [];
    const moduleText = (key, actorId) => `${actorId} ${key}: ${'complete natural-language profile evidence with stable facts, limits, and usable action context. '.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({
                groupKey,
                attempt,
                moduleKeys: [...moduleKeys],
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
            });
            const emittedKeys = groupKey === 'character_core' && attempt === 0
                ? moduleKeys.filter((key) => key !== 'currentState')
                : moduleKeys;
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...emittedKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.actorId)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    const core = calls.filter((entry) => entry.groupKey === 'character_core');
    assert.deepEqual(core.map((entry) => ({ attempt: entry.attempt, moduleKeys: entry.moduleKeys })), [
        { attempt: 0, moduleKeys: ['person', 'personality', 'history', 'relationshipsMotives', 'currentState', 'knowledgeCapabilitiesResources'] },
        { attempt: 1, moduleKeys: ['currentState'] },
    ]);
    assert.deepEqual(core[1].actorIds, fixture.candidates.map((candidate) => candidate.actorRef.actorId));
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.accepted.length, 6);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
});

test('multi-chunk group merges local rows before full validation and retries only one omitted row', async () => {
    const fixture = prepareRegisteredBatch(8, { chatId: 'chat-multi-chunk-row-merge' });
    const calls = [];
    const moduleText = (key, name) => `${name} ${key}. ${'Complete stable dossier prose includes facts constraints choices and usable action context. '.repeat(7)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        semanticRetry: true,
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt, transportChunk }) => {
            calls.push({
                groupKey, attempt, chunk: transportChunk.index,
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
                moduleKeys: [...moduleKeys],
            });
            const emitted = groupKey === 'character_core'
                && attempt === 0 && transportChunk.index === 1
                ? candidates.slice(0, -1)
                : candidates;
            return emitted.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(calls.slice(0, 2).map((call) => call.actorIds.length), [6, 2]);
    assert.equal(calls[2].attempt, 1);
    assert.equal(calls[2].actorIds.length, 1);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.accepted.length, 8);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
    const semanticFailure = run.result.batchMeta.moduleGroups.find((entry) => (
        entry.groupKey === 'character_core'
        && entry.attempt === 0
        && entry.status === 'semantic_failed'
        && entry.transportChunk == null
    ));
    assert.ok(semanticFailure);
    assert.ok(semanticFailure.parsedRowCount >= 7);
    assert.ok(semanticFailure.failureCodes.includes('actor_profile.module_missing'));
    assert.ok(semanticFailure.missingModules.includes('person'));
});

test('full_adult identity, core and physiology share one atomic working transaction', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-full-adult-atomic-groups' });
    fixture.candidates[0].completionMode = 'full_adult';
    const acceptedNarrative = '走廊中只有已登记人物继续完成日常工作。';
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    const calls = [];
    const moduleText = (key) => `${key}: ${'complete natural Chinese dossier content with stable facts, limits, and actionable context. '.repeat(6)}`;
    const physiologyClauses = [
        'general baseline remains stable and is described in a complete natural sentence',
        'reproductive anatomy follows the confirmed species and physiological sex without guessing measurements',
        'secondary traits are stated objectively as a durable baseline instead of a transient condition',
        'reproductive function and cycles distinguish applicable facts from explicitly inapplicable structures',
        'sexual response describes only bodily physiology and never invents preference consent or experience',
        'limitations separate durable physiology from injury clothing machinery and current clinical urgency',
    ];
    const coverageKeys = [
        'generalBaseline', 'reproductiveAnatomy', 'secondaryTraits',
        'reproductiveFunction', 'sexualResponse', 'limitations',
    ];
    const physiologyFields = coverageKeys.map((key, index) => (
        `<field key="${key}">${physiologyClauses[index]}</field>`
    )).join('');
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full_adult' },
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt, moduleKeys: [...moduleKeys] });
            if (groupKey === 'identity_bootstrap') return coverage.units.map((unit) => (
                `<coverage-unit id="${unit.id}" digest="${unit.digest}"><no-new/></coverage-unit>`
            )).join('\n');
            return candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${key === 'physiology' ? physiologyFields : moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(calls.map(({ groupKey, attempt }) => [groupKey, attempt]), [
        ['identity_bootstrap', 0],
        ['character_core', 0],
    ]);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.accepted.length, 1);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
});

test('two-person recovery maps the missing adult row by its unique alias without dropping the whole row', async () => {
    const fixture = prepareRegisteredBatch(2, { chatId: 'chat-two-adult-alias-recovery' });
    fixture.candidates.forEach((candidate) => {
        candidate.completionMode = 'full_adult';
    });
    const [ready, missing] = fixture.candidates;
    missing.identity = {
        ...(missing.identity || {}),
        aliases: ['第二人物已知别名'],
    };
    const moduleKeys = [
        'person', 'personality', 'history', 'relationshipsMotives',
        'currentState', 'knowledgeCapabilitiesResources', 'physiology',
    ];
    const moduleText = (key, label = ready.actorRef.name) => (
        `${label} ${key}. ${'Complete natural dossier prose records stable facts, limits, choices, and usable future action context. '.repeat(6)}`
    );
    const physiologyKeys = [
        'generalBaseline', 'reproductiveAnatomy', 'secondaryTraits',
        'reproductiveFunction', 'sexualResponse', 'limitations',
    ];
    const physiologyFields = physiologyKeys.map((key) => (
        `<field key="${key}">${key} records a durable objective physiological fact with its species limits and no invented consent preference history or action.</field>`
    )).join('');
    const recoveryProgress = normalizeActorProfileRecoveryProgress({
        version: 1,
        identityAttempted: true,
        identityLocked: true,
        rows: [
            {
                actorId: ready.actorRef.actorId,
                name: ready.actorRef.name,
                modules: Object.fromEntries(moduleKeys.map((key) => [
                    key,
                    moduleText(key),
                ])),
            },
            {
                actorId: missing.actorRef.actorId,
                name: missing.actorRef.name,
                modules: {},
            },
        ],
    });
    const calls = [];
    const run = await runBatch(fixture, {
        moduleProtocol: 'raw',
        recoveryProgress,
        requestBatch: ({ candidates, groupKey, moduleKeys: requested, attempt }) => {
            calls.push({
                groupKey,
                attempt,
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
                moduleKeys: [...requested],
            });
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.actorId), [missing.actorRef.actorId]);
            return [
                '<profile-target actor="第二人物已知别名" name="第二人物已知别名">',
                ...requested.map((key) => (
                    `<module key="${key}">${key === 'physiology' ? physiologyFields : moduleText(key, '第二人物已知别名')}</module>`
                )),
                '</profile-target>',
            ].join('\n');
        },
    });
    assert.deepEqual(calls.map(({ groupKey, attempt }) => [groupKey, attempt]), [
        ['character_core', 0],
    ]);
    assert.deepEqual(calls[0].moduleKeys, moduleKeys);
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify(run.result.failures));
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.saveCount, 2);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    const repaired = run.result.batchMeta.moduleGroups.find((entry) => (
        entry.groupKey === 'character_core' && entry.attempt === 0
    ));
    assert.equal(repaired.routeRepairCount, 1);
    assert.deepEqual(repaired.routeRepairCodes, [
        'actor_profile.route_single_target_label_normalized',
    ]);
});

test('discovery recovery keeps completed adult physiology versioned and requests only the empty second row', async () => {
    const fixture = prepareRegisteredBatch(2, { chatId: 'chat-discovery-adult-recovery' });
    fixture.candidates.forEach((candidate) => {
        candidate.completionMode = 'full_adult';
    });
    const names = ['发现人物一', '发现人物二'];
    const anchors = ['发现人物一站在门边。', '发现人物二守在窗边。'];
    const acceptedNarrative = `${anchors[0]}${anchors[1]}`;
    const actorIds = ['DISC-recovery-one', 'DISC-recovery-two'];
    const recoveryTickets = ticketBatch(fixture.ref, 2).tickets;
    const moduleKeys = [
        'person', 'personality', 'history', 'relationshipsMotives',
        'currentState', 'knowledgeCapabilitiesResources', 'physiology',
    ];
    const moduleText = (key, label) => (
        `${label} ${key}. ${'Complete natural dossier prose records stable facts, limitations, choices, and future action context. '.repeat(6)}`
    );
    const physiologyKeys = [
        'generalBaseline', 'reproductiveAnatomy', 'secondaryTraits',
        'reproductiveFunction', 'sexualResponse', 'limitations',
    ];
    const physiology = physiologyKeys.map((key) => (
        `<field key="${key}">${key} records one complete durable physiological fact with species limits and no invented action or consent.</field>`
    )).join('');
    const recoveryProgress = normalizeActorProfileRecoveryProgress({
        version: 1,
        identityAttempted: true,
        identityLocked: true,
        rows: [
            {
                actorId: actorIds[0],
                name: names[0],
                discovery: true,
                sourceAnchor: anchors[0],
                modules: Object.fromEntries(moduleKeys.map((key) => [
                    key,
                    moduleText(key, names[0]),
                ])),
            },
            {
                actorId: actorIds[1],
                name: names[1],
                discovery: true,
                sourceAnchor: anchors[1],
                modules: {},
            },
        ],
    });
    const calls = [];
    const run = await runBatch({ ...fixture, candidates: [] }, {
        moduleProtocol: 'raw',
        allowDiscovery: true,
        recoveryProgress,
        discoveryContext: {
            acceptedNarrative,
            completionMode: 'full_adult',
            sourceRef: narrativeDiscoverySourceRef(fixture.ref),
            characterCreationTickets: structuredClone(recoveryTickets),
        },
        requestBatch: ({ candidates, groupKey, moduleKeys: requested, attempt, messages }) => {
            calls.push({
                groupKey,
                attempt,
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
                moduleKeys: [...requested],
            });
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.actorId), [actorIds[1]]);
            assert.deepEqual(candidates[0].characterCreationTicket, recoveryTickets[1]);
            const prompt = messages.map((message) => message.content).join('\n');
            assert.ok(prompt.includes(recoveryTickets[1].ticketId));
            assert.equal(prompt.includes(recoveryTickets[0].ticketId), false);
            return [
                `<profile-target actor="${actorIds[1]}" name="${names[1]}">`,
                ...requested.map((key) => (
                    `<module key="${key}">${key === 'physiology' ? physiology : moduleText(key, names[1])}</module>`
                )),
                '</profile-target>',
            ].join('\n');
        },
        resolveDiscoveries: async ({ discoveries }) => ({
            ok: true,
            ledger: structuredClone(fixture.ledger),
            candidates: structuredClone(fixture.candidates),
            entries: discoveries.map((discovery, index) => ({
                candidateId: `RECOVERY-${index + 1}`,
                actorRef: {
                    actorId: fixture.candidates[index].actorRef.actorId,
                    name: fixture.candidates[index].actorRef.name,
                },
                candidate: structuredClone(discovery.candidate),
                repairs: [],
            })),
            rejected: [],
            failures: [],
            registry: fixture.registration,
            snapshot: { fieldRevision: 0 },
        }),
    });
    assert.deepEqual(calls, [{
        groupKey: 'character_core',
        attempt: 0,
        actorIds: [actorIds[1]],
        moduleKeys,
    }]);
    assert.equal(calls.length, 1, 'refresh recovery must add neither a retry nor a third call');
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify(run.result.failures));
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.saveCount, 2);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    const diagnosticJson = JSON.stringify(run.result.batchMeta);
    assert.equal(diagnosticJson.includes(recoveryTickets[0].ticketId), false);
    assert.equal(diagnosticJson.includes(recoveryTickets[1].ticketId), false);
});

test('two full-adult rows use only the existing one missing-row retry and commit both atomically', async () => {
    const fixture = prepareRegisteredBatch(2, { chatId: 'chat-two-adult-one-retry' });
    fixture.candidates.forEach((candidate) => {
        candidate.completionMode = 'full_adult';
    });
    const [first, second] = fixture.candidates;
    second.identity = {
        ...(second.identity || {}),
        aliases: ['第二人物补缺别名'],
    };
    const physiologyKeys = [
        'generalBaseline', 'reproductiveAnatomy', 'secondaryTraits',
        'reproductiveFunction', 'sexualResponse', 'limitations',
    ];
    const physiology = physiologyKeys.map((key) => (
        `<field key="${key}">${key} records one complete durable physiological fact, species boundary, and objective limitation without invented action.</field>`
    )).join('');
    const moduleText = (key, label) => (
        `${label} ${key}. ${'Complete natural dossier prose records stable facts, limitations, choices, and future action context. '.repeat(6)}`
    );
    const row = (candidate, moduleKeys, route = candidate.actorRef.actorId, name = candidate.actorRef.name) => [
        `<profile-target actor="${route}" name="${name}">`,
        ...moduleKeys.map((key) => (
            `<module key="${key}">${key === 'physiology' ? physiology : moduleText(key, name)}</module>`
        )),
        '</profile-target>',
    ].join('\n');
    const calls = [];
    const run = await runBatch(fixture, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({
                groupKey,
                attempt,
                actorIds: candidates.map((candidate) => candidate.actorRef.actorId),
                moduleKeys: [...moduleKeys],
            });
            if (attempt === 0) return row(first, moduleKeys);
            assert.deepEqual(candidates.map((candidate) => candidate.actorRef.actorId), [second.actorRef.actorId]);
            return row(second, moduleKeys, '第二人物补缺别名', '第二人物补缺别名');
        },
    });
    assert.deepEqual(calls.map(({ groupKey, attempt }) => [groupKey, attempt]), [
        ['character_core', 0],
        ['character_core', 1],
    ]);
    assert.equal(calls.length, 2, 'no third model call may be added');
    assert.deepEqual(calls[1].moduleKeys, calls[0].moduleKeys);
    assert.equal(run.result.persistenceStatus, 'atomic_readback', JSON.stringify(run.result.failures));
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.saveCount, 2);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    const retryDiagnostic = run.result.batchMeta.moduleGroups.find((entry) => (
        entry.groupKey === 'character_core' && entry.attempt === 1
    ));
    assert.equal(retryDiagnostic.routeRepairCount, 1);
});

test('real P1 pending and final writers rebase once over a P3 ATT win without losing either side', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-p1-p3-reverse-race' });
    const moduleText = (key) => `${key}. ${'Complete natural profile prose records stable facts, limits, choices, and usable future context. '.repeat(6)}`;
    const preparedRun = await runBatch(fixture, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    assert.equal(preparedRun.persistencePayloads.length, 2);
    const pendingPayload = preparedRun.persistencePayloads[0];
    const finalPayload = preparedRun.persistencePayloads[1];
    const captured = { ...fixture.ref, epoch: 1, fingerprint: fixture.ref.contentFingerprint };
    const attempt = {
        id: 'ATT-reverse-race',
        actorId: fixture.candidates[0].actorRef.actorId,
        status: 'attempted',
        action: 'bounded synthetic world attempt',
    };
    const receipt = {
        receiptId: 'AR-reverse-race',
        attemptId: attempt.id,
        actorId: attempt.actorId,
        stage: 'attempted',
        status: 'pending_world',
    };
    const p3Ledger = normalizeActorLedger({
        ...structuredClone(fixture.ledger),
        actionAttempts: [attempt],
        actionReceipts: [receipt],
    }, { chatId: fixture.ref.chatId, scopeDigest: fixture.ref.scopeDigest });
    let liveNamespace = {
        actorLedger: p3Ledger,
        actorProfileRetryReceipt: { status: 'not_completed', marker: 'must-survive' },
        fieldRevisions: { actorLedger: 1 },
    };
    let writes = 0;
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const helperSource = indexSource.slice(
        indexSource.indexOf('function actorProfileWorldOnlyLedgerDrift'),
        indexSource.indexOf('async function completeActorProfilesForTurn'),
    );
    const targetKeySource = indexSource.slice(
        indexSource.indexOf('function stage3AcceptedTarget(captured)'),
        indexSource.indexOf('function stage3LegacyTargetNeedsManualReconciliation'),
    );
    const sandbox = {
        normalizeActorLedger,
        actorProfileRecoverySourceMatches,
        actorProfileCommitMatchesLedger,
        actorLedgerDigest,
        actorActionTargetMatches,
        deepClone: (value) => structuredClone(value),
        sourceRefOf: () => structuredClone(fixture.ref),
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        continuityPendingKeys: new Map(),
        getContext: () => ({ chatId: fixture.ref.chatId }),
        readChatNamespace: () => structuredClone(liveNamespace),
        writeChatNamespace: async (candidate, _chatId, options) => {
            writes += 1;
            if (writes === 1 || writes === 3) {
                options.failureSink.code = 'field_state_mismatch';
                options.failureSink.actualFieldStates = { actorLedger: {} };
                return false;
            }
            assert.equal(options.precondition(), true);
            assert.equal(options.contentValidator(candidate), true);
            liveNamespace = {
                ...liveNamespace,
                actorLedger: structuredClone(candidate.actorLedger),
                fieldRevisions: { actorLedger: writes },
            };
            options.successSink.namespace = structuredClone(liveNamespace);
            options.successSink.readbackNamespace = structuredClone(liveNamespace);
            return true;
        },
    };
    vm.runInNewContext(
        `${targetKeySource}\n${helperSource}\n`
        + 'this.stage3TargetKey = stage3AcceptedTargetKey;\n'
        + 'this.persistProfile = persistActorProfilePhaseWithWorldRebase;',
        sandbox,
    );
    const pending = await sandbox.persistProfile(captured, {
        ledger: pendingPayload.ledger,
        baseLedger: fixture.ledger,
        expectedCommits: pendingPayload.expectedCommits,
        expectedState: { fieldRevision: 0, digest: actorLedgerDigest(fixture.ledger) },
        phase: 'pending',
    });
    assert.equal(pending.ok, true);
    assert.equal(writes, 2);
    assert.ok(pending.ledger.actionAttempts.some((entry) => entry.id === attempt.id));
    assert.ok(pending.ledger.actionReceipts.some((entry) => entry.receiptId === receipt.receiptId));
    assert.ok(pendingPayload.expectedCommits.every((entry) => (
        actorProfileCommitMatchesLedger(pending.ledger, { ...entry, phase: 'pending' }).ok
    )));

    const final = await sandbox.persistProfile(captured, {
        ledger: finalPayload.ledger,
        baseLedger: pendingPayload.ledger,
        expectedCommits: finalPayload.expectedCommits,
        expectedState: pending.snapshot,
        phase: 'final',
    });
    assert.equal(final.ok, true);
    assert.equal(writes, 4);
    assert.ok(final.ledger.actionAttempts.some((entry) => entry.id === attempt.id));
    assert.ok(final.ledger.actionReceipts.some((entry) => entry.receiptId === receipt.receiptId));
    assert.ok(finalPayload.expectedCommits.every((entry) => (
        actorProfileCommitMatchesLedger(final.ledger, { ...entry, phase: 'final' }).ok
    )));
    assert.equal(liveNamespace.actorProfileRetryReceipt.marker, 'must-survive');
});

test('P1 reveal waits for current-target P3 ATT but preserves and ignores an older pending ATT', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-p1-reveal-p3-reverse-race' });
    const actorId = fixture.candidates[0].actorRef.actorId;
    const oldName = fixture.candidates[0].actorRef.name;
    const revealedName = 'revealed-current-source-name';
    const fullProfileText = (key) => `${key}. ${'Complete natural profile prose records stable facts, limits, choices, and usable future context. '.repeat(6)}`;
    const initialProfile = await runBatch(fixture, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${fullProfileText(key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    assert.equal(initialProfile.result.persistenceStatus, 'atomic_readback');
    const baseLedger = initialProfile.result.ledger;
    const revealedLedger = mergeActorIdentityReveal(baseLedger, {
        actorId,
        revealedName,
        aliases: [oldName],
        evidence: [`${fixture.ref.messageId}:${fixture.ref.swipeId}:${fixture.ref.generation}:${fixture.ref.hash}`],
        sourceRef: fixture.ref,
        turn: fixture.ref.generation,
    });
    const preparedRevealed = prepareActorLedgerProfilesV6(revealedLedger, {
        mode: 'full',
        turn: fixture.ref.generation,
    }).ledger;
    const revealedCandidates = selectActorProfileCompletionCandidates(preparedRevealed, {
        initialActorIds: [actorId],
        includeReadyActorIds: [actorId],
        refreshModulesByActorId: {
            [actorId]: ACTOR_PROFILE_IDENTITY_REVEAL_REFRESH_MODULES,
        },
        maintenanceMaxActors: 0,
        turn: fixture.ref.generation,
    });
    assert.equal(revealedCandidates[0].actorRef.name, revealedName);
    const moduleText = fullProfileText;
    const preparedRun = await runBatch({
        ...fixture,
        ledger: preparedRevealed,
        candidates: revealedCandidates,
    }, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    assert.equal(preparedRun.persistencePayloads.length, 2);
    const pendingPayload = preparedRun.persistencePayloads[0];
    const finalPayload = preparedRun.persistencePayloads[1];
    const worldTarget = {
        chatId: fixture.ref.chatId,
        messageId: fixture.ref.messageId,
        logicalIndex: fixture.ref.index,
        index: fixture.ref.index,
        swipeId: fixture.ref.swipeId,
        generation: fixture.ref.generation,
        generationId: fixture.ref.generationId,
        generationType: fixture.ref.generationType,
        scopeDigest: fixture.ref.scopeDigest,
        contentHash: fixture.ref.contentHash,
        hash: fixture.ref.hash,
    };
    const readyActor = baseLedger.actors.find((entry) => entry.id === actorId);
    const worldCandidate = {
        actorId,
        actorName: oldName,
        currentGoal: 'complete one bounded local check',
        intent: 'wait',
        time: { turn: fixture.ledger.turn, window: 'this bounded action window' },
        location: {
            from: readyActor.location.name,
            to: readyActor.location.name,
            travelTurns: 0,
        },
        action: `${oldName} waits for one bounded local condition.`,
        actionWindow: 'this bounded action window',
        expectedCost: 'one bounded action window',
        expectedDuration: 'one turn',
        expectedRisk: 'the condition may remain unmet',
        observableConsequence: 'the local condition remains checkable',
        knowledgeRefs: [],
        knowledgeBasis: [],
        resourceCosts: [],
        capabilityUsed: '',
        stateChanges: [],
        interactionTargets: [],
        evidence: [],
        sourceThreads: [],
        causalChain: [],
        waitCondition: 'wait until one specific local signal can be verified',
    };
    const preparedAttempt = prepareActorActionAttempts(baseLedger, [worldCandidate], {
        turn: baseLedger.turn,
        sourceRef: worldTarget,
        target: worldTarget,
    });
    assert.equal(preparedAttempt.attempts.length, 1, JSON.stringify(preparedAttempt.rejected));
    const recordedAttempt = recordActorActionAttempts(
        preparedAttempt.ledger,
        preparedAttempt.attempts,
        { target: worldTarget },
    );
    assert.equal(recordedAttempt.recorded.length, 1);
    const attempt = recordedAttempt.recorded[0];
    const receipt = recordedAttempt.ledger.actionReceipts.find((entry) => (
        entry.attemptId === attempt.id && entry.status === 'pending_world'
    ));
    const p3Ledger = recordedAttempt.ledger;
    let liveNamespace = {
        actorLedger: p3Ledger,
        continuityCheckpoint: { stage3Phase: 'prepared' },
        fieldRevisions: { actorLedger: 1 },
    };
    let writes = 0;
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const helperSource = indexSource.slice(
        indexSource.indexOf('function actorProfileWorldOnlyLedgerDrift'),
        indexSource.indexOf('async function completeActorProfilesForTurn'),
    );
    const targetKeySource = indexSource.slice(
        indexSource.indexOf('function stage3AcceptedTarget(captured)'),
        indexSource.indexOf('function stage3LegacyTargetNeedsManualReconciliation'),
    );
    const captured = { ...fixture.ref, epoch: 1, fingerprint: fixture.ref.contentFingerprint };
    const sandbox = {
        normalizeActorLedger,
        actorProfileRecoverySourceMatches,
        actorProfileCommitMatchesLedger,
        actorLedgerDigest,
        actorActionTargetMatches,
        deepClone: (value) => structuredClone(value),
        continuityChain: {
            catch: () => Promise.resolve().then(() => {
                liveNamespace = {
                    ...liveNamespace,
                    actorLedger: normalizeActorLedger({
                        ...structuredClone(liveNamespace.actorLedger),
                        actionAttempts: [{ ...attempt, status: 'success' }],
                        actionReceipts: [{ ...receipt, status: 'adjudicated' }],
                    }, { chatId: fixture.ref.chatId, scopeDigest: fixture.ref.scopeDigest }),
                    continuityCheckpoint: { stage3Phase: 'world_committed' },
                    fieldRevisions: { actorLedger: 2 },
                };
            }),
        },
        sourceRefOf: () => structuredClone(fixture.ref),
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        continuityPendingKeys: new Map(),
        getContext: () => ({ chatId: fixture.ref.chatId }),
        readChatNamespace: () => structuredClone(liveNamespace),
        writeChatNamespace: async (candidate, _chatId, options) => {
            writes += 1;
            if (writes === 1 || writes === 3) {
                options.failureSink.code = 'field_state_mismatch';
                options.failureSink.actualFieldStates = { actorLedger: {} };
                return false;
            }
            assert.equal(options.contentValidator(candidate), true);
            liveNamespace = {
                ...liveNamespace,
                actorLedger: structuredClone(candidate.actorLedger),
                fieldRevisions: { actorLedger: writes },
            };
            options.successSink.namespace = structuredClone(liveNamespace);
            options.successSink.readbackNamespace = structuredClone(liveNamespace);
            return true;
        },
    };
    vm.runInNewContext(
        `${targetKeySource}\n${helperSource}\n`
        + 'this.stage3TargetKey = stage3AcceptedTargetKey;\n'
        + 'this.persistProfile = persistActorProfilePhaseWithWorldRebase;',
        sandbox,
    );
    sandbox.continuityPendingKeys.set(sandbox.stage3TargetKey(captured), Symbol('p3-owner'));
    const pending = await sandbox.persistProfile(captured, {
        ledger: pendingPayload.ledger,
        baseLedger,
        expectedCommits: pendingPayload.expectedCommits,
        expectedState: { fieldRevision: 0, digest: actorLedgerDigest(baseLedger) },
        phase: 'pending',
    });
    assert.equal(pending.ok, true, pending.reason);
    const final = await sandbox.persistProfile(captured, {
        ledger: finalPayload.ledger,
        baseLedger: pendingPayload.ledger,
        expectedCommits: finalPayload.expectedCommits,
        expectedState: pending.snapshot,
        phase: 'final',
    });
    assert.equal(final.ok, true, final.reason);
    assert.equal(writes, 4);
    const actor = final.ledger.actors.find((entry) => entry.id === actorId);
    const registryEntry = Object.values(final.ledger.actorRegistry.registered)
        .find((entry) => entry.actorRef.actorId === actorId);
    assert.equal(actor.name, revealedName);
    assert.ok(actor.identity.aliases.includes(oldName));
    assert.equal(registryEntry.actorRef.displayName, revealedName);
    assert.ok(final.ledger.actionAttempts.some((entry) => entry.id === attempt.id));
    assert.ok(final.ledger.actionReceipts.some((entry) => entry.receiptId === receipt.receiptId));
    assert.ok(actorProfileReadyForAction(actor));
    assert.equal(liveNamespace.continuityCheckpoint.stage3Phase, 'world_committed');
    assert.equal(final.ledger.actionReceipts.some((entry) => entry.status === 'pending_world'), false);
    sandbox.continuityPendingKeys.clear();

    const oldTarget = {
        ...worldTarget,
        messageId: 'message-old-target',
        logicalIndex: Math.max(0, worldTarget.logicalIndex - 1),
        index: Math.max(0, worldTarget.index - 1),
        generation: Math.max(0, worldTarget.generation - 1),
        generationId: 'generation-old-target',
        contentHash: 'hash-old-target',
        hash: 'hash-old-target',
    };
    const oldPrepared = prepareActorActionAttempts(baseLedger, [worldCandidate], {
        turn: baseLedger.turn,
        sourceRef: oldTarget,
        target: oldTarget,
    });
    assert.equal(oldPrepared.attempts.length, 1, JSON.stringify(oldPrepared.rejected));
    const oldRecorded = recordActorActionAttempts(
        oldPrepared.ledger,
        oldPrepared.attempts,
        { target: oldTarget },
    );
    assert.equal(oldRecorded.recorded.length, 1);
    const oldAttempt = structuredClone(oldRecorded.recorded[0]);
    const oldReceipt = structuredClone(oldRecorded.ledger.actionReceipts.find((entry) => (
        entry.attemptId === oldAttempt.id && entry.status === 'pending_world'
    )));
    liveNamespace = {
        actorLedger: oldRecorded.ledger,
        continuityCheckpoint: { stage3Phase: 'world_committed' },
        fieldRevisions: { actorLedger: 1 },
    };
    writes = 0;
    let oldTargetWaits = 0;
    sandbox.continuityChain = {
        catch: () => {
            oldTargetWaits += 1;
            return Promise.resolve();
        },
    };
    const oldPending = await sandbox.persistProfile(captured, {
        ledger: pendingPayload.ledger,
        baseLedger,
        expectedCommits: pendingPayload.expectedCommits,
        expectedState: { fieldRevision: 0, digest: actorLedgerDigest(baseLedger) },
        phase: 'pending',
    });
    assert.equal(oldPending.ok, true, oldPending.reason);
    const oldFinal = await sandbox.persistProfile(captured, {
        ledger: finalPayload.ledger,
        baseLedger: pendingPayload.ledger,
        expectedCommits: finalPayload.expectedCommits,
        expectedState: oldPending.snapshot,
        phase: 'final',
    });
    assert.equal(oldFinal.ok, true, oldFinal.reason);
    assert.equal(oldTargetWaits, 0, 'an older target ATT must not join the current continuity chain');
    assert.deepEqual(
        oldFinal.ledger.actionAttempts.find((entry) => entry.id === oldAttempt.id),
        normalizeActorLedger(oldRecorded.ledger, {
            chatId: fixture.ref.chatId,
            scopeDigest: fixture.ref.scopeDigest,
        }).actionAttempts.find((entry) => entry.id === oldAttempt.id),
    );
    assert.deepEqual(
        oldFinal.ledger.actionReceipts.find((entry) => entry.receiptId === oldReceipt.receiptId),
        oldReceipt,
    );
});

test('real P1 registry writer rebases one new ActorRef over a P3 ATT win and preserves both write-sets', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-p1-registry-p3-reverse-race' });
    const moduleText = (key) => `${key}. ${'Complete natural profile prose records stable facts, limits, choices, and usable future context. '.repeat(6)}`;
    const profileRun = await runBatch(fixture, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    assert.equal(profileRun.result.persistenceStatus, 'atomic_readback');
    const baseLedger = profileRun.result.ledger;
    assert.ok(baseLedger.actors.every(actorProfileReadyForAction));

    const registryRef = sourceRef(fixture.ref.chatId, 2);
    const registered = registerNames(baseLedger, ['registry-race-new-actor'], registryRef);
    const desiredLedger = registered.registration.ledger;
    const newActorIds = registered.registration.promoted
        .filter((entry) => entry.created)
        .map((entry) => entry.actorRef.actorId);
    assert.equal(newActorIds.length, 1);

    const existingActorId = baseLedger.actors[0].id;
    const attempt = {
        id: 'ATT-registry-reverse-race',
        actorId: existingActorId,
        status: 'attempted',
        action: 'bounded synthetic world attempt before registry save',
    };
    const receipt = {
        receiptId: 'AR-registry-reverse-race',
        attemptId: attempt.id,
        actorId: existingActorId,
        stage: 'attempted',
        status: 'pending_world',
    };
    const p3Ledger = normalizeActorLedger({
        ...structuredClone(baseLedger),
        actionAttempts: [attempt],
        actionReceipts: [receipt],
    }, { chatId: registryRef.chatId, scopeDigest: registryRef.scopeDigest });
    let liveNamespace = {
        actorLedger: p3Ledger,
        fieldRevisions: { actorLedger: 1 },
    };
    let writes = 0;
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const registrySource = indexSource.slice(
        indexSource.indexOf('async function persistActorRegistryForTurn'),
        indexSource.indexOf('async function persistActorActionAttemptsForTurn'),
    );
    const rebaseSource = indexSource.slice(
        indexSource.indexOf('function actorProfileWorldOnlyLedgerDrift'),
        indexSource.indexOf('async function persistActorProfilePhaseWithWorldRebase'),
    );
    const captured = {
        ...registryRef,
        epoch: 2,
        fingerprint: registryRef.contentFingerprint,
    };
    const sandbox = {
        normalizeActorLedger,
        actorProfileRecoverySourceMatches,
        actorLedgerDigest,
        actorActionTargetMatches,
        actorRegistryDigest,
        actorRegistryMatchesLedger,
        deepClone: (value) => structuredClone(value),
        sourceRefOf: () => structuredClone(registryRef),
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        getContext: () => ({ chatId: registryRef.chatId }),
        readChatNamespace: () => structuredClone(liveNamespace),
        writeChatNamespace: async (candidate, _chatId, options) => {
            writes += 1;
            if (writes === 1) {
                options.failureSink.code = 'stale_namespace_revision';
                options.failureSink.staleFields = ['actorLedger'];
                return false;
            }
            assert.equal(options.precondition(), true);
            assert.equal(options.contentValidator(candidate), true);
            liveNamespace = {
                ...liveNamespace,
                actorLedger: structuredClone(candidate.actorLedger),
                fieldRevisions: { actorLedger: 2 },
            };
            options.successSink.namespace = structuredClone(liveNamespace);
            options.successSink.readbackNamespace = structuredClone(liveNamespace);
            return true;
        },
    };
    vm.runInNewContext(
        `${rebaseSource}\n${registrySource}\nthis.persistRegistry = persistActorRegistryForTurn;`,
        sandbox,
    );
    const result = await sandbox.persistRegistry(captured, {
        previousLedger: baseLedger,
        nextLedger: desiredLedger,
        actorIds: newActorIds,
        expectedState: { fieldRevision: 0, digest: actorLedgerDigest(baseLedger) },
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(writes, 2, 'registry CAS is replayed locally only once');
    assert.ok(result.ledger.actors.some((actor) => actor.id === newActorIds[0]));
    assert.ok(result.ledger.actionAttempts.some((entry) => entry.id === attempt.id));
    assert.ok(result.ledger.actionReceipts.some((entry) => entry.receiptId === receipt.receiptId));
    assert.equal(
        actorRegistryMatchesLedger(result.ledger, {
            chatId: registryRef.chatId,
            scopeDigest: registryRef.scopeDigest,
            actorIds: newActorIds,
            digest: actorRegistryDigest(desiredLedger.actorRegistry),
        }).ok,
        true,
    );
});

test('P1 writer rejects profile drift and bounds repeated actor CAS failure without clearing recovery receipt', async () => {
    const fixture = prepareRegisteredBatch(1, { chatId: 'chat-p1-rebase-reject' });
    const moduleText = (key) => `${key}. ${'Complete natural profile prose records stable facts, limits, choices, and usable future context. '.repeat(6)}`;
    const preparedRun = await runBatch(fixture, {
        moduleProtocol: 'raw',
        requestBatch: ({ candidates, moduleKeys }) => candidates.map((candidate) => [
            `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
            ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
            '</profile-target>',
        ].join('\n')).join('\n'),
    });
    const pendingPayload = preparedRun.persistencePayloads[0];
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const helperSource = indexSource.slice(
        indexSource.indexOf('function actorProfileWorldOnlyLedgerDrift'),
        indexSource.indexOf('async function completeActorProfilesForTurn'),
    );
    const targetKeySource = indexSource.slice(
        indexSource.indexOf('function stage3AcceptedTarget(captured)'),
        indexSource.indexOf('function stage3LegacyTargetNeedsManualReconciliation'),
    );
    const captured = { ...fixture.ref, epoch: 1, fingerprint: fixture.ref.contentFingerprint };
    const runCase = async (profileDrift) => {
        const freshLedger = structuredClone(fixture.ledger);
        if (profileDrift) freshLedger.actors[0].profileV6.updatedTurn += 1;
        const receipt = { status: 'not_completed', marker: 'preserved-recovery' };
        let liveNamespace = {
            actorLedger: freshLedger,
            actorProfileRetryReceipt: receipt,
            fieldRevisions: { actorLedger: 1 },
        };
        let writes = 0;
        const sandbox = {
            normalizeActorLedger, actorProfileRecoverySourceMatches,
            actorProfileCommitMatchesLedger, actorLedgerDigest,
            actorActionTargetMatches,
            deepClone: (value) => structuredClone(value),
            sourceRefOf: () => structuredClone(fixture.ref),
            freshFrozenScopeGuard: async () => ({ ok: true }),
            continuityTargetIsCurrent: () => ({ ok: true }),
            continuityPendingKeys: new Map(),
            getContext: () => ({ chatId: fixture.ref.chatId }),
            readChatNamespace: () => structuredClone(liveNamespace),
            writeChatNamespace: async (_candidate, _chatId, options) => {
                writes += 1;
                options.failureSink.code = 'field_state_mismatch';
                options.failureSink.actualFieldStates = { actorLedger: {} };
                return false;
            },
        };
        vm.runInNewContext(
            `${targetKeySource}\n${helperSource}\n`
            + 'this.stage3TargetKey = stage3AcceptedTargetKey;\n'
            + 'this.persistProfile = persistActorProfilePhaseWithWorldRebase;',
            sandbox,
        );
        const result = await sandbox.persistProfile(captured, {
            ledger: pendingPayload.ledger,
            baseLedger: fixture.ledger,
            expectedCommits: pendingPayload.expectedCommits,
            expectedState: { fieldRevision: 0, digest: actorLedgerDigest(fixture.ledger) },
            phase: 'pending',
        });
        assert.equal(liveNamespace.actorProfileRetryReceipt.marker, 'preserved-recovery');
        return { result, writes };
    };
    const drift = await runCase(true);
    assert.equal(drift.result.ok, false);
    assert.equal(drift.writes, 1, 'profile drift is rejected before any retry overwrite');
    assert.match(drift.result.reason, /profile_or_identity_drift/u);
    const exhausted = await runCase(false);
    assert.equal(exhausted.result.ok, false);
    assert.equal(exhausted.writes, 2, 'actor-only CAS retry is bounded to one local replay');
});

test('twenty-four full_adult rows finish every transport chunk before one atomic save', async () => {
    const fixture = prepareRegisteredBatch(24, { chatId: 'chat-full-adult-24-atomic' });
    fixture.candidates.forEach((candidate) => {
        candidate.completionMode = 'full_adult';
    });
    const acceptedNarrative = 'The accepted turn contains only already registered actors continuing ordinary work.';
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    const calls = [];
    const moduleText = (key, name) => `${name} ${key}. ${'Complete natural dossier prose records stable facts, constraints, choices, and future action context. '.repeat(6)}`;
    const physiologyClauses = [
        'The durable general baseline is described objectively and separately from transient condition',
        'Reproductive anatomy follows the established species and physiological sex without invented measurement',
        'Secondary traits are recorded as stable bodily features rather than clothing or current injury',
        'Reproductive function and cycles distinguish applicable facts from explicitly inapplicable structures',
        'Sexual response covers bodily physiology only and never invents consent preference experience or action',
        'Limitations separate durable physiology from immediate clinical urgency machinery and temporary state',
    ];
    const physiologyKeys = [
        'generalBaseline', 'reproductiveAnatomy', 'secondaryTraits',
        'reproductiveFunction', 'sexualResponse', 'limitations',
    ];
    const before = structuredClone(fixture.ledger);
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        semanticRetry: false,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full_adult' },
        requestBatch: ({ candidates, groupKey, moduleKeys, transportChunk }) => {
            calls.push({ groupKey, transportChunk, count: candidates.length });
            if (groupKey === 'identity_bootstrap') return coverage.units.map((unit) => (
                `<coverage-unit id="${unit.id}" digest="${unit.digest}"><no-new/></coverage-unit>`
            )).join('\n');
            return candidates.map((candidate) => {
                const modules = moduleKeys.map((key) => {
                    if (key !== 'physiology') {
                        return `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`;
                    }
                    const fields = physiologyKeys.map((fieldKey, index) => (
                        `<field key="${fieldKey}">${physiologyClauses[index]}</field>`
                    )).join('');
                    return `<module key="physiology">${fields}</module>`;
                });
                return [
                    `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                    ...modules,
                    '</profile-target>',
                ].join('\n');
            }).join('\n');
        },
    });
    assert.equal(calls.length, 5);
    assert.deepEqual(calls.filter((entry) => entry.groupKey !== 'identity_bootstrap')
        .map((entry) => entry.count), Array(4).fill(6));
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.result.accepted.length, 24);
    assert.equal(run.saveCount, 2);
    assert.equal(run.readbackCount, 2);
    assert.ok(run.result.ledger.actors.every(actorProfileReadyForAction));
    assert.notDeepEqual(run.result.ledger, before);
});

test('a failed middle full_adult chunk keeps all twenty-four rows at S0', async () => {
    const fixture = prepareRegisteredBatch(24, { chatId: 'chat-full-adult-24-middle-failure' });
    fixture.candidates.forEach((candidate) => {
        candidate.completionMode = 'full_adult';
    });
    const acceptedNarrative = 'The accepted turn contains only registered actors and no new identity row.';
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    const before = structuredClone(fixture.ledger);
    const coreChunks = [];
    const moduleText = (key, name) => `${name} ${key}. ${'Complete stable dossier prose with facts constraints and usable action context. '.repeat(7)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        semanticRetry: false,
        allowDiscovery: true,
        discoveryContext: { acceptedNarrative, completionMode: 'full_adult' },
        requestBatch: ({ candidates, groupKey, moduleKeys, transportChunk }) => {
            if (groupKey === 'identity_bootstrap') return coverage.units.map((unit) => (
                `<coverage-unit id="${unit.id}" digest="${unit.digest}"><no-new/></coverage-unit>`
            )).join('\n');
            if (groupKey === 'character_core') coreChunks.push(transportChunk.index);
            const emittedCandidates = groupKey === 'character_core' && transportChunk.index === 1
                ? candidates.slice(0, -1)
                : candidates;
            return emittedCandidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key, candidate.actorRef.name)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.deepEqual(coreChunks, [0, 1, 2, 3]);
    assert.equal(run.result.persistenceStatus, 'not_completed');
    assert.ok(run.result.failures.some((failure) => (
        failure.reason === 'actor_profile.module_missing'
    )));
    assert.ok(run.result.batchMeta.moduleGroups.some((entry) => (
        entry.status === 'semantic_failed'
        && entry.failureCodes.includes('actor_profile.module_missing')
        && entry.missingModules.length > 0
    )));
    assert.equal(run.saveCount, 0);
    assert.equal(run.readbackCount, 0);
    assert.deepEqual(run.result.ledger, before);
});

test('a tampered or still-missing profile retry abandons the local clone and preserves S0', async () => {
    for (const mode of ['tampered', 'missing']) {
        const fixture = prepareRegisteredBatch(6, { chatId: `chat-six-local-module-${mode}` });
        const moduleText = (key) => `${key}: ${'complete natural-language profile evidence with stable facts, limits, and usable action context. '.repeat(5)}`;
        const run = await runBatch(fixture, {
            moduleProtocol: true,
            requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
                let emittedKeys = moduleKeys;
                if (groupKey === 'character_core' && attempt === 0) emittedKeys = moduleKeys.filter((key) => key !== 'currentState');
                if (groupKey === 'character_core' && attempt === 1 && mode === 'missing') emittedKeys = [];
                return candidates.map((candidate, index) => [
                    `<profile-target actor="${candidate.actorRef.actorId}" name="${groupKey === 'character_core' && attempt === 1 && mode === 'tampered' && index === 0 ? 'tampered-row-key' : candidate.actorRef.name}">`,
                    ...emittedKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                    '</profile-target>',
                ].join('\n')).join('\n');
            },
        });
        assert.equal(run.result.persistenceStatus, 'not_completed', mode);
        assert.equal(run.result.accepted.length, 0, mode);
        assert.equal(run.saveCount, 0, mode);
        assert.deepEqual(run.result.ledger, fixture.ledger, mode);
        assert.ok(
            run.result.failures.some((failure) => failure.groupKey === 'character_core'),
            `${mode}: ${JSON.stringify(run.result.failures)}`,
        );
    }
});

test('duplicate or unknown output retries only the failed group and then commits atomically', async () => {
    const fixture = prepareRegisteredBatch(2);
    const calls = [];
    const moduleText = (key) => `${key}：${'这是完整自然中文模块内容，包含稳定事实、现实限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        requestBatch: ({ candidates, groupKey, moduleKeys, attempt }) => {
            calls.push({ groupKey, attempt, actorIds: candidates.map((candidate) => candidate.actorRef.actorId) });
            const rows = candidates.map((candidate) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n'));
            if (groupKey === 'character_core' && attempt === 0) {
                rows.push(rows[0]);
                rows.push(`<profile-target actor="NPC-UNKNOWN" name="未知额外人物"><module key="person">${moduleText('person')}</module></profile-target>`);
            }
            return rows.join('\n');
        },
    });
    const coreCalls = calls.filter((entry) => entry.groupKey === 'character_core');
    assert.deepEqual(coreCalls.map((entry) => entry.attempt), [0, 1]);
    assert.deepEqual(coreCalls[1].actorIds, fixture.candidates.map((candidate) => candidate.actorRef.actorId));
    assert.equal(run.result.accepted.length, 2);
    assert.equal(run.result.persistenceStatus, 'atomic_readback');
    assert.equal(run.saveCount, 2);
    assert.deepEqual(
        run.result.batchMeta.moduleGroups.filter((entry) => entry.attempt === 1).map((entry) => entry.groupKey),
        ['character_core'],
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
    const moduleText = (key) => `${key}：${'这是完整自然中文模块内容，包含稳定事实、现实限制与后续行动依据。'.repeat(5)}`;
    const run = await runBatch(fixture, {
        moduleProtocol: true,
        semanticRetry: false,
        requestBatch: ({ candidates, groupKey, moduleKeys }) => {
            return candidates.map((candidate, index) => [
                `<profile-target actor="${candidate.actorRef.actorId}" name="${groupKey === 'character_core' && index === 1 ? '错误姓名' : candidate.actorRef.name}">`,
                ...moduleKeys.map((key) => `<module key="${key}">${moduleText(key)}</module>`),
                '</profile-target>',
            ].join('\n')).join('\n');
        },
    });
    assert.equal(run.result.accepted.length, 0);
    assert.ok(run.result.failures.some((entry) => (
        ['actor_profile.actor_ref_mismatch', 'actor_profile.module_missing', 'actor_profile.schema_incomplete'].includes(entry.reason)
    )), JSON.stringify(run.result.failures));
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
        'actorSovereigntyScopeDigest',
        'currentActorSovereigntyScope',
        'operationEpoch',
        'actorWorldManagementWrite',
        'actorProfileChain',
        'deepClone',
        'stage3FieldState',
        'actorProfileActorLedgerCasCanRebase',
        'actorProfileRebaseOnWorldOnlyLedgerDrift',
        'actorLedgerDigest',
        `${publicMutation}\nreturn mutateActorProfileV6;`,
    );
    const mutationDependencies = (actorProfileChain = Promise.resolve()) => [
        (scope) => String(scope?.digest || ''),
        (context) => context?.scope || null,
        7,
        null,
        actorProfileChain,
        (value) => structuredClone(value),
        (namespace) => ({
            revision: Number(namespace?.fieldRevisions?.actorLedger) || 0,
            digest: JSON.stringify(namespace?.actorLedger || null),
        }),
        () => false,
        () => ({ ok: false, reason: 'unexpected_rebase' }),
        (ledger) => JSON.stringify(ledger || null),
    ];
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
        () => ({ chatId: 'chat-narrative', scope: { digest: 'scope-narrative' } }),
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
        ...mutationDependencies(),
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
        () => ({ chatId: 'chat-legacy', scope: { digest: 'scope-legacy' } }),
        (ledger) => ledger,
        () => ({ actorLedger: legacyLedger }),
        async () => ({ ok: true, namespace: { actorLedger: legacyLedger } }),
        async () => {
            legacyWrites += 1;
            return true;
        },
        () => {},
        ...mutationDependencies(),
    );
    const legacyResult = await mutateLegacy('actor-legacy', () => ({
        profile: { profileFormat: 'v6', legacy: true },
        applied: true,
    }));
    assert.equal(legacyResult.applied, true);
    assert.equal(legacyResult.saved, true);
    assert.equal(legacyWrites, 1, 'legacy V6 mutation still reaches its existing writer');

    for (const switchKind of ['chat', 'scope']) {
        let releaseTail;
        const priorTail = new Promise((resolve) => { releaseTail = resolve; });
        let current = { chatId: 'chat-a', scope: { digest: 'scope-a' } };
        const sharedLedger = {
            actorRegistry: { scopeDigest: 'scope-a' },
            actors: [{ id: 'shared-actor', profileV6: { profileFormat: 'v6' } }],
        };
        let crossTargetMigrations = 0;
        let crossTargetWrites = 0;
        const mutateQueued = buildMutation(
            () => current,
            (ledger) => ledger,
            () => ({ actorLedger: sharedLedger }),
            async () => {
                crossTargetMigrations += 1;
                return { ok: true, namespace: { actorLedger: sharedLedger } };
            },
            async () => {
                crossTargetWrites += 1;
                return true;
            },
            () => assert.fail('stale queued mutation must never render'),
            ...mutationDependencies(priorTail),
        );
        const queued = mutateQueued('shared-actor', () => ({
            profile: { profileFormat: 'v6', changed: true },
            applied: true,
        }));
        current = switchKind === 'chat'
            ? { chatId: 'chat-b', scope: { digest: 'scope-b' } }
            : { chatId: 'chat-a', scope: { digest: 'scope-b' } };
        releaseTail();
        const stale = await queued;
        assert.equal(stale.applied, false);
        assert.equal(stale.saved, false);
        assert.equal(stale.reason, 'chat_context_changed');
        assert.equal(crossTargetMigrations, 0, `${switchKind} drift must stop before migration`);
        assert.equal(crossTargetWrites, 0, `${switchKind} drift must write neither chat`);
    }
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
    assert.doesNotMatch(profileFunction, /minimumOutputTokens|requestedTokens|PROMPT_CHAR_LIMIT/u);
    assert.match(profileFunction, /requestKind: 'actor_profile_batch'/u);
    assert.match(profileFunction, /maxFailovers: 1/u);
    assert.match(profileFunction, /noTimeout: true/u);
    assert.match(profileFunction, /transportActorLimit: 1/u);
    assert.match(profileFunction, /transportConcurrency: actorProfileTransportPlan\.concurrency/u);
    assert.match(profileFunction, /transportRouteSlots: actorProfileTransportPlan\.slotIndices/u);
    assert.match(profileFunction, /routeSlotIndex,[\s\S]*?attemptedRouteKeys: occupiedRouteSlotIndices\.map/u);
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

test('enabling adult physiology schedules bounded maintenance instead of leaving existing dossiers unchanged', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const settings = source.slice(
        source.indexOf("const profileCompletionMode = wrapper.querySelector('.mvuad-profile-completion-mode')"),
        source.indexOf("const profileSemanticRetries = wrapper.querySelector('.mvuad-profile-semantic-retries')"),
    );
    assert.match(settings, /nextMode === 'full_adult'/u);
    assert.match(settings, /enqueueActorProfiles\(null, \{[\s\S]*?force: true,[\s\S]*?includeMaintenance: true/u);
    const queue = source.slice(
        source.indexOf('async function enqueueActorProfiles'),
        source.indexOf('async function confirmDangerousAction'),
    );
    assert.match(
        queue,
        /const effectiveMaintenance = includeMaintenance == null[\s\S]*?actorProfileCompletionMode === 'full_adult'[\s\S]*?includeMaintenance: effectiveMaintenance/u,
    );
});
