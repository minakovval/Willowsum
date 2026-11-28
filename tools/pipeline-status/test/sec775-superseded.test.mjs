// Створено: 2026-11-28 · Оновлено: 2026-11-28
// Security review of PR #775: a cancelled run is superseded only when the same name has a real `success` on the same
// head, and a later failure is not hidden behind an earlier success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ciSummary } from '../lib.mjs';

const run = (name, conclusion, minute, status = 'completed') => ({ name, status, conclusion, started_at: `2026-11-28T10:0${minute}:00Z` });

test('sec775: a skipped or neutral run does not make a later cancelled run superseded', () => {
  assert.equal(ciSummary([run('api', 'skipped', 1), run('api', 'cancelled', 2)]).text, 'red: api=cancelled');
  assert.equal(ciSummary([run('api', 'neutral', 1), run('api', 'cancelled', 2)]).text, 'red: api=cancelled');
});

test('sec775: success, then failure, then cancelled is red, not superseded', () => {
  assert.equal(ciSummary([run('api', 'success', 1), run('api', 'failure', 2), run('api', 'cancelled', 3)]).text, 'red: api=failure');
});

test('sec775: the superseded cases of the PR still hold', () => {
  assert.equal(ciSummary([run('api', 'cancelled', 1), run('api', 'success', 2)]).text, 'green 1 (1 superseded)');
  assert.equal(ciSummary([run('api', 'success', 1), run('api', 'cancelled', 2)]).text, 'green 1 (1 superseded)');
  assert.equal(ciSummary([run('api', 'skipped', 1)]).text, 'green 1');
});
