// Check 5: canonical product facts. Every mention matched by a fact's patterns must carry an allowed value.
import { tableCells, isTableSeparator } from '../markdown.mjs';

const CHECK = 'facts';

const UNIT_MAP = [
  [/^(дн|день|дні|доб)/u, 'd'],
  [/^робоч/u, 'bd'],
  [/^(год|h$)/u, 'h'],
  [/^(хв|min)/u, 'min'],
  [/^(с|сек|s$)/u, 's'],
  [/^тиж/u, 'w'],
  [/^міс/u, 'mo'],
  [/^(МБ|MB)/iu, 'MB'],
  [/^(ГБ|GB)/iu, 'GB'],
  [/^км/u, 'km'],
  [/^(м|m)$/u, 'm'],
  [/^%/u, '%'],
  [/^рядк/u, 'rows'],
  [/^(невдал|невірн|спроб|attempts)/u, 'attempts'],
];

export function normUnit(u) {
  if (!u) return '';
  const t = u.trim();
  for (const [re, v] of UNIT_MAP) if (re.test(t)) return v;
  return t;
}

const UNLIMITED_RE = /^(без ліміту|без обмежень|необмежено|∞|unlimited)$/iu;

/** Normalise a raw number + unit into "7 d", "20000 rows", "∞". */
export function normValue(num, unit, defaultUnit = '') {
  const n = String(num ?? '').trim();
  if (UNLIMITED_RE.test(n)) return '∞';
  const digits = n.replace(/[\s  ]/g, '').replace(',', '.');
  const u = normUnit(unit) || defaultUnit;
  return u ? `${digits} ${u}` : digits;
}

/** Normalise an allowed value written in facts.json ("7 d", "20 000 rows", "∞"). */
export function normAllowed(value) {
  const m = /^\s*([\d\s .,]+|∞)\s*(.*)$/u.exec(String(value));
  if (!m) return String(value).trim();
  return normValue(m[1], m[2]);
}

function compile(re, flags = 'giu') {
  return new RegExp(re, flags);
}

/** Compile facts.json into matchers. Throws with the fact id on a bad regex. */
export function compileFacts(spec) {
  return spec.facts.map((f) => {
    try {
      const base = {
        ...f,
        contextRe: f.context ? compile(f.context, 'iu') : null,
        excludeRe: f.exclude ? compile(f.exclude, 'iu') : null,
        window: f.window ?? 100,
      };
      if (f.type === 'plan') {
        return {
          ...base,
          contextGlobal: compile(f.context, 'giu'),
          allowedMap: Object.fromEntries(Object.entries(f.allowed).map(([k, v]) => [k, normAllowed(v)])),
        };
      }
      return {
        ...base,
        allowedSet: new Set(f.allowed.map(normAllowed)),
        patterns: f.patterns.map((p) => {
          const o = typeof p === 'string' ? { re: p } : p;
          return {
            re: compile(o.re),
            files: o.files ? compile(o.files, 'u') : null,
            contextRe: o.context ? compile(o.context, 'iu') : null,
          };
        }),
      };
    } catch (e) {
      throw new Error(`facts.json: fact "${f.id}": ${e.message}`);
    }
  });
}

function windowText(line, index, length, w) {
  return line.slice(Math.max(0, index - w), index + length + w);
}

function snippet(line, index, length, w = 40) {
  const s = Math.max(0, index - w);
  const e = Math.min(line.length, index + length + w);
  return `${s > 0 ? '…' : ''}${line.slice(s, e).replace(/\s+/g, ' ').trim()}${e < line.length ? '…' : ''}`;
}

const PLAN_NAMES = ['Free', 'Plus', 'Family', 'Trial'];
const NON_PLAN_UNIT_RE = /^\s*(міс|дн|день|дні|год|рок|хв|тиж|%)/u;
/** A value followed by «тому» ("3 год тому") is the age in an example, not a rule. */
const AGO_RE = /^\s*тому(?![\p{L}])/u;
const PLAN_TOKEN_RE =
  /(?<![\p{L}])(?<plan>Free|Plus|Family|Trial)(?![\p{L}])|(?<unl>без ліміту|без обмежень|необмежено|∞)|(?<![\p{L}\p{N}])(?<num>\d[\d   ]*(?:,\d+)?)(?:\s*(?<unit>ГБ|МБ|GB|MB)(?![\p{L}]))?/gu;

