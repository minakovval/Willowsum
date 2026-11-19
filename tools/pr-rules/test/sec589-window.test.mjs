// Security review of PR #589 (CICD-01 FR 3, #503): the window start cannot be steered past unchecked time,
// and a PR merged before CI finished stays flagged. A stubbed `fetch` stands in for api.github.com.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate, needsAlert } from '../lib/daily.mjs';
import { DAILY_CHECK_STEP, windowAnnotation, windowStart } from '../lib/fetch.mjs';
import { client } from '../lib/github.mjs';

process.env.PR_RULES_RETRY_MS ??= '1';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const gh = () => client({ token: ['not', 'a', 'real', 'value'].join('-'), repo: 'o/r' });
const until = new Date('2026-11-20T05:41:00Z');
const run = (id, started, more = {}) => ({ id, run_started_at: started, head_branch: 'main', head_sha: 'c'.repeat(40), ...more });
/** `done[id]`: when the job of run `id` completed (default: a minute after the run started). */
function runsApi({ schedule = [], manual = [], annotations = {}, done = {} }) {
  const all = [...schedule, ...manual];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const key = `${u.pathname}${u.search}`;
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (key === '/repos/o/r') return json({ default_branch: 'main' });
    if (key === '/repos/o/r/branches/main') return json({ commit: { sha: 'c'.repeat(40) } });
    // main is ahead of (contains) commit d…; commit e… is on another line (a tag named `main`, a rewritten branch)
    if (key.startsWith(`/repos/o/r/compare/${'d'.repeat(40)}...`)) return json({ status: 'ahead' });
    if (key.startsWith('/repos/o/r/compare/')) return json({ status: 'diverged' });
    if (key.includes('/runs?event=schedule')) return json({ workflow_runs: schedule });
    if (key.includes('/runs?event=workflow_dispatch')) return json({ workflow_runs: manual });
    const job = /\/actions\/runs\/(\d+)\/jobs/.exec(key);
    if (job) {
      const r = all.find((x) => x.id === Number(job[1]));
      const completed = done[r.id] ?? new Date(Date.parse(r.run_started_at) + 60_000).toISOString();
      return json({ jobs: [{ id: r.id * 10, started_at: r.run_started_at, completed_at: completed, steps: [{ name: DAILY_CHECK_STEP, conclusion: 'success' }] }] });
    }
    const ann = /\/check-runs\/(\d+)\/annotations/.exec(key);
    if (ann) {
      const a = annotations[Number(ann[1]) / 10];
      if (Array.isArray(a)) return json(a.map((message) => ({ title: 'main-check-window', annotation_level: 'notice', message })));
      return json(a ? [{ title: 'main-check-window', annotation_level: 'notice', message: windowAnnotation(a).split('::').at(-1) }] : []);
    }
    return new Response('{"message":"Not Found"}', { status: 404 });
  };
}
const LAST = run(1, '2026-11-18T05:41:00Z'); // the last whole scheduled run, before the annotation existed

test('CICD-01 FR 3 (#503, sec589): a manual run that names an end after its own time does not move the start past that time', async () => {
  // 18.11 06:00: a manual run «since 17.11, until 2099». It read what existed at 06:00, not the day after it.
  runsApi({ schedule: [LAST], manual: [run(2, '2026-11-18T06:00:00Z')], annotations: { 2: { since: '2026-11-17T00:00:00Z', until: '2099-01-01T00:00:00Z', chain: false } } });
  const w = await windowStart(gh(), until);
  assert.ok(w.since.getTime() <= Date.parse('2026-11-18T06:01:00Z'), `the window starts at ${w.since.toISOString()}: 18.11 06:01 → 20.11 04:41 is never checked`);
});

test('CICD-01 FR 3 (#503, sec589): a run with --until alone in the future (chain=yes) does not move the start past its own time', async () => {
  runsApi({ schedule: [LAST], manual: [run(3, '2026-11-18T06:00:00Z')], annotations: { 3: { since: '2026-11-18T04:41:00Z', until: '2026-11-23T00:00:00Z', chain: true } } });
  const w = await windowStart(gh(), until);
  assert.ok(w.since.getTime() <= Date.parse('2026-11-18T06:01:00Z'), `the window starts at ${w.since.toISOString()}`);
});

