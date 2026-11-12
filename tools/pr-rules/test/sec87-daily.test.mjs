// Security review of PR #87 (CICD-01): evasion and false negatives of the daily check. Tests named
// SEC87-B…/N… pin the defects the review found; the fix is in this PR.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, verdictOf } from '../lib/daily.mjs';

const JOBS = ['traceability', 'requirements', 'web', 'secrets', 'local-env', 'api', 'infra'];
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const MERGE = 'c'.repeat(40);
const green = () =>
  JOBS.map((name, i) => ({ id: 100 + i, name, app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:50:00Z' }));
const review = (id, body, { commit = HEAD, at = '2026-11-12T09:55:00Z', user = 'repo-owner' } = {}) => ({
  id, body, commit_id: commit, submitted_at: at, user, state: 'COMMENTED',
});
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
const mergedPull = { number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: MERGE, base_ref: 'main' };
const input = (over = {}) => ({
  now: '2026-11-12T12:00:00Z',
  window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z' },
  owner: 'repo-owner',
  activities: [{ timestamp: '2026-11-12T10:00:00Z', activity_type: 'pr_merge', before: OLD, after: MERGE, actor: 'repo-owner' }],
  commits: [{ sha: MERGE, date: '2026-11-12T10:00:00Z', title: 'x (#90)', pulls: [mergedPull] }],
  pulls: [pr()],
  branches: [],
  ...over,
});
const findings = (i) => evaluate(i).findings;
const security = (files) => ({ files, reviews: [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')] });

// ---- main: direct pushes ---------------------------------------------------------------------------------

test('SEC87: a PR-branch commit fast-forwarded to main (listed by a merged PR, but not its merge commit) is a violation', () => {
  const branchCommit = 'e'.repeat(40);
  const f = findings(input({ commits: [{ sha: branchCommit, date: 'x', title: 'wip', pulls: [mergedPull] }], pulls: [] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'violation');
});

test('SEC87: a merge commit of a PR into another branch, pushed to main, is a violation', () => {
  const intoRelease = { ...mergedPull, merge_commit_sha: 'f'.repeat(40), base_ref: 'release' };
  const f = findings(input({ commits: [{ sha: 'f'.repeat(40), date: 'x', title: 'Merge', pulls: [intoRelease] }], pulls: [] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'violation');
});

test('SEC87: a hand-made merge commit titled like a PR merge is a violation, and so is its push', () => {
  const fake = 'd'.repeat(40);
  const f = findings(
    input({
      activities: [{ timestamp: '2026-11-12T11:00:00Z', activity_type: 'push', before: MERGE, after: fake, actor: 'x' }],
      commits: [{ sha: fake, date: '2026-11-01T00:00:00Z', title: 'Merge pull request #90 from x/y', pulls: [] }],
      pulls: [],
    }),
  );
  assert.deepEqual(f.map((x) => x.severity), ['violation', 'violation']);
});

// ---- CI ----------------------------------------------------------------------------------------------------

test('SEC87: a green check run with a required job name from another app does not hide a failed job', () => {
  const runs = [...green().map((r) => (r.name === 'api' ? { ...r, conclusion: 'failure' } : r)),
    { id: 999, name: 'api', app: 'some-app', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:59:00Z' }];
  const f = findings(input({ pulls: [pr({ checkRuns: runs })] }));
  assert.equal(f.length, 1);
  assert.match(f[0].message, /api: failure/);
});

// ---- verdicts ----------------------------------------------------------------------------------------------

test('SEC87: a verdict in a quote, in a code span or inside a sentence does not count', () => {
  for (const body of ['> Verdict: Ready', '>Verdict: Ready', '`Verdict: Ready`', 'Please write «Verdict: Ready» at the end', '- Verdict: Ready']) {
    assert.equal(verdictOf(body, 'review'), null, body);
  }
  assert.equal(verdictOf('> Security verdict: Ready', 'security'), null);
  assert.equal(verdictOf('Security verdict: Changes requested\n\n> Security verdict: Ready', 'security'), 'Changes requested');
});

test('SEC87: reviews are ordered by time, not by API order (latest verdict decides)', () => {
  const reviews = [review(2, 'Verdict: Not ready', { at: '2026-11-12T09:58:00Z' }), review(1, 'Verdict: Ready', { at: '2026-11-12T09:00:00Z' })];
  const f = findings(input({ pulls: [pr({ reviews })] }));
  assert.equal(f.length, 1);
  assert.match(f[0].message, /Not ready/);
});

test('SEC87: a pending (unsubmitted) review does not count', () => {
  const pending = { ...review(1, 'Verdict: Ready'), submitted_at: null, state: 'PENDING' };
  assert.equal(findings(input({ pulls: [pr({ reviews: [pending] })] }))[0].severity, 'violation');
});

test('SEC87: renamed out of a sensitive path still needs the security verdict in the daily check', () => {
  const files = [{ filename: 'apps/web/src/x.ts', previous_filename: 'apps/api/src/modules/ledger/x.ts', status: 'renamed' }];
  const f = findings(input({ pulls: [pr({ files })] }));
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'FR 4');
});

test('SEC87-B1: a verdict inside a fenced or indented code block or an HTML comment does not count', () => {
  const fenced = 'Security verdict: Changes requested\n\nAfter the fix, the re-review ends with:\n```\nSecurity verdict: Ready\n```';
  assert.equal(verdictOf(fenced, 'security'), 'Changes requested');
  assert.equal(verdictOf('~~~\nVerdict: Ready\n~~~', 'review'), null);
  assert.equal(verdictOf('Example:\n\n    Verdict: Ready', 'review'), null);
  assert.equal(verdictOf('Verdict: Not ready\n<!--\nVerdict: Ready\n-->', 'review'), 'Not ready');
  // And end to end: the merged PR is reported.
  const files = [{ filename: 'infra/start/x.tf', status: 'modified', patch: '+x' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, fenced)];
  assert.equal(findings(input({ pulls: [pr({ files, reviews })] }))[0]?.rule, 'FR 4');
});

test('SEC87-N6: only the owner account’s reviews count (as for the approval comment)', () => {
  const files = [{ filename: 'infra/start/x.tf', status: 'modified', patch: '+x' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Changes requested', { at: '2026-11-12T09:50:00Z' }),
    review(3, 'Security verdict: Ready', { user: 'some-app[bot]' })];
  assert.match(findings(input({ pulls: [pr({ files, reviews })] }))[0]?.message ?? '', /Changes requested/);
});

// ---- owner approval / stop ---------------------------------------------------------------------------------

test('SEC87: the approval phrase inside a longer line, a quote or a list item is not an approval', () => {
  const files = [{ filename: '.github/workflows/deploy.yml', status: 'added', content: 'on: push\n' }];
  for (const body of ['Approved by the review agent', 'Not approved', '> Approved', '- Схвалюю', '`Схвалюю`', '**Схвалюю**']) {
    const c = { id: 7, user: 'repo-owner', body, created_at: '2026-11-12T09:45:00Z' };
    const f = findings(input({ pulls: [pr({ ...security(files), comments: [c] })] }));
    assert.equal(f.length, 1, body);
    assert.equal(f[0].severity, 'violation', body);
  }
});

test('SEC87-B1: the approval phrase inside a fenced block or HTML comment is not an approval', () => {
  for (const body of ['```\nСхвалюю\n```', '<!--\nApproved\n-->']) {
    const files = [{ filename: '.github/workflows/deploy.yml', status: 'added', content: 'on: push\n' }];
    const c = { id: 7, user: 'repo-owner', body, created_at: '2026-11-12T09:45:00Z' };
    const f = findings(input({ pulls: [pr({ ...security(files), comments: [c] })] }));
    assert.equal(f[0]?.severity, 'violation', body);
  }
});

test('SEC87-B2: a PR whose file list was truncated is treated as sensitive and as acting on the cloud', () => {
  const f = findings(input({ pulls: [pr({ filesTruncated: true })] }));
  assert.ok(f.some((x) => x.rule === 'FR 4'), JSON.stringify(f));
  assert.ok(f.some((x) => x.rule === 'FR 3' && /Схвалюю/.test(x.message)), JSON.stringify(f));
});

test('SEC87-B3: a large infrastructure diff without a patch needs the owner approval in the daily check', () => {
  const files = [{ filename: 'infra/start/secrets.tf', status: 'modified', unreadable: true }]; // fetch sets `unreadable` when GitHub omits the patch
  const f = findings(input({ pulls: [pr(security(files))] }));
  assert.equal(f.length, 1);
  assert.match(f[0].message, /Схвалюю/);
});

