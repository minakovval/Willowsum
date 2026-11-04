// Parses link headers («Зв'язки») of cards and slices, and the releases named on a «Реліз» line.
import { LINK_BLOCK_RE, EMPTY_VALUE, SLICE_RELEASES, releaseIndex } from './config.mjs';
import { mainRelease } from './release.mjs';

/**
 * @typedef {object} LinkField
 * @property {string} name     field name («Залежить від»)
 * @property {number} index    0-based line index
 * @property {string[]} values IDs, empty for «—»
 * @property {string} raw      text after the colon
 */

/**
 * @typedef {object} LinkBlock
 * @property {number} start    0-based index of the «**Зв'язки**» line
 * @property {number} end      0-based index after the last field line
 * @property {LinkField[]} fields
 * @property {{index: number, message: string}[]} problems  syntax problems
 * @property {number[]} extra  indices of further «**Зв'язки**» labels (only one block is allowed)
 */

/**
 * Find the link header. Syntax:
 *
 *     **Зв'язки**
 *     - Розширює: —
 *     - Залежить від: BUD-02@PoC, FCS-01@PoC
 *
 * One field per bullet line, `- <Field>: <ID>, <ID> …` or `- <Field>: —` for an empty list. The block
 * ends at the first line that is not a `- ` bullet.
 * @param {string[]} lines
 * @returns {LinkBlock|null}
 */
export function parseLinkBlock(lines) {
  const labels = [];
  lines.forEach((l, i) => {
    if (LINK_BLOCK_RE.test(l.trim())) labels.push(i);
  });
  if (!labels.length) return null;
  const start = labels[0];
  const fields = [];
  const problems = [];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!/^- /.test(line)) break;
    const m = /^- ([^:]+?):\s*(.*)$/u.exec(line);
    if (!m) {
      problems.push({ index: i, message: `link line must be "- <field>: <ID>, <ID>" or "- <field>: ${EMPTY_VALUE}", found "${line.slice(0, 80)}"` });
      continue;
    }
    const raw = m[2].trim();
    let values = [];
    if (raw === '') problems.push({ index: i, message: `field «${m[1]}» is empty; write "${EMPTY_VALUE}" for an empty list` });
    else if (raw !== EMPTY_VALUE) {
      values = raw.split(',').map((v) => v.trim().replace(/^`(.*)`$/, '$1'));
      if (values.some((v) => v === '' || v === EMPTY_VALUE)) {
        problems.push({ index: i, message: `field «${m[1]}» has an empty item; separate IDs with ", "` });
        values = values.filter((v) => v !== '' && v !== EMPTY_VALUE);
      }
    }
    fields.push({ name: m[1].trim(), index: i, values, raw });
  }
  return { start, end: i, fields, problems, extra: labels.slice(1) };
}

/** Field by name, or undefined. */
export function field(block, name) {
  return block?.fields.find((f) => f.name === name);
}

/** Split on `;` and `·` outside parentheses (the «Пріоритет» part is already stripped). */
function topLevelSegments(text) {
  const segs = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === '·') && depth === 0) {
      segs.push(cur);
      cur = '';
    } else cur += ch;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

const TAIL_RELEASE_RE = /—\s*«?(PoC v2|PoC|MVP|Сейф|v1-mobile|v1|v2)»?\.?$/u;

/**
 * Releases a «Реліз» text names, in build order: every top-level segment (separated by `;` or `·`
 * outside parentheses) that starts with a release («PoC (…)», «v1 — …») or ends with one («решта — MVP», «PDF і скани — MVP»). A segment
 * «основа в архітектурі й моделі даних — PoC» is the architectural foundation (П-24), not a slice;
 * it is returned as `foundation`. «Сейф» is part of MVP. A release named only inside parentheses
 * («PoC (… push — v1-mobile)») does not create a slice.
 * @returns {{releases: string[], foundation: string|null}}
 */
export function releasesOf(releaseText) {
  const found = new Set();
  let foundation = null;
  for (const seg of topLevelSegments(releaseText ?? '')) {
    const head = seg.replace(/\(.*$/su, '').trim();
    let r = mainRelease(seg);
    if (!r) {
      const m = TAIL_RELEASE_RE.exec(head);
      if (m) {
        if (/^основа/u.test(head)) {
          foundation = m[1] === 'Сейф' ? 'MVP' : m[1];
          continue;
        }
        r = m[1];
      }
    }
    if (r) found.add(r === 'Сейф' ? 'MVP' : r);
  }
  const releases = SLICE_RELEASES.filter((r) => found.has(r));
  return { releases, foundation };
}

/** Earliest of the given releases (by build order), or null. */
export function earliest(releases) {
  const sorted = releases.filter((r) => releaseIndex(r) >= 0).sort((a, b) => releaseIndex(a) - releaseIndex(b));
  return sorted[0] ?? null;
}
