// #503 (CICD-01 FR 3): the daily check survives transient GitHub failures and long windows. After a 500 «this
// diff is temporarily unavailable» (run 44107545974) and a «fetch failed» (run 44324851160) every next window
// was larger, and no run could catch up. A stubbed `fetch` stands in for api.github.com; no network.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { evaluate, needsAlert } from '../lib/daily.mjs';
import { DAILY_CHECK_STEP, RATE_RESERVE, dayChunks, fetchDailyInput, windowAnnotation, windowStart } from '../lib/fetch.mjs';
import { client } from '../lib/github.mjs';

process.env.PR_RULES_RETRY_MS ??= '1';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** `route(key) → { status, body, headers } | Error | undefined` (an Error is thrown like a dropped connection). */
function serve(route) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
    calls.push(key);
    const r = route(key, calls.filter((c) => c === key).length);
    if (r instanceof Error) throw r;
    if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return calls;
}
const gh = () => client({ token: 'test-token-not-real', repo: 'o/r' });
const DIFF_500 = { status: 500, body: { message: 'Server Error: Sorry, this diff is temporarily unavailable due to heavy server load.' } };

test('CICD-01 FR 3 (#503): a 500 from GitHub is retried, and the answer after it is used', async () => {
  const calls = serve((key, n) => (n === 1 ? DIFF_500 : { body: { commits: [{ sha: 'a' }] } }));
  assert.deepEqual(await gh().get('/{repo}/compare/x...y'), { commits: [{ sha: 'a' }] });
  assert.equal(calls.length, 2);
});

test('CICD-01 FR 3 (#503): a dropped connection («fetch failed») is retried', async () => {
  const calls = serve((key, n) => (n === 1 ? new TypeError('fetch failed') : { body: [{ id: 1 }] }));
  assert.deepEqual(await gh().get('/{repo}/pulls/1/reviews'), [{ id: 1 }]);
  assert.equal(calls.length, 2);
});

test('CICD-01 FR 3 (#503): retries end — a lasting 5xx still fails the call; a write is never repeated', async () => {
  let calls = serve(() => ({ status: 503, body: { message: 'unavailable' } }));
  await assert.rejects(gh().get('/{repo}/pulls/1'), /HTTP 503/);
  assert.equal(calls.length, 4, 'one call and three retries');
  calls = serve(() => DIFF_500);
  await assert.rejects(gh().post('/{repo}/issues', { title: 'x' }), /HTTP 500/);
  assert.equal(calls.length, 1, 'a repeated POST could open the alert issue twice');
  calls = serve(() => ({ status: 404 }));
  await assert.rejects(gh().get('/{repo}/pulls/1'), /HTTP 404/);
  assert.equal(calls.length, 1, 'a 4xx is final');
});

test('CICD-01 FR 3 (#503): a secondary rate limit with Retry-After is waited out; the primary limit is final', async () => {
  let calls = serve((key, n) => (n === 1 ? { status: 403, headers: { 'retry-after': '0' } } : { body: { ok: true } }));
  assert.deepEqual(await gh().get('/{repo}'), { ok: true });
  assert.equal(calls.length, 2);
  calls = serve(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } }));
  await assert.rejects(gh().get('/{repo}'), /HTTP 403/);
  assert.equal(calls.length, 1);
});

test('CICD-01 FR 3 (#503): a long window is split into day-sized parts, oldest first, without holes', () => {
  const parts = dayChunks(new Date('2026-11-16T12:57:00Z'), new Date('2026-11-19T23:00:00Z'));
  assert.deepEqual(
    parts.map((p) => [p.since.toISOString(), p.until.toISOString()]),
    [
      ['2026-11-16T12:57:00.000Z', '2026-11-17T12:57:00.000Z'],
      ['2026-11-17T12:57:00.000Z', '2026-11-18T12:57:00.000Z'],
      ['2026-11-18T12:57:00.000Z', '2026-11-19T12:57:00.000Z'],
      ['2026-11-19T12:57:00.000Z', '2026-11-19T23:00:00.000Z'],
    ],
  );
});

