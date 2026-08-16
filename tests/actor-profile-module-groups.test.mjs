import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
    ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS,
    actorProfileCompletionGroupPlan,
    actorProfileDiscoveryCoveragePlan,
    buildActorProfileModuleGroupMessages,
    parseActorProfileModuleGroupOutput,
} from '../actor-profile-v6-core.mjs';
import {
    actorProfileModuleGroupChunks,
} from '../actor-profile-batch-core.mjs';

const actor = (id = 'NPC-1', previousProfile = null, mode = 'full') => ({
    actorRef: { actorId: id, name: `人物${id}` },
    actorId: id,
    name: `人物${id}`,
    completionMode: mode,
    previousProfile,
});

const prose = (label) => `${label}。${'这是自然完整的中文句子，交代稳定事实、限制、选择依据与可以继续发展的细节。'.repeat(4)}`;

test('module scheduler skips ready rows and enables only missing or explicit refresh targets', () => {
    const readySections = Object.fromEntries([
        'person', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, { text: prose(key) }]));
    const ready = actor('NPC-ready', { profileFormat: 'narrative-v1', narrativeSections: readySections });
    assert.deepEqual(actorProfileCompletionGroupPlan([ready], { allowDiscovery: false }), []);
    ready.refreshProfileModules = ['currentState'];
    const refresh = actorProfileCompletionGroupPlan([ready], { allowDiscovery: false });
    assert.equal(refresh.length, 1);
    assert.equal(refresh[0].key, 'character_core');
    assert.deepEqual(refresh[0].targets.currentState.map((row) => row.actorId), ['NPC-ready']);
    assert.equal(refresh[0].targets.knowledgeCapabilitiesResources.length, 0);
});

test('full and full_adult plans have bounded compatible groups instead of one call per module', () => {
    assert.deepEqual(actorProfileCompletionGroupPlan([actor()], { allowDiscovery: true }).map((group) => group.key), [
        'identity_bootstrap', 'character_core',
    ]);
    assert.deepEqual(actorProfileCompletionGroupPlan([actor('NPC-A', null, 'full_adult')], { allowDiscovery: true }).map((group) => group.key), [
        'identity_bootstrap', 'character_core',
    ]);
    const adultCore = actorProfileCompletionGroupPlan([
        actor('NPC-A', null, 'full_adult'),
    ], { allowDiscovery: false })[0];
    assert.deepEqual(adultCore.modules, [
        'person', 'personality', 'history', 'relationshipsMotives',
        'currentState', 'knowledgeCapabilitiesResources', 'physiology',
    ]);
    assert.deepEqual(adultCore.targets.physiology.map((row) => row.actorId), ['NPC-A']);
});

test('adult upgrade of a completed core dossier requests physiology only', () => {
    const coreSections = Object.fromEntries([
        'person', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, { text: prose(key) }]));
    const upgrade = actor('NPC-adult-upgrade', {
        completionMode: 'full_adult',
        profileFormat: 'narrative-v1',
        narrativeSections: coreSections,
    }, 'full_adult');
    const plan = actorProfileCompletionGroupPlan([upgrade], { allowDiscovery: false });
    assert.deepEqual(plan.map((group) => group.key), ['character_core']);
    assert.deepEqual(plan[0].targets.physiology.map((row) => row.actorId), ['NPC-adult-upgrade']);
    assert.ok(plan[0].modules.filter((key) => key !== 'physiology')
        .every((key) => plan[0].targets[key].length === 0));
});

test('old generic adult physiology is refreshed and current contract is not regenerated', () => {
    const baseSections = Object.fromEntries([
        'person', 'personality', 'history', 'currentState',
        'relationshipsMotives', 'knowledgeCapabilitiesResources',
    ].map((key) => [key, { text: prose(key) }]));
    const stale = actor('NPC-adult-stale', {
        completionMode: 'full_adult',
        profileFormat: 'narrative-v1',
        narrativeSections: {
            ...baseSections,
            physiology: { text: prose('只写了一般伤病和体型') },
        },
    }, 'full_adult');
    assert.deepEqual(
        actorProfileCompletionGroupPlan([stale], { allowDiscovery: false })
            .map((group) => group.key),
        ['character_core'],
    );
    stale.previousProfile.narrativeSections.physiology.contractVersion =
        ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION;
    assert.deepEqual(actorProfileCompletionGroupPlan([stale], { allowDiscovery: false }), []);
});

