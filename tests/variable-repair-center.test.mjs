import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
    buildVariableRepairPlan,
    compactRepairJournalWithVariableCapsules,
    createVariableRepairBugCapsule,
    executeVariableRepairPlan,
    variableRepairCapsuleProjection,
    variableRepairCenterSemanticFingerprint,
} from '../v2/repair/variable-repair-center.mjs';
import { createPrivacySafeDiagnosticProjection } from '../v2/surface/diagnostics.mjs';

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const moduleSource = await readFile(
    new URL('../v2/repair/variable-repair-center.mjs', import.meta.url),
    'utf8',
);

test('MVU repair plan is blocked while narrative foreground is active', () => {
    assert.deepEqual(buildVariableRepairPlan({
        hasTarget: true,
        foregroundActive: true,
        targetIndex: 7,
    }), {
        status: 'blocked',
        code: 'variable.repair.foreground_active',
        targetIndex: 7,
        actions: [],
    });
    assert.equal(buildVariableRepairPlan({ hasTarget: false }).actions.length, 0);
});

test('MVU repair runs only variable actions and stops before opening sync on failure', async () => {
    const plan = buildVariableRepairPlan({
        hasTarget: true,
        targetIndex: 9,
        openingResourceEnabled: true,
    });
    const calls = [];
    const failed = await executeVariableRepairPlan(plan, {
        now: (() => {
            let value = 100;
            return () => value += 10;
        })(),
        runAction: async (actionId) => {
            calls.push(actionId);
            return {
                status: 'failed',
                failureCode: 'variable.patch.validation_failed',
                zeroWrite: true,
            };
        },
    });
    assert.deepEqual(calls, ['variable_audit']);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.code, 'variable.patch.validation_failed');
    assert.equal(failed.actions[0].zeroWrite, true);

    calls.length = 0;
    const completed = await executeVariableRepairPlan(plan, {
        runAction: async (actionId) => {
            calls.push(actionId);
            return actionId === 'variable_audit'
                ? { status: 'applied', readbackVerified: true }
                : { status: 'outside-opening' };
        },
    });
    assert.deepEqual(calls, ['variable_audit', 'opening_resource_sync']);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.actions[0].readbackVerified, true);
    assert.equal(completed.actions[1].status, 'nochange');

    const unverified = await executeVariableRepairPlan(
        buildVariableRepairPlan({ hasTarget: true, targetIndex: 10 }),
        {
            runAction: async () => ({
                status: 'applied',
                readbackVerified: false,
                frontendSynced: false,
            }),
        },
    );
    assert.equal(unverified.status, 'failed');
    assert.equal(unverified.code, 'variable.repair.readback_unverified');
});

test('bug capsule is privacy-safe and keeps useful numeric evidence', () => {
    const plan = buildVariableRepairPlan({
        hasTarget: true,
        targetIndex: 3,
    });
    const capsule = createVariableRepairBugCapsule({
        id: 'variable_bug_abc12',
        runtimeFingerprint: 'runtime-critical:1234:abcd',
        chatScopeDigest: 'deadbeef',
        plan,
        outcome: {
            status: 'failed',
            code: 'variable.patch.validation_failed',
            startedAt: 100,
            completedAt: 160,
            durationMs: 60,
            actions: [{
                actionId: 'variable_audit',
                status: 'failed',
                code: 'variable.patch.validation_failed',
                durationMs: 55,
                zeroWrite: true,
            }],
        },
        evidence: {
            priorStatusKind: 'error',
            modelCallCount: 1,
            inputChars: 4567,
            outputChars: 321,
            queueWaitMs: 8,
            modelMs: 44,
            parseMs: 3,
            persistMs: 0,
            repairJournalPersisted: true,
            privateNarrative: 'must never survive',
            actorName: 'must never survive',
        },
    });
    assert.equal(capsule.repairKind, 'doctor-variable-repair-center');
    assert.equal(capsule.status, 'needs_update');
    assert.equal(capsule.evidence.inputChars, 4567);
    assert.equal(capsule.evidence.repairJournalPersisted, true);
    assert.equal(JSON.stringify(capsule).includes('must never survive'), false);
    assert.equal('snapshot' in capsule, false);
    assert.equal('prompt' in capsule, false);
});

