import {
  ANALYSIS_LIMITS,
  headerMatch,
  type Decision,
  type DateFormat,
  type Evidence,
  type Hypothesis,
  type NumberFormat,
  type Role,
  type SignMode,
  type StatementAnalysis,
} from "./analysis.ts";
import type { EventFlag, StatementEvents } from "./events.ts";
import { dateCell, dateFormatLabel, type DateOrder, type DecimalSeparator } from "./values.ts";

/**
 * A history file with the user's own categorisation (BUD-21@PoC FR 1, FR 4): the statement engine's decisions on the
 * table (date, amount, description, counterparty, formats, sign) and, on top of them, the roles of the user's own
 * columns — «категорія», «підкатегорія», «позначка переказу», «теги», «рахунок» — each with its alternatives and its
 * evidence, as in a statement's parse. These roles belong to the history file's parse only, never to a recipe
 * (Рішення ведучого (2026-11-27), BUD-21 FR 4): the recipe's `ROLES` do not change. Pure and deterministic.
 */
export const HISTORY_ROLES = ["category", "subcategory", "transfer-flag", "tags", "account"] as const;
export type HistoryRole = (typeof HISTORY_ROLES)[number];
/** A column's role in a history file: a statement role or one of the user's own. */
export type ColumnRole = Role | HistoryRole;

export const HISTORY_LIMITS = {
  /** Characters of a label, a tag cell, a transfer mark or an account value carried out of the worker. */
  valueChars: 200,
  /** Distinct values of the transfer column shown for the user's answer (more — the column is no flag). */
  transferValues: 50,
} as const;

/** What a history file must have for rules to be derived (FR 4, AC3, AC4); the client words each code. */
export const HISTORY_MISSING = ["date", "amount", "description", "categories"] as const;
export type HistoryMissing = (typeof HISTORY_MISSING)[number];

const HEADER_WORDS: Readonly<Record<HistoryRole, readonly string[]>> = {
  category: ["категорія", "категория", "category", "стаття", "стаття витрат"],
  subcategory: ["підкатегорія", "подкатегория", "subcategory", "sub category"],
  "transfer-flag": ["переказ", "перекази", "перевод", "transfer", "is transfer", "позначка переказу"],
  tags: ["теги", "тег", "мітки", "tags", "tag", "labels"],
  account: ["рахунок", "счет", "account", "картка", "гаманець", "wallet"],
};

/** A header that names a kind of operation («Тип»): a transfer column only when it holds a transfer mark. */
const TYPE_WORDS: readonly string[] = ["тип", "тип операції", "вид", "вид операції", "type", "kind"];

const TRANSFER_WORD = /переказ|перевод|трансфер|transfer/u;
/** Marks of «yes» in a column whose header says «переказ». */
const YES_MARKS: ReadonlySet<string> = new Set([
  "так",
  "yes",
  "true",
  "1",
  "x",
  "х",
  "+",
  "✓",
  "✔",
  "да",
  "y",
]);

/** Whether a value of the transfer column marks a transfer (the user may change the set on the review step). */
export function isTransferMark(value: string, transferHeader: boolean): boolean {
  const v = value.trim().toLocaleLowerCase("uk");
  if (v === "") return false;
  return TRANSFER_WORD.test(v) || (transferHeader && YES_MARKS.has(v));
}

export interface HistoryColumn {
  readonly column: number;
  readonly header: string | null;
  readonly role: Decision<ColumnRole>;
}

/** The user's corrections on the review step (FR 6): a column's role and the formats; the file is read again. */
export interface HistoryReadOptions {
  readonly columns?: readonly { readonly column: number; readonly role: ColumnRole }[];
  readonly dateOrder?: DateOrder;
  readonly decimalSeparator?: DecimalSeparator;
  readonly sign?: Extract<SignMode, "as-printed" | "invert">;
}

/** One row of the history file as read (FR 5): the statement's fields and the user's own, as printed (trimmed). */
export interface HistoryRow {
  /** The row of the file, from 1. */
  readonly row: number;
  readonly date: string | null;
  /** Signed decimal text in the row's currency; null — unreadable. */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly transferMark: string | null;
  readonly tags: string | null;
  readonly account: string | null;
  readonly flags: readonly EventFlag[];
}

