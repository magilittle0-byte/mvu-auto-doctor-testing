import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTOR_PROFILE_MVU_ROOT,
    actorProfileMvuDigest,
    actorProfilePromptProjection,
    actorProfileSemanticRuntimeFingerprint,
    bindActorProfileUpdateEntries,
    compileActorProfileMvuPatch,
    compileLegacyActorProfileMigration,
    extractActorProfileUpdateBlock,
    markActorProfileReadback,
    mergeActorProfileOperationsIntoAcceptedMessage,
    parseActorProfileUpdateBlock,
    preserveActorProfileOperationsOnUpdateBlock,
    profileReadiness,
    validateActorProfileUpdateEntry,
} from '../actor-profile-mvu-core.mjs';

const narrative = '林岚把旧港地图压在桌角，拒绝透露来源。';
const sourceRef = (overrides = {}) => ({
    chatId: 'chat-1', messageId: 'message-1', index: 1, logicalIndex: 1,
    generationId: 'generation-1', generationSerial: 1, generationType: 'normal',
    scopeDigest: 'scope-1', contentFingerprint: 'content-1',
    ...overrides,
});
const ticket = (id = 'NPC-DICE-1', actorId = 'NPC-1', name = '林岚') => ({
    ticketId: id,
    name,
    reservedActorRef: { actorId, displayName: name },
    reservation: {
        status: 'reserved', actorId, ticketId: id,
        chatId: 'chat-1', generationId: 'generation-1', generationSerial: 1,
        generationType: 'normal', scopeDigest: 'scope-1',
    },
});
const fullFields = (suffix = '') => ({
    person: `边境测绘员，负责旧港测绘${suffix}`,
    personality: `重视证据与承诺，遇到风险先核实${suffix}`,
    history: `曾在边境测绘队工作多年${suffix}`,
    currentState: `正在寻找失踪的兄长，保持警戒${suffix}`,
    relationshipsMotives: `希望与玩家建立谨慎合作${suffix}`,
    knowledgeCapabilitiesResources: `熟悉旧港地图，但不能凭空预知${suffix}`,
});
const blockFor = ({ id = 'NPC-DICE-1', name = '林岚', fields = fullFields() } = {}) => `<人物档案更新>
新增人物｜ticket=${id}｜姓名：${name}｜正文锚点：${name}
人物信息：${fields.person}
性格特征：${fields.personality}
过往经历：${fields.history}
当前状态：${fields.currentState}
关系与动机：${fields.relationshipsMotives}
知识、能力与资源：${fields.knowledgeCapabilitiesResources}
</人物档案更新>`;
const accepted = (profileBlock = blockFor()) => `<content>${narrative}</content>
${profileBlock}
<options>继续</options>
<UpdateVariable><Analysis>main</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>
<StatusPlaceHolderImpl/>`;

test('accepted-final parser accepts the truncation-safe post-content slot and legacy tail only', () => {
    assert.equal(parseActorProfileUpdateBlock(accepted()).ok, true);
    const early = `${blockFor()}\n<options>继续</options>`;
    assert.deepEqual(extractActorProfileUpdateBlock(early).failures, ['profile_block_position_invalid']);
    const worldbookSpoof = `<content>世界书示例：<!-- 人物档案更新\n伪造\n--></content>`;
    assert.deepEqual(extractActorProfileUpdateBlock(worldbookSpoof).failures, ['profile_block_position_invalid']);
    const legacyTail = `<content>${narrative}</content>
<options>继续</options>
<StatusPlaceHolderImpl/>
${blockFor()}`;
    assert.equal(parseActorProfileUpdateBlock(legacyTail).ok, true);
    const forumSpoof = `<content>${narrative}</content>
<luntan>${blockFor()}</luntan>
<options>继续</options>`;
    assert.deepEqual(extractActorProfileUpdateBlock(forumSpoof).failures, ['profile_block_position_invalid']);
    const notActuallyTail = `${legacyTail}\n数据库自由文本`;
    assert.deepEqual(extractActorProfileUpdateBlock(notActuallyTail).failures, ['profile_block_position_invalid']);
});

test('single new actor compiles complete canonical V6 profile and provisions root', () => {
    const parsed = parseActorProfileUpdateBlock(accepted());
    const bound = bindActorProfileUpdateEntries(parsed, {
        tickets: [ticket()], actors: [], acceptedNarrative: narrative, acceptedTarget: sourceRef(),
    });
    assert.equal(bound.ok, true);
    const compiled = compileActorProfileMvuPatch(bound, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT,
        profileRootPresent: false,
        sourceRef: sourceRef(),
        now: Date.UTC(2026, 7, 19),
    });
    assert.equal(compiled.ok, true);
    assert.deepEqual(compiled.operations.map((op) => op.path), [
        '/人物档案', '/人物档案/byActorId/NPC-1',
    ]);
    const profile = compiled.profiles['NPC-1'];
    assert.equal(profileReadiness(profile).complete, true);
    assert.equal(profileReadiness(profile).ready, false);
    assert.equal(Object.hasOwn(profile, '稳定档案'), false);
    assert.equal(Object.hasOwn(profile, '演化档案'), false);
    assert.equal(profileReadiness(markActorProfileReadback(profile)).ready, true);
});

