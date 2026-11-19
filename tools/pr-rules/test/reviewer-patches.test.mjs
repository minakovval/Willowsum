import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { forbiddenPathReason, reviewerPatchViolations } from '../lib/reviewer-patches.mjs';

/** A one-hunk diff of `x.test.ts` with the right line counts. */
const hunk = (...lines) => {
  const count = (sign) => lines.filter((l) => l.startsWith(sign) || l.startsWith(' ')).length;
  return ['--- a/x.test.ts', '+++ b/x.test.ts', `@@ -1,${count('-')} +1,${count('+')} @@`, ...lines].join('\n');
};
const check = (...lines) => reviewerPatchViolations([{ filename: 'apps/web/src/x.test.ts' }], hunk(...lines));

test('reviewer patches: sensitive paths, security tests and rule files are closed, e2e and docs stay open', () => {
  assert.equal(forbiddenPathReason('apps/api/src/modules/identity/x.ts'), 'sensitive path');
  assert.equal(forbiddenPathReason('apps/api/test/isolation.it.test.ts'), 'security test');
  assert.equal(forbiddenPathReason('apps/api/test/sec87-foo.it.test.ts'), 'security test');
  assert.equal(forbiddenPathReason('AGENTS.md'), 'rule file');
  assert.equal(forbiddenPathReason('CLAUDE.md'), 'rule file');
  assert.equal(forbiddenPathReason('.claude/skills/review-pr/SKILL.md'), 'rule file');
  assert.equal(forbiddenPathReason('apps/web/e2e/budget.spec.ts'), null);
  assert.equal(forbiddenPathReason('apps/web/src/screens/Budget.tsx'), null);
  assert.equal(forbiddenPathReason('docs/requirements/budget/BUD-03.md'), null);
});

test('reviewer patches: only isolation, security and sec<N> names are security tests', () => {
  for (const p of ['apps/api/test/isolation.it.test.ts', 'apps/api/test/sec87r2-x.it.test.ts', 'apps/api/test/security-cicd06.it.test.ts']) {
    assert.equal(forbiddenPathReason(p), 'security test', p);
  }
  for (const p of [
    'apps/web/src/vault-list.test.tsx',
    'apps/api/test/privacy.it.test.ts',
    'apps/api/test/rls-policies.it.test.ts',
    'apps/api/test/permission.it.test.ts',
    'apps/api/test/budget-totals.it.test.ts',
    'apps/web/src/section-title.test.tsx',
  ]) {
    assert.equal(forbiddenPathReason(p), null, p);
  }
});

test('reviewer patches: a test with `security` or `sec<N>` anywhere in its name is a security test', () => {
  for (const p of [
    'apps/api/test/api-security.test.ts',
    'apps/api/test/api-security-r2.test.ts',
    'apps/api/test/security-cicd06-r4.it.test.ts',
    'apps/api/test/telemetry-db-sec85r2.it.test.ts',
    'apps/api/src/platform/telemetry/redaction-sec85.test.ts',
    'apps/api/src/platform/adapters/local-dev.security.test.ts',
    'apps/web/src/space/acc08b-space-security.test.tsx',
    'apps/api/test/Isolation.it.test.ts',
    'apps/api/test/isolation.it.spec.ts',
    'apps/api/test/__snapshots__/isolation.it.test.ts.snap',
  ]) {
    assert.equal(forbiddenPathReason(p), 'security test', p);
  }
});

test('reviewer patches: a security test without `.it` is closed like one with it (owner, item 2а)', () => {
  for (const p of [
    'apps/api/test/sec292-wallet-usage-wiring.test.ts',
    'apps/api/test/sec292-wallet-usage-wiring.it.test.ts',
    'apps/web/src/vault/security-copy.test.tsx',
  ]) {
    assert.equal(forbiddenPathReason(p), 'security test', p);
  }
});