test('adult physiology prompt requires sexual physiology instead of accepting a generic body paragraph', () => {
    const group = actorProfileCompletionGroupPlan([
        actor('NPC-adult-prompt', null, 'full_adult'),
    ], { allowDiscovery: false }).find((entry) => entry.key === 'character_core');
    const prompt = buildActorProfileModuleGroupMessages(group, {
        discoveryContext: { acceptedNarrative: '该成年人站在门边等待。' },
    }).map((message) => message.content).join('\n');
    assert.match(prompt, /Identity Confirmation.*MVU自动医生.*人物档案医师/u);
    assert.match(prompt, /外生殖器/u);
    assert.match(prompt, /内生殖系统/u);
    assert.match(prompt, /第二性征/u);
    assert.match(prompt, /性刺激下的生理反应/u);
    assert.match(prompt, /不能只写体型、伤病、服装或机械改造/u);
    assert.match(prompt, /不得把性经历、性行为、偏好、同意或关系当成生理事实/u);
    assert.match(prompt, /<field key="generalBaseline">/u);
    assert.match(prompt, /<field key="limitations">/u);
    assert.doesNotMatch(prompt, /physiology-coverage/u);
});

test('adult physiology uses six explicit fragments and stores only composed natural prose', () => {
    const group = actorProfileCompletionGroupPlan([
        actor('NPC-adult-coverage', null, 'full_adult'),
    ], { allowDiscovery: false }).find((entry) => entry.key === 'character_core');
    const excerpts = Object.fromEntries(ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key, index) => [
        key,
        `覆盖项目${index + 1}具有彼此独立且可核验的自然中文说明`,
    ]));
    const complete = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key) => (
        `<field key="${key}">${excerpts[key]}</field>`
    )).join('');
    const accepted = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${complete}</module></profile-target>`,
        group,
    );
    assert.deepEqual(accepted.failures, []);
    assert.match(accepted.entries[0].modules.physiology, /^一般体征：/u);
    assert.match(accepted.entries[0].modules.physiology, /生殖解剖：/u);
    assert.match(accepted.entries[0].modules.physiology, /生理限制：/u);
    assert.equal(accepted.entries[0].modules.physiology.includes('<field'), false);
    const missing = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${complete.replace(/<field key="limitations">[\s\S]*?<\/field>/u, '')}</module></profile-target>`,
        group,
    );
    assert.ok(missing.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
        && entry.missingFields.includes('physiology.limitations')
    )));
    const reused = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key) => (
        `<field key="${key}">${excerpts.generalBaseline}</field>`
    )).join('');
    const rejectedReuse = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${reused}</module></profile-target>`,
        group,
    );
    assert.ok(rejectedReuse.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
    )));
    const labelledLines = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS
        .map((key) => `${key}：${excerpts[key]}`).join('\n');
    const repairedLabels = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${labelledLines}</module></profile-target>`,
        group,
    );
    assert.deepEqual(repairedLabels.failures, []);
    assert.match(repairedLabels.entries[0].modules.physiology, /一般体征：/u);
    const unlabeled = Object.values(excerpts).join('。');
    const unrecoverableUnlabelled = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${unlabeled}</module></profile-target>`,
        group,
    );
    assert.ok(unrecoverableUnlabelled.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
    )));
});

test('module parser normalizes an exact ActorRef with a known name alias', () => {
    const candidate = actor('NPC-alias-route');
    candidate.identity = { aliases: ['鍙湪 Registry 涓凡鐭ョ殑鍒悕'] };
    const group = actorProfileCompletionGroupPlan([candidate], { allowDiscovery: false })[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-alias-route" name="鍙湪 Registry 涓凡鐭ョ殑鍒悕"><module key="person">${prose('person')}</module></profile-target>`,
        { ...group, modules: ['person'], targets: { person: [candidate] } },
    );
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries[0].actorId, 'NPC-alias-route');
    assert.equal(parsed.entries[0].name, candidate.actorRef.name);
    assert.deepEqual(parsed.routeRepairs, ['actor_profile.route_name_alias_normalized']);
});

