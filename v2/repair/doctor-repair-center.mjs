const MODULES = Object.freeze(['variable', 'profile', 'world']);
const SUCCESS = new Set(['applied', 'nochange']);

function safeCode(value, fallback = '') {
    const code = String(value || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_.:-]{0,159}$/u.test(code) ? code : fallback;
}

function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

export function buildDoctorRepairPlan({
    requested = 'all',
    hasTarget = false,
    foregroundActive = false,
    targetIndex = -1,
    targetDigest = '',
    enabledModules = MODULES,
} = {}) {
    const enabled = new Set((enabledModules || []).filter((entry) => MODULES.includes(entry)));
    const modules = requested === 'all'
        ? MODULES.filter((entry) => enabled.has(entry))
        : MODULES.includes(requested) && enabled.has(requested) ? [requested] : [];
    if (!hasTarget || !Number.isInteger(Number(targetIndex)) || Number(targetIndex) < 0) {
        return {
            status: 'blocked', code: 'doctor.repair.target_unavailable',
            targetIndex: -1, targetDigest: '', modules: [],
        };
    }
    if (foregroundActive) {
        return {
            status: 'blocked', code: 'doctor.repair.foreground_active',
            targetIndex: Number(targetIndex), targetDigest: safeCode(targetDigest), modules: [],
        };
    }
    if (requested === 'all' && !modules.length) {
        return {
            status: 'nochange', code: 'doctor.repair.no_faults_detected',
            targetIndex: Number(targetIndex), targetDigest: safeCode(targetDigest),
            modules: [], requested: 'all',
        };
    }
    if (!modules.length) {
        return {
            status: 'blocked', code: 'doctor.repair.module_unavailable',
            targetIndex: Number(targetIndex), targetDigest: safeCode(targetDigest), modules: [],
        };
    }
    return {
        status: 'ready', code: 'doctor.repair.ready',
        targetIndex: Number(targetIndex), targetDigest: safeCode(targetDigest), modules, requested,
    };
}

export function doctorRepairModulesFromSignals({
    variable = false,
    profile = false,
    world = false,
} = {}) {
    return MODULES.filter((module) => ({ variable, profile, world })[module] === true);
}

function safeResult(module, result, durationMs) {
    const rawStatus = String(result?.status || '').toLowerCase();
    let status = ['applied', 'nochange', 'failed', 'cancelled', 'blocked'].includes(rawStatus)
        ? rawStatus : 'failed';
    let code = safeCode(result?.code, `doctor.repair.${module}.${status}`);
    if (status === 'applied' && result?.readbackVerified !== true) {
        status = 'failed';
        code = `doctor.repair.${module}.readback_unverified`;
    }
    return {
        module,
        status,
        code,
        durationMs: count(durationMs),
        modelCallCount: count(result?.modelCallCount),
        writeCount: count(result?.writeCount),
        readbackVerified: result?.readbackVerified === true,
        zeroWrite: result?.zeroWrite === true,
    };
}

export async function executeDoctorRepairPlan(plan, {
    runModule,
    canContinue = () => true,
    now = () => Date.now(),
} = {}) {
    if (plan?.status !== 'ready' || !Array.isArray(plan?.modules)) {
        return {
            status: 'blocked', code: safeCode(plan?.code, 'doctor.repair.plan_invalid'),
            targetIndex: Number.isInteger(Number(plan?.targetIndex)) ? Number(plan.targetIndex) : -1,
            durationMs: 0, actions: [],
        };
    }
    if (typeof runModule !== 'function') throw new TypeError('runModule adapter is required');
    const startedAt = count(now());
    const actions = [];
    for (const module of plan.modules) {
        if (!canContinue()) {
            actions.push(safeResult(module, {
                status: 'cancelled', code: 'doctor.repair.target_changed', zeroWrite: true,
            }, 0));
            break;
        }
        const actionStartedAt = count(now());
        let result;
        try {
            result = await runModule(module);
        } catch {
            result = { status: 'failed', code: `doctor.repair.${module}.adapter_failed`, zeroWrite: false };
        }
        actions.push(safeResult(module, result, count(now()) - actionStartedAt));
        // Module failures are independent. Only a lost target/foreground guard
        // stops the remaining repair-all actions.
        if (!canContinue()) break;
    }
    const completedAt = count(now());
    const failed = actions.some((entry) => !SUCCESS.has(entry.status));
    return {
        status: failed ? 'partial' : 'completed',
        code: failed ? 'doctor.repair.partial' : 'doctor.repair.completed',
        targetIndex: Number(plan.targetIndex),
        startedAt, completedAt,
        durationMs: Math.max(0, completedAt - startedAt),
        actions,
    };
}

