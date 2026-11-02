// Parses module READMEs and the top-level index README.
import { tableCells, isTableSeparator } from './markdown.mjs';

/**
 * Rows of the requirements table in a module README:
 * `| [ID](ID.md) | Title | Release | Priority |`.
 * @returns {{index: number, id: string, target: string, title: string, release: string,
 *            priority: string}[]}
 */
export function parseModuleReadme(lines) {
  const rows = [];
  lines.forEach((line, index) => {
    const cells = tableCells(line);
    if (!cells || isTableSeparator(line)) return;
    const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cells[0] ?? '');
    if (!m) return;
    rows.push({
      index,
      id: m[1],
      target: m[2],
      title: cells[1] ?? '',
      release: cells[2] ?? '',
      priority: cells[3] ?? '',
    });
  });
  return rows;
}

/**
 * Rows of the module table in the top-level README:
 * `| ACC | [acc/](acc/README.md) | Scope | 12 | MVP 10, v2 1 |`.
 */
export function parseIndexReadme(lines) {
  const rows = [];
  lines.forEach((line, index) => {
    const cells = tableCells(line);
    if (!cells || cells.length < 5 || isTableSeparator(line)) return;
    const m = /^\[([^\]/]+)\/\]\(([^)]+)\)$/.exec(cells[1] ?? '');
    if (!m || !/^\d+$/.test(cells[3])) return;
    rows.push({ index, code: cells[0], folder: m[1], count: Number(cells[3]), mix: cells[4] });
  });
  return rows;
}

/** Parse «MVP 10, v1-mobile 1, n/a 2» into a map. */
export function parseReleaseMix(text) {
  const map = new Map();
  for (const part of text.split(',')) {
    const m = /^\s*(.+?)\s+(\d+)\s*$/.exec(part);
    if (m) map.set(m[1], Number(m[2]));
  }
  return map;
}
