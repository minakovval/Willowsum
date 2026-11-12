// Finding model shared by all checks.

/**
 * @typedef {object} Finding
 * @property {string} id         stable identifier used by the baseline (no line numbers)
 * @property {string} check      check group: structure | release | self-contained | criteria | facts | links
 * @property {string} rule       rule name inside the group
 * @property {'error'|'warning'} severity
 * @property {string} file       repository-relative path
 * @property {number} line       1-based line number (0 when not tied to a line)
 * @property {string} message
 * @property {boolean} [baselined]
 */

export const CHECKS = ['structure', 'release', 'self-contained', 'criteria', 'facts', 'links', 'source'];

export const CHECK_TITLES = {
  structure: '1. File name, heading, unique IDs, module READMEs',
  release: '2. Release and priority line',
  'self-contained': '3. Self-containedness and forbidden words',
  criteria: '4. Acceptance criteria and numbered lists',
  facts: '5. Fact registry',
  links: '6. Release slices, cards and link headers',
  source: '7. Requirement sources and generated release views',
};

/** Collects findings and makes their ids unique (`#2`, `#3` … for repeats). */
export class Findings {
  /**
   * @param {(file: string, line: number) => ({file: string, line: number, prefix: string}|null)} [redirect]
   *   maps a place in a generated view to its source (file, line, message prefix)
   */
  constructor(redirect = null) {
    /** @type {Finding[]} */
    this.list = [];
    this.seen = new Map();
    this.redirect = redirect;
  }

  /**
   * @param {{check: string, rule: string, severity?: 'error'|'warning', file: string, line?: number,
   *          key?: string, message: string}} f
   */
  add({ check, rule, severity = 'error', file, line = 0, key = '', message }) {
    const to = check !== 'source' && this.redirect ? this.redirect(file, line) : null;
    if (to) {
      ({ file, line } = to);
      message = `${to.prefix}${message}`;
      key = `${to.prefix.replace(/: $/, '')}:${key}`;
    }
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
