// Security review #92: path tricks never skip a heavy job; anchors on the docs prefixes are load-bearing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDocsOnly, jobsToRun } from '../lib/ci-paths.mjs';

const files = (...names) => names.map((filename) => ({ filename, status: 'modified' }));
const all = { web: true, api: true, 'local-env': true, infra: true };
const webApi = { web: true, api: true, 'local-env': false, infra: false };

test('sec92: a docs/design/.claude directory nested in code, or a different case, is code', () => {
  for (const f of ['apps/web/src/docs/x.ts', 'packages/ui/design/tokens.ts', 'apps/api/.claude/x.json', 'Docs/x.md', 'DESIGN/x.json', 'apps/api/docs/README.md']) {
    assert.equal(isDocsOnly(f), false, f);
  }
  assert.deepEqual(jobsToRun(files('apps/web/src/docs/x.ts')), webApi);
  assert.deepEqual(jobsToRun(files('infra/docs/x.md')), { ...all, 'local-env': false });
  assert.deepEqual(jobsToRun(files('infra/local/docs/x.md')), all);
});

test('sec92: root configs outside the listed globs still run web and api; .github anything runs all', () => {
  for (const f of ['tsconfig.base.json', 'eslint.config.js', '.prettierrc.json', '.prettierignore', '.dockerignore', '.gitleaksignore', '.gitignore', 'apps/api/vitest.integration.config.ts', 'apps/api/Dockerfile']) {
    assert.deepEqual(jobsToRun(files(f)), webApi, f);
  }
  for (const f of ['.github/workflows/notes.md', '.github/CODEOWNERS', '.npmrc', 'pnpm-workspace.yaml']) assert.deepEqual(jobsToRun(files(f)), all, f);
  // A rename out of code into docs, a deletion of code, and a docs file next to a code file.
  assert.deepEqual(jobsToRun([{ filename: 'docs/old.ts', previous_filename: 'apps/api/src/x.ts', status: 'renamed' }]), webApi);
  assert.deepEqual(jobsToRun([{ filename: 'tools/local-env/lib/x.mjs', status: 'removed' }]), { ...all, infra: false });
});
