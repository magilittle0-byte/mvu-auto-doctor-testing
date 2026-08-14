const VARIABLE_REPAIR_ACTIONS = Object.freeze([
    'variable_audit',
    'opening_resource_sync',
]);

const TERMINAL_SUCCESS = new Set(['applied', 'nochange']);
const SAFE_STATUS = new Set([
    'applied', 'nochange', 'failed', 'busy', 'stale', 'blocked',
    'cancelled', 'disabled', 'duplicate', 'unknown',
]);

function safeCode(value, fallback = '') {
    const code = String(value || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_.:-]{0,159}$/u.test(code) ? code : fallback;
}

function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function safeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return SAFE_STATUS.has(status) ? status : 'unknown';
}

function safeActionResult(actionId, result, durationMs) {
    const rawStatus = String(result?.status || '').trim().toLowerCase();
    let status = actionId === 'opening_resource_sync'
        && ['disabled', 'outside-opening'].includes(rawStatus)
        ? 'nochange'
        : safeStatus(rawStatus);
    let derivedCode = '';
    if (actionId === 'variable_audit' && rawStatus === 'applied') {
        if (result?.readbackVerified !== true) {
            status = 'failed';
            derivedCode = 'variable.repair.readback_unverified';
        } else if (result?.frontendSynced === false) {
            status = 'failed';
            derivedCode = 'variable.repair.frontend_sync_failed';
        }
    }
    const defaultCode = `${actionId}.${status}`;
    return {
        actionId,
        status,
        code: safeCode(
            derivedCode || result?.code || result?.validationCode || result?.failureCode
                || result?.technicalCode || result?.failureKind,
            defaultCode,
        ),
        durationMs: nonNegativeInteger(durationMs),
        attempts: nonNegativeInteger(result?.attempts),
        zeroWrite: result?.zeroWrite === true,
        readbackVerified: result?.readbackVerified === true,
    };
}

export function buildVariableRepairPlan({
    hasTarget = false,
    foregroundActive = false,
    openingResourceEnabled = false,
    targetIndex = -1,
} = {}) {
    if (!hasTarget || !Number.isInteger(Number(targetIndex)) || Number(targetIndex) < 0) {
        return {
            status: 'blocked',
            code: 'variable.repair.target_unavailable',
            targetIndex: -1,
            actions: [],
        };
    }
    if (foregroundActive) {
        return {
            status: 'blocked',
            code: 'variable.repair.foreground_active',
            targetIndex: Number(targetIndex),
            actions: [],
        };
    }
    return {
        status: 'ready',
        code: 'variable.repair.ready',
        targetIndex: Number(targetIndex),
        actions: [
            'variable_audit',
            ...(openingResourceEnabled ? ['opening_resource_sync'] : []),
        ],
    };
}

export async function executeVariableRepairPlan(plan, {
    runAction,
    canContinue = () => true,
    now = () => Date.now(),
} = {}) {
    if (plan?.status !== 'ready' || !Array.isArray(plan?.actions)) {
        return {
            status: 'blocked',
            code: safeCode(plan?.code, 'variable.repair.plan_invalid'),
            targetIndex: Number.isInteger(Number(plan?.targetIndex))
                ? Number(plan.targetIndex) : -1,
            startedAt: 0,
            completedAt: 0,
            durationMs: 0,
            actions: [],
        };
    }
    if (typeof runAction !== 'function') {
        throw new TypeError('runAction adapter is required');
    }
    const startedAt = nonNegativeInteger(now());
    const actions = [];
    for (const actionId of plan.actions) {
        if (!VARIABLE_REPAIR_ACTIONS.includes(actionId)) continue;
        if (!canContinue()) {
            actions.push(safeActionResult(actionId, {
                status: 'cancelled',
                failureCode: 'variable.repair.foreground_preempted',
                zeroWrite: true,
            }, 0));
            break;
        }
        const actionStartedAt = nonNegativeInteger(now());
        let result;
        try {
            result = await runAction(actionId);
        } catch {
            result = {
                status: 'failed',
                failureCode: 'variable.repair.adapter_failed',
                zeroWrite: true,
            };
        }
        const actionCompletedAt = nonNegativeInteger(now());
        const safeResult = safeActionResult(
            actionId,
            result,
            Math.max(0, actionCompletedAt - actionStartedAt),
        );
        actions.push(safeResult);
        if (!TERMINAL_SUCCESS.has(safeResult.status)) break;
    }
    const completedAt = nonNegativeInteger(now());
    const failed = actions.find((entry) => !TERMINAL_SUCCESS.has(entry.status));
    return {
        status: failed ? 'failed' : 'completed',
        code: failed ? failed.code : 'variable.repair.completed',
        targetIndex: Number(plan.targetIndex),
        startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        actions,
    };
}

