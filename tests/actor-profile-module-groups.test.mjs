import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION,
    ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS,
    actorProfileCompletionGroupPlan,
    buildActorProfileModuleGroupMessages,
    parseActorProfileModuleGroupOutput,
} from '../actor-profile-v6-core.mjs';

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
        'identity_bootstrap', 'character_core', 'physiology_optional',
    ]);
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
    assert.deepEqual(plan.map((group) => group.key), ['physiology_optional']);
    assert.deepEqual(plan[0].targets.physiology.map((row) => row.actorId), ['NPC-adult-upgrade']);
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
        ['physiology_optional'],
    );
    stale.previousProfile.narrativeSections.physiology.contractVersion =
        ACTOR_PROFILE_ADULT_PHYSIOLOGY_CONTRACT_VERSION;
    assert.deepEqual(actorProfileCompletionGroupPlan([stale], { allowDiscovery: false }), []);
});

test('adult physiology prompt requires sexual physiology instead of accepting a generic body paragraph', () => {
    const group = actorProfileCompletionGroupPlan([
        actor('NPC-adult-prompt', null, 'full_adult'),
    ], { allowDiscovery: false }).find((entry) => entry.key === 'physiology_optional');
    const prompt = buildActorProfileModuleGroupMessages(group, {
        discoveryContext: { acceptedNarrative: '该成年人站在门边等待。' },
    }).map((message) => message.content).join('\n');
    assert.match(prompt, /外生殖器/u);
    assert.match(prompt, /内生殖系统/u);
    assert.match(prompt, /第二性征/u);
    assert.match(prompt, /性刺激下的生理反应/u);
    assert.match(prompt, /不能只写体型、伤病、服装或机械改造/u);
    assert.match(prompt, /不得把性经历、性行为、偏好、同意或关系当成生理事实/u);
});

test('adult physiology requires complete non-persistent coverage declarations and stores only prose', () => {
    const group = actorProfileCompletionGroupPlan([
        actor('NPC-adult-coverage', null, 'full_adult'),
    ], { allowDiscovery: false }).find((entry) => entry.key === 'physiology_optional');
    const excerpts = Object.fromEntries(ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key, index) => [
        key,
        `覆盖项目${index + 1}具有彼此独立且可核验的自然中文说明`,
    ]));
    const body = `${Object.values(excerpts).join('。')}。${prose('完整成人生理基线')}`;
    const complete = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key) => (
        `<physiology-coverage key="${key}">${excerpts[key]}</physiology-coverage>`
    )).join('');
    const accepted = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${body}${complete}</module></profile-target>`,
        group,
    );
    assert.deepEqual(accepted.failures, []);
    assert.equal(accepted.entries[0].modules.physiology, body);
    assert.equal(accepted.entries[0].modules.physiology.includes('physiology-coverage'), false);
    const missing = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${body}${complete.replace(/<physiology-coverage key="limitations">[\s\S]*?<\/physiology-coverage>/u, '')}</module></profile-target>`,
        group,
    );
    assert.ok(missing.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
        && entry.missingFields.includes('physiology.limitations')
    )));
    const reused = ACTOR_PROFILE_PHYSIOLOGY_COVERAGE_KEYS.map((key) => (
        `<physiology-coverage key="${key}">${excerpts.generalBaseline}</physiology-coverage>`
    )).join('');
    const rejectedReuse = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${body}${reused}</module></profile-target>`,
        group,
    );
    assert.ok(rejectedReuse.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
    )));
    const taglessComplete = [
        '一般体征具有稳定而清楚的物种与年龄基线描述',
        '生殖解剖依照该人物已经确认的物种和生理性别补全',
        '第二性征以自然客观的完整句子说明其长期特征',
        '生殖功能与周期分泌按照当前世界设定保持一致',
        '性刺激下的生理反应和敏感部位只陈述身体事实',
        '限制部分明确区分生理事实与经历偏好同意关系',
    ].join('。');
    const repairedWithoutTags = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${taglessComplete}</module></profile-target>`,
        group,
    );
    assert.deepEqual(repairedWithoutTags.failures, []);
    assert.equal(repairedWithoutTags.entries[0].modules.physiology, taglessComplete);
    const repeatedGeneric = Array.from({ length: 6 }, () => '身体状态正常且没有其他可用的具体生理资料').join('。');
    const unrecoverableGeneric = parseActorProfileModuleGroupOutput(
        `<profile-target actor="NPC-adult-coverage" name="人物NPC-adult-coverage"><module key="physiology">${repeatedGeneric}</module></profile-target>`,
        group,
    );
    assert.ok(unrecoverableGeneric.failures.some((entry) => (
        entry.reason === 'actor_profile.physiology_coverage_incomplete'
    )));
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
        + `<module key="physiology">${prose('越界')}</module>`
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
        discoveryContext: { acceptedNarrative: '最终接受正文只出现一次。' },
    });
    const all = messages.map((message) => message.content).join('\n');
    assert.match(all, /currentState:/u);
    assert.match(all, /knowledgeCapabilitiesResources:/u);
    assert.match(all, /目标行与当前值/u);
    assert.match(all, /"requestedModules"/u);
    assert.match(all, /"actors"/u);
    assert.equal(all.match(/"authority"/gu)?.length, 1);
    assert.equal(all.match(/最终接受正文只出现一次/u)?.length, 1);
    assert.doesNotMatch(all, /七个标题|人物档案：姓名/u);
});

test('identity bootstrap is a route-only row-key probe isolated from dossier authority', () => {
    const group = actorProfileCompletionGroupPlan([], { allowDiscovery: true })[0];
    const messages = buildActorProfileModuleGroupMessages(group, { discoveryContext: {
        acceptedNarrative: '新人物明璃真正出场。',
        registeredActorIndex: [{ actorId: 'NPC-old', name: '旧人物' }],
        characterCreationTickets: [{ id: 'ticket-1', name: '明璃' }],
    } });
    const all = messages.map((message) => message.content).join('\n');
    assert.equal(all.match(/NPC-old/gu)?.length, 1);
    assert.equal(all.includes('ticket-1'), false);
    assert.match(all, /Registry displayName\/\u884c\u952e/u);
    assert.match(all, /\u59d3\u540d\u3001\u4ee3\u53f7\u3001\u7f16\u53f7\u3001\u804c\u4e1a\u6216\u5e26\u9650\u5b9a\u7684\u63cf\u8ff0\u6027\u79f0\u8c13/u);
    assert.doesNotMatch(all, /\u58eb\u5175A|\u53d7\u4f24\u7684\u8b66\u536b/u);
    assert.doesNotMatch(all, /\u6743\u5a01\u6750\u6599|\u5168\u5c40\u9644\u52a0\u63d0\u793a/u);
    assert.deepEqual(group.modules, []);
    assert.match(all, /真正出场/u);
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
