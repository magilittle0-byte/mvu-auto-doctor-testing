import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
    assert.equal(refresh[0].key, 'operational_profile');
    assert.deepEqual(refresh[0].targets.currentState.map((row) => row.actorId), ['NPC-ready']);
    assert.equal(refresh[0].targets.knowledgeCapabilitiesResources.length, 0);
});

test('full and full_adult plans have bounded compatible groups instead of one call per module', () => {
    assert.deepEqual(actorProfileCompletionGroupPlan([actor()], { allowDiscovery: true }).map((group) => group.key), [
        'identity_bootstrap', 'character_core', 'operational_profile',
    ]);
    assert.deepEqual(actorProfileCompletionGroupPlan([actor('NPC-A', null, 'full_adult')], { allowDiscovery: true }).map((group) => group.key), [
        'identity_bootstrap', 'character_core', 'operational_profile', 'physiology_optional',
    ]);
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
        + `<module key="currentState">${prose('越界')}</module>`
        + `</profile-target>`;
    const parsed = parseActorProfileModuleGroupOutput(broken, group);
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_content_incomplete'));
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_duplicate'));
    assert.ok(parsed.failures.some((failure) => failure.reason === 'actor_profile.module_unexpected'));
});

test('module prompt contains per-module notes, fresh current rows and no visible seven-heading dossier contract', () => {
    const group = actorProfileCompletionGroupPlan([actor()], { allowDiscovery: false })
        .find((entry) => entry.key === 'operational_profile');
    const messages = buildActorProfileModuleGroupMessages(group, {
        evidenceText: '权威材料',
        discoveryContext: { acceptedNarrative: '最终接受正文只出现一次。' },
    });
    const all = messages.map((message) => message.content).join('\n');
    assert.match(all, /currentState:/u);
    assert.match(all, /knowledgeCapabilitiesResources:/u);
    assert.match(all, /目标行与当前值/u);
    assert.equal(all.match(/最终接受正文只出现一次/u)?.length, 1);
    assert.doesNotMatch(all, /七个标题|人物档案：姓名/u);
});

test('identity bootstrap receives registered index and same-turn tickets once', () => {
    const group = actorProfileCompletionGroupPlan([], { allowDiscovery: true })[0];
    const messages = buildActorProfileModuleGroupMessages(group, { discoveryContext: {
        acceptedNarrative: '新人物明璃真正出场。',
        registeredActorIndex: [{ actorId: 'NPC-old', name: '旧人物' }],
        characterCreationTickets: [{ id: 'ticket-1', name: '明璃' }],
    } });
    const all = messages.map((message) => message.content).join('\n');
    assert.equal(all.match(/NPC-old/gu)?.length, 1);
    assert.equal(all.match(/ticket-1/gu)?.length, 1);
    assert.match(all, /所有真正出场/u);
});
