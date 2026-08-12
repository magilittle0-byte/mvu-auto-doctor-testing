import {
    hashCanonical,
} from '../transaction/canonical.mjs';

const DUAL_SURFACE_VISIBILITY = Object.freeze([
    'immersive',
    'audit',
    'debug',
]);

function shortHash(value) {
    try {
        return hashCanonical(value).slice(0, 16);
    } catch {
        return 'unavailable';
    }
}

export function coarseUserAgent(value) {
    const source = String(value || '');
    const platform = /Android/iu.test(source)
        ? 'Android'
        : /iPhone|iPad|iPod/iu.test(source)
            ? 'iOS'
            : /Windows/iu.test(source)
                ? 'Windows'
                : /Macintosh|Mac OS X/iu.test(source)
                    ? 'macOS'
                    : /Linux/iu.test(source)
                        ? 'Linux'
                        : 'Other';
    const candidates = [
        ['Chromium', /(?:Chrome|Chromium|CriOS)\/(\d+)/iu],
        ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/iu],
        ['WebKit', /AppleWebKit\/(\d+)/iu],
    ];
    for (const [kernel, pattern] of candidates) {
        const match = source.match(pattern);
        if (match) {
            return {
                platform,
                kernel,
                kernelMajor: Number(match[1]) || 0,
            };
        }
    }
    return { platform, kernel: 'Other', kernelMajor: 0 };
}

const DOCTOR_HEALTH_COLORS = Object.freeze(['green', 'blue', 'yellow', 'orange', 'red']);
const DOCTOR_HEALTH_RANK = Object.freeze({
    green: 0,
    blue: 1,
    yellow: 2,
    orange: 3,
    red: 4,
});

function nonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function cleanRuntimeCode(value, fallback = '') {
    const text = String(value || '');
    return /^[a-z0-9_.:-]{1,160}$/iu.test(text) ? text : fallback;
}

function runtimeIdentity(value) {
    return String(value || '').trim().slice(0, 180);
}

function incompleteSovereigntyTask(task) {
    if (!task || typeof task !== 'object') return false;
    if (task.status === 'committed') return false;
    if (task.status !== 'cancelled_stale') return true;
    return !(
        task.metadata?.cancelReason === 'latest_state_superseded'
        && runtimeIdentity(task.metadata?.supersededByTaskId)
    );
}

function routeChannelPresentation(entries, now) {
    const slots = (Array.isArray(entries) ? entries : []).map((entry, slotIndex) => {
        const failureKind = cleanRuntimeCode(entry?.lastFailureKind);
        const validationOnly = failureKind === 'validation-error';
        const consecutiveFailures = validationOnly
            ? 0
            : nonNegativeInteger(entry?.consecutiveFailures);
        const openedUntil = validationOnly ? 0 : nonNegativeInteger(entry?.openedUntil);
        const semanticPoison = failureKind === 'parse-error';
        const status = openedUntil > now
            ? semanticPoison ? 'poisoned' : 'isolated'
            : consecutiveFailures > 0
                ? 'degraded'
                : nonNegativeInteger(entry?.lastSuccessAt) > 0
                    ? 'healthy'
                    : 'unused';
        return {
            slotIndex: nonNegativeInteger(entry?.slotIndex ?? slotIndex),
            status,
            failureKind,
            consecutiveFailures,
            cooldownRemainingMs: Math.max(0, openedUntil - now),
        };
    });
    const count = (status) => slots.filter((slot) => slot.status === status).length;
    return {
        total: slots.length,
        healthy: count('healthy'),
        unused: count('unused'),
        degraded: count('degraded'),
        isolated: count('isolated'),
        poisoned: count('poisoned'),
        slots,
    };
}

/**
 * Build the one privacy-safe runtime projection consumed by the settings card,
 * floating panel/orb, public API and exported diagnostics. It intentionally
 * contains counts and controlled codes only: no actor names, prompts, route
 * endpoints, credentials or narrative payloads.
 */
