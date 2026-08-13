import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildSocialRollbackOps,
    classifySocialAuditNeed,
    parseSocialAuditOutput,
} from '../social-core.mjs';

const changes = [
    { path: '/关系/甲/信任', before: 1, after: 2, beforeExists: true, afterExists: true },
    { path: '/关系/乙/忠诚', before: 0, after: 1, beforeExists: true, afterExists: true },
];

test('social routing ignores narrative style and runs only for actual relationship paths', () => {
    assert.deepEqual(classifySocialAuditNeed({
        replyText: '正文包含极端情绪、心理类型和职业描写。',
        changes: [],
        mode: 'strict',
    }), { needed: false, reasons: [] });
    assert.deepEqual(classifySocialAuditNeed({ changes, mode: 'balanced' }), {
        needed: true,
        reasons: ['relationship-change'],
    });
});

test('social output requires exact path coverage and never turns a global warning into bulk rollback', () => {
    const incomplete = parseSocialAuditOutput(JSON.stringify({
        verdict: 'warning',
        summary: '风格警告与关系路径无关',
        findings: [{ type: 'other', severity: 'warning', reason: '无关评价' }],
        decisions: [],
    }), changes);
    assert.match(incomplete.error, /missing relationship decisions/u);
    assert.deepEqual(buildSocialRollbackOps(changes, incomplete.decisions), []);

    const unknown = parseSocialAuditOutput(JSON.stringify({
        verdict: 'pass', findings: [],
        decisions: [{ path: '/关系/未知', action: 'allow' }],
    }), changes);
    assert.match(unknown.error, /unknown relationship path/u);

    const complete = parseSocialAuditOutput(JSON.stringify({
        verdict: 'warning',
        findings: [],
        decisions: [
            { path: changes[0].path, action: 'allow', reason: '有本轮证据' },
            { path: changes[1].path, action: 'revert', reason: '无本轮依据' },
        ],
    }), changes);
    assert.equal(complete.error, undefined);
    assert.deepEqual(buildSocialRollbackOps(changes, complete.decisions), [
        { op: 'replace', path: changes[1].path, value: 0 },
    ]);
});
