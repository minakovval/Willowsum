/**
 * The category hints of the form «Нова транзакція» (FIN-03@PoC FR 30, FR 31; FR 15 for the order of the sources). Pure
 * rules, no I/O: the application reads the space's history and rules and passes them in.
 *
 * - FR 30: choosing a known counterparty fills in the category «за правилом» or, without a rule, the last category set
 *   by hand («вручну») for this merchant in the space («як раніше»).
 * - FR 31: the first group of the list «Категорія» — «Часто для <мерчанта>» when the counterparty is known, otherwise
 *   «Нещодавні».
 */
import type { CategorySource } from "./transaction-category.ts";

/** FR 31: at most this many categories in «Часто для <мерчанта>» or «Нещодавні». */
export const TOP_CATEGORIES_MAX = 3;

/** A categorized transaction of the space as the hints read it, newest first (date, then id). */
export interface HistoryRow {
  /** The shown merchant name of its counterparty (module merchants); null — no counterparty. */
  readonly merchant: string | null;
  readonly categoryId: string;
  readonly source: Exclude<CategorySource, "none">;
}

/**
 * FR 15 «остання ручна категорія цього мерчанта в просторі»: the category of the newest transaction of `merchant` whose
 * category was set by hand and still `fits`; null — none.
 */
export function lastManualCategory(
  history: readonly HistoryRow[],
  merchant: string,
  fits: (categoryId: string) => boolean,
): string | null {
  for (const row of history)
    if (row.merchant === merchant && row.source === "manual" && fits(row.categoryId)) return row.categoryId;
  return null;
}

/**
 * FR 31 «Часто для <мерчанта>»: the categories of `merchant`'s transactions that still `fit`, the most used first; a tie
 * goes to the one used most recently. At most `TOP_CATEGORIES_MAX`.
 */
export function frequentCategories(
  history: readonly HistoryRow[],
  merchant: string,
  fits: (categoryId: string) => boolean,
): string[] {
  const counts = new Map<string, { count: number; newest: number }>();
  history.forEach((row, index) => {
    if (row.merchant !== merchant || !fits(row.categoryId)) return;
    const seen = counts.get(row.categoryId);
    if (seen) seen.count += 1;
    else counts.set(row.categoryId, { count: 1, newest: index });
  });
  return [...counts]
    .sort(([, a], [, b]) => b.count - a.count || a.newest - b.newest)
    .slice(0, TOP_CATEGORIES_MAX)
    .map(([id]) => id);
}

/** FR 31 «Нещодавні»: the categories of the space's newest categorized transactions that still `fit`, distinct. */
export function recentCategories(
  history: readonly HistoryRow[],
  fits: (categoryId: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const row of history) {
    if (out.length === TOP_CATEGORIES_MAX) break;
    if (!out.includes(row.categoryId) && fits(row.categoryId)) out.push(row.categoryId);
  }
  return out;
}

/** The first group of the list «Категорія» (FR 31). */
export type TopCategories =
  | { readonly kind: "frequent"; readonly merchant: string; readonly categoryIds: readonly string[] }
  | { readonly kind: "recent"; readonly merchant: null; readonly categoryIds: readonly string[] };

/**
 * FR 31: «Часто для <мерчанта>» when the counterparty is a known merchant of the space (it has a transaction) and it
 * has categories to show; otherwise «Нещодавні» (a group with nothing in it is not shown, so the next one takes its
 * place).
 */
export function topCategories(
  history: readonly HistoryRow[],
  merchant: string | null,
  fits: (categoryId: string) => boolean,
): TopCategories {
  if (merchant !== null) {
    const frequent = frequentCategories(history, merchant, fits);
    if (frequent.length > 0) return { kind: "frequent", merchant, categoryIds: frequent };
  }
  return { kind: "recent", merchant: null, categoryIds: recentCategories(history, fits) };
}
