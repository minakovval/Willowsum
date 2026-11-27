// Створено: 2026-11-27 · Оновлено: 2026-11-27
// Security review of PRC-02 (#751): merge-ready must never print READY for a PR the merge checklist would stop.
// Tests marked «fails on a8ff01c» fail on the reviewed head and pass with the reviewer patch.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { evaluate, main } from '../lib/merge-ready.mjs';
import { sensitiveSync, syncCheckCli } from '../lib/sync-confirm.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = { login: 'owner' };
const review = (id, body, { user = OWNER, at = `2026-11-2${id}T10:00:00Z`, commit = HEAD } = {}) => ({ id, commit_id: commit, body, submitted_at: at, state: 'COMMENTED', user });
const run = (name, status = 'completed', conclusion = 'success') => ({ name, status, conclusion });

function world(over = {}) {
  const w = {
    pr: { head: { sha: HEAD }, base: { repo: { owner: OWNER } }, labels: [], body: '', mergeable_state: 'clean' },
    reviewPages: [[review(1, 'Verdict: Ready')]],
    runPages: [[run('web'), run('api')]],
    comments: [],
    prFiles: [{ filename: 'apps/web/a.ts' }],
    mainFiles: [],
    ...over,
  };
  const gh = async (args) => {
    const p = args[0];
    if (/\/pulls\/\d+$/.test(p)) return JSON.stringify(w.pr);
    if (p.includes('/reviews')) return JSON.stringify(w.reviewPages);
    if (p.includes('/check-runs')) return JSON.stringify(w.runPages.map((check_runs) => ({ check_runs })));
    if (p.includes('/compare/')) return JSON.stringify({ files: w.mainFiles });
    if (p.includes('/pulls/') && p.includes('/files')) return JSON.stringify([w.prFiles]);
    if (p.includes('/comments')) return JSON.stringify([w.comments]);
    throw new Error(`unexpected ${p}`);
  };
  return gh;
}
const check = (over) => evaluate(7, { gh: world(over), sleep: async () => {} });
const has = (r, re) => r.lines.some((l) => re.test(l));

test('a verdict from an account other than the owner is no verdict (ADR-0008, as the daily check) — fails on a8ff01c', async () => {
  const stranger = { login: 'someone-else' };
  const r = await check({
    pr: { head: { sha: HEAD }, base: { repo: { owner: OWNER } }, labels: [{ name: 'sensitive:pipeline' }], body: '', mergeable_state: 'clean' },
    reviewPages: [[review(1, 'Verdict: Changes requested'), review(2, 'Verdict: Ready\n\nSecurity verdict: Ready', { user: stranger })]],
  });
  assert.equal(r.ready, false);
  assert.equal(r.lines.at(-1), 'NOT READY');
});

test('an owner «stop» stays listed after a later review — fails on a8ff01c', async () => {
  const comments = [{ user: OWNER, created_at: '2026-11-21T12:00:00Z', body: 'stop' }];
  const r = await check({ reviewPages: [[review(1, 'Verdict: Ready', { at: '2026-11-21T10:00:00Z' }), review(2, 'Verdict: Ready', { at: '2026-11-22T10:00:00Z' })]], comments });
  assert.ok(has(r, /^\s+owner\t2026-11-21T12:00:00Z\tstop$/));
});

test('a sensitive path without the label still needs Security verdict: Ready — fails on a8ff01c', async () => {
  const r = await check({ prFiles: [{ filename: 'tools/pr-rules/lib/merge-ready.mjs' }] });
  assert.equal(r.ready, false);
  assert.ok(has(r, /FAIL Security verdict: none/));
});

test('mergeable_state draft or missing is not READY — fails on a8ff01c', async () => {
  for (const mergeable_state of ['draft', null, undefined]) {
    const r = await check({ pr: { head: { sha: HEAD }, base: { repo: { owner: OWNER } }, labels: [], body: '', mergeable_state } });
    assert.equal(r.ready, false, String(mergeable_state));
  }
});

test('a comment body cannot carry control characters into the lead\'s output — fails on a8ff01c', async () => {
  const r = await check({ comments: [{ user: OWNER, created_at: '2026-11-30T00:00:00Z', body: 'x\u001b[2Ky\u0085z' }] });
  assert.ok(r.lines.every((l) => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(l)));
});

