// Parses the `**Реліз:** … · **Пріоритет:** …` line.
import { RELEASES, PRIORITIES } from './config.mjs';

const RELEASE_LINE_RE = /^\*\*Реліз:\*\*\s*(.*)$/u;
const PRIORITY_RE = /\s*·?\s*\*\*Пріоритет:\*\*\s*(.*)$/u;

/** Main release of a release text: the first token, quotes stripped. */
export function mainRelease(text) {
  const t = text.replace(/^[«"]/, '').trim();
  for (const r of RELEASES) {
    if (t.startsWith(r)) {
      const next = t.slice(r.length).replace(/^»/, '');
      if (next === '' || /^[\s.(;·,]/u.test(next)) return r;
    }
  }
  return null;
}

/** Main priority of a priority text: `M`, `S (…)`. */
export function mainPriority(text) {
  const m = /^([A-Za-z]+)(?=$|[\s(.])/.exec(text.trim());
  return m && PRIORITIES.includes(m[1]) ? m[1] : null;
}

/**
 * Find and parse the release line in the first lines of a requirement file.
 * @returns {null|{line: number, releaseText: string, priorityText: string|null,
 *                 release: string|null, priority: string|null}}
 */
export function parseReleaseLine(lines, searchLines = 6) {
  for (let i = 1; i < Math.min(lines.length, searchLines); i++) {
    const m = RELEASE_LINE_RE.exec(lines[i]);
    if (!m) continue;
    let releaseText = m[1].trim();
    let priorityText = null;
    const p = PRIORITY_RE.exec(releaseText);
    if (p) {
      priorityText = p[1].trim();
      releaseText = releaseText.slice(0, p.index).trim();
    }
    return {
      line: i + 1,
      releaseText,
      priorityText,
      release: mainRelease(releaseText),
      priority: priorityText === null ? null : mainPriority(priorityText),
    };
  }
  return null;
}
