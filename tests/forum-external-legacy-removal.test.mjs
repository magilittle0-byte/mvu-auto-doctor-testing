import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runtime = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('world forum has one Doctor-owned provider and no external forum bridge', () => {
    assert.doesNotMatch(runtime, /zsd/iu);
    assert.doesNotMatch(runtime, /externalForumElements|hasExternalForum|openExternalForum/iu);
    assert.doesNotMatch(runtime, /mvuad-forum-(?:external|source-note|provider-select)/u);
    assert.doesNotMatch(styles, /mvuad-forum-(?:source-note|provider)\b/u);

    assert.match(runtime, /function forumAutoRefreshEnabled\(settings = getSettings\(\)\)/u);
    assert.match(runtime, /settings\.builtInForumEnabled[\s\S]*settings\.forumRefreshMode === 'auto'/u);
    assert.match(runtime, /\.mvuad-floating-forum'\)\.addEventListener\('click', showForumPanel\)/u);
    assert.match(runtime, /\.mvuad-forum-open'\)\.addEventListener\('click', showForumPanel\)/u);
});

test('upgrade removes the obsolete provider selector without touching forum state', () => {
    assert.match(runtime, /delete settings\.forumProvider;/u);
    assert.match(runtime, /forumSettingsVersion: 4/u);
    assert.match(runtime, /fields: \['forum', 'forumCheckpoint'\]/u);
    assert.match(runtime, /publicContinuityRecordsForForum/u);
    assert.match(runtime, /constrainForumCausalSignals/u);
});

test('model routing exposes only neutral direct and host capabilities', () => {
    assert.doesNotMatch(runtime, /StoryOracleAPI|story-oracle|故事神谕|故事神域/iu);
    assert.match(runtime, /!\['tavern', 'direct'\]\.includes\(settings\.strictModelProvider\)/u);
    assert.match(runtime, /!\['tavern', 'direct'\]\.includes\(settings\.fastModelProvider\)/u);
    assert.match(runtime, /typeof context\?\.generateRaw !== 'function'/u);
});
