import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forbiddenPathReason, reviewerPatchViolations } from '../lib/reviewer-patches.mjs';

test('reviewer patches: sensitive paths, security tests and rule files are closed, e2e and docs stay open', () => {
  assert.equal(forbiddenPathReason('apps/api/src/modules/identity/x.ts'), 'sensitive path');
  assert.equal(forbiddenPathReason('apps/api/test/isolation.it.test.ts'), 'security test');
  assert.equal(forbiddenPathReason('apps/api/test/sec87-foo.it.test.ts'), 'security test');
  assert.equal(forbiddenPathReason('apps/api/test/vault-keys.it.test.ts'), 'security test');
  assert.equal(forbiddenPathReason('AGENTS.md'), 'rule file');
  assert.equal(forbiddenPathReason('CLAUDE.md'), 'rule file');
  assert.equal(forbiddenPathReason('.claude/skills/review-pr/SKILL.md'), 'rule file');
  assert.equal(forbiddenPathReason('apps/web/e2e/budget.spec.ts'), null);
  assert.equal(forbiddenPathReason('apps/web/src/screens/Budget.tsx'), null);
  assert.equal(forbiddenPathReason('docs/requirements/budget/BUD-03.md'), null);
});

test('reviewer patches: a renamed file is checked by its old name too', () => {
  const v = reviewerPatchViolations([{ filename: 'apps/web/a.ts', previous_filename: 'AGENTS.md' }]);
  assert.deepEqual(v, ['AGENTS.md: rule file']);
});

test('reviewer patches: skip, only, todo, removed tests and directive comments are violations', () => {
  const diff = [
    '--- a/x.test.ts',
    '+++ b/x.test.ts',
    '-  it(\'keeps the total\', () => {',
    '+  it.skip(\'keeps the total\', () => {',
    '+  describe.only(\'a\', () => {});',
    '+  // eslint-disable-next-line no-console',
    '+  // @ts-expect-error nope',
    '+  const k = "x"; // gitleaks:allow',
    '+  it.todo(\'later\');',
  ].join('\n');
  const v = reviewerPatchViolations([{ filename: 'apps/web/src/x.test.ts' }], diff);
  assert.equal(v.length, 7);
  assert.ok(v.some((s) => s.startsWith('removed or changed test')));
});

test('reviewer patches: a text-only change is clean', () => {
  const diff = '--- a/a.tsx\n+++ b/a.tsx\n-  <h1>Old</h1>\n+  <h1>New</h1>\n+  // plain comment about it(x)\n';
  assert.deepEqual(reviewerPatchViolations([{ filename: 'apps/web/src/a.tsx' }], diff), []);
});