test('journal keeps five undo records and twenty-five small bug capsules', () => {
    const journal = [
        ...Array.from({ length: 9 }, (_, index) => ({
            id: `undo_${index}`,
            repairKind: 'variable-audit',
            status: 'applied',
            createdAt: index,
            snapshot: { value: index },
        })),
        ...Array.from({ length: 16 }, (_, index) => ({
            id: `bug_${index}`,
            repairKind: 'doctor-variable-repair-center',
            status: 'needs_update',
            createdAt: 100 + index,
        })),
        ...Array.from({ length: 15 }, (_, index) => ({
            id: `unified_${index}`,
            repairKind: 'doctor-unified-repair-center',
            status: 'needs_update',
            createdAt: 200 + index,
        })),
    ];
    const compacted = compactRepairJournalWithVariableCapsules(journal);
    assert.equal(compacted.length, 30);
    assert.equal(compacted.filter((entry) => entry.repairKind === 'variable-audit').length, 5);
    assert.equal(compacted.filter((entry) => [
        'doctor-variable-repair-center',
        'doctor-unified-repair-center',
    ].includes(entry.repairKind)).length, 25);
    assert.equal(compacted.filter(
        (entry) => entry.repairKind === 'doctor-unified-repair-center',
    ).length, 15);
    assert.equal(compacted.some((entry) => entry.id === 'undo_8'), true);
    assert.equal(compacted.some((entry) => entry.id === 'unified_14'), true);
});

test('projection exposes only counts, fixed codes, timing and readback proof', () => {
    const projection = variableRepairCapsuleProjection([{
        repairKind: 'doctor-variable-repair-center',
        status: 'repair_completed',
        outcomeCode: 'variable.repair.completed',
        targetIndex: 6,
        durationMs: 91,
        actions: [{ actionId: 'variable_audit', readbackVerified: true }],
        privateNarrative: 'hidden',
    }]);
    assert.deepEqual(projection, {
        capsuleCount: 1,
        lastStatus: 'repair_completed',
        lastOutcomeCode: 'variable.repair.completed',
        lastTargetIndex: 6,
        lastDurationMs: 91,
        lastReadbackVerified: true,
    });
    assert.equal(JSON.stringify(projection).includes('hidden'), false);
    const diagnostic = createPrivacySafeDiagnosticProjection({
        variableRepair: {
            ...projection,
            privateNarrative: 'hidden',
            modelOutput: 'hidden',
        },
    });
    assert.deepEqual(diagnostic.variableRepair, projection);
    assert.equal(JSON.stringify(diagnostic.variableRepair).includes('hidden'), false);
});