/**
 * Find plan/value assignments in a text: "Free 1 / Plus 2 / Family 6", "Free 25, Plus, Family
 * і Trial без ліміту". A value binds to the plans listed right before it.
 * @returns {{start: number, assignments: {plan: string, raw: string, value: string, index: number}[]}[]}
 */
export function parsePlanRuns(text) {
  const runs = [];
  let pending = [];
  let lastEnd = -1;
  let run = null;
  for (const m of text.matchAll(PLAN_TOKEN_RE)) {
    const gap = lastEnd >= 0 ? text.slice(lastEnd, m.index) : '';
    if (m.groups.plan) {
      if (pending.length && !/^[\s,/+]*(і|та|and)?[\s,/+]*$/u.test(gap)) pending = [];
      if (!pending.length && run && !/^[\s,/;·+(—-]*$/u.test(gap)) run = null;
      pending.push(m.groups.plan);
      if (!run) {
        run = { start: m.index, assignments: [] };
        runs.push(run);
      }
      lastEnd = m.index + m[0].length;
      continue;
    }
    if (!pending.length) continue;
    if (!/^[\s:—–=-]*$/u.test(gap)) {
      pending = [];
      continue;
    }
    // "Free — 3 міс." is a duration, not a count: drop the run.
    if (!m.groups.unit && !m.groups.unl && NON_PLAN_UNIT_RE.test(text.slice(m.index + m[0].length))) {
      pending = [];
      continue;
    }
    const raw = m[0].trim();
    const value = m.groups.unl ? '∞' : normValue(m.groups.num, m.groups.unit);
    for (const plan of pending) run.assignments.push({ plan, raw, value, index: m.index });
    pending = [];
    lastEnd = m.index + m[0].length;
  }
  return runs.filter((r) => r.assignments.length);
}

/** Turn a table with plan columns into synthetic "label: Free 1, Plus 2 …" lines. */
function planTableLines(lines) {
  const out = new Map();
  let header = null;
  lines.forEach((line, i) => {
    const cells = tableCells(line);
    if (!cells) {
      header = null;
      return;
    }
    if (isTableSeparator(line)) return;
    const plansPerCol = cells.map((c) => PLAN_NAMES.filter((p) => new RegExp(`(?<![\\p{L}])${p}(?![\\p{L}])`, 'u').test(c)));
    const isHeader = plansPerCol.filter((p) => p.length).length >= 2 && cells.every((c, k) => plansPerCol[k].length || !/\d/.test(c));
    if (isHeader) {
      header = plansPerCol;
      return;
    }
    if (!header) return;
    const first = header.findIndex((p) => p.length);
    const label = cells.slice(0, first).join(' ');
    const parts = [];
    header.forEach((plans, k) => {
      if (plans.length && cells[k] !== undefined && cells[k] !== '') parts.push(`${plans.join(', ')} ${cells[k]}`);
    });
    if (parts.length) out.set(i, `${label}: ${parts.join(', ')}`);
  });
  return out;
}

/** The plan fact whose context matches closest to the end of `text`. */
function nearestPlanFact(plan, text) {
  let best = null;
  for (const f of plan) {
    let pos = -1;
    for (const m of text.matchAll(f.contextGlobal)) pos = m.index + m[0].length;
    if (pos >= 0 && (!best || pos > best.pos)) best = { fact: f, pos, text };
  }
  return best;
}

/**
 * @param {ReturnType<import('../corpus.mjs').buildCorpus>} corpus
 * @param {import('../findings.mjs').Findings} out
 * @param {{facts: object[], planOtherFeatures?: string}} spec contents of facts.json
 */
export function checkFacts(corpus, out, spec) {
  const facts = compileFacts(spec);
  const scalar = facts.filter((f) => f.type !== 'plan');
  const plan = facts.filter((f) => f.type === 'plan');
  const otherRe = spec.planOtherFeatures ? new RegExp(spec.planOtherFeatures, 'iu') : null;
  /** @type {Map<string, {mentions: number, mismatches: number, values: Map<string, number>}>} */
  const stats = new Map(facts.map((f) => [f.id, { mentions: 0, mismatches: 0, values: new Map() }]));

  const record = (f, d, lineNo, raw, value, ok, line, index, length) => {
    const s = stats.get(f.id);
    s.mentions++;
    s.values.set(value, (s.values.get(value) ?? 0) + 1);
    if (ok) return;
    s.mismatches++;
    out.add({
      check: CHECK,
      rule: 'fact-mismatch',
      file: d.rel,
      line: lineNo,
      key: `${f.id}=${value}`,
      message: `${f.title}: found "${raw}" (${value}), canonical ${[...f.allowedSet].join(' or ')} «${snippet(line, index, length)}»`,
    });
  };

  for (const d of corpus.docs) {
    const tableLines = planTableLines(d.lines);
    d.lines.forEach((line, i) => {
      const lineNo = i + 1;
      // Scalar facts.
      for (const f of scalar) {
        const seen = new Set();
        for (const p of f.patterns) {
          if (p.files && !p.files.test(d.rel)) continue;
          for (const m of line.matchAll(p.re)) {
            const g = m.groups ?? {};
            if (g.v === undefined) continue;
            const vIndex = m.index + m[0].indexOf(g.v);
            if (seen.has(vIndex)) continue;
            if (AGO_RE.test(line.slice(m.index + m[0].length))) continue;
            const win = windowText(line, m.index, m[0].length, f.window);
            if (f.contextRe && !f.contextRe.test(win)) continue;
            if (p.contextRe && !p.contextRe.test(win)) continue;
            if (f.excludeRe && f.excludeRe.test(win)) continue;
            seen.add(vIndex);
            const value = normValue(g.v, g.u, f.unit ?? '');
            const raw = `${g.v.trim()}${g.u ? ` ${g.u}` : ''}`;
            record(f, d, lineNo, raw, value, f.allowedSet.has(value), line, m.index, m[0].length);
          }
        }
      }
      // Plan-limit facts: prose and plan-matrix tables.
      const texts = [line];
      if (tableLines.has(i)) texts.push(tableLines.get(i));
      for (const text of texts) {
        for (const run of parsePlanRuns(text)) {
          // The feature is named before the plan values: first in the same clause, otherwise
          // earlier in the line unless the clause names some other feature.
          const pre = text.slice(Math.max(0, run.start - 150), run.start);
          const cut = Math.max(...[...pre.matchAll(/[;|]|\.\s/gu)].map((m) => m.index + m[0].length), 0);
          const clause = pre.slice(cut);
          let hit = nearestPlanFact(plan, clause);
          if (!hit) {
            if (otherRe && otherRe.test(clause)) continue;
            hit = nearestPlanFact(plan, pre);
          }
          if (!hit) continue;
          const { fact: best, text: ctx, pos: bestPos } = hit;
          if (best.excludeRe && best.excludeRe.test(ctx.slice(Math.max(0, bestPos - 80)))) continue;
          for (const a of run.assignments) {
            const allowed = best.allowedMap[a.plan];
            if (allowed === undefined) continue;
            const ok = allowed === a.value;
            const s = stats.get(best.id);
            s.mentions++;
            s.values.set(`${a.plan} ${a.value}`, (s.values.get(`${a.plan} ${a.value}`) ?? 0) + 1);
            if (ok) continue;
            s.mismatches++;
            out.add({
              check: CHECK,
              rule: 'fact-mismatch',
              file: d.rel,
              line: lineNo,
              key: `${best.id}:${a.plan}=${a.value}`,
              message: `${best.title}: ${a.plan} "${a.raw}" (${a.value}), canonical ${a.plan} ${allowed} «${snippet(text, run.start, 60)}»`,
            });
          }
        }
      }
    });
  }
  return { facts, stats };
}
