import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SENSITIVE_PATHS, categoriesOf, classifyPaths, globToRegExp, labelsFor, ownerApprovalNeeded } from '../lib/paths.mjs';

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
    'tools/req-check/index.mjs',
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
});
