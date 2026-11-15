/**
 * The category of a transaction (BUD-01@PoC FR 1, FR 4, FR 5, FR 9; FIN-03@PoC FR 15). Pure rules, no I/O.
 *
 * «Без категорії» is not a category but the state of a transaction without one (FR 1): no category and the source
 * «немає». Every category set keeps its source (FR 4): «вручну», «за правилом», «як раніше», «з банку», «за словником».
 */

/** FR 4: where a category came from, highest priority first; «немає» — «Без категорії». */
export const CATEGORY_SOURCES = ["manual", "rule", "merchant", "bank", "dictionary", "none"] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

/** A transaction's category as stored: null with the source `none` — «Без категорії». */
export interface TransactionCategory {
  readonly categoryId: string | null;
  readonly source: CategorySource;
}

export const UNCATEGORIZED: TransactionCategory = Object.freeze({ categoryId: null, source: "none" });

/** The rank of a source (0 — «вручну», the highest; FR 4 «перше спрацювання вирішує»). */
export function rankOf(source: CategorySource): number {
  return CATEGORY_SOURCES.indexOf(source);
}

/**
 * FR 4 and the business rule «Пріоритет категорії»: the category of a transaction from the candidates of each source
 * — the first source that has one decides; none — «Без категорії». The system guesses nothing beyond this list.
 */
export function pickCategory(
  candidates: Partial<Record<Exclude<CategorySource, "none">, string | null | undefined>>,
): TransactionCategory {
  for (const source of CATEGORY_SOURCES) {
    if (source === "none") break;
    const id = candidates[source];
    if (typeof id === "string") return { categoryId: id, source };
  }
  return UNCATEGORIZED;
}

/**
 * Whether an automatic proposal (`next`, never «вручну») may replace the category a transaction has: only one of a
 * higher-priority source than the current one, and never a category set by hand (edge case «Банк змінив категорію після
 * ручної зміни — ручна категорія зберігається»). A change by the user (FR 5, AC8) is not a proposal: it always applies.
 */
export function proposalApplies(current: TransactionCategory, next: TransactionCategory): boolean {
  if (next.source === "manual" || next.source === "none") return false;
  if (current.source === "manual") return false;
  return rankOf(next.source) <= rankOf(current.source);
}

/** Facts of a transaction that decide whether its own category may change (from module transactions). */
export interface CategorizableFacts {
  /** A side of a transfer between own accounts: «Переказ», neither income nor expense (FR 7; FIN-03 FR 7). */
  readonly transfer: boolean;
  /** Split into parts: the parts have the categories (FR 6). */
  readonly split: boolean;
  /** A duplicate merged into another: changes only through «Роз'єднати» (FIN-03 FR 11). */
  readonly merged: boolean;
}

export type CategorizableIssue = "in_transfer" | "split" | "merged";

/**
 * Why a user's change of the category is refused, or null. A transfer side has «Переказ» (FR 7); a split transaction
 * has its parts' categories (FR 6, FIN-03 FR 23); a merged duplicate is read only (FIN-03 FR 11).
 */
export function refusal(facts: CategorizableFacts): CategorizableIssue | null {
  if (facts.merged) return "merged";
  if (facts.transfer) return "in_transfer";
  if (facts.split) return "split";
  return null;
}

/** A category of the space's tree as this module checks it (FR 9; from module categories). */
export interface CategoryFacts {
  readonly kind: "expense" | "income" | "service";
  readonly state: "active" | "hidden" | "retired";
}

/**
 * FR 9: a transaction takes only a category of its space's tree that is in use: unknown, of another space, merged away
 * (`retired`) or a service one («Переказ», «Коригування» — the system's, FR 1, FR 7) is «not found». A hidden one is
 * allowed (its transactions count in «Інше»). Its type is not checked against the amount's sign: a refund gets the
 * category of the purchase (FR 1 «Повернення коштів … отримує категорію початкової покупки»).
 */
export function categoryAllowed(category: CategoryFacts | null): boolean {
  return category !== null && category.state !== "retired" && category.kind !== "service";
}
