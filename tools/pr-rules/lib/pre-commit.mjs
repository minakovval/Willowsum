// Pre-commit check (owner, 2026-11-13): Prettier and ESLint on the STAGED content of the staged files only, with
// the repository's own toolchain (node_modules/.bin), no extra dependency. Installed by `pnpm install` through the
// root `prepare` script (`git config core.hooksPath .githooks`); the relative path makes every worktree run its
// own checked-out hook. Skip once with `git commit --no-verify` only when the lead agrees.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LINTED = /\.(?:[cm]?[jt]sx?)$/;

/** Parse `git diff --cached --name-only --diff-filter=ACMR -z`: files whose staged content exists. */
export const stagedFrom = (text) => text.split('\0').filter(Boolean);

/** Which staged files go to Prettier (all; it skips ignored and unknown types) and which to ESLint. */
export function targets(files) {
  return { prettier: files, eslint: files.filter((f) => LINTED.test(f)) };
}

/**
 * The tool binaries: this worktree's node_modules first; Prettier also from the main checkout (an agent's
 * worktree often has no install). ESLint loads plugins next to the config, so it runs only with this worktree's
 * own install.
 */
export function findTools(root, commonRoot) {
  const bin = (dir, name) => {
    const p = path.join(dir, 'node_modules', '.bin', name);
    return fs.existsSync(p) ? p : null;
  };
  return {
    prettier: bin(root, 'prettier') ?? (commonRoot ? bin(commonRoot, 'prettier') : null),
    eslint: bin(root, 'eslint'),
  };
}

/**
 * Check the staged content. `run(cmd, args, input)` returns { status, stdout, stderr } (injected in tests).
 * @returns {{ problems: string[], notes: string[] }}
 */
export function check({ files, staged, tools, run }) {
  const problems = [];
  const notes = [];
  const t = targets(files);
  if (!tools.prettier) notes.push('Prettier not installed (run pnpm install): formatting not checked.');
  else {
    for (const f of t.prettier) {
      const input = staged(f);
      // --ignore-unknown: a file type Prettier has no parser for prints nothing and is not checked.
      const r = run(tools.prettier, ['--ignore-unknown', '--stdin-filepath', f], input);
      if (r.status !== 0) problems.push(`prettier could not read ${f}: ${String(r.stderr).trim().split('\n')[0]}`);
      else if (r.stdout === '' && input !== '') continue;
      else if (r.stdout !== input) problems.push(`not formatted: ${f} (fix: pnpm exec prettier --write ${f}, then git add it)`);
    }
  }
  if (t.eslint.length && !tools.eslint) notes.push('ESLint not installed in this worktree (run pnpm install): lint not checked.');
  else {
    for (const f of t.eslint) {
      const r = run(tools.eslint, ['--no-warn-ignored', '--stdin', '--stdin-filename', f], staged(f));
      if (r.status !== 0) problems.push(`eslint: ${f}\n${String(r.stdout || r.stderr).trim()}`);
    }
  }
  return { problems, notes };
}

/** Run in a repository root; returns the exit code. */
export function preCommit(root, log = console.log) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = stagedFrom(git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'));
  if (!files.length) return 0;
  const common = path.resolve(root, git('rev-parse', '--git-common-dir').trim());
  const tools = findTools(root, path.dirname(common));
  const { problems, notes } = check({
    files,
    tools,
    staged: (f) => git('show', `:${f}`),
    run: (cmd, args, input) => spawnSync(cmd, args, { cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  });
  for (const n of notes) log(`pre-commit: ${n}`);
  for (const p of problems) log(`pre-commit: ${p}`);
  if (problems.length) log(`pre-commit: ${problems.length} problem(s) in staged files; commit refused.`);
  return problems.length ? 1 : 0;
}
