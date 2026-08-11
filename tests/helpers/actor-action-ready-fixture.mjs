import {
    ACTOR_PROFILE_V6_VERSION,
    actorProfileBaselineDigest,
    materializeActorProfileBaseline,
    prepareActorProfileV6,
} from '../../actor-profile-v6-core.mjs';

function completeProfileCandidate(actor) {
    const name = String(actor?.name || actor?.id || '测试人物');
    return {
        actorRef: { actorId: actor.id, name },
        identity: {
            role: actor?.identity?.role || '承担具体职责的测试人物',
            species: '人类',
            gender: '未在本测试中限定',
            age: '成年，精确年龄未在本测试中限定',
            briefIntro: `${name}会依据已知事实、资源与风险选择下一步。`,
            appearance: `${name}具有可稳定辨认的发型、五官、肤色、身高与体态。`,
            identityText: `${name}在当前世界中拥有稳定身份和可核验职责。`,
            relationState: '只保留已有关系证据，不凭一次互动升级关系。',
            attitudeToProtagonist: '尊重玩家决定，并把邀请与玩家实际选择严格分开。',
            pastExperience: '曾依靠逐项核对事实、资源和退路完成自己的职责。',
        },
        personality: {
            biography: `我叫${name}。我会先看清手里的事实，再承担自己能承担的结果。`,
            primaryColor: '务实而有行动力',
            primaryDerivatives: [
                '会把目标拆成可以核验的小步骤，并在行动后检查真实后果。',
                '遇到阻力时先比较资源、时间和风险，不把尝试说成成功。',
            ],
            primarySentence: '先做能核验的那一步。',
            baseColor: '保留个人判断',
            baseDerivatives: [
                '不会因为外部刺激就放弃自己的长期目标。',
                '证据不足时会承认未知，并寻找更小的验证路径。',
            ],
            baseSentence: '不知道的部分，查清以后再说。',
            accentColor: '克制的关照',
            accentDerivatives: [
                '会为同伴留出退路，但不会替对方接受邀请。',
                '愿意承担自己的成本，同时要求关系结论有明确证据。',
            ],
            accentSentence: '我把条件说清，决定仍由你来做。',
            othersVoices: [
                `${name}做事前会先确认事实。`,
                `${name}不会把计划冒充结果。`,
                `${name}遇到失败会调整办法。`,
                `${name}会尊重别人的决定边界。`,
            ],
            authorVoice: `${name}的差异通过目标、选择、代价与后果体现，而不是靠固定标签。`,
        },
        relationships: {
            entries: Array.isArray(actor?.relationships) ? actor.relationships : [],
            patterns: ['关系变化必须有可观察互动与世界回执支持。'],
            coverageState: actor?.relationships?.length
                ? 'confirmed_entries'
                : 'no_confirmed_relationships',
        },
        goals: {
            longTerm: actor?.longTermGoals?.length
                ? actor.longTermGoals
                : ['维持自己的职责、资源与长期行动能力。'],
            pursuitPrinciples: ['先确认障碍与成本，再选择可回退的行动。'],
            strategy: {
                summary: '以目标、障碍、选择、代价和可观察后果组织行动。',
                steps: ['核对事实', '提出有界尝试', '依据世界回执调整'],
                reviewConditions: '地点、资源、风险或世界裁决发生变化时复核。',
            },
        },
        knowledge: {
            entries: Array.isArray(actor?.knowledge) ? actor.knowledge : [],
            unknownRemainsUnknown: true,
            coverageState: actor?.knowledge?.length
                ? 'confirmed_entries'
                : 'no_confirmed_knowledge',
        },
        resourcesCapabilities: {
            resources: Array.isArray(actor?.resources) ? actor.resources : [],
            capabilities: Array.isArray(actor?.capabilities) ? actor.capabilities : [],
            noUnconfirmedAbilityGranted: true,
            coverageState: actor?.resources?.length || actor?.capabilities?.length
                ? 'confirmed_entries'
                : 'no_confirmed_resources_or_capabilities',
        },
        sources: {
            identity: 'hypothesis',
            personality: 'designed_seed',
            relationships: 'confirmed',
            goals: 'confirmed',
            knowledge: 'confirmed',
            resourcesCapabilities: 'confirmed',
        },
    };
}

export function makeActionReadyActor(rawActor, { turn = 1 } = {}) {
    const actor = structuredClone(rawActor);
    const prepared = prepareActorProfileV6(actor, { mode: 'full', turn, now: 1 });
    const profile = materializeActorProfileBaseline(
        prepared,
        completeProfileCandidate(actor),
        { turn, completionMode: 'full' },
    );
    const digest = actorProfileBaselineDigest(profile);
    profile.baselineCommit = {
        schemaVersion: ACTOR_PROFILE_V6_VERSION,
        commitId: `PBI-TEST-${actor.id}`,
        actorRef: { actorId: actor.id, name: actor.name },
        digest,
        sourceRef: null,
        committedTurn: turn,
        readbackVerified: true,
        status: 'committed',
    };
    profile.preparedForAction = true;
    profile.backgroundPending = false;
    actor.profileV6 = profile;
    return actor;
}
