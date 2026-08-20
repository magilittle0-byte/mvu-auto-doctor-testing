import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    actorProfileMvuDigest,
    actorProfileMvuSourceRefDigest,
} from '../actor-profile-mvu-core.mjs';
import {
    actorProfileSurfaceRuntimeFingerprint,
    collapseActorProfileAccordion,
    createActorProfileSurfaceView,
    renderActorProfileAccordion,
} from '../v2/surface/actor-profile-view.mjs';

const target = Object.freeze({
    chatId: 'chat-synthetic', messageId: 'message-synthetic',
    generationId: 'generation-synthetic', generationSerial: 1,
    generationType: 'normal', scopeDigest: 'scope-synthetic',
    contentFingerprint: 'content-synthetic',
});

function completeProfile(actorId, name, revision = 1, readback = true) {
    const sections = Object.fromEntries([
        ['person', '人物信息'], ['personality', '性格特征'], ['history', '过往经历'],
        ['currentState', '当前长期状态'], ['relationshipsMotives', '关系与动机'],
        ['knowledgeCapabilitiesResources', '知识、能力与长期资源'],
    ].map(([key, title]) => [key, {
        key, title, text: `${title}的合成测试内容`, source: 'hypothesis', evidence: [],
    }]));
    return {
        profileFormat: 'narrative-v1',
        completionMode: 'full',
        actorRef: { kind: 'actor_ref', actorId, name, aliases: [`${name}别名`] },
        姓名与别名: { 姓名: name, 别名: [`${name}别名`] },
        narrativeSections: sections,
        locks: {}, manualOverrides: {},
        本地元数据: {
            revision, status: readback ? 'readback_ready' : 'complete',
            readbackVerified: readback, sourceRef: target,
            sourceRefDigest: actorProfileMvuSourceRefDigest(target),
        },
    };
}

function actorFor(profile, ready = true) {
    const actorId = profile.actorRef.actorId;
    return {
        id: actorId, name: profile.actorRef.name, aliases: profile.actorRef.aliases,
        profileRef: {
            status: ready ? 'ready' : 'pending', readbackVerified: ready,
            digest: actorProfileMvuDigest(profile),
            sourceRefDigest: profile.本地元数据.sourceRefDigest,
            sourceRef: target,
            completionMode: profile.completionMode,
        },
    };
}

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.className = '';
        this.textContent = '';
        this.children = [];
        this.childNodes = this.children;
        this.dataset = {};
        this.attributes = {};
        this.listeners = new Map();
        this.open = false;
        this.hidden = false;
        this.type = '';
    }
    append(...nodes) { for (const node of nodes) this.appendChild(node); }
    appendChild(node) { this.children.push(node); node.parentElement = this; return node; }
    replaceChildren(...nodes) { this.children.length = 0; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(type, listener) {
        const list = this.listeners.get(type) || [];
        list.push(listener); this.listeners.set(type, list);
    }
    dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ target: this }); }
    querySelectorAll(selector) {
        const className = String(selector).startsWith('.') ? String(selector).slice(1) : '';
        const found = [];
        const visit = (node) => {
            for (const child of node.children || []) {
                if (className && String(child.className || '').split(/\s+/u).includes(className)) found.push(child);
                visit(child);
            }
        };
        visit(this);
        return found;
    }
}

const fakeDocument = { createElement: (tag) => new FakeElement(tag) };

function allText(node) {
    return [node.textContent, ...(node.children || []).map(allText)].filter(Boolean).join(' ');
}

test('12-person durable MVU projection renders compact and default-collapsed', () => {
    const profiles = {};
    const actors = [];
    for (let index = 0; index < 12; index += 1) {
        const profile = completeProfile(`actor-${index}`, `合成人物${index}`, index + 1);
        profiles[profile.actorRef.actorId] = profile;
        actors.push(actorFor(profile));
    }
    const view = createActorProfileSurfaceView({ profiles, actors, currentTarget: target });
    assert.equal(view.cards.length, 12);
    assert.equal(view.counts.ready, 12);
    assert.equal(view.counts.added, 1);
    assert.equal(view.counts.updated, 11);
    const host = new FakeElement('div');
    const rendered = renderActorProfileAccordion(fakeDocument, host, view);
    assert.equal(rendered.cards.length, 12);
    assert.ok(rendered.cards.every((card) => card.open === false));
    assert.equal(host.querySelectorAll('.mvuad-mvu-profile-group').length, 24);
    const visible = allText(host);
    assert.doesNotMatch(visible, /actor-0|revision|digest|SourceRef|JSONPatch/iu);
});

