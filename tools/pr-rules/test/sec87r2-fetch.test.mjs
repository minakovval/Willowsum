// Security re-review of PR #87 (CICD-01), round 2: the window start and the map before a PR (stubbed API).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { DAILY_CHECK_STEP, baseMapFor, windowStart } from '../lib/fetch.mjs';
import { client } from '../lib/github.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function serve(route) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
    calls.push(key);
    const r = route(key, u);
    if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  return calls;
}
const gh = () => client({ token: 'test-token-not-real', repo: 'o/r' });
const until = new Date('2026-11-12T05:45:00Z');
const run = (id, started) => ({ id, run_started_at: started });
const steps = (unit, check) => ({ jobs: [{ steps: [{ name: 'PR rules unit tests', conclusion: unit }, { name: DAILY_CHECK_STEP, conclusion: check }] }] });
const runs = (list, jobsById) =>
  serve((key) => {
    if (key.includes('/actions/workflows/daily-main-check.yml/runs?')) return { body: { workflow_runs: list } };
    const m = /\/actions\/runs\/(\d+)\/jobs/.exec(key);
    return m ? { body: jobsById[m[1]] } : undefined;
  });

test('SEC87R2: only scheduled, completed runs are read (a manual run with a narrow --since never moves the window)', async () => {
  const calls = runs([run(1, '2026-11-11T05:41:00Z')], { 1: steps('success', 'success') });
  await windowStart(gh(), until);
  const list = calls.find((c) => c.includes('/runs?'));
  assert.match(list, /[?&]event=schedule(&|$)/);
  assert.match(list, /[?&]status=completed(&|$)/);
});

test('SEC87R2: a run whose unit tests passed but whose check step did not is not a checked window', async () => {
  runs([run(2, '2026-11-11T05:41:00Z'), run(1, '2026-11-10T05:41:00Z')], { 2: steps('success', 'skipped'), 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-10T04:41:00.000Z');
  runs([run(2, '2026-11-11T05:41:00Z'), run(1, '2026-11-10T05:41:00Z')], { 2: steps('failure', null), 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-10T04:41:00.000Z');
});

test('SEC87R2: a run that started after the end of the window is not its start', async () => {
  runs([run(3, '2026-11-12T06:00:00Z'), run(1, '2026-11-11T05:41:00Z')], { 3: steps('success', 'success'), 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-11T04:41:00.000Z');
});

test('SEC87R2: the hour of overlap never pushes the start past 7 days', async () => {
  runs([run(1, '2026-11-05T06:15:00Z')], { 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-05T05:45:00.000Z');
});

test('SEC87R2-B5: a window that falls back (API unreadable, capped at 7 days, runs but none checked) is marked as a gap', async () => {
  serve(() => ({ status: 502, body: { message: 'bad gateway' } }));
  assert.equal((await windowStart(gh(), until)).gap, true, 'run log unreadable: the last checked run is unknown');
  runs([run(1, '2026-10-01T05:41:00Z')], {});
  assert.equal((await windowStart(gh(), until)).gap, true, 'last checked run older than 7 days');
  runs([run(2, '2026-11-11T05:41:00Z')], { 2: steps('success', 'failure') });
  assert.equal((await windowStart(gh(), until)).gap, true, 'runs exist, none checked its window');
  runs([], {});
  assert.equal((await windowStart(gh(), until)).gap, undefined, 'the first run ever: nothing was missed');
  runs([run(1, '2026-11-11T05:41:00Z')], { 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).gap, undefined);
});

test('SEC87R2: the map before a PR is loaded also when the PR renames the map away; a missing base is no map', async () => {
  const PATHS = fs.readFileSync(new URL('../lib/paths.mjs', import.meta.url), 'utf8');
  const old = PATHS.replace("  money: [\n", "  money: [\n    'apps/web/**',\n");
  const contents = (text) => ({ body: { encoding: 'base64', content: Buffer.from(text).toString('base64') } });
  serve((key) => (key.startsWith('GET /repos/o/r/contents/tools/pr-rules/lib/paths.mjs?ref=base') ? contents(old) : undefined));
  const files = [{ filename: 'tools/pr-rules/lib/old-paths.mjs', previous_filename: 'tools/pr-rules/lib/paths.mjs' }, { filename: 'apps/web/src/App.tsx' }];
  assert.ok((await baseMapFor(gh(), files, 'base')).categories.includes('money'));
  // The base map's approval reasons are returned (a PR that edits the signals is judged by the old ones too).
  const wf = [{ filename: 'tools/pr-rules/lib/paths.mjs' }, { filename: '.github/workflows/deploy.yml', content: 'x' }];
  assert.ok((await baseMapFor(gh(), wf, 'base')).approvalReasons.length > 0);
  assert.equal(await baseMapFor(gh(), files, undefined), undefined);
});

test('SEC87R2: the newest checked run is the start (not an older one)', async () => {
  runs([run(2, '2026-11-11T05:41:00Z'), run(1, '2026-11-10T05:41:00Z')], { 2: steps('success', 'success'), 1: steps('success', 'success') });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-11T04:41:00.000Z');
});

test('SEC87R2: a merged PR read with fewer files than it changes is truncated; a change without a patch is unreadable', async () => {
  const { fetchDailyInput } = await import('../lib/fetch.mjs');
  const pull = { number: 90, title: 'x', merged_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:00Z', merge_commit_sha: 'c'.repeat(40), base: { ref: 'main' }, head: { sha: 'a'.repeat(40) }, labels: [] };
  const files = [
    { filename: 'infra/start/big.tf', status: 'modified' },
    { filename: 'infra/start/moved.tf', previous_filename: 'infra/start/old.tf', status: 'renamed' },
    { filename: 'apps/web/x.ts', status: 'modified', patch: '+x' },
  ];
  serve((key) => {
    if (key === 'GET /repos/o/r') return { body: { default_branch: 'main', owner: { login: 'o' } } };
    if (key === 'GET /repos/o/r/branches/main') return { body: { commit: { sha: 'c'.repeat(40) } } };
    if (key.startsWith('GET /repos/o/r/activity') || key.startsWith('GET /repos/o/r/commits?')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/pulls?state=closed')) return { body: [pull] };
    if (key === 'GET /repos/o/r/pulls/90') return { body: { changed_files: 4, body: '' } };
    if (key.startsWith('GET /repos/o/r/pulls/90/files')) return { body: files };
    if (key.includes('/check-runs?')) return { body: { check_runs: [] } };
    if (key.startsWith('GET /repos/o/r/commits/')) return { body: { parents: [{ sha: 'b'.repeat(40) }], commit: {} } };
    if (key.startsWith('GET /repos/o/r/pulls/90/') || key.startsWith('GET /repos/o/r/issues/90/')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/pulls?state=all') || key.startsWith('GET /repos/o/r/branches?')) return { body: [] };
    return undefined;
  });
  const input = await fetchDailyInput(gh(), { since: new Date('2026-11-11T11:00:00Z'), until: new Date('2026-11-12T12:00:00Z') });
  const [p] = input.pulls;
  assert.equal(p.filesTruncated, true);
  assert.deepEqual(p.files.map((f) => f.unreadable), [true, undefined, undefined]);
});

