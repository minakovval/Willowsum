// Створено: 2026-11-14 · Оновлено: 2026-11-14
// `pnpm typecheck` locally checks exactly what CI checks (owner, 2026-11-14, #178 «pnpm typecheck»; #184): CI runs
// the same root command, and every workspace package's `typecheck` script runs `tsc -p` on each of its tsconfig.json
// files (tests are inside them), so a new package or a second tsconfig cannot slip past the local command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../../../', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkgJson = (dir) => JSON.parse(read(path.join(dir, 'package.json')));

/** Workspace package directories from pnpm-workspace.yaml (`dir/*` or an exact `dir`). */
function workspacePackages() {
  const globs = [...read('pnpm-workspace.yaml').matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  return globs
    .flatMap((g) => {
      if (!g.endsWith('/*')) return [g];
      const base = g.slice(0, -2);
      return fs
        .readdirSync(path.join(ROOT, base), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${base}/${d.name}`);
    })
    .filter((dir) => fs.existsSync(path.join(ROOT, dir, 'package.json')));
}

/** Every tsconfig.json below `dir` (repository-relative), skipping node_modules and dot directories. */
function tsconfigs(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...tsconfigs(rel));
    else if (e.name === 'tsconfig.json') out.push(rel);
  }
  return out;
}

test('#184: the root `typecheck` runs every workspace package’s own `typecheck`', () => {
  assert.equal(pkgJson('.').scripts.typecheck, 'pnpm -r run typecheck');
});

test('#184: every workspace package with a tsconfig.json runs `tsc -p` on each of its tsconfig.json files', () => {
  const packages = workspacePackages();
  assert.ok(packages.includes('apps/api'), 'apps/api is a workspace package');
  for (const dir of packages) {
    const configs = tsconfigs(dir).map((f) => path.posix.relative(dir, f));
    if (configs.length === 0) continue;
    const script = pkgJson(dir).scripts?.typecheck ?? '';
    const ran = [...script.matchAll(/(?:^|&&\s*)tsc -p (\S+)(?=\s*(?:&&|$))/g)].map((m) => m[1]);
    assert.deepEqual(
      [...ran].sort(),
      [...configs].sort(),
      `${dir}/package.json "typecheck" must be \`tsc -p <file>\` for each of ${configs.join(', ')}, joined by &&; it is ${JSON.stringify(script)}`,
    );
  }
});

test('#184: every tsconfig.json in the repository belongs to a workspace package (so `pnpm typecheck` reaches it)', () => {
  const packages = workspacePackages();
  // design/ holds design snapshots, never compiled (AGENTS.md «Where things are»).
  const stray = tsconfigs('').filter((f) => !f.startsWith('design/') && !packages.some((p) => f.startsWith(`${p}/`)));
  assert.deepEqual(stray, []);
});

test('#184: CI type-checks with the same `pnpm typecheck`, never a `tsc` of its own', () => {
  const dir = path.join(ROOT, '.github/workflows');
  const workflows = fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n));
  for (const name of workflows) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(text.replace(/#.*$/gm, ''), /\btsc\b/, `${name} runs tsc directly; use pnpm typecheck`);
  }
  assert.match(read('.github/workflows/pr-checks.yml'), /^\s*- run: pnpm typecheck$/m);
});
