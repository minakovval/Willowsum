// Security review #92: the daily check accepts only `skipped` for a job the PR did not need — never another
// conclusion — and fails closed when the file list is missing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../lib/daily.mjs';

const JOBS = ['traceability', 'requirements', 'web', 'secrets', 'local-env', 'api', 'infra', 'changes'];
const HEAD = 'a'.repeat(40);
const MERGE = 'c'.repeat(40);
const runs = (over = {}) =>
  JOBS.map((name, i) => ({ id: 100 + i, name, app: 'github-actions', status: 'completed', conclusion: over[name] ?? 'success', completed_at: '2026-11-12T09:50:00Z' }));
const pr = (over = {}) => ({
  number: 90,
  title: 'CICD-01: x',
  merged_at: '2026-11-12T10:00:00Z',
  base_ref: 'main',
  head_sha: HEAD,
  head_date: '2026-11-12T09:40:00Z',
  merge_commit_sha: MERGE,
  labels: [],
  files: [{ filename: 'docs/ops/integrations.md', status: 'modified' }],
  reviews: [{ id: 1, body: '## Review\nVerdict: Ready', commit_id: HEAD, submitted_at: '2026-11-12T09:55:00Z', user: 'repo-owner', state: 'COMMENTED' }],
  comments: [],
  checkRuns: runs(),
  requiredJobs: JOBS,
  ...over,
});
const ciFindings = (p) =>
  evaluate({
    now: '2026-11-12T12:00:00Z',
    window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z' },
    owner: 'repo-owner',
    main: { name: 'main', head: MERGE },
    activities: [{ timestamp: '2026-11-12T10:00:00Z', activity_type: 'pr_merge', before: 'b'.repeat(40), after: MERGE, actor: 'repo-owner' }],
    commits: [{ sha: MERGE, date: '2026-11-12T10:00:00Z', title: 'CICD-01: x (#90)', pulls: [{ number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: MERGE, base_ref: 'main' }] }],
    pulls: [p],
    branches: [],
  }).findings.map((f) => f.message).join('\n');

test('sec92: a docs-only PR may skip heavy jobs, but a failed, cancelled or timed-out one is still a violation', () => {
  assert.equal(ciFindings(pr({ checkRuns: runs({ web: 'skipped', api: 'skipped', 'local-env': 'skipped', infra: 'skipped' }) })), '');
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'neutral']) {
    assert.match(ciFindings(pr({ checkRuns: runs({ web: conclusion }) })), new RegExp(`web: ${conclusion}`), conclusion);
  }
});

test('sec92: no file list, or a skipped always-run job, fails closed', () => {
  assert.match(ciFindings(pr({ files: undefined, checkRuns: runs({ infra: 'skipped' }) })), /infra: skipped/);
  assert.match(ciFindings(pr({ files: [], checkRuns: runs({ infra: 'skipped' }) })), /infra: skipped/);
  assert.match(ciFindings(pr({ checkRuns: runs({ changes: 'skipped' }) })), /changes: skipped/);
  assert.match(ciFindings(pr({ checkRuns: runs({ requirements: 'skipped' }) })), /requirements: skipped/);
});
