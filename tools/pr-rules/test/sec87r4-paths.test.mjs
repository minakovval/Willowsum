// Security re-review of PR #87 (CICD-01), round 4: every nested lint, format and build config is pipeline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoriesOf } from '../lib/paths.mjs';

test('SEC87R4: nested Prettier configs, package scripts and Vite configs are pipeline', () => {
  for (const p of [
    'apps/web/.prettierrc', 'packages/ui/.prettierrc.json', 'apps/web/src/.prettierrc.yaml',
    'packages/ui/prettier.config.mjs', 'apps/web/prettier.config.js', 'prettier.config.cjs',
    'packages/domain-kernel/scripts/check.ts', 'packages/ui/scripts/a/b.mjs',
    'apps/web/vite.config.mts', 'packages/ui/vite.config.js',
    'apps/web/eslint.config.cts', 'apps/web/src/deep/eslint.config.mjs',
  ]) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
});