test('reviewer patches: security tests by content are closed by name (owner, item 3а)', () => {
  for (const p of [
    'apps/api/test/guard.it.test.ts',
    'apps/api/test/bypass.it.test.ts',
    'apps/api/test/no-network.test.ts',
    'apps/api/test/no-network-loaded.test.ts',
    'apps/api/test/adr0013-append-only.it.test.ts',
    'apps/api/test/guard-coverage.it.test.ts',
    'apps/api/test/guard-gates.it.test.ts',
    'apps/api/test/leak-check-guard.test.ts',
    'apps/api/test/leak-text.test.ts',
    'apps/api/src/platform/telemetry/redaction.test.ts',
    'apps/api/test/__snapshots__/guard.it.test.ts.snap',
    'apps/api/test/Guard.it.test.ts',
  ]) {
    assert.equal(forbiddenPathReason(p), 'security test', p);
  }
  // Each listed name is a real tracked file, so the list does not go stale unnoticed.
  const root = new URL('../../../', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 }).toString().split('\0');
  for (const n of ['bypass.it.test.ts', 'no-network.test.ts', 'no-network-loaded.test.ts', 'adr0013-append-only.it.test.ts', 'guard.it.test.ts', 'guard-coverage.it.test.ts', 'guard-gates.it.test.ts', 'leak-check-guard.test.ts', 'leak-text.test.ts', 'redaction.test.ts']) {
    assert.ok(files.some((f) => f.endsWith('/' + n)), n);
  }
  // A similar name is not listed: the rule is by name, not by prefix.
  assert.equal(forbiddenPathReason('apps/api/test/guardian-list.test.ts'), null);
  assert.equal(forbiddenPathReason('apps/api/test/leak-report.test.ts'), null);
});

test('reviewer patches: a bare `sec` part also names a security test', () => {
  for (const p of ['apps/web/src/transactions/calc.sec.test.ts', 'apps/api/test/bud14-rules-sec.it.test.ts', 'apps/api/test/pr235-sec.it.test.ts']) {
    assert.equal(forbiddenPathReason(p), 'security test', p);
  }
  assert.equal(forbiddenPathReason('apps/api/test/second-page.test.ts'), null);
});

test('reviewer patches: a retitled test pairs only within its file; a moved non-literal title is a removal', () => {
  const two = [
    '--- a/a.test.ts', '+++ b/a.test.ts', '@@ -1,1 +1,0 @@', "-  it('denies', () => denied(app));",
    '--- a/helpers.ts', '+++ b/helpers.ts', '@@ -1,0 +1,1 @@', "+  it('x', () => denied(app));",
  ].join('\n');
  assert.equal(reviewerPatchViolations([{ filename: 'a.test.ts' }, { filename: 'helpers.ts' }], two).length, 1);
  assert.equal(check('-  it(name, () => {', '+  it(name, () => {').length, 1);
});

test('reviewer patches: e2e tests stay open whatever their name (owner, item 1а)', () => {
  assert.equal(forbiddenPathReason('apps/web/e2e/auth.spec.ts'), null);
  assert.equal(forbiddenPathReason('apps/web/e2e/isolation.spec.ts'), null);
  assert.equal(forbiddenPathReason('apps/web/e2e/sec123-rate-limit.spec.ts'), null);
});

test('reviewer patches: no real security-named test of the repository is open', () => {
  const root = new URL('../../../', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 }).toString().split('\0');
  const open = files.filter(
    (p) => /\.test\.[cm]?[jt]sx?$/.test(p) && /(^|[-._/])(security|sec\d+\w*)[-._]/.test(p) && forbiddenPathReason(p) === null,
  );
  assert.deepEqual(open, []);
});

test('reviewer patches: a rule file is closed in any folder, any letter case and any spelling of the path', () => {
  for (const p of [
    'agents.md',
    'Claude.md',
    './AGENTS.md',
    'docs/../AGENTS.md',
    'docs/../.claude/skills/x/SKILL.md',
    '.claude',
    '.Claude/settings.md',
    'CLAUDE.local.md',
    'apps/api/CLAUDE.md',
    'apps/web/AGENTS.md',
    'apps/api/.claude/commands/x.md',
  ]) {
    assert.equal(forbiddenPathReason(p), 'rule file', p);
  }
  assert.equal(forbiddenPathReason('docs/agents.md.txt'), null);
  assert.equal(forbiddenPathReason('docs/claude-notes.md'), null);
});