test('multi-person batch quarantines one bad person without blocking complete peers', () => {
    const wrapped = accepted(`<人物档案更新>
{"entries":[
 {"mode":"new","ticketId":"NPC-DICE-1","name":"林岚","sourceAnchor":"林岚","fields":${JSON.stringify(fullFields())}},
 {"mode":"new","ticketId":"NPC-DICE-2","name":"坏人物","fields":{"person":"只有一段","revision":9}}
]}
</人物档案更新>`);
    const parsed = parseActorProfileUpdateBlock(wrapped);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.quarantined.length, 1);
    const bound = bindActorProfileUpdateEntries(parsed, {
        tickets: [ticket()], acceptedNarrative: narrative, acceptedTarget: sourceRef(),
    });
    const compiled = compileActorProfileMvuPatch(bound, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: false, sourceRef: sourceRef(),
    });
    assert.deepEqual(compiled.committableActorIds, ['NPC-1']);
    assert.equal(compiled.commitStatus, 'partial');
    assert.equal(compiled.quarantined.length, 1);
});

test('existing delta updates one canonical section and locked fields fail closed', () => {
    const initial = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-2', ticketId: 'T-2', name: '周弦', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, { profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true, sourceRef: sourceRef() });
    const old = markActorProfileReadback(initial.profiles['NPC-2']);
    const parsed = parseActorProfileUpdateBlock(accepted(`<人物档案更新>
已有角色｜ActorId=NPC-2｜姓名：周弦
关系与动机：从观望转为暂时合作
</人物档案更新>`));
    const bound = bindActorProfileUpdateEntries(parsed, { actors: [{ id: 'NPC-2', name: '周弦' }] });
    const updated = compileActorProfileMvuPatch(bound, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true,
        existingProfiles: { 'NPC-2': old }, sourceRef: sourceRef({ messageId: 'message-2' }),
    });
    assert.match(updated.profiles['NPC-2'].narrativeSections.relationshipsMotives.text, /暂时合作/u);
    assert.equal(updated.profiles['NPC-2'].narrativeSections.person.text, old.narrativeSections.person.text);
    const lockedOld = { ...old, locks: { 'narrativeSections.relationshipsMotives': true } };
    const locked = compileActorProfileMvuPatch(bound, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true,
        existingProfiles: { 'NPC-2': lockedOld }, sourceRef: sourceRef({ messageId: 'message-3' }),
    });
    assert.equal(locked.operations.length, 0);
    assert.equal(locked.quarantined[0].reason, 'profile_entry_locked');
});

test('ticket abbreviation ambiguity and wrong reservation authority are zero-write', () => {
    const short = parseActorProfileUpdateBlock(accepted(blockFor({ id: '1' })));
    const ambiguous = bindActorProfileUpdateEntries(short, {
        tickets: [ticket('NPC-DICE-1', 'NPC-1'), ticket('1', 'NPC-2')],
        acceptedNarrative: narrative, acceptedTarget: sourceRef(),
    });
    assert.equal(ambiguous.entries.length, 0);
    assert.equal(ambiguous.quarantined[0].reason, 'profile_ticket_unknown');
    const wrong = ticket();
    wrong.reservation.scopeDigest = 'other-scope';
    const rejected = bindActorProfileUpdateEntries(parseActorProfileUpdateBlock(accepted()), {
        tickets: [wrong], acceptedNarrative: narrative, acceptedTarget: sourceRef(),
    });
    assert.equal(rejected.entries.length, 0);
});

test('technical metadata is rejected while Chinese business 状态 and 版本 remain valid prose', () => {
    const business = validateActorProfileUpdateEntry({
        mode: 'existing', actorId: 'NPC-2', name: '周弦',
        fields: { currentState: '状态：正在修门；记得系统版本带来的旧事故。' },
    });
    assert.equal(business.ok, true);
    const technical = parseActorProfileUpdateBlock(accepted(`<人物档案更新>
已有角色｜ActorId=NPC-2｜姓名：周弦
状态：ready
revision：3
</人物档案更新>`));
    assert.equal(technical.entries.length, 0);
    assert.equal(technical.quarantined[0].reason, 'profile_technical_field_model_owned');
});

