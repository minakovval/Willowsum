// Створено: 2026-11-27 · Оновлено: 2026-11-27
// merge-ready (process review 35, item 2): the step-6 conditions of the merge checklist, with canned `gh api` answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, latestVerdict, main, syncNeeded, waitCi } from '../lib/merge-ready.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const review = (id, commit, body, at = `2026-11-2${id}T10:00:00Z`) => ({ id, commit_id: commit, body, submitted_at: at, state: 'COMMENTED', user: { login: 'owner' } });
const run = (name, status = 'completed', conclusion = 'success') => ({ name, status, conclusion });

/** Fake `gh api`: `world` holds one PR; answers by path, in the shape `--paginate --slurp` gives. */
function world(over = {}) {
  const w = {
    pr: { head: { sha: HEAD }, labels: [], body: '', mergeable_state: 'clean' },
    reviews: [review(1, HEAD, 'Verdict: Ready')],
    runs: [run('web'), run('api')],
    comments: [],
    prFiles: ['apps/web/a.ts'],
    mainFiles: [],
    states: undefined, // successive mergeable_state answers
    ...over,
  };
  w.pr = { base: { repo: { owner: { login: 'owner' } } }, ...w.pr };
  const calls = [];
  const gh = async (args) => {
    const path = args[0];
    calls.push(path);
    if (/\/pulls\/\d+$/.test(path)) return JSON.stringify(w.states ? { ...w.pr, mergeable_state: w.states.shift() ?? 'unknown' } : w.pr);
    if (path.includes('/reviews')) return JSON.stringify([w.reviews]);
    if (path.includes('/check-runs')) return JSON.stringify([{ check_runs: typeof w.runs === 'function' ? w.runs() : w.runs }]);
    if (path.includes('/compare/')) return JSON.stringify({ files: w.mainFiles.map((filename) => ({ filename })) });
    if (path.includes('/pulls/') && path.includes('/files')) return JSON.stringify([w.prFiles.map((filename) => ({ filename }))]);
    if (path.includes('/comments')) return JSON.stringify([w.comments]);
    throw new Error(`unexpected ${path}`);
  };
  gh.calls = calls;
  return { w, gh };
}
const check = async (over) => {
  const { gh } = world(over);
  return evaluate(7, { gh, sleep: async () => {} });
};
const has = (r, re) => r.lines.some((l) => re.test(l));

test('all conditions met: READY', async () => {
  const r = await check();
  assert.equal(r.ready, true);
  assert.equal(r.lines.at(-1), 'READY');
});

test('#585 class: Ready on a previous SHA does not count', async () => {
  const r = await check({ reviews: [review(1, OLD, 'Verdict: Ready')] });
  assert.equal(r.ready, false);
  assert.ok(has(r, /FAIL Verdict: latest Ready is on bbbbbbb, head is aaaaaaa/));
  assert.equal(r.lines.at(-1), 'NOT READY');
});

test('#585 class: sensitive PR (label sensitive:pipeline) without Security verdict', async () => {
  const r = await check({ pr: { head: { sha: HEAD }, labels: [{ name: 'sensitive:pipeline' }], body: '', mergeable_state: 'clean' } });
  assert.equal(r.ready, false);
  assert.ok(has(r, /FAIL Security verdict: none/));
});

test('sensitive PR with both verdicts on the head is READY; a Security verdict on an old head is not', async () => {
  const pr = { head: { sha: HEAD }, labels: [{ name: 'sensitive' }], body: '', mergeable_state: 'clean' };
  const both = [review(1, HEAD, 'Verdict: Ready'), review(2, HEAD, 'Security verdict: Ready')];
  assert.equal((await check({ pr, reviews: both })).ready, true);
  const stale = [review(1, HEAD, 'Verdict: Ready'), review(2, OLD, 'Security verdict: Ready')];
  assert.equal((await check({ pr, reviews: stale })).ready, false);
});

test('latest verdict «Changes requested» after an earlier Ready: not ready', async () => {
  const reviews = [review(1, HEAD, 'Verdict: Ready'), review(2, HEAD, 'Verdict: Changes requested')];
  const r = await check({ reviews });
  assert.equal(r.ready, false);
  assert.ok(has(r, /Verdict: latest is «Changes requested»/));
});

test('#526: Changes requested on the old head, then Ready on the new head: ready; the reverse order is not', async () => {
  const fixed = [review(1, OLD, 'Verdict: Changes requested'), review(2, HEAD, 'Verdict: Ready')];
  assert.equal((await check({ reviews: fixed })).ready, true);
  const broken = [review(1, HEAD, 'Verdict: Ready'), review(2, HEAD, 'Verdict: Changes requested')];
  assert.equal((await check({ reviews: broken })).ready, false);
});

test('#569: a lead-confirmed sync is a review naming the new head and counts', async () => {
  const reviews = [review(1, OLD, 'Verdict: Ready'), review(2, HEAD, `Reviewed head: ${HEAD}\nunchanged\nVerdict: Ready`)];
  assert.equal((await check({ reviews })).ready, true);
});

test('a dismissed or pending review gives no verdict; a quoted line is no verdict', async () => {
  assert.equal(latestVerdict([{ ...review(1, HEAD, 'Verdict: Ready'), state: 'DISMISSED' }], 'review'), null);
  assert.equal(latestVerdict([{ ...review(1, HEAD, 'Verdict: Ready'), state: 'PENDING' }], 'review'), null);
  assert.equal(latestVerdict([review(1, HEAD, '> Verdict: Ready')], 'review'), null);
});

test('no check runs yet: not finished', async () => {
  const r = await check({ runs: [] });
  assert.equal(r.ready, false);
  assert.ok(has(r, /FAIL CI: no check runs yet/));
});

