import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    buildDoctorRepairPlan,
    classifyActorProfileRepairFailure,
    createActorProfileRepairRequest,
    createDoctorRepairCapsules,
    doctorRepairCapsuleProjection,
    doctorRepairCenterSemanticFingerprint,
    doctorRepairModulesFromSignals,
    executeDoctorRepairPlan,
} from '../v2/repair/doctor-repair-center.mjs';
import { createPrivacySafeDiagnosticProjection } from '../v2/surface/diagnostics.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const preset = JSON.parse(await readFile(new URL(
    '../dist/01_主预设_人物万花筒_可调篇幅_IZUMI0814作者更新_ARGO1.3最小融合候选版.json',
    import.meta.url,
), 'utf8'));

test('selected preset exposes one accepted-final natural-language profile block after existing control blocks', () => {
    const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
    const profilePrompts = prompts.filter((entry) => (
        entry?.identifier === '4f2642de-5ef6-4ee4-9e94-2c52dd667a13'
    ));
    assert.equal(profilePrompts.length, 1);
    const [profile] = profilePrompts;
    assert.equal(profile.enabled, true);
    assert.match(profile.content, /<!-- 人物档案更新/u);
    assert.match(profile.content, /accepted assistant/iu);
    assert.match(profile.content, /完整 ticketId/u);
    assert.match(profile.content, /ActorId/u);
    assert.match(profile.content, /JSONPatch/u);
    assert.match(profile.content, /技术字段/u);
    assert.match(profile.content, /没有变化时不输出/u);
});

test('selected preset keeps second-person perception without assigning player feelings', () => {
    const identifier = '82da9596-b36b-47cc-9f77-d91c7fff1919';
    const perspective = (preset.prompts || []).find((entry) => entry?.identifier === identifier);
    assert.ok(perspective);
    assert.match(perspective.content, /你听见、你看见、你触到/u);
    assert.match(perspective.content, /不得用“你感到\/你觉得\/你认为\/你意识到”/u);
    assert.match(perspective.content, /把如何理解和感受留给Master/u);
    assert.doesNotMatch(perspective.content, /你听见、你看见、你感到”等表达/u);
    const order = (preset.prompt_order || []).flatMap((entry) => entry?.order || []);
    assert.equal(order.find((entry) => entry?.identifier === identifier)?.enabled, true);
});

test('profile repair classification is fixed-code and fail-closed', () => {
    const privateText = 'PRIVATE-NAME-AND-MODEL-BLOCK';
    const classified = classifyActorProfileRepairFailure({
        code: privateText,
        failureCodes: [
            'profile_technical_field_model_owned',
            privateText,
            { code: 'profile_persistence_failed' },
        ],
        commitStatus: 'partial',
        emptyOperations: true,
    });
    assert.equal(classified.status, 'quarantined');
    assert.equal(classified.code, 'profile_technical_field_model_owned');
    assert.deepEqual(classified.failureCodes, ['profile_technical_field_model_owned']);
    assert.doesNotMatch(JSON.stringify(classified), new RegExp(privateText, 'u'));
    const noWrite = classifyActorProfileRepairFailure({
        status: 'failed', writeCount: 0, emptyOperations: true,
    });
    assert.equal(noWrite.code, 'profile_entry_incomplete');
    assert.equal(noWrite.zeroWrite, true);
});

test('targeted profile repair envelope is privacy-safe and only carries bounded fields', () => {
    const privateText = 'PRIVATE-NAME-AND-PROSE';
    const request = createActorProfileRepairRequest({
        actorId: 'NPC-7',
        ticketId: 'NPC-DICE-3',
        missingFields: [
            'person', 'relationshipsMotives', 'not-a-profile-field', 'person',
        ],
        failureCodes: [
            'profile_entry_incomplete', privateText, 'profile_technical_field_model_owned',
        ],
        sourceRefDigest: 'source-digest-3',
        acceptedMessageIndex: 12,
        rawModelOutput: privateText,
        personName: privateText,
    });
    assert.deepEqual(request.target, { actorId: 'NPC-7', ticketId: 'NPC-DICE-3' });
    assert.deepEqual(request.missingFields, ['person', 'relationshipsMotives']);
    assert.deepEqual(request.failure.failureCodes, [
        'profile_entry_incomplete', 'profile_technical_field_model_owned',
    ]);
    assert.equal(request.evidence.acceptedMessageIndex, 12);
    assert.doesNotMatch(JSON.stringify(request), new RegExp(privateText, 'u'));
    assert.equal(Object.hasOwn(request, 'rawModelOutput'), false);
    assert.equal(Object.hasOwn(request, 'personName'), false);
});

function sourceSection(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0, `missing source marker: ${start}`);
    assert.ok(to > from, `missing source marker: ${end}`);
    return source.slice(from, to);
}

test('repair plans expose one module or all three and block foreground work', () => {
    assert.deepEqual(
        buildDoctorRepairPlan({ requested: 'profile', hasTarget: true, targetIndex: 4 }).modules,
        ['profile'],
    );
    assert.deepEqual(
        buildDoctorRepairPlan({ requested: 'all', hasTarget: true, targetIndex: 4 }).modules,
        ['variable', 'profile', 'world'],
    );
    assert.equal(buildDoctorRepairPlan({
        requested: 'all', hasTarget: true, targetIndex: 4, foregroundActive: true,
    }).code, 'doctor.repair.foreground_active');
    assert.deepEqual(doctorRepairModulesFromSignals({ profile: true }), ['profile']);
    const healthy = buildDoctorRepairPlan({
        requested: 'all', hasTarget: true, targetIndex: 4, enabledModules: [],
    });
    assert.equal(healthy.status, 'nochange');
    assert.equal(healthy.code, 'doctor.repair.no_faults_detected');
    assert.deepEqual(healthy.modules, []);
});

test('repair-all continues independent modules after failure but stops after target guard loss', async () => {
    const plan = buildDoctorRepairPlan({ requested: 'all', hasTarget: true, targetIndex: 4 });
    const calls = [];
    const continued = await executeDoctorRepairPlan(plan, {
        runModule: async (module) => {
            calls.push(module);
            return module === 'profile'
                ? { status: 'failed', code: 'actor_profile.not_completed', zeroWrite: true }
                : { status: 'applied', readbackVerified: true, writeCount: 1 };
        },
    });
    assert.deepEqual(calls, ['variable', 'profile', 'world']);
    assert.equal(continued.status, 'partial');

    let current = true;
    const stoppedCalls = [];
    const stopped = await executeDoctorRepairPlan(plan, {
        canContinue: () => current,
        runModule: async (module) => {
            stoppedCalls.push(module);
            current = false;
            return { status: 'failed', code: 'doctor.repair.target_changed', zeroWrite: true };
        },
    });
    assert.deepEqual(stoppedCalls, ['variable']);
    assert.equal(stopped.actions.length, 1);
});

test('adapter exceptions never claim zero-write without evidence', async () => {
    let writes = 0;
    const plan = buildDoctorRepairPlan({ requested: 'profile', hasTarget: true, targetIndex: 4 });
    const outcome = await executeDoctorRepairPlan(plan, {
        runModule: async () => {
            writes += 1;
            throw new Error('after write');
        },
    });
    assert.equal(writes, 1);
    assert.equal(outcome.actions[0].code, 'doctor.repair.profile.adapter_failed');
    assert.equal(outcome.actions[0].zeroWrite, false);
    const [capsule] = createDoctorRepairCapsules({ plan, outcome });
    assert.equal(capsule.evidence.zeroWrite, false);
    const requestSource = sourceSection(
        'async function runDoctorRepairModuleRequest(module, captured, targetDigest, owner)',
        'function releaseDoctorRepairModuleRequests(',
    );
    assert.match(requestSource, /adapter_failed[\s\S]*zeroWrite:\s*false/u);
});

test('applied without durable readback is never reported as repair success', async () => {
    const plan = buildDoctorRepairPlan({ requested: 'world', hasTarget: true, targetIndex: 2 });
    const outcome = await executeDoctorRepairPlan(plan, {
        runModule: async () => ({ status: 'applied', readbackVerified: false, writeCount: 1 }),
    });
    assert.equal(outcome.status, 'partial');
    assert.equal(outcome.actions[0].status, 'failed');
    assert.equal(outcome.actions[0].code, 'doctor.repair.world.readback_unverified');
});

test('bug capsules contain only fixed metadata and privacy-safe counters', () => {
    const privateText = 'PRIVATE-NARRATIVE-AND-NAME';
    const plan = buildDoctorRepairPlan({
        requested: 'all', hasTarget: true, targetIndex: 3, targetDigest: 'deadbeef',
    });
    const capsules = createDoctorRepairCapsules({
        runtimeFingerprint: 'runtime-critical:1234:abcd',
        chatScopeDigest: 'deadbeef',
        plan,
        outcome: {
            completedAt: 10,
            actions: plan.modules.map((module) => ({
                module, status: 'applied', code: `doctor.repair.${module}.completed`,
                durationMs: 2, modelCallCount: 1, writeCount: 1, readbackVerified: true,
                ignoredPrivateText: privateText,
            })),
        },
    });
    assert.equal(capsules.length, 3);
    assert.doesNotMatch(JSON.stringify(capsules), new RegExp(privateText, 'u'));
    assert.deepEqual(capsules.map((entry) => entry.module), ['variable', 'profile', 'world']);
});

test('unified repair history projection retains only privacy-safe fields and is exported safely', () => {
    const privateText = 'PRIVATE-NARRATIVE-AND-NAME';
    const journal = Array.from({ length: 30 }, (_, index) => ({
        repairKind: 'doctor-unified-repair-center',
        module: ['variable', 'profile', 'world'][index % 3],
        status: index === 29 ? 'repair_completed' : 'needs_update',
        outcomeCode: 'doctor.repair.world.completed',
        durationMs: index + 1,
        runtimeFingerprint: 'runtime-critical:1234:abcd',
        targetDigest: 'deadbeef',
        targetIndex: 4,
        createdAt: 100 + index,
        evidence: {
            modelCallCount: 1,
            writeCount: 1,
            readbackVerified: true,
            zeroWrite: false,
        },
        privateNarrative: privateText,
        modelOutput: privateText,
        chatId: privateText,
    }));
    const projection = doctorRepairCapsuleProjection(journal);
    assert.equal(projection.history.length, 25);
    assert.equal(projection.lastStatus, 'repair_completed');
    assert.deepEqual(Object.keys(projection.history[0]).sort(), [
        'createdAt', 'durationMs', 'modelCallCount', 'module', 'outcomeCode',
        'readbackVerified', 'runtimeFingerprint', 'status', 'targetDigest', 'targetIndex',
        'writeCount', 'zeroWrite',
    ].sort());
    const diagnostic = createPrivacySafeDiagnosticProjection({
        doctorRepair: { ...projection, privateNarrative: privateText },
    });
    assert.deepEqual(diagnostic.doctorRepair.history, projection.history);
    assert.doesNotMatch(JSON.stringify(diagnostic.doctorRepair), new RegExp(privateText, 'u'));
});

