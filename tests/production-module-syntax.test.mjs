import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

test('production index parses as an ES module before host activation', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: source,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout || 'module syntax check failed');
});