test('accordion opens at most one person and collapse-all clears local selection', () => {
    const profiles = Object.fromEntries([0, 1, 2].map((index) => {
        const profile = completeProfile(`actor-${index}`, `人物${index}`);
        return [profile.actorRef.actorId, profile];
    }));
    const actors = Object.values(profiles).map((profile) => actorFor(profile));
    const view = createActorProfileSurfaceView({ profiles, actors, currentTarget: target });
    const host = new FakeElement('div');
    const expanded = [];
    const { cards } = renderActorProfileAccordion(fakeDocument, host, view, {
        onExpanded: (actorId) => expanded.push(actorId),
    });
    cards[0].open = true; cards[0].dispatch('toggle');
    assert.deepEqual(cards.map((card) => card.open), [true, false, false]);
    cards[1].open = true; cards[1].dispatch('toggle');
    assert.deepEqual(cards.map((card) => card.open), [false, true, false]);
    collapseActorProfileAccordion(host, (actorId) => expanded.push(actorId));
    assert.ok(cards.every((card) => card.open === false));
    assert.equal(expanded.at(-1), '');
});

test('fault and legacy cards expose only their scoped repair or migration action', () => {
    const broken = completeProfile('actor-broken', '待修人物', 1, false);
    delete broken.narrativeSections.history;
    const legacy = completeProfile('actor-legacy', '旧档人物');
    legacy.baselineCommit = { readbackVerified: true };
    const actors = [
        actorFor(broken, false),
        { id: 'actor-legacy', name: '旧档人物', profileV6: legacy, profileRef: null },
    ];
    const view = createActorProfileSurfaceView({
        profiles: { 'actor-broken': broken }, actors, currentTarget: target,
    });
    assert.equal(view.cards[0].status.color, 'red');
    assert.equal(view.cards[0].status.repairable, true);
    assert.equal(view.cards[1].status.color, 'yellow');
    assert.equal(view.cards[1].status.migratable, true);
    const host = new FakeElement('div');
    const repaired = [];
    const migrated = [];
    renderActorProfileAccordion(fakeDocument, host, view, {
        onRepair: (actorId) => repaired.push(actorId),
        onMigrate: (actorId) => migrated.push(actorId),
    });
    host.querySelectorAll('.mvuad-mvu-profile-repair')[0].dispatch('click');
    host.querySelectorAll('.mvuad-mvu-profile-migrate')[0].dispatch('click');
    assert.deepEqual(repaired, ['actor-broken']);
    assert.deepEqual(migrated, ['actor-legacy']);
});

test('physiology is shown only in full-adult mode and applicable content', () => {
    const profile = completeProfile('actor-one', '人物一');
    profile.completionMode = 'full_adult';
    profile.narrativeSections.physiology = {
        title: '生理档案', text: '六项完整覆盖后的合成且适用生理资料', source: 'hypothesis',
        contractVersion: 2,
    };
    const actor = actorFor(profile);
    const basic = createActorProfileSurfaceView({
        profiles: { 'actor-one': profile }, actors: [actor], completionMode: 'full',
    });
    const adult = createActorProfileSurfaceView({
        profiles: { 'actor-one': profile }, actors: [actor], completionMode: 'full_adult',
    });
    assert.equal(basic.cards[0].physiology, null);
    assert.equal(adult.cards[0].physiology.text, '六项完整覆盖后的合成且适用生理资料');
    profile.narrativeSections.physiology.text = '不适用：非生物实体';
    const inapplicable = createActorProfileSurfaceView({
        profiles: { 'actor-one': profile }, actors: [actor], completionMode: 'full_adult',
    });
    assert.equal(inapplicable.cards[0].physiology, null);
});

