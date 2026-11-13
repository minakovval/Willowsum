// Loads docs/requirements into an in-memory corpus. Pure data, no checks.
import fs from 'node:fs';
import path from 'node:path';
import { ID_FILE_RE, SLICE_FILE_RE, RELEASE_KEY } from './config.mjs';
import { parseSource, viewReleases, renderViews, viewFileName, SOURCE_MARKER } from './source.mjs';
import { parseHeading } from './markdown.mjs';

const RELEASE_OF_KEY = Object.fromEntries(Object.entries(RELEASE_KEY).map(([r, k]) => [k, r]));

/**
 * @typedef {object} Doc
 * @property {string} rel      path relative to the repository root, with forward slashes
 * @property {string} name     file name
 * @property {string} folder   module folder name ('' for files at the top of the requirements dir)
 * @property {'general'|'index'|'readme'|'requirement'|'slice'|'other'} kind
 * @property {string|null} id  requirement ID for kind 'requirement' and 'slice'
 * @property {string} [release] release of a slice ('PoC', 'PoC v2' …)
 * @property {string[]} lines
 * @property {object} [source]   a requirement source: the parsed source (its `lines` are the card part only)
 * @property {{sourceRel: string, sid: string, lineMap: number[]}} [generated]  a view generated from a source
 */

/**
 * Build a corpus from an explicit list of files: [{ rel, text }]. `rel` is relative to the
 * requirements directory (e.g. 'bud/BUD-01.md'). Used by the CLI and by the unit tests.
 * @param {{rel: string, text: string}[]} files
 * @param {string} [prefix] prefix that turns `rel` into a repository-relative path
 * @param {{migrated?: Iterable<string>, migratedBase?: Iterable<string>}} [opts]  `migrated`: the IDs of the
 *   migrated list (tools/req-check/migrated.json); each must have a requirement file with a source section, and
 *   each source must be on it. `migratedBase`: the list on the base branch; each of its IDs must stay on `migrated`
 */
export function buildCorpus(files, prefix = 'docs/requirements', opts = {}) {
  /** @type {Doc[]} */
  const docs = [];
  const raw = new Map();
  for (const { rel, text } of files) {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts[0] : '';
    let kind = 'other';
    let id = null;
    let release;
    const slice = SLICE_FILE_RE.exec(name);
    if (folder !== '' && parts.length === 2 && slice) {
      kind = 'slice';
      id = slice[1];
      release = RELEASE_OF_KEY[slice[2]];
    } else if (folder === '' && name === '00-general.md') kind = 'general';
    else if (folder === '' && name === 'README.md') kind = 'index';
    else if (folder !== '' && parts.length === 2 && name === 'README.md') kind = 'readme';
    else if (folder !== '' && parts.length === 2 && /^[A-Z][A-Z0-9]*-/.test(name)) {
      kind = 'requirement';
      const m = ID_FILE_RE.exec(name);
      id = m ? name.slice(0, -3) : null;
    }
    raw.set(prefix ? `${prefix}/${rel}` : rel, text);
    docs.push({
      rel: prefix ? `${prefix}/${rel}` : rel,
      name,
      folder,
      kind,
      id,
      ...(release ? { release } : {}),
      lines: text.replace(/\r\n?/g, '\n').split('\n'),
    });
  }
  const { sources, viewProblems } = attachSources(docs, raw, opts.migrated ?? [], {
    listed: opts.migrated !== undefined,
    base: opts.migratedBase ?? [],
  });
  docs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const folders = [...new Set(docs.filter((d) => d.folder).map((d) => d.folder))].sort();
  return { docs, folders, prefix, sources, viewProblems };
}

