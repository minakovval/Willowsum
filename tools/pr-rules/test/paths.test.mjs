import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SENSITIVE_PATHS,
  categoriesOf,
  classifyFiles,
  classifyPaths,
  globToRegExp,
  labelsFor,
  ownerApprovalNeeded,
  ownerDecisionFiles,
  safeName,
  unionClassification,
} from '../lib/paths.mjs';

test('globs: ** spans segments (also none), * stays inside one segment', () => {
  assert.ok(globToRegExp('**/migrations/**').test('apps/api/src/modules/audit/adapters/db/migrations/0001.sql'));
  assert.ok(globToRegExp('**/migrations/**').test('migrations/0001.sql'));
  assert.ok(globToRegExp('infra/**').test('infra/start/kms.tf'));
  assert.ok(globToRegExp('**/Dockerfile').test('Dockerfile'));
  assert.ok(!globToRegExp('apps/api/src/api.ts').test('apps/api/src/api.tsx'));
  assert.ok(!globToRegExp('apps/*/x.ts').test('apps/a/b/x.ts'));
  assert.ok(!globToRegExp('.github/**').test('x.github/y'), 'dots are literal');
});

test('CICD-01 FR 4: every sensitive category of the requirement has paths', () => {
  assert.deepEqual(Object.keys(SENSITIVE_PATHS), [
    'auth',
    'permissions',
    'encryption',
    'money',
    'schema',
    'pipeline',
    'infrastructure',
  ]);
});

test('CICD-01 FR 4: files are classified by path into the sensitive categories', () => {
  const cases = {
    'apps/api/src/modules/identity/domain/password.ts': ['auth'],
    'apps/api/src/platform/http/cookies.ts': ['auth', 'permissions'],
    'apps/api/src/modules/access-scope/domain/permissions.ts': ['permissions'],
    'apps/api/src/modules/vault-items/domain/item.ts': ['encryption'],
    'apps/api/src/modules/ledger/domain/posting.ts': ['money'],
    'packages/domain-kernel/src/money.ts': ['money'],
    'apps/api/src/modules/audit/adapters/db/migrations/0002_x.sql': ['schema'],
    'apps/api/src/platform/db/isolation.ts': ['schema'],
    '.github/workflows/pr-checks.yml': ['pipeline'],
    'apps/api/Dockerfile': ['pipeline'],
    '.gitleaksignore': ['pipeline'],
    'infra/start/network.tf': ['infrastructure'],
    'infra/start/kms.tf': ['encryption', 'infrastructure'],
  };
  for (const [path, expected] of Object.entries(cases)) assert.deepEqual(categoriesOf(path), expected, path);
});

test('CICD-01 FR 4: ordinary code, UI and documentation are not sensitive', () => {
  for (const path of [
    'apps/web/src/App.tsx',
    'packages/ui/src/Switch.tsx',
    'docs/requirements/cicd/CICD-01.poc.md',
    'infra/start/README.md',
    '.github/pull_request_template.md',
    'apps/api/src/modules/feature-flags/domain/rollout.ts',
    'apps/api/src/modules/crypto-wallets.md',
    'apps/api/scripts/lib/dependency-rules.test.ts',
    'tools/synthetic/index.mjs',
  ]) {
    assert.deepEqual(categoriesOf(path), [], path);
  }
});

test('CICD-01 FR 4: a PR is sensitive when any file is; labels name each category', () => {
  const c = classifyPaths(['apps/web/src/App.tsx', 'infra/start/server.tf', '.github/workflows/x.yml']);
  assert.equal(c.sensitive, true);
  assert.deepEqual(c.categories, ['pipeline', 'infrastructure']);
  assert.deepEqual(labelsFor(c), ['sensitive', 'sensitive:pipeline', 'sensitive:infrastructure']);
  assert.deepEqual(labelsFor(classifyPaths(['apps/web/src/App.tsx'])), []);
});

test('CICD-01 FR 4: a rename out of a sensitive folder is still sensitive (both names are classified)', () => {
  assert.equal(classifyPaths(['apps/api/src/x.ts', 'apps/api/src/modules/ledger/x.ts']).sensitive, true);
});