// A three-day window with one merged PR on its first and one on its last day.
const SINCE = new Date('2026-11-16T12:00:00Z');
const UNTIL = new Date('2026-11-19T12:00:00Z');
const merged = (number, at) => ({
  number,
  title: 'CICD-01: x',
  merged_at: at,
  updated_at: at,
  merge_commit_sha: String(number).repeat(40).slice(0, 40),
  base: { ref: 'main' },
  head: { sha: 'f'.repeat(40) },
  labels: [],
});
function windowApi({ rate }) {
  return serve((key) => {
    const headers = rate === undefined ? {} : { 'x-ratelimit-remaining': String(rate(key)) };
    if (key === 'GET /repos/o/r') return { body: { default_branch: 'main', owner: { login: 'o' } }, headers };
    if (key === 'GET /repos/o/r/branches/main') return { body: { commit: { sha: 'c'.repeat(40) } }, headers };
    if (key.startsWith('GET /repos/o/r/activity') || key.startsWith('GET /repos/o/r/commits?')) return { body: [], headers };
    if (key.startsWith('GET /repos/o/r/pulls?state=closed')) {
      return { body: [merged(72, '2026-11-19T08:00:00Z'), merged(71, '2026-11-16T15:00:00Z')], headers };
    }
    if (key.startsWith('GET /repos/o/r/pulls?') || key.startsWith('GET /repos/o/r/branches?')) return { body: [], headers };
    if (/^GET \/repos\/o\/r\/pulls\/7\d$/.test(key)) return { body: { body: '', changed_files: 0 }, headers };
    if (/^GET \/repos\/o\/r\/(pulls|issues)\/7\d\//.test(key) || key.includes('/check-runs')) return { body: key.includes('/check-runs') ? { check_runs: [] } : [], headers };
    if (key.startsWith('GET /repos/o/r/commits/')) return { body: { commit: {}, parents: [] }, headers };
    return undefined;
  });
}

test('CICD-01 FR 3 (#503): a three-day window is read day by day and all of it is checked when the calls suffice', async () => {
  const calls = windowApi({ rate: () => 900 });
  const input = await fetchDailyInput(gh(), { since: SINCE, until: UNTIL });
  const days = calls.filter((c) => c.startsWith('GET /repos/o/r/commits?'));
  assert.equal(days.length, 3, days.join('\n'));
  assert.match(days[0], /since=2026-11-16T12:00:00.000Z&until=2026-11-17T12:00:00.000Z/);
  assert.match(days[2], /since=2026-11-18T12:00:00.000Z&until=2026-11-19T12:00:00.000Z/);
  assert.deepEqual(input.pulls.map((p) => p.number), [72, 71]);
  assert.equal(input.window.until, UNTIL.toISOString());
  assert.equal(input.window.partial, undefined);
});

test('CICD-01 FR 3 (#503): when the calls left would not cover the next day, the window ends after the last whole day', async () => {
  // After the first day the token has fewer calls left than one merged PR and the alert issue need.
  let low = false;
  const calls = windowApi({ rate: (key) => (low || (low = key === 'GET /repos/o/r/pulls/71') ? RATE_RESERVE : 900) });
  const input = await fetchDailyInput(gh(), { since: SINCE, until: UNTIL });
  assert.ok(!calls.includes('GET /repos/o/r/pulls/72'), 'the PR of the unread day is not read');
  assert.deepEqual(input.pulls.map((p) => p.number), [71]);
  assert.equal(input.window.since, SINCE.toISOString());
  // The second day has nothing to read, so it fits the reserve; the third (PR #72) does not.
  assert.equal(input.window.until, '2026-11-18T12:00:00.000Z');
  assert.equal(input.window.partial, true);
  assert.equal(input.window.requested, UNTIL.toISOString());
  // The shortened window is reported for information; it is no alert by itself.
  const result = evaluate({ ...input, owner: 'o' });
  const note = result.findings.find((f) => f.subject === 'вікно перевірки');
  assert.equal(note.severity, 'info');
  assert.match(note.message, /перевірено до 2026-11-18T12:00:00.000Z/);
});

// windowStart: runs of both events, each job with the check step and (when given) its window annotation.
const until = new Date('2026-11-20T05:41:00Z');
const run = (id, started) => ({ id, run_started_at: started });
function runsApi({ schedule = [], manual = [], annotations = {} }) {
  return serve((key) => {
    if (key.includes('/runs?event=schedule')) return { body: { workflow_runs: schedule } };
    if (key.includes('/runs?event=workflow_dispatch')) return { body: { workflow_runs: manual } };
    const job = /\/actions\/runs\/(\d+)\/jobs/.exec(key);
    if (job) return { body: { jobs: [{ id: Number(job[1]) * 10, steps: [{ name: DAILY_CHECK_STEP, conclusion: 'success' }] }] } };
    const ann = /\/check-runs\/(\d+)\/annotations/.exec(key);
    if (ann) {
      const a = annotations[Number(ann[1]) / 10];
      if (a instanceof Error) return { status: 403, body: { message: 'no' } };
      return { body: a ? [{ title: 'main-check-window', annotation_level: 'notice', message: windowAnnotation(a).split('::').at(-1) }] : [] };
    }
    return undefined;
  });
}

test('CICD-01 FR 3 (#503): a manual run over the gap moves the window start; one that leaves a gap does not', async () => {
  // The last whole scheduled run ended at 16.11 13:57; a manual run checked 16.11 12:57 → 19.11 12:00.
  const schedule = [run(1, '2026-11-16T13:57:00Z')];
  runsApi({ schedule, manual: [run(2, '2026-11-19T10:25:40Z')], annotations: { 2: { since: '2026-11-16T12:57:00Z', until: '2026-11-19T12:00:00Z', chain: false } } });
  let w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-19T11:00:00.000Z');
  assert.match(w.note, /запуску 2/);
  // Today's two day-sized manual runs left 17.11 12:57 → 18.11 12:57 unchecked: the start stays before the hole.
  runsApi({
    schedule,
    manual: [run(4, '2026-11-19T10:26:00Z'), run(3, '2026-11-19T10:25:40Z')],
    annotations: { 3: { since: '2026-11-16T12:57:00Z', until: '2026-11-17T12:57:00Z', chain: false }, 4: { since: '2026-11-18T12:57:00Z', until: '2026-11-19T12:00:00Z', chain: false } },
  });
  w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-17T11:57:00.000Z');
  // A manual run made before the annotation existed is not counted: its window is unknown.
  runsApi({ schedule, manual: [run(5, '2026-11-19T10:25:40Z')] });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-16T12:57:00.000Z');
});

test('CICD-01 FR 3 (#503): a scheduled run that read only part of its window moves the start to where it stopped', async () => {
  runsApi({ schedule: [run(6, '2026-11-19T05:41:00Z')], annotations: { 6: { since: '2026-11-16T12:57:00Z', until: '2026-11-17T12:57:00Z', chain: true } } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-17T11:57:00.000Z');
  // An unreadable annotation: the run is not counted (the window only grows), the older run decides.
  runsApi({ schedule: [run(6, '2026-11-19T05:41:00Z'), run(1, '2026-11-16T13:57:00Z')], annotations: { 6: new Error('403') } });
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-16T12:57:00.000Z');
});

test('CICD-01 criterion «PR, злитий без зеленого CI» (#503): a job GitHub still lists as in_progress after it finished counts by its conclusion', () => {
  const JOBS = ['changes', 'secrets'];
  const pr = (checkRuns) => ({
    number: 464,
    title: 'CICD-01: x',
    merged_at: '2026-11-17T03:27:44Z',
    base_ref: 'main',
    head_sha: 'a'.repeat(40),
    head_date: '2026-11-17T02:20:00Z',
    merge_commit_sha: 'c'.repeat(40),
    labels: [],
    files: [{ filename: 'apps/web/src/App.tsx', status: 'modified' }],
    reviews: [{ id: 1, body: 'Verdict: Ready', commit_id: 'a'.repeat(40), submitted_at: '2026-11-17T03:00:00Z', user: 'o', state: 'COMMENTED' }],
    comments: [],
    checkRuns,
    requiredJobs: JOBS,
  });
  const runOf = (id, name, status, conclusion, done) => ({ id, name, app: 'github-actions', status, conclusion, completed_at: done });
  const input = (checkRuns) => ({ now: '2026-11-17T12:00:00Z', window: { since: '2026-11-16T12:00:00Z', until: '2026-11-17T12:00:00Z' }, owner: 'o', main: { name: 'main', head: 'c'.repeat(40) }, activities: [], commits: [], pulls: [pr(checkRuns)], branches: [] });
  // #464, run 44002293529: job `changes` reports status in_progress, conclusion success, completed 02:20:58.
  const stale = [runOf(1, 'changes', 'in_progress', 'success', '2026-11-17T02:20:58Z'), runOf(2, 'secrets', 'completed', 'success', '2026-11-17T02:21:03Z')];
  assert.deepEqual(evaluate(input(stale)).findings, []);
  // Still running at the merge (no conclusion), or finished after it: the PR was merged before CI ended.
  const running = [runOf(1, 'changes', 'in_progress', null, null), stale[1]];
  assert.match(evaluate(input(running)).findings[0].message, /changes: завершилась після злиття/);
  const late = [runOf(1, 'changes', 'completed', 'success', '2026-11-17T03:28:00Z'), stale[1]];
  assert.ok(needsAlert(evaluate(input(late))));
});
