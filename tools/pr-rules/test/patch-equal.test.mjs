import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { differingFiles, parseHunks } from '../lib/patch-equal.mjs';

const CLI = new URL('../patch-equal.mjs', import.meta.url).pathname;

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'patch-equal-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(path.join(dir, 'a.txt'), ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].join('\n') + '\n');
  writeFileSync(path.join(dir, 'b.txt'), 'x\ny\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  return { dir, git, base, write: (n, s) => writeFileSync(path.join(dir, n), s) };
}
const run = (dir, ...args) => spawnSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8' });

test('patch-equal: a fix equal to the patches (context and line numbers differ) prints equal', () => {
  const r = repo();
  try {
    r.write('a.txt', ['one', 'TWO', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'TEN'].join('\n') + '\n');
    r.write('b.txt', 'x\ny\nz\n');
    r.git('commit', '-qam', 'fix');
    const head = r.git('rev-parse', 'HEAD').trim();
    // Patch A has context and shifted numbers; patch B is split in the other order than the diff.
    r.write('p1.patch', 'diff --git a/b.txt b/b.txt\nindex 1..2 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1,2 +1,3 @@\n x\n y\n+z\n');
    r.write('p2.patch', '--- a/a.txt\n+++ b/a.txt\n@@ -9,2 +9,2 @@\n nine\n-ten\n+TEN\n');
    r.write('p3.patch', '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n');
    const out = run(r.dir, r.base, head, 'p1.patch', 'p2.patch', 'p3.patch');
    assert.equal(out.stdout.trim(), 'equal');
    assert.equal(out.status, 0);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('patch-equal: an extra change, a changed line and a missing patch print differs with the file names', () => {
  const r = repo();
  try {
    r.write('a.txt', ['one', 'TWO', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].join('\n') + '\n');
    r.write('b.txt', 'x\nY\n');
    r.git('commit', '-qam', 'fix');
    const head = r.git('rev-parse', 'HEAD').trim();
    r.write('p.patch', '--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-two\n+TWO\n');
    let out = run(r.dir, r.base, head, 'p.patch');
    assert.equal(out.status, 1);
    assert.equal(out.stdout, 'differs\n  b.txt\n');
    r.write('p.patch', '--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-two\n+Two\n');
    r.write('q.patch', '--- a/b.txt\n+++ b/b.txt\n@@ -2 +2 @@\n-y\n+Y\n');
    out = run(r.dir, r.base, head, 'p.patch', 'q.patch');
    assert.equal(out.stdout, 'differs\n  a.txt\n');
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('patch-equal: a patch for a file the fix did not touch differs; a new and a deleted file are named', () => {
  const r = repo();
  try {
    r.write('c.txt', 'new\n');
    r.git('rm', '-q', 'b.txt');
    r.git('add', '.'); r.git('commit', '-qm', 'fix');
    const head = r.git('rev-parse', 'HEAD').trim();
    r.write('p.patch', '--- /dev/null\n+++ b/c.txt\n@@ -0,0 +1 @@\n+new\n--- a/b.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+1\n');
    const out = run(r.dir, r.base, head, 'p.patch');
    assert.equal(out.stdout, 'differs\n  a.txt\n');
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('patch-equal: usage and git errors exit 2', () => {
  assert.equal(run(process.cwd()).status, 2);
  const r = repo();
  try {
    r.write('p.patch', '');
    assert.equal(run(r.dir, 'nope', 'nope2', 'p.patch').status, 2);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('parseHunks: a removed line that starts with dashes is not a header; counts end a hunk', () => {
  const m = parseHunks('--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n--- sql comment\n ctx\n+++ b/g\n');
  assert.deepEqual([...m.keys()], ['f']);
  assert.deepEqual(m.get('f'), ['--- sql comment']);
  assert.deepEqual(differingFiles(m, parseHunks('--- a/f\n+++ b/f\n@@ -1 +0,0 @@\n--- sql comment\n')), []);
});
