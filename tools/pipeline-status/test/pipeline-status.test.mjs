// Створено: 2026-11-28 · Оновлено: 2026-11-28
// pipeline-status (token review, proposal 3): canned `gh api` answers, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentsOf, ciSummary, formatLine, main, openPrs, status, verdictOnHead } from '../lib.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const run = (name, conclusion = 'success', started = '2026-11-28T10:00:00Z', status = 'completed') => ({ name, status, conclusion, started_at: started });
const review = (id, commit, body, user = 'owner') => ({ id, commit_id: commit, body, submitted_at: `2026-11-28T1${id}:00:00Z`, state: 'COMMENTED', user: { login: user } });

/** Fake `gh api` over a world of PRs: { [n]: { pr, runs, reviews, behind } } plus the open list. */
function world(prs) {
  const calls = [];
  const gh = async (args) => {
    const path = args[0];
    calls.push(path);
    if (path.startsWith('repos/{owner}/{repo}/pulls?state=open')) return JSON.stringify([Object.keys(prs).map((number) => ({ number: Number(number) }))]);
    const n = /\/pulls\/(\d+)/.exec(path)?.[1] ?? /\/commits\/(\w+)\//.exec(path)?.[1] ?? /\.\.\.(\w+)/.exec(path)?.[1];
    const w = prs[n] ?? Object.values(prs).find((x) => x.pr.head.sha === n);
    if (!w) throw new Error(`HTTP 404 ${path}`);
    if (/\/pulls\/\d+$/.test(path)) return JSON.stringify({ base: { repo: { owner: { login: 'owner' } } }, labels: [], mergeable_state: 'clean', ...w.pr });
    if (path.includes('/reviews')) return JSON.stringify([w.reviews ?? []]);
    if (path.includes('/check-runs')) return JSON.stringify([{ check_runs: w.runs ?? [] }]);
    if (path.includes('/compare/main...')) return JSON.stringify({ behind_by: w.behind ?? 0, files: [] });
    throw new Error(`unexpected ${path}`);
  };
  gh.calls = calls;
  return gh;
}

test('ciSummary: green, running with names, red with names, none', () => {
  assert.deepEqual(ciSummary([run('web'), run('api', 'skipped')]), { state: 'green', text: 'green 2' });
  assert.equal(ciSummary([run('web'), run('api', null, undefined, 'in_progress')]).text, 'running 1 of 2: api');
  assert.deepEqual(ciSummary([run('web'), run('api', 'failure'), run('e2e', 'timed_out')]), { state: 'red', text: 'red: api=failure, e2e=timed_out' });
  assert.deepEqual(ciSummary([]), { state: 'none', text: 'none yet' });
});

test('ciSummary: a cancelled duplicate is superseded when the same name succeeded; alone it is red', () => {
  const older = '2026-11-28T09:00:00Z';
  const newer = '2026-11-28T10:00:00Z';
  // concurrency cancelled the older run, the newer one succeeded
  assert.equal(ciSummary([run('api', 'cancelled', older), run('api', 'success', newer), run('web')]).text, 'green 2 (1 superseded)');
  // the cancelled run is the later one, but the same name succeeded before
  assert.equal(ciSummary([run('api', 'success', older), run('api', 'cancelled', newer)]).text, 'green 1 (1 superseded)');
  assert.equal(ciSummary([run('api', 'cancelled', older)]).text, 'red: api=cancelled');
  // a re-run that failed after a success is red; a success after a failure is green
  assert.equal(ciSummary([run('api', 'success', older), run('api', 'failure', newer)]).text, 'red: api=failure');
  assert.equal(ciSummary([run('api', 'failure', older), run('api', 'success', newer)]).text, 'green 1');
  // a re-run in progress after a cancelled one is running
  assert.equal(ciSummary([run('api', 'cancelled', older), run('api', null, newer, 'queued')]).state, 'running');
});

test('verdictOnHead: the latest verdict naming the head; older head, other account and missing kind give none', () => {
  const reviews = [
    review(1, OLD, 'Verdict: Ready'),
    review(2, HEAD, 'Verdict: Changes requested'),
    review(3, HEAD, 'Verdict: Ready'),
    review(4, HEAD, 'Security verdict: Changes requested'),
    review(5, HEAD, 'Verdict: Changes requested', 'someone-else'),
  ];
  assert.equal(verdictOnHead(reviews, 'review', HEAD, 'owner'), 'Ready');
  assert.equal(verdictOnHead(reviews, 'security', HEAD, 'owner'), 'Changes requested');
  assert.equal(verdictOnHead([review(1, OLD, 'Verdict: Ready')], 'review', HEAD, 'owner'), 'none');
  assert.equal(verdictOnHead(reviews, 'review', HEAD, undefined), 'none');
});