/**
 * Requirement sources (docs/requirements/README.md, «Source and generated release views»): parse each
 * source, keep only its card part in `lines`, and put its generated views in place of the view files on
 * disk, so every check reads what the source generates. A view file that differs from its generated text,
 * is missing, or is not one of the source's views is a problem; the CLI reports it and `--views` fixes it.
 * @param {Doc[]} docs  mutated: view docs replaced or added
 * @param {Map<string, string>} raw  repository-relative path → file text as read
 * @param {Iterable<string>} [migrated]  IDs that must be sources (see MIGRATED_FILE)
 * @param {{listed?: boolean, base?: Iterable<string>}} [list]  `listed`: a migrated list exists, so every source
 *   must be on it; `base`: the list on the base branch, whose every ID must stay on `migrated`
 */
export function attachSources(docs, raw, migrated = [], list = {}) {
  const sources = [];
  const viewProblems = [];
  for (const d of [...docs]) {
    if (d.kind !== 'requirement' || !d.id) continue;
    const src = parseSource(raw.get(d.rel).replace(/\r\n?/g, '\n'));
    if (!src) continue;
    d.lines = src.cardLines;
    d.source = src;
    const dir = d.rel.slice(0, d.rel.length - d.name.length);
    const releases = viewReleases(d.id, src.cardLines);
    const views = renderViews(d.id, parseHeading(src.cardLines[0])?.title ?? '', src, releases);
    const entry = { id: d.id, rel: d.rel, doc: d, src, releases, views: new Map() };
    for (const [release, v] of views) {
      const name = viewFileName(d.id, release);
      const rel = `${dir}${name}`;
      const sid = `${d.id}@${release}`;
      let vd = docs.find((x) => x.rel === rel);
      if (!vd) {
        vd = { rel, name, folder: d.folder, kind: 'slice', id: d.id, release };
        docs.push(vd);
        viewProblems.push({ rule: 'view-missing', file: rel, line: 0, message: `${name} is not on disk; run node tools/req-check/index.mjs --views` });
      } else if (raw.get(rel) !== v.text) {
        const disk = raw.get(rel).split('\n');
        const at = v.lines.findIndex((l, i) => l !== disk[i]);
        viewProblems.push({ rule: 'view-stale', file: rel, line: (at < 0 ? v.lines.length : at) + 1, message: `${name} differs from what ${d.name} generates (first difference at line ${(at < 0 ? v.lines.length : at) + 1}); edit the source, not the view, and run node tools/req-check/index.mjs --views` });
      }
      vd.lines = v.lines;
      vd.generated = { sourceRel: d.rel, sid, lineMap: v.lineMap };
      entry.views.set(release, { rel, text: v.text, lineMap: v.lineMap });
    }
    for (const x of docs) {
      if (x.kind === 'slice' && x.id === d.id && x.rel.startsWith(dir) && !x.generated) {
        viewProblems.push({ rule: 'view-extra', file: x.rel, line: 0, message: `${x.name} is not a view of ${d.name} (its «Зрізи» do not list ${x.id}@${x.release}); remove it or run node tools/req-check/index.mjs --views` });
      }
    }
    sources.push(entry);
  }
  // A slice that still says it is generated but has no source behind it (the source section was deleted or
  // its marker broken) would otherwise be an ordinary hand-written slice that no check compares to anything.
  for (const x of docs) {
    if (x.kind === 'slice' && !x.generated && x.lines?.[1]?.startsWith('> Згенеровано з ')) {
      viewProblems.push({ rule: 'view-orphan', file: x.rel, line: 2, message: `${x.name} says it is generated, but ${x.id}.md has no «${SOURCE_MARKER}» section; restore the source or remove the header` });
    }
  }
  // The «Джерело зрізів» section is what makes a requirement a source. Deleting it and the «Згенеровано»
  // headers of its views would turn it into a card with hand-written slices that nothing compares to a
  // source, so an ID on the migrated list must keep its source section.
  const sourceIds = new Set(sources.map((x) => x.id));
  for (const id of migrated) {
    if (sourceIds.has(id)) continue;
    const card = docs.find((x) => x.kind === 'requirement' && x.id === id);
    viewProblems.push({
      rule: 'source-missing',
      file: card?.rel ?? `${id}.md`,
      line: 0,
      message: `${id} is on the migrated list (${MIGRATED_FILE}) but ${card ? `${card.name} has no «${SOURCE_MARKER}» section` : `there is no requirement file ${id}.md`}; restore the source section (git history) or, if the requirement is retired on purpose, remove it from the list in a reviewed change`,
    });
  }
  // The list itself can drift: a source missing from it is not protected, and an ID removed from it in the same
  // change as its source section hides the attack above. Both are errors (the base list comes from CI).
  const listedIds = new Set(migrated);
  if (list.listed) {
    for (const x of sources) {
      if (listedIds.has(x.id)) continue;
      viewProblems.push({
        rule: 'migrated-missing',
        file: x.rel,
        line: 0,
        message: `${x.id} is a source but is not on the migrated list (${MIGRATED_FILE}); run node tools/req-check/index.mjs --views, which adds it, and commit the list`,
      });
    }
  }
  for (const id of new Set(list.base ?? [])) {
    if (listedIds.has(id)) continue;
    viewProblems.push({
      rule: 'migrated-removed',
      file: MIGRATED_FILE,
      line: 0,
      message: `${id} is on the migrated list of the base branch but was removed from ${MIGRATED_FILE}; put it back (the list only grows; retiring a requirement needs the owner's decision and a change to this check)`,
    });
  }
  return { sources, viewProblems };
}

