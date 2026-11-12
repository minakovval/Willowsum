// Items of a requirement text: functional requirements (FR n), acceptance criteria (AC n) and edge cases
// (EC n, the n-th bullet of «Граничні випадки»). Used by --move and --coverage.
import { SECTION, SECTION_END_RE } from './config.mjs';
import { findSection } from './markdown.mjs';
import { parseLinkBlock } from './links.mjs';

export const EDGE_CASES = 'Граничні випадки';

/** Item kinds and the section each one lives in. */
export const ITEM_KINDS = { FR: SECTION.functional, AC: SECTION.criteria, EC: EDGE_CASES };

/**
 * Items of one text (a view or a plain requirement file).
 * @param {string[]} lines
 * @returns {{kind: string, n: number, index: number, end: number}[]}  `index` is the item's line (0-based),
 *   `end` the line after its block (the item line and its indented continuation lines)
 */
export function itemsOf(lines) {
  const out = [];
  for (const [kind, label] of Object.entries(ITEM_KINDS)) {
    const sec = findSection(lines, label) ?? (kind === 'FR' ? firstList(lines) : null);
    if (!sec) continue;
    let ordinal = 0;
    const body = sec.lines;
    body.forEach(({ index, text }, k) => {
      const num = /^(\d+)\.\s/.exec(text);
      const bullet = kind === 'EC' && /^[-*+]\s/.test(text);
      if (!(kind === 'EC' ? bullet : num)) return;
      ordinal++;
      let end = index + 1;
      for (let q = k + 1; q < body.length; q++) {
        const t = body[q].text;
        if (t.trim() === '') continue;
        if (!/^\s/.test(t)) break;
        end = body[q].index + 1;
      }
      out.push({ kind, n: kind === 'EC' ? ordinal : Number(num[1]), index, end });
    });
  }
  return out;
}

/**
 * Without a «Функціональні вимоги» label (architecture, NFR and delivery requirements), FR n is item n of
 * the first numbered list after the link header, up to the next heading or bold label.
 */
function firstList(lines) {
  const from = parseLinkBlock(lines)?.end ?? 1;
  const start = lines.findIndex((l, i) => i >= from && /^\d+\.\s/.test(l));
  if (start < 0) return null;
  const body = [];
  for (let i = start; i < lines.length && !SECTION_END_RE.test(lines[i]); i++) body.push({ index: i, text: lines[i] });
  return { start: start - 1, lines: body };
}

/** Parse `FR4`, `AC 5`, `EC2` into {kind, n}; null when the shape is wrong. */
export function parseItemRef(ref) {
  const m = /^(FR|AC|EC)\s?(\d+)$/.exec(ref.trim());
  return m ? { kind: m[1], n: Number(m[2]) } : null;
}
