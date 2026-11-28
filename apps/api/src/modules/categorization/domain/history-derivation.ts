import { currencyInfo, Decimal, isCurrencyCode } from "@willowsum/domain-kernel";
import { RULE_TAGS_MAX } from "./rule.ts";

/**
 * The derivation of category rules from a history file (BUD-21@PoC FR 11–15, FR 17; wave 2 row 235). Pure and
 * deterministic: the same rows always give the same suggestions in the same order (FR 11, AC29) — no clock, no
 * randomness, no external service. Every sort is total (it ends on the file's row number).
 *
 * A suggestion is built only from conditions the rule editor has (FR 11): «Мерчант дорівнює», «Опис містить», «Сума
 * більше за / менше за» (in one currency, on the amount without its sign), «Рахунок дорівнює» (only for a value matched
 * with an account of the space), all through «І», at most two of them here (the editor's limit is three).
 *
 * Candidates are checked in the order of FR 12, and the rows a candidate explained do not count for the later ones
 * (EC7: of two candidates that explain the same rows the earlier one stays).
 */

/** FR 10: up to this many rows the derivation runs in the request; above it — in the background with progress. */
export const DERIVATION_FOREGROUND_MAX = 2000;
/** FR 10, AC31: the rows of one derivation (a history file's ceiling, BUD-21 FR 3). */
export const DERIVATION_ROWS_MAX = 20_000;

/** A categorised row of the file as the derivation reads it (transfers and skipped rows are not here). */
export interface DerivationRow {
  /** The file's row, from 1: the evidence and the exceptions link to it. */
  readonly row: number;
  /** ISO date `YYYY-MM-DD`. */
  readonly date: string;
  /** Signed decimal text. */
  readonly amount: string;
  /** The row's currency (the file's, else its matched account's); null — no amount condition can hold for it. */
  readonly currency: string | null;
  /** FR 9: the shown merchant name of the row's text, by module merchants' cleaning; null — no merchant. */
  readonly merchant: string | null;
  /** The text a rule's «Опис» reads; null — none. */
  readonly description: string | null;
  /** FR 11: the account of the space the row's account value was matched with; null — not matched. */
  readonly accountId: string | null;
  /** The space's category of the row's label (BUD-21 b). */
  readonly categoryId: string;
  /** FR 17: the row's tags (already split and within 60 characters). */
  readonly tags: readonly string[];
}

export type SuggestionCondition =
  | { readonly field: "merchant"; readonly operator: "equals"; readonly value: string }
  | { readonly field: "description"; readonly operator: "contains"; readonly value: string }
  | {
      readonly field: "amount";
      readonly operator: "greater" | "less";
      readonly value: { readonly amount: string; readonly currency: string };
    }
  | { readonly field: "account"; readonly operator: "equals"; readonly value: string };

/** FR 13: «Впевнена» or «Суперечлива». */
export type SuggestionKind = "confident" | "conflicting";

export interface DerivedSuggestion {
  readonly kind: SuggestionKind;
  readonly conditions: readonly SuggestionCondition[];
  readonly categoryId: string;
  /** FR 13 N: the rows that match the conditions (from `since` on, FR 15). */
  readonly matched: number;
  /** How many of them have the suggestion's category. */
  readonly agreeing: number;
  /** FR 15: the date from which the user files such rows under the new category; null — no change of habit. */
  readonly since: string | null;
  /** FR 17: the tags at least 90 % of the agreeing rows share (as first spelt in the file). */
  readonly tags: readonly string[];
  /** The agreeing rows (the evidence), by date. */
  readonly rows: readonly number[];
  /** FR 14: the rows that match but have another category — «винятки у файлі», by date. */
  readonly exceptions: readonly number[];
}

/** The candidate's verdict of FR 13. */
type Verdict = SuggestionKind | "too-mixed" | "none";

interface Prepared extends DerivationRow {
  readonly index: number;
  readonly text: string | null;
  readonly unsigned: Decimal;
  readonly currencyCode: string | null;
}

/** Case and edge spaces do not count: the rule editor's «дорівнює» and «містить» compare the same way. */
const fold = (text: string): string => text.trim().toLowerCase();

const byCodePoints = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The rows by date, then by the file's row — the order of FR 15 and of the evidence. */
const byDate = (a: Prepared, b: Prepared): number => byCodePoints(a.date, b.date) || a.row - b.row;