test('full-adult short physiology or empty legacy module is red and never false-green', () => {
    const profile = completeProfile('actor-physiology-missing', '待补生理人物');
    profile.completionMode = 'full_adult';
    profile.narrativeSections.physiology = {
        title: '生理档案', text: '成年，状态正常。', source: 'hypothesis',
    };
    profile.modules = {
        physiology: {
            status: 'missing', source: 'confirmed',
            data: { enabled: true, adultEnabled: true, body: '', reproductive: '' },
        },
    };
    const view = createActorProfileSurfaceView({
        profiles: { 'actor-physiology-missing': profile },
        actors: [actorFor(profile)], completionMode: 'full_adult',
    });
    assert.equal(view.cards[0].status.color, 'red');
    assert.equal(view.cards[0].status.label, '档案不完整');
    assert.equal(view.cards[0].status.repairable, true);
    assert.equal(view.cards[0].physiology, null);
    assert.equal(view.cards[0].missingSectionCount, 1);
    assert.match(view.summary, /失败 1 人/u);
});

test('surface runtime fingerprint changes under a real mutation probe', () => {
    assert.notEqual(
        actorProfileSurfaceRuntimeFingerprint(''),
        actorProfileSurfaceRuntimeFingerprint('mutated-renderer'),
    );
});

test('unbound persisted profile failure stays red instead of becoming a blue empty state', () => {
    const view = createActorProfileSurfaceView({
        profiles: {},
        actors: [],
        diagnostic: {
            status: 'not_completed',
            canRetry: true,
            lastFailureCodes: ['profile_block_malformed'],
        },
    });
    assert.equal(view.cards.length, 0);
    assert.equal(view.batchFailure, true);
    assert.equal(view.counts.unboundFailed, 1);
    assert.match(view.summary, /未完成/u);
    assert.match(view.summary, /医生修复中心/u);
    assert.doesNotMatch(view.summary, /profile_block|ActorId|SourceRef|digest/iu);
});

test('durable success cannot stay red because transient recovery material once existed', () => {
    const profile = completeProfile('actor-ready', '已保存人物');
    const view = createActorProfileSurfaceView({
        profiles: { 'actor-ready': profile },
        actors: [actorFor(profile)],
        currentTarget: target,
        diagnostic: {
            status: 'atomic_readback',
            canRetry: true,
            lastFailureCodes: ['stale-transient-recovery-marker'],
        },
    });
    assert.equal(view.cards.length, 1);
    assert.equal(view.cards[0].status.color, 'green');
    assert.equal(view.batchFailure, false);
    assert.equal(view.counts.unboundFailed, 0);
    assert.match(view.summary, /1\/1 人已完整保存/u);
    assert.match(view.summary, /当前无需操作/u);
    assert.doesNotMatch(view.summary, /另有未绑定|修复中心/u);
});

test('production surface reads exact MVU projection, stores only fold preference locally, and is height-bounded', async () => {
    const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const renderStart = indexSource.indexOf('function renderActorProfiles');
    const renderEnd = indexSource.indexOf('function renderContinuityLedger', renderStart);
    const surface = indexSource.slice(renderStart, renderEnd);
    assert.match(surface, /mvuDataAt\(Mvu, latest\.index\)/u);
    assert.match(surface, /actorProfileMvuProfilesFromData\(data, ACTOR_PROFILE_MVU_ROOT\)/u);
    assert.doesNotMatch(surface, /TavernDB|database|tableEdit|worldbook/iu);
    assert.match(indexSource, /localStorage\.(?:getItem|setItem|removeItem)/u);
    assert.match(surface, /runSemanticActorProfileTargetedRepair\(captured, \{ actorId \}\)/u);
    assert.match(surface, /migrateLegacyProfilesToMvu\(\{ actorId \}\)/u);
    const surfaceStateStart = indexSource.indexOf('function renderActorProfileSurfaceState');
    const surfaceStateEnd = indexSource.indexOf('function renderActorProfiles', surfaceStateStart);
    const surfaceState = indexSource.slice(surfaceStateStart, surfaceStateEnd);
    assert.match(surfaceState, /hydratedActorProfileDiagnostic\(state, \{ currentTarget \}\)/u);
    assert.match(surfaceState, /view\.batchFailure/u);
    assert.match(surface, /persistedProfileFailure[\s\S]*?healthColor = persistedProfileFailure \? 'red' : 'blue'/u);
    assert.match(indexSource, /canRetry:\s*result\?\.status === 'not_completed' && recoverySaved/u);
    assert.match(css, /\.mvuad-mvu-profile-list\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/iu);
    assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.mvuad-mvu-profile-row[\s\S]*?flex-direction:\s*column/iu);
});
