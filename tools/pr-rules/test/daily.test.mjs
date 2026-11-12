import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { evaluate, needsAlert, render, verdictOf } from '../lib/daily.mjs';

// Recorded with `node tools/pr-rules/index.mjs daily --since 2026-11-06T23:00:00Z --until 2026-11-07T12:00:00Z
// --save-input …` against this repository (PRs #82–#86), then reduced: logins replaced, review bodies cut to
// their heading and verdict lines, comments to their first line, patches dropped.
const recorded = JSON.parse(fs.readFileSync(new URL('./fixtures/main-2026-11-07.json', import.meta.url), 'utf8'));

const JOBS = ['traceability', 'requirements', 'web', 'secrets', 'local-env', 'api', 'infra'];
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const green = (merged = '2026-11-12T10:00:00Z') =>
  JOBS.map((name, i) => ({ id: 100 + i, name, app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:50:00Z' }));
const review = (id, body, commit = HEAD, at = '2026-11-12T09:55:00Z') => ({ id, body, commit_id: commit, submitted_at: at, user: 'repo-owner', state: 'COMMENTED' });

/** A merged PR that follows every rule; tests break one rule at a time. */
const pr = (over = {}) => ({
  number: 90,
  title: 'CICD-01: x',
  merged_at: '2026-11-12T10:00:00Z',
  base_ref: 'main',
  head_sha: HEAD,
  head_date: '2026-11-12T09:40:00Z',
  merge_commit_sha: 'c'.repeat(40),
  labels: [],
  files: [{ filename: 'apps/web/src/App.tsx', status: 'modified' }],
  reviews: [review(1, '## Review\nVerdict: Ready')],
  comments: [],
  checkRuns: green(),
  requiredJobs: JOBS,
  ...over,
});
const input = (over = {}) => ({
  now: '2026-11-12T12:00:00Z',
  window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z' },
  owner: 'repo-owner',
  main: { name: 'main', head: 'c'.repeat(40) },
  activities: [{ timestamp: '2026-11-12T10:00:00Z', activity_type: 'pr_merge', before: OLD, after: 'c'.repeat(40), actor: 'repo-owner' }],
  commits: [{ sha: 'c'.repeat(40), date: '2026-11-12T10:00:00Z', title: 'CICD-01: x (#90)', pulls: [{ number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: 'c'.repeat(40), base_ref: 'main' }] }],
  pulls: [pr()],
  branches: [],
  ...over,
});
const findings = (i) => evaluate(i).findings;
const only = (i) => {
  const f = findings(i);
  assert.equal(f.length, 1, JSON.stringify(f, null, 1));
  return f[0];
};

test('a day that follows every rule has no findings and raises no alert', () => {
  const result = evaluate(input());
  assert.deepEqual(result.findings, []);
  assert.equal(needsAlert(result), false);
  assert.match(render(result), /Порушень не знайдено/);
});

test('CICD-01 criterion 1: a commit on main without a merged PR is found', () => {
  const f = only(input({ commits: [{ sha: 'd'.repeat(40), date: '2026-11-12T08:00:00Z', title: 'hotfix', pulls: [] }] , pulls: [] }));
  assert.equal(f.severity, 'violation');
  assert.match(f.subject, /коміт ddddddd/);
  // A PR that lists the commit but was not merged with it does not count.
  const notMerged = [{ number: 5, merged_at: null, merge_commit_sha: 'd'.repeat(40), base_ref: 'main' }];
  assert.equal(only(input({ commits: [{ sha: 'd'.repeat(40), date: 'x', title: 'y', pulls: notMerged }], pulls: [] })).severity, 'violation');
});

test('CICD-01 FR 3: a force-push or a direct push to main is found', () => {
  const push = (activity_type) => ({ timestamp: '2026-11-12T11:00:00Z', activity_type, before: OLD, after: HEAD, actor: 'someone' });
  assert.match(only(input({ activities: [push('force_push')] })).message, /force-push у main/);
  assert.match(only(input({ activities: [push('push')] })).message, /прямий push у main/);
  assert.match(only(input({ activities: [push('branch_deletion')] })).message, /branch_deletion/);
});

test('CICD-01 FR 3: an unreadable activity log is itself an alert (the check fails closed)', () => {
  assert.match(only(input({ activityError: 'HTTP 403' })).message, /не вдалося прочитати журнал/);
});

test('CICD-01 criterion 2: a PR merged without green CI on its last commit is found', () => {
  const failed = green().map((r) => (r.name === 'api' ? { ...r, conclusion: 'failure' } : r));
  assert.match(only(input({ pulls: [pr({ checkRuns: failed })] })).message, /api: failure/);
  const missing = green().filter((r) => r.name !== 'secrets');
  assert.match(only(input({ pulls: [pr({ checkRuns: missing })] })).message, /secrets: не запускалась/);
  const late = green().map((r) => (r.name === 'web' ? { ...r, completed_at: '2026-11-12T10:05:00Z' } : r));
  assert.match(only(input({ pulls: [pr({ checkRuns: late })] })).message, /web: завершилась після злиття/);
  assert.match(only(input({ pulls: [pr({ requiredJobs: [] })] })).message, /обов’язкові задачі CI/);
});

test('CICD-01 FR 3: a re-run counts — the latest check run of a job decides', () => {
  const rerun = [...green().map((r) => (r.name === 'traceability' ? { ...r, conclusion: 'failure' } : r)), { id: 999, name: 'traceability', app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:58:00Z' }];
  assert.deepEqual(findings(input({ pulls: [pr({ checkRuns: rerun })] })), []);
});

test('CICD-01 criterion 2 / FR 5: a PR merged without «Verdict: Ready» is found', () => {
  assert.match(only(input({ pulls: [pr({ reviews: [] })] })).message, /без рецензії з «Verdict: Ready»/);
  const notReady = [review(1, 'Verdict: Ready', HEAD, '2026-11-12T09:00:00Z'), review(2, '## Verdict: Not ready')];
  assert.match(only(input({ pulls: [pr({ reviews: notReady })] })).message, /останній вердикт був «Not ready»/);
  // A review given after the merge does not count.
  assert.equal(only(input({ pulls: [pr({ reviews: [review(1, 'Verdict: Ready', HEAD, '2026-11-12T10:30:00Z')] })] })).severity, 'violation');
});

test('CICD-01 FR 3: «Ready» on an earlier commit is reported to check (commits after the review)', () => {
  const f = only(input({ pulls: [pr({ reviews: [review(1, 'Verdict: Ready', OLD)] })] }));
  assert.equal(f.severity, 'stale');
  assert.match(f.message, /дано на bbbbbbb, а злито aaaaaaa/);
});

test('CICD-01 FR 4: a sensitive PR (by paths or label) needs «Security verdict: Ready»', () => {
  const files = [{ filename: '.github/workflows/pr-checks.yml', status: 'modified', content: 'on: pull_request\n' }];
  assert.match(only(input({ pulls: [pr({ files })] })).message, /«Security verdict: Ready»/);
  assert.equal(only(input({ pulls: [pr({ labels: ['sensitive'] })] })).rule, 'FR 4');
  const both = [review(1, 'Verdict: Ready'), review(2, '## Security review\n\nSecurity verdict: Ready')];
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews: both })] })), []);
  const changes = [...both, review(3, 'Security verdict: Changes requested', HEAD, '2026-11-12T09:58:00Z')];
  assert.match(only(input({ pulls: [pr({ files, reviews: changes })] })).message, /«Changes requested»/);
});

