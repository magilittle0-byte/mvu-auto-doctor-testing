import { fingerprint } from '../../core.mjs';
import { isActorId } from '../../actor-ref-core.mjs';
import {
    actorProfileMvuDigest,
    profileReadiness,
} from '../../actor-profile-mvu-core.mjs';

export const ACTOR_PROFILE_SURFACE_GROUPS = Object.freeze([
    Object.freeze({
        key: 'stable',
        title: '稳定档案',
        sectionKeys: Object.freeze([
            'person', 'personality', 'history', 'knowledgeCapabilitiesResources',
        ]),
    }),
    Object.freeze({
        key: 'evolving',
        title: '长期演化',
        sectionKeys: Object.freeze(['currentState', 'relationshipsMotives']),
    }),
]);

const SECTION_LABELS = Object.freeze({
    person: '人物信息',
    personality: '性格特征',
    history: '过往经历',
    currentState: '当前长期状态',
    relationshipsMotives: '关系与动机',
    knowledgeCapabilitiesResources: '知识、能力与长期资源',
    physiology: '生理档案',
});

function text(value, max = 4000) {
    return String(value ?? '').replace(/[ \t\r\n]+/gu, ' ').trim().slice(0, max);
}

function uniqueText(values, max = 12) {
    return [...new Set((values || []).map((value) => text(value, 160)).filter(Boolean))]
        .slice(0, max);
}

function sectionOf(profile, key) {
    const raw = profile?.narrativeSections?.[key];
    const value = typeof raw === 'string' ? raw : raw?.text;
    const sectionText = text(value);
    if (!sectionText) return null;
    return Object.freeze({
        key,
        title: text(raw?.title, 80) || SECTION_LABELS[key] || key,
        text: sectionText,
        source: ['confirmed', 'designed_seed', 'hypothesis'].includes(text(raw?.source, 40))
            ? text(raw.source, 40) : '',
    });
}

function physiologyOf(profile, enabled) {
    if (!enabled) return null;
    const narrative = sectionOf(profile, 'physiology');
    if (narrative && !/^不适用(?:$|[：:])/u.test(narrative.text)) return narrative;
    const module = profile?.modules?.physiology;
    const body = module?.data;
    const value = body && typeof body === 'object'
        ? Object.values(body).map((entry) => text(entry, 800)).filter(Boolean).join('；')
        : text(body, 1600);
    if (!value || /^不适用(?:$|[：:])/u.test(value)) return null;
    return Object.freeze({
        key: 'physiology', title: SECTION_LABELS.physiology, text: value,
        source: ['confirmed', 'designed_seed', 'hypothesis'].includes(text(module?.source, 40))
            ? text(module.source, 40) : '',
    });
}

function exactSourceMatches(sourceRef, currentTarget) {
    if (!sourceRef || !currentTarget) return false;
    const pairs = [
        ['chatId', 'chatId'], ['messageId', 'messageId'], ['generationId', 'generationId'],
        ['generationSerial', 'generationSerial'], ['generationType', 'generationType'],
        ['scopeDigest', 'scopeDigest'], ['contentFingerprint', 'contentFingerprint'],
    ];
    return pairs.every(([left, right]) => String(sourceRef[left] ?? '') === String(currentTarget[right] ?? ''));
}

function legacyVerified(actor) {
    const profile = actor?.profileV6;
    return Boolean(profile?.profileFormat === 'narrative-v1' && (
        profile?.baselineCommit?.readbackVerified === true
        || profile?.本地元数据?.readbackVerified === true
    ));
}

function aliasesFor(actor, profile, name) {
    return uniqueText([
        ...(actor?.aliases || []),
        ...(actor?.identity?.aliases || []),
        ...(profile?.actorRef?.aliases || []),
        ...(profile?.姓名与别名?.别名 || []),
    ]).filter((alias) => alias !== name && !isActorId(alias));
}

function profileRefReady(actor, profile) {
    const ref = actor?.profileRef;
    if (!ref || ref.readbackVerified !== true || ref.status !== 'ready') return false;
    const digest = actorProfileMvuDigest(profile);
    return Boolean(digest && String(ref.digest || ref.profileDigest || '') === String(digest));
}

function cardStatus({ actor, profile, busy = '', failure = '' }) {
    if (!profile) {
        if (legacyVerified(actor)) {
            return {
                key: busy === 'migrating' ? 'migrating' : failure ? 'migration_failed' : 'legacy',
                color: failure ? 'red' : 'yellow',
                label: busy === 'migrating' ? '迁移中' : failure ? '迁移失败' : '待迁移',
                repairable: false, migratable: true, ready: false,
            };
        }
        return {
            key: busy === 'repairing' ? 'repairing' : 'missing', color: 'red',
            label: busy === 'repairing' ? '修复中（此前缺档）' : '待修复',
            repairable: true, migratable: false, ready: false,
        };
    }
    const readiness = profileReadiness(profile);
    const metaStatus = text(profile?.本地元数据?.status, 40);
    const persistedFailure = metaStatus === 'persist_failed' || Boolean(failure);
    const ready = readiness.ready && profileRefReady(actor, profile) && !persistedFailure;
    if (persistedFailure) return {
        key: 'persist_failed', color: 'red', label: '持久保存失败',
        repairable: true, migratable: false, ready: false,
    };
    if (!readiness.complete) return {
        key: 'incomplete', color: 'red', label: '档案不完整',
        repairable: true, migratable: false, ready: false,
    };
    if (!ready) return {
        key: busy === 'repairing' ? 'repairing' : 'pending_readback', color: 'yellow',
        label: busy === 'repairing' ? '正在重新核验' : '等待持久回读',
        repairable: true, migratable: false, ready: false,
    };
    return {
        key: 'ready', color: 'green', label: '已完整保存',
        repairable: false, migratable: false, ready: true,
    };
}

