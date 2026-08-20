import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { actorProfileReceiptPlacementAccepted } from '../actor-profile-mvu-core.mjs';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('runtime diagnostic version exactly matches the install manifest', () => {
    const runtimeVersion = source.match(/const VERSION = '([^']+)'/u)?.[1];
    assert.equal(runtimeVersion, manifest.version);
});

test('accepted-final profile adapter is exact-source, zero-model, and uses existing MVU transaction', () => {
    const target = section('async function moduleTargetForAcceptedFinal', 'function dispatchAcceptedFinal');
    for (const field of [
        'messageId', 'swipeId', 'generationId', 'generationSerial',
        'contentFingerprint', 'scopeDigest', 'operationEpoch',
    ]) assert.match(target, new RegExp(field, 'u'));

    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.match(semantic, /commitCandidate\(Mvu, candidate/u);
    assert.match(semantic, /requireExactTarget:\s*true, syncFrontend:\s*false/u);
    assert.match(semantic, /mergeActorProfileOperationsIntoAcceptedMessage/u);
    assert.match(semantic, /profileRootPresent/u);
    assert.match(semantic, /projectSemanticProfilesToActorLedger/u);
    assert.match(semantic, /actorProfileExplicitNoChangeReceipt\(messageText\)/u);
    assert.match(semantic, /exactTicketCount:\s*tickets\.length/u);
    assert.match(semantic, /omission === 'profile_block_missing'[\s\S]*?emptyOperations:\s*true/u);
    assert.match(semantic, /actorProfileSemanticNoChange\(captured, acceptedContentText\(messageText\)\)/u);
    assert.doesNotMatch(semantic, /callModel|generateRaw|runActorProfileTarget/u);

    const wrapper = section('async function runSemanticActorProfileTarget(captured)', 'function renderSemanticProfileEntries');
    assert.match(wrapper, /finalizeActorProfileRecoveryOutcome\(captured, result\)/u);
    assert.match(wrapper, /recovery\.recoverySaved === true/u);
});

test('P3 starts independently, freezes ready actors, and structure world does not wait for profiles', () => {
    const dispatch = section('function dispatchAcceptedFinal', 'function acceptedFinalDispatchKey');
    const semanticBranch = dispatch.slice(dispatch.indexOf('if (semanticPath)'));
    assert.ok(
        semanticBranch.indexOf("launchScoped('世界连续性'")
            < semanticBranch.indexOf("launchScoped('人物档案'"),
    );
    assert.doesNotMatch(semanticBranch, /await\s+profileTask/u);
    const continuity = section('async function runContinuityTarget', 'async function enqueueContinuity');
    assert.match(continuity, /requireProfileReady:\s*true/u);
    assert.match(continuity, /actor set is frozen/iu);
    assert.match(continuity, /stage3AttachMvuProfilesToLedger/u);
    const enqueue = section('async function enqueueContinuity', 'function stage3AttemptProjection');
    assert.doesNotMatch(enqueue, /afterPending[\s\S]*?enqueueContinuity\(targetId/u);
    const wake = section(
        'async function wakeContinuityAfterProfileTerminal',
        'function dispatchAcceptedFinal',
    );
    assert.match(
        wake,
        /profileResult\?\.status === 'no_candidates'[\s\S]*?profileResult\s*:\s*null/u,
    );
    assert.doesNotMatch(wake, /joinedPendingOwner/u);
    assert.match(wake, /zeroWrite !== true[\s\S]*?worldModelCalls/u);
    assert.match(wake, /freshTarget = await moduleTargetForAcceptedFinal\(envelope\)/u);
    assert.match(wake, /stage3TargetIsCurrent\(freshTarget, operationToken\(freshTarget\)\)/u);
    assert.match(wake, /expectedTarget:\s*freshTarget/u);
    assert.match(wake, /afterPending:\s*false/u);
    const stale = section(
        'function stage3StaleValidationCode',
        'function stage3AcceptedTargetIsStrictlyNewer',
    );
    assert.match(stale, /world_task_owner_changed:\s*'world\.stale\.owner_changed'/u);
    assert.match(stale, /module:\s*'world'[\s\S]*?zeroWrite:\s*true[\s\S]*?worldModelCalls:\s*0/u);
});

test('P4 keeps one exact-once consumer while adding only bounded related ready profiles', () => {
    const p4 = section('function p4RelevantActorIds', 'async function commitNextTurnConsumer');
    assert.match(p4, /slice\(0, Math\.max\(1/u);
    assert.match(p4, /actorProfileReadinessInLedger/u);
    assert.match(p4, /actorProfilePromptProjection/u);
    assert.match(p4, /profileDigest/u);
    assert.match(p4, /immutableNextTurnConsumerPayload\(worldText, ticketText, profileText\)/u);
    assert.equal((p4.match(/setNextTurnConsumerFallback\(payload\.text\)/gu) || []).length, 1);
});

test('semantic repair is single-person targeted and legacy migration is explicit and reversible', () => {
    const repair = section('async function runSemanticActorProfileTargetedRepair', 'async function migrateLegacyProfilesToMvu');
    assert.match(repair, /人物档案单人物定向补缺/u);
    assert.match(repair, /targets\.slice\(0, 1\)/u);
    assert.match(repair, /只补全一个人物/u);
    assert.doesNotMatch(repair, /runActorProfileTarget|completeActorProfilesForTurn/u);
    const migration = section('async function migrateLegacyProfilesToMvu', 'async function runActorProfileTarget');
    assert.match(migration, /compileLegacyActorProfileMigration/u);
    assert.match(migration, /legacyProfiles/u);
    assert.match(migration, /syncFrontend:\s*false/u);
    assert.match(source, /mvuad-profile-migrate/u);
    assert.match(source, /actorProfilePathMode === 'semantic'/u);
});

test('contracted receipt omission fails closed while post-content and legacy tail no-change receipts are valid', () => {
    const helperSource = section(
        'function actorProfileExplicitNoChangeReceipt',
        'function actorProfileSemanticNoChange',
    );
    const helpers = new Function(
        'actorProfileReceiptPlacementAccepted',
        `${helperSource}\nreturn { actorProfileExplicitNoChangeReceipt, actorProfileReceiptOmissionDecision };`,
    )(actorProfileReceiptPlacementAccepted);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<!-- 人物档案无变化 -->',
    ), true);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<!-- 人物档案无变化 -->\n<options>1. 继续</options>',
    ), true);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content><!-- 人物档案无变化 --></content>',
    ), false);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<!-- 人物档案无变化 -->\n<options>1. 继续</options>',
    ), false);
    assert.equal(helpers.actorProfileExplicitNoChangeReceipt(
        '<content>正文</content>\n<options>1. 继续</options>\n<!-- 人物档案无变化 -->\n数据库自由文本',
    ), false);
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 32,
        explicitNoChange: false,
    }), 'profile_block_missing');
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 32,
        explicitNoChange: true,
    }), 'no_candidates');
    assert.equal(helpers.actorProfileReceiptOmissionDecision({
        exactTicketCount: 0,
        explicitNoChange: false,
    }), 'no_candidates');
});

