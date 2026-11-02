// Check 4: acceptance criteria format and numbering; functional-requirement numbering (warning).
import { SECTION } from '../config.mjs';
import { findSection, numberedItems, tableCells } from '../markdown.mjs';

const CHECK = 'criteria';

/**
 * `**Given** … **When** … **Then** …`, with optional `**And** …` after Given or Then, and an
 * optional trailing `(v1-mobile)` marker. Each part must have text.
 */
export const GWT_RE =
  /^\*\*Given\*\*\s+\S.*?(\s\*\*And\*\*\s+\S.*?)*\s\*\*When\*\*\s+\S.*?(\s\*\*And\*\*\s+\S.*?)*\s\*\*Then\*\*\s+\S.*$/su;

const MARKER_START_RE = /^\((v1-mobile|MVP|Сейф|v1|v2)\)\s+/u;
const BOLD_MARKER_RE = /^\*\*\((v1-mobile|MVP|Сейф|v1|v2)\)\*\*\s+/u;

/** Explain why a criterion does not match GWT_RE. */
export function explainCriterion(text) {
  const pos = (w) => text.indexOf(`**${w}**`);
  const g = pos('Given');
  const w = pos('When');
  const t = pos('Then');
  const missing = ['Given', 'When', 'Then'].filter((k) => pos(k) < 0);
  if (missing.length) return `missing ${missing.map((k) => `**${k}**`).join(', ')}`;
  if (g !== 0) return 'must start with **Given**';
  if (!(g < w && w < t)) return 'keywords must appear in the order **Given** … **When** … **Then**';
  const extra = text.match(/\*\*(Given|When|Then)\*\*/g) ?? [];
  if (extra.length > 3) return 'repeats **Given**/**When**/**Then** (use **And** for extra clauses)';
  return 'a keyword has no text after it, or a keyword is not bold';
}

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 */
export function checkCriteria(corpus, out) {
  let sections = 0;
  let criteria = 0;
  const without = new Map();
  for (const d of corpus.docs) {
    if (d.kind !== 'requirement') continue;

    const sec = findSection(d.lines, SECTION.criteria);
    if (sec) {
      sections++;
      let expected = 1;
      let any = false;
      for (const { index, text } of sec.lines) {
        if (text.trim() === '' || tableCells(text)) continue;
        const m = /^(\d+)\.\s+(.*)$/.exec(text);
        if (!m) {
          if (/^\s+\S/.test(text) && any) continue; // indented continuation of the previous item
          out.add({ check: CHECK, rule: 'criterion-format', file: d.rel, line: index + 1, key: `line:${text.slice(0, 40)}`, message: `line in «${SECTION.criteria}» is not a numbered criterion: "${text.slice(0, 80)}"` });
          continue;
        }
        any = true;
        criteria++;
        const n = Number(m[1]);
        // A leading or trailing release marker such as «(v1-mobile)» is allowed.
        let body = m[2].trim();
        if (BOLD_MARKER_RE.test(body)) {
          out.add({ check: CHECK, rule: 'criterion-marker', severity: 'warning', file: d.rel, line: index + 1, key: `#${n}`, message: `criterion ${n} uses a bold release marker; write it plain: "(v1-mobile) **Given** …"` });
          body = body.replace(BOLD_MARKER_RE, '');
        }
        body = body.replace(MARKER_START_RE, '');
        if (n !== expected) {
          out.add({ check: CHECK, rule: 'criterion-numbering', file: d.rel, line: index + 1, key: `${expected}->${n}`, message: `criterion numbered ${n}, expected ${expected} (numbering must run 1, 2, 3 … without gaps)` });
        }
        expected = n + 1;
        if (!GWT_RE.test(body)) {
          out.add({ check: CHECK, rule: 'criterion-format', file: d.rel, line: index + 1, key: `#${n}`, message: `criterion ${n} is not "**Given** … **When** … **Then** …": ${explainCriterion(body)}` });
        }
      }
      if (!any && !sec.lines.some((l) => tableCells(l.text))) {
        out.add({ check: CHECK, rule: 'criterion-empty', file: d.rel, line: sec.start + 1, message: `«${SECTION.criteria}» has no criteria` });
      }
    }

    if (!sec) without.set(d.folder, (without.get(d.folder) ?? 0) + 1);

    const fr = findSection(d.lines, SECTION.functional);
    if (fr) {
      const items = numberedItems(fr.lines);
      const seen = new Set();
      let expected = 1;
      for (const it of items) {
        if (seen.has(it.n)) {
          out.add({ check: CHECK, rule: 'fr-numbering', severity: 'warning', file: d.rel, line: it.index + 1, key: `dup${it.n}`, message: `functional requirement number ${it.n} is duplicated` });
        } else if (it.n !== expected) {
          out.add({ check: CHECK, rule: 'fr-numbering', severity: 'warning', file: d.rel, line: it.index + 1, key: `${expected}->${it.n}`, message: `functional requirement numbered ${it.n}, expected ${expected}` });
        }
        seen.add(it.n);
        expected = Math.max(expected, it.n + 1);
      }
    }
  }
  return { sections, criteria, without };
}