export function createDoctorRuntimePresentation({
    sovereignty = {},
    runtime = {},
    actorLedger = {},
    profileReadiness = {},
    actorShards = {},
    continuity = {},
    worldPressure = {},
    routeHealth = {},
    statusKinds = {},
    backgroundActive = false,
    profileCanRetry = false,
    dueTaskCount = 0,
    currentTurn = 0,
    now = Date.now(),
} = {}) {
    const normalizedNow = nonNegativeInteger(now);
    const observedThrough = nonNegativeInteger(sovereignty?.observedThrough?.turn);
    const simulatedThrough = nonNegativeInteger(sovereignty?.simulatedThrough?.turn);
    const backlog = nonNegativeInteger(sovereignty?.backlog);
    const pending = nonNegativeInteger(sovereignty?.pending);
    const running = nonNegativeInteger(sovereignty?.running);
    const retryableFailed = nonNegativeInteger(sovereignty?.retryableFailed);
    const deferred = nonNegativeInteger(sovereignty?.deferred);
    const cancelledIncomplete = nonNegativeInteger(sovereignty?.cancelledIncomplete);
    const identityPollution = nonNegativeInteger(sovereignty?.identityPollution);
    const identityQuarantine = nonNegativeInteger(sovereignty?.identityQuarantine);
    const profileActorCount = nonNegativeInteger(
        profileReadiness?.actorCount ?? sovereignty?.profileActorCount,
    );
    const profilesReady = nonNegativeInteger(profileReadiness?.ready);
    const profilesIncomplete = nonNegativeInteger(
        profileReadiness?.incomplete ?? sovereignty?.profilesIncomplete,
    );
    const profilesOptionalPending = nonNegativeInteger(
        profileReadiness?.optionalPending ?? sovereignty?.profilesOptionalPending,
    );
    const failingModules = [...new Set(
        (Array.isArray(sovereignty?.failingModules) ? sovereignty.failingModules : [])
            .map((module) => cleanRuntimeCode(module))
            .filter(Boolean),
    )].slice(0, 8);
    const lastFailureCodes = [...new Set(
        (Array.isArray(sovereignty?.lastFailureCodes) ? sovereignty.lastFailureCodes : [])
            .map((code) => cleanRuntimeCode(code))
            .filter(Boolean),
    )].slice(0, 8);

    const runtimeTasks = (Array.isArray(runtime?.backlog) ? runtime.backlog : [])
        .filter(incompleteSovereigntyTask);
    const actorTasks = runtimeTasks.filter((task) => (
        task?.module === 'actor' && runtimeIdentity(task?.metadata?.actorId)
    ));
    const actorTaskStatus = (status) => actorTasks.filter((task) => task.status === status).length;
    const actorTaskActors = new Set(actorTasks.map((task) => task.metadata.actorId));

    const actorReceipts = Array.isArray(actorLedger?.actionReceipts)
        ? actorLedger.actionReceipts
        : [];
    const attemptedActionIds = new Set(actorReceipts
        .filter((receipt) => receipt?.stage === 'attempted')
        .map((receipt) => runtimeIdentity(receipt?.actionId))
        .filter(Boolean));
    const worldSettledActionIds = new Set(actorReceipts
        .filter((receipt) => receipt?.stage === 'world_settled')
        .map((receipt) => runtimeIdentity(receipt?.actionId))
        .filter(Boolean));
    const pendingWorldActionCount = [...attemptedActionIds]
        .filter((actionId) => !worldSettledActionIds.has(actionId)).length;
    const actionJournalOverCapacity = actorLedger?.actionAttemptBacklog?.status
        === 'pending_over_capacity'
        ? nonNegativeInteger(actorLedger?.actionAttemptBacklog?.pendingCount)
        : 0;

    const receiptQueue = Array.isArray(continuity?.queue) ? continuity.queue : [];
    const receiptBatches = Array.isArray(continuity?.batches) ? continuity.batches : [];
    const turn = nonNegativeInteger(currentTurn);
    const receiptStatusCount = (status) => receiptQueue
        .filter((receipt) => receipt?.status === status).length;
    const waitingReceipts = receiptQueue.filter((receipt) => (
        ['injected', 'landed', 'missing', 'retained'].includes(receipt?.status)
    ));
    const stalledReceipts = waitingReceipts.filter((receipt) => (
        receipt?.status === 'missing'
        || (
            nonNegativeInteger(receipt?.expiresTurn) > 0
            && nonNegativeInteger(receipt.expiresTurn) <= turn
        )
    ));
    const latestReceiptByThread = new Map();
    for (const receipt of receiptQueue) {
        const threadId = runtimeIdentity(receipt?.threadId);
        if (!threadId) continue;
        const previous = latestReceiptByThread.get(threadId);
        if (!previous || nonNegativeInteger(previous?.injectedAt) <= nonNegativeInteger(receipt?.injectedAt)) {
            latestReceiptByThread.set(threadId, receipt);
        }
    }
    const cooldownThreads = [...latestReceiptByThread.values()].filter((receipt) => {
        const targetTurn = nonNegativeInteger(receipt?.targetTurn);
        const cooldownTurns = receipt?.status === 'consumed' ? 2 : 1;
        return targetTurn > 0 && turn <= targetTurn + cooldownTurns;
    }).length;
    const waitingThreadIds = waitingReceipts
        .map((receipt) => runtimeIdentity(receipt?.threadId))
        .filter(Boolean);
    const duplicateWaitingReceipts = Math.max(
        0,
        waitingThreadIds.length - new Set(waitingThreadIds).size,
    );

    const pressureReceipts = Array.isArray(worldPressure?.receipts)
        ? worldPressure.receipts
        : [];
    const pressureDecisionCount = (decision) => pressureReceipts
        .filter((receipt) => receipt?.decision === decision).length;
    const routeChannels = {
        strict: routeChannelPresentation(routeHealth?.strict, normalizedNow),
        fast: routeChannelPresentation(routeHealth?.fast, normalizedNow),
    };
    const routePoisoned = routeChannels.strict.poisoned + routeChannels.fast.poisoned;
    const routeIsolated = routeChannels.strict.isolated + routeChannels.fast.isolated;
    const routeDegraded = routeChannels.strict.degraded + routeChannels.fast.degraded;
    const surfaceKinds = Object.values(statusKinds || {}).map((value) => String(value || ''));
    const surfaceErrorCount = surfaceKinds.filter((kind) => kind === 'error').length;
    const surfaceWarningCount = surfaceKinds.filter((kind) => kind === 'warn').length;

    const alerts = [];
    const addAlert = (code, color, count = 0) => {
        const normalizedCount = nonNegativeInteger(count);
        if (!normalizedCount) return;
        alerts.push({ code, color, count: normalizedCount });
    };
    addAlert('identity.pollution', 'red', identityPollution);
    addAlert('sovereignty.failed_before_success', 'red', (
        sovereignty?.color === 'red' ? 1 : 0
    ));
    addAlert('surface.status_error', 'red', surfaceErrorCount);
    addAlert('surface.status_warning', 'yellow', surfaceWarningCount);
    addAlert('sovereignty.retryable_failed', 'red', retryableFailed);
    addAlert('sovereignty.deferred', 'orange', deferred);
    addAlert('continuity.stalled', 'orange', stalledReceipts.length);
    addAlert('actor_scheduling.failed', 'orange', actorShards?.failed);
    addAlert('routes.poisoned', 'orange', routePoisoned);
    addAlert('pressure.over_cap', 'orange', worldPressure?.external?.overCap === true ? 1 : 0);
    addAlert('identity.quarantine', 'red', identityQuarantine);
    addAlert('profiles.incomplete', 'yellow', profilesIncomplete);
    addAlert('profiles.optional_pending', 'yellow', profilesOptionalPending);
    addAlert('sovereignty.cancelled_incomplete', 'red', cancelledIncomplete);
    addAlert('sovereignty.backlog', 'yellow', backlog);
    addAlert('actor_tasks.pending_world_adjudication', 'yellow', pendingWorldActionCount);
    addAlert('actor_tasks.journal_over_capacity', 'red', actionJournalOverCapacity);
    addAlert('continuity.waiting_ack', 'yellow', waitingReceipts.length);
    addAlert('continuity.duplicate_waiting', 'yellow', duplicateWaitingReceipts);
    addAlert('routes.isolated', 'yellow', routeIsolated);
    addAlert('routes.degraded', 'yellow', routeDegraded);
    addAlert('pressure.recovery_debt', 'yellow', worldPressure?.recoveryDebt);

    const baseColor = DOCTOR_HEALTH_COLORS.includes(sovereignty?.color)
        ? sovereignty.color
        : 'green';
    let color = baseColor;
    if (
        (backgroundActive || running > 0)
        && DOCTOR_HEALTH_RANK[color] < DOCTOR_HEALTH_RANK.blue
    ) {
        color = 'blue';
    }
    for (const alert of alerts) {
        if (DOCTOR_HEALTH_RANK[alert.color] > DOCTOR_HEALTH_RANK[color]) {
            color = alert.color;
        }
    }
    const label = {
        green: '绿色·正常',
        blue: '蓝色·处理中',
        yellow: '黄色·有待办',
        orange: '橙色·等待恢复',
        red: '红色·尚未成功',
    }[color];

    return {
        version: 1,
        color,
        label,
        kind: color === 'green' ? 'ok' : color === 'blue' ? 'busy' : color === 'red' ? 'error' : 'warn',
        cursors: {
            observedThrough,
            simulatedThrough,
            lag: Math.max(0, observedThrough - simulatedThrough),
        },
        work: {
            backlog,
            pending,
            running,
            retryableFailed,
            deferred,
            cancelledIncomplete,
            dueTaskCount: nonNegativeInteger(dueTaskCount),
            backgroundActive: backgroundActive === true || running > 0,
            failingModules,
            lastFailureCodes,
        },
        identity: {
            pollution: identityPollution,
            quarantine: identityQuarantine,
        },
        profiles: {
            actorCount: profileActorCount,
            ready: profilesReady,
            incomplete: profilesIncomplete,
            optionalPending: profilesOptionalPending,
        },
        actorTasks: {
            actorCount: actorTaskActors.size,
            total: actorTasks.length,
            pending: actorTaskStatus('pending'),
            running: actorTaskStatus('running'),
            retryableFailed: actorTaskStatus('retryable_failed'),
            deferred: actorTaskStatus('deferred'),
            cancelledIncomplete: actorTaskStatus('cancelled_stale'),
        },
        adjudication: {
            attempted: attemptedActionIds.size,
            worldSettled: worldSettledActionIds.size,
            pendingWorld: pendingWorldActionCount,
            rejected: actorReceipts.filter((receipt) => (
                receipt?.stage === 'world_settled' && receipt?.status === 'rejected'
            )).length,
            consumed: actorReceipts.filter((receipt) => (
                receipt?.stage === 'response_settled' && receipt?.status === 'consumed'
            )).length,
            retained: actorReceipts.filter((receipt) => (
                receipt?.stage === 'response_settled' && receipt?.status === 'retained'
            )).length,
        },
        continuity: {
            receiptCount: receiptQueue.length,
            acknowledged: receiptStatusCount('consumed'),
            retained: receiptStatusCount('retained'),
            waiting: waitingReceipts.length,
            stalled: stalledReceipts.length,
            cooldownThreads,
            duplicateWaitingReceipts,
            narrativeAcknowledgedBatches: receiptBatches.filter((batch) => (
                batch?.status === 'narrative_acknowledged'
            )).length,
            retainedBatches: receiptBatches.filter((batch) => (
                batch?.status === 'retained'
            )).length,
        },
        pressure: {
            phase: cleanRuntimeCode(worldPressure?.phase, 'opening'),
            doctorPressure: nonNegativeInteger(worldPressure?.doctorPressure),
            externalPressure: nonNegativeInteger(worldPressure?.external?.pressureEstimate),
            recoveryDebt: nonNegativeInteger(worldPressure?.recoveryDebt),
            overCap: worldPressure?.external?.overCap === true,
            admitted: pressureDecisionCount('admitted'),
            delayed: pressureDecisionCount('delayed'),
            retained: pressureDecisionCount('retained'),
        },
        routes: {
            switchCount: nonNegativeInteger(routeHealth?.switchCount),
            strict: routeChannels.strict,
            fast: routeChannels.fast,
        },
        controls: {
            canCancel: backgroundActive === true || running > 0,
            canRetry: profileCanRetry === true
                || retryableFailed + deferred + cancelledIncomplete > 0,
            canRestore: nonNegativeInteger(sovereignty?.checkpointCount) > 0,
        },
        alerts,
    };
}