test('doctor repair projection changes the semantic and runtime fingerprints', () => {
    const base = doctorRepairCenterSemanticFingerprint();
    const changed = doctorRepairCenterSemanticFingerprint({
        doctorRepairCapsuleProjection: function changedProjection() { return { capsuleCount: 99 }; },
    });
    assert.notEqual(base, changed);
    const changedSuccessGate = doctorRepairCenterSemanticFingerprint({
        safeResult: function unsafeResult() { return { status: 'applied' }; },
    });
    assert.notEqual(base, changedSuccessGate);
    const runtimeFingerprintSection = sourceSection(
        'function doctorRuntimeCriticalFingerprint()',
        'function diagnosticPayload()',
    );
    assert.match(runtimeFingerprintSection, /doctorRepairCapsuleProjection\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /hydrateDoctorRepairCenterStatus\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /doctorRepairCenterSemanticFingerprint\(\)/u);
    assert.match(runtimeFingerprintSection, /doctorRepairTargetIdentityDigest\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /writeRepairJournal\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /doctorRepairDiagnosticNeedsModule\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /createContinuityPendingOwnerMap\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /continuityPendingOwnerRegistryFingerprint\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /continuityPendingOwnerRegistryFingerprint\(\)/u);
    assert.match(runtimeFingerprintSection, /stage3FieldState\.toString\(\)/u);
    const ownerMapSource = sourceSection(
        'function createContinuityPendingOwnerMap()',
        'const continuityCompletedKeys = new Set();',
    );
    assert.match(ownerMapSource, /return new Map\(\)/u);
    assert.match(ownerMapSource, /continuityPendingKeys = createContinuityPendingOwnerMap\(\)/u);
    assert.match(runtimeFingerprintSection, /doctorRepairCenterPrepareModuleRequests\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /invalidateDoctorRepairCenterRequests\.toString\(\)/u);
    assert.match(runtimeFingerprintSection, /normalizedModelDiagnostics\.toString\(\)/u);
    for (const helper of [
        'doctorRepairResultZeroWrite',
        'mergeDoctorRepairCapsules',
        'persistDoctorRepairCapsuleBatch',
        'recordModelDiagnostic',
        'terminalModelDiagnosticKey',
        'mergeTerminalModelDiagnostic',
        'persistTerminalModelDiagnostic',
        'scheduleOperationLogSave',
        'scheduleSafeChatSave',
        'ensureMessageStableId',
        'readOnlyMessageStableId',
        'currentSwipeInfo',
        'ensureRuntimeTargetIdentity',
        'captureDoctorRepairTargetReadOnly',
        'resolveCurrentActorSovereigntyScope',
        'resolveDoctorRepairTargetReadOnly',
        'doctorTerminalDiagnosticTargetIsCurrent',
        'recordStage3WorldFinalDiagnostic',
        'stage3ExistingCommittedPackageReadback',
        'recordActorProfileFinalDiagnostic',
        'doctorRepairLatestTerminalDiagnostic',
        'doctorRepairProfileRecoveryUnavailable',
        'doctorRepairLatestCapsule',
        'doctorRepairLatestModuleEvent',
        'doctorRepairModuleEventNeedsRepair',
        'invalidateContinuityQueue',
        'invalidateOperations',
        'syncTaskCancelButtons',
        'createContinuityPendingOwnerMap',
        'continuityPendingOwnerRegistryFingerprint',
        'stage3FieldState',
        'actorProfileTargetStaleAutomaticRecoveryEligible',
        'actorProfileAutomaticRecoveryResult',
    ]) {
        assert.match(runtimeFingerprintSection, new RegExp(`${helper}\\.toString\\(\\)`, 'u'));
    }

    const toStringNames = Array.from(runtimeFingerprintSection.matchAll(
        /\b([A-Za-z_$][\w$]*)\.toString\(\)/gu,
    ), (match) => match[1]);
    const calledFingerprints = Array.from(runtimeFingerprintSection.matchAll(
        /\b([A-Za-z_$][\w$]*Fingerprint)\(\)/gu,
    ), (match) => match[1]);
    const dependencies = Array.from(new Set([
        ...toStringNames,
        ...calledFingerprints.filter((name) => name !== 'doctorRuntimeCriticalFingerprint'),
    ])).filter((name) => name !== 'fingerprint');
    const fingerprint = (value) => createHash('sha256')
        .update(String(value), 'utf8').digest('hex').slice(0, 16);
    const ownerRegistrySandbox = { fingerprint };
    vm.runInNewContext(
        `${ownerMapSource}\n`
        + 'this.mapHash = continuityPendingOwnerRegistryFingerprint(new Map(), () => new Map());\n'
        + 'this.setHash = continuityPendingOwnerRegistryFingerprint(new Set(), () => new Set());',
        ownerRegistrySandbox,
    );
    assert.notEqual(
        ownerRegistrySandbox.mapHash,
        ownerRegistrySandbox.setHash,
        'the runtime-called registry fingerprint must distinguish the actual Map from Set semantics',
    );
    const makeRuntime = (mutations = {}) => {
        const values = dependencies.map((name) => (
            mutations[name]
            || function stableDependency() { return 'stable'; }
        ));
        return new Function(
            'fingerprint',
            'VERSION',
            ...dependencies,
            `${runtimeFingerprintSection}; return doctorRuntimeCriticalFingerprint;`,
        )(fingerprint, 'test-version', ...values)();
    };
    const runtimeBase = makeRuntime();
    for (const helper of [
        'persistTerminalModelDiagnostic',
        'captureDoctorRepairTargetReadOnly',
        'resolveDoctorRepairTargetReadOnly',
        'mergeDoctorRepairCapsules',
        'createContinuityPendingOwnerMap',
        'continuityPendingOwnerRegistryFingerprint',
        'stage3FieldState',
        'actorProfileTargetStaleAutomaticRecoveryEligible',
    ]) {
        assert.notEqual(
            makeRuntime({ [helper]: function changedDependency() { return helper; } }),
            runtimeBase,
            `${helper} mutation must change runtime fingerprint`,
        );
    }
});

test('production adapter routes modules only to their existing independent repair entrypoints', async () => {
    const adapter = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    const calls = [];
    let continuityResult = {
        status: 'applied', readbackVerified: true, worldModelCalls: 2, worldWrites: 0,
    };
    const sandbox = {
        doctorRepairDiagnosticCounters: () => ({ modelCallCount: 0, writeCount: 0 }),
        doctorRepairCounterDelta: () => ({ modelCallCount: 1, writeCount: 1 }),
        doctorRepairResultZeroWrite: (result) => result?.zeroWrite === true,
        doctorRepairProfileRecoveryUnavailable: () => false,
        runVariableSafeRepair: async () => {
            calls.push('variable');
            return { status: 'completed', actions: [{ actionId: 'variable_audit', status: 'applied', readbackVerified: true }] };
        },
        enqueueActorProfiles: async () => {
            calls.push('profile');
            return { status: 'atomic_readback', profileBatch: { readbackVerified: true } };
        },
        enqueueContinuity: async (_index, options) => {
            calls.push('world');
            assert.equal(options.afterPending, false);
            return continuityResult;
        },
        capturedTargetKey: () => 'target-key',
        automaticPendingKeys: new Set(),
        automaticCompletedKeys: new Set(),
        actorProfilePendingKeys: new Map(),
        actorProfileCompletedKeys: new Set(),
        runChain: Promise.resolve(),
        actorProfileChain: Promise.resolve(),
        stage3AcceptedTargetKey: () => 'world-key',
        continuityPendingKeys: new Set(),
        doctorRepairCenterTargetIsCurrent: () => true,
        getSettings: () => ({ actorProfileCompletionMode: 'full' }),
        compactActorProfileFailureCode: (value) => String(value),
        fixedValidationCode: (value) => String(value || ''),
        safeDiagnosticReason: (value) => String(value || ''),
    };
    vm.runInNewContext(`${adapter}\nthis.runModule = runDoctorRepairModule;`, sandbox);
    const captured = { index: 4 };
    for (const module of ['variable', 'profile', 'world']) {
        const result = await sandbox.runModule(module, captured);
        assert.equal(result.status, 'applied', module);
        assert.equal(result.readbackVerified, true, module);
        if (module === 'world') {
            assert.equal(result.modelCallCount, 2, 'world adapter must preserve actual model calls');
        }
    }
    assert.deepEqual(calls, ['variable', 'profile', 'world']);
    continuityResult = { status: 'duplicate' };
    const duplicate = await sandbox.runModule('world', captured);
    assert.equal(duplicate.status, 'failed');
    assert.equal(duplicate.readbackVerified, false);
});

test('existing variable, profile, and world work is joined instead of starting duplicate AI work', async () => {
    const adapter = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    const calls = { variableManual: 0, profileManual: 0, worldJoin: 0 };
    const sandbox = {
        doctorRepairDiagnosticCounters: () => ({ modelCallCount: 0, writeCount: 0 }),
        doctorRepairCounterDelta: () => ({ modelCallCount: 0, writeCount: 0 }),
        doctorRepairResultZeroWrite: (result) => result?.zeroWrite === true,
        doctorRepairProfileRecoveryUnavailable: () => false,
        capturedTargetKey: () => 'target-key',
        automaticPendingKeys: new Set(['target-key']),
        automaticCompletedKeys: new Set(['target-key']),
        actorProfilePendingKeys: new Map([['target-key', Symbol('owner')]]),
        actorProfileCompletedKeys: new Set(['target-key']),
        stage3AcceptedTargetKey: () => 'world-key',
        continuityPendingKeys: new Set(['world-key']),
        doctorRepairCenterTargetIsCurrent: () => true,
        runChain: Promise.resolve({ status: 'nochange', readbackVerified: true }),
        actorProfileChain: Promise.resolve({ status: 'no_candidates' }),
        runVariableSafeRepair: async () => { calls.variableManual += 1; throw new Error('duplicate'); },
        enqueueActorProfiles: async () => { calls.profileManual += 1; throw new Error('duplicate'); },
        enqueueContinuity: async (_index, options) => {
            assert.equal(options.afterPending, true);
            calls.worldJoin += 1;
            return { status: 'applied', readbackVerified: true };
        },
        getSettings: () => ({ actorProfileCompletionMode: 'full' }),
        compactActorProfileFailureCode: (value) => String(value),
        fixedValidationCode: (value) => String(value || ''),
        safeDiagnosticReason: (value) => String(value || ''),
    };
    vm.runInNewContext(`${adapter}\nthis.runModule = runDoctorRepairModule;`, sandbox);
    const captured = { index: 4 };
    assert.equal((await sandbox.runModule('variable', captured)).status, 'nochange');
    assert.equal((await sandbox.runModule('profile', captured)).status, 'nochange');
    assert.equal((await sandbox.runModule('world', captured)).status, 'applied');
    assert.deepEqual(calls, { variableManual: 0, profileManual: 0, worldJoin: 1 });
});

test('world repair reuses a successful pending result and falls through once only after a failed join', async () => {
    const adapter = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    const exercise = async ({ pending, joined, currentAfterJoin = true }) => {
        const state = { current: true, calls: [] };
        const sandbox = {
            doctorRepairDiagnosticCounters: () => ({ modelCallCount: 0, writeCount: 0 }),
            doctorRepairCounterDelta: () => ({ modelCallCount: 0, writeCount: 0 }),
            doctorRepairResultZeroWrite: (result) => result?.zeroWrite === true,
            stage3AcceptedTargetKey: () => 'world-key',
            continuityPendingKeys: new Set(pending ? ['world-key'] : []),
            doctorRepairCenterTargetIsCurrent: () => state.current,
            enqueueContinuity: async (_index, options) => {
                state.calls.push(options.afterPending ? 'join' : 'manual');
                if (options.afterPending) {
                    state.current = currentAfterJoin;
                    return joined;
                }
                return { status: 'applied', readbackVerified: true };
            },
            fixedValidationCode: (value) => String(value || ''),
        };
        vm.runInNewContext(`${adapter}\nthis.runModule = runDoctorRepairModule;`, sandbox);
        return { result: await sandbox.runModule('world', { index: 4 }), state };
    };

    const joinedSuccess = await exercise({
        pending: true, joined: { status: 'applied', readbackVerified: true },
    });
    assert.deepEqual(joinedSuccess.state.calls, ['join']);
    assert.equal(joinedSuccess.result.status, 'applied');

    const joinedFailure = await exercise({
        pending: true, joined: { status: 'failed', validationCode: 'world.validation_failed' },
    });
    assert.deepEqual(joinedFailure.state.calls, ['join', 'manual']);
    assert.equal(joinedFailure.result.status, 'applied');

    const staleAfterJoin = await exercise({
        pending: true,
        joined: { status: 'failed', validationCode: 'world.validation_failed' },
        currentAfterJoin: false,
    });
    assert.deepEqual(staleAfterJoin.state.calls, ['join']);
    assert.equal(staleAfterJoin.result.status, 'failed');

    const noPending = await exercise({ pending: false, joined: null });
    assert.deepEqual(noPending.state.calls, ['manual']);
    assert.equal(noPending.result.status, 'applied');
});

test('variable repair joins exact pending work and performs at most one guarded manual fallback', async () => {
    const adapter = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'function doctorRepairCenterModuleKey(module, targetDigest)',
    );
    const exercise = async ({ pending, joined, currentAfterJoin = true }) => {
        const state = { current: true, manual: 0, options: null };
        const sandbox = {
            doctorRepairDiagnosticCounters: () => ({ modelCallCount: 0, writeCount: 0 }),
            doctorRepairCounterDelta: () => ({ modelCallCount: 0, writeCount: 0 }),
            capturedTargetKey: () => 'target-key',
            automaticPendingKeys: new Set(pending ? ['target-key'] : []),
            runChain: Promise.resolve(joined).then((result) => {
                state.current = currentAfterJoin;
                return result;
            }),
            doctorRepairCenterTargetIsCurrent: () => state.current,
            runVariableSafeRepair: async (options) => {
                state.manual += 1;
                state.options = options;
                return {
                    status: 'completed',
                    actions: [{
                        actionId: 'variable_audit', status: 'nochange',
                        readbackVerified: true, zeroWrite: true,
                    }],
                };
            },
        };
        vm.runInNewContext(`${adapter}\nthis.runModule = runDoctorRepairModule;`, sandbox);
        const captured = { index: 4, marker: 'frozen' };
        return { result: await sandbox.runModule('variable', captured), state, captured };
    };

    const joinedSuccess = await exercise({
        pending: true, joined: { status: 'applied', readbackVerified: true },
    });
    assert.equal(joinedSuccess.state.manual, 0);
    assert.equal(joinedSuccess.result.status, 'applied');

    const joinedFailure = await exercise({
        pending: true, joined: { status: 'failed', failureCode: 'variable.failed' },
    });
    assert.equal(joinedFailure.state.manual, 1);
    assert.equal(joinedFailure.state.options.expectedTarget, joinedFailure.captured);
    assert.equal(joinedFailure.state.options.continuationGuard(), true);

    const staleAfterJoin = await exercise({
        pending: true,
        joined: { status: 'failed', failureCode: 'variable.failed' },
        currentAfterJoin: false,
    });
    assert.equal(staleAfterJoin.state.manual, 0);
    assert.equal(staleAfterJoin.result.status, 'cancelled');

    const noPending = await exercise({ pending: false, joined: null });
    assert.equal(noPending.state.manual, 1);
});