test('CICD-01 FR 3 (#503, sec589): a manual run from another branch (its own workflow file and code) is not counted', async () => {
  // Anyone with write access can dispatch the workflow on a branch whose check step only prints the annotation.
  const forged = run(4, '2026-11-20T05:00:00Z', { head_branch: 'x/forged' });
  runsApi({ schedule: [LAST], manual: [forged], annotations: { 4: { since: '2026-11-18T04:41:00Z', until: '2026-11-20T05:00:30Z', chain: true } } });
  const w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-18T04:41:00.000Z');
});

test('CICD-01 FR 3 (#503, sec589): a manual run named `main` counts only when its commit is in main', async () => {
  const ann = { since: '2026-11-18T04:41:00Z', until: '2026-11-20T05:00:30Z', chain: true };
  // An older commit of main: counted (up to the run's own job, 05:01).
  runsApi({ schedule: [LAST], manual: [run(7, '2026-11-20T05:00:00Z', { head_sha: 'd'.repeat(40) })], annotations: { 7: ann } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-20T04:00:30.000Z');
  // A commit main does not have (a tag `main`): not counted.
  runsApi({ schedule: [LAST], manual: [run(8, '2026-11-20T05:00:00Z', { head_sha: 'e'.repeat(40) })], annotations: { 8: ann } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-18T04:41:00.000Z');
});

test('CICD-01 FR 3 (#503, sec589): checked time that ends before the 7-day cap is a gap, as before', async () => {
  // A paced run two days ago stopped at 11.11; yesterday's run failed. 11.11 → 13.11 05:41 is not checked.
  runsApi({ schedule: [run(5, '2026-11-18T05:41:00Z')], annotations: { 5: { since: '2026-11-10T05:41:00Z', until: '2026-11-11T05:41:00Z', chain: true } } });
  const w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-13T05:41:00.000Z');
  assert.equal(w.gap, true, 'the unchecked days before the cap must be reported');
});

// Check runs of the merged heads as GitHub returned them on 2026-11-19 (required jobs only).
const REAL = {
  481: { merged: '2026-11-17T08:25:41Z', runs: [['changes', 'completed', 'success', '2026-11-17T08:25:47Z'], ['secrets', 'completed', 'success', '2026-11-17T08:25:58Z'], ['requirements', 'completed', 'success', '2026-11-17T08:27:21Z']] },
  407: { merged: '2026-11-16T20:58:48Z', runs: [['changes', 'completed', 'success', '2026-11-16T20:59:44Z'], ['secrets', 'completed', 'success', '2026-11-16T20:59:48Z'], ['requirements', 'completed', 'success', '2026-11-16T21:01:40Z']] },
  561: { merged: '2026-11-18T19:50:40Z', runs: [['changes', 'completed', 'success', '2026-11-18T19:52:02Z'], ['secrets', 'completed', 'failure', '2026-11-18T19:52:13Z'], ['requirements', 'completed', 'success', '2026-11-18T19:54:09Z']] },
};
const input = (number, merged, checkRuns) => ({
  now: '2026-11-19T12:00:00Z',
  window: { since: '2026-11-16T12:00:00Z', until: '2026-11-19T12:00:00Z' },
  owner: 'o',
  main: { name: 'main', head: 'c'.repeat(40) },
  activities: [],
  commits: [],
  branches: [],
  pulls: [
    {
      number,
      title: 'CICD-01: x',
      merged_at: merged,
      base_ref: 'main',
      head_sha: 'a'.repeat(40),
      head_date: '2026-11-16T00:00:00Z',
      merge_commit_sha: 'c'.repeat(40),
      labels: [],
      files: [{ filename: 'docs/x.md', status: 'modified' }],
      reviews: [{ id: 1, body: 'Verdict: Ready', commit_id: 'a'.repeat(40), submitted_at: '2026-11-16T00:10:00Z', user: 'o', state: 'COMMENTED' }],
      comments: [],
      checkRuns,
      requiredJobs: ['changes', 'secrets', 'requirements'],
    },
  ],
});
const ci = (result) => result.findings.filter((f) => /CI|завершилась|не запускалась/.test(f.message));

test('CICD-01 criterion «PR, злитий без зеленого CI» (sec589): #481, #407 and #561, merged before CI finished, stay flagged', () => {
  for (const [n, { merged, runs }] of Object.entries(REAL)) {
    const checkRuns = runs.map(([name, status, conclusion, done], i) => ({ id: i + 1, name, app: 'github-actions', status, conclusion, completed_at: done }));
    const result = evaluate(input(Number(n), merged, checkRuns));
    assert.ok(needsAlert(result), `#${n}`);
    for (const job of ['changes', 'secrets', 'requirements']) assert.match(JSON.stringify(ci(result)), new RegExp(`${job}: завершилась після злиття`), `#${n} ${job}`);
  }
});

test('CICD-01 criterion «PR, злитий без зеленого CI» (sec589): only a finished job counts — a conclusion alone, a queued job or a failed one does not pass', () => {
  const merged = '2026-11-17T03:27:44Z';
  const ok = [['secrets', 'completed', 'success', '2026-11-17T02:21:03Z'], ['requirements', 'completed', 'success', '2026-11-17T02:22:00Z']];
  const rows = (changes) => [changes, ...ok].map(([name, status, conclusion, done], i) => ({ id: i + 1, name, app: 'github-actions', status, conclusion, completed_at: done }));
  const flagged = (changes) => needsAlert(evaluate(input(464, merged, rows(changes))));
  assert.equal(flagged(['changes', 'in_progress', 'success', '2026-11-17T02:20:58Z']), false, 'the #464 case passes');
  assert.equal(flagged(['changes', 'in_progress', 'success', null]), true, 'a conclusion without a completion time');
  assert.equal(flagged(['changes', 'in_progress', null, '2026-11-17T02:20:58Z']), true, 'a completion time without a conclusion');
  assert.equal(flagged(['changes', 'in_progress', 'success', '2026-11-17T03:28:00Z']), true, 'finished after the merge');
  assert.equal(flagged(['changes', 'in_progress', 'failure', '2026-11-17T02:20:58Z']), true, 'a failed job');
  assert.equal(flagged(['changes', 'in_progress', 'cancelled', '2026-11-17T02:20:58Z']), true, 'a cancelled job');
  assert.equal(flagged(['changes', 'queued', 'success', '2026-11-17T02:20:58Z']), true, 'a queued job is not finished');
});

test('CICD-01 FR 3 (#503, sec589): a job with two window annotations, or a window that ends before it starts, is not counted', async () => {
  const older = run(1, '2026-11-16T05:41:00Z');
  const expect = '2026-11-16T04:41:00.000Z'; // from the older run: the window only grows
  // A second annotation (printed by another step, or by text the report echoes) cannot choose the window.
  runsApi({ schedule: [run(9, '2026-11-19T05:41:00Z'), older], annotations: { 9: ['since=2026-11-18T04:41:00Z until=2026-11-19T05:41:05Z chain=yes', 'since=2026-11-18T04:41:00Z until=2026-11-19T05:41:30Z chain=yes'] } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), expect);
  runsApi({ schedule: [run(9, '2026-11-19T05:41:00Z'), older], annotations: { 9: ['since=2026-11-19T05:41:30Z until=2026-11-19T05:41:00Z chain=yes'] } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), expect);
  runsApi({ schedule: [run(9, '2026-11-19T05:41:00Z'), older], annotations: { 9: ['since=x until=2026-11-19T05:41:30Z chain=yes'] } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), expect);
});

test('CICD-01 FR 3 (#503, sec589): the start is never after the end of the window being read', async () => {
  // A manual run «--until 05:41» made while the 05:40 run was still going (its job ended at 05:50).
  runsApi({ schedule: [run(10, '2026-11-20T05:40:00Z')], done: { 10: '2026-11-20T05:50:00Z' }, annotations: { 10: { since: '2026-11-19T04:40:00Z', until: '2026-11-20T05:45:00Z', chain: true } } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-20T04:41:00.000Z');
});

test('CICD-01 FR 3 (#503, sec589): retries always end — a lasting secondary limit or dropped connection is 4 calls, a long Retry-After is 1', async () => {
  let calls = 0;
  const answer = (make) => {
    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls > 20) throw new Error('retries do not end');
      return make();
    };
  };
  answer(() => new Response('{"message":"secondary rate limit"}', { status: 403, headers: { 'retry-after': '0' } }));
  await assert.rejects(gh().get('/{repo}'), /HTTP 403/);
  assert.equal(calls, 4);
  answer(() => new Response('{"message":"secondary rate limit"}', { status: 429, headers: { 'retry-after': '3600' } }));
  await assert.rejects(gh().get('/{repo}'), /HTTP 429/);
  assert.equal(calls, 1, 'an hour of waiting does not fit the job: the answer is final');
  answer(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(gh().get('/{repo}'), /fetch failed/);
  assert.equal(calls, 4);
});

test('CICD-01 FR 3 (#503, sec589): `daily` refuses a window that ends in the future, before any call', async () => {
  const index = fileURLToPath(new URL('../index.mjs', import.meta.url));
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: 'http://127.0.0.1:9' };
  const r = await new Promise((resolve) => {
    execFile(process.execPath, [index, 'daily', '--since', '2026-11-01T00:00:00Z', '--until', '2099-01-01T00:00:00Z'], { env }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr }));
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--until must not be in the future/);
  assert.doesNotMatch(r.out, /main-check-window/);
});

test('CICD-01 FR 3 (#503, sec589): the annotation says chain=yes only for a window that began where the checked time ended', async () => {
  // `daily` end to end (dry run); the child's `fetch` is replaced by a preloaded stub: an empty repository,
  // and (SEC589_RUNS=unchecked) one earlier scheduled run whose check step did not succeed → a gap.
  const stub = `
    const json = (b) => new Response(JSON.stringify(b), { status: 200 });
    globalThis.fetch = async (url) => {
      const p = new URL(url).pathname + new URL(url).search;
      if (p === '/repos/o/r') return json({ default_branch: 'main', owner: { login: 'o' } });
      if (p === '/repos/o/r/branches/main') return json({ commit: { sha: 'c'.repeat(40) } });
      if (p.includes('/runs?event=schedule')) return json({ workflow_runs: process.env.SEC589_RUNS === 'unchecked' ? [{ id: 1, run_started_at: new Date(Date.now() - 3600e3).toISOString() }] : [] });
      if (p.includes('/runs?event=')) return json({ workflow_runs: [] });
      if (p.includes('/actions/runs/')) return json({ jobs: [] });
      return json([]);
    };`;
  const index = fileURLToPath(new URL('../index.mjs', import.meta.url));
  const daily = (args, runs = '') =>
    new Promise((resolve) => {
      const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: ['not', 'real'].join('-'), SEC589_RUNS: runs };
      execFile(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, index, 'daily', ...args], { env }, (err, stdout) => resolve(stdout));
    });
  const line = (out) => out.split('\n').filter((l) => l.startsWith('::notice title=main-check-window::'));
  const chained = line(await daily([]));
  assert.equal(chained.length, 1);
  assert.match(chained[0], /chain=yes$/);
  const manual = line(await daily(['--since', '2026-11-18T00:00:00Z']));
  assert.equal(manual.length, 1);
  assert.match(manual[0], /^::notice title=main-check-window::since=2026-11-18T00:00:00.000Z until=\S+ chain=no$/);
  const gap = line(await daily([], 'unchecked'));
  assert.equal(gap.length, 1);
  assert.match(gap[0], /chain=no$/, 'a window after a gap does not continue the checked time');
});