interface Score {
  readonly verdict: Verdict;
  readonly categoryId: string;
  readonly since: string | null;
  readonly window: readonly Prepared[];
  readonly agreeing: number;
}

/** The most frequent category; a tie goes to the one of the latest row, then the smaller id. */
function topCategory(rows: readonly Prepared[]): { readonly categoryId: string; readonly count: number } {
  const counts = new Map<string, { count: number; last: number }>();
  rows.forEach((r, i) => {
    const c = counts.get(r.categoryId) ?? { count: 0, last: -1 };
    c.count += 1;
    c.last = i;
    counts.set(r.categoryId, c);
  });
  let best: { categoryId: string; count: number; last: number } | null = null;
  for (const [categoryId, c] of counts)
    if (
      !best ||
      c.count > best.count ||
      (c.count === best.count &&
        (c.last > best.last || (c.last === best.last && byCodePoints(categoryId, best.categoryId) < 0)))
    )
      best = { categoryId, ...c };
  return best ?? { categoryId: "", count: 0 };
}

/**
 * FR 13: «впевнена» — N ≥ 5 and a share of at least 90 %, or N of 3–4 all of one category; N ≥ 5 with a share of 60 %
 * to under 90 % may be «суперечлива» (`too-mixed` until FR 12's refinements were tried); else none. Integers only.
 */
function verdictOf(n: number, top: number): Verdict {
  if (n >= 5 && top * 10 >= n * 9) return "confident";
  if (n >= 3 && n <= 4 && top === n) return "confident";
  if (n >= 5 && top * 10 >= n * 6) return "too-mixed";
  return "none";
}

/**
 * FR 13, FR 15: a candidate's score over its rows (sorted by date). A change of habit — at least the 3 latest rows of
 * one category other than the most frequent of all time, with no other category after the first of them — scores the
 * candidate on the rows from that date only; the older rows are no exceptions.
 */
function scoreOf(rows: readonly Prepared[]): Score {
  const top = topCategory(rows);
  let window: readonly Prepared[] = rows;
  let since: string | null = null;
  const last = rows[rows.length - 1];
  if (last) {
    let first = rows.length - 1;
    while (first > 0 && rows[first - 1]!.categoryId === last.categoryId) first -= 1;
    if (rows.length - first >= 3 && last.categoryId !== top.categoryId) {
      since = rows[first]!.date;
      // From that date: a row of another category on the same day before it is an exception, not an older row.
      let from = first;
      while (from > 0 && rows[from - 1]!.date === since) from -= 1;
      window = rows.slice(from);
    }
  }
  const inWindow = since === null ? top : topCategory(window);
  return {
    verdict: verdictOf(window.length, inWindow.count),
    categoryId: inWindow.categoryId,
    since,
    window,
    agreeing: inWindow.count,
  };
}

/** FR 17: the tags at least 90 % of the agreeing rows share — each as first spelt, by its folded form. */
function sharedTags(agreeing: readonly Prepared[]): string[] {
  if (agreeing.length === 0) return [];
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of agreeing) {
    const seen = new Set<string>();
    for (const t of r.tags) {
      const key = fold(t);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const c = counts.get(key) ?? { name: t.trim(), count: 0 };
      c.count += 1;
      counts.set(key, c);
    }
  }
  return [...counts]
    .filter(([, c]) => c.count * 10 >= agreeing.length * 9)
    .sort((a, b) => byCodePoints(a[0], b[0]))
    .slice(0, RULE_TAGS_MAX)
    .map(([, c]) => c.name);
}

function suggestionOf(
  kind: SuggestionKind,
  conditions: readonly SuggestionCondition[],
  score: Score,
): DerivedSuggestion {
  const agreeing = score.window.filter((r) => r.categoryId === score.categoryId);
  return {
    kind,
    conditions,
    categoryId: score.categoryId,
    matched: score.window.length,
    agreeing: score.agreeing,
    since: score.since,
    tags: sharedTags(agreeing),
    rows: agreeing.map((r) => r.row),
    exceptions: score.window.filter((r) => r.categoryId !== score.categoryId).map((r) => r.row),
  };
}

/** The sum over groups of each group's most frequent category: how pure a split of the rows is (FR 12). */
const purity = (groups: readonly (readonly Prepared[])[]): number =>
  groups.reduce((n, g) => n + (g.length === 0 ? 0 : topCategory(g).count), 0);