test('repair-all selects only current-target terminal diagnostics including first variable and world failures', () => {
    const callModelSource = sourceSection(
        'async function callModel(messages, options = {})',
        'async function probeModelChannelConnections(',
    );
    assert.match(callModelSource, /targetDigest:\s*diagnosticTargetDigest/gu);
    const variableRun = sourceSection('async function runTarget(', 'function automaticTargetKey(');
    assert.match(variableRun, /diagnosticTarget:\s*captured/u);
    const worldFinal = sourceSection(
        'function recordStage3WorldFinalDiagnostic(captured, result)',
        'function stage3WorldFailureValidationCode(',
    );
    assert.match(worldFinal, /targetDigest:\s*doctorRepairTargetIdentityDigest\(captured\)/u);
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const state = { diagnostics: [] };
    const sandbox = {
        modelDiagnostics: state.diagnostics,
        modelDiagnosticsForChat: (entries) => entries,
        doctorRepairTargetIdentityDigest: (target) => target.digest,
        hydratedActorProfileDiagnostic: () => ({ status: 'waiting', canRetry: false }),
        doctorRepairLatestTerminalDiagnostic: () => null,
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
    };
    vm.runInNewContext(
        `${diagnosticSource}\n${selectorSource}\nthis.select = doctorRepairModulesNeedingRepair;`,
        sandbox,
    );
    const target = { digest: 'aaaaaaaa' };
    state.diagnostics.unshift({
        targetDigest: 'aaaaaaaa', task: '变量诊断', status: 'failed',
        failureKind: 'transport-error', cancelReason: '',
    });
    assert.deepEqual(Array.from(sandbox.select(target, {})), ['variable']);

    state.diagnostics.unshift({
        targetDigest: 'aaaaaaaa', task: '变量诊断', status: 'succeeded',
    });
    assert.deepEqual(Array.from(sandbox.select(target, {})), []);

    state.diagnostics.unshift({
        targetDigest: 'aaaaaaaa', task: 'world_continuity', status: 'failed',
        failureKind: 'world_failed', worldFinalPhase: 'failed',
    });
    assert.deepEqual(Array.from(sandbox.select(target, {})), ['world']);
    assert.deepEqual(Array.from(sandbox.select({ digest: 'bbbbbbbb' }, {})), []);

    const projected = createPrivacySafeDiagnosticProjection({
        modelDiagnostics: state.diagnostics,
    });
    assert.equal(projected.modelDiagnostics[0].targetDigest, 'aaaaaaaa');
});

test('later verified module recovery suppresses old failure capsules until a newer failure arrives', async () => {
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const state = {
        diagnostics: [],
        profile: { status: 'waiting', canRetry: false },
    };
    const sandbox = {
        modelDiagnostics: state.diagnostics,
        modelDiagnosticsForChat: (entries) => entries,
        doctorRepairTargetIdentityDigest: () => 'target-a',
        hydratedActorProfileDiagnostic: () => state.profile,
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
    };
    vm.runInNewContext(
        `${diagnosticSource}\n${selectorSource}\nthis.select = doctorRepairModulesNeedingRepair;`,
        sandbox,
    );
    const namespace = {
        repairJournal: ['variable', 'profile', 'world'].map((module) => ({
            repairKind: 'doctor-unified-repair-center',
            module,
            targetDigest: 'target-a',
            status: 'needs_update',
            createdAt: 10,
        })),
    };
    const task = {
        variable: 'variable_final',
        profile: 'actor_profile_final',
        world: 'world_continuity',
    };
    for (const module of ['variable', 'profile', 'world']) {
        state.diagnostics.push({
            at: 20,
            task: task[module],
            requestKind: module === 'profile' ? 'actor_profile_batch' : '',
            targetDigest: 'target-a',
            status: 'succeeded',
        });
    }
    assert.deepEqual(Array.from(sandbox.select({}, namespace)), []);
    const noWork = buildDoctorRepairPlan({
        requested: 'all', hasTarget: true, targetIndex: 4,
        enabledModules: Array.from(sandbox.select({}, namespace)),
    });
    assert.equal(noWork.status, 'nochange');
    assert.deepEqual(noWork.modules, []);
    const runSource = sourceSection(
        'async function runDoctorRepairCenterUnlocked(',
        'function doctorRepairCenterRequestKey(',
    );
    const counters = { modules: 0, capsules: 0 };
    Object.assign(sandbox, {
        getContext: () => ({ chatId: 'chat-a' }),
        readChatNamespace: () => namespace,
        buildDoctorRepairPlan,
        doctorRepairCenterForegroundActive: () => false,
        doctorRepairCenterTargetIsCurrent: () => true,
        setDoctorRepairCenterStatus: () => undefined,
        executeDoctorRepairPlan,
        runDoctorRepairModule: async () => { counters.modules += 1; return {}; },
        doctorRepairCenterQueueGeneration: 0,
        doctorRepairCenterPrepareModuleRequests: () => undefined,
        runDoctorRepairModuleRequest: async () => { counters.modules += 1; return {}; },
        createDoctorRepairCapsules,
        doctorRuntimeCriticalFingerprint: () => 'runtime-critical:test',
        fingerprint: () => 'scope-a',
        persistDoctorRepairCapsules: async () => { counters.capsules += 1; return true; },
        deepClone: (value) => structuredClone(value),
    });
    vm.runInNewContext(`${runSource}\nthis.runAll = runDoctorRepairCenterUnlocked;`, sandbox);
    const noWorkResult = await sandbox.runAll('all', { chatId: 'chat-a', index: 4 }, 'target-a');
    assert.equal(noWorkResult.status, 'nochange');
    assert.deepEqual(counters, { modules: 0, capsules: 0 });

    state.profile = { status: 'no_candidates', canRetry: false };
    for (const module of ['variable', 'profile', 'world']) {
        state.diagnostics.unshift({
            at: 30,
            task: task[module],
            requestKind: module === 'profile' ? 'actor_profile_batch' : '',
            targetDigest: 'target-a',
            status: 'failed',
            failureKind: module === 'profile'
                ? 'actor_profile_terminal_failure' : `${module}_terminal_failure`,
        });
    }
    assert.deepEqual(
        Array.from(sandbox.select({}, namespace)),
        ['variable', 'profile', 'world'],
    );
});

