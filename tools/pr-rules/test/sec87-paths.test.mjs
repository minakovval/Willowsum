// Security review of PR #87 (CICD-01): evasion of the sensitive label. Tests named SEC87-B…/N… pin
// the defects the review found; the fix is in this PR.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoriesOf, classifyPaths, ownerApprovalNeeded } from '../lib/paths.mjs';

const sensitive = (path) => categoriesOf(path).length > 0;

test('SEC87: the code that runs with the label/alert write tokens is itself sensitive', () => {
  for (const p of ['tools/pr-rules/index.mjs', 'tools/pr-rules/lib/paths.mjs', 'tools/pr-rules/lib/daily.mjs', 'tools/pr-rules/package.json', 'tools/pr-rules/test/all.mjs']) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
  for (const p of ['.github/workflows/new.yml', '.github/actions/x/action.yml', '.github/CODEOWNERS', '.github/dependabot.yml']) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
});

test('SEC87: Markdown exclusion is anchored to the extension (no `.md` in the middle of a code file name)', () => {
  assert.ok(sensitive('apps/api/src/modules/ledger/readme.md.ts'));
  assert.ok(sensitive('infra/start/notes.md.tf'));
  assert.ok(sensitive('.github/workflows/md.yml'));
});

test('SEC87: renamed out of / into a sensitive path is sensitive (both names classified)', () => {
  assert.ok(classifyPaths(['apps/web/src/x.ts', 'infra/start/kms.tf']).sensitive);
  assert.ok(classifyPaths(['apps/web/src/x.ts', 'apps/api/src/modules/identity/session.ts']).sensitive);
});

test('SEC87: look-alike paths that nothing executes are not sensitive (no false alarm), real ones are', () => {
  // Case and Unicode look-alikes are different paths on Linux and for GitHub Actions; they do not run.
  assert.ok(!sensitive('.GitHub/workflows/x.yml'));
  assert.ok(!sensitive('infrа/start/x.tf'));
  assert.ok(sensitive('.github/workflows/x.yml'));
});

test('SEC87-B4: files that switch auth/permission controls on or off are sensitive', () => {
  // main.ts decides `rateLimits` on/off and passes allowedOrigins (NFR-14); server.ts installs the security
  // headers; config.ts reads the secrets and the rate-limit switch. Turning any of these off today is not sensitive.
  for (const p of ['apps/api/src/main.ts', 'apps/api/src/platform/process/server.ts', 'apps/api/src/platform/config/config.ts']) {
    assert.ok(sensitive(p), p);
  }
});

test('SEC87-N: Dockerfile variants and container files are pipeline', () => {
  for (const p of ['apps/api/Dockerfile.prod', 'apps/api/dockerfile', 'apps/api/api.dockerfile', 'apps/api/Containerfile']) {
    assert.ok(categoriesOf(p).includes('pipeline'), p);
  }
});

test('SEC87-N: a sensitive directory replaced by a symlink (a file at the directory path) is sensitive', () => {
  // A symlink `…/migrations` → a non-sensitive folder makes every later SQL file there non-sensitive.
  assert.ok(sensitive('apps/api/src/modules/audit/adapters/db/migrations'));
  assert.ok(sensitive('apps/api/src/modules/ledger'));
  assert.ok(sensitive('infra'));
});

test('SEC87-N: a newline in a file name does not escape `**`', () => {
  assert.ok(sensitive('infra/start/a\nb.tf'));
  assert.ok(sensitive('apps/api/src/modules/audit/adapters/db/migrations/0003\n.sql'));
});

test('SEC87-N: encryption code in a folder named after it is sensitive', () => {
  assert.ok(sensitive('apps/web/src/encryption/keys.ts'));
  assert.ok(sensitive('packages/vault-cipher/src/index.ts'));
});

test('SEC87-N: package manager configuration that CI runs is pipeline', () => {
  for (const p of ['package.json', '.npmrc', 'pnpm-workspace.yaml']) assert.ok(categoriesOf(p).includes('pipeline'), p);
});

test('SEC87-B3: a cloud change whose diff GitHub does not return still needs the owner approval', () => {
  // GitHub omits `patch` for large diffs; padding a .tf change hides `oci_vault_secret`.
  assert.equal(ownerApprovalNeeded([{ filename: 'infra/start/secrets.tf', status: 'modified', unreadable: true }]).required, true);
  assert.equal(ownerApprovalNeeded([{ filename: '.github/workflows/ops.yml', status: 'modified', unreadable: true }]).required, true);
  // Still no approval for the local environment, documentation and removed files.
  assert.equal(ownerApprovalNeeded([{ filename: 'infra/local/compose.yaml', status: 'modified', unreadable: true }]).required, false);
  assert.equal(ownerApprovalNeeded([{ filename: 'infra/start/README.md', status: 'modified', unreadable: true }]).required, false);
});

test('SEC87: a truncated file list (over the API limit) makes the PR sensitive', () => {
  const c = classifyPaths(['apps/web/src/App.tsx'], { truncated: true });
  assert.equal(c.sensitive, true);
});

test('SEC87: the local environment never needs the owner approval, even with cloud-looking text', () => {
  const local = (filename, patch) => ownerApprovalNeeded([{ filename, status: 'modified', patch }]).required;
  assert.equal(local('infra/local/compose.yaml', '+  # oidc\n+  oci_vault_secret: x\n+  dns_record: y'), false);
  assert.equal(local('infra/local/oidc-dns.tf', '+x'), false);
  assert.equal(local('infra/start/oidc.tf', '+x'), true, 'outside infra/local the file name alone is enough');
});

