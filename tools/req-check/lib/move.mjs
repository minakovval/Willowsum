// --move: move items of a requirement source to another release by changing their release tags.
import { parseSource, viewReleases, renderViews, formatTag, joinTag } from './source.mjs';
import { itemsOf, parseItemRef } from './items.mjs';

/**
 * Move items so that they start in release `to`. Items are named as in the view of `from` (default: the
 * first view): `FR4` is item 4 of «Функціональні вимоги», `AC5` criterion 5, `EC2` the second edge case.
 * Every line of an item's block (the item and its indented continuation lines) gets the new tag: the run of
 * views that held it in `from` now starts at `to` (and reaches at least `to`).
 * @param {string} text  the source text
 * @param {string} id
 * @param {{items: string[], to: string, from?: string}} opts
 * @returns {{text: string, releases: string[], moved: {ref: string, lines: number[], before: string[], after: string[]}[],
 *            changed: string[], phrases: string[], variants: {release: string, line: number, other: number}[],
 *            shifts: {release: string, kind: string, from: number, to: number|null}[],
 *            citations: {line: number, release: string, ref: string, to: number|null}[],
 *            selfMentions: {phrase: string, line: number}[]}}
 *   changed = releases whose view text changed; variants = a moved line now beside a line that starts alike;
 *   shifts = items whose number changed in a view (`to` null: the item left that view); citations = «FR n» /
 *   «AC n» / «EC n» in the source's other lines that name a shifted number in a view holding that line;
 *   selfMentions = the moved items' «…» phrases on other lines of the same source
 */
export function moveItems(text, id, { items, to, from }) {
  const src = parseSource(text);
  if (!src) throw new Error(`${id}.md is not a requirement source (no "## Джерело зрізів" line); convert it first with --convert ${id}`);
  const releases = viewReleases(id, src.cardLines);
  const title = /^# \S+ · (.+)$/u.exec(src.cardLines[0])?.[1].trim() ?? '';
  const start = from ?? releases[0];
  if (!releases.includes(start)) throw new Error(`${id} has no ${start} view (views: ${releases.join(', ')})`);
  if (!releases.includes(to)) {
    throw new Error(
      `${id} has no ${to} view (views: ${releases.join(', ')}). Add it first: «Зрізи» and the «Реліз» line and table of the card part, a "[лише ${to}] **Реліз:** ${to} · …" line and the «Розширює» lines of the source; then move.`,
    );
  }
  const before = renderViews(id, title, src, releases);
  const view = before.get(start);
  const all = itemsOf(view.lines);
  const lines = text.split('\n');
  const moved = [];
  const phrases = new Set();
  for (const ref of items) {
    const r = parseItemRef(ref);
    if (!r) throw new Error(`--items: "${ref}" is not FR<n>, AC<n> or EC<n>`);
    const it = all.find((x) => x.kind === r.kind && x.n === r.n);
    if (!it) throw new Error(`${id}@${start} has no ${r.kind}${r.n}`);
    const entry = { ref: `${r.kind}${r.n}`, lines: [], before: [], after: [] };
    for (let i = it.index; i < it.end; i++) {
      const si = view.lineMap[i];
      const l = src.body.find((b) => b.index === si);
      if (!l || l.text.trim() === '') continue;
      const present = releases.filter((x) => !l.releases || l.releases.includes(x));
      const k = releases.indexOf(start);
      let a = k;
      let b = k;
      while (a > 0 && present.includes(releases[a - 1])) a--;
      while (b < releases.length - 1 && present.includes(releases[b + 1])) b++;
      const t = releases.indexOf(to);
      const run = releases.slice(t, Math.max(b, t) + 1);
      const keep = present.filter((x) => {
        const xi = releases.indexOf(x);
        return xi < a || xi > b;
      });
      const next = releases.filter((x) => run.includes(x) || keep.includes(x));
      const line = joinTag(formatTag(releases, next), l.text);
      entry.lines.push(si + 1);
      entry.before.push(lines[si]);
      entry.after.push(line);
      lines[si] = line;
      for (const m of l.text.matchAll(/«([^«»]{3,80})»/gu)) phrases.add(m[1]);
    }
    moved.push(entry);
  }
  const out = lines.join('\n');
  const after = renderViews(id, title, parseSource(out), releases);
  const changed = releases.filter((x) => before.get(x).text !== after.get(x).text);
  // A moved line that now sits in a view next to a line starting the same way is probably a per-release
  // variant of the same item (an older or newer wording): the author decides which one stays.
  const head = (t) => t.replace(/^\s*(?:\d+\.|#\.|[-*+])\s+/, '');
  const alike = (a, b) => {
    const n = Math.min(24, a.length, b.length);
    return n >= 10 && a.slice(0, n) === b.slice(0, n);
  };
  const movedLines = new Set(moved.flatMap((m) => m.lines.map((n) => n - 1)));
  const variants = [];
  for (const x of changed) {
    const v = after.get(x);
    v.lineMap.forEach((si, i) => {
      if (i < 2 || !movedLines.has(si)) return;
      v.lineMap.forEach((sj, j) => {
        if (j > 1 && sj !== si && alike(head(v.lines[j]), head(v.lines[i]))) variants.push({ release: x, line: si + 1, other: sj + 1 });
      });
    });
  }
  // Numbers that moved: the same source line has another number (or none) in a view after the move.
  const shifts = [];
  for (const x of changed) {
    const b = before.get(x);
    const a = after.get(x);
    const now = new Map(itemsOf(a.lines).map((it) => [`${it.kind}:${a.lineMap[it.index]}`, it.n]));
    for (const it of itemsOf(b.lines)) {
      const n = now.get(`${it.kind}:${b.lineMap[it.index]}`) ?? null;
      if (n !== it.n) shifts.push({ release: x, kind: it.kind, from: it.n, to: n });
    }
  }
  // Citations of a shifted number in the source's own text, read in the views (before) that hold the line.
  const citations = [];
  const selfMentions = [];
  for (const l of src.body) {
    if (movedLines.has(l.index)) continue;
    for (const m of l.text.matchAll(/(?<![\p{L}\p{N}_-])(FR|AC|EC)\s?(\d+)(?![\p{N}])/gu)) {
      for (const x of changed) {
        if (!before.get(x).lineMap.includes(l.index)) continue;
        const sh = shifts.find((q) => q.release === x && q.kind === m[1] && q.from === Number(m[2]));
        if (sh) citations.push({ line: l.index + 1, release: x, ref: `${m[1]} ${m[2]}`, to: sh.to });
      }
    }
    for (const ph of phrases) if (l.text.includes(ph)) selfMentions.push({ phrase: ph, line: l.index + 1 });
  }
  return { text: out, releases, moved, changed, phrases: [...phrases], variants, shifts, citations, selfMentions };
}