test('profile final receipt is durable and only verified atomic/no-candidates suppress repair', async () => {
    const recordSource = sourceSection(
        'async function recordActorProfileFinalDiagnostic(captured, result, {',
        'async function waitForTargetSettled(',
    );
    const diagnostics = [];
    const sandbox = {
        Date: { now: (() => { let value = 100; return () => ++value; })() },
        doctorRepairCenterTargetIsCurrent: () => true,
        doctorTerminalDiagnosticTargetIsCurrent: () => true,
        doctorRepairTargetIdentityDigest: () => 'target-a',
        fingerprint: () => 'scope-a',
        recordModelDiagnostic: (entry) => { diagnostics.unshift(entry); return entry; },
        persistTerminalModelDiagnostic: async () => true,
    };
    vm.runInNewContext(
        `${recordSource}\nthis.record = recordActorProfileFinalDiagnostic;`,
        sandbox,
    );
    const captured = { chatId: 'chat-a', index: 4 };
    assert.equal(await sandbox.record(captured, {
        status: 'atomic_readback', profileBatch: { readbackVerified: true },
    }, { recoverySaved: true }), true);
    assert.equal(diagnostics[0].status, 'succeeded');
    assert.equal(diagnostics[0].validationCode, 'actor_profile.final.atomic_readback');

    await sandbox.record(captured, {
        status: 'not_completed', profileBatch: { readbackVerified: false },
    }, { recoverySaved: true });
    assert.equal(diagnostics[0].status, 'failed');
    assert.equal(diagnostics[0].failureKind, 'actor_profile_terminal_failure');

    await sandbox.record(captured, {
        status: 'not_completed', profileBatch: { readbackVerified: false },
    }, { recoverySaved: false });
    assert.equal(diagnostics[0].failureKind, 'recovery_unavailable');
    const enqueueSource = sourceSection(
        'async function enqueueActorProfiles(targetId, {',
        'async function confirmDangerousAction(message)',
    );
    assert.match(enqueueSource, /await recordActorProfileFinalDiagnostic\(/u);
    assert.match(
        enqueueSource,
        /\.catch\(async \(error\) => \{[\s\S]*?recordActorProfileFinalDiagnostic\([\s\S]*?recoverySaved: false[\s\S]*?terminalDiagnosticPersisted[\s\S]*?actorProfileOwnerIsCurrent\(\)[\s\S]*?canRetry: false/u,
    );
});

test('production profile queue catch awaits the durable unavailable receipt before exposing a non-retryable failure', async () => {
    const enqueueSource = sourceSection(
        'async function enqueueActorProfiles(targetId, {',
        'async function confirmDangerousAction(message)',
    );
    let releaseDiagnostic;
    let signalDiagnostic;
    const diagnosticEntered = new Promise((resolve) => { signalDiagnostic = resolve; });
    const diagnosticWait = new Promise((resolve) => { releaseDiagnostic = resolve; });
    const expected = {
        chatId: 'chat-a', index: 4, epoch: 7,
        scopeDigest: 'scope-a', actorSovereigntyScope: {},
    };
    const state = { marks: 0, terminalCalls: 0, statuses: [] };
    const sandbox = {
        console: { error: () => undefined },
        operationEpoch: 7,
        actorWorldManagementWrite: null,
        getContext: () => ({ chatId: 'chat-a' }),
        latestAiMessage: () => ({ index: 4 }),
        captureTarget: () => structuredClone(expected),
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        operationToken: () => ({}),
        sameAcceptedNarrativeTarget: () => true,
        actorProfileChain: Promise.resolve(),
        readChatNamespace: () => ({ characterCreationTicketBatches: [] }),
        actorProfileTicketBatchPersistenceMatches: () => false,
        actorProfileRetryReceiptMatches: () => false,
        actorProfileRecoveryProgressFromReceipt: () => null,
        actorProfileRecoveryProgressFromNamespace: () => null,
        stage3AcceptedTargetKey: () => 'world-key',
        continuityPendingKeys: new Map(),
        actorProfileTargetStaleAutomaticRecoveryEligible: () => false,
        actorProfileAutomaticRecoveryResult: (_initial, recovered) => recovered,
        capturedTargetKey: () => 'profile-key',
        actorProfilePendingKeys: new Map(),
        actorProfileCompletedKeys: new Set(),
        userCancelledActorProfileKeys: new Set(),
        actorProfileTargetStateIsCurrent: (epoch, chatId) => (
            epoch === sandbox.operationEpoch && chatId === 'chat-a'
        ),
        setActorProfileStatus: (...args) => { state.statuses.push(args); },
        renderSovereigntyHealth: () => undefined,
        syncTaskCancelButtons: () => undefined,
        getSettings: () => ({ actorProfileCompletionMode: 'full' }),
        runActorProfileTarget: async () => { throw new Error('controlled profile failure'); },
        actorProfileTransientResult: (status, extra = {}) => ({ status, ...extra }),
        recordActorProfileFinalDiagnostic: async (_captured, _result, options) => {
            state.terminalCalls += 1;
            assert.equal(options.recoverySaved, false);
            signalDiagnostic();
            await diagnosticWait;
            return true;
        },
        sourceRefOf: () => ({ chatId: 'chat-a', index: 4 }),
        markActorSchedulingNotReachedByProfile: () => { state.marks += 1; },
        latestActorProfileDiagnostic: { status: 'waiting' },
    };
    vm.runInNewContext(
        `${enqueueSource}\nthis.enqueueProfile = enqueueActorProfiles;`,
        sandbox,
    );
    const task = sandbox.enqueueProfile(4, { force: true, expectedTarget: expected });
    await diagnosticEntered;
    assert.equal(state.marks, 0, 'failure state waits for its durable terminal receipt');
    releaseDiagnostic();
    const result = await task;
    assert.equal(result.status, 'not_completed');
    assert.equal(result.terminalDiagnosticPersisted, true);
    assert.equal(state.terminalCalls, 1);
    assert.equal(sandbox.latestActorProfileDiagnostic.canRetry, false);
    assert.equal(state.marks, 1);
});

test('profile queue automatically reuses a sealed target-stale recovery once with zero extra model calls', async () => {
    const recoveryHelpers = sourceSection(
        'function actorProfileTargetStaleAutomaticRecoveryEligible',
        'async function finalizeUserCancelledActorProfileCompletion',
    );
    const enqueueSource = sourceSection(
        'async function enqueueActorProfiles(targetId, {',
        'async function confirmDangerousAction(message)',
    );
    const expected = {
        chatId: 'chat-a', index: 4, epoch: 7,
        scopeDigest: 'scope-a', actorSovereigntyScope: {},
    };
    const state = {
        runCalls: 0, finalizeCalls: 0, terminalCalls: 0, marks: 0, statuses: [],
    };
    const initialFailure = {
        status: 'not_completed',
        reason: 'actor_profile.target_stale',
        profileBatch: {
            modelCalls: 4,
            failed: [
                { reason: 'actor_profile.target_stale' },
                { reason: 'actor_profile.target_stale' },
                { reason: 'actor_profile.target_stale' },
            ],
        },
    };
    const recovered = {
        status: 'atomic_readback',
        profileBatch: {
            modelCalls: 0,
            readbackVerified: true,
            committed: ['actor-a', 'actor-b', 'actor-c'],
            failed: [],
        },
    };
    const sandbox = {
        console: { error: () => undefined },
        operationEpoch: 7,
        actorWorldManagementWrite: null,
        getContext: () => ({ chatId: 'chat-a' }),
        latestAiMessage: () => ({ index: 4 }),
        captureTarget: () => structuredClone(expected),
        freshFrozenScopeGuard: async () => ({ ok: true }),
        continuityTargetIsCurrent: () => ({ ok: true }),
        operationToken: () => ({}),
        sameAcceptedNarrativeTarget: () => true,
        actorProfileChain: Promise.resolve(),
        readChatNamespace: () => ({ characterCreationTicketBatches: [] }),
        actorProfileTicketBatchPersistenceMatches: () => false,
        actorProfileRetryReceiptMatches: () => false,
        actorProfileRecoveryProgressFromReceipt: () => null,
        actorProfileRecoveryProgressFromNamespace: () => ({ verifiedFieldCount: 21 }),
        capturedTargetKey: () => 'profile-key',
        actorProfilePendingKeys: new Map(),
        actorProfileCompletedKeys: new Set(),
        userCancelledActorProfileKeys: new Set(),
        actorProfileTargetStateIsCurrent: (epoch, chatId) => (
            epoch === sandbox.operationEpoch && chatId === 'chat-a'
        ),
        setActorProfileStatus: (...args) => { state.statuses.push(args); },
        renderSovereigntyHealth: () => undefined,
        syncTaskCancelButtons: () => undefined,
        getSettings: () => ({ actorProfileCompletionMode: 'full' }),
        runActorProfileTarget: async (_target, options) => {
            state.runCalls += 1;
            if (state.runCalls === 1) return structuredClone(initialFailure);
            assert.equal(options.force, true);
            assert.equal(options.allowIdentityRetry, true);
            return structuredClone(recovered);
        },
        actorProfileTransientResult: (status, extra = {}) => ({ status, ...extra }),
        finalizeActorProfileRecoveryOutcome: async (_target, result) => {
            state.finalizeCalls += 1;
            return { result, recoverySaved: true };
        },
        finalizeUserCancelledActorProfileCompletion: async (_target, result) => ({
            handled: true, result, recoverySaved: false,
        }),
        recordActorProfileFinalDiagnostic: async () => {
            state.terminalCalls += 1;
            return true;
        },
        sourceRefOf: () => ({ chatId: 'chat-a', index: 4 }),
        compactActorProfileFailureCode: (value) => String(value || ''),
        actorProfileRecoverySourceMatches: () => true,
        stage3AcceptedTargetKey: () => 'world-key',
        continuityPendingKeys: new Map(),
        markActorSchedulingNotReachedByProfile: () => { state.marks += 1; },
        latestActorProfileDiagnostic: { status: 'waiting' },
    };
    vm.runInNewContext(
        `${recoveryHelpers}\n${enqueueSource}\nthis.enqueueProfile = enqueueActorProfiles;\nthis.recoveryEligible = actorProfileTargetStaleAutomaticRecoveryEligible;`,
        sandbox,
    );
    assert.equal(sandbox.recoveryEligible(initialFailure, {
        recoverySaved: true,
        recoveryProgress: { verifiedFieldCount: 21 },
        worldPending: true,
    }), false, 'an active world owner keeps the explicit repair fallback instead of risking a cycle');
    assert.equal(sandbox.recoveryEligible({
        ...initialFailure,
        profileBatch: {
            ...initialFailure.profileBatch,
            failed: [{ reason: 'actor_profile.schema_incomplete' }],
        },
    }, {
        recoverySaved: true,
        recoveryProgress: { verifiedFieldCount: 21 },
        worldPending: false,
    }), false, 'semantic failures never enter the concurrency-only recovery');
    assert.equal(sandbox.recoveryEligible({
        status: 'not_completed',
        profileBatch: {
            modelCalls: 1,
            failed: [
                { reason: 'actor_candidate.identity_missing_or_short' },
                { reason: 'actor_profile.target_stale' },
            ],
        },
    }, {
        recoverySaved: true,
        recoveryProgress: {
            identityAttempted: false,
            identityLocked: false,
            manualIdentityRetryCount: 1,
            verifiedFieldCount: 0,
            rows: [],
        },
        worldPending: false,
    }), true, 'one sealed empty identity failure is automatically retried after world settles');
    const result = await sandbox.enqueueProfile(4, {
        force: false,
        expectedTarget: expected,
    });
    assert.equal(result.status, 'atomic_readback');
    assert.equal(result.profileBatch.readbackVerified, true);
    assert.equal(result.profileBatch.modelCalls, 4);
    assert.equal(result.automaticRecovery.trigger, 'actor_profile.target_stale');
    assert.equal(result.automaticRecovery.recoveryModelCalls, 0);
    assert.equal(state.runCalls, 2, 'one normal attempt plus one bounded recovery');
    assert.equal(state.finalizeCalls, 2, 'failure receipt is sealed before terminal cleanup');
    assert.equal(state.terminalCalls, 1, 'only the recovered terminal result is published');
    assert.equal(state.marks, 0);
    assert.equal(sandbox.actorProfileCompletedKeys.has('profile-key'), true);
    assert.match(state.statuses.at(-1)?.[0] || '', /3 人整档已原子保存并回读验证/u);
});

test('normal profile completion publishes nothing after owner loss during finalize or terminal receipt await', async () => {
    const enqueueSource = sourceSection(
        'async function enqueueActorProfiles(targetId, {',
        'async function confirmDangerousAction(message)',
    );
    const exercise = async ({ waitAt, transition }) => {
        let releaseWait;
        let signalWait;
        const waitEntered = new Promise((resolve) => { signalWait = resolve; });
        const wait = new Promise((resolve) => { releaseWait = resolve; });
        const expected = {
            chatId: 'chat-a', index: 4, epoch: 7,
            scopeDigest: 'scope-a', actorSovereigntyScope: {},
        };
        const sentinelDiagnostic = { status: 'waiting', sentinel: true };
        const state = {
            chatId: 'chat-a', terminalCalls: 0, marks: 0,
            statuses: [], renders: 0, handledCancellations: 0,
        };
        const success = {
            status: 'atomic_readback',
            profileBatch: { readbackVerified: true, committed: [{}], failed: [] },
        };
        const sandbox = {
            console: { error: () => undefined },
            operationEpoch: 7,
            actorWorldManagementWrite: null,
            getContext: () => ({ chatId: state.chatId }),
            latestAiMessage: () => ({ index: 4 }),
            captureTarget: () => structuredClone(expected),
            freshFrozenScopeGuard: async () => ({ ok: true }),
            continuityTargetIsCurrent: () => ({ ok: true }),
            operationToken: () => ({}),
            sameAcceptedNarrativeTarget: () => true,
            actorProfileChain: waitAt === 'chain' ? wait : Promise.resolve(),
            readChatNamespace: () => ({ characterCreationTicketBatches: [] }),
            actorProfileTicketBatchPersistenceMatches: () => false,
            actorProfileRetryReceiptMatches: () => false,
            actorProfileRecoveryProgressFromReceipt: () => null,
            actorProfileRecoveryProgressFromNamespace: () => null,
            stage3AcceptedTargetKey: () => 'world-key',
            continuityPendingKeys: new Map(),
            actorProfileTargetStaleAutomaticRecoveryEligible: () => false,
            actorProfileAutomaticRecoveryResult: (_initial, recovered) => recovered,
            capturedTargetKey: () => 'profile-key',
            actorProfilePendingKeys: new Map(),
            actorProfileCompletedKeys: new Set(),
            userCancelledActorProfileKeys: new Set(),
            actorProfileTargetStateIsCurrent: (epoch, chatId) => (
                epoch === sandbox.operationEpoch && chatId === state.chatId
            ),
            setActorProfileStatus: (...args) => { state.statuses.push(args); },
            renderSovereigntyHealth: () => { state.renders += 1; },
            syncTaskCancelButtons: () => undefined,
            getSettings: () => ({ actorProfileCompletionMode: 'full' }),
            runActorProfileTarget: async () => structuredClone(success),
            actorProfileTransientResult: (status, extra = {}) => ({ status, ...extra }),
            finalizeActorProfileRecoveryOutcome: async (_target, result) => {
                if (waitAt === 'finalize') {
                    signalWait();
                    await wait;
                }
                return { result, recoverySaved: false };
            },
            finalizeUserCancelledActorProfileCompletion: async (_target, result) => {
                state.handledCancellations += 1;
                sandbox.userCancelledActorProfileKeys.delete('profile-key');
                return { handled: true, result, recoverySaved: false };
            },
            recordActorProfileFinalDiagnostic: async () => {
                state.terminalCalls += 1;
                if (waitAt === 'terminal') {
                    signalWait();
                    await wait;
                }
                return true;
            },
            sourceRefOf: () => ({ chatId: 'chat-a', index: 4 }),
            compactActorProfileFailureCode: (value) => String(value || ''),
            actorProfileRecoverySourceMatches: () => false,
            markActorSchedulingNotReachedByProfile: () => { state.marks += 1; },
            latestActorProfileDiagnostic: sentinelDiagnostic,
        };
        vm.runInNewContext(
            `${enqueueSource}\nthis.enqueueProfile = enqueueActorProfiles;`,
            sandbox,
        );
        const task = sandbox.enqueueProfile(4, { force: true, expectedTarget: expected });
        if (waitAt === 'chain') signalWait();
        await waitEntered;
        const baselineStatuses = state.statuses.length;
        const baselineRenders = state.renders;
        const replacementOwner = Symbol('replacement-owner');
        if (transition === 'new-owner') {
            sandbox.actorProfilePendingKeys.set('profile-key', replacementOwner);
            sandbox.userCancelledActorProfileKeys.add('profile-key');
        } else if (transition === 'chat') {
            state.chatId = 'chat-b';
        } else {
            sandbox.operationEpoch += 1;
            sandbox.actorProfilePendingKeys.clear();
            if (transition === 'handled-cancel') {
                sandbox.userCancelledActorProfileKeys.add('profile-key');
            }
        }
        releaseWait();
        await task;
        assert.equal(sandbox.actorProfileCompletedKeys.has('profile-key'), false);
        assert.equal(sandbox.latestActorProfileDiagnostic, sentinelDiagnostic);
        assert.equal(state.marks, 0);
        assert.equal(state.statuses.length, baselineStatuses);
        assert.equal(state.renders, baselineRenders);
        if (transition === 'new-owner') {
            assert.equal(sandbox.actorProfilePendingKeys.get('profile-key'), replacementOwner);
            assert.equal(
                sandbox.userCancelledActorProfileKeys.has('profile-key'),
                true,
                'an old finally must not delete the replacement owner cancellation marker',
            );
        }
        if (transition === 'handled-cancel') {
            assert.equal(state.handledCancellations, 1);
            assert.equal(sandbox.userCancelledActorProfileKeys.has('profile-key'), false);
        }
        assert.equal(state.terminalCalls, waitAt === 'terminal' ? 1 : 0);
    };

    await exercise({ waitAt: 'terminal', transition: 'new-owner' });
    await exercise({ waitAt: 'terminal', transition: 'cancel' });
    await exercise({ waitAt: 'terminal', transition: 'chat' });
    await exercise({ waitAt: 'finalize', transition: 'cancel' });
    await exercise({ waitAt: 'chain', transition: 'handled-cancel' });
});

test('durable profile recovery-unavailable remains a blocked fault without blind model retry', async () => {
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const adapterSource = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    const target = { chatId: 'chat-a', index: 4, digest: 'target-a' };
    const namespace = {};
    const diagnostics = [{
        at: 20,
        task: 'actor_profile_final',
        requestKind: 'actor_profile_batch',
        targetDigest: 'target-a',
        status: 'failed',
        failureKind: 'recovery_unavailable',
        validationCode: 'actor_profile.final.recovery_unavailable',
    }];
    const counters = { profileEnqueue: 0 };
    const sandbox = {
        modelDiagnostics: diagnostics,
        modelDiagnosticsForChat: (entries) => entries,
        doctorRepairTargetIdentityDigest: (value) => value.digest,
        readChatNamespace: () => namespace,
        hydratedActorProfileDiagnostic: () => ({ status: 'waiting', canRetry: false }),
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
        doctorRepairDiagnosticCounters: () => ({ modelCallCount: 0, writeCount: 0 }),
        doctorRepairCounterDelta: () => ({ modelCallCount: 0, writeCount: 0 }),
        enqueueActorProfiles: async () => {
            counters.profileEnqueue += 1;
            return { status: 'atomic_readback', profileBatch: { readbackVerified: true } };
        },
    };
    vm.runInNewContext(
        `${diagnosticSource}\n${selectorSource}\n${adapterSource}\n`
        + 'this.select = doctorRepairModulesNeedingRepair; '
        + 'this.runModule = runDoctorRepairModule;',
        sandbox,
    );

    const modules = Array.from(sandbox.select(target, namespace));
    assert.deepEqual(modules, ['profile']);
    sandbox.modelDiagnostics = structuredClone(diagnostics);
    assert.deepEqual(
        Array.from(sandbox.select(target, structuredClone(namespace))),
        ['profile'],
        'a refreshed durable terminal still exposes the blocked profile fault',
    );
    const plan = buildDoctorRepairPlan({
        requested: 'all', hasTarget: true, targetIndex: 4,
        targetDigest: 'target-a', enabledModules: modules,
    });
    const outcome = await executeDoctorRepairPlan(plan, {
        runModule: (module) => sandbox.runModule(module, target),
    });
    assert.equal(outcome.status, 'partial');
    assert.equal(outcome.code, 'doctor.repair.partial');
    assert.deepEqual(Array.from(outcome.actions, (entry) => ({
        module: entry.module,
        status: entry.status,
        code: entry.code,
        modelCallCount: entry.modelCallCount,
        writeCount: entry.writeCount,
        zeroWrite: entry.zeroWrite,
    })), [{
        module: 'profile',
        status: 'blocked',
        code: 'doctor.repair.profile.recovery_unavailable',
        modelCallCount: 0,
        writeCount: 0,
        zeroWrite: true,
    }]);
    assert.equal(counters.profileEnqueue, 0);
    const capsules = createDoctorRepairCapsules({
        runtimeFingerprint: 'runtime-critical:test',
        chatScopeDigest: 'scope-a',
        plan,
        outcome,
    });
    assert.equal(capsules[0].outcomeCode, 'doctor.repair.profile.recovery_unavailable');
});

test('production variable final diagnostic supersedes model success with durable outcome', async () => {
    const finalSource = sourceSection(
        'function recordVariableFinalDiagnostic(captured, result)',
        'async function waitForTargetSettled(',
    );
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const diagnostics = [];
    const state = { chatId: 'chat-a', schedules: 0, targetCurrent: true };
    const sandbox = {
        getContext: () => ({ chatId: state.chatId }),
        operationEpoch: 7,
        doctorTerminalDiagnosticTargetIsCurrent: () => state.targetCurrent,
        fingerprint: (value) => `scope:${value}`,
        doctorRepairTargetIdentityDigest: (target) => target.digest,
        recordModelDiagnostic: (entry) => {
            if (entry.chatScope !== `scope:${state.chatId}`) return null;
            diagnostics.unshift(entry);
            state.schedules += 1;
            return entry;
        },
        persistTerminalModelDiagnostic: async () => true,
        modelDiagnostics: diagnostics,
        modelDiagnosticsForChat: (entries) => entries,
        hydratedActorProfileDiagnostic: () => ({ status: 'waiting', canRetry: false }),
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
    };
    vm.runInNewContext(
        `${finalSource}\n${diagnosticSource}\n${selectorSource}\n`
        + 'this.recordFinal = recordVariableFinalDiagnostic; '
        + 'this.select = doctorRepairModulesNeedingRepair;',
        sandbox,
    );
    const target = {
        chatId: 'chat-a', index: 4, epoch: 7, digest: 'aaaaaaaa',
    };
    diagnostics.unshift({
        targetDigest: 'aaaaaaaa', task: '变量诊断', status: 'succeeded',
    });
    await sandbox.recordFinal(target, {
        status: 'applied', readbackVerified: false, frontendSynced: false,
    });
    assert.equal(diagnostics[0].validationCode, 'variable.final.readback_unverified');
    assert.deepEqual(Array.from(sandbox.select(target, {})), ['variable']);
    assert.equal(
        createPrivacySafeDiagnosticProjection({ modelDiagnostics: diagnostics })
            .modelDiagnostics[0].validationCode,
        'variable.final.readback_unverified',
    );

    await sandbox.recordFinal(target, {
        status: 'applied', readbackVerified: true, frontendSynced: true,
    });
    assert.deepEqual(Array.from(sandbox.select(target, {})), []);

    await sandbox.recordFinal(target, { status: 'stale' });
    assert.equal(diagnostics[0].cancelReason, 'cancelled');
    assert.deepEqual(Array.from(sandbox.select(target, {})), []);
    assert.deepEqual(Array.from(sandbox.select({ index: 4, digest: 'bbbbbbbb' }, {})), []);

    const beforeTargetDriftCount = diagnostics.length;
    const beforeTargetDriftSchedules = state.schedules;
    state.targetCurrent = false;
    await sandbox.recordFinal(target, {
        status: 'failed', failureCode: 'variable.persist_failed',
    });
    assert.equal(diagnostics.length, beforeTargetDriftCount);
    assert.equal(state.schedules, beforeTargetDriftSchedules);
    state.targetCurrent = true;

    const beforeSwitchCount = diagnostics.length;
    const beforeSwitchSchedules = state.schedules;
    state.chatId = 'chat-b';
    await sandbox.recordFinal(target, {
        status: 'failed', failureCode: 'variable.persist_failed',
    });
    assert.equal(diagnostics.length, beforeSwitchCount);
    assert.equal(state.schedules, beforeSwitchSchedules);
});

test('terminal diagnostics merge concurrent field drift and require durable readback before settlement', async () => {
    const persistenceSource = sourceSection(
        'function terminalModelDiagnosticKey(entry)',
        'function modelCallTaskKey(task)',
    );
    const state = {
        current: true,
        writes: 0,
        namespace: {
            modelDiagnostics: [{ at: 1, task: 'older', status: 'succeeded', targetIndex: 4 }],
            actorLedger: { untouched: true },
        },
    };
    const sandbox = {
        fingerprint: (value) => Buffer.from(String(value), 'utf8').toString('hex'),
        safeJson: JSON.stringify,
        normalizedModelDiagnostics: (value) => (Array.isArray(value) ? value : [])
            .map((entry) => ({ ...entry })),
        doctorRepairCenterTargetIsCurrent: () => state.current,
        doctorTerminalDiagnosticTargetIsCurrent: () => state.current,
        readChatNamespace: () => structuredClone(state.namespace),
        getContext: () => ({ chatId: 'chat-a' }),
        deepClone: (value) => structuredClone(value),
        stage3FieldState: (namespace, field) => ({
            revision: namespace.modelDiagnostics.length, field,
        }),
        writeChatNamespace: async (candidate, _chatId, options) => {
            state.writes += 1;
            if (state.writes === 1) {
                state.namespace.modelDiagnostics.unshift({
                    at: 2, task: 'concurrent', status: 'failed', targetIndex: 4,
                });
                return false;
            }
            assert.equal(options.precondition(), true);
            state.namespace = structuredClone(candidate);
            assert.equal(options.contentValidator(state.namespace), true);
            options.successSink.readbackNamespace = structuredClone(state.namespace);
            return true;
        },
    };
    vm.runInNewContext(
        `${persistenceSource}\nthis.persist = persistTerminalModelDiagnostic;`,
        sandbox,
    );
    const target = { chatId: 'chat-a', index: 4 };
    const receipt = {
        at: 3, chatScope: 'aaaaaaaa', task: 'variable_final', status: 'failed',
        targetIndex: 4, targetDigest: 'bbbbbbbb', validationCode: 'variable.final.failed',
    };
    assert.equal(await sandbox.persist(target, receipt), true);
    assert.equal(state.writes, 2);
    assert.equal(state.namespace.actorLedger.untouched, true);
    assert.deepEqual(
        state.namespace.modelDiagnostics.map((entry) => entry.task),
        ['variable_final', 'concurrent', 'older'],
    );

    state.current = false;
    const writesBeforeStale = state.writes;
    assert.equal(await sandbox.persist(target, { ...receipt, at: 4 }), false);
    assert.equal(state.writes, writesBeforeStale);

    const enqueueSource = sourceSection(
        'function enqueue(targetId, options = {})',
        'async function undoLastUnlocked()',
    );
    assert.match(enqueueSource, /await recordVariableFinalDiagnostic\(/u);
    const worldQueue = sourceSection(
        'async function enqueueContinuity(targetId, {',
        'function stage3AttemptProjection(ledger, target)',
    );
    assert.match(worldQueue, /await recordStage3WorldFinalDiagnostic\(/u);
});

test('accepted-final/P4 activity permits terminal receipts but every target drift remains zero-write', async () => {
    const guardSource = sourceSection(
        'function doctorRepairTargetIdentityDigest(captured)',
        'function doctorRepairDiagnosticCounters(module, targetIndex)',
    );
    const persistenceSource = sourceSection(
        'function terminalModelDiagnosticKey(entry)',
        'function modelCallTaskKey(task)',
    );
    const captured = {
        chatId: 'chat-a', messageId: 'message-a', index: 4, swipeId: 0,
        generationSerial: 3, generationId: 'generation-a', generationType: 'normal',
        contentFingerprint: 'content-a', scopeDigest: 'scope-a', epoch: 7,
    };
    const state = {
        chatId: 'chat-a', scopeDigest: 'scope-a', fresh: { ...captured }, writes: 0,
    };
    const sandbox = {
        operationEpoch: 7,
        actorWorldManagementWrite: null,
        actorWorldManagementBlockedByForeground: () => true,
        getContext: () => ({ chatId: state.chatId }),
        currentActorSovereigntyScope: () => ({ digest: state.scopeDigest }),
        actorSovereigntyScopeDigest: (scope) => scope.digest,
        captureDoctorRepairTargetReadOnly: () => ({ ...state.fresh }),
        sameAcceptedNarrativeTarget: (left, right) => (
            left.chatId === right.chatId
            && left.messageId === right.messageId
            && left.swipeId === right.swipeId
            && left.generationId === right.generationId
            && left.generationType === right.generationType
            && left.contentFingerprint === right.contentFingerprint
        ),
        safeJson: JSON.stringify,
        fingerprint: (value) => Buffer.from(String(value), 'utf8').toString('hex'),
        normalizedModelDiagnostics: (value) => Array.isArray(value) ? value : [],
        readChatNamespace: () => ({ modelDiagnostics: [] }),
        deepClone: (value) => structuredClone(value),
        stage3FieldState: () => ({ revision: 0, digest: 'empty' }),
        writeChatNamespace: async (candidate, _chatId, options) => {
            if (!options.precondition()) return false;
            state.writes += 1;
            options.successSink.readbackNamespace = structuredClone(candidate);
            return true;
        },
    };
    vm.runInNewContext(
        `${guardSource}\n${persistenceSource}\nthis.persist = persistTerminalModelDiagnostic; `
        + 'this.centerCurrent = doctorRepairCenterTargetIsCurrent;',
        sandbox,
    );
    const receipt = {
        at: 1, task: 'actor_profile_final', status: 'succeeded',
        targetIndex: 4, targetDigest: 'target-a', validationCode: 'actor_profile.final.atomic_readback',
    };
    assert.equal(sandbox.centerCurrent(captured), false);
    assert.equal(await sandbox.persist(captured, receipt), true);
    assert.equal(state.writes, 1);

    const baselineWrites = state.writes;
    for (const mutate of [
        () => { state.chatId = 'chat-b'; },
        () => { state.fresh = { ...captured, swipeId: 1 }; },
        () => { state.fresh = { ...captured, generationId: 'generation-b' }; },
        () => { state.fresh = { ...captured, contentFingerprint: 'content-b' }; },
        () => { state.scopeDigest = 'scope-b'; },
        () => { sandbox.operationEpoch = 8; },
    ]) {
        state.chatId = 'chat-a';
        state.scopeDigest = 'scope-a';
        state.fresh = { ...captured };
        sandbox.operationEpoch = 7;
        mutate();
        assert.equal(await sandbox.persist(captured, { ...receipt, at: receipt.at + 1 }), false);
        assert.equal(state.writes, baselineWrites);
    }
});

test('world terminal diagnostics require applied plus durable readback before clearing repair-all', async () => {
    const recordSource = sourceSection(
        'async function recordStage3WorldFinalDiagnostic(captured, result)',
        'function stage3WorldFailureValidationCode(reason)',
    );
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const diagnostics = [{
        at: 1, task: 'world_continuity', status: 'failed', targetDigest: 'deadbeef',
        failureKind: 'world_failed',
    }];
    const sandbox = {
        doctorRepairCenterTargetIsCurrent: () => true,
        doctorTerminalDiagnosticTargetIsCurrent: () => true,
        fingerprint: () => 'scope-a',
        doctorRepairTargetIdentityDigest: () => 'deadbeef',
        recordModelDiagnostic: (entry) => { diagnostics.unshift(entry); return entry; },
        persistTerminalModelDiagnostic: async () => true,
        modelDiagnostics: diagnostics,
        modelDiagnosticsForChat: (entries) => entries,
        hydratedActorProfileDiagnostic: () => ({ status: 'waiting', canRetry: false }),
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
    };
    vm.runInNewContext(
        `${recordSource}\n${diagnosticSource}\n${selectorSource}\n`
        + 'this.record = recordStage3WorldFinalDiagnostic; '
        + 'this.select = doctorRepairModulesNeedingRepair;',
        sandbox,
    );
    const captured = { chatId: 'chat-a', index: 4 };
    const unverified = { status: 'applied', recovered: true, worldFinalPhase: 'world_committed' };
    assert.equal(await sandbox.record(captured, unverified), true);
    assert.equal(diagnostics[0].status, 'failed');
    assert.equal(diagnostics[0].validationCode, 'world.committed.readback_unverified');
    assert.deepEqual(Array.from(sandbox.select(captured, {})), ['world']);

    const verified = {
        status: 'applied', recovered: true, readbackVerified: true,
        worldFinalPhase: 'world_committed',
    };
    assert.equal(await sandbox.record(captured, verified), true);
    assert.equal(diagnostics[0].status, 'recovered');
    assert.deepEqual(Array.from(sandbox.select(captured, {})), []);

    for (const cancellationStatus of ['disabled', 'stale', 'duplicate']) {
        assert.equal(await sandbox.record(captured, { status: cancellationStatus }), true);
        assert.equal(diagnostics[0].failureKind, 'cancelled');
        assert.equal(diagnostics[0].cancelReason, 'cancelled');
        assert.deepEqual(Array.from(sandbox.select(captured, {})), []);
        const noWork = buildDoctorRepairPlan({
            requested: 'all', hasTarget: true, targetIndex: 4,
            targetDigest: 'deadbeef', enabledModules: sandbox.select(captured, {}),
        });
        assert.equal(noWork.status, 'nochange');
        assert.deepEqual(noWork.modules, []);
    }

    const runSource = sourceSection(
        'async function runDoctorRepairCenterUnlocked(',
        'function doctorRepairCenterRequestKey(',
    );
    const zeroWorkCounters = { modules: 0, journals: 0 };
    Object.assign(sandbox, {
        getContext: () => ({ chatId: 'chat-a' }),
        readChatNamespace: () => ({}),
        buildDoctorRepairPlan,
        doctorRepairCenterForegroundActive: () => false,
        doctorRepairCenterTargetIsCurrent: () => true,
        setDoctorRepairCenterStatus: () => undefined,
        executeDoctorRepairPlan,
        runDoctorRepairModuleRequest: async () => {
            zeroWorkCounters.modules += 1;
            return { status: 'applied', readbackVerified: true };
        },
        doctorRepairCenterQueueGeneration: 0,
        doctorRepairCenterPrepareModuleRequests: () => undefined,
        persistDoctorRepairCapsules: async () => {
            zeroWorkCounters.journals += 1;
            return true;
        },
    });
    vm.runInNewContext(`${runSource}\nthis.runAll = runDoctorRepairCenterUnlocked;`, sandbox);
    const worldOff = await sandbox.runAll('all', captured, 'deadbeef');
    assert.equal(worldOff.status, 'nochange');
    assert.deepEqual(Array.from(worldOff.actions), []);
    assert.equal(worldOff.modelCallCount, 0);
    assert.equal(worldOff.writeCount, 0);
    assert.deepEqual(zeroWorkCounters, { modules: 0, journals: 0 });

    assert.equal(await sandbox.record(captured, { status: 'blocked' }), true);
    assert.equal(diagnostics[0].failureKind, 'world_blocked');
    assert.equal(diagnostics[0].cancelReason, '');
    assert.deepEqual(Array.from(sandbox.select(captured, {})), ['world']);
});

test('existing committed world recovery succeeds only from strict durable readback', async () => {
    const helperSource = sourceSection(
        'async function stage3ExistingCommittedPackageReadback(context, captured, namespace)',
        'function stage3CommittedCheckpointIsPriorTerminal(',
    );
    const state = {
        verified: false,
        readbackGate: null,
        durable: {
            continuity: { packet: { id: 'durable-packet' } },
            continuityCheckpoint: {
                stage3Phase: 'world_committed',
                target: { id: 'target-a' },
                stage3ProducerTarget: { id: 'producer-a' },
            },
            actorLedger: { strict: true },
        },
    };
    const sandbox = {
        actorActionTargetOf: () => ({ id: 'target-a' }),
        actorActionTargetMatches: (left, right) => left?.id === right?.id,
        stage3AcceptedTarget: () => ({ id: 'producer-a' }),
        stage3AcceptedTargetsMatch: (left, right) => left?.id === right?.id,
        normalizeActorLedger: (ledger) => ledger,
        stage3PersistedPackageForTarget: (continuity, ledger, _captured, options) => {
            state.packageOptions = structuredClone(options || {});
            return continuity?.packet && ledger?.strict
                && options?.allowUnrelatedLedgerEvolution === true
                ? continuity.packet : null;
        },
        deepClone: (value) => structuredClone(value),
        verifyPersistedChatNamespace: async (_context, _chatId, _candidate, fields, options) => {
            assert.deepEqual(Array.from(fields), ['continuity', 'continuityCheckpoint']);
            if (state.readbackGate) await state.readbackGate;
            const contentValid = options.contentValidator(state.durable);
            return state.verified && contentValid
                ? { verified: true, namespace: structuredClone(state.durable) }
                : { verified: false, failureCode: 'host_save_readback_unverified' };
        },
    };
    vm.runInNewContext(`${helperSource}\nthis.readback = stage3ExistingCommittedPackageReadback;`, sandbox);
    const context = { chatId: 'chat-a' };
    const captured = { chatId: 'chat-a', identityScopeId: 'identity-a', scopeDigest: 'scope-a' };
    const candidate = structuredClone(state.durable);
    assert.equal((await sandbox.readback(context, captured, candidate)).ok, false);
    state.verified = true;
    const verified = await sandbox.readback(context, captured, candidate);
    assert.equal(verified.ok, true);
    assert.equal(verified.packet.id, 'durable-packet');
    assert.equal(state.packageOptions.allowUnrelatedLedgerEvolution, true);

    let releaseReadback;
    state.readbackGate = new Promise((resolve) => { releaseReadback = resolve; });
    const profileEvolution = sandbox.readback(context, captured, candidate);
    await new Promise((resolve) => setImmediate(resolve));
    state.durable.actorLedger = { strict: true, profileRevision: 2 };
    releaseReadback();
    assert.equal((await profileEvolution).ok, true);
    state.readbackGate = null;

    state.durable.actorLedger = { strict: false, sameTargetAttOrReceiptDrift: true };
    assert.equal(
        (await sandbox.readback(context, captured, candidate)).ok,
        false,
        'same-target ATT/receipt authority drift remains fail-closed',
    );
    state.durable.actorLedger = { strict: true, profileRevision: 2 };
    state.durable.continuityCheckpoint.stage3ProducerTarget.id = 'wrong';
    assert.equal((await sandbox.readback(context, captured, candidate)).ok, false);

    const runSource = sourceSection(
        'async function runContinuityTarget(captured, {',
        'async function enqueueContinuity(targetId, {',
    );
    assert.match(runSource, /await stage3ExistingCommittedPackageReadback\(/u);
    assert.match(
        runSource,
        /stage3PersistedPackageForTarget\([\s\S]*?profileGate\.actorLedger,[\s\S]*?captured,[\s\S]*?allowUnrelatedLedgerEvolution: true/u,
    );
    assert.match(runSource, /readbackVerified:\s*true/u);
});

test('Doctor capsule persistence fresh-merges one CAS conflict without losing undo or peers', async () => {
    const persistenceSource = sourceSection(
        'function mergeDoctorRepairCapsules(repairJournal, capsules)',
        'async function persistVariableRepairBugCapsule(',
    );
    const state = {
        current: true,
        writes: 0,
        namespace: {
            repairJournal: [
                { id: 'undo-1', repairKind: 'undo' },
                { id: 'peer-1', repairKind: 'doctor-unified-repair-center' },
            ],
        },
    };
    const sandbox = {
        deepClone: (value) => structuredClone(value),
        compactRepairJournalWithVariableCapsules: (journal) => journal,
        readChatNamespace: () => structuredClone(state.namespace),
        getContext: () => ({ chatId: 'chat-a' }),
        stage3FieldState: (namespace, field) => ({
            revision: namespace.repairJournal.length, field,
        }),
        writeRepairJournal: async (candidate, _chatId, options) => {
            state.writes += 1;
            if (state.writes === 1) {
                state.namespace.repairJournal.push({
                    id: 'concurrent-1', repairKind: 'doctor-unified-repair-center',
                });
                return false;
            }
            assert.equal(options.precondition(), true);
            state.namespace.repairJournal = structuredClone(candidate);
            options.successSink.readbackNamespace = structuredClone(state.namespace);
            return true;
        },
    };
    vm.runInNewContext(
        `${persistenceSource}\nthis.persist = persistDoctorRepairCapsuleBatch;`,
        sandbox,
    );
    const desired = {
        id: 'desired-1', repairKind: 'doctor-unified-repair-center', module: 'profile',
    };
    assert.equal(await sandbox.persist([desired], 'chat-a', () => state.current), true);
    assert.equal(state.writes, 2);
    assert.deepEqual(
        state.namespace.repairJournal.map((entry) => entry.id),
        ['undo-1', 'peer-1', 'concurrent-1', 'desired-1'],
    );

    const writesBeforeStale = state.writes;
    state.current = false;
    assert.equal(await sandbox.persist([{ ...desired, id: 'stale-1' }], 'chat-a', () => state.current), false);
    assert.equal(state.writes, writesBeforeStale);
});

test('Doctor repair zero-write evidence is conservative for profile and world failures', () => {
    const helperSource = sourceSection(
        'function doctorRepairResultZeroWrite(result)',
        'function doctorRepairCapsuleNeedsModule(',
    );
    const sandbox = {};
    vm.runInNewContext(`${helperSource}\nthis.zeroWrite = doctorRepairResultZeroWrite;`, sandbox);
    assert.equal(sandbox.zeroWrite({ status: 'failed' }), false);
    assert.equal(sandbox.zeroWrite({ status: 'failed', zeroWrite: true }), true);
    assert.equal(sandbox.zeroWrite({ status: 'failed', zeroWrite: false }), false);
    assert.equal(sandbox.zeroWrite({ status: 'failed', writeCount: 0 }), true);
    assert.equal(sandbox.zeroWrite({ status: 'failed', writeCount: 1 }), false);

    const adapter = sourceSection(
        'async function runDoctorRepairModule(module, captured)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    assert.equal(
        (adapter.match(/zeroWrite:\s*doctorRepairResultZeroWrite\(repaired\)/gu) || []).length,
        2,
    );
    assert.doesNotMatch(adapter, /zeroWrite:\s*!applied/gu);
});

test('strict target digest separates swipe, generation, content, and scope and selectors ignore old capsules', () => {
    const digestSource = sourceSection(
        'function doctorRepairTargetIdentityDigest(captured)',
        'function doctorRepairCenterForegroundActive()',
    );
    const selectorSource = sourceSection(
        'function doctorRepairCapsuleNeedsModule(namespace, module, targetDigest)',
        'async function runDoctorRepairModule(module, captured)',
    );
    const diagnosticSource = sourceSection(
        'function doctorRepairDiagnosticModule(entry)',
        'function doctorRepairCounterDelta(before, after)',
    );
    const sandbox = {
        safeJson: JSON.stringify,
        fingerprint: (value) => Buffer.from(String(value), 'utf8').toString('hex'),
        hydratedActorProfileDiagnostic: () => ({ status: 'waiting', canRetry: false }),
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
        modelDiagnostics: [],
        modelDiagnosticsForChat: (entries) => entries,
    };
    vm.runInNewContext(`${digestSource}\n${diagnosticSource}\n${selectorSource}\nthis.digest = doctorRepairTargetIdentityDigest; this.select = doctorRepairModulesNeedingRepair;`, sandbox);
    const base = {
        chatId: 'chat-a', messageId: 'message-a', index: 4, swipeId: 0,
        generationSerial: 3, generationId: 'generation-a', generationType: 'normal',
        contentFingerprint: 'content-a', scopeDigest: 'scope-a',
    };
    const baseDigest = sandbox.digest(base);
    for (const change of [
        { swipeId: 1 },
        { generationSerial: 4 },
        { generationId: 'generation-b' },
        { contentFingerprint: 'content-b' },
        { scopeDigest: 'scope-b' },
    ]) {
        const fresh = { ...base, ...change };
        assert.notEqual(sandbox.digest(fresh), baseDigest);
        const selected = sandbox.select(fresh, {
            repairJournal: [{
                repairKind: 'doctor-unified-repair-center', module: 'variable',
                targetDigest: baseDigest, status: 'needs_update',
            }],
        });
        assert.deepEqual(Array.from(selected), []);
    }
    assert.deepEqual(Array.from(sandbox.select(base, {
        repairJournal: [{
            repairKind: 'doctor-unified-repair-center', module: 'variable',
            targetDigest: baseDigest, status: 'needs_update',
        }],
    })), ['variable']);
});

test('repair-all target discovery is completely read-only and rejects identity-less messages', async () => {
    const idSource = sourceSection(
        'function readOnlyMessageStableId(context, message, index)',
        'function currentSwipeInfo(message)',
    );
    const captureSource = sourceSection(
        'function captureDoctorRepairTargetReadOnly(context, index, {',
        'function commitCandidate(',
    );
    const requestSource = sourceSection(
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
        'function renderSocialAuditImpl()',
    );
    const state = { saveCalls: 0, modelCalls: 0, namespaceWrites: 0 };
    const message = {
        is_user: false, is_system: false, mes: 'accepted', send_date: 'legacy-stable',
        swipe_id: 0, extra: {},
    };
    const context = {
        chatId: 'chat-a',
        chat: [{ is_user: true, mes: 'go' }, message],
        saveChat: () => { state.saveCalls += 1; },
    };
    const sandbox = {
        continuationIdentityHint: null,
        currentSwipeInfo: () => null,
        assistantTargetHasPriorRealPlayerInput: () => true,
        ensureRuntimeTargetIdentity: () => ({
            generationId: 'generation-a', generationSerial: 1, generationType: 'normal',
        }),
        createActorSovereigntyScope: (scope) => scope,
        currentActorSovereigntyScope: () => ({ chatId: 'chat-a', cardId: 'card-a' }),
        actorSovereigntyScopeDigest: () => 'scope-a',
        frozenIdentityScopeId: () => 'identity-a',
        actorIdentityScopeId: () => 'identity-a',
        fingerprint: (value) => `hash:${String(value)}`,
        acceptedContentFingerprint: () => 'content-a',
        operationEpoch: 3,
        doctorRepairCenterChain: Promise.resolve(),
        doctorRepairCenterRequests: new Map(),
        doctorRepairCenterModuleRequests: new Map(),
        doctorRepairCenterQueueGeneration: 0,
        resolveCurrentActorSovereigntyScope: async () => ({
            resolved: true,
            scope: { chatId: 'chat-a', cardId: 'card-a' },
        }),
        syncTaskCancelButtons: () => undefined,
        latestDoctorRepairCenterKind: 'busy',
        setDoctorRepairCenterStatus: (text, kind, options) => {
            sandbox.cancelledStatus = { text, kind, options };
        },
        getContext: () => context,
        latestAiMessage: () => ({ index: 1 }),
        doctorRepairTargetIdentityDigest: (target) => target ? 'deadbeef' : '',
        doctorRepairCenterModuleKey: (module, digest) => `${digest}:${module}`,
        doctorRepairJoinedModuleOutcome: (_module, _captured, _digest, result) => result,
        releaseDoctorRepairModuleRequests: () => undefined,
        runDoctorRepairCenterUnlocked: async (_requested, captured) => (
            captured
                ? {
                    status: 'nochange', code: 'doctor.repair.no_faults_detected',
                    modelCallCount: state.modelCalls, writeCount: state.namespaceWrites,
                }
                : { status: 'blocked', code: 'doctor.repair.target_unavailable' }
        ),
    };
    vm.runInNewContext(
        `${idSource}\n${captureSource}\n${requestSource}\n`
        + 'this.capture = captureDoctorRepairTargetReadOnly; this.run = runDoctorRepairCenter;',
        sandbox,
    );
    const captured = sandbox.capture(context, 1);
    assert.equal(captured.messageId, 'legacy-stable');
    assert.equal((await sandbox.run('all')).status, 'nochange');
    assert.deepEqual(state, { saveCalls: 0, modelCalls: 0, namespaceWrites: 0 });

    message.send_date = null;
    assert.equal(sandbox.capture(context, 1), null);
    assert.equal((await sandbox.run('all')).code, 'doctor.repair.target_unavailable');
    assert.deepEqual(state, { saveCalls: 0, modelCalls: 0, namespaceWrites: 0 });
});

test('the first repair click resolves the live sovereignty scope before freezing its target', async () => {
    const idSource = sourceSection(
        'function readOnlyMessageStableId(context, message, index)',
        'function currentSwipeInfo(message)',
    );
    const captureSource = sourceSection(
        'function captureDoctorRepairTargetReadOnly(context, index, {',
        'function commitCandidate(',
    );
    const requestSource = sourceSection(
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
        'function renderSocialAuditImpl()',
    );
    const state = { cachedScope: 'fallback', resolved: 0, capturedScope: '' };
    const context = {
        chatId: 'chat-a',
        chat: [
            { is_user: true, mes: 'go' },
            { is_user: false, is_system: false, mes: 'accepted', send_date: 'stable-id', extra: {} },
        ],
    };
    const sandbox = {
        continuationIdentityHint: null,
        currentSwipeInfo: () => null,
        assistantTargetHasPriorRealPlayerInput: () => true,
        ensureRuntimeTargetIdentity: () => ({
            generationId: 'generation-a', generationSerial: 1, generationType: 'normal',
        }),
        createActorSovereigntyScope: (scope) => ({ ...scope }),
        currentActorSovereigntyScope: () => ({
            chatId: 'chat-a', cardId: 'card-a', selector: state.cachedScope,
        }),
        resolveCurrentActorSovereigntyScope: async () => {
            state.resolved += 1;
            state.cachedScope = 'embedded-live';
            return {
                resolved: true,
                scope: { chatId: 'chat-a', cardId: 'card-a', selector: 'embedded-live' },
            };
        },
        actorSovereigntyScopeDigest: (scope) => `scope:${scope?.selector || ''}`,
        frozenIdentityScopeId: () => 'identity-a',
        actorIdentityScopeId: () => 'identity-a',
        fingerprint: (value) => `hash:${String(value)}`,
        acceptedContentFingerprint: () => 'content-a',
        operationEpoch: 3,
        doctorRepairCenterChain: Promise.resolve(),
        doctorRepairCenterRequests: new Map(),
        doctorRepairCenterModuleRequests: new Map(),
        doctorRepairCenterQueueGeneration: 0,
        syncTaskCancelButtons: () => undefined,
        latestDoctorRepairCenterKind: '',
        setDoctorRepairCenterStatus: () => undefined,
        getContext: () => context,
        latestAiMessage: () => ({ index: 1 }),
        doctorRepairTargetIdentityDigest: (target) => target?.scopeDigest || '',
        doctorRepairCenterModuleKey: (module, digest) => `${digest}:${module}`,
        doctorRepairJoinedModuleOutcome: (_module, _captured, _digest, result) => result,
        releaseDoctorRepairModuleRequests: () => undefined,
        runDoctorRepairCenterUnlocked: async (_requested, captured) => {
            state.capturedScope = captured?.scopeDigest || '';
            return { status: 'nochange' };
        },
    };
    vm.runInNewContext(
        `${idSource}\n${captureSource}\n${requestSource}\nthis.run = runDoctorRepairCenter;`,
        sandbox,
    );
    assert.equal((await sandbox.run('profile')).status, 'nochange');
    assert.equal(state.resolved, 1);
    assert.equal(state.capturedScope, 'scope:embedded-live');
});

test('repair-all profile health projection reuses the frozen read-only target', () => {
    const idSource = sourceSection(
        'function readOnlyMessageStableId(context, message, index)',
        'function currentSwipeInfo(message)',
    );
    const captureSource = sourceSection(
        'function captureDoctorRepairTargetReadOnly(context, index, {',
        'function commitCandidate(',
    );
    const profileSource = sourceSection(
        'function hydratedActorProfileDiagnostic(',
        'let latestActorShardDiagnostics =',
    );
    const selectorSource = sourceSection(
        'function doctorRepairModulesNeedingRepair(captured, namespace = readChatNamespace())',
        'async function runDoctorRepairModule(module, captured)',
    );
    const state = { captureTargetCalls: 0, saves: 0 };
    const context = {
        chatId: 'chat-a',
        chat: [
            { is_user: true, mes: 'go' },
            { is_user: false, is_system: false, mes: 'accepted', send_date: 'legacy-id', extra: {} },
        ],
        saveChat: () => { state.saves += 1; },
    };
    const sandbox = {
        continuationIdentityHint: null,
        currentSwipeInfo: () => null,
        assistantTargetHasPriorRealPlayerInput: () => true,
        ensureRuntimeTargetIdentity: () => ({
            generationId: 'generation-a', generationSerial: 1, generationType: 'normal',
        }),
        createActorSovereigntyScope: (scope) => scope,
        currentActorSovereigntyScope: () => ({ chatId: 'chat-a' }),
        actorSovereigntyScopeDigest: () => 'scope-a',
        frozenIdentityScopeId: () => 'identity-a',
        actorIdentityScopeId: () => 'identity-a',
        fingerprint: (value) => `hash:${String(value)}`,
        acceptedContentFingerprint: () => 'content-a',
        operationEpoch: 3,
        latestAiMessage: () => ({ index: 1 }),
        getContext: () => context,
        captureTarget: () => { state.captureTargetCalls += 1; return null; },
        sourceRefOf: (target) => ({ messageId: target?.messageId || '' }),
        latestActorProfileDiagnostic: { status: 'waiting' },
        actorProfileRecoverySourceMatches: () => false,
        actorProfileNoCandidatesTerminalReadbackMatches: () => false,
        actorProfileTicketBatchPersistenceMatches: () => false,
        actorProfileRetryReceiptMatches: () => false,
        actorProfileRecoveryProgressFromReceipt: () => null,
        doctorRepairTargetIdentityDigest: () => 'deadbeef',
        doctorRepairCapsuleNeedsModule: () => false,
        doctorRepairDiagnosticNeedsModule: () => false,
        doctorRepairModuleEventNeedsRepair: () => false,
        doctorRepairLatestModuleEvent: () => ({ kind: 'none', needsRepair: false }),
        checkpointLogicalReplyMatches: () => false,
        doctorRepairModulesFromSignals,
    };
    vm.runInNewContext(
        `${idSource}\n${captureSource}\n${profileSource}\n${selectorSource}\n`
        + 'this.capture = captureDoctorRepairTargetReadOnly; '
        + 'this.select = doctorRepairModulesNeedingRepair;',
        sandbox,
    );
    const captured = sandbox.capture(context, 1);
    assert.equal(captured.messageId, 'legacy-id');
    assert.deepEqual(Array.from(sandbox.select(captured, {})), []);
    assert.equal(state.captureTargetCalls, 0);
    assert.equal(state.saves, 0);
});

test('live sovereignty scope is part of the current-target guard while terminal receipts remain launch-safe', () => {
    const guardSource = sourceSection(
        'function doctorRepairTargetIdentityDigest(captured)',
        'function doctorRepairDiagnosticCounters(module, targetIndex)',
    );
    const state = { scopeDigest: 'scope-a', foreground: false };
    const captured = {
        chatId: 'chat-a', messageId: 'message-a', index: 4, swipeId: 0,
        generationSerial: 3, generationId: 'generation-a', generationType: 'normal',
        contentFingerprint: 'content-a', scopeDigest: 'scope-a', epoch: 7,
    };
    const sandbox = {
        operationEpoch: 7,
        safeJson: JSON.stringify,
        fingerprint: (value) => Buffer.from(String(value), 'utf8').toString('hex'),
        actorWorldManagementWrite: null,
        actorWorldManagementBlockedByForeground: () => state.foreground,
        getContext: () => ({ chatId: 'chat-a' }),
        currentActorSovereigntyScope: () => ({ digest: state.scopeDigest }),
        actorSovereigntyScopeDigest: (scope) => scope.digest,
        captureDoctorRepairTargetReadOnly: () => ({ ...captured, scopeDigest: state.scopeDigest }),
        sameAcceptedNarrativeTarget: (left, right) => (
            left.chatId === right.chatId
            && left.messageId === right.messageId
            && left.swipeId === right.swipeId
            && left.generationId === right.generationId
            && left.contentFingerprint === right.contentFingerprint
        ),
    };
    vm.runInNewContext(
        `${guardSource}\nthis.current = doctorRepairCenterTargetIsCurrent; `
        + 'this.terminal = doctorTerminalDiagnosticTargetIsCurrent;',
        sandbox,
    );
    assert.equal(sandbox.current(captured), true);
    assert.equal(sandbox.terminal(captured), true);
    state.foreground = true;
    assert.equal(sandbox.current(captured), false);
    assert.equal(sandbox.terminal(captured), true);
    state.foreground = false;
    state.scopeDigest = 'scope-b';
    assert.equal(sandbox.current(captured), false);
    state.scopeDigest = 'scope-a';
    sandbox.operationEpoch = 8;
    assert.equal(sandbox.current(captured), false);
});

test('production capsule persistence refuses cross-chat writes', async () => {
    const persist = sourceSection(
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
        'async function runDoctorRepairCenterUnlocked(',
    );
    const state = {
        chatId: 'chat-a', writes: 0, targetCurrent: true, flipBeforePrecondition: false,
    };
    const sandbox = {
        getContext: () => ({ chatId: state.chatId }),
        doctorRepairTargetIdentityDigest: (target) => target?.digest || '',
        doctorRepairCenterTargetIsCurrent: () => state.targetCurrent,
        readChatNamespace: () => ({ repairJournal: [] }),
        appendRepairJournal: (namespace, capsule) => ({
            ...namespace, repairJournal: [...namespace.repairJournal, capsule],
        }),
        compactRepairJournalWithVariableCapsules: (journal) => journal,
        persistDoctorRepairCapsuleBatch: async (capsules, _chatId, guard) => {
            if (state.flipBeforePrecondition) state.targetCurrent = false;
            if (!guard()) return false;
            state.writes += 1;
            return capsules.length > 0;
        },
        writeRepairJournal: async (_journal, _chatId, options) => {
            if (state.flipBeforePrecondition) state.targetCurrent = false;
            if (!options.precondition()) return false;
            state.writes += 1;
            return true;
        },
    };
    vm.runInNewContext(`${persist}\nthis.persist = persistDoctorRepairCapsules;`, sandbox);
    const target = { digest: 'deadbeef' };
    const capsules = [{ id: 'safe', targetDigest: 'deadbeef' }];
    assert.equal(await sandbox.persist(capsules, 'chat-a', target), true);
    state.targetCurrent = true;
    state.flipBeforePrecondition = true;
    assert.equal(await sandbox.persist(capsules, 'chat-a', target), false);
    state.flipBeforePrecondition = false;
    state.chatId = 'chat-b';
    assert.equal(await sandbox.persist(capsules, 'chat-a', target), false);
    assert.equal(state.writes, 1);
});

test('production orchestrator never records an old-chat or old-scope result after await boundaries', async () => {
    const runSource = sourceSection(
        'async function runDoctorRepairCenterUnlocked(',
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
    );
    const makeSandbox = ({ switchDuringJournal = false, loseScopeAfterOutcome = false } = {}) => {
        const state = {
            chatId: 'chat-a', statuses: [], persists: 0, targetCurrent: true,
        };
        const sandbox = {
            getContext: () => ({ chatId: state.chatId }),
            buildDoctorRepairPlan: () => ({
                status: 'ready', code: 'doctor.repair.ready', targetIndex: 4, modules: ['world'],
            }),
            doctorRepairCenterForegroundActive: () => false,
            doctorRepairCenterTargetIsCurrent: () => (
                state.chatId === 'chat-a' && state.targetCurrent
            ),
            setDoctorRepairCenterStatus: (...args) => state.statuses.push(args),
            executeDoctorRepairPlan: async () => {
                if (!switchDuringJournal) state.chatId = 'chat-b';
                if (loseScopeAfterOutcome) {
                    state.chatId = 'chat-a';
                    state.targetCurrent = false;
                }
                return {
                    status: 'completed', code: 'doctor.repair.completed', targetIndex: 4,
                    completedAt: 10,
                    actions: [{ module: 'world', status: 'applied', readbackVerified: true }],
                };
            },
            runDoctorRepairModule: async () => ({ status: 'applied', readbackVerified: true }),
            doctorRepairCenterQueueGeneration: 0,
            doctorRepairCenterPrepareModuleRequests: () => undefined,
            runDoctorRepairModuleRequest: (_module, captured) => (
                sandbox.runDoctorRepairModule(_module, captured)
            ),
            createDoctorRepairCapsules: () => [{ module: 'world' }],
            doctorRuntimeCriticalFingerprint: () => 'runtime-critical:1:abcd',
            fingerprint: () => 'scope-digest',
            persistDoctorRepairCapsules: async () => {
                state.persists += 1;
                if (switchDuringJournal) state.chatId = 'chat-b';
                return true;
            },
            deepClone: (value) => structuredClone(value),
        };
        vm.runInNewContext(`${runSource}\nthis.run = runDoctorRepairCenterUnlocked;`, sandbox);
        return { sandbox, state };
    };
    const afterOutcome = makeSandbox();
    const first = await afterOutcome.sandbox.run('world', { chatId: 'chat-a', index: 4 }, 'deadbeef');
    assert.equal(first.code, 'doctor.repair.chat_changed');
    assert.equal(afterOutcome.state.statuses.length, 2);
    assert.equal(afterOutcome.state.statuses.at(-1)[1], 'cancelled');
    assert.equal(afterOutcome.state.persists, 0);

    const afterJournal = makeSandbox({ switchDuringJournal: true });
    const second = await afterJournal.sandbox.run('world', { chatId: 'chat-a', index: 4 }, 'deadbeef');
    assert.equal(second.code, 'doctor.repair.chat_changed');
    assert.equal(afterJournal.state.statuses.length, 2);
    assert.equal(afterJournal.state.statuses.at(-1)[1], 'cancelled');
    assert.equal(afterJournal.state.persists, 1);

    const afterScope = makeSandbox({ loseScopeAfterOutcome: true });
    const third = await afterScope.sandbox.run(
        'world', { chatId: 'chat-a', index: 4 }, 'deadbeef',
    );
    assert.equal(third.journalPersisted, false);
    assert.equal(afterScope.state.persists, 0);
    assert.equal(afterScope.state.statuses.length, 2);
    assert.equal(afterScope.state.statuses.at(-1)[1], 'cancelled');
});

test('same Doctor request joins once while different requests stay serialized', async () => {
    const requestSource = sourceSection(
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
        'function renderSocialAuditImpl()',
    );
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const releases = [];
    const sandbox = {
        doctorRepairCenterChain: Promise.resolve(),
        doctorRepairCenterRequests: new Map(),
        doctorRepairCenterModuleRequests: new Map(),
        doctorRepairCenterQueueGeneration: 0,
        syncTaskCancelButtons: () => undefined,
        doctorRepairCenterModuleKey: (module, digest) => `${digest}:${module}`,
        doctorRepairJoinedModuleOutcome: (_module, _captured, _digest, result) => result,
        releaseDoctorRepairModuleRequests: () => undefined,
        getContext: () => ({ chatId: 'chat-a' }),
        latestAiMessage: () => ({ index: 4 }),
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: {} }),
        captureDoctorRepairTargetReadOnly: () => ({ index: 4, digest: 'deadbeef' }),
        doctorRepairTargetIdentityDigest: (target) => target?.digest || '',
        runDoctorRepairCenterUnlocked: async (requested) => {
            calls += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => releases.push(resolve));
            active -= 1;
            return { status: 'completed', requested };
        },
    };
    vm.runInNewContext(`${requestSource}\nthis.run = runDoctorRepairCenter;`, sandbox);
    const first = sandbox.run('all');
    const duplicate = sandbox.run('all');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    releases.shift()();
    await Promise.all([first, duplicate]);

    const profile = sandbox.run('profile');
    const world = sandbox.run('world');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    releases.shift()();
    await profile;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 3);
    releases.shift()();
    await world;
    assert.equal(maxActive, 1);
});

test('repair-all publishes module slots, later explicit clicks retry, and invalidation detaches old owners', async () => {
    const moduleSource = sourceSection(
        'function doctorRepairCenterModuleKey(module, targetDigest)',
        'async function persistDoctorRepairCapsules(capsules, expectedChatId, expectedTarget)',
    );
    const invalidateSource = sourceSection(
        'function invalidateDoctorRepairCenterRequests()',
        'function invalidateOperations(reason =',
    );
    const requestSource = sourceSection(
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
        'function renderSocialAuditImpl()',
    );
    const state = { calls: 0, releases: [] };
    const sandbox = {
        doctorRepairCenterChain: Promise.resolve(),
        doctorRepairCenterRequests: new Map(),
        doctorRepairCenterModuleRequests: new Map(),
        doctorRepairCenterQueueGeneration: 0,
        syncTaskCancelButtons: () => undefined,
        latestDoctorRepairCenterKind: 'busy',
        setDoctorRepairCenterStatus: (text, kind, options) => {
            sandbox.cancelledStatus = { text, kind, options };
        },
        getContext: () => ({ chatId: 'chat-a' }),
        latestAiMessage: () => ({ index: 4 }),
        resolveCurrentActorSovereigntyScope: async () => ({ resolved: true, scope: {} }),
        captureDoctorRepairTargetReadOnly: () => ({ index: 4, digest: 'deadbeef' }),
        doctorRepairTargetIdentityDigest: (target) => target?.digest || '',
        deepClone: (value) => structuredClone(value),
        runDoctorRepairModule: async () => {
            state.calls += 1;
            return new Promise((resolve) => state.releases.push(resolve));
        },
    };
    vm.runInNewContext(
        `${moduleSource}\n${invalidateSource}\n${requestSource}\n`
        + 'this.run = runDoctorRepairCenter; this.invalidate = invalidateDoctorRepairCenterRequests;',
        sandbox,
    );
    sandbox.runDoctorRepairCenterUnlocked = async (requested, captured, digest, owner) => {
        const modules = requested === 'all' ? ['profile'] : [requested];
        sandbox.doctorRepairCenterPrepareModuleRequests(modules, digest, owner);
        const result = await sandbox.runDoctorRepairModuleRequest(
            modules[0], captured, digest, owner,
        );
        return { status: 'completed', actions: [{ module: modules[0], ...result }] };
    };

    const all = sandbox.run('all');
    assert.equal(sandbox.doctorRepairCenterModuleRequests.size, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sandbox.doctorRepairCenterModuleRequests.has('deadbeef:profile'), true);
    const joined = sandbox.run('profile');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls, 1);
    state.releases.shift()({ status: 'applied', readbackVerified: true });
    assert.equal((await joined).joined, true);
    await all;

    const laterExplicit = sandbox.run('profile');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls, 2);
    state.releases.shift()({ status: 'nochange', readbackVerified: true, zeroWrite: true });
    await laterExplicit;

    const old = sandbox.run('profile');
    await new Promise((resolve) => setImmediate(resolve));
    const oldJoin = sandbox.run('profile');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls, 3);
    sandbox.invalidate();
    assert.equal(sandbox.cancelledStatus.kind, 'cancelled');
    assert.equal(sandbox.cancelledStatus.options.record, false);
    assert.equal((await oldJoin).status, 'partial');
    const fresh = sandbox.run('profile');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.calls, 4);
    const freshSlot = sandbox.doctorRepairCenterModuleRequests.get('deadbeef:profile');
    state.releases.shift()({ status: 'applied', readbackVerified: true });
    await old;
    assert.equal(
        sandbox.doctorRepairCenterModuleRequests.get('deadbeef:profile'),
        freshSlot,
    );
    state.releases.shift()({ status: 'applied', readbackVerified: true });
    await fresh;
    assert.equal(sandbox.doctorRepairCenterModuleRequests.size, 0);
});