export interface TransferValue {
  readonly value: string;
  readonly count: number;
  /** The engine's suggestion: this value marks a transfer. */
  readonly transfer: boolean;
}

/** Roles a single column takes at most (the statement's free ones: description, counterparty, ignore). */
const MULTI: ReadonlySet<ColumnRole> = new Set(["description", "counterparty", "ignore"]);

const filled = (row: readonly string[]): number => row.filter((c) => c.trim() !== "").length;

const clipExample = (cell: string): string => {
  const t = cell.trim();
  return t.length > ANALYSIS_LIMITS.exampleChars ? t.slice(0, ANALYSIS_LIMITS.exampleChars) : t;
};

interface Scored {
  readonly role: HistoryRole;
  readonly score: number;
  readonly word?: string;
}

/** The scores of the user's roles for one column: its header word, else what its cells hold. */
function historyScores(header: string | null, cells: readonly string[], text: boolean): Scored[] {
  const scored: Scored[] = [];
  const transferHeader = header ? headerMatch(header, HEADER_WORDS["transfer-flag"]) !== null : false;
  const marks = cells.filter((c) => isTransferMark(c, transferHeader)).length;
  const distinct = new Set(cells.map((c) => c.trim().toLocaleLowerCase("uk")).filter((c) => c !== "")).size;
  for (const role of Object.keys(HEADER_WORDS) as HistoryRole[]) {
    const match = header ? headerMatch(header, HEADER_WORDS[role]) : null;
    if (match) {
      scored.push({ role, score: match.score + (text ? 0.3 : 0.15), word: match.word });
      continue;
    }
    if (role === "transfer-flag" && marks > 0 && distinct <= 12) {
      const type = header ? headerMatch(header, TYPE_WORDS) : null;
      scored.push(type ? { role, score: type.score + 0.1, word: type.word } : { role, score: 0.5 });
    }
  }
  return scored;
}

const round2 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 100) / 100;

/**
 * FR 4: the role of every column of a history file — the statement engine's, unless a role of the user's own scores
 * higher; each user role goes to one column, the strongest first. The alternatives mix both kinds of roles.
 */
export function analyzeHistoryColumns(
  rows: readonly (readonly string[])[],
  headerRow: number | null,
  firstRow: number,
  analysis: StatementAnalysis,
): HistoryColumn[] {
  const from = headerRow === null ? firstRow : headerRow + 1;
  const sample = rows
    .slice(from)
    .filter((r) => filled(r) >= 2)
    .slice(0, ANALYSIS_LIMITS.sampleRows);
  const scored = analysis.columns.map((c) => {
    const cells = sample.map((r) => r[c.column - 1] ?? "");
    const text = c.role.evidence.some((e) => e.code === "content" && e.word === "text");
    return { c, cells, scores: historyScores(c.header, cells, text) };
  });
  const pairs = scored.flatMap((s, i) => s.scores.map((h) => ({ i, h })));
  pairs.sort(
    (a, b) =>
      b.h.score - a.h.score || a.i - b.i || HISTORY_ROLES.indexOf(a.h.role) - HISTORY_ROLES.indexOf(b.h.role),
  );
  const assigned = new Map<number, Scored>();
  const taken = new Set<HistoryRole>();
  for (const { i, h } of pairs) {
    if (assigned.has(i) || taken.has(h.role)) continue;
    if (h.score <= scored[i]!.c.role.chosen.score) continue;
    assigned.set(i, h);
    taken.add(h.role);
  }
  return scored.map(({ c, cells, scores }, i) => {
    const examples = cells.filter((x) => x.trim() !== "").slice(0, ANALYSIS_LIMITS.examples);
    const own = (s: Scored): Hypothesis<ColumnRole> => ({
      value: s.role,
      label: s.role,
      score: round2(s.score),
      examples: examples.map((x) => ({ cell: clipExample(x), reads: clipExample(x) })),
    });
    const mine = assigned.get(i);
    const statement: Hypothesis<ColumnRole>[] = [c.role.chosen, ...c.role.alternatives];
    const candidates = [...statement, ...scores.map(own)];
    const chosen = mine ? own(mine) : c.role.chosen;
    const alternatives = candidates
      .filter((h) => h.value !== chosen.value)
      .sort((a, b) => b.score - a.score)
      .slice(0, ANALYSIS_LIMITS.alternatives);
    const evidence: readonly Evidence[] = mine
      ? [
          ...(mine.word ? [{ code: "header-word" as const, column: c.column, word: mine.word }] : []),
          ...(mine.role === "transfer-flag"
            ? [
                {
                  code: "transfer-values" as const,
                  column: c.column,
                  count: cells.filter((x) => isTransferMark(x, true)).length,
                  of: cells.filter((x) => x.trim() !== "").length,
                },
              ]
            : []),
          ...c.role.evidence.filter((e) => e.code === "content"),
        ]
      : c.role.evidence;
    return { column: c.column, header: c.header, role: { chosen, alternatives, evidence, flags: [] } };
  });
}