interface Split {
  readonly purity: number;
  /** The groups a condition can name; the rest of the rows (no condition) only count for the purity. */
  readonly groups: readonly { readonly condition: SuggestionCondition; readonly rows: readonly Prepared[] }[];
}

/**
 * FR 12: «Сума більше за / менше за» — the best cut of the merchant's rows in their most common currency by the amount
 * without sign: the lower group «менше за» the smallest amount above the cut, the upper «більше за» the largest below
 * it (rounded to the currency's minor units, so the editor takes them). Rows in another currency are the rest.
 */
function amountSplit(rows: readonly Prepared[]): Split | null {
  const byCurrency = new Map<string, Prepared[]>();
  for (const r of rows) if (r.currencyCode !== null) push(byCurrency, r.currencyCode, r);
  const currencies = [...byCurrency].sort((a, b) => b[1].length - a[1].length || byCodePoints(a[0], b[0]));
  const chosen = currencies[0];
  if (!chosen) return null;
  const [currency, inCurrency] = chosen;
  const rest = rows.filter((r) => r.currencyCode !== currency);
  const sorted = [...inCurrency].sort((a, b) => a.unsigned.comparedTo(b.unsigned) || a.index - b.index);
  const minor = currencyInfo(currency).minorUnits;
  const restTop = rest.length === 0 ? 0 : topCategory(rest).count;
  // The top of every suffix, from a sweep from the end (counts only grow, so the running maximum is the top).
  const suffixTop: number[] = new Array<number>(sorted.length + 1).fill(0);
  const counts = new Map<string, number>();
  let max = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = (counts.get(sorted[i]!.categoryId) ?? 0) + 1;
    counts.set(sorted[i]!.categoryId, c);
    max = Math.max(max, c);
    suffixTop[i] = max;
  }
  counts.clear();
  max = 0;
  let best: { purity: number; cut: number; lower: Decimal; upper: Decimal } | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const c = (counts.get(sorted[i]!.categoryId) ?? 0) + 1;
    counts.set(sorted[i]!.categoryId, c);
    max = Math.max(max, c);
    const low = sorted[i]!.unsigned;
    const high = sorted[i + 1]!.unsigned;
    if (!high.greaterThan(low)) continue;
    const above = low.toDecimalPlaces(minor, Decimal.ROUND_UP);
    const below = high.toDecimalPlaces(minor, Decimal.ROUND_DOWN);
    if (!above.greaterThan(0) || !above.lessThan(high) || !below.greaterThan(low)) continue;
    const p = max + suffixTop[i + 1]! + restTop;
    if (!best || p > best.purity) best = { purity: p, cut: i, lower: above, upper: below };
  }
  if (!best) return null;
  return {
    purity: best.purity,
    groups: [
      {
        condition: {
          field: "amount",
          operator: "less",
          value: { amount: best.upper.toFixed(), currency },
        },
        rows: sorted.slice(0, best.cut + 1),
      },
      {
        condition: {
          field: "amount",
          operator: "greater",
          value: { amount: best.lower.toFixed(), currency },
        },
        rows: sorted.slice(best.cut + 1),
      },
    ],
  };
}

/** FR 11, FR 12, AC13: «Рахунок дорівнює» — one group per account of the space; an unmatched value is the rest. */
function accountSplit(rows: readonly Prepared[]): Split | null {
  const byAccount = new Map<string, Prepared[]>();
  const rest: Prepared[] = [];
  for (const r of rows)
    if (r.accountId === null) rest.push(r);
    else push(byAccount, r.accountId, r);
  if (byAccount.size === 0) return null;
  const groups = [...byAccount]
    .sort((a, b) => byCodePoints(a[0], b[0]))
    .map(([accountId, g]) => ({
      condition: { field: "account" as const, operator: "equals" as const, value: accountId },
      rows: g,
    }));
  return { purity: purity([...groups.map((g) => g.rows), rest]), groups };
}

