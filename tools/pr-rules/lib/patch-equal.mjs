// Owner trial 2026-11-28 (docs/decisions/log/2026-11-28-owner-token-savings-trial-rules.md): a fix that equals the
// reviewers' patches verbatim needs no confirmation agent. This module compares what `git diff <old> <new>` changed
// with what the patch files change, per file and per position in the old file, ignoring context lines, `index`
// lines and hunk order. Mode changes, new, deleted, empty and binary files count as changes (security review #774).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DIFF_GIT = /^diff --git (.*)$/;

/** `a/X b/X` → `X`; anything else (quoted or renamed) stays raw, so it can only differ, never match by accident. */
function headerName(rest) {
  const m = /^a\/(.*) b\/(.*)$/.exec(rest);
  return m && m[1] === m[2] ? m[1] : rest;
}

/**
 * Parse a unified diff into Map<file, string[]>: one item per run of changed lines, `@<old line>\n` + the lines
 * (`\n`-joined), plus `meta:` items for mode, new, deleted, binary, rename and copy headers.
 */
export function parseHunks(text) {
  const files = new Map();
  const lines = text.split('\n');
  let file = null;
  let oldName = null;
  let cur = null; // the run of changed lines being filled
  let runStart = 0; // old line number where the run starts
  let hasDel = false;
  let next = 0; // the next old line number
  let rem = null; // remaining [old, new] lines of the @@ header
  let last = null; // [file, index] of the last stored run
  let prevChange = false;
  const entry = (f) => { if (!files.has(f)) files.set(f, []); return files.get(f); };
  const meta = (m) => { if (file === null) return; const e = entry(file); if (!e.includes(`meta:${m}`)) e.push(`meta:${m}`); };
  const flush = () => {
    if (cur && cur.length) {
      const e = entry(file);
      e.push(`@${hasDel ? runStart : runStart - 1}\n${cur.join('\n')}`);
      last = [file, e.length - 1];
    }
    cur = null;
  };
  for (const line of lines) {
    if (rem && (rem[0] > 0 || rem[1] > 0) && !line.startsWith('\\')) {
      const c = line[0];
      if (c === '-' || c === '+') {
        if (!cur) { cur = []; runStart = next; hasDel = false; }
        cur.push(line);
        if (c === '-') { rem[0]--; next++; hasDel = true; } else rem[1]--;
        prevChange = true;
      } else {
        flush();
        if (c === ' ' || line === '') { rem[0]--; rem[1]--; next++; }
        prevChange = false;
      }
      if (rem[0] <= 0 && rem[1] <= 0) flush();
      continue;
    }
    if (line.startsWith('\\')) {
      // `\ No newline at end of file` belongs to the changed line before it.
      if (prevChange) {
        if (cur) cur.push(line);
        else if (last) { const e = files.get(last[0]); e[last[1]] += `\n${line}`; }
      }
      prevChange = false;
      continue;
    }
    prevChange = false;
    rem = null;
    const g = DIFF_GIT.exec(line);
    if (g) { flush(); file = headerName(g[1]); oldName = null; entry(file); continue; }
    if (line.startsWith('--- ')) {
      oldName = line.slice(4).replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const n = line.slice(4).replace(/^b\//, '');
      if (n === '/dev/null') { file = oldName; meta('deleted file'); }
      else { file = n; if (oldName === '/dev/null') meta('new file'); }
      continue;
    }
    let h;
    if ((h = /^(old|new) mode (\d+)$/.exec(line))) { meta(`${h[1]} mode ${h[2]}`); continue; }
    if ((h = /^new file mode (\d+)$/.exec(line))) { meta('new file'); if (h[1] !== '100644') meta(`new mode ${h[1]}`); continue; }
    if (/^deleted file mode \d+$/.test(line)) { meta('deleted file'); continue; }
    if (/^(rename|copy) (from|to) /.test(line) || /^(Binary files |GIT binary patch)/.test(line)) { meta(line); continue; }
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (m) {
      flush();
      rem = [m[2] === undefined ? 1 : Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
      next = rem[0] === 0 ? Number(m[1]) + 1 : Number(m[1]);
    }
  }
  flush();
  for (const [f, e] of files) if (f === null) files.delete(f);
  return files;
}

/** Compare two hunk maps; returns the sorted names of files that differ (empty = equal). */
export function differingFiles(actual, expected) {
  const out = [];
  for (const f of new Set([...actual.keys(), ...expected.keys()])) {
    const a = [...(actual.get(f) ?? [])].sort();
    const b = [...(expected.get(f) ?? [])].sort();
    if (actual.has(f) !== expected.has(f) || a.length !== b.length || a.some((h, i) => h !== b[i])) out.push(f);
  }
  return out.sort();
}

/** `git diff -U0 <old> <new>` against the patch files. Reads only; no network (no lazy fetch), no writes. */
export function patchEqual(oldHead, newHead, patchFiles, { cwd = process.cwd() } = {}) {
  for (const rev of [oldHead, newHead]) if (!/^[0-9A-Za-z][0-9A-Za-z._/^~-]*$/.test(rev)) throw new Error(`not a revision: ${rev}`);
  const diff = execFileSync('git', [
    'diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--text', '--no-renames', '--no-relative',
    '--ignore-submodules=none', '--src-prefix=a/', '--dst-prefix=b/', oldHead, newHead, '--',
  ], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  const expected = new Map();
  for (const p of patchFiles) {
    for (const [f, hs] of parseHunks(readFileSync(p, 'utf8'))) expected.set(f, [...(expected.get(f) ?? []), ...hs]);
  }
  const files = differingFiles(parseHunks(diff), expected);
  return { equal: files.length === 0, files };
}