export function createDoctorRepairCapsules({
    runtimeFingerprint = '',
    chatScopeDigest = '',
    plan = {},
    outcome = {},
} = {}) {
    return (outcome?.actions || []).filter((entry) => MODULES.includes(entry?.module)).map((entry, index) => ({
        schemaVersion: 1,
        id: safeCode(
            `doctor_bug_${count(outcome?.completedAt).toString(36)}_${entry.module}_${index}`,
            `doctor_bug_${index}`,
        ),
        repairKind: 'doctor-unified-repair-center',
        createdAt: count(outcome?.completedAt || outcome?.startedAt),
        status: SUCCESS.has(entry.status) ? 'repair_completed'
            : entry.status === 'cancelled' ? 'repair_cancelled' : 'needs_update',
        module: entry.module,
        runtimeFingerprint: safeCode(runtimeFingerprint),
        chatScopeDigest: safeCode(chatScopeDigest),
        targetIndex: Number.isInteger(Number(plan?.targetIndex)) ? Number(plan.targetIndex) : -1,
        targetDigest: safeCode(plan?.targetDigest),
        trigger: plan?.requested === 'all' ? 'manual_repair_all' : 'manual_module_repair',
        outcomeCode: safeCode(entry.code, `doctor.repair.${entry.module}.unknown`),
        durationMs: count(entry.durationMs),
        evidence: {
            modelCallCount: count(entry.modelCallCount),
            writeCount: count(entry.writeCount),
            readbackVerified: entry.readbackVerified === true,
            zeroWrite: entry.zeroWrite === true,
        },
    }));
}

export function doctorRepairCapsuleProjection(journal, { maxEntries = 25 } = {}) {
    const limit = Math.min(25, Math.max(1, count(maxEntries) || 25));
    const history = (Array.isArray(journal) ? journal : [])
        .filter((entry) => entry?.repairKind === 'doctor-unified-repair-center')
        .slice(-limit)
        .map((entry) => ({
            module: MODULES.includes(entry?.module) ? entry.module : '',
            status: safeCode(entry?.status),
            outcomeCode: safeCode(entry?.outcomeCode),
            durationMs: count(entry?.durationMs),
            modelCallCount: count(entry?.evidence?.modelCallCount),
            writeCount: count(entry?.evidence?.writeCount),
            readbackVerified: entry?.evidence?.readbackVerified === true,
            zeroWrite: entry?.evidence?.zeroWrite === true,
            runtimeFingerprint: safeCode(entry?.runtimeFingerprint),
            targetDigest: safeCode(entry?.targetDigest),
            targetIndex: Number.isInteger(Number(entry?.targetIndex))
                ? Number(entry.targetIndex) : -1,
            createdAt: count(entry?.createdAt),
        }));
    const last = history.at(-1) || null;
    return {
        capsuleCount: history.length,
        lastModule: last?.module || '',
        lastStatus: last?.status || '',
        lastOutcomeCode: last?.outcomeCode || '',
        lastTargetIndex: last?.targetIndex ?? -1,
        lastDurationMs: last?.durationMs || 0,
        lastReadbackVerified: last?.readbackVerified === true,
        history,
    };
}

export function doctorRepairCenterSemanticFingerprint(overrides = {}) {
    return [
        `modules:${MODULES.join(',')}`,
        `success:${[...SUCCESS].join(',')}`,
        (overrides.safeCode || safeCode).toString(),
        (overrides.count || count).toString(),
        (overrides.safeResult || safeResult).toString(),
        overrides.buildDoctorRepairPlan || buildDoctorRepairPlan,
        overrides.doctorRepairModulesFromSignals || doctorRepairModulesFromSignals,
        overrides.executeDoctorRepairPlan || executeDoctorRepairPlan,
        overrides.createDoctorRepairCapsules || createDoctorRepairCapsules,
        overrides.doctorRepairCapsuleProjection || doctorRepairCapsuleProjection,
    ].map((value) => typeof value === 'string' ? value : value.toString()).join('\n');
}
