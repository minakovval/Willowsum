// Security re-review of PR #87 (CICD-01), round 3: the pipeline map has no nested-config gap; expression strings
// are not the secrets context.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoriesOf, ownerApprovalNeeded } from '../lib/paths.mjs';

test('SEC87R3: nested package.json and every tsconfig variant are pipeline', () => {
  for (const p of ['apps/web/package.json', 'packages/a/b/package.json', 'apps/web/tsconfig.app.json', 'packages/x/tsconfig.build.json', 'tsconfig.base.json', 'packages/api-contract/scripts/a/b.ts']) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
});

// ESLint 10 looks a config up from each linted file's folder: apps/web/eslint.config.js replaces the root config
// (and its NFR-06 money rules) for everything under apps/web, and `pnpm lint` stays green.
test('SEC87R3-B7: a nested ESLint config (any extension) is pipeline', () => {
  for (const p of ['apps/web/eslint.config.js', 'packages/ui/eslint.config.mjs', 'apps/api/eslint.config.ts', 'eslint.config.mjs']) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
});

test('SEC87R3: a string literal that says «secrets» is not the secrets context; a real reference after one is', () => {
  const wf = (t) => ownerApprovalNeeded([{ filename: '.github/workflows/ci.yml', content: t }]).required;
  assert.equal(wf("if: ${{ contains(github.event.head_commit.message, 'secrets') }}\n"), false);
  assert.equal(wf("env:\n  A: ${{ format('it''s {0}', secrets.X) }}\n"), true);
  assert.equal(wf('env:\n  A: ${{ SECRETS.X }}\n'), true);
  assert.equal(wf('env:\n  A: ${{ secrets.github_token }}\n'), false, 'the job token in any case');
});

