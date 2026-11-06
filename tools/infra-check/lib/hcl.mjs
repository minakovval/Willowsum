// Just enough HCL reading for the static rules: list the top-level blocks of the .tf files with their
// bodies. Strings (with ${…} inside) and # / // comments are skipped when matching braces.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const START_DIR = path.join(REPO_ROOT, 'infra/start');

/** Index of the brace that closes the one at `open`. */
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === '\\') i += 1;
    } else if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced braces');
}

/** Top-level blocks: { kind, labels, body, file }. */
export function blocks(text, file = '') {
  const out = [];
  const re = /^([a-z_]+)((?:\s+"[^"]*")*)\s*\{/gm;
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(text, open);
    const labels = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    out.push({ kind: m[1], labels, body: text.slice(open + 1, close), file });
    re.lastIndex = close + 1;
  }
  return out;
}

export function tfFiles(dir = START_DIR) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.tf'))
    .sort()
    .map((n) => ({ name: n, text: fs.readFileSync(path.join(dir, n), 'utf8') }));
}

export function allBlocks(dir = START_DIR) {
  return tfFiles(dir).flatMap((f) => blocks(f.text, f.name));
}

export function resources(type, dir = START_DIR) {
  return allBlocks(dir).filter((b) => b.kind === 'resource' && b.labels[0] === type);
}

/** Parses a .tfvars file of simple `key = "value"` / `key = number` lines. */
export function tfvars(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([a-z_]+)\s*=\s*(?:"([^"]*)"|([0-9.]+))\s*$/.exec(line);
    if (m) values[m[1]] = m[2] ?? Number(m[3]);
  }
  return values;
}

/** Text without comments, for checks that must not be fooled by an explanation. */
export function code(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}
