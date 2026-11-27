// Survivors of the PR #734 security review mutants: semgrep's exit status is fail-closed; an allowlist entry holds
// only for its own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSast } from '../lib.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.mjs');

test('CICD-02@PoC criterion «Статичний аналіз безпеки коду»: semgrep exiting non-zero fails the job even with clean JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-semgrep-exit-'));
  try {
    const fake = join(dir, 'semgrep');
    writeFileSync(fake, `#!/bin/sh\necho '{"results":[],"errors":[],"paths":{"scanned":[]}}'\nexit 2\n`);
    chmodSync(fake, 0o755);
    const run = spawnSync(process.execPath, [CLI, 'sast', '--semgrep', fake, dir], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /::error::semgrep exited with status 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CICD-02@PoC criterion «Статичний аналіз безпеки коду»: an allowlist entry does not cover the same code in another file', () => {
  const line = 'await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);';
  const entry = { rule: 'ws-sql-template-interpolation', path: 'apps/api/src/x.ts', match: 'ALTER TABLE ${t}' };
  const result = (path) => ({ check_id: 'x.ws-sql-template-interpolation', path, start: { line: 1 }, end: { line: 1 }, extra: { severity: 'ERROR' } });
  const r = evaluateSast({ results: [result('apps/api/src/y.ts')], errors: [] }, { sast: [entry], sca: [] }, () => line, { fullScan: false });
  assert.equal(r.blocking.length, 1);
  assert.equal(r.allowed.length, 0);
});

// Review #734 round 1 (security follow-up made exact): an entry accepts exactly `count` findings (default 1) and its
// `match` is a piece of code long enough to name one line, so a new interpolation on an allowlisted line blocks.
const finding = (line) => ({ check_id: 'x.ws-sql-template-interpolation', path: 'apps/api/src/x.ts', start: { line }, end: { line }, extra: { severity: 'ERROR' } });
const LINES = ['', 'await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);', 'await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY ${extra}`);'];
const src = (_, start) => LINES[start - 1];
const entry = (over = {}) => ({ rule: 'ws-sql-template-interpolation', path: 'apps/api/src/x.ts', match: 'ALTER TABLE ${t} ENABLE', ...over });

test('CICD-02@PoC criterion «Статичний аналіз безпеки коду»: an allowlist entry accepts exactly its count of findings; one more blocks', () => {
  const two = { results: [finding(2), finding(3)], errors: [] };
  const one = evaluateSast(two, { sast: [entry()], sca: [] }, src);
  assert.equal(one.allowed.length, 1);
  assert.equal(one.blocking.length, 1, 'the second finding the same entry would cover blocks');
  const both = evaluateSast(two, { sast: [entry({ count: 2 })], sca: [] }, src);
  assert.equal(both.blocking.length, 0);
  assert.equal(both.allowed.length, 2);
  // Fewer findings than the count in a full scan: the entry is stale.
  const fewer = evaluateSast({ results: [finding(2)], errors: [] }, { sast: [entry({ count: 2 })], sca: [] }, src);
  assert.equal(fewer.stale.length, 1);
});

test('CICD-02@PoC criterion «Статичний аналіз безпеки коду»: an allowlist match shorter than 16 characters or a bad count is refused', async () => {
  const { validateAllowlist } = await import('../lib.mjs');
  const base = {
    rule: 'ws-sql-template-interpolation',
    path: 'apps/api/src/x.ts',
    kind: 'false-positive',
    reason: 'r',
    owner: 'lead agent',
    decision: 'Рішення ведучого (2026-11-27; власник не схвалював)',
    review_by: '2027-05-27',
  };
  assert.deepEqual(validateAllowlist({ sast: [{ ...base, match: 'ALTER TABLE ${t} ENABLE' }], sca: [] }, '2026-11-27'), []);
  assert.match(validateAllowlist({ sast: [{ ...base, match: '${t}' }], sca: [] }, '2026-11-27').join('\n'), /at least 16 characters/);
  for (const count of [0, 1.5, '2']) {
    assert.match(validateAllowlist({ sast: [{ ...base, match: 'ALTER TABLE ${t} ENABLE', count }], sca: [] }, '2026-11-27').join('\n'), /"count"/);
  }
});