export function createActorProfileSurfaceView({
    profiles = {},
    actors = [],
    currentTarget = null,
    completionMode = 'full',
    busyByActorId = {},
    failureByActorId = {},
    diagnostic = null,
    readError = '',
} = {}) {
    const actorMap = new Map((actors || []).map((actor) => [String(actor?.id || ''), actor]));
    const ids = readError ? [] : [...new Set([
        ...Object.keys(profiles || {}),
        ...actorMap.keys(),
    ].filter(Boolean))];
    const cards = ids.map((actorId) => {
        const actor = actorMap.get(actorId) || null;
        const profile = profiles?.[actorId] || null;
        const rawName = text(
            profile?.姓名与别名?.姓名 || profile?.actorRef?.name || actor?.name || '未命名人物',
            160,
        );
        const name = isActorId(rawName) ? '未命名人物' : rawName;
        const status = cardStatus({
            actor, profile,
            busy: text(busyByActorId?.[actorId], 40),
            failure: text(failureByActorId?.[actorId], 120),
        });
        const sourceRef = profile?.本地元数据?.sourceRef;
        const changedThisTurn = profile && exactSourceMatches(sourceRef, currentTarget);
        const revision = Number(profile?.本地元数据?.revision || 0);
        const changeLabel = changedThisTurn ? (revision <= 1 ? '本回合新增' : '本回合更新') : '';
        const sections = Object.fromEntries(Object.keys(SECTION_LABELS)
            .filter((key) => key !== 'physiology')
            .map((key) => [key, sectionOf(profile, key)]));
        const physiology = physiologyOf(profile, completionMode === 'full_adult');
        return Object.freeze({
            actorId, name,
            aliases: aliasesFor(actor, profile, name),
            status: Object.freeze(status),
            changeLabel,
            groups: ACTOR_PROFILE_SURFACE_GROUPS.map((group) => Object.freeze({
                key: group.key, title: group.title,
                sections: group.sectionKeys.map((key) => sections[key]).filter(Boolean),
            })),
            physiology,
            missingSectionCount: Object.values(sections).filter((section) => !section).length,
            sourceLegal: Object.values(sections).filter(Boolean).every((section) => Boolean(section.source)),
            legacyOnly: !profile && legacyVerified(actor),
        });
    }).sort((left, right) => {
        const rank = { red: 0, yellow: 1, green: 2 };
        return (rank[left.status.color] ?? 3) - (rank[right.status.color] ?? 3)
            || left.name.localeCompare(right.name, 'zh-CN');
    });
    const added = cards.filter((card) => card.changeLabel === '本回合新增').length;
    const updated = cards.filter((card) => card.changeLabel === '本回合更新').length;
    const ready = cards.filter((card) => card.status.ready).length;
    const failed = cards.filter((card) => card.status.color === 'red').length;
    const pending = cards.filter((card) => card.status.color === 'yellow').length;
    const diagnosticStatus = text(diagnostic?.status, 40);
    const batchFailure = !readError && (
        diagnostic?.canRetry === true
        || ['not_completed', 'failed'].includes(diagnosticStatus)
    );
    const needsAction = failed + pending;
    const summary = readError
        ? '人物档案读取失败；未用数据库或其他来源填充，请稍后刷新。'
        : cards.length
        ? `本回合新增 ${added} 人、更新 ${updated} 人、失败 ${failed} 人；${ready}/${cards.length} 人已完整保存。${needsAction ? `有 ${needsAction} 人需要修复或迁移。` : batchFailure ? '另有未绑定的档案处理失败，请使用医生修复中心。' : '当前无需操作。'}`
        : batchFailure
        ? '本回合人物档案未完成，尚未保存可安全绑定的人物卡；请使用医生修复中心处理。'
        : '当前聊天还没有 MVU 人物档案。新人物完成持久回读后会出现在这里。';
    return Object.freeze({
        cards: Object.freeze(cards),
        counts: Object.freeze({
            total: cards.length, added, updated, ready, failed, pending,
            unboundFailed: batchFailure ? 1 : 0,
        }),
        summary,
        batchFailure,
        readError: text(readError, 120),
    });
}

function element(document, tag, className = '', value = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
}

