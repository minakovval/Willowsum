// Security review #774: patch-equal must print `differs` for any change beyond the patch files.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { differingFiles } from '../lib/patch-equal.mjs';

const CLI = new URL('../patch-equal.mjs', import.meta.url).pathname;
const BASE = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
const FIXED = BASE.replace('two\n', 'TWO\n');
const PATCH = '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'patch-equal-sec-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  const write = (n, s) => writeFileSync(path.join(dir, n), s);
  write('a.txt', BASE);
  write('run.sh', 'echo hi\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fix'); return git('rev-parse', 'HEAD').trim(); };
  return { dir, git, write, commit, base: git('rev-parse', 'HEAD').trim(), patch: path.join(dir, '.git', 'p.patch') };
}
const run = (r, ...args) => spawnSync('node', [CLI, ...args], { cwd: r.dir, encoding: 'utf8' });
function check(name, change, patch = PATCH) {
  test(`patch-equal (security #774): ${name} prints differs`, () => {
    const r = repo();
    try {
      change(r);
      const head = r.commit();
      writeFileSync(r.patch, patch);
      const out = run(r, r.base, head, r.patch);
      assert.equal(out.stdout.split('\n')[0], 'differs');
      assert.equal(out.status, 1);
    } finally { rmSync(r.dir, { recursive: true, force: true }); }
  });
}

check('a mode change beyond the patch', (r) => { r.write('a.txt', FIXED); chmodSync(path.join(r.dir, 'run.sh'), 0o755); });
check('a binary file beyond the patch', (r) => { r.write('a.txt', FIXED); r.write('x.bin', Buffer.from([0, 1, 0, 2])); });
check('a pure rename beyond the patch', (r) => { r.write('a.txt', FIXED); r.git('mv', 'run.sh', 'run2.sh'); });
check('an empty new file beyond the patch', (r) => { r.write('a.txt', FIXED); r.write('empty', ''); });
check('the patched line at another place', (r) => { r.write('a.txt', BASE.replace('seven\n', 'seven\nguard()\n')); },
  '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n one\n+guard()\n two\n');
check('CRLF where the patch has LF', (r) => { r.write('a.txt', BASE.replace('two\n', 'TWO\r\n')); });
check('a missing newline at the end where the patch has one', (r) => { r.write('a.txt', BASE + 'nine'); },
  '--- a/a.txt\n+++ b/a.txt\n@@ -8 +8,2 @@\n eight\n+nine\n');

test('patch-equal (security #774): a change hidden by a -diff attribute already in the old head prints differs', () => {
  const r = repo();
  try {
    r.write('.gitattributes', '*.sh -diff\n'); const old = r.commit();
    r.write('a.txt', FIXED); r.write('run.sh', 'echo changed\n'); const head = r.commit();
    writeFileSync(r.patch, PATCH);
    assert.equal(run(r, old, head, r.patch).stdout.split('\n')[0], 'differs');
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('patch-equal (security #774): an option in place of a head is refused and nothing is written', () => {
  const r = repo();
  try {
    writeFileSync(r.patch, PATCH);
    const target = path.join(r.dir, '.git', 'written');
    const out = run(r, `--output=${target}`, r.base, r.patch);
    assert.equal(out.status, 2);
    assert.equal(existsSync(target), false);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('patch-equal (security #774): patches made by git diff for new, deleted, executable, mode and no-newline changes print equal', () => {
  const r = repo();
  try {
    r.write('a.txt', BASE.replace('two\n', 'TWO\n').replace('seven\n', 'seven\nadded\n') + 'last');
    r.write('tool.sh', 'echo tool\n'); chmodSync(path.join(r.dir, 'tool.sh'), 0o755);
    r.write('empty', '');
    chmodSync(path.join(r.dir, 'run.sh'), 0o755);
    const head = r.commit();
    // Two reviewers' patches against the old head: one for a.txt, one for the rest.
    writeFileSync(r.patch, r.git('diff', r.base, head, '--', 'a.txt'));
    const second = r.patch + '2';
    writeFileSync(second, r.git('diff', r.base, head, '--', 'tool.sh', 'empty', 'run.sh'));
    const out = run(r, r.base, head, r.patch, second);
    assert.equal(out.stdout.trim(), 'equal');
    r.git('rm', '-q', 'run.sh'); const del = r.commit();
    writeFileSync(second, r.git('diff', head, del));
    assert.equal(run(r, head, del, second).stdout.trim(), 'equal');
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('differingFiles (security #774): a file present on one side only differs even with no hunks', () => {
  assert.deepEqual(differingFiles(new Map([['f', []]]), new Map()), ['f']);
});

check('a mode change on a patched file', (r) => { r.write('a.txt', FIXED); chmodSync(path.join(r.dir, 'a.txt'), 0o755); });
check('only part of the patch applied', (r) => { r.write('a.txt', FIXED); },
  PATCH + '@@ -6,3 +6,3 @@\n six\n-seven\n+SEVEN\n eight\n');

test('patch-equal (security #774): a binary file other than the one in the binary patch prints differs', () => {
  const r = repo();
  try {
    r.write('x.bin', Buffer.from([0, 1, 0, 2])); const wanted = r.commit();
    writeFileSync(r.patch, r.git('diff', '--binary', r.base, wanted));
    r.git('reset', '-q', '--hard', r.base);
    r.write('x.bin', Buffer.from([0, 9, 0, 9])); const head = r.commit();
    assert.equal(run(r, r.base, head, r.patch).stdout.split('\n')[0], 'differs');
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});