test('CICD-01 FR 3: workflows that apply, deploy or take an OIDC token need the owner approval comment', () => {
  const wf = (content, filename = '.github/workflows/ops.yml') => ownerApprovalNeeded([{ filename, content }]);
  assert.equal(wf('permissions:\n  id-token: write\n').required, true);
  assert.equal(wf('run: tofu -chdir=infra/start apply -auto-approve\n').required, true);
  assert.equal(wf('jobs:\n  a:\n    environment: production\n').required, true);
  assert.equal(wf('jobs:\n  a:\n    environment:\n      name: production\n').required, true);
  assert.equal(wf('run: docker push ghcr.io/x/y\n').required, true);
  assert.equal(wf('on: push\n', '.github/workflows/deploy-staging.yml').required, true);
  // CI check jobs and validation only: no approval comment.
  assert.equal(wf('run: tofu -chdir=infra/start validate\nrun: docker build .\n', '.github/workflows/pr-checks.yml').required, false);
});

test('CICD-01 FR 3: OIDC trust, the production secrets store and DNS in infrastructure code need approval', () => {
  const tf = (patch, filename = 'infra/start/access.tf') => ownerApprovalNeeded([{ filename, patch }]);
  assert.equal(tf('+resource "oci_identity_domains_identity_provider" "github" {').required, true);
  assert.equal(tf('+resource "oci_vault_secret" "db" {').required, true);
  assert.equal(tf('+resource "cloudflare_record" "www" {', 'infra/start/dns.tf').required, true);
  assert.equal(tf('+  dns_label = "public"', 'infra/start/network.tf').required, false, 'a VCN DNS label is not DNS');
  assert.equal(tf('+# OIDC is added in a later PR').required, false, 'a comment is not a change');
  assert.equal(tf('+Set up the OIDC trust', 'infra/start/README.md').required, false, 'documentation');
  assert.equal(tf('+resource "oci_kms_key" "master" {', 'infra/start/kms.tf').required, false, 'KMS as code: no apply');
  assert.equal(tf('+services: {}', 'infra/local/compose.yaml').required, false, 'local environment');
  // The same signal outside infra/local needs approval; inside it never does.
  assert.equal(tf('+resource "oci_vault_secret" "db" {', 'infra/start/x.tf').required, true);
  assert.equal(tf('+resource "oci_vault_secret" "db" {', 'infra/local/x.tf').required, false, 'local environment, real signal');
  assert.equal(tf('+x', 'infra/local/oidc-mock.yaml').required, false, 'local environment, signal in the name');
});

test('review #87 blocking 1: every file named after encryption is sensitive (`**/*crypt*`)', () => {
  for (const path of [
    'apps/web/src/vault/crypto.ts',
    'apps/web/src/vault/decrypt.ts',
    'packages/vault-crypto/src/seal.ts',
    'apps/api/src/platform/encrypt.ts',
  ]) {
    assert.ok(categoriesOf(path).includes('encryption'), path);
  }
});

test('review #87 blocking 2: every gate the required CI jobs run, and the supply chain, is pipeline', () => {
  for (const path of [
    'apps/api/scripts/check-modules.ts',
    'apps/api/scripts/lib/dependency-rules.ts',
    'apps/api/scripts/lib/provider-sdks.ts',
    'apps/api/provider-sdks.json',
    'tools/test-guards/no-network.mjs',
    'tools/req-check/index.mjs',
    'tools/local-env/check.mjs',
    'tools/infra-check/index.mjs',
    'tools/observability/check.mjs',
    'eslint.config.js',
    'apps/api/vitest.config.ts',
    'apps/api/vitest.integration.config.ts',
    'vitest.workspace.config.ts',
    '.github/CODEOWNERS',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.claude/settings.json',
    'apps/api/package.json',
    'packages/ui/package.json',
    'tsconfig.base.json',
    'apps/web/tsconfig.json',
    'packages/api-contract/scripts/generate.ts',
    '.prettierrc.json',
    '.prettierignore',
  ]) {
    assert.ok(categoriesOf(path).includes('pipeline'), path);
  }
  assert.deepEqual(categoriesOf('apps/api/scripts/lib/dependency-rules.test.ts'), [], 'tests of a gate script: `!` excludes');
});