export function createPrivacySafeDiagnosticProjection({
    userAgent = '',
    plugin = {},
    environment = {},
    chat = {},
    statuses = {},
    socialAudit = null,
    prompt = null,
    modelDiagnostics = [],
    barrierProtocol = {},
    actorShards = {},
    userPrompts = {},
    sovereignty = {},
    runtimePresentation = {},
    customInstruction = {},
} = {}) {
    const statusKinds = Object.fromEntries(
        Object.entries(statuses).map(([key, value]) => [
            key,
            key === 'profile' ? {
                kind: String(value?.kind || ''),
                status: cleanRuntimeCode(value?.status, 'waiting'),
                failingModules: (value?.failingModules || []).map(cleanRuntimeCode).filter(Boolean).slice(0, 8),
                lastFailureCodes: (value?.lastFailureCodes || []).map(cleanRuntimeCode).filter(Boolean).slice(0, 8),
                canRetry: value?.canRetry === true,
            } : { kind: String(value?.kind || '') },
        ]),
    );
    return {
        schemaVersion: 2,
        plugin: {
            id: String(plugin?.id || ''),
            version: String(plugin?.version || ''),
        },
        environment: {
            userAgent: coarseUserAgent(userAgent),
            status: String(environment?.status || 'unknown'),
            checkCounts: {
                ok: (environment?.checks || []).filter((item) => item?.kind === 'ok').length,
                warn: (environment?.checks || []).filter((item) => item?.kind === 'warn').length,
                error: (environment?.checks || []).filter((item) => item?.kind === 'error').length,
                info: (environment?.checks || []).filter((item) => item?.kind === 'info').length,
            },
            barrierProtocol: {
                required: barrierProtocol?.required === true,
                externalDatabaseDetected:
                    barrierProtocol?.externalDatabaseDetected === true,
                registered: barrierProtocol?.registered === true,
                clientCount: Math.max(0, Number(barrierProtocol?.clientCount) || 0),
                errorCode: String(barrierProtocol?.errorCode || ''),
                mode: String(barrierProtocol?.mode || 'not-detected'),
                externalWriteConsistency: String(
                    barrierProtocol?.externalWriteConsistency || 'unknown',
                ),
            },
        },
        currentChat: {
            present: chat?.present === true,
            messageCount: Math.max(0, Number(chat?.messageCount) || 0),
            repairJournalCount: Math.max(0, Number(chat?.repairJournalCount) || 0),
            socialAuditCount: Math.max(0, Number(chat?.socialAuditCount) || 0),
            serendipity: {
                receiptCount: Math.max(0, Number(chat?.serendipity?.receiptCount) || 0),
                triggeredCount: Math.max(0, Number(chat?.serendipity?.triggeredCount) || 0),
            },
            continuity: {
                activeCount: Math.max(0, Number(chat?.continuity?.activeCount) || 0),
                resolvedCount: Math.max(0, Number(chat?.continuity?.resolvedCount) || 0),
                worldLanes: {
                    turn: Math.max(
                        0,
                        Number(chat?.continuity?.worldLanes?.turn) || 0,
                    ),
                    maxLanes: Math.min(
                        4,
                        Math.max(
                            0,
                            Number(chat?.continuity?.worldLanes?.maxLanes) || 0,
                        ),
                    ),
                    selected: (
                        Array.isArray(chat?.continuity?.worldLanes?.selected)
                            ? chat.continuity.worldLanes.selected
                            : []
                    ).slice(0, 4).map((item) => ({
                        laneType: String(item?.laneType || ''),
                        due: item?.due === true,
                        independentOfActors: item?.independentOfActors === true,
                    })),
                },
            },
            actors: {
                actorCount: Math.max(0, Number(chat?.actors?.actorCount) || 0),
                activeCount: Math.max(0, Number(chat?.actors?.activeCount) || 0),
                dormantCount: Math.max(0, Number(chat?.actors?.dormantCount) || 0),
                receiptCount: Math.max(0, Number(chat?.actors?.receiptCount) || 0),
                semanticProgressCount: Math.max(
                    0,
                    Number(chat?.actors?.semanticProgressCount) || 0,
                ),
                maxSemanticSilence: Math.max(
                    0,
                    Number(chat?.actors?.maxSemanticSilence) || 0,
                ),
                stalledDueCount: Math.max(
                    0,
                    Number(chat?.actors?.stalledDueCount) || 0,
                ),
                consecutiveFailureCount: Math.max(
                    0,
                    Number(chat?.actors?.consecutiveFailureCount) || 0,
                ),
                privateThoughtsExposed: false,
            },
            forum: {
                postCount: Math.max(0, Number(chat?.forum?.postCount) || 0),
                totalComments: Math.max(0, Number(chat?.forum?.totalComments) || 0),
            },
            modelCalls: cloneModelCallStats(chat?.modelCalls),
        },
        actorScheduling: {
            status: String(actorShards?.status || 'disabled'),
            selected: Math.max(0, Number(actorShards?.selected) || 0),
            completed: Math.max(0, Number(actorShards?.completed) || 0),
            succeeded: Math.max(0, Number(actorShards?.succeeded) || 0),
            failed: Math.max(0, Number(actorShards?.failed) || 0),
            semanticActions: Math.max(0, Number(actorShards?.semanticActions) || 0),
            heldActions: Math.max(0, Number(actorShards?.heldActions) || 0),
            scheduledWithoutSemanticAction: Math.max(
                0,
                Number(actorShards?.scheduledWithoutSemanticAction) || 0,
            ),
            advanceFailureCodes: [
                ...new Set(
                    (Array.isArray(actorShards?.failureCodes)
                        ? actorShards.failureCodes
                        : [])
                        .map((value) => String(value || ''))
                        .map((value) => value.replace(/^actor_shard\./u, 'actor_scheduling.'))
                        .filter((value) => /^actor_scheduling\.[a-z0-9_.-]+$/u.test(value)),
                ),
            ].slice(0, 8),
        },
        // Deprecated read-only alias for older diagnostic consumers.
        actorShards: { deprecated: true },
        sovereignty: {
            color: String(sovereignty?.color || ''),
            mode: String(sovereignty?.mode || ''),
            observedThrough: Math.max(0, Number(sovereignty?.observedThrough?.turn) || 0),
            simulatedThrough: Math.max(0, Number(sovereignty?.simulatedThrough?.turn) || 0),
            lastSuccessTurn: Math.max(0, Number(sovereignty?.lastSuccessTurn) || 0),
            backlog: Math.max(0, Number(sovereignty?.backlog) || 0),
            pending: Math.max(0, Number(sovereignty?.pending) || 0),
            running: Math.max(0, Number(sovereignty?.running) || 0),
            retryableFailed: Math.max(0, Number(sovereignty?.retryableFailed) || 0),
            deferred: Math.max(0, Number(sovereignty?.deferred) || 0),
            cancelledIncomplete: Math.max(
                0,
                Number(sovereignty?.cancelledIncomplete) || 0,
            ),
            lag: Math.max(0, Number(sovereignty?.lag) || 0),
            failingModules: (Array.isArray(sovereignty?.failingModules)
                ? sovereignty.failingModules
                : []).map((value) => String(value || '')).slice(0, 12),
            nextRetryTurn: Math.max(0, Number(sovereignty?.nextRetryTurn) || 0),
            autoRetryScheduled: sovereignty?.autoRetryScheduled === true,
            autoRetryAt: Math.max(0, Number(sovereignty?.autoRetryAt) || 0),
            checkpointCount: Math.max(0, Number(sovereignty?.checkpointCount) || 0),
            checkpointBytes: Math.max(0, Number(sovereignty?.checkpointBytes) || 0),
            checkpointByteBudget: Math.max(
                0,
                Number(sovereignty?.checkpointByteBudget) || 0,
            ),
            moduleLastSuccess: Object.fromEntries(
                Object.entries(sovereignty?.moduleLastSuccess || {})
                    .slice(0, 12)
                    .map(([module, turn]) => [
                        String(module || ''),
                        Math.max(0, Number(turn) || 0),
                    ]),
            ),
            technicalReceiptCount: Math.max(
                0,
                Number(sovereignty?.technicalReceiptCount) || 0,
            ),
        },
        runtimePresentation: createDoctorRuntimePresentation(runtimePresentation),
        customInstruction: {
            enabled: customInstruction?.enabled === true,
            scopes: (Array.isArray(customInstruction?.scopes)
                ? customInstruction.scopes
                : []).map((value) => String(value || '')).slice(0, 12),
            length: Math.max(0, Number(customInstruction?.length) || 0),
            hash: String(customInstruction?.hash || ''),
            injectionCount: Math.max(0, Number(customInstruction?.injectionCount) || 0),
            records: (Array.isArray(customInstruction?.records)
                ? customInstruction.records
                : []).map((entry) => ({
                module: String(entry?.module || ''),
                channel: String(entry?.channel || ''),
                injected: entry?.injected === true,
            })).slice(-80),
        },
        userPrompts: Object.fromEntries(
            Object.entries(userPrompts || {}).map(([key, value]) => [
                key,
                {
                    enabled: value?.enabled === true,
                    length: Math.max(0, Number(value?.length) || 0),
                    hash: String(value?.hash || ''),
                },
            ]),
        ),
        latestStatuses: statusKinds,
        latestSocialAudit: socialAudit
            ? {
                createdAt: Math.max(0, Number(socialAudit.createdAt) || 0),
                sourceIndex: Number.isInteger(Number(socialAudit.sourceRef?.index))
                    ? Number(socialAudit.sourceRef.index)
                    : -1,
                mode: String(socialAudit.mode || ''),
                verdict: String(socialAudit.verdict || ''),
                reasonCount: (socialAudit.reasons || []).length,
                findingCount: (socialAudit.findings || []).length,
                decisionCount: (socialAudit.decisions || []).length,
                failureCode: String(socialAudit.modelCall?.failureCode || ''),
                receiptDigest: shortHash(socialAudit.id || ''),
                usage: {
                    inputTokens: Math.max(0, Number(socialAudit.usage?.inputTokens) || 0),
                    outputTokens: Math.max(0, Number(socialAudit.usage?.outputTokens) || 0),
                    cacheHitTokens: Math.max(0, Number(socialAudit.usage?.cacheHitTokens) || 0),
                    cacheMissTokens: Math.max(0, Number(socialAudit.usage?.cacheMissTokens) || 0),
                },
                correction: {
                    status: String(socialAudit.correction?.status || ''),
                    revertedPathCount: (socialAudit.correction?.revertedPaths || []).length,
                },
            }
            : null,
        lastPrompt: prompt
            ? {
                taskDigest: shortHash(prompt.task || ''),
                capturedAt: Math.max(0, Number(prompt.capturedAt) || 0),
                maxTokens: Math.max(0, Number(prompt.maxTokens) || 0),
                totalChars: Math.max(0, Number(prompt.totalChars) || 0),
                segments: (prompt.messages || []).map((message) => ({
                    role: String(message?.role || ''),
                    chars: String(message?.content || '').length,
                })),
            }
            : null,
        modelDiagnostics: (Array.isArray(modelDiagnostics) ? modelDiagnostics : []).map(
            (entry) => ({
                at: Math.max(0, Number(entry?.at) || 0),
                phase: String(entry?.phase || ''),
                taskDigest: shortHash(entry?.task || ''),
                channel: String(entry?.channel || ''),
                status: String(entry?.status || ''),
                durationMs: Math.max(0, Number(entry?.durationMs) || 0),
                queueWaitMs: Math.max(0, Number(entry?.queueWaitMs) || 0),
                outputChars: Math.max(0, Number(entry?.outputChars) || 0),
                httpStatus: Math.max(0, Number(entry?.httpStatus) || 0),
                inputTokens: Math.max(0, Number(entry?.inputTokens) || 0),
                outputTokens: Math.max(0, Number(entry?.outputTokens) || 0),
                cacheHitTokens: Math.max(0, Number(entry?.cacheHitTokens) || 0),
                cacheMissTokens: Math.max(0, Number(entry?.cacheMissTokens) || 0),
                attempt: Math.max(0, Number(entry?.attempt) || 0),
                routeSlotIndex: Math.max(0, Number(entry?.routeSlotIndex) || 0),
                failover: entry?.failover === true,
                targetIndex: Number.isInteger(Number(entry?.targetIndex))
                    ? Number(entry.targetIndex)
                    : -1,
                failureKind: String(entry?.failureKind || ''),
                rootType: String(entry?.rootType || ''),
                tags: structuredClone(entry?.tags || {}),
                recovered: entry?.recovered === true,
            }),
        ),
    };
}

