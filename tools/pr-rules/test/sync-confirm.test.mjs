// Створено: 2026-11-27 · Оновлено: 2026-11-27
// The sync-confirmation git checks of the merge checklist, on a throwaway repository (branch `main` is the base).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sensitiveSync, unchanged } from '../lib/sync-confirm.mjs';

const FOUNDATION = '```foundation-paths\nfoundation/**\n```\n';

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-confirm-'));
  const git = (args, input) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, input, encoding: 'utf8' });
  const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
  const commit = (msg) => { git(['add', '-A']); git(['commit', '-q', '-m', msg]); return git(['rev-parse', 'HEAD']).trim(); };
  git(['init', '-q', '-b', 'main']);
  write('f.txt', '1\n2\n3\n4\n5\n6\n7\n8\n9\n');
  write('g.txt', 'g\n');
  commit('base');
  git(['checkout', '-q', '-b', 'pr']);
  write('a.txt', 'a\n');
  const old = commit('pr');
  git(['checkout', '-q', 'main']);
  return { dir, git, write, commit, old };
}
const sync = (r) => { r.git(['checkout', '-q', 'pr']); r.git(['merge', '-q', '--no-ff', '-m', 'sync', 'main']); return r.git(['rev-parse', 'HEAD']).trim(); };
const opts = { foundationMd: FOUNDATION };

test('main changed an unrelated file: unchanged and ok', () => {
  const r = repo();
  r.write('h.txt', 'h\n'); r.commit('main moves');
  const neu = sync(r);
  assert.equal(unchanged(r.git, r.old, neu, 'main'), 'unchanged');
  assert.equal(sensitiveSync(r.git, r.old, neu, { base: 'main', ...opts }), 'ok');
});

test('main touched a file the PR also changed: changed, overlap', () => {
  const r = repo();
  r.git(['checkout', '-q', 'pr']);
  r.write('f.txt', 'one\n2\n3\n4\n5\n6\n7\n8\n9\n');
  const old = r.commit('pr edits f');
  r.git(['checkout', '-q', 'main']);
  r.write('f.txt', '1\n2\n3\n4\n5\n6\n7\n8\nnine\n'); r.commit('main edits f');
  const neu = sync(r);
  assert.equal(unchanged(r.git, old, neu, 'main'), 'changed');
  assert.match(sensitiveSync(r.git, old, neu, { base: 'main', ...opts }), /overlap/);
});

test('a non-merge commit after the reviewed head, and a foundation file from main', () => {
  const r = repo();
  r.write('foundation/x.ts', 'x\n'); r.commit('main foundation');
  r.git(['checkout', '-q', 'pr']); r.git(['merge', '-q', '--no-ff', '-m', 'sync', 'main']);
  r.write('extra.txt', 'e\n');
  const neu = r.commit('author commit');
  const res = sensitiveSync(r.git, r.old, neu, { base: 'main', ...opts });
  assert.match(res, /non-merge-commit/);
  assert.match(res, /foundation:foundation\/x.ts/);
});

test('a PR with no diff against its base is never «unchanged»', () => {
  const r = repo();
  assert.equal(unchanged(r.git, 'main', 'main', 'main'), 'changed');
});
