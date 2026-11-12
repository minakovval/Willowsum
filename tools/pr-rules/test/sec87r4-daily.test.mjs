// Security re-review of PR #87 (CICD-01), round 4: a negative verdict never fails open, whatever its letter case
// or separator; what this round's parser changes accept and refuse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, recordsOwnerDecision, verdictOf } from '../lib/daily.mjs';

const JOBS = ['traceability', 'requirements', 'web', 'secrets', 'local-env', 'api', 'infra'];
const HEAD = 'a'.repeat(40);
const MERGE = 'c'.repeat(40);
const review = (id, body, at) => ({ id, body, commit_id: HEAD, submitted_at: at, user: 'repo-owner', state: 'COMMENTED' });
const input = (reviews) => ({
  now: '2026-11-12T12:00:00Z',
  window: { since: '2026-11-11T11:00:00Z', until: '2026-11-12T12:00:00Z' },
  owner: 'repo-owner',
  main: { name: 'main', head: MERGE },
  activities: [{ timestamp: '2026-11-12T10:00:00Z', activity_type: 'pr_merge', before: 'b'.repeat(40), after: MERGE, actor: 'repo-owner' }],
  commits: [{ sha: MERGE, date: '2026-11-12T10:00:00Z', title: 'CICD-01: x (#90)', pulls: [{ number: 90, merged_at: '2026-11-12T10:00:00Z', merge_commit_sha: MERGE, base_ref: 'main' }] }],
  pulls: [{
    number: 90, title: 'CICD-01: x', merged_at: '2026-11-12T10:00:00Z', base_ref: 'main', head_sha: HEAD,
    head_date: '2026-11-12T09:40:00Z', merge_commit_sha: MERGE, labels: [],
    files: [{ filename: 'apps/web/src/App.tsx', status: 'modified' }], reviews, comments: [],
    checkRuns: JOBS.map((name, i) => ({ id: 100 + i, name, app: 'github-actions', status: 'completed', conclusion: 'success', completed_at: '2026-11-12T09:50:00Z' })),
    requiredJobs: JOBS,
  }],
  branches: [],
});

test('SEC87R4: this round keeps the strict end of «Ready» (no other Unicode space ends it)', () => {
  assert.equal(verdictOf('**Verdict: Ready** once B1 is fixed', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready… once B1', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready — once B1', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready ', 'review'), 'Ready');
});

test('SEC87R4: an empty subheading alone under «## Owner decision» records nothing (N2, fixed)', () => {
  // N2 was pinned as fail-open; the deliberate change (review-pr round 4): a subheading alone is not a record.
  assert.equal(recordsOwnerDecision('## Owner decision\n\n### Details\n\n## Impact\nx'), false);
  assert.equal(recordsOwnerDecision('## Owner decision\n<!-- template -->\n## Impact\nx'), false);
});

// B8. The verdict lines are case-sensitive and need «Verdict:» right before the value. A negative verdict that
// misses the exact spelling («Not Ready», «Changes Requested», «Security Verdict: …», «Verdict : …») is no
// verdict at all; latestVerdict drops it, and an earlier «Ready» on the same commit stands: the merge after a
// negative verdict raises no alert.
const NEGATIVE = [
  'Verdict: Not Ready',
  'Verdict: NOT READY',
  'Verdict: not ready',
  'Verdict: Changes Requested',
  'Verdict: Not ready',
  'Verdict: Not-ready',
  'Verdict : Changes requested',
  'VERDICT: Changes requested',
];
test('SEC87R4-B8: a negative verdict in another letter case or spacing is still negative', () => {
  for (const line of NEGATIVE) {
    assert.ok(verdictOf(line, 'review') && verdictOf(line, 'review') !== 'Ready', line);
  }
  for (const line of ['Security Verdict: Changes requested', 'Security verdict: Not Ready', 'security verdict: changes requested']) {
    assert.ok(verdictOf(line, 'security') && verdictOf(line, 'security') !== 'Ready', line);
  }
  // End to end: Ready, then «Not Ready» on the same commit, then the merge → a violation.
  const f = evaluate(input([review(1, 'Verdict: Ready', '2026-11-12T09:00:00Z'), review(2, 'Verdict: Not Ready', '2026-11-12T09:55:00Z')])).findings;
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.match(f[0].message, /останній вердикт був «Not Ready»/);
});

test('SEC87R4-B8: «Ready» itself stays exact (letter case and the colon)', () => {
  for (const line of ['Verdict: ready', 'Verdict: READY', 'verdict: Ready', 'Verdict : Ready']) {
    assert.equal(verdictOf(line, 'review'), null, line);
  }
  assert.equal(verdictOf('security verdict: Ready', 'security'), null);
  assert.equal(verdictOf('Verdict: Not ready', 'review'), 'Not ready');
  assert.equal(verdictOf('Verdict: Changes requested', 'review'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Changes requested', 'security'), 'Changes requested');
  assert.equal(verdictOf('Security verdict: Changes requested', 'review'), null, 'a security line is not a review verdict');
  assert.equal(verdictOf('Verdict: Changes requested', 'security'), null, 'a review line is not a security verdict');
});