/** The migrated list: IDs of requirements that are sources; `--views` and `--convert` only add to it. */
export const MIGRATED_FILE = 'tools/req-check/migrated.json';

/** Read the migrated list of a repository root ([] when there is none). */
export function readMigrated(root) {
  return readMigratedFile(path.resolve(root, MIGRATED_FILE)) ?? [];
}

/** Read a migrated list file (undefined when it does not exist). */
export function readMigratedFile(p) {
  if (!fs.existsSync(p)) return undefined;
  const ids = JSON.parse(fs.readFileSync(p, 'utf8')).ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error(`${p}: "ids" must be an array of strings`);
  return ids;
}

/** Add the IDs of `sourceIds` to the migrated list file; returns how many were new. */
export function addMigrated(root, sourceIds) {
  const have = new Set(readMigrated(root));
  const fresh = [...sourceIds].filter((id) => !have.has(id));
  if (!fresh.length && fs.existsSync(path.resolve(root, MIGRATED_FILE))) return 0;
  const doc = {
    $comment: [
      'IDs of the requirements that are sources (card plus «Джерело зрізів»). req-check fails (source-missing) for an ID here whose file has lost its source section.',
      'node tools/req-check/index.mjs --views and --convert add IDs; remove one only in a reviewed change that retires the requirement.',
    ],
    ids: [...new Set([...have, ...fresh])].sort(),
  };
  fs.mkdirSync(path.dirname(path.resolve(root, MIGRATED_FILE)), { recursive: true });
  fs.writeFileSync(path.resolve(root, MIGRATED_FILE), `${JSON.stringify(doc, null, 2)}\n`);
  return fresh.length;
}

/**
 * Read every Markdown file under `reqDir`.
 * @param {string} root     repository root
 * @param {string} reqDir   requirements directory relative to root
 * @param {{migratedBase?: Iterable<string>}} [opts]  the base branch's migrated list (CI: --migrated-base)
 */
export function loadCorpus(root, reqDir = 'docs/requirements', opts = {}) {
  const abs = path.resolve(root, reqDir);
  if (!fs.existsSync(abs)) throw new Error(`requirements directory not found: ${abs}`);
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md')) {
        files.push({ rel: path.relative(abs, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(abs);
  const migrated = readMigratedFile(path.resolve(root, MIGRATED_FILE));
  return buildCorpus(files, reqDir.split(path.sep).join('/'), {
    ...(migrated ? { migrated } : {}),
    ...(opts.migratedBase ? { migratedBase: opts.migratedBase } : {}),
  });
}