function cloneModelCallStats(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        total: Math.max(0, Number(source.total) || 0),
        succeeded: Math.max(0, Number(source.succeeded) || 0),
        failed: Math.max(0, Number(source.failed) || 0),
        rateLimited: Math.max(0, Number(source.rateLimited) || 0),
        byTask: Object.fromEntries(
            Object.entries(source.byTask || {}).map(([key, count]) => [
                key,
                Math.max(0, Number(count) || 0),
            ]),
        ),
    };
}

export function diagnosticPrivacyCanaryFindings(value, canaries = []) {
    const serialized = JSON.stringify(value ?? {});
    const patterns = [
        /\b(?:sk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/u,
        /Bearer\s+\S+/iu,
        /(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/iu,
        /[A-Za-z]:\\Users\\/u,
        /(?:rawPayload|raw_payload|promptText|fullPrompt|privateNarrative)/iu,
    ];
    return {
        credentialFindings: patterns.slice(0, 3).filter((pattern) => pattern.test(serialized)).length,
        absoluteUserPathFindings: patterns[3].test(serialized) ? 1 : 0,
        rawPayloadFindings: patterns[4].test(serialized) ? 1 : 0,
        privateContentFindings: (Array.isArray(canaries) ? canaries : [])
            .filter((canary) => canary && serialized.includes(String(canary))).length,
    };
}

function redactDiagnosticText(value) {
    return String(value ?? '')
        .replace(/Bearer\s+\S+/giu, '[凭据已隐藏]')
        .replace(/\b(?:sk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu, '[凭据已隐藏]')
        .replace(/(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/giu, '[敏感配置已隐藏]')
        .replace(/[A-Za-z]:\\Users\\[^\\\s]+/giu, '[本机路径已隐藏]')
        .replace(/https?:\/\/[^\s)]+/giu, '[地址已隐藏]')
        .slice(0, 240);
}

function safeIssue(issue) {
    return {
        code: String(issue?.code ?? 'unknown'),
        path: String(issue?.path ?? '$').slice(0, 180),
        severity: ['warning', 'unresolved', 'error'].includes(issue?.severity)
            ? issue.severity
            : 'error',
        message: redactDiagnosticText(issue?.message),
    };
}

function safeEvidence(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const kinds = [...new Set(
        list.map((entry) => redactDiagnosticText(entry?.kind)).filter(Boolean),
    )];
    return {
        count: list.length,
        kinds,
        references: list.map((entry) => ({
            kind: redactDiagnosticText(entry?.kind ?? 'unknown'),
            refDigest: shortHash(entry?.ref),
            branchDigest: shortHash(entry?.branchId),
        })),
    };
}

function safeMigration(entry) {
    return {
        idDigest: shortHash(entry?.id),
        kind: redactDiagnosticText(entry?.kind ?? 'unknown'),
        status: redactDiagnosticText(entry?.status ?? 'pending'),
        visibility: redactDiagnosticText(entry?.visibility ?? 'lazy-not-read'),
        canTransact: entry?.canTransact === true,
        issues: (entry?.issues ?? []).map(safeIssue),
        warningCount: Array.isArray(entry?.warnings) ? entry.warnings.length : 0,
    };
}

function safeTransaction(resolution, visibility) {
    const plan = resolution?.value?.plan?.value;
    const transaction = plan?.transaction;
    if (!transaction) {
        return {
            available: false,
            decision: plan?.decision ?? resolution?.value?.decision ?? 'pending',
            issueCount: resolution?.issues?.length ?? 0,
        };
    }
    return {
        available: true,
        decision: plan.decision,
        kind: transaction.kind,
        status: transaction.status,
        writeCount: Array.isArray(plan.writePlan) ? plan.writePlan.length : 0,
        paths: (plan.writePlan ?? []).map((entry) => String(entry.path)),
        preconditionCount: transaction.preconditions?.length ?? 0,
        ...(visibility === 'debug' ? {
            transactionDigest: shortHash(transaction.id),
            idempotencyKey: transaction.idempotencyKey,
        } : {}),
    };
}

export function createDualSurfaceViewModel(resolution, {
    visibility = 'audit',
    migrations = [],
    rollback = {},
} = {}) {
    const mode = DUAL_SURFACE_VISIBILITY.includes(visibility)
        ? visibility
        : 'audit';
    const value = resolution?.value ?? {};
    const director = value.director;
    const target = value.validatedCommand?.value?.target;
    const evidence = value.validatedCommand?.value?.evidence ?? [];
    const issues = (resolution?.issues ?? []).map(safeIssue);
    const base = {
        mode,
        status: resolution?.status ?? 'unresolved',
        decision: value.decision ?? 'pending',
        action: {
            idDigest: shortHash(value.candidate?.actionId),
            label: redactDiagnosticText(value.candidate?.label),
            commandType: value.candidate?.command?.type ?? '',
            source: value.candidate?.source?.kind ?? '',
        },
        confirmation: {
            required: value.candidate?.confirmation?.required === true,
            confirmed: value.candidate?.confirmation?.confirmed === true,
            digest: value.candidate?.confirmation?.digest ?? '',
        },
        adjudication: {
            decision: director?.decision ?? 'pending',
            validationStatus: director?.validationStatus ?? 'unresolved',
            blockedCount: director?.blockedContributions?.length ?? 0,
            violationCount: director?.violations?.length ?? 0,
            explanationCount: director?.explanation?.length ?? 0,
            ...(mode === 'debug' ? {
                explanationDigests: (director?.explanation ?? []).map(shortHash),
            } : {}),
        },
        transaction: safeTransaction(resolution, mode),
        branch: {
            status: value.validatedCommand?.value?.activeBranch?.status ?? 'unknown',
            branchDigest: shortHash(target?.branchId),
            logicalIndex: Number.isInteger(target?.logicalIndex)
                ? target.logicalIndex
                : null,
            swipeId: Number.isInteger(target?.swipeId) ? target.swipeId : null,
            generation: Number.isInteger(target?.generation) ? target.generation : null,
            ...(mode === 'debug' ? {
                contentHash: target?.contentHash ?? '',
                parentHash: target?.parentHash ?? '',
            } : {}),
        },
        evidence: safeEvidence(evidence),
        migrations: (Array.isArray(migrations) ? migrations : []).map(safeMigration),
        rollback: {
            available: rollback?.available === true,
            status: redactDiagnosticText(rollback?.status ?? 'unknown'),
            pathCount: Number.isInteger(rollback?.pathCount) ? rollback.pathCount : 0,
            recordDigest: shortHash(rollback?.recordId),
        },
        issues: mode === 'immersive'
            ? issues.filter((issue) => issue.severity !== 'warning').slice(0, 3)
            : issues,
    };
    if (mode !== 'debug') {
        base.evidence = {
            count: base.evidence.count,
            kinds: base.evidence.kinds,
        };
    }
    return base;
}

export function diagnosticContainsSensitiveMaterial(view) {
    const text = JSON.stringify(view ?? {});
    return [
        /Bearer\s+\S+/iu,
        /\b(?:sk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/u,
        /(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/iu,
        /[A-Za-z]:\\Users\\/u,
        /完整提示词/u,
        /private prompt/iu,
    ].some((pattern) => pattern.test(text));
}
