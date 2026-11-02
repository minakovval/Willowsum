// Finding model shared by all checks.

/**
 * @typedef {object} Finding
 * @property {string} id         stable identifier used by the baseline (no line numbers)
 * @property {string} check      check group: structure | release | self-contained | criteria | facts
 * @property {string} rule       rule name inside the group
 * @property {'error'|'warning'} severity
 * @property {string} file       repository-relative path
 * @property {number} line       1-based line number (0 when not tied to a line)
 * @property {string} message
 * @property {boolean} [baselined]
 */

export const CHECKS = ['structure', 'release', 'self-contained', 'criteria', 'facts'];

export const CHECK_TITLES = {
  structure: '1. File name, heading, unique IDs, module READMEs',
  release: '2. Release and priority line',
  'self-contained': '3. Self-containedness and forbidden words',
  criteria: '4. Acceptance criteria and numbered lists',
  facts: '5. Fact registry',
};

/** Collects findings and makes their ids unique (`#2`, `#3` … for repeats). */
export class Findings {
  constructor() {
    /** @type {Finding[]} */
    this.list = [];
    this.seen = new Map();
  }

  /**
   * @param {{check: string, rule: string, severity?: 'error'|'warning', file: string, line?: number,
   *          key?: string, message: string}} f
   */
  add({ check, rule, severity = 'error', file, line = 0, key = '', message }) {
    let id = `${rule}:${file}${key ? `:${key}` : ''}`;
    const n = (this.seen.get(id) ?? 0) + 1;
    this.seen.set(id, n);
    if (n > 1) id += `#${n}`;
    this.list.push({ id, check, rule, severity, file, line, message });
  }
}

export function sortFindings(list) {
  return [...list].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
