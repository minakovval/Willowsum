// Loads docs/requirements into an in-memory corpus. Pure data, no checks.
import fs from 'node:fs';
import path from 'node:path';
import { ID_FILE_RE } from './config.mjs';

/**
 * @typedef {object} Doc
 * @property {string} rel      path relative to the repository root, with forward slashes
 * @property {string} name     file name
 * @property {string} folder   module folder name ('' for files at the top of the requirements dir)
 * @property {'general'|'index'|'readme'|'requirement'|'other'} kind
 * @property {string|null} id  requirement ID for kind 'requirement'
 * @property {string[]} lines
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
  for (const { rel, text } of files) {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const folder = parts.length > 1 ? parts[0] : '';
    let kind = 'other';
    let id = null;
    if (folder === '' && name === '00-general.md') kind = 'general';
    else if (folder === '' && name === 'README.md') kind = 'index';
    else if (folder !== '' && parts.length === 2 && name === 'README.md') kind = 'readme';
    else if (folder !== '' && parts.length === 2 && /^[A-Z][A-Z0-9]*-/.test(name)) {
      kind = 'requirement';
      const m = ID_FILE_RE.exec(name);
      id = m ? name.slice(0, -3) : null;
    }
    docs.push({
      rel: prefix ? `${prefix}/${rel}` : rel,
      name,
      folder,
      kind,
      id,
      lines: text.replace(/\r\n?/g, '\n').split('\n'),
    });
  }
  docs.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const folders = [...new Set(docs.filter((d) => d.folder).map((d) => d.folder))].sort();
  return { docs, folders, prefix };
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