test('verdict lines: the forms reviews in this repository use', () => {
  assert.equal(verdictOf('## Verdict: Ready', 'review'), 'Ready');
  assert.equal(verdictOf('**Verdict: «Ready».** Nothing is blocking.', 'review'), 'Ready');
  assert.equal(verdictOf('## **Verdict: «Changes requested».**', 'review'), 'Changes requested');
  assert.equal(verdictOf('Verdict: Not ready', 'review'), 'Not ready');
  assert.equal(verdictOf('Security verdict: Ready', 'review'), null, 'a security verdict is not a review verdict');
  assert.equal(verdictOf('Security verdict: Ready', 'security'), 'Ready');
  assert.equal(verdictOf('The security re-review gave «Security verdict: Ready».', 'security'), null, 'a quote inside a sentence');
  assert.equal(verdictOf('Verdict: Changes requested\n…\nVerdict: Ready', 'review'), 'Ready', 'the last line wins');
});

test('CICD-01 criterion 3: a cloud/production PR needs the owner approval comment', () => {
  const files = [{ filename: '.github/workflows/deploy.yml', status: 'added', content: 'permissions:\n  id-token: write\n' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')];
  const f = only(input({ pulls: [pr({ files, reviews })] }));
  assert.match(f.message, /без коментаря власника «Схвалюю»/);
  const approve = (user, body, created_at = '2026-11-12T09:45:00Z') => ({ id: 7, user, body, created_at });
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews, comments: [approve('repo-owner', 'Схвалюю')] })] })), []);
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews, comments: [approve('repo-owner', 'Approved.')] })] })), []);
  // Another account, a quote, a sentence, or after the merge: not an approval.
  for (const c of [
    approve('someone-else', 'Схвалюю'),
    approve('repo-owner', '> Схвалюю'),
    approve('repo-owner', 'Owner approval is still needed'),
    approve('repo-owner', 'Схвалюю', '2026-11-12T10:30:00Z'),
  ]) {
    assert.equal(only(input({ pulls: [pr({ files, reviews, comments: [c] })] })).severity, 'violation', c.body);
  }
  // Written before the last commit: to check.
  assert.equal(only(input({ pulls: [pr({ files, reviews, comments: [approve('repo-owner', 'Схвалюю', '2026-11-12T09:00:00Z')] })] })).severity, 'stale');
});

