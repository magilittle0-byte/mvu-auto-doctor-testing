import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractContinuityMarkers } from '../continuity-core.mjs';

test('P3 runs from Doctor settings and does not inspect third-party brands or prompt tags', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const runStart = source.indexOf('async function runContinuityTarget(captured, {');
    const runEnd = source.indexOf('\nfunction sameTargetExceptContent', runStart);
    const run = source.slice(runStart, runEnd);
    assert.match(source, /function continuityFeatureActive\(settings, force = false\)[\s\S]*?return settings\.continuityMode !== 'off'/u);
    assert.match(run, /const director = 'doctor'/u);
    assert.doesNotMatch(
        run,
        /extensionSettings|activePresetHasContinuityPrompt|WORLD_ENGINE|Stitches|STITCHES|parallel_event_record|dm_story|npc_track/u,
    );
    assert.doesNotMatch(source, /function detectContinuityDirector/u);
});

test('third-party narrative tags cannot become Doctor continuity authority', () => {
    assert.deepEqual(
        extractContinuityMarkers('<dm_story>x</dm_story><npc_track>y</npc_track><parallel_event_record>z</parallel_event_record>'),
        { records: [], taggedSections: [] },
    );
});

test('P4 exposes only the Doctor-owned host prompt and preserves exact-once state', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(
        source,
        /registerNextTurnConsumerProvider|selectNextTurnConsumerProvider|configureNextTurnConsumerProviderPreference|nextTurnConsumerProviders/u,
    );
    assert.match(source, /setExtensionPrompt\([\s\S]*?NEXT_TURN_CONSUMER_INJECTION_NAME/u);
    assert.match(source, /consumerLease = \{[\s\S]*?providerId: DOCTOR_NEXT_TURN_PROVIDER_ID/u);
    assert.match(source, /consumeProof = \{[\s\S]*?consumerPayloadDigest: active\.digest/u);
});

test('database brand probes are absent while generic host, MVU and embedded worldbooks remain', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(
        source,
        /legacyDoctorDatabasePatchDetected|tavernDatabaseDetected|tavernDatabaseScriptDetected|AutoCardUpdaterAPI|TavernDBAPI|SP_DATABASE|window\.TavernDB/u,
    );
    assert.doesNotMatch(
        source,
        /registerBarrierProtocolClient|getBarrierProtocolStatus|acknowledgeBarrierReceipt/u,
    );
    assert.match(source, /const helper = window\.TavernHelper[\s\S]*?helper\.waitGlobalInitialized\('Mvu'/u);
    assert.match(source, /function embeddedBooks\(character\)/u);
    assert.match(source, /registerMvuSchema[\s\S]*?SQL\(\?:ite\)\?/u);
});

test('profile fact priority uses a neutral authority proposal layer', async () => {
    const source = await readFile(new URL('../actor-profile-v6-core.mjs', import.meta.url), 'utf8');
    assert.match(source, /'authorityProposal',[\s\S]*?'acceptedNarrative',[\s\S]*?'authority'/u);
    assert.doesNotMatch(source, /'stitcher'/u);
});