test('review #87 item 3: rule and requirement changes need a recorded owner decision (label `owner-decision`)', () => {
  const f = (filename, patch, extra = {}) => ({ filename, patch, ...extra });
  for (const name of ['AGENTS.md', 'CLAUDE.md', '.claude/skills/review-pr/SKILL.md', '.claude/settings.json', 'docs/requirements/bud/BUD-16.poc.md']) {
    assert.deepEqual(ownerDecisionFiles([f(name, '+x')]), [name], name);
  }
  assert.deepEqual(ownerDecisionFiles([f('docs/plans/poc-wave-1.md', '+x'), f('docs/adr/0008-x.md', '+x')]), []);
  // Only the «Перевіряється» line (test paths) changed: not a requirement change.
  const testsLine = '@@ -9,7 +9,7 @@\n - Модуль: —\n-- Перевіряється: —\n+- Перевіряється: a.test.ts\n \n';
  assert.deepEqual(ownerDecisionFiles([f('docs/requirements/arc/ARC-05.poc.md', testsLine)]), []);
  assert.deepEqual(ownerDecisionFiles([f('docs/requirements/arc/ARC-05.poc.md', `${testsLine}+3. New criterion\n`)]), ['docs/requirements/arc/ARC-05.poc.md']);
  assert.deepEqual(ownerDecisionFiles([f('docs/requirements/arc/ARC-05.poc.md', undefined)]), ['docs/requirements/arc/ARC-05.poc.md'], 'no patch: fails closed');
  assert.deepEqual(ownerDecisionFiles([f('docs/x.md', testsLine, { previous_filename: 'docs/requirements/arc/ARC-05.poc.md' })]), ['docs/requirements/arc/ARC-05.poc.md'], 'moved out');
});

test('review #87 item 8: production environment blocks, pushed images and secrets need the owner approval', () => {
  const wf = (content) => ownerApprovalNeeded([{ filename: '.github/workflows/ops.yml', content }]).required;
  assert.equal(wf('jobs:\n  a:\n    environment:\n      url: https://x\n      name: production\n'), true, 'url before name');
  assert.equal(wf('jobs:\n  a:\n    environment: { url: x, name: production }\n'), true, 'flow mapping');
  assert.equal(wf('jobs:\n  a:\n    environment:\n      name: staging\n    steps:\n      - name: production\n'), false, 'name of a step');
  assert.equal(wf('steps:\n  - uses: docker/build-push-action@0123\n    with:\n      push: true\n'), true);
  assert.equal(wf('steps:\n  - uses: docker/build-push-action@0123\n    with:\n      push: false\n'), false, 'build only');
  assert.equal(wf('env:\n  TOKEN: ${{ secrets.DEPLOY_KEY }}\n'), true);
  assert.equal(wf('jobs:\n  a:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n'), true);
  assert.equal(wf('env:\n  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n'), false, 'the job token is not a secret');
});

test('review #87 item 4a: a renamed workflow or infrastructure file is judged by its old name too', () => {
  assert.equal(ownerApprovalNeeded([{ filename: 'docs/old.yml', previous_filename: '.github/workflows/deploy.yml', patch: '' }]).required, true);
  assert.equal(ownerApprovalNeeded([{ filename: 'tmp/x.tf', previous_filename: 'infra/start/x.tf', patch: '+resource "oci_vault_secret" "db" {' }]).required, true);
  assert.deepEqual(classifyFiles([{ filename: 'apps/web/x.ts', previous_filename: 'infra/start/x.tf' }]).categories, ['infrastructure']);
});

test('review #87 item 9: a PR that edits the map is judged by the base and the head map (union)', () => {
  const u = unionClassification(classifyPaths(['apps/web/x.ts']), { sensitive: true, categories: ['money'], files: { money: ['apps/web/x.ts'] } });
  assert.deepEqual(u.categories, ['money']);
  assert.equal(u.sensitive, true);
  assert.deepEqual(unionClassification(classifyPaths(['infra/a.tf']), undefined).categories, ['infrastructure']);
});

test('review #87 item 9: file names are sanitized before logging (no newline, no workflow command)', () => {
  assert.equal(safeName('a\n::error::x\r'), 'a?: :error: :x?');
});