test('single-target parser maps a known row label in actor attribute to the exact ActorRef', () => {
    const candidate = actor('NPC-single-route');
    candidate.identity = { aliases: ['鍞竴鐩爣鐨勫凡鐭ヨ鍒悕'] };
    const group = actorProfileCompletionGroupPlan([candidate], { allowDiscovery: false })[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<profile-target actor="鍞竴鐩爣鐨勫凡鐭ヨ鍒悕"><module key="person">${prose('person')}</module></profile-target>`,
        { ...group, modules: ['person'], targets: { person: [candidate] } },
    );
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries[0].actorId, 'NPC-single-route');
    assert.equal(parsed.entries[0].name, candidate.actorRef.name);
    assert.deepEqual(parsed.routeRepairs, ['actor_profile.route_single_target_label_normalized']);
});

test('module parser never guesses between two scheduled actors sharing an alias', () => {
    const first = actor('NPC-ambiguous-a');
    const second = actor('NPC-ambiguous-b');
    first.identity = { aliases: ['鍏变韩鍒悕'] };
    second.identity = { aliases: ['鍏变韩鍒悕'] };
    const group = actorProfileCompletionGroupPlan([first, second], { allowDiscovery: false })[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<profile-target actor="鍏变韩鍒悕"><module key="person">${prose('person')}</module></profile-target>`,
        { ...group, modules: ['person'], targets: { person: [first, second] } },
    );
    assert.ok(parsed.failures.some((entry) => entry.reason === 'actor_profile.actor_ref_mismatch')
        || parsed.entries[0]?.actorId === '鍏变韩鍒悕');
    assert.deepEqual(parsed.routeRepairs, []);
});

test('group parser accepts fences, surrounding prose, unheaded Chinese values, aliases and loose attributes', () => {
    const group = actorProfileCompletionGroupPlan([actor()], { allowDiscovery: false })
        .find((entry) => entry.key === 'character_core');
    const output = `说明如下：\n\`\`\`xml\n<PROFILE-TARGET actor=NPC-1 name=人物NPC-1>\n`
        + `<module key=性格>${prose('性格正文')}</module>\n`
        + `<module key=经历>${prose('经历正文')}</module>\n`
        + `<module key=关系动机>${prose('关系动机正文')}</module>\n`
        + `</PROFILE-TARGET>\n\`\`\`\n以上是所需内容。`;
    const parsed = parseActorProfileModuleGroupOutput(output, group);
    assert.equal(parsed.formatUnrecoverable, false);
    assert.deepEqual(parsed.failures, []);
    assert.deepEqual(Object.keys(parsed.entries[0].modules).sort(), [
        'history', 'personality', 'relationshipsMotives',
    ]);
});

test('group parser rejects lone dossier prose, short shells, duplicates and unexpected modules', () => {
    const group = actorProfileCompletionGroupPlan([actor()], { allowDiscovery: false })
        .find((entry) => entry.key === 'character_core');
    assert.equal(parseActorProfileModuleGroupOutput(prose('一篇没有路由边界的长档案'), group).formatUnrecoverable, true);
    const broken = `<profile-target actor="NPC-1" name="人物NPC-1">`
        + `<module key="personality">太短</module>`
        + `<module key="personality">${prose('首次')}</module>`
        + `<module key="personality">${prose('重复')}</module>`
        + `<module key="unknownModule">${prose('越界')}</module>`
        + `</profile-target>`;
    const parsed = parseActorProfileModuleGroupOutput(broken, group);
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_content_incomplete'));
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_duplicate'));
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_unexpected'));
});

