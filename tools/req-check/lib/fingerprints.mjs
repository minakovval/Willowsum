// Requirement text fingerprints (owner decision 2026-11-16, items 6–8; external review §10б proposal 1).
// One file per requirement next to its source, `<ID>.fingerprints.json`, maps an item key («PoC/FR 3») to a hash
// of the item's text at the last time its tests and code were checked against it. `--check-fingerprints` fails
// when an item's text changed and its hash is old; `--update-fingerprints <ID> [items…]` rewrites the hashes after
// that re-check. Format and normalisation: docs/requirements/README.md, «Text fingerprints». Pure functions.
import crypto from 'node:crypto';
import { SLICE_RELEASES, releaseIndex } from './config.mjs';
import { itemsOf } from './items.mjs';
import { itemCoverageKey } from './coverage.mjs';

/** File name of a requirement's fingerprints: `BUD-16.fingerprints.json`. */
export const FINGERPRINT_FILE_RE = /^([A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?)\.fingerprints\.json$/;
export const fingerprintFileName = (id) => `${id}.fingerprints.json`;

const KINDS = ['FR', 'AC', 'EC'];
const RELEASE_ALT = [...SLICE_RELEASES].sort((a, b) => b.length - a.length).map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const KEY_RE = new RegExp(`^(?:(${RELEASE_ALT})/)?(FR|AC|EC) ?(\\d+)$`, 'u');
const HASH_RE = /^[0-9a-f]{16}$/;

/**
 * The text of an item that its hash covers: the item line and its indented continuation lines, without the list
 * marker (`3. `, `- `), in Unicode NFC, with every run of whitespace (line breaks and indentation included) read as
 * one space, trimmed. Release tags never reach it (the views have none) and the number is in the key, not the text.
 * @param {string[]} lines
 */
export function normaliseItem(lines) {
  return lines
    .join('\n')
    .replace(/^\s*(?:\d+\.|[-*+])\s+/u, '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** First 16 hex digits of the SHA-256 of the normalised item text. */
export const hashItem = (lines) => crypto.createHash('sha256').update(normaliseItem(lines), 'utf8').digest('hex').slice(0, 16);

export const itemKey = (release, kind, n) => `${release}/${kind} ${n}`;

/** Parse `PoC v2/AC 3`, `PoC/FR3` or (any release) `EC 2`; null when it is not an item key. */
export function parseItemKey(text) {
  const m = KEY_RE.exec(String(text).trim());
  return m ? { release: m[1] ?? null, kind: m[2], n: Number(m[3]) } : null;
}

/** Order of keys in the file: release (build order), kind (FR, AC, EC), number. */
export function compareKeys(a, b) {
  const x = parseItemKey(a);
  const y = parseItemKey(b);
  return releaseIndex(x.release) - releaseIndex(y.release) || KINDS.indexOf(x.kind) - KINDS.indexOf(y.kind) || x.n - y.n;
}

/** The canonical text of a fingerprints file: sorted keys, one item per line, final newline. */
export function renderFingerprints(entries) {
  const keys = [...entries.keys()].sort(compareKeys);
  if (!keys.length) return '{}\n';
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(entries.get(k))}`).join(',\n')}\n}\n`;
}

/**
 * Parse a fingerprints file.
 * @returns {{entries: Map<string, string>, problems: string[], lineOf: (key: string) => number}}
 */
export function parseFingerprints(text) {
  const entries = new Map();
  const problems = [];
  const lines = text.split('\n');
  const lineOf = (key) => Math.max(1, lines.findIndex((l) => l.includes(JSON.stringify(key))) + 1);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { entries, problems: [`not valid JSON (${e.message})`], lineOf };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { entries, problems: ['must be a JSON object of item key → hash'], lineOf };
  for (const [k, v] of Object.entries(doc)) {
    const key = parseItemKey(k);
    if (!key || !key.release) problems.push(`«${k}» is not an item key (write it as «PoC/FR 3», «PoC v2/AC 1», «MVP/EC 2»)`);
    else if (itemKey(key.release, key.kind, key.n) !== k) problems.push(`«${k}» must be written «${itemKey(key.release, key.kind, key.n)}»`);
    else if (typeof v !== 'string' || !HASH_RE.test(v)) problems.push(`the value of «${k}» must be 16 hex digits (written by --update-fingerprints)`);
    else entries.set(k, v);
  }
  if (!problems.length && renderFingerprints(entries) !== text) problems.push('is not in its canonical form (sorted keys, one item per line); rewrite it with --update-fingerprints');
  return { entries, problems, lineOf };
}

/**
 * The current items of a requirement's explicit release views, by key.
 * @returns {Map<string, {key: string, slice: object, item: object, hash: string, file: string, line: number, coverageKey: string}>}
 */
export function currentItems(feature) {
  const out = new Map();
  for (const s of feature.slices) {
    if (!s.explicit) continue;
    const g = s.doc.generated;
    for (const it of itemsOf(s.doc.lines)) {
      const key = itemKey(s.release, it.kind, it.n);
      out.set(key, {
        key,
        slice: s,
        item: it,
        hash: hashItem(s.doc.lines.slice(it.index, it.end)),
        file: g ? g.sourceRel : s.doc.rel,
        line: (g ? g.lineMap[it.index] : it.index) + 1,
        coverageKey: itemCoverageKey(s, it),
      });
    }
  }
  return out;
}

/** Features that have explicit release views (sources and cards with slice files), by ID. */
export const fingerprintable = (model) => new Map([...model.features.values()].filter((f) => f.slices.some((s) => s.explicit)).map((f) => [f.id, f]));

/**
 * Check the fingerprints files against the current item texts.
 * @param {ReturnType<import('./model.mjs').buildModel>} model
 * @param {{rel: string, id: string, text: string}[]} files  every `<ID>.fingerprints.json` under the requirements dir
 * @param {Map<string, string[]>} covered  coverage key → `file:line` of the tests naming the item (computeCoverage)
 * @param {{require?: boolean}} [opts]  require: an item a test names without an entry is an error
 * @returns {{findings: {file: string, line: number, rule: string, message: string}[], changed: number, missing: number, checked: number}}
 */
export function checkFingerprints(model, files, covered, { require = false } = {}) {
  const features = fingerprintable(model);
  const findings = [];
  let changed = 0;
  let checked = 0;
  const withFile = new Set();
  for (const file of files) {
    const f = features.get(file.id);
    if (!f) {
      findings.push({ file: file.rel, line: 1, rule: 'fingerprint-file', message: `${file.id} has no requirement source with release views; remove ${fingerprintFileName(file.id)} or restore the requirement` });
      continue;
    }
    const want = `${f.doc.rel.slice(0, f.doc.rel.lastIndexOf('/') + 1)}${fingerprintFileName(f.id)}`;
    if (file.rel !== want) {
      findings.push({ file: file.rel, line: 1, rule: 'fingerprint-file', message: `the fingerprints of ${f.id} belong next to its source: ${want}` });
      continue;
    }
    withFile.add(f.id);
    const parsed = parseFingerprints(file.text);
    for (const p of parsed.problems) findings.push({ file: file.rel, line: 1, rule: 'fingerprint-file', message: `${fingerprintFileName(f.id)}: ${p}` });
    if (parsed.problems.length) continue;
    const items = currentItems(f);
    for (const [key, hash] of parsed.entries) {
      const it = items.get(key);
      if (!it) {
        findings.push({ file: file.rel, line: parsed.lineOf(key), rule: 'fingerprint-no-item', message: `${f.id} has a fingerprint for ${key}, which its views no longer have (the item was removed, moved or renumbered): re-check the tests and code of the items that changed, then run node tools/req-check/index.mjs --update-fingerprints ${f.id}` });
        continue;
      }
      checked++;
      if (it.hash === hash) continue;
      changed++;
      findings.push({ file: it.file, line: it.line, rule: 'fingerprint-changed', message: changedMessage(f.id, it, covered) });
    }
  }
  let missing = 0;
  for (const f of features.values()) {
    const entries = withFile.has(f.id) ? parseFingerprints(files.find((x) => x.id === f.id).text).entries : new Map();
    for (const it of currentItems(f).values()) {
      if (entries.has(it.key) || !covered.has(it.coverageKey)) continue;
      missing++;
      if (require) findings.push({ file: it.file, line: it.line, rule: 'fingerprint-missing', message: `${it.slice.sid} ${it.key.split('/')[1]}: named by tests (${covered.get(it.coverageKey).join(', ')}) but has no fingerprint; check them against the text and run node tools/req-check/index.mjs --update-fingerprints ${f.id} "${it.key}"` });
    }
  }
  return { findings, changed, missing, checked };
}

function changedMessage(id, it, covered) {
  const listed = it.slice.links.tests.length ? it.slice.links.tests.join(', ') : '—';
  const naming = covered.get(it.coverageKey) ?? [];
  return `${it.slice.sid} ${it.key.split('/')[1]}: the text changed since its tests and code were last checked against it. Re-check the tests in «Перевіряється»: ${listed}${naming.length ? `; tests naming this item: ${naming.join(', ')}` : ''}. Then run node tools/req-check/index.mjs --update-fingerprints ${id} "${it.key}"`;
}

/**
 * New entries of a requirement after a re-check. `items` empty: every item a test names, plus every item that
 * already has an entry; entries of items the views no longer have are dropped. `items` given (`PoC/FR 3`, or
 * `FR 3` for every view that has it): only those are written; a named key the views no longer have is removed.
 * @returns {{entries: Map<string, string>, written: string[], removed: string[]}}
 */
export function updateFingerprints(feature, existing, covered, items = []) {
  const current = currentItems(feature);
  const entries = new Map(existing);
  const written = [];
  const removed = [];
  if (!items.length) {
    for (const k of [...entries.keys()]) if (!current.has(k)) {
      entries.delete(k);
      removed.push(k);
    }
    for (const it of current.values()) {
      if (!entries.has(it.key) && !covered.has(it.coverageKey)) continue;
      entries.set(it.key, it.hash);
      written.push(it.key);
    }
    return { entries, written, removed };
  }
  for (const raw of items) {
    const k = parseItemKey(raw);
    if (!k) throw new Error(`--update-fingerprints: «${raw}» is not an item (write it as «PoC/FR 3» or «FR 3»)`);
    const keys = k.release
      ? [itemKey(k.release, k.kind, k.n)]
      : [...current.keys(), ...entries.keys()].filter((x) => x.endsWith(`/${k.kind} ${k.n}`));
    const found = [...new Set(keys)].filter((x) => current.has(x) || entries.has(x));
    if (!found.length) throw new Error(`--update-fingerprints: ${feature.id} has no item ${k.release ? itemKey(k.release, k.kind, k.n) : `${k.kind} ${k.n}`}`);
    for (const x of found) {
      if (current.has(x)) {
        entries.set(x, current.get(x).hash);
        written.push(x);
      } else {
        entries.delete(x);
        removed.push(x);
      }
    }
  }
  return { entries, written, removed };
}
