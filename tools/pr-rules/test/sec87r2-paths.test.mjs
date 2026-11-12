// Security re-review of PR #87 (CICD-01), round 2: the path map and the owner-approval signals after 92b0158.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoriesOf, classifyFiles, ownerApprovalNeeded, ownerDecisionFiles, safeName, unionClassification, classifyPaths } from '../lib/paths.mjs';

const wf = (content) => ownerApprovalNeeded([{ filename: '.github/workflows/ops.yml', content }]).required;

test('SEC87R2: secret references in the expression forms GitHub accepts need the owner approval', () => {
  assert.equal(wf('env:\n  K: ${{secrets.DEPLOY_KEY}}\n'), true, 'no spaces');
  assert.equal(wf("env:\n  K: ${{ secrets [ 'DEPLOY_KEY' ] }}\n"), true, 'index form with spaces');
  assert.equal(wf('env:\n  K: ${{ secrets.GITHUB_TOKEN_2 }}\n'), true, 'a name that only starts like the job token');
  assert.equal(wf('jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@0123\n    secrets: inherit\n'), true);
  assert.equal(wf('env:\n  T: ${{ secrets.GITHUB_TOKEN }}\n'), false);
});

test('SEC87R2-B6: `toJSON(secrets)` and other letter cases of the secrets context need the owner approval', () => {
  assert.equal(wf('env:\n  ALL: ${{ toJSON(secrets) }}\n'), true, 'every secret at once');
  assert.equal(wf('env:\n  K: ${{ SECRETS.DEPLOY_KEY }}\n'), true, 'contexts are case-insensitive');
  assert.equal(wf('env:\n  K: ${{ Secrets.deploy_key }}\n'), true);
  // No false alarm on prose or on the job token.
  assert.equal(wf('# No external services and no secrets.\nenv:\n  T: ${{ secrets.GITHUB_TOKEN }}\n'), false);
});

test('SEC87R2-B6: the production environment in any letter case needs the owner approval', () => {
  assert.equal(wf('jobs:\n  a:\n    environment: Production\n'), true);
  assert.equal(wf('jobs:\n  a:\n    environment:\n      name: PRODUCTION\n'), true);
  assert.equal(wf('jobs:\n  a:\n    environment: { name: Production }\n'), true);
  assert.equal(wf('jobs:\n  a:\n    environment: staging\n'), false);
});

test('SEC87R2: a renamed file is judged by its old name for the label and the owner decision too', () => {
  assert.deepEqual(classifyFiles([{ filename: 'apps/web/x.ts', previous_filename: 'apps/api/src/main.ts' }]).categories, ['permissions']);
  assert.deepEqual(ownerDecisionFiles([{ filename: 'docs/x.md', previous_filename: '.claude/skills/review-pr/SKILL.md' }]), ['.claude/skills/review-pr/SKILL.md']);
  // A requirement moved elsewhere is not a «Перевіряється»-only change even when the patch is.
  const patch = '@@\n-- Перевіряється: a\n+- Перевіряється: b\n';
  assert.deepEqual(ownerDecisionFiles([{ filename: 'docs/requirements/arc/ARC-06.md', previous_filename: 'docs/requirements/arc/ARC-05.md', patch }]).length, 2);
});

test('SEC87R2: the union keeps every category of either map and is sensitive when only the old map says so', () => {
  const a = classifyPaths(['infra/a.tf']);
  const b = { sensitive: true, categories: ['money', 'unlisted'], files: { money: ['apps/web/x.ts'], unlisted: ['?'] } };
  assert.deepEqual(unionClassification(a, b).categories, ['money', 'infrastructure', 'unlisted']);
  assert.equal(unionClassification(classifyPaths(['apps/web/x.ts']), b).sensitive, true);
});

test('SEC87R2: new map entries hold (gate tests excluded, gate scripts not; agent settings; crypt in any segment)', () => {
  assert.deepEqual(categoriesOf('apps/api/scripts/migrate.ts'), ['schema', 'pipeline']);
  assert.deepEqual(categoriesOf('apps/api/scripts/lib/x.test.ts'), []);
  assert.deepEqual(categoriesOf('.claude/settings.local.json'), ['pipeline']);
  assert.deepEqual(categoriesOf('packages/ui/src/decrypt-view.tsx'), ['encryption']);
  assert.deepEqual(categoriesOf('apps/web/vitest.config.ts'), ['pipeline']);
});

test('SEC87R2: sanitized names keep no line separator of any kind', () => {
  assert.equal(safeName('a\u2028b\u2029c'), 'a?b?c');
  assert.ok(!/[\n\r\u2028\u2029]/.test(safeName('x\r\n\u2028\u2029y')));
});

test('SEC87R2-N1: sanitized names carry no legacy `##[` workflow command', () => {
  assert.ok(!safeName('infra/x ##[add-mask]Sensitive.tf').includes('##['));
});

