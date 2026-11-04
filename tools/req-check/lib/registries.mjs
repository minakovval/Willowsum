// Registries that link headers point to: screens (docs/ux/screen-map.md), use cases
// (docs/ux/use-cases/UC-*.md), general rules П-n (00-general.md), modules (ARC-01 catalogue) and
// test paths (files in the repository).
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY_PATHS, REF_RE } from './config.mjs';
import { tableCells, isTableSeparator } from './markdown.mjs';
import { mainRelease } from './release.mjs';

/**
 * @typedef {object} Screen
 * @property {string} id
 * @property {string} title
 * @property {string} release   main release from the «Реліз» column ('' when none)
 * @property {string[]} requirements  requirement IDs from the «Вимоги» column
 */

/**
 * Screen inventory rows of the screen map: `| S-121 | screen | Назва | /route | Розділ | MVP | BUD-02, … | стани | ролі |`.
 * @returns {Map<string, Screen>}
 */
export function parseScreenMap(lines) {
  const screens = new Map();
  for (const line of lines) {
    const cells = tableCells(line);
    if (!cells || cells.length < 7 || isTableSeparator(line) || !REF_RE.screen.test(cells[0])) continue;
    const release = mainRelease(cells[5]) ?? '';
    const requirements = [...cells[6].matchAll(/[A-Z][A-Z0-9]{1,4}-\d{2}[a-z]?/g)].map((m) => m[0]);
    if (!screens.has(cells[0])) screens.set(cells[0], { id: cells[0], title: cells[2], release: release === 'Сейф' ? 'MVP' : release, requirements });
  }
  return screens;
}

/** Use-case IDs: headings `## UC-BUD-03 …` and first cells of the overview tables. */
export function parseUseCases(texts) {
  const ids = new Set();
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const h = /^#{2,4}\s+(UC-[A-Z0-9]+-\d{2,3}[a-z]?)\b/.exec(line);
      if (h) ids.add(h[1]);
      const cells = tableCells(line);
      if (cells && REF_RE.useCase.test(cells[0])) ids.add(cells[0]);
    }
  }
  return ids;
}

/** General rules П-n of 00-general.md, section 0.5: numbered items 1–4 and `**П-n.**` labels. */
export function parseGeneralRules(lines) {
  const rules = new Set();
  const start = lines.findIndex((l) => /^## 0\.5\b/.test(l));
  if (start < 0) return rules;
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) {
    const l = lines[i];
    const label = /\*\*П-(\d+)\.\*\*/u.exec(l);
    if (label) rules.add(`П-${label[1]}`);
    else {
      const n = /^(\d+)\.\s/.exec(l);
      if (n) rules.add(`П-${n[1]}`);
    }
  }
  return rules;
}

/** Module names from the «Каталог модулів» table (`| Домен | Модуль | … |`) of the given lines. */
export function parseModuleCatalogue(lines) {
  const modules = new Set();
  const start = lines.findIndex((l) => /^\*\*Каталог модулів\*\*/u.test(l.trim()));
  if (start < 0) return modules;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^(#|\*\*)/.test(l)) break;
    const cells = tableCells(l);
    if (!cells || isTableSeparator(l)) continue;
    if (REF_RE.module.test(cells[1] ?? '')) modules.add(cells[1]);
  }
  return modules;
}

/**
 * @typedef {object} Registries
 * @property {Map<string, Screen>|null} screens   null when the screen map is missing
 * @property {Set<string>|null} useCases           null when the use-case folder is missing
 * @property {(p: string) => boolean} fileExists   repository-relative path exists
 * @property {{rel: string, lines: string[]}[]} [uxDocs]  Markdown files under docs/ux (for impact analysis)
 */

/** Read the registries that live outside docs/requirements. */
export function loadRegistries(root) {
  const sm = path.resolve(root, REGISTRY_PATHS.screenMap);
  const ucDir = path.resolve(root, REGISTRY_PATHS.useCases);
  const screens = fs.existsSync(sm) ? parseScreenMap(fs.readFileSync(sm, 'utf8').split('\n')) : null;
  let useCases = null;
  if (fs.existsSync(ucDir)) {
    const texts = fs
      .readdirSync(ucDir)
      .filter((n) => /^UC-.*\.md$/.test(n))
      .sort()
      .map((n) => fs.readFileSync(path.join(ucDir, n), 'utf8'));
    useCases = parseUseCases(texts);
  }
  const fileExists = (p) => {
    const abs = path.resolve(root, p);
    return abs.startsWith(path.resolve(root) + path.sep) && fs.existsSync(abs);
  };
  const uxDocs = [];
  const uxRoot = path.resolve(root, 'docs/ux');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) uxDocs.push({ rel: path.relative(root, p).split(path.sep).join('/'), lines: fs.readFileSync(p, 'utf8').split('\n') });
    }
  };
  if (fs.existsSync(uxRoot)) walk(uxRoot);
  return { screens, useCases, fileExists, uxDocs };
}

/** Registries for unit tests and for corpora without docs/ux. */
export function makeRegistries({ screens = [], useCases = [], files = [], uxDocs = [] } = {}) {
  return {
    uxDocs,
    screens: new Map(screens.map((s) => (typeof s === 'string' ? [s, { id: s, title: '', release: 'MVP', requirements: [] }] : [s.id, { title: '', release: 'MVP', requirements: [], ...s }]))),
    useCases: new Set(useCases),
    fileExists: (p) => files.includes(p),
  };
}
