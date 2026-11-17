import { Money } from "@willowsum/domain-kernel";
import type { Merchant } from "./merchant.ts";

/**
 * BUD-12@PoC FR 14–16: «До розбору» in the mode «Мерчанти» — the space's queue grouped by merchant. Pure rules: the
 * queue arrives already counted and summed by counterparty and currency (module transactions, in SQL), and each
 * counterparty's shown merchant (FR 1, FR 3 of BUD-14: the one a merge joined it into, else its own).
 */

/** The key of the group of queued transactions that have no merchant (no counterparty, or nothing left of it). */
export const NO_MERCHANT_GROUP = "none";

/** The queued transactions of one counterparty in one currency, as module transactions counts them. */
export interface QueueSlice {
  /** The bank's description (or as typed); null — none. */
  readonly counterparty: string | null;
  readonly currency: string;
  readonly count: number;
  /** The signed sum of their amounts, an exact decimal string (minus — expenses). */
  readonly total: string;
  /** The date of the oldest of them (YYYY-MM-DD). */
  readonly oldest: string;
}

export interface ReviewGroup {
  /** The merchant's id, or `NO_MERCHANT_GROUP`. */
  readonly key: string;
  /** The merchant shown; null — the group of transactions without one. */
  readonly merchant: Merchant | null;
  /** FR 14, FR 15: how many transactions of the queue the group has. */
  readonly count: number;
  /** FR 14 «сума»: the signed sum per currency, by currency code; exact (never rounded here). */
  readonly totals: readonly Money[];
  /** The date of the group's oldest transaction (YYYY-MM-DD). */
  readonly oldest: string;
  /**
   * The group's most frequent original description (ties — the first by code point): what «Часто для <мерчанта>» (FR
   * 16) is asked with; null for the group without a merchant whose transactions have no description.
   */
  readonly counterparty: string | null;
  /** The counterparties of the group: what selects its transactions. `none` — also those without a counterparty. */
  readonly counterparties: readonly string[];
  readonly none: boolean;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * FR 14: the groups of the queue — one per shown merchant, one for the transactions without a merchant — with count,
 * sums per currency and the oldest date. Order: the largest first (the mode is there for the large groups, FR 14),
 * then the oldest first (the queue's order, FR 2), then by name and key, so a page never shifts on equal groups.
 */
export function groupReviewQueue(
  slices: readonly QueueSlice[],
  shown: ReadonlyMap<string, Merchant>,
): ReviewGroup[] {
  interface Acc {
    merchant: Merchant | null;
    count: number;
    totals: Map<string, Money>;
    oldest: string;
    byCounterparty: Map<string, number>;
    none: boolean;
  }
  const groups = new Map<string, Acc>();
  for (const slice of slices) {
    const merchant = slice.counterparty === null ? null : (shown.get(slice.counterparty) ?? null);
    const key = merchant?.id ?? NO_MERCHANT_GROUP;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        merchant,
        count: 0,
        totals: new Map(),
        oldest: slice.oldest,
        byCounterparty: new Map(),
        none: false,
      };
      groups.set(key, acc);
    }
    acc.count += slice.count;
    const total = Money.of(slice.total, slice.currency);
    const before = acc.totals.get(total.currency);
    acc.totals.set(total.currency, before ? before.plus(total) : total);
    if (slice.oldest < acc.oldest) acc.oldest = slice.oldest;
    if (slice.counterparty === null) acc.none = true;
    else
      acc.byCounterparty.set(
        slice.counterparty,
        (acc.byCounterparty.get(slice.counterparty) ?? 0) + slice.count,
      );
  }
  const out: ReviewGroup[] = [];
  for (const [key, acc] of groups) {
    const counterparties = [...acc.byCounterparty.keys()].sort(byCodePoint);
    let top: string | null = null;
    for (const c of counterparties)
      if (top === null || acc.byCounterparty.get(c)! > acc.byCounterparty.get(top)!) top = c;
    out.push({
      key,
      merchant: acc.merchant,
      count: acc.count,
      totals: [...acc.totals.values()].sort((a, b) => byCodePoint(a.currency, b.currency)),
      oldest: acc.oldest,
      counterparty: top,
      counterparties,
      none: acc.none,
    });
  }
  return out.sort(
    (a, b) =>
      b.count - a.count ||
      byCodePoint(a.oldest, b.oldest) ||
      (a.merchant?.name ?? "").localeCompare(b.merchant?.name ?? "", "uk") ||
      byCodePoint(a.key, b.key),
  );
}

/** FR 14 «запропонована категорія» of a group. */
export interface GroupSuggestion {
  /** The category most of the group's transactions have now (ties — the lower id); null — none has one. */
  readonly categoryId: string | null;
  /** Not every transaction of the group has `categoryId` (another one or none). */
  readonly mixed: boolean;
}

/**
 * FR 14: the suggested category of a group — the category its transactions have now (the card's «запропонована
 * категорія», FR 2: set by a rule, «як раніше», the bank or by hand), the most frequent one; «Без категорії» counts for
 * nothing unless no transaction has a category.
 */
export function suggestGroupCategory(categories: readonly (string | null)[]): GroupSuggestion {
  const counts = new Map<string, number>();
  for (const c of categories) if (c !== null) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: string | null = null;
  for (const [c, n] of counts) {
    const b = best === null ? 0 : counts.get(best)!;
    if (n > b || (n === b && best !== null && byCodePoint(c, best) < 0)) best = c;
  }
  return { categoryId: best, mixed: categories.some((c) => c !== best) };
}