test('module prompt contains per-module notes, fresh current rows and no visible seven-heading dossier contract', () => {
    const group = actorProfileCompletionGroupPlan([actor()], { allowDiscovery: false })
        .find((entry) => entry.key === 'character_core');
    const messages = buildActorProfileModuleGroupMessages(group, {
        evidenceText: '权威材料',
        discoveryContext: { acceptedNarrative: '人物NPC-1在最终接受正文只出现一次。' },
    });
    const all = messages.map((message) => message.content).join('\n');
    assert.match(all, /currentState:/u);
    assert.match(all, /knowledgeCapabilitiesResources:/u);
    assert.match(all, /目标 ActorRef×字段/u);
    assert.match(all, /"requestedModules"/u);
    assert.match(all, /"actors"/u);
    assert.equal(all.match(/"authority"/gu)?.length, 1);
    assert.equal(all.match(/最终接受正文只出现一次/u)?.length, 1);
    assert.doesNotMatch(all, /七个标题|人物档案：姓名/u);
});

test('compact projector bounds rows and omits unrelated shared authority, full profiles, and raw tickets', () => {
    const evidenceText = `AUTHORITY_ONCE_${'A'.repeat(41985)}`;
    const makeLongActor = (index) => ({
        ...actor(`NPC-pressure-${index}`, null, 'full_adult'),
        refreshProfileModules: [
            'person', 'personality', 'history', 'relationshipsMotives',
            'currentState', 'knowledgeCapabilitiesResources', 'physiology',
        ],
        previousProfile: {
            profileFormat: 'narrative-v1',
            narrativeSections: Object.fromEntries([
                'person', 'personality', 'history', 'relationshipsMotives',
                'currentState', 'knowledgeCapabilitiesResources', 'physiology',
            ].map((key) => [key, { text: `${key}-${index}-${'x'.repeat(3900)}` }])),
            privateUnrequestedPayload: `FULL_PROFILE_SENTINEL_${index}_${'z'.repeat(12000)}`,
        },
        characterCreationTicket: {
            id: `RAW_TICKET_SENTINEL_${index}`,
            rawAuthority: 'r'.repeat(12000),
        },
    });
    for (const count of [6, 24]) {
        const candidates = Array.from({ length: count }, (_, index) => makeLongActor(index));
        const acceptedNarrative = [
            ...candidates.map((candidate) => `${candidate.name}在本轮逐字正文中真实出现。`),
            `ACCEPTED_LONG_TAIL_${'N'.repeat(41000)}`,
        ].join('\n');
        const core = actorProfileCompletionGroupPlan(candidates, { allowDiscovery: false })
            .find((entry) => entry.key === 'character_core');
        const buildMessages = (chunk) => buildActorProfileModuleGroupMessages(chunk, {
            evidenceText,
            discoveryContext: { acceptedNarrative },
        });
        const chunks = actorProfileModuleGroupChunks(core);
        assert.equal(chunks.length, Math.ceil(count / 6));
        for (const chunk of chunks) {
            const prompt = buildMessages(chunk).map((message) => message.content).join('\n');
            assert.equal(prompt.match(/AUTHORITY_ONCE_/gu)?.length || 0, 0);
            assert.doesNotMatch(prompt, /sharedAuthority/u);
            assert.doesNotMatch(prompt, /FULL_PROFILE_SENTINEL|RAW_TICKET_SENTINEL/u);
            assert.doesNotMatch(prompt, /workingModules|identityContext|"profileV6"/u);
            assert.equal(prompt.includes('N'.repeat(2000)), false);
            assert.ok(prompt.length < 80_000);
            assert.ok(chunk.transportChunk.actorCount === 6 || count % 6 === chunk.transportChunk.actorCount);
            const omittedLegacyEnvelopeChars = Number(chunk.transportChunk.actorCount) * 24_000;
            assert.ok(omittedLegacyEnvelopeChars >= 144_000);
        }
    }
});

