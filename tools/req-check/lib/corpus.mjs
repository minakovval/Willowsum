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
 */
export function buildCorpus(files, prefix = 'docs/requirements') {
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
  const { sources, viewProblems } = attachSources(docs, raw);
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
 */
export function attachSources(docs, raw) {
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
  return { sources, viewProblems };
}

/**
 * Read every Markdown file under `reqDir`.
 * @param {string} root     repository root
 * @param {string} reqDir   requirements directory relative to root
 */
export function loadCorpus(root, reqDir = 'docs/requirements') {
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
  return buildCorpus(files, reqDir.split(path.sep).join('/'));
}