test('CICD-01 FR 3: infrastructure code without apply needs no approval comment', () => {
  const files = [{ filename: 'infra/start/storage.tf', status: 'modified', patch: '+resource "oci_objectstorage_bucket" "x" {' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')];
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews })] })), []);
});

test('CICD-01 FR 3: an owner «stop» on a merged PR is reported to check', () => {
  const comments = [{ id: 1, user: 'repo-owner', body: 'stop', created_at: '2026-11-12T09:30:00Z' }];
  assert.match(only(input({ pulls: [pr({ comments })] })).message, /коментар «stop»/);
});

test('CICD-01 FR 1: branches older than 3 days are listed for information only', () => {
  const branches = [
    { name: 'BUD-03-old', firstCommitDate: '2026-11-08T11:00:00Z', pr: { number: 3, state: 'closed', merged: true } },
    { name: 'BUD-04-new', firstCommitDate: '2026-11-10T12:00:00Z', pr: null },
    { name: 'main', firstCommitDate: '2026-01-01T00:00:00Z' },
  ];
  const result = evaluate(input({ branches }));
  assert.deepEqual(result.findings.map((f) => [f.severity, f.subject, f.message]), [['info', 'гілка BUD-03-old', '4 дн., PR #3 злито']]);
  assert.equal(needsAlert(result), false, 'branch age alone opens no issue');
});

test('recorded history (#82–#86): what the daily check reports', () => {
  const result = evaluate(recorded);
  assert.equal(result.summary.commits, 5);
  assert.deepEqual(result.summary.pulls, [86, 85, 84, 83, 82]);
  const got = result.findings.map((f) => `${f.severity} ${f.subject} ${f.rule}`).sort();
  assert.deepEqual(got, [
    'stale PR #83 FR 3, FR 5', // Ready on 6ce7f5a, merged edf2b77
    'stale PR #83 FR 4', // Security Ready on 6ce7f5a, merged edf2b77
    'stale PR #84 FR 3, FR 5', // Ready on 5a95cf0, merged 4a9f400
    'stale PR #85 FR 4', // Security Ready on 7d56a8a, merged ad0f51f
    'stale PR #86 FR 3, FR 5', // Ready on 591cfef, merged e0ca73a
    'violation PR #86 FR 4', // last security verdict «Changes requested» on 591cfef
  ]);
  // Every commit on main came from a merged PR, CI was green on every merged head, no force-push.
  assert.ok(!result.findings.some((f) => f.subject === 'main' || f.subject.startsWith('коміт') || /CI не зелений/.test(f.message)));
  assert.equal(needsAlert(result), true);
  const md = render(result, { runUrl: 'https://example.invalid/run/1' });
  assert.match(md, /### Порушення\n\n- \*\*PR #86\*\*/);
  assert.match(md, /Запуск перевірки: https:\/\/example.invalid\/run\/1/);
});