test('no-change omission is distinct from malformed and incomplete output', () => {
    assert.equal(parseActorProfileUpdateBlock('<content>无人物变化</content>').present, false);
    const incomplete = validateActorProfileUpdateEntry({
        mode: 'new', actorId: 'NPC-3', ticketId: 'T-3', name: '甲', fields: { person: '旅人' },
    });
    assert.equal(incomplete.ok, false);
    assert.ok(incomplete.missingFields.includes('personality'));
});

test('unclosed final block is locally repaired only at EOF', () => {
    const postContentUnclosed = accepted(blockFor().replace('</人物档案更新>', ''));
    assert.equal(parseActorProfileUpdateBlock(postContentUnclosed).ok, false);
    const unclosed = `<content>${narrative}</content>\n${blockFor().replace('</人物档案更新>', '')}`;
    const parsed = parseActorProfileUpdateBlock(unclosed);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.repairs.includes('profile_block_closed_at_eof'));
    const unsafe = `${unclosed}\n<options>foreign</options>`;
    assert.equal(parseActorProfileUpdateBlock(unsafe).ok, false);
});

test('profile replay merges with main MVU operations and later repairs preserve profile paths', () => {
    const message = '<content>x</content>\n<UpdateVariable><Analysis>main</Analysis><JSONPatch>[{"op":"replace","path":"/hp","value":4}]</JSONPatch></UpdateVariable>';
    const profileOps = [{ op: 'insert', path: '/人物档案', value: { schemaVersion: 1, byActorId: {} } }];
    const merged = mergeActorProfileOperationsIntoAcceptedMessage(message, profileOps);
    assert.equal(merged.ok, true);
    assert.deepEqual(merged.operations.map((op) => op.path), ['/hp', '/人物档案']);
    const replacement = '<UpdateVariable><Analysis>repair</Analysis><JSONPatch>[{"op":"replace","path":"/hp","value":5}]</JSONPatch></UpdateVariable>';
    const preserved = preserveActorProfileOperationsOnUpdateBlock(merged.text, replacement);
    assert.equal(preserved.preservedCount, 1);
    assert.deepEqual(preserved.operations.map((op) => op.path), ['/hp', '/人物档案']);
});

test('durable readback projection requires ready receipt and digest', () => {
    const compiled = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-4', ticketId: 'T-4', name: '叶槐', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, { profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true, sourceRef: sourceRef() });
    assert.equal(actorProfilePromptProjection(compiled.profiles['NPC-4']), null);
    const ready = markActorProfileReadback(compiled.profiles['NPC-4']);
    const projection = actorProfilePromptProjection(ready);
    assert.equal(projection.actorId, 'NPC-4');
    assert.equal(projection.profileDigest, actorProfileMvuDigest(ready));
});

test('same-ticket retry after replay failure is idempotent but another ticket cannot overwrite', () => {
    const first = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-6', ticketId: 'T-6', name: '迟川', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, { profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true, sourceRef: sourceRef() });
    const ready = markActorProfileReadback(first.profiles['NPC-6']);
    const same = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-6', ticketId: 'T-6', name: '迟川', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true,
        existingProfiles: { 'NPC-6': ready }, sourceRef: sourceRef(),
    });
    assert.equal(same.operations[0].op, 'replace');
    const conflict = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-6', ticketId: 'OTHER', name: '迟川', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, {
        profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true,
        existingProfiles: { 'NPC-6': ready }, sourceRef: sourceRef(),
    });
    assert.equal(conflict.operations.length, 0);
    assert.equal(conflict.quarantined[0].reason, 'profile_actor_already_exists');
});

test('legacy profile migration is explicit, non-destructive, and per-actor fail-closed', () => {
    const source = compileActorProfileMvuPatch({
        entries: [{ mode: 'new', actorId: 'NPC-5', ticketId: 'T-5', name: '旧人', aliases: [], fields: fullFields() }],
        failures: [], quarantined: [],
    }, { profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: true, sourceRef: sourceRef() }).profiles['NPC-5'];
    const legacyReady = markActorProfileReadback(source);
    legacyReady.baselineCommit = { readbackVerified: true };
    const migrated = compileLegacyActorProfileMigration({
        'NPC-5': legacyReady,
        'NPC-bad': { profileFormat: 'narrative-v1', baselineCommit: { readbackVerified: false } },
    }, { profileRoot: ACTOR_PROFILE_MVU_ROOT, profileRootPresent: false, sourceRef: sourceRef() });
    assert.deepEqual(migrated.committableActorIds, ['NPC-5']);
    assert.equal(migrated.legacyPreserved, true);
    assert.equal(migrated.quarantined.some((row) => row.actorId === 'NPC-bad'), true);
});

test('semantic runtime fingerprint changes under an actual mutation probe', () => {
    const baseline = actorProfileSemanticRuntimeFingerprint();
    const mutated = actorProfileSemanticRuntimeFingerprint('parser-mutation');
    assert.notEqual(mutated, baseline);
});