test('identity coverage uses small mechanical units while preserving the complete accepted text once', () => {
    const acceptedNarrative = Array.from({ length: 80 }, (_, index) => (
        `mechanical paragraph ${index} ${'q'.repeat(90)}。`
    )).join('\n');
    const coverage = actorProfileDiscoveryCoveragePlan(acceptedNarrative);
    assert.ok(coverage.unitCount > 1);
    assert.ok(coverage.units.every((unit) => unit.text.length <= 420));
    assert.equal(coverage.units.map((unit) => unit.text).join(''), acceptedNarrative);
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const prompt = buildActorProfileModuleGroupMessages(group, {
        discoveryContext: { acceptedNarrative, registeredActorIndex: [], excludedActorNames: [] },
    }).map((message) => message.content).join('\n');
    assert.equal(prompt.match(/mechanical paragraph 0/gu)?.length, 1);
    assert.equal(group.discoveryCoverage.coverageDigest, coverage.coverageDigest);
});

test('identity bootstrap is a route-only row-key probe isolated from dossier authority', () => {
    const acceptedNarrative = '新人物明璃真正出场。';
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const messages = buildActorProfileModuleGroupMessages(group, { discoveryContext: {
        acceptedNarrative,
        registeredActorIndex: [{ actorId: 'NPC-old', name: '旧人物' }],
        characterCreationTickets: [{ id: 'ticket-1', name: '明璃' }],
    } });
    const all = messages.map((message) => message.content).join('\n');
    assert.equal(all.match(/NPC-old/gu)?.length, 1);
    assert.equal(all.includes('ticket-1'), false);
    assert.match(all, /actor="new"/u);
    assert.match(all, /\u59d3\u540d\u3001\u4ee3\u53f7\u3001\u7f16\u53f7\u3001\u804c\u4e1a\u6216\u5e26\u9650\u5b9a\u7684\u63cf\u8ff0\u6027\u79f0\u8c13/u);
    assert.match(all, /\u6574\u4e2a\u54cd\u5e94\u7cbe\u786e\u8f93\u51fa <no-new\/>/u);
    assert.match(all, /\u4e0d\u8981\u56de\u663e digest\u3001\u7a7a\u5355\u5143/u);
    assert.doesNotMatch(all, /coverage-unit:/u);
    assert.doesNotMatch(all, /\u58eb\u5175A|\u53d7\u4f24\u7684\u8b66\u536b/u);
    assert.doesNotMatch(all, /\u6743\u5a01\u6750\u6599|\u5168\u5c40\u9644\u52a0\u63d0\u793a/u);
    assert.deepEqual(group.modules, []);
    assert.match(all, /真正出场/u);
});

test('identity parser binds flat literal routes to the earliest independent local unit', () => {
    const longName = '北门记录员七号';
    const shortName = '七号';
    const acceptedNarrative = `${longName}完成登记。${'甲'.repeat(430)}。${shortName}随后独立出现。`;
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    assert.ok(group.discoveryCoverage.unitCount > 1);
    const parsed = parseActorProfileModuleGroupOutput([
        '以下为路由：',
        `<profile-target actor="new" name="${longName}"/>`,
        `<profile-target actor="new" name="${shortName}"/>`,
    ].join('\n'), group, { acceptedNarrative });
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.entries[0].coverageUnitId, group.discoveryCoverage.units[0].id);
    assert.equal(parsed.entries[1].coverageUnitId, group.discoveryCoverage.units.at(-1).id);
    assert.ok(parsed.coverageProof);
    assert.ok(parsed.routeRepairs.includes('actor_profile.route_discovery_unit_inferred'));
    assert.ok(parsed.routeRepairs.includes('actor_profile.route_extra_prose_ignored'));
});