export function createVariableRepairBugCapsule({
    id = '',
    runtimeFingerprint = '',
    chatScopeDigest = '',
    plan = {},
    outcome = {},
    evidence = {},
} = {}) {
    const actionResults = (Array.isArray(outcome?.actions) ? outcome.actions : [])
        .filter((entry) => VARIABLE_REPAIR_ACTIONS.includes(entry?.actionId))
        .map((entry) => safeActionResult(entry.actionId, entry, entry.durationMs));
    return {
        schemaVersion: 1,
        id: safeCode(id, `variable_bug_${nonNegativeInteger(outcome?.completedAt)}`),
        repairKind: 'doctor-variable-repair-center',
        createdAt: nonNegativeInteger(outcome?.completedAt || outcome?.startedAt),
        status: outcome?.status === 'completed' ? 'repair_completed'
            : outcome?.status === 'blocked' ? 'repair_blocked'
                : 'needs_update',
        module: 'variable',
        runtimeFingerprint: safeCode(runtimeFingerprint),
        chatScopeDigest: safeCode(chatScopeDigest),
        targetIndex: Number.isInteger(Number(plan?.targetIndex))
            ? Number(plan.targetIndex) : -1,
        trigger: 'manual_safe_repair',
        planCode: safeCode(plan?.code, 'variable.repair.plan_unknown'),
        outcomeCode: safeCode(outcome?.code, 'variable.repair.outcome_unknown'),
        durationMs: nonNegativeInteger(outcome?.durationMs),
        actions: actionResults,
        evidence: {
            priorStatusKind: safeCode(evidence?.priorStatusKind),
            modelCallCount: nonNegativeInteger(evidence?.modelCallCount),
            inputChars: nonNegativeInteger(evidence?.inputChars),
            outputChars: nonNegativeInteger(evidence?.outputChars),
            queueWaitMs: nonNegativeInteger(evidence?.queueWaitMs),
            modelMs: nonNegativeInteger(evidence?.modelMs),
            parseMs: nonNegativeInteger(evidence?.parseMs),
            persistMs: nonNegativeInteger(evidence?.persistMs),
            repairJournalPersisted: evidence?.repairJournalPersisted === true,
        },
    };
}

export function compactRepairJournalWithVariableCapsules(journal, {
    maxUndoRecords = 5,
    maxBugCapsules = 25,
} = {}) {
    const source = Array.isArray(journal) ? journal : [];
    const capsules = source.filter(
        (entry) => entry?.repairKind === 'doctor-variable-repair-center',
    ).slice(-Math.max(1, nonNegativeInteger(maxBugCapsules) || 25));
    const operational = source.filter(
        (entry) => entry?.repairKind !== 'doctor-variable-repair-center',
    ).slice(-Math.max(1, nonNegativeInteger(maxUndoRecords) || 5));
    return [...operational, ...capsules].sort(
        (left, right) => nonNegativeInteger(left?.createdAt) - nonNegativeInteger(right?.createdAt),
    );
}

export function variableRepairCapsuleProjection(journal) {
    const capsules = (Array.isArray(journal) ? journal : [])
        .filter((entry) => entry?.repairKind === 'doctor-variable-repair-center');
    const last = capsules.at(-1) || null;
    return {
        capsuleCount: capsules.length,
        lastStatus: safeCode(last?.status),
        lastOutcomeCode: safeCode(last?.outcomeCode),
        lastTargetIndex: Number.isInteger(Number(last?.targetIndex))
            ? Number(last.targetIndex) : -1,
        lastDurationMs: nonNegativeInteger(last?.durationMs),
        lastReadbackVerified: (last?.actions || []).some(
            (entry) => entry?.actionId === 'variable_audit'
                && entry?.readbackVerified === true,
        ),
    };
}

export function variableRepairCenterSemanticFingerprint(overrides = {}) {
    return [
        overrides.buildVariableRepairPlan || buildVariableRepairPlan,
        overrides.executeVariableRepairPlan || executeVariableRepairPlan,
        overrides.createVariableRepairBugCapsule || createVariableRepairBugCapsule,
        overrides.compactRepairJournalWithVariableCapsules
            || compactRepairJournalWithVariableCapsules,
        overrides.variableRepairCapsuleProjection || variableRepairCapsuleProjection,
    ].map((fn) => fn.toString()).join('\n');
}
