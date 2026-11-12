// Requirement sources: one file per requirement whose slice text carries release tags; the release views
// (`<ID>.<release key>.md`) are generated from it. Format: docs/requirements/README.md, «Source and
// generated release views». Pure functions, no I/O.
import { SLICE_RELEASES, RELEASE_KEY } from './config.mjs';

/** The line that ends the card part of a source and starts its tagged slice text. */
export const SOURCE_MARKER = '## Джерело зрізів';

/** Line 2 of every generated view (`id` is the requirement ID, the file name of its source). */
export const viewHeader = (id) =>
  `> Згенеровано з [${id}.md](${id}.md) командою \`node tools/req-check/index.mjs --views\`. Не редагувати: змінюйте джерело.`;

const ONLY = 'лише';
const DASH = '–';
const RELEASE_ALT = SLICE_RELEASES.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|');
const TERM_RE = new RegExp(`^(?:(${ONLY}) (${RELEASE_ALT})|(${RELEASE_ALT})(?:${DASH}(${RELEASE_ALT}))?)$`, 'u');

/** Where a tag goes: after the indentation and a list marker (`1. `, `#. `, `- `) or a table pipe (`| `). */
const PREFIX_RE = /^(\s*(?:(?:\d+\.|#\.|[-*+]) |\| )?)/u;
const TAG_RE = /^\[([^\][]*)\](?: |$)/u;

/**
 * Parse a release expression: comma-separated terms `R` (R and every later release), `R–R2` (R to R2,
 * inclusive) and `лише R` (R only). Returns the set of releases, in build order, or null when it is not
 * a release expression.
 * @returns {string[]|null}
 */
export function parseTag(expr) {
  const terms = expr.split(',').map((t) => t.trim());
  const set = new Set();
  for (const t of terms) {
    const m = TERM_RE.exec(t);
    if (!m) return null;
    const from = SLICE_RELEASES.indexOf(m[2] ?? m[3]);
    const to = m[1] ? from : m[4] ? SLICE_RELEASES.indexOf(m[4]) : SLICE_RELEASES.length - 1;
    if (to < from) return null;
    for (let i = from; i <= to; i++) set.add(SLICE_RELEASES[i]);
  }
  return SLICE_RELEASES.filter((r) => set.has(r));
}

/**
 * Shortest tag for a set of the requirement's views. `views` are the requirement's view releases in build
 * order; `present` the subset in which the line appears. Releases without a view in between are ignored.
 * @returns {string} `PoC`, `PoC–MVP`, `лише PoC`, or comma-joined terms for a set with gaps
 */
export function formatTag(views, present) {
  const has = new Set(present);
  const runs = [];
  views.forEach((r, i) => {
    if (!has.has(r)) return;
    const last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else runs.push({ start: i, end: i });
  });
  return runs
    .map(({ start, end }) => {
      const a = views[start];
      if (end === views.length - 1) return a;
      return start === end ? `${ONLY} ${a}` : `${a}${DASH}${views[end]}`;
    })
    .join(', ');
}

/**
 * Split a source line into its tag and the plain line.
 * @returns {{releases: string[]|null, text: string, tag: string|null, bad: string|null}}
 *   releases null = untagged (every release); bad = a bracket that looks like a tag but does not parse
 */
export function splitTag(line) {
  const prefix = PREFIX_RE.exec(line)[1];
  const rest = line.slice(prefix.length);
  const m = TAG_RE.exec(rest);
  if (!m) return { releases: null, text: line, tag: null, bad: null };
  const releases = parseTag(m[1]);
  if (!releases) {
    const looksLikeTag = /PoC|MVP|v1|v2|лише/u.test(m[1]) && !/[«»(]/u.test(m[1]);
    return { releases: null, text: line, tag: null, bad: looksLikeTag ? m[1] : null };
  }
  return { releases, text: prefix + rest.slice(m[0].length), tag: m[1], bad: null };
}

/** Put a tag on a plain line (inverse of splitTag). */
export function joinTag(tag, text) {
  const prefix = PREFIX_RE.exec(text)[1];
  const rest = text.slice(prefix.length);
  return `${prefix}[${tag}]${rest === '' ? '' : ` ${rest}`}`;
}

/** True when a plain line would be read as tagged, so it must carry an explicit tag. */
export const looksTagged = (text) => splitTag(text).releases !== null;

const NUMBERED_RE = /^(\s*)(\d+|#)\. /;

/**
 * Number `#.` items of the lines of one view: `#` is the previous number of the same list plus one
 * (1 for the first). A numbered line closes deeper lists; any other non-blank line closes the lists at its
 * indentation and deeper.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function numberLines(lines) {
  const counters = new Map();
  const close = (fromIndent) => {
    for (const k of [...counters.keys()]) if (k >= fromIndent) counters.delete(k);
  };
  return lines.map((line) => {
    if (line.trim() === '') return line;
    const m = NUMBERED_RE.exec(line);
    if (!m) {
      close(/^\s*/.exec(line)[0].length);
      return line;
    }
    const indent = m[1].length;
    close(indent + 1);
    const n = m[2] === '#' ? (counters.get(indent) ?? 0) + 1 : Number(m[2]);
    counters.set(indent, n);
    return m[2] === '#' ? `${m[1]}${n}. ${line.slice(m[0].length)}` : line;
  });
}

