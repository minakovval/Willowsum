import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { bodyApproval, evaluate, needsAlert, prose, recordsOwnerDecision, render, verdictOf } from '../lib/daily.mjs';

// Recorded with `node tools/pr-rules/index.mjs daily --since 2026-11-06T23:00:00Z --until 2026-11-07T12:00:00Z
// --save-input …` against this repository (PRs #82–#86), then reduced: logins replaced, review bodies cut to
// their heading and verdict lines, comments to their first line, patches dropped (except the requirement
// files', which only change their «Перевіряється» line).
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

test('owner 2026-11-12: «Ready» must stand on the merged commit — an older commit is a violation', () => {
  const f = only(input({ pulls: [pr({ reviews: [review(1, 'Verdict: Ready', OLD)] })] }));
  assert.equal(f.severity, 'violation');
  assert.match(f.message, /дано на bbbbbbb, а злито aaaaaaa/);
  const files = [{ filename: 'infra/start/x.tf', status: 'modified', patch: '+x' }];
  const sec = only(input({ pulls: [pr({ files, reviews: [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready', OLD)] })] }));
  assert.equal(sec.severity, 'violation');
  assert.equal(sec.rule, 'FR 4');
  // Merged before the rule (2026-11-12): the old reading, «to check» — the history is not rewritten.
  const early = { merged_at: '2026-11-11T10:00:00Z', head_date: '2026-11-11T09:00:00Z' };
  const old = only(input({ pulls: [pr({ ...early, reviews: [review(1, 'Verdict: Ready', OLD, '2026-11-11T09:30:00Z')], checkRuns: green().map((r) => ({ ...r, completed_at: '2026-11-11T09:10:00Z' })) })] }));
  assert.equal(old.severity, 'stale');
});

test('review #87 item 9: dismissed reviews do not count; only the owner account’s reviews count', () => {
  const dismissed = [review(1, 'Verdict: Ready', HEAD, '2026-11-12T09:00:00Z'), { ...review(2, 'Verdict: Ready'), state: 'DISMISSED' }];
  assert.deepEqual(findings(input({ pulls: [pr({ reviews: dismissed })] })), []);
  assert.match(only(input({ pulls: [pr({ reviews: [{ ...review(2, 'Verdict: Ready'), state: 'DISMISSED' }] })] })).message, /без рецензії/);
  // The latest Ready was dismissed: the earlier «Not ready» stands.
  const back = [review(1, 'Verdict: Not ready', HEAD, '2026-11-12T09:00:00Z'), { ...review(2, 'Verdict: Ready'), state: 'DISMISSED' }];
  assert.match(only(input({ pulls: [pr({ reviews: back })] })).message, /«Not ready»/);
  assert.match(only(input({ pulls: [pr({ reviews: [{ ...review(1, 'Verdict: Ready'), user: 'other' }] })] })).message, /без рецензії/);
});

test('review #87 item 4b/4c: only the merge commit of a PR merged into main counts', () => {
  const merged = { number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: 'c'.repeat(40), base_ref: 'main' };
  const commit = (pulls, sha = 'c'.repeat(40)) => ({ sha, date: '2026-11-12T10:00:00Z', title: 'x', pulls });
  const bad = (pulls, sha) => only(input({ commits: [commit(pulls, sha)], pulls: [] })).subject;
  assert.deepEqual(findings(input({ commits: [commit([merged])], pulls: [] })), []);
  assert.match(bad([merged], 'd'.repeat(40)), /коміт ddddddd/, 'a branch commit of a merged PR (merge_commit_sha differs)');
  assert.match(bad([{ ...merged, base_ref: 'release' }]), /коміт ccccccc/, 'merged into another branch');
  assert.match(bad([{ ...merged, base_ref: undefined }]), /коміт ccccccc/, 'unknown base');
  // The default branch name comes from the input, not a constant.
  assert.deepEqual(findings(input({ main: { name: 'trunk', head: 'c'.repeat(40) }, commits: [commit([{ ...merged, base_ref: 'trunk' }])], pulls: [] })), []);
  assert.match(only(input({ main: { name: 'trunk', head: 'c'.repeat(40) }, commits: [commit([merged])], pulls: [] })).subject, /коміт/);
});

test('review #87 item 4d: only check runs from github-actions count', () => {
  const runs = [...green().filter((r) => r.name !== 'api'), { id: 900, name: 'api', app: 'some-app', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:50:00Z' }];
  assert.match(only(input({ pulls: [pr({ checkRuns: runs })] })).message, /api: не запускалась/);
});

test('review #87 item 5: a re-run after the merge (description edited) is ignored; the last run before the merge decides', () => {
  const after = { id: 999, name: 'traceability', app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T11:00:00Z' };
  assert.deepEqual(findings(input({ pulls: [pr({ checkRuns: [...green(), after] })] })), []);
  assert.deepEqual(findings(input({ pulls: [pr({ checkRuns: [...green(), { ...after, conclusion: 'failure' }] })] })), []);
  const failedBefore = green().map((r) => (r.name === 'traceability' ? { ...r, conclusion: 'failure' } : r));
  assert.match(only(input({ pulls: [pr({ checkRuns: [...failedBefore, after] })] })).message, /traceability: failure/, 'a green run after the merge does not fix it');
});

test('review #87 item 4a: a file renamed out of a sensitive path still needs the security verdict', () => {
  const files = [{ filename: 'apps/web/src/x.ts', previous_filename: 'apps/api/src/modules/ledger/x.ts', status: 'renamed' }];
  assert.equal(only(input({ pulls: [pr({ files })] })).rule, 'FR 4');
});

test('review #87 item 9: a PR that edits the map is judged by the base map too', () => {
  const baseMap = { sensitive: true, categories: ['money'], files: { money: ['apps/web/src/App.tsx'] }, approvalReasons: [] };
  assert.equal(only(input({ pulls: [pr({ baseMap })] })).rule, 'FR 4');
  const both = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')];
  const cloud = { sensitive: false, categories: [], files: {}, approvalReasons: ['x.tf: DNS'] };
  assert.match(only(input({ pulls: [pr({ baseMap: cloud, reviews: both })] })).message, /x\.tf: DNS/);
});

test('review #87 item 3: a rule or requirement change without a recorded owner decision is reported to check', () => {
  const files = [{ filename: 'AGENTS.md', status: 'modified', patch: '+x' }];
  const f = only(input({ pulls: [pr({ files, body: '## Requirement\nx' })] }));
  assert.equal(f.severity, 'stale');
  assert.match(f.message, /AGENTS\.md/);
  assert.deepEqual(findings(input({ pulls: [pr({ files, body: '## Owner decision\n\nApproved in chat on 2026-11-12.' })] })), []);
  assert.deepEqual(findings(input({ pulls: [pr({ files, body: 'Рішення власника 2026-11-12: …' })] })), []);
  assert.equal(only(input({ pulls: [pr({ files, body: '<!-- Рішення власника -->' })] })).severity, 'stale', 'a template comment is no reference');
});

test('owner 2026-11-12: the approval can also be the owner decision from chat recorded in the PR body', () => {
  const files = [{ filename: '.github/workflows/deploy.yml', status: 'added', content: 'permissions:\n  id-token: write\n' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')];
  const body = (line) => `## Owner decision\n\n${line}\n`;
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews, body: body('Рішення власника (2026-11-12): схвалено розгортання в production.') })] })), []);
  assert.deepEqual(findings(input({ pulls: [pr({ files, reviews, body: body('**Рішення власника (2026-11-12):** схвалено.') })] })), []);
  for (const line of ['> Рішення власника (2026-11-12): схвалено', 'Рішення власника: схвалено', 'Рішення власника (2026-11-12): не схвалено', '```\nРішення власника (2026-11-12): схвалено\n```']) {
    assert.equal(only(input({ pulls: [pr({ files, reviews, body: body(line) })] })).severity, 'violation', line);
  }
});

test('review #87 item 4e: a `>`-quoted approval or one inside a list line is not an approval', () => {
  const files = [{ filename: '.github/workflows/deploy.yml', status: 'added', content: 'permissions:\n  id-token: write\n' }];
  const reviews = [review(1, 'Verdict: Ready'), review(2, 'Security verdict: Ready')];
  for (const body of ['>Схвалюю', '  > Approved', '>> Схвалюю']) {
    const comments = [{ id: 7, user: 'repo-owner', body, created_at: '2026-11-12T09:45:00Z' }];
    assert.equal(only(input({ pulls: [pr({ files, reviews, comments })] })).severity, 'violation', body);
  }
});

test('review #87 item 4e: prose() drops quoted lines, code and HTML comments (the text approvals and verdicts are read from)', () => {
  assert.equal(prose('> Схвалюю\n>Approved\n  > Verdict: Ready\nmine'), 'mine');
  assert.equal(prose('a\n```\nVerdict: Ready\n```\n    Verdict: Ready\n<!-- Схвалюю -->b'), 'a\nb');
});

test('review #87 item 9: file names in findings cannot inject workflow commands or lines', () => {
  const c = { sha: 'd'.repeat(40), date: '2026-11-12T10:00:00Z', title: 'x\n::error::y', pulls: [] };
  const md = render(evaluate(input({ commits: [c], pulls: [] })));
  assert.ok(!/\n::/.test(md) && !/x\n/.test(md), md);
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
  // Merged before 2026-11-12: «Ready» on an older commit is «to check» (the rule of the time). The requirement
  // files only change their «Перевіряється» line, so no owner decision is asked for.
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

test('review #87 r2 item 8 (N14): the verdict value must end the line; «Ready once …» is no verdict', () => {
  assert.equal(verdictOf('Verdict: Ready once B1 is fixed', 'review'), null);
  assert.equal(verdictOf('Security verdict: Ready after the fix', 'security'), null);
  assert.equal(verdictOf('Verdict: Ready.', 'review'), 'Ready');
  assert.equal(verdictOf('Verdict: Ready!', 'review'), 'Ready');
  assert.equal(verdictOf('Verdict: «Ready»', 'review'), 'Ready');
  assert.equal(verdictOf('**Verdict: «Ready»**. Nothing is blocking.', 'review'), 'Ready', 'bold closes the verdict (as in #70)');
  assert.equal(verdictOf('**Verdict: «Changes requested»**: 2 blocking items.', 'review'), 'Changes requested');
  assert.equal(verdictOf('Verdict: Not ready', 'review'), 'Not ready', 'both negative words are read');
  assert.equal(verdictOf('Verdict: Changes requested', 'review'), 'Changes requested');
});

test('review #87 r2 item 7: the body approval line must approve — negations do not count', () => {
  assert.equal(bodyApproval('Рішення власника (2026-11-12): схвалено розгортання.'), true);
  assert.equal(bodyApproval('Рішення власника (2026-11-12): схвалено'), true);
  for (const line of [
    'Рішення власника (2026-11-12): схвалено не буде',
    'Рішення власника (2026-11-12): схвалено, але не зараз',
    'Рішення власника (2026-11-12): не схвалено',
    'Рішення власника (2026-11-12): схвалено? ні',
    'Рішення власника (2026-11-12): схвалено — not yet',
    'Рішення власника (2026-11-12): схваленою не є',
    '> Рішення власника (2026-11-12): схвалено',
  ]) {
    assert.equal(bodyApproval(line), false, line);
  }
});

test('review #87 r2 item 4: the unfilled template does not record an owner decision', () => {
  const template = fs.readFileSync(new URL('../../../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.equal(recordsOwnerDecision(template), false, 'heading and template comment only');
  assert.equal(recordsOwnerDecision(template.replace('## Owner decision\n', '## Owner decision\n\nOwner, 2026-11-12: «так».\n')), true);
  assert.equal(recordsOwnerDecision('## Owner decision\n\n## Impact\nx'), false);
  assert.equal(recordsOwnerDecision('- Рішення власника 2026-11-12: …'), true);
  assert.equal(recordsOwnerDecision('<!-- Рішення власника -->'), false);
  const files = [{ filename: 'AGENTS.md', status: 'modified', patch: '+x' }];
  assert.equal(only(input({ pulls: [pr({ files, body: template })] })).severity, 'stale', 'merged with the unfilled template');
});