/** FR 12: the words of a text — letters only, at least 3 of them; numbers and dates (any digit) are not taken. */
export function descriptionWords(folded: string): string[] {
  const words = new Set<string>();
  for (const w of folded.split(/[^\p{L}\p{M}'’ʼ-]+/u)) {
    const word = w.replace(/^[-'’ʼ]+|[-'’ʼ]+$/gu, "");
    if ([...word].length >= 3 && !/\d/u.test(word)) words.add(word);
  }
  return [...words];
}

/** FR 12: «Опис містить <слово>» — the word that splits the merchant's rows best; the rows without it are the rest. */
function wordSplit(rows: readonly Prepared[]): Split | null {
  const words = new Set<string>();
  for (const r of rows) if (r.text !== null) for (const w of descriptionWords(r.text)) words.add(w);
  let best: Split | null = null;
  for (const word of [...words].sort(byCodePoints)) {
    const holds = rows.filter((r) => r.text?.includes(word) === true);
    if (holds.length === rows.length) continue;
    const p = purity([holds, rows.filter((r) => r.text?.includes(word) !== true)]);
    if (!best || p > best.purity) {
      best = {
        purity: p,
        groups: [{ condition: { field: "description", operator: "contains", value: word }, rows: holds }],
      };
    }
  }
  return best;
}

/**
 * FR 12: the refinement of a merchant whose categories are mixed — the one condition that splits its rows into the
 * purest groups; on a tie the one earlier in the list (amount, account, word). None improves on the merchant alone —
 * null.
 */
function refine(rows: readonly Prepared[]): Split | null {
  const alone = topCategory(rows).count;
  let best: Split | null = null;
  for (const split of [amountSplit(rows), accountSplit(rows), wordSplit(rows)])
    if (split && split.purity > alone && (!best || split.purity > best.purity)) best = split;
  return best;
}

/** What FR 20 orders by: a suggestion, or a rule made of one (its amounts as Money, which serialises the same). */
export interface Orderable {
  readonly conditions: readonly { readonly field: string; readonly value: unknown }[];
  readonly matched: number;
  readonly categoryId: string;
  readonly rows: readonly number[];
}

/** The order of the result (FR 20 for accepted rules): confident first, more conditions, larger N, then the text. */
function compareSuggestions(a: DerivedSuggestion, b: DerivedSuggestion): number {
  return (a.kind === b.kind ? 0 : a.kind === "confident" ? -1 : 1) || compareAcceptance(a, b);
}

/**
 * FR 20 (row 237): the order of accepted rules among themselves — more conditions higher, then the larger N, then the
 * merchant's name or the word; total (it ends on the conditions, the category and the first row).
 */
export function compareAcceptance(a: Orderable, b: Orderable): number {
  const label = (s: Orderable) => {
    const c = s.conditions[0];
    return c && (c.field === "merchant" || c.field === "description") ? fold(String(c.value)) : "";
  };
  return (
    b.conditions.length - a.conditions.length ||
    b.matched - a.matched ||
    byCodePoints(label(a), label(b)) ||
    byCodePoints(JSON.stringify(a.conditions), JSON.stringify(b.conditions)) ||
    byCodePoints(a.categoryId, b.categoryId) ||
    (a.rows[0] ?? 0) - (b.rows[0] ?? 0)
  );
}

/**
 * FR 12: a word or phrase for «Опис містить» — the word, grown to the longest run of the first row's words around it
 * that every row still contains (so the condition reads as in the file), in the original case when it maps one to one.
 */
function phraseOf(word: string, rows: readonly Prepared[]): string {
  const first = rows[0];
  if (!first?.text || first.description === null) return word;
  const text = first.text;
  const at = text.indexOf(word);
  if (at < 0) return word;
  const tokens = [...text.matchAll(/[\p{L}\p{M}'’ʼ-]+/gu)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length }))
    .filter((t) => !/\d/u.test(text.slice(t.start, t.end)));
  let lo = tokens.findIndex((t) => t.start <= at && t.end >= at + word.length);
  if (lo < 0) return original(first, at, at + word.length);
  let hi = lo;
  const all = (start: number, end: number) => {
    const phrase = text.slice(start, end);
    return rows.every((r) => r.text?.includes(phrase) === true);
  };
  let start = at;
  let end = at + word.length;
  while (hi + 1 < tokens.length && all(start, tokens[hi + 1]!.end)) end = tokens[++hi]!.end;
  while (lo > 0 && all(tokens[lo - 1]!.start, end)) start = tokens[--lo]!.start;
  return original(first, start, end);
}

/** The original spelling of `text.slice(start, end)` when lowering the case kept every position; else the folded text. */
function original(row: Prepared, start: number, end: number): string {
  const trimmed = row.description!.trim();
  return trimmed.length === row.text!.length ? trimmed.slice(start, end) : row.text!.slice(start, end);
}

/**
 * FR 11–15, FR 17: the suggestions of the rows, in their order (`compareSuggestions`).
 */
export function deriveSuggestions(input: readonly DerivationRow[]): DerivedSuggestion[] {
  const rows: Prepared[] = input
    .map((r) => ({
      ...r,
      text: r.description === null || fold(r.description) === "" ? null : fold(r.description),
      unsigned: new Decimal(r.amount).abs(),
      currencyCode: r.currency !== null && isCurrencyCode(r.currency) ? r.currency : null,
    }))
    .sort((a, b) => byCodePoints(a.date, b.date) || a.row - b.row)
    .map((r, index) => ({ ...r, index }));
  const explained = new Uint8Array(rows.length);
  const out: DerivedSuggestion[] = [];
  const explain = (rs: readonly Prepared[]) => rs.forEach((r) => (explained[r.index] = 1));

  // FR 12, first: «Мерчант дорівнює X» for every merchant of the array (merchants are disjoint: their order is moot).
  const byMerchant = new Map<string, Prepared[]>();
  for (const r of rows)
    if (r.merchant !== null && fold(r.merchant) !== "") push(byMerchant, fold(r.merchant), r);
  for (const [, merchantRows] of [...byMerchant].sort((a, b) => byCodePoints(a[0], b[0]))) {
    merchantRows.sort(byDate);
    const merchant: SuggestionCondition = {
      field: "merchant",
      operator: "equals",
      value: merchantRows[0]!.merchant!.trim(),
    };
    const alone = scoreOf(merchantRows);
    if (alone.verdict === "confident") {
      out.push(suggestionOf("confident", [merchant], alone));
      explain(merchantRows);
      continue;
    }
    // FR 12, second: the merchant's categories are mixed — one refining condition.
    const split = new Set(merchantRows.map((r) => r.categoryId)).size > 1 ? refine(merchantRows) : null;
    const refined = (split?.groups ?? []).map((g) => {
      const groupRows = [...g.rows].sort(byDate);
      return { condition: g.condition, rows: groupRows, score: scoreOf(groupRows) };
    });
    const confident = refined.filter((g) => g.score.verdict === "confident");
    const mixed = refined.filter((g) => g.score.verdict === "too-mixed");
    if (confident.length > 0) {
      for (const g of confident) out.push(suggestionOf("confident", [merchant, g.condition], g.score));
      for (const g of mixed) out.push(suggestionOf("conflicting", [merchant, g.condition], g.score));
      for (const g of [...confident, ...mixed]) explain(g.rows);
    } else if (alone.verdict === "too-mixed") {
      // FR 13: «суперечлива» — no refining condition gave a confident suggestion.
      out.push(suggestionOf("conflicting", [merchant], alone));
      explain(merchantRows);
    } else {
      for (const g of mixed) {
        out.push(suggestionOf("conflicting", [merchant, g.condition], g.score));
        explain(g.rows);
      }
    }
  }

  // FR 12, third: «Опис містить <слово>» — words shared by rows without a merchant or by rows of two merchants or more
  // (each row without a merchant counts as a source of its own).
  const open = rows.filter((r) => explained[r.index] === 0 && r.text !== null);
  const byWord = new Map<string, Prepared[]>();
  for (const r of open) for (const w of descriptionWords(r.text!)) push(byWord, w, r);
  const sources = (rs: readonly Prepared[]) =>
    new Set(rs.map((r) => (r.merchant === null ? `#${r.index}` : `m:${fold(r.merchant)}`))).size;
  const words = [...byWord]
    .filter(([, rs]) => rs.length >= 3 && sources(rs) >= 2)
    .sort((a, b) => b[1].length - a[1].length || byCodePoints(a[0], b[0]));
  for (const [word] of words) {
    const holds = open.filter((r) => explained[r.index] === 0 && r.text!.includes(word));
    if (holds.length < 3 || sources(holds) < 2) continue;
    const score = scoreOf(holds);
    if (score.verdict !== "confident" && score.verdict !== "too-mixed") continue;
    const condition: SuggestionCondition = {
      field: "description",
      operator: "contains",
      value: phraseOf(word, holds),
    };
    out.push(suggestionOf(score.verdict === "confident" ? "confident" : "conflicting", [condition], score));
    explain(holds);
  }
  return out.sort(compareSuggestions);
}