test('reviewer patches: a sensitive path is closed in any spelling, a path outside the repository too', () => {
  assert.equal(forbiddenPathReason('./tools/pr-rules/lib/paths.mjs'), 'sensitive path');
  assert.equal(forbiddenPathReason('docs/../tools/pr-rules/lib/paths.mjs'), 'sensitive path');
  assert.equal(forbiddenPathReason('Tools/PR-Rules/lib/paths.mjs'), 'sensitive path');
  assert.equal(forbiddenPathReason('../other/AGENTS.md'), 'path outside the repository');
  assert.equal(forbiddenPathReason('/etc/passwd'), 'path outside the repository');
});

test('reviewer patches: a renamed file is checked by its old name too', () => {
  const v = reviewerPatchViolations([{ filename: 'apps/web/a.ts', previous_filename: 'AGENTS.md' }]);
  assert.deepEqual(v, ['AGENTS.md: rule file']);
});

test('reviewer patches: a deleted test file is a violation', () => {
  const v = reviewerPatchViolations([{ filename: 'apps/web/src/x.test.ts', status: 'removed' }]);
  assert.deepEqual(v, ['removed test file: apps/web/src/x.test.ts']);
  assert.deepEqual(reviewerPatchViolations([{ filename: 'docs/old.md', status: 'removed' }]), []);
});

test('reviewer patches: skip, only, todo, removed tests and directive comments are violations', () => {
  const v = check(
    "-  it('keeps the total', () => {",
    "+  it.skip('keeps the total', () => {",
    "+  describe.only('a', () => {});",
    '+  // eslint-disable-next-line no-console',
    '+  // @ts-expect-error nope',
    '+  const k = "x"; // gitleaks:allow',
    "+  it.todo('later');",
  );
  assert.deepEqual(v, [
    "removed or changed test: it('keeps the total', () => {",
    "added skip/only/todo: it.skip('keeps the total', () => {",
    "added skip/only/todo: describe.only('a', () => {});",
    'added directive comment: // eslint-disable-next-line no-console',
    'added directive comment: // @ts-expect-error nope',
    'added directive comment: const k = "x"; // gitleaks:allow',
    "added skip/only/todo: it.todo('later');",
  ]);
});

test('reviewer patches: a changed test title is a text patch, not a removed test', () => {
  assert.deepEqual(check("-  it('old title', () => {", "+  it('new title', () => {"), []);
  assert.equal(check("-  it('old title', () => {", "+  it('new title', async () => {").length, 1);
  // One new title covers one removed call, not several.
  assert.equal(check("-  it('a', () => {", "-  it('b', () => {", "-  it('c', () => {", "+  it('z', () => {").length, 2);
  // Only the title: not the cases of `.each`, not a `${…}` title, not another string on the line, not an assertion.
  assert.equal(check("-  it.each(['owner'])('t %s', (r) => {", "+  it.each(['x'])('t %s', (r) => {").length, 1);
  assert.equal(check('-  it(`a ${x}`, () => {', '+  it(`b ${y}`, () => {').length, 1);
  assert.equal(check("-  it('a', () => run('admin'));", "+  it('a', () => run('guest'));").length, 1);
  assert.equal(check("-test(name, () => { run('a') })", "+test(name, () => { run('b') })").length, 1);
  assert.equal(check("-  expect(code).toBe('NOT_FOUND');", "+  expect(code).toBe('OK');").length, 1);
});

test('reviewer patches: every way to switch a test off is a violation, one by one', () => {
  for (const line of [
    "it.skip('a', () => {",
    "test.only('a', () => {",
    "it.todo('a');",
    "it.fails('a', () => {",
    "describe.skip('a', () => {",
    "it.concurrent.skip('a', () => {",
    "test.skipIf(true)('a', () => {",
    "it.runIf(false)('a', () => {",
    "it['skip']('a', () => {",
    ".skip('a', () => {", // `describe` on the line above
    "xit('a', () => {",
    "xdescribe('a', () => {",
    "xtest('a', () => {",
    "fit('a', () => {",
    "fdescribe('a', () => {",
    "test.fixme('a', async () => {",
    'test.fail();',
    "test.describe.fixme('a', () => {",
    'ctx.skip();',
    "t.skip('not now');",
  ]) {
    const v = check(`+  ${line}`);
    assert.equal(v.length, 1, line);
    assert.ok(v[0].startsWith('added skip/only/todo'), line);
  }
  assert.deepEqual(check("+  it('benefit(x) and assert.fail stay fine', () => assert.fail('boom'));"), []);
});