test('every completed conclusion other than success/skipped is not green (cancelled, timed_out, neutral, action_required, startup_failure, stale, null)', async () => {
  for (const c of ['cancelled', 'timed_out', 'neutral', 'action_required', 'startup_failure', 'stale', null]) {
    const r = await check({ runPages: [[run('web'), run('api', 'completed', c)]] });
    assert.equal(r.ready, false, String(c));
    assert.ok(has(r, /FAIL CI: not green/), String(c));
  }
});

test('check runs are read on every page: a failure on page 2 is not READY', async () => {
  const r = await check({ runPages: [Array.from({ length: 100 }, (_, i) => run(`j${i}`)), [run('late', 'completed', 'failure')]] });
  assert.equal(r.ready, false);
  assert.ok(has(r, /late=failure/));
});

test('reviews are read on every page: a later «Changes requested» on page 2 wins', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => review(1, i ? 'note' : 'Verdict: Ready', { at: `2026-11-01T10:${String(i % 60).padStart(2, '0')}:00Z` }));
  const r = await check({ reviewPages: [page1, [review(2, 'Verdict: Changes requested', { at: '2026-11-25T10:00:00Z' })]] });
  assert.equal(r.ready, false);
});

test('renames count for sync: main renamed a PR file, or changed the old name of a file the PR renamed', async () => {
  const a = await check({ mainFiles: [{ filename: 'apps/web/b.ts', previous_filename: 'apps/web/a.ts' }] });
  assert.ok(has(a, /FAIL sync: .*apps\/web\/a\.ts \(PR file\)/));
  const b = await check({ prFiles: [{ filename: 'apps/web/new.ts', previous_filename: 'apps/web/old.ts' }], mainFiles: [{ filename: 'apps/web/old.ts' }] });
  assert.ok(has(b, /FAIL sync: apps\/web\/old\.ts \(PR file\)/));
});

test('main exits 1 when a PR is NOT READY', async () => {
  assert.equal(await main(['7'], { gh: world({ runPages: [[run('api', 'completed', 'failure')]] }), sleep: async () => {}, out: () => {} }), 1);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sec-'));
  const git = (args, input) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, input, encoding: 'utf8' });
  const write = (f, t) => fs.writeFileSync(path.join(dir, f), t);
  const commit = (m) => { git(['add', '-A']); git(['commit', '-q', '-m', m]); return git(['rev-parse', 'HEAD']).trim(); };
  git(['init', '-q', '-b', 'main']);
  write('g.txt', 'g\n');
  commit('base');
  git(['checkout', '-q', '-b', 'pr']);
  write('a.txt', 'a\n');
  const old = commit('pr');
  git(['checkout', '-q', 'main']);
  write('m.txt', 'm\n');
  commit('main');
  return { dir, git, write, commit, old };
}
const FOUNDATION = '```foundation-paths\nfoundation/**\n```\n';

test('a sync merge with a hand change (not mechanical) is reported', () => {
  const r = repo();
  r.git(['checkout', '-q', 'pr']);
  r.git(['merge', '-q', '--no-ff', '--no-commit', 'main']);
  r.write('g.txt', 'evil\n');
  const neu = r.commit('sync');
  assert.match(sensitiveSync(r.git, r.old, neu, { base: 'main', foundationMd: FOUNDATION }), /not-mechanical:/);
});

test('--sync-check exits 1 on «changed» or a failed sensitive condition, 0 when all hold', () => {
  const r = repo();
  r.git(['checkout', '-q', 'pr']);
  r.git(['merge', '-q', '--no-ff', '-m', 'sync', 'main']);
  const good = r.git(['rev-parse', 'HEAD']).trim();
  // origin/main → main; fetch is a no-op; merge-rules.md is read from the real repository (no foundation file here).
  const git = (args, input) => (args[0] === 'fetch' ? '' : r.git(args.map((a) => (a === 'origin/main' ? 'main' : a)), input));
  assert.equal(syncCheckCli([r.old, good, '--sensitive'], { git, out: () => {} }), 0);
  r.git(['commit', '-q', '--allow-empty', '-m', 'empty']);
  const empty = r.git(['rev-parse', 'HEAD']).trim();
  assert.equal(syncCheckCli([r.old, empty], { git, out: () => {} }), 0);
  assert.equal(syncCheckCli([r.old, empty, '--sensitive'], { git, out: () => {} }), 1);
  r.write('a.txt', 'changed\n');
  const bad = r.commit('author change');
  assert.equal(syncCheckCli([r.old, bad], { git, out: () => {} }), 1);
  assert.equal(syncCheckCli([r.old, bad, '--sensitive'], { git, out: () => {} }), 1);
});
