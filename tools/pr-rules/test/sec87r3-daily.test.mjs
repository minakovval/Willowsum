// Security re-review of PR #87 (CICD-01), round 3: what the reader sees, verdict line endings, the body approval
// line and its negations, the owner-decision line. Each test kills a mutant the round-2 suite let survive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bodyApproval, recordsOwnerDecision, verdictOf } from '../lib/daily.mjs';

const H = 'Рішення власника (2026-11-12): ';

test('SEC87R3: every raw-text HTML block hides a verdict (<textarea> too); a one-line <pre> closes itself', () => {
  assert.equal(verdictOf('Verdict: Changes requested\n<textarea>\nVerdict: Ready\n</textarea>', 'review'), 'Changes requested');
  assert.equal(verdictOf('<STYLE>\nVerdict: Ready\n</style>', 'review'), null);
  assert.equal(verdictOf('<pre>code</pre>\nVerdict: Changes requested', 'review'), 'Changes requested', 'the block ended on its first line');
});

test('SEC87R3: an inline <!-- that is not closed in its paragraph hides nothing a reader sees', () => {
  // GitHub shows «<!--» as text when the comment does not end in the same paragraph.
  assert.equal(verdictOf('Verdict: Ready\n\nSee <!-- below\nVerdict: Changes requested', 'review'), 'Changes requested');
  assert.equal(verdictOf('Verdict: Ready\n\nnote <!-- start\n\nVerdict: Changes requested\n\nend -->', 'review'), 'Changes requested');
});

test('SEC87R3: closing markup ends the verdict only when a space or punctuation follows it', () => {
  assert.equal(verdictOf('**Verdict: Ready**ish', 'review'), null);
  assert.equal(verdictOf('**Verdict: Ready**, once B1 is fixed', 'review'), 'Ready', 'documented: closed bold ends the value');
  assert.equal(verdictOf('Verdict: Readyish', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready<!-- -->', 'review'), 'Ready');
  assert.equal(verdictOf('Verdict: Ready<!-- --> once fixed', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready — once B1 is fixed', 'review'), null);
  assert.equal(verdictOf('Verdict: Ready (pending B1)', 'review'), null);
});

test('SEC87R3: negations in any letter case and both scripts refuse the body approval', () => {
  for (const tail of ['схвалено? no', 'схвалено — NO', 'схвалено — НІ', 'схвалено, NOT yet', 'схвалено (Не остаточно)', 'схвалено не', 'схвалено **не**']) {
    assert.equal(bodyApproval(H + tail), false, tail);
  }
  assert.equal(bodyApproval('НЕ схвалено'), false);
  for (const tail of ['схвалено.', 'Схвалено', 'СХВАЛЕНО!']) assert.equal(bodyApproval(H + tail), true, tail);
});

test('SEC87R3: a negation is a whole word: «остаточне», «негайно», «nothing» do not refuse the approval', () => {
  assert.equal(bodyApproval(H + 'схвалено, рішення остаточне'), true);
  assert.equal(bodyApproval(H + 'схвалено негайно'), true);
  assert.equal(bodyApproval(H + 'схвалено, nothing else blocks'), true);
});

test('SEC87R3: the body approval is its own line, not a list item', () => {
  assert.equal(bodyApproval('- ' + H + 'схвалено'), false);
  assert.equal(bodyApproval('* ' + H + 'схвалено'), false);
  assert.equal(bodyApproval('**Рішення власника (2026-11-12):** схвалено'), true);
});

test('SEC87R3: «Рішення власника» must be the whole phrase to record an owner decision', () => {
  assert.equal(recordsOwnerDecision('Рішення власниками не ухвалювалося'), false);
  assert.equal(recordsOwnerDecision('- Рішення власника 2026-11-12: так'), true);
});