test('cancel button treats continuity owners and Doctor center requests as cancellable work', () => {
    const syncSource = sourceSection(
        'function syncTaskCancelButtons()',
        'function taskProgressText(progress = activeTaskProgress)',
    );
    const buttons = [{ hidden: true, disabled: true, textContent: '' }, {
        hidden: true, disabled: true, textContent: '',
    }];
    const sandbox = {
        activeTaskProgress: null,
        activeModelControllers: new Set(),
        activeSovereigntyTaskIds: new Set(),
        automaticPendingKeys: new Set(),
        openingSyncPendingKeys: new Set(),
        actorProfilePendingKeys: new Map(),
        continuityPendingKeys: new Map([['world-key', { epoch: 7 }]]),
        forumPendingKeys: new Set(),
        doctorRepairCenterRequests: new Map(),
        doctorRepairCenterModuleRequests: new Map(),
        hasCancellableSovereigntyTasks: () => false,
        ui: { cancelTask: buttons[0], floatingCancelTask: buttons[1] },
    };
    vm.runInNewContext(`${syncSource}\nthis.sync = syncTaskCancelButtons;`, sandbox);
    sandbox.sync();
    assert.equal(buttons.every((button) => !button.hidden && !button.disabled), true);

    sandbox.continuityPendingKeys.clear();
    sandbox.doctorRepairCenterRequests.set('request', Promise.resolve());
    sandbox.sync();
    assert.equal(buttons.every((button) => !button.hidden && !button.disabled), true);

    sandbox.doctorRepairCenterRequests.clear();
    sandbox.sync();
    assert.equal(buttons.every((button) => button.hidden && button.disabled), true);
});