function renderSectionGroup(document, group) {
    const details = element(document, 'details', 'mvuad-mvu-profile-group');
    const summary = element(document, 'summary', '', `${group.title}（${group.sections.length}）`);
    const body = element(document, 'div', 'mvuad-mvu-profile-group-body');
    for (const section of group.sections) {
        const row = element(document, 'section', 'mvuad-mvu-profile-section');
        row.append(
            element(document, 'h4', '', section.title),
            element(document, 'p', '', section.text),
        );
        body.appendChild(row);
    }
    details.append(summary, body);
    return details;
}

export function collapseActorProfileAccordion(host, onExpanded = null) {
    for (const card of host?.querySelectorAll?.('.mvuad-mvu-profile-card') || []) card.open = false;
    if (typeof onExpanded === 'function') onExpanded('');
}

export function renderActorProfileAccordion(document, host, view, {
    expandedActorId = '',
    onExpanded = null,
    onRepair = null,
    onMigrate = null,
} = {}) {
    host.replaceChildren();
    const rendered = [];
    let currentExpanded = expandedActorId;
    for (const card of view?.cards || []) {
        const root = element(document, 'details', 'mvuad-mvu-profile-card');
        root.dataset.healthColor = card.status.color;
        root.dataset.profileStatus = card.status.key;
        root.open = Boolean(expandedActorId && card.actorId === expandedActorId);
        root.__mvuadActorId = card.actorId;

        const summary = element(document, 'summary', 'mvuad-mvu-profile-row');
        summary.setAttribute('aria-label', `展开${card.name}人物档案`);
        const identity = element(document, 'span', 'mvuad-mvu-profile-identity');
        identity.appendChild(element(document, 'b', '', card.name));
        if (card.aliases.length) {
            identity.appendChild(element(document, 'small', '', `别名：${card.aliases.join('、')}`));
        }
        const badges = element(document, 'span', 'mvuad-mvu-profile-badges');
        const state = element(document, 'span', 'mvuad-mvu-profile-state', card.status.label);
        state.dataset.healthColor = card.status.color;
        badges.appendChild(state);
        if (card.changeLabel) badges.appendChild(element(document, 'span', 'mvuad-mvu-profile-change', card.changeLabel));
        summary.append(identity, badges);

        const body = element(document, 'div', 'mvuad-mvu-profile-body');
        if (card.legacyOnly) {
            body.appendChild(element(
                document, 'p', 'mvuad-mvu-profile-note',
                '这是旧 profileV6 只读备份；迁移并完成 MVU 回读前不作为当前档案权威。',
            ));
        } else {
            for (const group of card.groups) body.appendChild(renderSectionGroup(document, group));
            if (card.physiology) body.appendChild(renderSectionGroup(document, {
                key: 'physiology', title: '生理档案', sections: [card.physiology],
            }));
        }

        const actions = element(document, 'div', 'mvuad-mvu-profile-actions');
        if (card.status.repairable) {
            const repair = element(document, 'button', 'menu_button mvuad-mvu-profile-repair', '修复此人物');
            repair.type = 'button';
            repair.setAttribute('aria-label', `修复${card.name}的人物档案`);
            repair.addEventListener('click', () => onRepair?.(card.actorId));
            actions.appendChild(repair);
        }
        if (card.status.migratable) {
            const migrate = element(document, 'button', 'menu_button mvuad-mvu-profile-migrate', '迁移到 MVU');
            migrate.type = 'button';
            migrate.setAttribute('aria-label', `迁移${card.name}的旧人物档案到MVU`);
            migrate.addEventListener('click', () => onMigrate?.(card.actorId));
            actions.appendChild(migrate);
        }
        if (actions.children?.length || actions.childNodes?.length) body.appendChild(actions);

        const diagnostic = element(document, 'details', 'mvuad-mvu-profile-diagnostic');
        diagnostic.append(
            element(document, 'summary', '', '技术诊断（脱敏）'),
            element(document, 'p', '', [
                `档案状态：${card.status.label}`,
                `缺少必需段落：${card.missingSectionCount}`,
                `段落来源标记：${card.sourceLegal ? '合法' : '待修复'}`,
            ].join('；')),
        );
        body.appendChild(diagnostic);
        root.append(summary, body);
        root.addEventListener('toggle', () => {
            if (root.open) {
                for (const peer of host.querySelectorAll('.mvuad-mvu-profile-card')) {
                    if (peer !== root) peer.open = false;
                }
                currentExpanded = card.actorId;
                onExpanded?.(card.actorId);
            } else if (currentExpanded === card.actorId) {
                currentExpanded = '';
                onExpanded?.('');
            }
        });
        host.appendChild(root);
        rendered.push(root);
    }
    return Object.freeze({ cards: Object.freeze(rendered) });
}

export function actorProfileSurfaceRuntimeFingerprint(mutationProbe = '') {
    return `actor-profile-surface:${fingerprint(JSON.stringify({
        groups: ACTOR_PROFILE_SURFACE_GROUPS,
        labels: SECTION_LABELS,
        projection: createActorProfileSurfaceView.toString(),
        render: renderActorProfileAccordion.toString(),
        collapse: collapseActorProfileAccordion.toString(),
        mutationProbe: String(mutationProbe || ''),
    }))}`;
}