/**
 * @typedef {object} SourceLine
 * @property {string} text          the plain line (tag removed, `#.` not yet numbered)
 * @property {string[]|null} releases  null = every release
 * @property {number} index         0-based line index in the source file
 * @property {string|null} tag
 * @property {string|null} bad
 */

/**
 * Parse a source file. Returns null when the text has no source marker (a plain card or an old-format file).
 * @param {string} text
 */
export function parseSource(text) {
  const lines = text.split('\n');
  const mi = lines.indexOf(SOURCE_MARKER);
  if (mi < 0) return null;
  const cardLines = lines.slice(0, Math.max(0, mi - 1));
  const separatorOk = mi > 0 && lines[mi - 1] === '';
  /** @type {SourceLine[]} */
  const body = lines.slice(mi + 1).map((line, k) => ({ ...splitTag(line), index: mi + 1 + k }));
  return { cardText: `${cardLines.join('\n')}\n`, cardLines: [...cardLines, ''], markerIndex: mi, separatorOk, body };
}

/** «Зрізи» of a card: the view releases in build order. */
export function viewReleases(id, cardLines) {
  const line = cardLines.find((l) => /^- Зрізи:/u.test(l));
  if (!line) return [];
  const out = [];
  for (const v of line.replace(/^- Зрізи:\s*/u, '').split(',')) {
    const m = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(${RELEASE_ALT})$`, 'u').exec(v.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Generate the release views of a parsed source.
 * @param {string} id     requirement ID
 * @param {string} title  title from the card heading
 * @param {ReturnType<typeof parseSource>} src
 * @param {string[]} releases  the views to generate (the card's «Зрізи»)
 * @returns {Map<string, {text: string, lines: string[], lineMap: number[]}>} release → view; lineMap[i] is
 *   the 0-based source line of view line i
 */
export function renderViews(id, title, src, releases) {
  const views = new Map();
  for (const r of releases) {
    const picked = src.body.filter((l) => !l.releases || l.releases.includes(r));
    const numbered = numberLines(picked.map((l) => l.text));
    const lines = [`# ${id}@${r} · ${title}`, viewHeader(id), ...numbered];
    const lineMap = [0, src.markerIndex, ...picked.map((l) => l.index)];
    views.set(r, { text: lines.join('\n'), lines, lineMap });
  }
  return views;
}

/** File name of a view: `BUD-16.poc-v2.md`. */
export const viewFileName = (id, release) => `${id}.${RELEASE_KEY[release]}.md`;

// ---------------------------------------------------------------------------------------------------
// Converter: card + slice files → source.

const normalize = (line) => line.replace(NUMBERED_RE, (_, sp) => `${sp}#. `);

/** Longest common subsequence of two string arrays; returns matched index pairs in order. */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Merge versions (arrays of lines) into one weave. Each entry has the versions it appears in, as a
 * contiguous range [from, to], and its original line in each of them. A version is matched only against
 * the lines of the previous version, so every range is contiguous.
 */
export function weave(versions) {
  /** @type {{key: string, from: number, to: number, orig: string[]}[]} */
  let w = versions[0].map((line) => ({ key: normalize(line), from: 0, to: 0, orig: [line] }));
  for (let k = 1; k < versions.length; k++) {
    const prev = w.filter((e) => e.to === k - 1);
    const cur = versions[k];
    const pairs = lcs(
      prev.map((e) => e.key),
      cur.map(normalize),
    );
    const matchOf = new Map(pairs.map(([i, j]) => [prev[i], j]));
    const next = [];
    let j = 0;
    const flush = (upto) => {
      for (; j < upto; j++) next.push({ key: normalize(cur[j]), from: k, to: k, orig: Object.assign([], { [k]: cur[j] }) });
    };
    for (const e of w) {
      const mj = matchOf.get(e);
      if (mj !== undefined) {
        flush(mj);
        e.to = k;
        e.orig[k] = cur[mj];
        j = mj + 1;
      }
      next.push(e);
    }
    flush(cur.length);
    w = next;
  }
  return w;
}

/**
 * Convert a card and its slice files into a source. Throws with a reason when the input does not have the
 * expected shape; the caller must still check the round trip (renderViews must give back every slice).
 * @param {string} id
 * @param {string} cardText
 * @param {{release: string, text: string}[]} slices  in release order
 * @returns {string} the source text
 */