test('identity parser binds a repeated stable literal to its earliest coverage unit', () => {
    const name = '重复出现的记录员';
    const acceptedNarrative = `${name}先到场。${'甲'.repeat(430)}。${name}再次被看见。`;
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<profile-target actor="new" name="${name}"/>`,
        group,
        { acceptedNarrative },
    );
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries[0].coverageUnitId, group.discoveryCoverage.units[0].id);
    assert.equal(parsed.entries[0].sourceUnitOffset, 0);
});

test('identity compact coverage accepts only exact empty or locally provable flat routes', () => {
    const acceptedNarrative = `第一单元没有人物。${'甲'.repeat(430)}。第二单元有记录员。`;
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const exactEmpty = parseActorProfileModuleGroupOutput('<no-new/>', group, {
        acceptedNarrative,
    });
    assert.equal(exactEmpty.explicitEmpty, true);
    assert.ok(exactEmpty.coverageProof);

    const mixed = parseActorProfileModuleGroupOutput(
        '<no-new/><profile-target actor="new" name="记录员"/>',
        group,
        { acceptedNarrative },
    );
    assert.ok(mixed.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_disposition_invalid'
    )));
    const unknownUnit = parseActorProfileModuleGroupOutput(
        '<profile-target actor="new" name="记录员" unit="CU-999"/>',
        group,
        { acceptedNarrative },
    );
    assert.ok(unknownUnit.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_unit_unknown'
    )));
    const wrongKnownUnit = parseActorProfileModuleGroupOutput(
        `<profile-target actor="new" name="记录员" unit="${group.discoveryCoverage.units[0].id}"/>`,
        group,
        { acceptedNarrative },
    );
    assert.ok(wrongKnownUnit.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_name_not_in_coverage_unit'
    )));
    const proseOnly = parseActorProfileModuleGroupOutput('没有发现需要登记的人物。', group, {
        acceptedNarrative,
    });
    assert.equal(proseOnly.explicitEmpty, false);
    assert.ok(proseOnly.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_extra_content'
    )));
});

test('identity parser keeps complete legacy wrappers but rejects a partial wrapper set', () => {
    const acceptedNarrative = `第一单元。${'甲'.repeat(430)}。第二单元有记录员。`;
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const wrappers = group.discoveryCoverage.units.map((unit) => (
        `<coverage-unit id="${unit.id}" digest="${unit.digest}">`
        + (unit.text.includes('记录员')
            ? '<profile-target actor="new" name="记录员"></profile-target>'
            : '<no-new/>')
        + '</coverage-unit>'
    ));
    const complete = parseActorProfileModuleGroupOutput(wrappers.join(''), group, {
        acceptedNarrative,
    });
    assert.deepEqual(complete.failures, []);
    assert.equal(complete.entries.length, 1);
    assert.ok(complete.coverageProof);
    const partial = parseActorProfileModuleGroupOutput(wrappers.at(-1), group, {
        acceptedNarrative,
    });
    assert.ok(partial.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_unit_missing'
    )));
});

test('legacy empty wrapper rejects a malformed profile-target peer instead of sealing no candidates', () => {
    const acceptedNarrative = '记录员进入房间。';
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const unit = group.discoveryCoverage.units[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<coverage-unit id="${unit.id}" digest="${unit.digest}">`
        + '<no-new/><profile_target actor="new" name="记录员"'
        + '</coverage-unit>',
        group,
        { acceptedNarrative },
    );
    assert.equal(parsed.explicitEmpty, false);
    assert.equal(parsed.coverageProof, null);
    assert.ok(parsed.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_extra_content'
    )));
});

test('flat identity route rejects a malformed second control tag instead of dropping its person', () => {
    const acceptedNarrative = '记录员和守门人一起进入房间。';
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const parsed = parseActorProfileModuleGroupOutput(
        '<profile-target actor="new" name="记录员"/>'
        + '<profile_target actor="new" name="守门人"',
        group,
        { acceptedNarrative },
    );
    assert.equal(parsed.coverageProof, null);
    assert.ok(parsed.failures.some((entry) => (
        entry.reason === 'actor_profile.discovery_coverage_extra_content'
    )));
});

