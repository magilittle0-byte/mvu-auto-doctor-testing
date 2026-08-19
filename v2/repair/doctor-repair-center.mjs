const MODULES = Object.freeze(['variable', 'profile', 'world']);
const SUCCESS = new Set(['applied', 'nochange']);

// Profile repair is a control-plane boundary.  Do not carry parser details,
// model text, names, or arbitrary error strings into the durable repair
// journal.  This list deliberately mirrors the fixed, public failure codes
// emitted by actor-profile-mvu-core; unknown values fail closed.
const PROFILE_FAILURE_CODES = Object.freeze(new Set([
    'profile_block_duplicate',
    'profile_block_unclosed',
    'profile_block_too_large',
    'profile_block_position_invalid',
    'profile_block_no_entries',
    'profile_entry_name_missing',
    'profile_entry_ticket_missing',
    'profile_entry_actor_id_missing',
    'profile_ticket_unknown',
    'profile_ticket_actor_id_missing',
    'profile_actor_id_unknown',
    'profile_actor_name_conflict',
    'profile_source_anchor_missing',
    'profile_entry_incomplete',
    'profile_technical_field_model_owned',
    'profile_root_missing',
    'profile_sourceref_incomplete',
    'profile_actor_already_exists',
    'profile_path_invalid',
    'profile_entry_locked',
    'profile_legacy_migration_incomplete',
    'profile_binding_missing',
    'profile_readback_unverified',
    'profile_cas_conflict',
    'profile_persistence_failed',
    'profile_binding_failed',
    'profile_block_malformed',
    'accepted_narrative_ineligible',
    'profile_mvu_api_unavailable',
    'profile_mvu_read_failed',
    'profile_mvu_schema_invalid',
    'profile_mvu_readback_mismatch',
    'profile_mvu_readback_not_ready',
    'profile_mvu_readback_receipt_prepare_failed',
    'profile_mvu_readback_receipt_failed',
    'profile_replay_prepare_failed',
    'profile_replay_persistence_failed',
    'profile_targeted_repair_incomplete',
    'profile_targeted_repair_save_failed',
    'actor_profile.registry_projection_failed',
    'actor_profile.registry_projection_quarantined',
    'actor_profile.registry_promotion_quarantined',
    'actor_profile.registry_identity_conflict',
]));

const PROFILE_REPAIR_FIELD_KEYS = Object.freeze(new Set([
    'person', 'physiology', 'personality', 'history', 'currentState',
    'relationshipsMotives', 'knowledgeCapabilitiesResources',
    'identityBackground', 'personalityValues', 'capabilityBoundary',
    'longTermGoals', 'relationshipChanges', 'knownInformation',
    'longTermPsychologicalChanges', 'aliases',
]));

function safeToken(value, max = 180) {
    const token = String(value || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/u.test(token)
        ? token.slice(0, max) : '';
}

function fixedProfileCode(value) {
    const code = String(value || '').trim().toLowerCase();
    return PROFILE_FAILURE_CODES.has(code) ? code : '';
}

function profileFailureClass(code) {
    if (/^profile_block_|^profile_entry_(?:name|ticket|actor_id|incomplete)/u.test(code)) {
        return 'format_or_completeness';
    }
    if (/^profile_(?:ticket|actor_|source_anchor|binding)/u.test(code)) {
        return 'identity_binding';
    }
    if (code === 'profile_technical_field_model_owned') return 'model_control_field';
    if (/^profile_(?:root|path|sourceref|cas|persistence|readback)/u.test(code)) {
        return 'persistence';
    }
    return 'unknown';
}

/**
 * Normalize a semantic profile result into a fixed, privacy-safe repair
 * signal.  This is intentionally not a success predicate: empty operations
 * and partial/quarantined commits remain repairable failures.
 */
export function classifyActorProfileRepairFailure({
    code = '',
    failureCodes = [],
    status = '',
    commitStatus = '',
    emptyOperations = false,
    readbackVerified = false,
    writeCount = 0,
} = {}) {
    const supplied = [code, ...(Array.isArray(failureCodes) ? failureCodes : [])]
        .map(fixedProfileCode).filter(Boolean);
    let codes = [...new Set(supplied)];
    if (!codes.length && readbackVerified !== true && Number(writeCount) > 0) {
        codes = ['profile_readback_unverified'];
    }
    if (!codes.length && (emptyOperations === true || commitStatus === 'quarantined')) {
        codes = ['profile_entry_incomplete'];
    }
    if (!codes.length && String(status).toLowerCase() === 'failed') {
        codes = ['profile_persistence_failed'];
    }
    const primaryCode = codes[0] || '';
    const quarantined = commitStatus === 'quarantined'
        || commitStatus === 'partial'
        || codes.some((entry) => entry === 'profile_entry_incomplete');
    return {
        module: 'profile',
        status: primaryCode ? (quarantined ? 'quarantined' : 'repairable') : 'no_fault',
        code: primaryCode,
        failureClass: profileFailureClass(primaryCode),
        failureCodes: codes,
        emptyOperations: emptyOperations === true,
        readbackVerified: readbackVerified === true,
        // A write count is evidence only; never infer zero-write from a
        // thrown adapter or a missing result.
        zeroWrite: Number.isFinite(Number(writeCount)) && Number(writeCount) === 0,
    };
}

/**
 * Build the minimal AI repair envelope.  It deliberately has no `name`, raw
 * model output, source prose, technical-field values, or arbitrary payload.
 */
export function createActorProfileRepairRequest({
    actorId = '',
    ticketId = '',
    missingFields = [],
    failureCodes = [],
    code = '',
    sourceRefDigest = '',
    acceptedMessageIndex = -1,
    readbackVerified = false,
} = {}) {
    const normalizedFields = [...new Set((Array.isArray(missingFields) ? missingFields : [])
        .map((field) => String(field || '').trim())
        .filter((field) => PROFILE_REPAIR_FIELD_KEYS.has(field)))].sort();
    const failure = classifyActorProfileRepairFailure({
        code, failureCodes, readbackVerified,
        emptyOperations: normalizedFields.length === 0,
    });
    return {
        module: 'profile',
        kind: 'actor-profile-targeted-repair',
        target: {
            actorId: safeToken(actorId),
            ticketId: safeToken(ticketId),
        },
        missingFields: normalizedFields,
        failure,
        evidence: {
            sourceRefDigest: safeToken(sourceRefDigest),
            acceptedMessageIndex: Number.isInteger(Number(acceptedMessageIndex))
                ? Number(acceptedMessageIndex) : -1,
            readbackVerified: readbackVerified === true,
        },
    };
}

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
        (overrides.fixedProfileCode || fixedProfileCode).toString(),
        (overrides.profileFailureClass || profileFailureClass).toString(),
        overrides.classifyActorProfileRepairFailure || classifyActorProfileRepairFailure,
        overrides.createActorProfileRepairRequest || createActorProfileRepairRequest,
        (overrides.safeResult || safeResult).toString(),
        overrides.buildDoctorRepairPlan || buildDoctorRepairPlan,
        overrides.doctorRepairModulesFromSignals || doctorRepairModulesFromSignals,
        overrides.executeDoctorRepairPlan || executeDoctorRepairPlan,
        overrides.createDoctorRepairCapsules || createDoctorRepairCapsules,
        overrides.doctorRepairCapsuleProjection || doctorRepairCapsuleProjection,
    ].map((value) => typeof value === 'string' ? value : value.toString()).join('\n');
}