/** FR 6: the user's role for a column; a single role leaves the column that had it («ignore»). */
export function withColumnRoles(
  columns: readonly HistoryColumn[],
  given: HistoryReadOptions["columns"] = [],
): HistoryColumn[] {
  let out = [...columns];
  for (const { column, role } of given) {
    const at = out.findIndex((c) => c.column === column);
    if (at < 0) continue;
    if (!MULTI.has(role))
      out = out.map((c, i) => (i !== at && c.role.chosen.value === role ? choose(c, "ignore") : c));
    out[at] = choose(out[at]!, role, true);
  }
  return out;
}

function choose(c: HistoryColumn, role: ColumnRole, user = false): HistoryColumn {
  const all = [c.role.chosen, ...c.role.alternatives];
  const chosen = all.find((h) => h.value === role) ?? {
    value: role,
    label: role,
    score: 0,
    examples: c.role.chosen.examples.map((e) => ({ cell: e.cell, reads: e.cell })),
  };
  return {
    ...c,
    role: {
      chosen,
      alternatives: all.filter((h) => h.value !== role).slice(0, ANALYSIS_LIMITS.alternatives),
      evidence: user ? [{ code: "user-choice", column: c.column }, ...c.role.evidence] : c.role.evidence,
      flags: [],
    },
  };
}

const userChoice = (column?: number): Evidence => ({ code: "user-choice", ...(column ? { column } : {}) });

/**
 * The statement analysis the rows are read with: the user's own columns are «ignore» (never a description or a
 * reference), the formats as the user chose them (FR 6, AC9).
 */
export function statementView(
  analysis: StatementAnalysis,
  columns: readonly HistoryColumn[],
  options: HistoryReadOptions,
): StatementAnalysis {
  const own = new Set<string>(HISTORY_ROLES);
  const roles = analysis.columns.map((c) => {
    const h = columns.find((x) => x.column === c.column)!;
    const value = h.role.chosen.value;
    if (own.has(value) || value === c.role.chosen.value) {
      if (!own.has(value)) return c;
      const ignore = c.role.alternatives.find((a) => a.value === "ignore") ?? {
        value: "ignore" as const,
        label: "ignore",
        score: 0,
        examples: [],
      };
      return { ...c, role: { ...c.role, chosen: ignore } };
    }
    return { ...c, role: h.role as Decision<Role> };
  });
  return {
    ...analysis,
    columns: roles,
    dates:
      options.dateOrder && analysis.dates ? withDateOrder(analysis.dates, options.dateOrder) : analysis.dates,
    numbers:
      options.decimalSeparator && analysis.numbers
        ? withDecimal(analysis.numbers, options.decimalSeparator)
        : analysis.numbers,
    sign: options.sign ? withSign(analysis.sign, options.sign) : analysis.sign,
  };
}

function withDateOrder(d: Decision<DateFormat>, order: DateOrder): Decision<DateFormat> {
  if (d.chosen.value.order === order) return d;
  const all = [d.chosen, ...d.alternatives];
  const cells = d.chosen.examples.flatMap((e) => (dateCell(e.cell) ? [dateCell(e.cell)!] : []));
  const chosen = all.find((h) => h.value.order === order) ?? {
    value: { order, format: cells.length > 0 ? dateFormatLabel(cells, order) : order },
    label: cells.length > 0 ? dateFormatLabel(cells, order) : order,
    score: 0,
    examples: [],
  };
  return {
    chosen,
    alternatives: all.filter((h) => h !== chosen),
    evidence: [userChoice(), ...d.evidence],
    flags: [],
  };
}