test('runtime fingerprint binds preset bridge, parser/compiler, transaction, P3, repair and P4', () => {
    const fingerprint = section('function doctorRuntimeCriticalFingerprint', 'function diagnosticPayload');
    for (const helper of [
        'actorProfileSemanticRuntimeFingerprint',
        'runSemanticActorProfileTarget',
        'runSemanticActorProfileTargetCore',
        'actorProfileExplicitNoChangeReceipt',
        'actorProfileReceiptOmissionDecision',
        'runSemanticActorProfileTargetedRepair',
        'wakeContinuityAfterProfileTerminal',
        'stage3StaleValidationCode',
        'stage3ZeroWriteStaleResult',
        'projectSemanticProfilesToActorLedger',
        'persistSemanticActorLedgerProjection',
        'stage3AttachMvuProfilesToLedger',
        'p4RelevantActorIds',
        'p4ActorProfileSummary',
        'npcDesignTicketPrompt',
        'immutableNextTurnConsumerPayload',
        'actorProfileSurfaceRuntimeFingerprint',
        'renderActorProfiles',
        'repairActorProfileFromSurface',
        'migrateActorProfileFromSurface',
    ]) assert.match(fingerprint, new RegExp(helper, 'u'));
});

test('database and worldbook have no write authority in the semantic profile transaction', () => {
    const semantic = section('async function runSemanticActorProfileTargetCore', 'async function runSemanticActorProfileTarget(');
    assert.doesNotMatch(semantic, /TavernDB|tableEdit|database|worldbook|writeWorld/u);
    assert.match(source, /independent_modules_no_global_settlement/u);
});
