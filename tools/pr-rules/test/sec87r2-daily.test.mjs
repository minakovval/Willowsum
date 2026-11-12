// Security re-review of PR #87 (CICD-01), round 2: the daily check after 92b0158. Tests named SEC87R2-B… are
// defects of that commit (fixed in this PR); the rest pin properties no earlier test killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { READY_ON_MERGED_COMMIT_FROM, evaluate, render, verdictOf } from '../lib/daily.mjs';

const JOBS = ['traceability', 'requirements', 'web', 'secrets', 'local-env', 'api', 'infra'];
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);
const green = (completed = '2026-11-12T09:50:00Z') =>
  JOBS.map((name, i) => ({ id: 100 + i, name, app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: completed }));
const review = (id, body, { commit = HEAD, at = '2026-11-12T09:55:00Z', user = 'repo-owner', state = 'COMMENTED' } = {}) => ({
  id, body, commit_id: commit, submitted_at: at, user, state,
});
const comment = (id, body, { at = '2026-11-12T09:58:00Z', user = 'repo-owner' } = {}) => ({ id, body, created_at: at, user });
const pr = (over = {}) => ({
  number: 90,
  merged_at: '2026-11-12T10:00:00Z',
  base_ref: 'main',
  head_sha: HEAD,
  head_date: '2026-11-12T09:40:00Z',
  merge_commit_sha: MERGE,
  labels: [],
  files: [{ filename: 'apps/web/src/App.tsx', status: 'modified' }],
  reviews: [review(1, 'Verdict: Ready')],
  comments: [],
  checkRuns: green(),
  requiredJobs: JOBS,
  ...over,
});
const input = (over = {}) => ({
  now: '2026-11-12T12:00:00Z',
  window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z' },
  owner: 'repo-owner',
  main: { name: 'main', head: MERGE },
  activities: [],
  commits: [{ sha: MERGE, date: '2026-11-12T10:00:00Z', title: 'x (#90)', pulls: [{ number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: MERGE, base_ref: 'main' }] }],
  pulls: [pr()],
  branches: [],
  ...over,
});
const findings = (i) => evaluate(i).findings;
const workflow = (content) => [{ filename: '.github/workflows/ops.yml', status: 'modified', patch: '+x', content }];
const both = (security) => [review(1, 'Verdict: Ready'), ...security];

// ---- B1 re-probe: a «Changes requested» a reader sees must count; a «Ready» a reader sees as code must not.

test('SEC87R2-B1a: an unclosed `<!--` (e.g. in a code span) does not hide the «Changes requested» after it', () => {
  const body = 'The template keeps its hints in `<!--` comments.\n\nSecurity verdict: Changes requested';
  assert.equal(verdictOf(body, 'security'), 'Changes requested');
  // Fail-open shape: Ready on the merged commit, then a later «Changes requested» on the same commit.
  const files = [{ filename: 'infra/start/x.tf', status: 'modified', patch: '+x' }];
  const reviews = both([review(2, 'Security verdict: Ready', { at: '2026-11-12T09:50:00Z' }), review(3, body)]);
  const f = findings(input({ pulls: [pr({ files, reviews })] }));
  assert.ok(f.some((x) => x.rule === 'FR 4' && /Changes requested/.test(x.message)), JSON.stringify(f));
});

test('SEC87R2-B1b: an info-string fence line inside a fence does not close it (```js is code)', () => {
  assert.equal(verdictOf('Security verdict: Changes requested\n```\n```js\nSecurity verdict: Ready\n```\n', 'security'), 'Changes requested');
});