test('status and formatLine: one line with head, CI, verdicts, behind_by, mergeable_state, labels and agents', async () => {
  const gh = world({
    7: {
      pr: { head: { sha: HEAD }, labels: [{ name: 'sensitive:pipeline' }, { name: 'owner-decision' }], mergeable_state: 'behind' },
      runs: [run('web'), run('api', 'failure')],
      reviews: [review(1, HEAD, 'Verdict: Ready'), review(2, OLD, 'Security verdict: Ready')],
      behind: 3,
    },
  });
  const ledger = [
    { pr: '#7', role: 'a', model: 'S', agentId: 'aaa' },
    { pr: '#7', role: 'r', model: 'O', agentId: 'rrr' },
    { pr: '#8', role: 'a', model: 'S', agentId: 'zzz' },
  ];
  const line = formatLine(await status(7, { gh, ledger }));
  assert.equal(line, `#7 → ${HEAD} | CI red: api=failure | Verdict: Ready | Security verdict: none | behind 3 | behind | sensitive:pipeline,owner-decision | agents a:S aaa, r:O rrr`);
  assert.equal(agentsOf(ledger, 9), '—');
});

test('a PR without the sensitive label has Security verdict n/a; a draft is marked; no ledger → no agents', async () => {
  const gh = world({ 8: { pr: { head: { sha: HEAD }, draft: true, labels: [] }, runs: [run('web')], reviews: [] } });
  assert.equal(formatLine(await status(8, { gh })), `#8 → ${HEAD} (draft) | CI green 1 | Verdict: none | Security verdict: n/a | behind 0 | clean | no labels`);
});

test('main without numbers lists every open PR in order; with numbers only those; one failing PR gives exit 1', async () => {
  const gh = world({
    12: { pr: { head: { sha: 'c'.repeat(40) } }, runs: [run('web')] },
    5: { pr: { head: { sha: HEAD } }, runs: [run('web')] },
  });
  assert.deepEqual(await openPrs(gh), [5, 12]);
  const out = [];
  assert.equal(await main([], { gh, out: (l) => out.push(l), err: () => {} }), 0);
  assert.equal(out.length, 2);
  assert.match(out[0], /^#5 → a{40} \|/);
  assert.match(out[1], /^#12 → c{40} \|/);
  const some = [];
  assert.equal(await main(['12'], { gh, out: (l) => some.push(l), err: () => {} }), 0);
  assert.equal(some.length, 1);
  const bad = [];
  assert.equal(await main(['5', '99'], { gh, out: (l) => bad.push(l), err: () => {} }), 1);
  assert.match(bad[1], /^#99 → ERROR /);
  assert.match(bad[0], /^#5 /);
});

test('main: --ledger adds the agents; a bad ledger or a bad argument is a usage error (exit 2) and nothing is called', async () => {
  const gh = world({ 5: { pr: { head: { sha: HEAD } }, runs: [] } });
  const out = [];
  const files = { 'l.tsv': '#5\ta\tS\taaa\n' };
  const readFile = (p) => files[p];
  assert.equal(await main(['--ledger', 'l.tsv', '5'], { gh, readFile, out: (l) => out.push(l), err: () => {} }), 0);
  assert.match(out[0], /CI none yet \|.* \| agents a:S aaa$/);
  const errs = [];
  files['bad.tsv'] = '#5\tx\tS\taaa\n';
  const before = gh.calls.length;
  assert.equal(await main(['--ledger', 'bad.tsv', '5'], { gh, readFile, out: () => {}, err: (l) => errs.push(l) }), 2);
  assert.match(errs[0], /role «x»/);
  assert.equal(await main(['--nope'], { gh, readFile, out: () => {}, err: (l) => errs.push(l) }), 2);
  assert.equal(await main(['--ledger'], { gh, readFile, out: () => {}, err: (l) => errs.push(l) }), 2);
  assert.equal(gh.calls.length, before);
});

test('main with no open PRs says so', async () => {
  const out = [];
  assert.equal(await main([], { gh: world({}), out: (l) => out.push(l), err: () => {} }), 0);
  assert.deepEqual(out, ['no open PRs']);
});