test('production adapter stays independent from actor and world repair flows', () => {
    const start = indexSource.indexOf('async function runVariableSafeRepair({');
    const end = indexSource.indexOf('function renderSocialAudit()', start);
    assert.ok(start >= 0 && end > start);
    const adapter = indexSource.slice(start, end);
    assert.match(adapter, /queuedTarget:\s*repairTarget/u);
    assert.match(adapter, /expectedTarget:\s*repairTarget/u);
    assert.match(adapter, /continuationGuard:\s*repairStillCurrent/u);
    assert.match(adapter, /expectedTarget\s*=\s*null/u);
    assert.match(adapter, /doctorRepairCenterTargetIsCurrent\(captured\)/u);
    assert.match(adapter, /persistVariableRepairBugCapsule\([\s\S]*continuationGuard/u);
    assert.match(adapter, /variable\.repair\.chat_changed/u);
    assert.match(adapter, /enqueueOpeningResourceSync/u);
    assert.doesNotMatch(adapter, /enqueueActorProfiles|enqueueContinuity/u);
    assert.match(indexSource, /runVariableSafeRepair,/u);
    const enqueueStart = indexSource.indexOf('function enqueue(targetId, options = {})');
    const enqueueEnd = indexSource.indexOf('async function undoLastUnlocked()', enqueueStart);
    const enqueueSource = indexSource.slice(enqueueStart, enqueueEnd);
    assert.match(enqueueSource, /runTarget\(targetId, queuedOptions\)[\s\S]*recordVariableFinalDiagnostic\([\s\S]*queuedTarget,[\s\S]*result/u);
    assert.match(indexSource, /recordVariableFinalDiagnostic\.toString\(\)/u);
    assert.match(indexSource, /安全修复变量/u);
    const commitStart = indexSource.indexOf('async function commitCandidateUnlocked(');
    const commitEnd = indexSource.indexOf('function commitCandidate(', commitStart);
    const commit = indexSource.slice(commitStart, commitEnd);
    assert.ok(commit.indexOf("typeof precondition === 'function'") >= 0);
    assert.ok(commit.indexOf("typeof precondition === 'function'")
        < commit.indexOf('await Mvu.replaceMvuData(reparsed, options)'));
    const runStart = indexSource.indexOf('async function runTarget(');
    const runEnd = indexSource.indexOf('function automaticTargetKey(', runStart);
    const runTarget = indexSource.slice(runStart, runEnd);
    assert.match(runTarget, /continuationGuard = null/u);
    assert.match(runTarget, /precondition:\s*continuationAllowed/u);
    const openingStart = indexSource.indexOf('async function runOpeningResourceSync(');
    const openingEnd = indexSource.indexOf('async function enqueueOpeningResourceSync(', openingStart);
    const opening = indexSource.slice(openingStart, openingEnd);
    assert.match(opening, /continuationGuard = null/u);
    assert.match(opening, /failureCode:\s*'variable\.repair\.foreground_preempted'/u);
    assert.match(opening, /precondition:\s*continuationAllowed/u);
    assert.match(indexSource, /runOpeningResourceSync\.toString\(\)/u);
    assert.match(indexSource, /commitCandidate\.toString\(\)/u);
    assert.doesNotMatch(moduleSource, /actor|profile|continuity|world|database/iu);
    const semantic = variableRepairCenterSemanticFingerprint();
    assert.ok(semantic.length > 500);
    assert.notEqual(variableRepairCenterSemanticFingerprint({
        executeVariableRepairPlan: async function changedVariableRepairExecutor() {},
    }), semantic);
    assert.match(indexSource, /variableRepairCenterSemanticFingerprint\(\)/u);
});

test('production variable repair continuously guards outcome, journal precondition, and final UI', async () => {
    const start = indexSource.indexOf('async function persistVariableRepairBugCapsule(');
    const end = indexSource.indexOf('function renderSocialAudit()', start);
    assert.ok(start >= 0 && end > start);
    const production = indexSource.slice(start, end);
    const exercise = async ({ loseAfterOutcome = false, loseInsideJournal = false, noArgs = false } = {}) => {
        const state = { current: true, writes: 0, statuses: [], captures: 0 };
        const captured = { chatId: 'chat-a', index: 4, digest: 'deadbeef' };
        const sandbox = {
            getContext: () => ({ chatId: 'chat-a' }),
            latestAiMessage: () => ({ index: 4 }),
            captureTarget: () => { state.captures += 1; return captured; },
            doctorRepairTargetIdentityDigest: (target) => target?.digest || '',
            doctorRepairCenterTargetIsCurrent: () => state.current,
            variableRepairForegroundActive: () => false,
            getSettings: () => ({ normalizeOpeningResources: false }),
            buildVariableRepairPlan,
            setVariableRepairCenterStatus: (...args) => state.statuses.push(args),
            variableRepairEvidenceForTarget: () => ({ modelCallCount: 0 }),
            variableRepairEvidenceDelta: () => ({ modelCallCount: 0 }),
            executeVariableRepairPlan: async () => {
                if (loseAfterOutcome) state.current = false;
                return {
                    status: 'completed', code: 'variable.repair.completed',
                    completedAt: 10, actions: [],
                };
            },
            createVariableRepairBugCapsule,
            doctorRuntimeCriticalFingerprint: () => 'runtime-critical:1:abcd',
            fingerprint: () => 'deadbeef',
            readChatNamespace: () => ({ repairJournal: [] }),
            appendRepairJournal: (namespace, capsule) => ({
                ...namespace, repairJournal: [...namespace.repairJournal, capsule],
            }),
            compactRepairJournalWithVariableCapsules: (journal) => journal,
            persistDoctorRepairCapsuleBatch: async (_capsules, _chatId, guard) => {
                if (loseInsideJournal) state.current = false;
                if (!guard()) return false;
                state.writes += 1;
                return true;
            },
            writeRepairJournal: async (_journal, _chatId, options) => {
                if (loseInsideJournal) state.current = false;
                if (!options.precondition()) return false;
                state.writes += 1;
                return true;
            },
            deepClone: (value) => structuredClone(value),
        };
        vm.runInNewContext(`${production}\nthis.run = runVariableSafeRepair;`, sandbox);
        const result = noArgs
            ? await sandbox.run()
            : await sandbox.run({ expectedTarget: captured, continuationGuard: () => state.current });
        return { result, state };
    };

    const outcomeLost = await exercise({ loseAfterOutcome: true });
    assert.equal(outcomeLost.result.status, 'cancelled');
    assert.equal(outcomeLost.state.writes, 0);
    assert.equal(outcomeLost.state.statuses.length, 1);

    const journalLost = await exercise({ loseInsideJournal: true });
    assert.equal(journalLost.result.status, 'cancelled');
    assert.equal(journalLost.state.writes, 0);
    assert.equal(journalLost.state.statuses.length, 1);

    const legacy = await exercise({ noArgs: true });
    assert.equal(legacy.result.status, 'completed');
    assert.equal(legacy.state.captures, 1);
    assert.equal(legacy.state.writes, 1);
    assert.equal(legacy.state.statuses.length, 2);
});
