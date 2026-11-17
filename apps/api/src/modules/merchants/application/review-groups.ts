import {
  groupReviewQueue,
  NO_MERCHANT_GROUP,
  suggestGroupCategory,
  type GroupSuggestion,
  type Merchant,
  type ReviewGroup,
} from "../domain/index.ts";
import { shownMerchants, type MerchantsTx, type TransactionTextsPort } from "./merchants.ts";

/**
 * BUD-12@PoC FR 14–16 (server part): «До розбору» in the mode «Мерчанти». Module transactions counts and sums the queue
 * in SQL by counterparty and currency; here those slices become one group per shown merchant (BUD-14 FR 1, FR 3), the
 * page's groups get their suggested category from module categorization (its port, wired in main.ts: categorization
 * depends on this module, not the other way), and a group's transaction ids are paged for the bulk actions that
 * confirm the group or change its category (FR 14, FR 16).
 */

/** Module categorization's categories of transactions (`TransactionCategories`): an absent id has none. */
export interface TransactionCategoriesPort {
  categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * At most this many counterparty × currency slices of the queue are grouped, and at most this many transactions of a
 * page's groups are read for their suggested category — as the scan of the rules' «Показати» (BUD-14 FR 7). Beyond it
 * the answer says `truncated`.
 */
export const REVIEW_SCAN_MAX = 20_000;

export interface ReviewGroupsPage {
  readonly items: readonly (ReviewGroup & { readonly suggestion: GroupSuggestion })[];
  /** How many groups. */
  readonly count: number;
  /** FR 15: how many transactions the queue has (the progress counts transactions, not groups). */
  readonly transactionCount: number;
  readonly truncated: boolean;
}

async function groupsOf(
  tx: MerchantsTx,
  texts: TransactionTextsPort,
  householdId: string,
): Promise<{ readonly groups: ReviewGroup[]; readonly truncated: boolean }> {
  const { slices, more } = await texts.reviewQueueSlices(householdId, REVIEW_SCAN_MAX);
  const counterparties = slices.flatMap((s) => (s.counterparty === null ? [] : [s.counterparty]));
  // A description seen for the first time has its merchant born, as on every read of merchants (GET /v1/merchants).
  const shown: ReadonlyMap<string, Merchant> = await shownMerchants(tx, householdId, counterparties);
  return { groups: groupReviewQueue(slices, shown), truncated: more };
}

/** FR 14: one page of the groups, the largest first, each with its suggested category. */
export async function reviewGroups(
  tx: MerchantsTx,
  texts: TransactionTextsPort,
  categories: TransactionCategoriesPort,
  householdId: string,
  page: { readonly page: number; readonly pageSize: number },
): Promise<ReviewGroupsPage> {
  const { groups, truncated } = await groupsOf(tx, texts, householdId);
  const items = groups.slice((page.page - 1) * page.pageSize, page.page * page.pageSize);
  const groupOf = new Map<string, string>();
  let none = false;
  for (const g of items) {
    for (const c of g.counterparties) groupOf.set(c, g.key);
    none ||= g.none;
  }
  const members = new Map<string, string[]>(items.map((g) => [g.key, []]));
  let scanTruncated = false;
  if (items.length > 0) {
    const counterparties = [...groupOf.keys()];
    const byCounterparty = await texts.reviewQueueMembers(householdId, {
      counterparties,
      none,
      after: null,
      limit: REVIEW_SCAN_MAX,
    });
    scanTruncated = byCounterparty.more;
    for (const m of byCounterparty.items)
      members
        .get(m.counterparty === null ? NO_MERCHANT_GROUP : (groupOf.get(m.counterparty) ?? ""))
        ?.push(m.id);
  }
  const all = [...members.values()].flat();
  const categoryOf =
    all.length === 0 ? new Map<string, string>() : await categories.categoriesOf(householdId, all);
  return {
    items: items.map((g) => ({
      ...g,
      suggestion: suggestGroupCategory((members.get(g.key) ?? []).map((id) => categoryOf.get(id) ?? null)),
    })),
    count: groups.length,
    transactionCount: groups.reduce((n, g) => n + g.count, 0),
    truncated: truncated || scanTruncated,
  };
}

/**
 * FR 14, FR 16: the ids of a group's queued transactions, by id after `after`, at most `limit` — what «Підтвердити» of
 * the group and the pencil «Змінити категорію» select for their bulk actions. `groupKey` is a merchant shown in the
 * mode (one that joined another is no group: null) or `NO_MERCHANT_GROUP`.
 */
export async function reviewGroupIds(
  tx: MerchantsTx,
  texts: TransactionTextsPort,
  householdId: string,
  groupKey: string,
  page: { readonly after: string | null; readonly limit: number },
): Promise<{ readonly ids: readonly string[]; readonly next: string | null } | null> {
  if (groupKey !== NO_MERCHANT_GROUP) {
    const merchant = (await tx.byIds(householdId, [groupKey])).get(groupKey);
    if (!merchant || merchant.mergedInto !== null) return null;
  }
  const { groups } = await groupsOf(tx, texts, householdId);
  const group = groups.find((g) => g.key === groupKey);
  if (!group) return { ids: [], next: null };
  const { items, more } = await texts.reviewQueueMembers(householdId, {
    counterparties: group.counterparties,
    none: group.none,
    after: page.after,
    limit: page.limit,
  });
  const ids = items.map((m) => m.id);
  return { ids, next: more ? ids[ids.length - 1]! : null };
}