export function convertToSource(id, cardText, slices) {
  if (!cardText.endsWith('\n')) throw new Error('the card does not end with a newline');
  if (cardText.split('\n').includes(SOURCE_MARKER)) throw new Error(`the card already has a "${SOURCE_MARKER}" line`);
  const releases = slices.map((s) => s.release);
  const versions = slices.map((s) => {
    const lines = s.text.split('\n');
    if (!lines[0].startsWith(`# ${id}@${s.release} · `)) throw new Error(`${s.release}: unexpected heading "${lines[0]}"`);
    return lines.slice(1);
  });
  for (const [k, v] of versions.entries()) {
    if (v.some((l) => /^\s*#\. /.test(l))) throw new Error(`${releases[k]}: a line starts with "#. ", which the source format reserves`);
  }
  const w = weave(versions);

  // Numbering: keep `#.` where automatic numbering gives the original number in every view; otherwise an
  // explicit number, or one variant line per run of equal numbers.
  const out = [];
  const counters = versions.map(() => []);
  const all = versions.length - 1;
  let inLinks = false;
  for (const e of w) {
    const ks = [];
    for (let k = e.from; k <= e.to; k++) ks.push(k);
    const m = NUMBERED_RE.exec(e.key);
    if (/^\*\*Зв['ʼ’]язки\*\*\s*$/u.test(e.key)) inLinks = true;
    else if (inLinks && !/^- /.test(e.key)) inLinks = false;
    const isItem = !inLinks && /^\s*(?:(?:\d+|#)\.|[-*+]) /.test(e.key);
    const emit = (text, from, to) => {
      const full = from === 0 && to === all;
      const needTag = !full || isItem || looksTagged(text);
      out.push(needTag ? joinTag(formatTag(releases, releases.slice(from, to + 1)), text) : text);
    };
    if (!m) {
      for (const k of ks) applyCounters(counters[k], e.orig[k]);
      emit(e.orig[e.from], e.from, e.to);
      continue;
    }
    const nums = ks.map((k) => Number(NUMBERED_RE.exec(e.orig[k])[2]));
    const auto = ks.map((k) => nextNumber(counters[k], e.orig[k]));
    for (const k of ks) applyCounters(counters[k], e.orig[k]);
    if (nums.every((n, i) => n === auto[i])) emit(e.key, e.from, e.to);
    else if (nums.every((n) => n === nums[0])) emit(e.orig[e.from], e.from, e.to);
    else {
      let start = 0;
      for (let i = 1; i <= ks.length; i++) {
        if (i === ks.length || nums[i] !== nums[start]) {
          emit(e.orig[ks[start]], ks[start], ks[i - 1]);
          start = i;
        }
      }
    }
  }
  return `${cardText}\n${SOURCE_MARKER}\n${out.join('\n')}`;
}

/** Number a `#.` item would get with these counters (same rule as numberLines). */
function nextNumber(counters, line) {
  const m = NUMBERED_RE.exec(line);
  const indent = m[1].length;
  return (counters[indent] ?? 0) + 1;
}

/** Advance per-indent counters over one original line (same rule as numberLines). */
function applyCounters(counters, line) {
  if (line.trim() === '') return;
  const m = NUMBERED_RE.exec(line);
  const indent = m ? m[1].length : /^\s*/.exec(line)[0].length;
  for (const k of Object.keys(counters)) if (Number(k) >= (m ? indent + 1 : indent)) delete counters[k];
  if (m) counters[indent] = Number(m[2]);
}

/**
 * Convert one requirement and prove the round trip: the source must give back the card unchanged and
 * every slice byte for byte, apart from the view header on line 2.
 * @param {string} id
 * @param {string} cardText
 * @param {{release: string, text: string}[]} slices  in release order
 * @returns {{ok: true, source: string, views: Map<string, string>} | {ok: false, reason: string}}
 */
export function convertRequirement(id, cardText, slices) {
  let source;
  try {
    source = convertToSource(id, cardText, slices);
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  const src = parseSource(source);
  if (src.cardText !== cardText) return { ok: false, reason: 'the card part does not round-trip' };
  const releases = viewReleases(id, src.cardLines);
  if (releases.join('|') !== slices.map((s) => s.release).join('|')) return { ok: false, reason: `«Зрізи» (${releases.join(', ') || 'none'}) do not match the slice files (${slices.map((s) => s.release).join(', ')})` };
  const title = /^# \S+ · (.+)$/u.exec(cardText.split('\n')[0])?.[1].trim() ?? '';
  const views = renderViews(id, title, src, releases);
  const out = new Map();
  for (const s of slices) {
    const v = views.get(s.release);
    const lines = [...v.lines];
    lines.splice(1, 1);
    if (lines.join('\n') !== s.text) {
      const orig = s.text.split('\n');
      const at = lines.findIndex((l, i) => l !== orig[i]);
      return { ok: false, reason: `${id}@${s.release} differs at line ${at + 1}` };
    }
    out.set(s.release, v.text);
  }
  return { ok: true, source, views: out };
}