test('identity route parser discards dossier module noise instead of promoting it', () => {
    const group = actorProfileCompletionGroupPlan([], { allowDiscovery: true })[0];
    const parsed = parseActorProfileModuleGroupOutput([
        '<profile-target actor="new" name="\u53d7\u4f24\u7684\u5546\u6237">',
        `<module key="person">${prose('\u4e0d\u5e94\u8fdb\u5165\u6863\u6848')}</module>`,
        '</profile-target>',
    ].join('\n'), group, { acceptedNarrative: '\u53d7\u4f24\u7684\u5546\u6237\u6276\u7740\u95e8\u6846\u8d70\u8fdb\u6765\u3002' });
    assert.equal(parsed.formatUnrecoverable, false);
    assert.deepEqual(parsed.failures, []);
    assert.deepEqual(parsed.entries[0].modules, {});
    assert.equal(parsed.entries[0].name, '\u53d7\u4f24\u7684\u5546\u6237');
});

test('identity route reuses a registered ActorRef when accepted narrative reveals a new row key', () => {
    const acceptedNarrative = '\u9003\u4ea1\u8005\u7ec8\u4e8e\u62a5\u4e0a\u4e86\u540d\u5b57\uff1a\u4ed6\u53eb\u6770\u514b\u3002';
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const unit = group.discoveryCoverage.units[0];
    const output = `<coverage-unit id="${unit.id}" digest="${unit.digest}">`
        + '<profile-target actor="NPC-escapee" name="\u6770\u514b"><identity-evidence>\u9003\u4ea1\u8005\u7ec8\u4e8e\u62a5\u4e0a\u4e86\u540d\u5b57：\u4ed6\u53eb\u6770\u514b</identity-evidence></profile-target>'
        + '</coverage-unit>';
    const parsed = parseActorProfileModuleGroupOutput(output, group, {
        acceptedNarrative,
        registeredActorIndex: [{
            actorId: 'NPC-escapee',
            displayName: '\u9003\u4ea1\u8005',
            aliases: [],
        }],
    });
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].identityReveal, true);
    assert.equal(parsed.entries[0].actorId, 'NPC-escapee');
    assert.equal(parsed.entries[0].name, '\u6770\u514b');
    assert.equal(parsed.entries[0].sourceAnchor, unit.text);
});

test('flat identity reveal binds the unit containing its complete literal evidence', () => {
    const acceptedNarrative = `杰克这个名字先被写在名单上。${'甲'.repeat(430)}。逃亡者终于承认自己就是杰克。`;
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const evidence = '逃亡者终于承认自己就是杰克';
    const parsed = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-escapee" name="杰克"><identity-evidence>${evidence}</identity-evidence></profile-target>`,
        group,
        {
            acceptedNarrative,
            registeredActorIndex: [{
                actorId: 'NPC-escapee',
                displayName: '逃亡者',
                aliases: [],
            }],
        },
    );
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].identityReveal, true);
    assert.equal(parsed.entries[0].coverageUnitId, group.discoveryCoverage.units.at(-1).id);
    assert.ok(parsed.entries[0].sourceAnchor.includes(evidence));
});

test('identity reveal refuses an invented ActorRef and never downgrades it to a new actor', () => {
    const acceptedNarrative = '\u9003\u4ea1\u8005\u62a5\u540d\u6770\u514b\u3002';
    const group = actorProfileCompletionGroupPlan([], {
        allowDiscovery: true,
        acceptedNarrative,
    })[0];
    const unit = group.discoveryCoverage.units[0];
    const parsed = parseActorProfileModuleGroupOutput(
        `<coverage-unit id="${unit.id}" digest="${unit.digest}">`
            + '<profile-target actor="NPC-invented" name="\u6770\u514b"></profile-target>'
            + '</coverage-unit>',
        group,
        {
            acceptedNarrative,
            registeredActorIndex: [{ actorId: 'NPC-escapee', displayName: '\u9003\u4ea1\u8005' }],
        },
    );
    assert.equal(parsed.entries.length, 0);
    assert.ok(parsed.failures.some((entry) => (
        entry.reason === 'actor_profile.identity_reveal_actor_ref_unknown'
    )));
});
