// Створено: 2026-11-27 · Оновлено: 2026-11-27
// The two git checks of «The lead confirms a sync itself» (merge checklist), moved here from shell:
// `unchanged|changed` (the PR's full diff before and after the sync) and, for a `sensitive` PR, `ok` or the list
// of failed conditions (mechanical merges, patch-id, overlap, foundation files). Local git only; no GitHub calls.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from './paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const realGit = (cwd) => (args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const lines = (s) => s.split('\n').filter(Boolean);

/** `unchanged` when the PR's full diff (full blob hashes, binary) is the same before and after the sync. */
export function unchanged(git, old, neu, base = 'origin/main') {
  const ob = git(['merge-base', base, old]).trim();
  const nb = git(['merge-base', base, neu]).trim();
  if (!git(['diff', '--name-only', ob, old]).trim()) return 'changed';
  const d = (b, c) => git(['diff', '--full-index', '--binary', b, c]);
  return d(ob, old) === d(nb, neu) ? 'unchanged' : 'changed';
}

/** `ok` or the failed conditions, space separated (`non-merge-commit`, `not-mechanical:<sha>`, `patch-id`, `overlap`, `foundation:<files>`). */
export function sensitiveSync(git, old, neu, { base = 'origin/main', foundationMd } = {}) {
  const ob = git(['merge-base', base, old]).trim();
  const nb = git(['merge-base', base, neu]).trim();
  const bad = [];
  if (git(['rev-list', '--first-parent', '--no-merges', `${old}..${neu}`]).trim()) bad.push('non-merge-commit');
  for (const m of lines(git(['rev-list', '--first-parent', '--merges', `${old}..${neu}`]))) {
    const tree = git(['merge-tree', '--write-tree', `${m}^1`, `${m}^2`]).split('\n')[0];
    if (tree !== git(['rev-parse', `${m}^{tree}`]).trim()) bad.push(`not-mechanical:${m}`);
  }
  const pid = (b, c) => git(['patch-id', '--stable'], git(['diff', b, c])).split(' ')[0].trim();
  const p1 = pid(ob, old);
  if (!p1 || p1 !== pid(nb, neu)) bad.push('patch-id');
  const names = (b, c) => lines(git(['diff', '--no-renames', '--name-only', b, c]));
  const brought = names(ob, nb);
  const mine = new Set(names(ob, old));
  if (brought.some((f) => mine.has(f))) bad.push('overlap');
  const md = foundationMd ?? fs.readFileSync(path.join(ROOT, '.claude/references/merge-rules.md'), 'utf8');
  const res = /```foundation-paths\n([\s\S]*?)```/.exec(md)[1].split('\n').filter(Boolean).map(globToRegExp);
  const found = brought.filter((p) => res.some((r) => r.test(p)));
  if (found.length) bad.push(`foundation:${found.join(' ')}`);
  return bad.length ? bad.join(' ') : 'ok';
}

/** CLI: `--sync-check <old> <new> [--sensitive]`: fetches `origin/main`, prints the result lines. */
export function syncCheckCli(args, { git = realGit(ROOT), out = (s) => console.log(s) } = {}) {
  const [old, neu] = args.filter((a) => a !== '--sensitive');
  if (!old || !neu) return 2;
  git(['fetch', '-q', 'origin', 'main']);
  const u = unchanged(git, old, neu);
  out(u);
  let ok = u === 'unchanged';
  if (args.includes('--sensitive')) {
    const s = sensitiveSync(git, old, neu);
    out(s);
    ok &&= s === 'ok';
  }
  return ok ? 0 : 1;
}
