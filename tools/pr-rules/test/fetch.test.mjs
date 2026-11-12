// CICD-01 (ADR-0008): what the daily check reads — window start, the map before a PR, merged PR details.
// A stubbed `fetch` stands in for api.github.com; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test } from 'node:test';
import { DAILY_CHECK_STEP, baseMapFor, errorClass, fetchDailyInput, windowStart } from '../lib/fetch.mjs';
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
const jobs = (conclusion) => ({ jobs: [{ steps: [{ name: 'PR rules unit tests', conclusion: 'success' }, { name: DAILY_CHECK_STEP, conclusion }] }] });

test('review #87 item 7: the window starts an hour before the last run whose check step succeeded', async () => {
  serve((key) => {
    if (key.includes('/actions/workflows/daily-main-check.yml/runs?event=schedule')) {
      return { body: { workflow_runs: [run(3, '2026-11-11T05:41:00Z'), run(2, '2026-11-10T05:41:00Z'), run(1, '2026-11-09T05:41:00Z')] } };
    }
    if (key.includes('/actions/runs/3/jobs')) return { body: jobs('failure') }; // crashed: its window was not checked
    if (key.includes('/actions/runs/2/jobs')) return { body: jobs('skipped') };
    if (key.includes('/actions/runs/1/jobs')) return { body: jobs('success') };
    return undefined;
  });
  const w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-09T04:41:00.000Z');
  assert.match(w.note, /запуску 1/);
});

test('review #87 item 7: at most 7 days back; 25 hours when there is no run or the API cannot be read', async () => {
  serve((key) => (key.includes('/runs?') ? { body: { workflow_runs: [run(1, '2026-10-01T05:41:00Z')] } } : undefined));
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-05T05:45:00.000Z');
  serve((key) => (key.includes('/runs?') ? { body: { workflow_runs: [] } } : undefined));
  assert.equal((await windowStart(gh(), until)).since.toISOString(), '2026-11-11T04:45:00.000Z');
  serve(() => ({ status: 403, body: { message: 'Resource not accessible' } }));
  const w = await windowStart(gh(), until);
  assert.equal(w.since.toISOString(), '2026-11-11T04:45:00.000Z');
  assert.match(w.note, /не прочитано \(HTTP 403\)/);
});

test('review #87 item 9: the alert names the class of a failed fetch', () => {
  assert.equal(errorClass(new Error('GET /repos/o/r: HTTP 502 bad gateway')), 'HTTP 502');
  assert.equal(errorClass(new TypeError('fetch failed')), 'TypeError');
});

const PATHS = fs.readFileSync(new URL('../lib/paths.mjs', import.meta.url), 'utf8');
const contents = (text) => ({ body: { encoding: 'base64', content: Buffer.from(text).toString('base64') } });

test('review #87 item 9: a PR that edits the map is also classified by the map before it', async () => {
  // The old map marked `apps/web/**` as money; the PR drops that line.
  const old = PATHS.replace("  money: [\n", "  money: [\n    'apps/web/**',\n");
  serve((key) => (key.startsWith('GET /repos/o/r/contents/tools/pr-rules/lib/paths.mjs?ref=base') ? contents(old) : undefined));
  const files = [{ filename: 'tools/pr-rules/lib/paths.mjs' }, { filename: 'apps/web/src/App.tsx' }];
  const m = await baseMapFor(gh(), files, 'base');
  assert.ok(m.categories.includes('money'), JSON.stringify(m.categories));
  assert.equal(await baseMapFor(gh(), [{ filename: 'apps/web/src/App.tsx' }], 'base'), undefined, 'map unchanged: nothing to load');
  // A map that cannot be loaded fails closed.
  serve((key) => (key.includes('/contents/') ? contents('export const x = ;') : undefined));
  const broken = await baseMapFor(gh(), files, 'base');
  assert.equal(broken.sensitive, true);
  assert.equal(broken.approvalReasons.length, 1);
});

test('review #87 items 3, 5: a merged PR is read with its body and every check run (not only the latest)', async () => {
  const since = new Date('2026-11-11T11:00:00Z');
  const end = new Date('2026-11-12T12:00:00Z');
  const pull = {
    number: 90,
    title: 'CICD-01: x',
    merged_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    merge_commit_sha: 'c'.repeat(40),
    base: { ref: 'main' },
    head: { sha: 'a'.repeat(40) },
    labels: [],
  };
  const calls = serve((key) => {
    if (key === 'GET /repos/o/r') return { body: { default_branch: 'main', owner: { login: 'o' } } };
    if (key === 'GET /repos/o/r/branches/main') return { body: { commit: { sha: 'c'.repeat(40) } } };
    if (key.startsWith('GET /repos/o/r/activity') || key.startsWith('GET /repos/o/r/commits?')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/pulls?state=closed')) return { body: [pull] };
    if (key === 'GET /repos/o/r/pulls/90') return { body: { changed_files: 1, body: 'Рішення власника (2026-11-12): схвалено' } };
    if (key.startsWith('GET /repos/o/r/pulls/90/files')) return { body: [{ filename: 'AGENTS.md', status: 'modified', patch: '+x' }] };
    if (key.includes('/check-runs?')) return { body: { check_runs: [] } };
    if (key.startsWith('GET /repos/o/r/commits/')) return { body: { parents: [{ sha: 'b'.repeat(40) }], commit: {} } };
    if (key.startsWith('GET /repos/o/r/pulls/90/') || key.startsWith('GET /repos/o/r/issues/90/')) return { body: [] };
    if (key.startsWith('GET /repos/o/r/pulls?state=all') || key.startsWith('GET /repos/o/r/branches?')) return { body: [] };
    return undefined;
  });
  const input = await fetchDailyInput(gh(), { since, until: end, note: 'n' });
  assert.equal(input.pulls[0].body, 'Рішення власника (2026-11-12): схвалено');
  assert.equal(input.window.note, 'n');
  assert.ok(calls.some((c) => /\/check-runs\?filter=all&/.test(c)), 'filter=all: earlier runs too');
});
