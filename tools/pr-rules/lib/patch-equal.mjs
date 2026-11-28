// Owner trial 2026-11-28 (docs/decisions/log/2026-11-28-owner-token-savings-trial-rules.md): a fix that equals the
// reviewers' patches verbatim needs no confirmation agent. This module compares what `git diff <old> <new>` changed
// with what the patch files change, per file, ignoring context lines, line numbers, `index` lines and hunk order.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Parse a unified diff into Map<file, string[]>: each item is one hunk body (changed lines only, `\n`-joined). */
export function parseHunks(text) {
  const files = new Map();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let file = null;
  let oldName = null;
  let cur = null; // the hunk being filled
  let rem = null; // remaining [old, new] lines of the @@ header
  const flush = () => {
    if (cur && cur.length) {
      if (!files.has(file)) files.set(file, []);
      files.get(file).push(cur.join('\n'));
    }
    cur = null;
  };
  for (const line of lines) {
    if (rem && (rem[0] > 0 || rem[1] > 0) && !line.startsWith('\\')) {
      const c = line[0];
      if (c === '-') rem[0]--;
      else if (c === '+') rem[1]--;
      else if (c === ' ' || line === '') { rem[0]--; rem[1]--; }
      if (c === '-' || c === '+') (cur ??= []).push(line);
      else flush();
      if (rem[0] <= 0 && rem[1] <= 0) flush();
      continue;
    }
    if (line.startsWith('\\')) continue;
    rem = null;
    if (line.startsWith('diff --git ')) { flush(); file = null; oldName = null; continue; }
    if (line.startsWith('--- ')) { oldName = line.slice(4).replace(/^a\//, ''); continue; }
    if (line.startsWith('+++ ')) {
      const n = line.slice(4).replace(/^b\//, '');
      file = n === '/dev/null' ? oldName : n;
      continue;
    }
    const m = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (m) {
      flush();
      rem = [m[1] === undefined ? 1 : Number(m[1]), m[2] === undefined ? 1 : Number(m[2])];
    }
  }
  flush();
  return files;
}

/** Compare two hunk maps; returns the sorted names of files that differ (empty = equal). */
export function differingFiles(actual, expected) {
  const out = [];
  for (const f of new Set([...actual.keys(), ...expected.keys()])) {
    const a = [...(actual.get(f) ?? [])].sort();
    const b = [...(expected.get(f) ?? [])].sort();
    if (a.length !== b.length || a.some((h, i) => h !== b[i])) out.push(f);
  }
  return out.sort();
}

/** `git diff -U0 <old> <new>` against the patch files. */
export function patchEqual(oldHead, newHead, patchFiles, { cwd = process.cwd() } = {}) {
  const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', oldHead, newHead], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const expected = new Map();
  for (const p of patchFiles) {
    for (const [f, hs] of parseHunks(readFileSync(p, 'utf8'))) expected.set(f, [...(expected.get(f) ?? []), ...hs]);
  }
  const files = differingFiles(parseHunks(diff), expected);
  return { equal: files.length === 0, files };
}
