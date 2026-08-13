import assert from 'node:assert/strict';
import test from 'node:test';

import { constrainForumCausalSignals } from '../forum-core.mjs';

test('forum cannot promote its own causal claim without a public continuity source', () => {
    const base = {
        summary: 'increment',
        newPosts: [
            {
                id: 'valid',
                sourceThreadIds: ['THREAD-PUBLIC'],
                causalSignal: true,
                impact: 'an already public process continues outside the forum',
            },
            {
                id: 'unknown',
                sourceThreadIds: ['THREAD-HIDDEN'],
                causalSignal: true,
                impact: 'invented external impact',
            },
            {
                id: 'empty',
                sourceThreadIds: [],
                causalSignal: true,
                impact: 'self reported impact',
            },
        ],
    };
    const constrained = constrainForumCausalSignals(base, ['THREAD-PUBLIC']);
    assert.equal(constrained.newPosts[0].causalSignal, true);
    assert.equal(constrained.newPosts[0].impact, base.newPosts[0].impact);
    assert.equal(constrained.newPosts[1].causalSignal, false);
    assert.equal(constrained.newPosts[1].impact, '');
    assert.deepEqual(constrained.newPosts[1].sourceThreadIds, []);
    assert.equal(constrained.newPosts[2].causalSignal, false);
    assert.equal(constrained.newPosts[2].impact, '');
});