test('SEC87R2-B1c: a verdict inside an HTML <pre> block is code, not the reviewer’s verdict', () => {
  assert.equal(verdictOf('Security verdict: Changes requested\n<pre>\nSecurity verdict: Ready\n</pre>\n', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Changes requested\n<PRE class="x">\nSecurity verdict: Ready\n</PRE>\n', 'security'), 'Changes requested');
});

test('SEC87R2: comments still hide what GitHub hides (block, inline, multi-line in one paragraph); prose after a closed one counts', () => {
  assert.equal(verdictOf('Security verdict: Changes requested\n<!--\nSecurity verdict: Ready\n-->\n', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Changes requested\nnote <!-- Security verdict: Ready -->\n', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Changes requested\nnote <!--\nSecurity verdict: Ready\n-->\n', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Ready\n<!-- x -->\nSecurity verdict: Changes requested\n', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Ready\n~~~\nx\n~~~\nSecurity verdict: Changes requested\n', 'security'), 'Changes requested');
});

// ---- Owner-only counting.

test('SEC87R2: an approval or «stop» from another account, or written after the merge, does not count', () => {
  const comments = [comment(1, 'Схвалюю', { user: 'someone-else' }), comment(2, 'Approved', { at: '2026-11-12T10:05:00Z' })];
  const f = findings(input({ pulls: [pr({ files: workflow('jobs:\n  a:\n    permissions:\n      id-token: write\n'), comments })] }));
  assert.ok(f.some((x) => x.severity === 'violation' && /без коментаря власника/.test(x.message)), JSON.stringify(f));
  assert.deepEqual(findings(input({ pulls: [pr({ comments: [comment(3, 'stop', { user: 'someone-else' })] })] })), []);
  assert.deepEqual(findings(input({ pulls: [pr({ comments: [comment(4, 'stop', { at: '2026-11-12T10:30:00Z' })] })] })), []);
});

test('SEC87R2: the body approval line counts only as the author’s own line (not quoted, not in code)', () => {
  const files = workflow('jobs:\n  a:\n    permissions:\n      id-token: write\n');
  const need = (body) => findings(input({ pulls: [pr({ files, body })] })).some((x) => /без коментаря власника/.test(x.message));
  assert.equal(need('Рішення власника (2026-11-12): схвалено застосування'), false);
  assert.equal(need('> Рішення власника (2026-11-12): схвалено застосування'), true);
  assert.equal(need('```\nРішення власника (2026-11-12): схвалено\n```'), true);
  assert.equal(need('Рішення власника (2026-11-12): схваленого немає'), true, 'a longer word is not «схвалено»');
});

test('SEC87R2: a pending or dismissed «Changes requested» does not count, but a later submitted one does', () => {
  const files = [{ filename: 'infra/start/x.tf', status: 'modified', patch: '+x' }];
  const ok = both([review(2, 'Security verdict: Ready', { at: '2026-11-12T09:50:00Z' }), review(3, 'Security verdict: Changes requested', { state: 'PENDING' })]);
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews: ok })] })), []);
  const bad = both([review(2, 'Security verdict: Ready', { at: '2026-11-12T09:50:00Z' }), review(3, 'Security verdict: Changes requested')]);
  assert.equal(findings(input({ pulls: [pr({ files, reviews: bad })] })).length, 1);
});

// ---- The 2026-11-12 cutoff.

test('SEC87R2: the cutoff is exactly 2026-11-12T00:00Z — Ready on an older commit is a violation from then, «to check» before', () => {
  assert.equal(READY_ON_MERGED_COMMIT_FROM, '2026-11-12T00:00:00Z');
  const at = (merged) => {
    const runs = green(new Date(Date.parse(merged) - 60_000).toISOString());
    const reviews = [review(1, 'Verdict: Ready', { commit: OLD, at: new Date(Date.parse(merged) - 30_000).toISOString() })];
    const [f] = findings(input({ pulls: [pr({ merged_at: merged, head_date: '2026-11-10T00:00:00Z', checkRuns: runs, reviews })] }));
    return f.severity;
  };
  assert.equal(at('2026-11-12T00:00:00Z'), 'violation');
  assert.equal(at('2026-11-11T23:59:59Z'), 'stale');
});

// ---- Window and sanitization in the report.

test('SEC87R2-B5: a window that could not start at the last checked run is itself reported (the gap is not silent)', () => {
  const i = input({ window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z', note: 'журнал запусків не прочитано (HTTP 502): 25 год', gap: true } });
  const f = findings(i);
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.equal(f[0].severity, 'stale');
  assert.match(f[0].message, /HTTP 502/);
});

test('SEC87R2-N1: report lines carry no legacy `##[` workflow command from a commit title or file name', () => {
  const i = input({ commits: [{ sha: 'd'.repeat(40), date: '2026-11-12T10:00:00Z', title: 'x ##[add-mask]Порушення', pulls: [] }] });
  const out = render(evaluate(i));
  assert.ok(!out.includes('##['), out);
});