test('reviewer patches: every directive of security-review §0 is a violation, one by one', () => {
  for (const line of [
    '// eslint-disable-next-line no-console',
    '/* eslint-enable */',
    '/* eslint no-console: 0 */',
    '/* global window */',
    '// @ts-ignore',
    '// @ts-expect-error',
    '// @ts-nocheck',
    '// @vitest-environment node',
    '/** @jest-environment jsdom */',
    '// prettier-ignore',
    '<!-- prettier-ignore -->',
    'const k = 1; // gitleaks:allow',
    '// GITLEAKS:ALLOW',
    '/* istanbul ignore next */',
    '/* c8 ignore start */',
    '/* v8 ignore next 3 */',
  ]) {
    const v = check(`+${line}`);
    assert.deepEqual(v, [`added directive comment: ${line}`]);
  }
  // Only an added line counts: the same directive on a context or removed line is no violation.
  assert.deepEqual(check(' // @ts-expect-error old', '+const a = 1;'), []);
  assert.deepEqual(check('-// @ts-expect-error old'), []);
});

test('reviewer patches: a removed test, suite or assertion is a violation', () => {
  for (const [line, kind] of [
    ["it('a', () => {", 'test'],
    ["test('a', () => {", 'test'],
    ["it.each(cases)('a %s', (c) => {", 'test'],
    ["describe('guards', () => {", 'test'],
    ["test.describe('guards', () => {", 'test'],
    ['expect(res.status).toBe(404);', 'assertion'],
    ['await expect(page).toHaveURL(url);', 'assertion'],
    ['expect.soft(x).toBe(1);', 'assertion'],
    ['assert.equal(a, b);', 'assertion'],
    ['assert(ok);', 'assertion'],
  ]) {
    assert.deepEqual(check(`-    ${line}`), [`removed or changed ${kind}: ${line}`]);
  }
});

test('reviewer patches: content that looks like a diff header is still checked', () => {
  // A removed line `-- it(…` and an added line `++n; it.only(…` render as `--- …` and `+++ …`.
  const v = check("--- it('sql-style', () => {", "+++n; it.only('a', () => {});");
  assert.equal(v.length, 1);
  assert.ok(v[0].startsWith('added skip/only/todo'));
  const second = [
    'diff --git a/a.test.ts b/a.test.ts',
    'index 1..2 100644',
    '--- a/a.test.ts',
    '+++ b/a.test.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/b.test.ts b/b.test.ts',
    '--- a/b.test.ts',
    '+++ b/b.test.ts',
    '@@ -3,2 +3,2 @@ describe.skip in the hunk title is context',
    ' keep',
    "-  it('x', () => {",
    "+  it.only('x', () => {",
  ].join('\r\n');
  assert.equal(reviewerPatchViolations([{ filename: 'apps/web/src/a.test.ts' }], second).length, 2);
});

test('reviewer patches: a diff that cannot be read is a violation, not a pass', () => {
  const v = reviewerPatchViolations([{ filename: 'apps/web/src/x.test.ts' }], "+  it.skip('a', () => {");
  assert.equal(v.length, 1);
  assert.ok(v[0].startsWith('diff line outside a hunk'));
  assert.deepEqual(reviewerPatchViolations([{ filename: 'docs/x.md' }], undefined), []);
  assert.deepEqual(reviewerPatchViolations([{ filename: 'docs/x.md' }], ''), []);
});

test('reviewer patches: a text-only change is clean', () => {
  const diff = '--- a/a.tsx\n+++ b/a.tsx\n@@ -1 +1,2 @@\n-  <h1>Old</h1>\n+  <h1>New</h1>\n+  // plain comment about it(x)\n';
  assert.deepEqual(reviewerPatchViolations([{ filename: 'apps/web/src/a.tsx' }], diff), []);
});