function withDecimal(n: Decision<NumberFormat>, decimal: DecimalSeparator): Decision<NumberFormat> {
  if (n.chosen.value.decimalSeparator === decimal) return n;
  const all = [n.chosen, ...n.alternatives];
  const chosen = all.find((h) => h.value.decimalSeparator === decimal) ?? {
    value: { decimalSeparator: decimal, thousandsSeparator: "none" as const },
    label: decimal,
    score: 0,
    examples: [],
  };
  return {
    chosen,
    alternatives: all.filter((h) => h !== chosen),
    evidence: [userChoice(), ...n.evidence],
    flags: [],
  };
}

function withSign(s: Decision<SignMode> | null, sign: "as-printed" | "invert"): Decision<SignMode> {
  const all = s ? [s.chosen, ...s.alternatives] : [];
  const chosen = all.find((h) => h.value === sign) ?? { value: sign, label: sign, score: 0, examples: [] };
  return {
    chosen,
    alternatives: all.filter((h) => h !== chosen),
    evidence: [userChoice(), ...(s?.evidence ?? [])],
    flags: [],
  };
}

/** FR 4, AC3, AC4: what the file lacks for rules to be derived. */
export function historyMissing(columns: readonly HistoryColumn[]): HistoryMissing[] {
  const has = (...roles: ColumnRole[]) => columns.some((c) => roles.includes(c.role.chosen.value));
  const missing: HistoryMissing[] = [];
  if (!has("date")) missing.push("date");
  if (!has("amount", "debit", "credit")) missing.push("amount");
  if (!has("description", "counterparty")) missing.push("description");
  if (!has("category", "subcategory", "transfer-flag")) missing.push("categories");
  return missing;
}

/** FR 5: each row's fields — the statement's from its events, the user's own from their columns. */
export function historyRows(
  rows: readonly (readonly string[])[],
  columns: readonly HistoryColumn[],
  events: StatementEvents,
): HistoryRow[] {
  const at = (role: HistoryRole): number => columns.find((c) => c.role.chosen.value === role)?.column ?? 0;
  const cols = Object.fromEntries(HISTORY_ROLES.map((r) => [r, at(r)])) as Record<HistoryRole, number>;
  return events.events.map((e) => {
    const r = rows[e.row - 1] ?? [];
    const flags = new Set<EventFlag>(e.flags);
    const value = (role: HistoryRole): string | null => {
      const c = cols[role];
      const t = c > 0 ? (r[c - 1] ?? "").trim() : "";
      if (t === "") return null;
      if (t.length <= HISTORY_LIMITS.valueChars) return t;
      flags.add("text-cut");
      return t.slice(0, HISTORY_LIMITS.valueChars);
    };
    const row = {
      row: e.row,
      date: e.date,
      amount: e.legs[0]?.amount ?? null,
      currency: e.currency,
      description: e.description,
      counterparty: e.counterparty,
      category: value("category"),
      subcategory: value("subcategory"),
      transferMark: value("transfer-flag"),
      tags: value("tags"),
      account: value("account"),
    };
    return { ...row, flags: [...flags].sort() };
  });
}

/** FR 5: the transfer column's values with their counts and whether each marks a transfer (the engine's suggestion). */
export function transferValues(
  rows: readonly HistoryRow[],
  columns: readonly HistoryColumn[],
): { readonly values: readonly TransferValue[]; readonly more: boolean } {
  const column = columns.find((c) => c.role.chosen.value === "transfer-flag");
  if (!column) return { values: [], more: false };
  const transferHeader =
    column.header !== null && headerMatch(column.header, HEADER_WORDS["transfer-flag"]) !== null;
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.transferMark !== null) counts.set(r.transferMark, (counts.get(r.transferMark) ?? 0) + 1);
  const all = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => ({ value, count, transfer: isTransferMark(value, transferHeader) }));
  return {
    values: all.slice(0, HISTORY_LIMITS.transferValues),
    more: all.length > HISTORY_LIMITS.transferValues,
  };
}
