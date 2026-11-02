// Small Markdown helpers tailored to the requirement file format.
import { SECTION_END_RE } from './config.mjs';

/** Parse `# <ID> · <title>`; returns null when the line has another shape. */
export function parseHeading(line) {
  const m = /^# (\S+) · (.+)$/u.exec(line ?? '');
  return m ? { id: m[1], title: m[2].trim() } : null;
}

/** [start, end) index ranges of inline code spans in a line. */
export function codeSpanRanges(line) {
  const ranges = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m;
  while ((m = re.exec(line))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

export function inRanges(ranges, index) {
  return ranges.some(([a, b]) => index >= a && index < b);
}

/** Split a Markdown table row into trimmed cells (outer pipes removed). */
export function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function isTableSeparator(line) {
  return /^\|\s*:?-{3,}/.test(line.trim());
}

/**
 * Find a bold-labelled section (`**Label**` on its own line) and return its body lines
 * with 0-based indices, ending at the next heading, bold label or «Припущення:».
 * @returns {{start: number, lines: {index: number, text: string}[]}|null}
 */
export function findSection(lines, label) {
  const headerRe = new RegExp(`^\\*\\*${label}\\*\\*\\s*:?\\s*$`, 'u');
  const start = lines.findIndex((l) => headerRe.test(l.trim()));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION_END_RE.test(lines[i])) break;
    body.push({ index: i, text: lines[i] });
  }
  return { start, lines: body };
}

/** Top-level numbered list items (`12. text`) of a section body. */
export function numberedItems(body) {
  const items = [];
  for (const { index, text } of body) {
    const m = /^(\d+)\.\s+(.*)$/.exec(text);
    if (m) items.push({ index, n: Number(m[1]), text: m[2] });
  }
  return items;
}