test('production repair-all invokes only unhealthy modules and a healthy target performs zero work', async () => {
    const runSource = sourceSection(
        'async function runDoctorRepairCenterUnlocked(',
        'function doctorRepairCenterRequestKey(requested, targetDigest)',
    );
    const exercise = async (enabledModules) => {
        const state = { calls: [], persists: 0, status: [] };
        const sandbox = {
            getContext: () => ({ chatId: 'chat-a' }),
            readChatNamespace: () => ({ repairJournal: [] }),
            doctorRepairModulesNeedingRepair: () => enabledModules,
            buildDoctorRepairPlan,
            doctorRepairCenterForegroundActive: () => false,
            doctorRepairCenterTargetIsCurrent: () => true,
            setDoctorRepairCenterStatus: (...args) => state.status.push(args),
            executeDoctorRepairPlan,
            runDoctorRepairModule: async (module) => {
                state.calls.push(module);
                return { status: 'nochange', code: `doctor.repair.${module}.nochange`, zeroWrite: true };
            },
            doctorRepairCenterQueueGeneration: 0,
            doctorRepairCenterPrepareModuleRequests: () => undefined,
            runDoctorRepairModuleRequest: (module, captured) => sandbox.runDoctorRepairModule(module, captured),
            createDoctorRepairCapsules,
            doctorRuntimeCriticalFingerprint: () => 'runtime-critical:1:abcd',
            fingerprint: () => 'scope-digest',
            persistDoctorRepairCapsules: async () => { state.persists += 1; return true; },
            deepClone: (value) => structuredClone(value),
        };
        vm.runInNewContext(`${runSource}\nthis.run = runDoctorRepairCenterUnlocked;`, sandbox);
        return {
            result: await sandbox.run('all', { chatId: 'chat-a', index: 4 }, 'deadbeef'),
            state,
        };
    };

    const profileOnly = await exercise(['profile']);
    assert.deepEqual(profileOnly.state.calls, ['profile']);
    assert.equal(profileOnly.state.persists, 1);

    const healthy = await exercise([]);
    assert.equal(healthy.result.status, 'nochange');
    assert.equal(healthy.result.modelCallCount, 0);
    assert.equal(healthy.result.writeCount, 0);
    assert.equal(healthy.result.zeroWrite, true);
    assert.deepEqual(healthy.state.calls, []);
    assert.equal(healthy.state.persists, 0);
    assert.equal(healthy.state.status.at(-1)[2].record, false);
});

test('chat lifecycle hydrates the Doctor center from only the current repair journal', () => {
    assert.match(source, /function hydrateDoctorRepairCenterStatus\(namespace = readChatNamespace\(\)\)/u);
    const chatChanged = sourceSection('const onChatChanged = async () => {', 'const chatEvents = new Set([');
    assert.match(chatChanged, /hydrateDoctorRepairCenterStatus\(readChatNamespace\(\)\)/u);
    const initialize = sourceSection('async function initialize()', 'window\.MvuAutoDoctorAPI');
    assert.match(initialize, /hydrateDoctorRepairCenterStatus\(readChatNamespace\(\)\)/u);
    assert.match(source, /return Boolean\(actorWorldManagementWrite \|\| actorWorldManagementBlockedByForeground\(\)\);/u);
});

test('settings UI exposes four doctor repair actions while retaining variable-only repair', () => {
    for (const module of ['variable', 'profile', 'world', 'all']) {
        assert.match(source, new RegExp(`data-repair-module="${module}"`, 'u'));
    }
    assert.match(source, /mvuad-run[^>]*type="button"/u);
    assert.match(source, /runVariableSafeRepair/u);
});
