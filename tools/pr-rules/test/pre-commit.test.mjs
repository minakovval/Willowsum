// Pre-commit hook (owner, 2026-11-13): Prettier and ESLint on the staged content of the staged files only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check, findTools, preCommit, stagedFrom, targets } from '../lib/pre-commit.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;

test('pre-commit: staged list, Prettier on every file, ESLint only on JS/TS', () => {
  assert.deepEqual(stagedFrom('a.ts\0docs/x.md\0b.mjs\0'), ['a.ts', 'docs/x.md', 'b.mjs']);
  assert.deepEqual(targets(['a.ts', 'docs/x.md', 'b.mjs', 'c.tsx', 'd.json']), { prettier: ['a.ts', 'docs/x.md', 'b.mjs', 'c.tsx', 'd.json'], eslint: ['a.ts', 'b.mjs', 'c.tsx'] });
});

test('pre-commit: checks the staged text, reports unformatted files and lint errors, notes missing tools', () => {
  const staged = (f) => `staged ${f}\n`;
  const calls = [];
  const run = (cmd, args, input) => {
    calls.push([cmd, args.at(-1), input, args]);
    if (cmd === 'prettier') return { status: 0, stdout: args.at(-1) === 'bad.ts' ? 'formatted\n' : args.at(-1) === 'hook' ? '' : input };
    return { status: args.at(-1) === 'bad.ts' ? 1 : 0, stdout: 'bad.ts: 1 error' };
  };
  // `hook` has no parser (Prettier prints nothing with --ignore-unknown): not a problem.
  const r = check({ files: ['ok.ts', 'bad.ts', 'hook'], staged, tools: { prettier: 'prettier', eslint: 'eslint' }, run });
  assert.deepEqual(r.notes, []);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /^not formatted: bad\.ts/);
  assert.match(r.problems[1], /^eslint: bad\.ts/);
  assert.ok(calls.every(([, f, input]) => input === `staged ${f}\n`), 'the staged content is what is checked');
  assert.ok(calls.filter(([cmd]) => cmd === 'prettier').every(([, , , args]) => args.includes('--ignore-unknown')));
  const none = check({ files: ['a.ts'], staged, tools: { prettier: null, eslint: null }, run });
  assert.deepEqual(none.problems, []);
  assert.equal(none.notes.length, 2);
});

test('pre-commit: tools come from the worktree, Prettier also from the main checkout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-tools-'));
  const main = path.join(dir, 'main');
  const wt = path.join(dir, 'wt');
  fs.mkdirSync(path.join(main, 'node_modules/.bin'), { recursive: true });
  fs.mkdirSync(wt);
  for (const n of ['prettier', 'eslint']) fs.writeFileSync(path.join(main, 'node_modules/.bin', n), '');
  assert.deepEqual(findTools(wt, main), { prettier: path.join(main, 'node_modules/.bin/prettier'), eslint: null });
  assert.deepEqual(findTools(main, null), { prettier: path.join(main, 'node_modules/.bin/prettier'), eslint: path.join(main, 'node_modules/.bin/eslint') });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pre-commit: end to end in a git repository — the staged version decides, not the working copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-repo-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  // A stand-in for Prettier: a file is «formatted» when it does not contain the word UGLY.
  fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  const fake = path.join(root, 'node_modules/.bin/prettier');
  fs.writeFileSync(fake, `#!${process.execPath}\nlet s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.replace(/UGLY/g,'nice')));\n`);
  fs.chmodSync(fake, 0o755);
  fs.writeFileSync(path.join(root, 'a.md'), 'UGLY\n');
  git('add', 'a.md');
  fs.writeFileSync(path.join(root, 'a.md'), 'nice\n'); // fixed only in the working copy
  const logs = [];
  assert.equal(preCommit(root, (l) => logs.push(l)), 1);
  assert.match(logs.join('\n'), /not formatted: a\.md/);
  git('add', 'a.md');
  assert.equal(preCommit(root, () => {}), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('pre-commit: the hook is installed by `prepare` through a relative core.hooksPath (works in every worktree)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prepare, 'git config core.hooksPath .githooks || true');
  const hook = fs.readFileSync(path.join(ROOT, '.githooks/pre-commit'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh\n/);
  assert.match(hook, /^exec node tools\/pr-rules\/index\.mjs pre-commit$/m);
  assert.ok(fs.statSync(path.join(ROOT, '.githooks/pre-commit')).mode & 0o111, 'executable');
});