test('a run still in progress, and a failed run: not ready', async () => {
  assert.ok(has(await check({ runs: [run('web'), run('api', 'in_progress', null)] }), /FAIL CI: 1 of 2 check runs not completed/));
  assert.ok(has(await check({ runs: [run('web'), run('api', 'completed', 'failure')] }), /FAIL CI: not green.*api=failure/));
});

test('a skipped job counts as passed', async () => {
  const r = await check({ runs: [run('web'), run('e2e', 'completed', 'skipped')] });
  assert.equal(r.ready, true);
  assert.ok(has(r, /ok   CI: 2 check runs success\/skipped.*1 skipped/));
});

test('dirty PR: conflict, not ready; unknown is asked again, then ok or fail', async () => {
  const dirty = await check({ pr: { head: { sha: HEAD }, labels: [], body: '', mergeable_state: 'dirty' } });
  assert.equal(dirty.ready, false);
  assert.ok(has(dirty, /FAIL mergeable_state: dirty/));
  assert.equal((await check({ states: ['unknown', 'unknown', 'clean'] })).ready, true);
  const stuck = await check({ states: [] });
  assert.ok(has(stuck, /FAIL mergeable_state: unknown/));
  assert.equal((await check({ pr: { head: { sha: HEAD }, labels: [], body: '', mergeable_state: 'behind' } })).ready, true);
});

test('owner-decision label needs a «Рішення власника (» line in the body', async () => {
  const labels = [{ name: 'owner-decision' }];
  const without = await check({ pr: { head: { sha: HEAD }, labels, body: 'text', mergeable_state: 'clean' } });
  assert.ok(has(without, /FAIL owner-decision/));
  const body = 'a\nРішення власника (2026-11-27): схвалено\nb';
  assert.equal((await check({ pr: { head: { sha: HEAD }, labels, body, mergeable_state: 'clean' } })).ready, true);
});

test('sync check: main changed a PR file, a contract file, module-rules or a touched module migration', () => {
  const prFiles = ['apps/api/src/modules/budgets/a.ts', 'docs/x.md'];
  const t = (mainFiles) => syncNeeded({ count: mainFiles.length, mainFiles, prFiles });
  assert.match(t(['docs/x.md']).text, /docs\/x.md \(PR file\)/);
  assert.match(t(['packages/api-contract/src/foo.ts']).text, /\(api-contract\)/);
  assert.match(t(['apps/api/module-rules.json']).text, /\(module-rules\)/);
  assert.match(t(['apps/api/src/modules/budgets/migrations/0002.sql']).text, /\(migration\)/);
  assert.equal(t(['apps/api/src/modules/accounts/migrations/0002.sql']).needed, false); // another module
  assert.equal(t(['apps/web/other.ts']).needed, false);
  assert.equal(t([]).text, 'no sync needed');
});

test('sync check: openapi.json and schema.ts only -> no sync', () => {
  const r = syncNeeded({ count: 2, mainFiles: ['packages/api-contract/openapi.json', 'packages/api-contract/src/schema.ts'], prFiles: ['apps/web/a.ts'] });
  assert.deepEqual(r, { needed: false, text: 'no sync needed' });
});

test('sync check: 300 files or more is a truncated list', () => {
  assert.equal(syncNeeded({ count: 300, mainFiles: [], prFiles: [] }).needed, true);
  assert.equal(syncNeeded({ count: 300, mainFiles: [], prFiles: [] }).text, 'sync: no or truncated file list');
});

test('sync check end to end: main changed a PR file -> FAIL; openapi.json only -> ok', async () => {
  const bad = await check({ mainFiles: ['apps/web/a.ts'] });
  assert.equal(bad.ready, false);
  assert.ok(has(bad, /FAIL sync: apps\/web\/a.ts \(PR file\)/));
  const fine = await check({ mainFiles: ['packages/api-contract/openapi.json'] });
  assert.equal(fine.ready, true);
});

test('comments since the last review are listed for the lead', async () => {
  const comments = [
    { user: { login: 'owner' }, created_at: '2026-11-20T09:00:00Z', body: 'old' },
    { user: { login: 'owner' }, created_at: '2026-11-26T09:00:00Z', body: 'stop, please wait' },
  ];
  const r = await check({ reviews: [review(1, HEAD, 'Verdict: Ready', '2026-11-25T10:00:00Z')], comments });
  assert.ok(has(r, /READ 1 comment\(s\) since the last review/));
  assert.ok(has(r, /owner\t2026-11-26T09:00:00Z\tstop, please wait/));
  assert.ok(!has(r, /\told/));
  assert.ok(has(await check(), /READ no comments/));
});

test('--wait polls every 60 s until CI of all PRs is finished (none yet counts as not finished)', async () => {
  let polls = 0;
  const { gh } = world({ runs: () => (++polls <= 2 ? [] : [run('web')]) });
  const sleeps = [];
  await waitCi([7], { gh, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(sleeps, [60000, 60000]);
});

test('main: prints one line per condition, exit code 0/1, usage 2', async () => {
  const lines = [];
  const ok = world();
  assert.equal(await main(['7'], { gh: ok.gh, sleep: async () => {}, out: (s) => lines.push(s) }), 0);
  assert.equal(lines.at(-1), 'READY');
  const bad = world({ runs: [] });
  const lines2 = [];
  assert.equal(await main(['7', '8', '--wait'], { gh: bad.gh, sleep: async () => { bad.w.runs = [run('web')]; }, out: (s) => lines2.push(s), err: () => {} }), 0);
  assert.ok(lines2.includes('== PR #8'));
  assert.equal(await main([], { err: () => {} }), 2);
  assert.equal(await main(['x'], { err: () => {} }), 2);
});
