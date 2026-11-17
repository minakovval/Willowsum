import type { ApiClient, operations, paths } from "@willowsum/api-contract";
import { isIconName, type TransactionCategory } from "@willowsum/ui";
import { outcome, type Outcome } from "../auth/api.ts";
import { BULK_MAX, POLL_MS, type BulkReport } from "./bulk.ts";
import { accountNames, failed, type Loaded, type TransactionItem } from "./list.ts";

/**
 * BUD-12@PoC b) (wave 2, row 121): what S-058 «До розбору» reads and writes on the merged server parts — the queue
 * (`GET /v1/transactions?filter=review.eq:queued&sort=date`, oldest first, row 24), «Підтвердити» and its «Відмінити»
 * (`/review/confirm`, `/review/reopen`), the merchant groups and their ids (#491), the category of a transaction,
 * «Часто для <мерчанта>» (`/v1/category-suggestions`), the rule of «Запам'ятати» (`/v1/category-rules`) and the bulk
 * actions of a group (`transactions.set-category`, `transactions.confirm-category`).
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
type GroupsAnswer = Json<operations["listTransactionReviewGroups"]>;
export type ReviewGroup = GroupsAnswer["items"][number];
type CategoryGroups =
  paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"]["groups"];
export type ReviewCategoryGroup = CategoryGroups[number];

/** A category as the queue shows it: its name, icon and tone, and the kind of its group. */
export interface ReviewCategory extends TransactionCategory {
  readonly id: string;
  readonly kind: "expense" | "income" | "service";
  readonly groupId: string;
  readonly hidden: boolean;
}

/** The category tree, flat by id, and the groups in their order (for the picker). */
export interface Categories {
  readonly byId: ReadonlyMap<string, ReviewCategory>;
  readonly groups: readonly ReviewCategoryGroup[];
}

export function categoriesOf(groups: CategoryGroups): Categories {
  const byId = new Map<string, ReviewCategory>();
  groups.forEach((g, i) => {
    const tone = g.kind === "service" ? "transfer" : (((i % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    for (const c of g.categories)
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        icon: isIconName(c.icon) ? c.icon : undefined,
        tone,
        kind: g.kind,
        groupId: g.id,
        hidden: c.hidden,
      });
  });
  return { byId, groups };
}

/** One card of the mode «По одній»: the transaction, its category now (null — «Без категорії») and its account. */
export interface ReviewCard {
  readonly item: TransactionItem;
  readonly categoryId: string | null;
  readonly account: string | undefined;
  /** FR 7: the card was refreshed after a version conflict. */
  readonly changed?: boolean;
}

/** The groups of the mode «Мерчанти»: one page, the largest first; `truncated` — read from part of the queue. */
export interface ReviewGroups {
  readonly items: readonly ReviewGroup[];
  readonly count: number;
  readonly transactionCount: number;
  readonly truncated: boolean;
}

/** The first page of groups; `off` when grouping by merchant is switched off (the queue is then cards only). */
export async function loadGroups(api: ApiClient): Promise<Loaded<ReviewGroups>> {
  const o = await outcome(
    api.GET("/v1/transaction-review/merchant-groups", { params: { query: { page: "1", pageSize: "100" } } }),
  );
  if (!o.ok) return failed(o);
  const { items, count, transactionCount, truncated } = o.data;
  return { kind: "ready", data: { items, count, transactionCount, truncated } };
}

export async function loadCategories(api: ApiClient): Promise<Loaded<Categories>> {
  const o = await outcome(api.GET("/v1/categories"));
  return o.ok ? { kind: "ready", data: categoriesOf(o.data.groups) } : failed(o);
}

/** How many cards are read at once: the oldest of the queue (FR 2). */
export const CARD_PAGE = 25;

/** The oldest transactions of the queue with their categories and account names; `count` — the whole queue. */
export async function loadCards(api: ApiClient): Promise<Loaded<{ cards: ReviewCard[]; count: number }>> {
  const list = await outcome(
    api.GET("/v1/transactions", {
      params: {
        query: { page: "1", pageSize: String(CARD_PAGE) as "25", sort: "date", filter: ["review.eq:queued"] },
      },
    }),
  );
  if (!list.ok) return failed(list);
  const [names, ...categories] = await Promise.all([
    accountNames(api),
    ...list.data.items.map((t) => categoryOf(api, t.id)),
  ]);
  const cards: ReviewCard[] = [];
  for (const [i, item] of list.data.items.entries()) {
    const c = categories[i]!;
    // A card whose category cannot be read would wrongly offer «Без категорії»: the queue's error instead.
    if (!c.ok) return failed(c);
    cards.push({ item, categoryId: c.data, account: names.get(item.accountId) });
  }
  return { kind: "ready", data: { cards, count: list.data.count } };
}

async function categoryOf(api: ApiClient, id: string): Promise<Outcome<string | null>> {
  const o = await outcome(
    api.GET("/v1/transactions/{transactionId}/category", { params: { path: { transactionId: id } } }),
  );
  return o.ok ? { ok: true, data: o.data.categoryId } : o;
}

/** FR 7: the card again from the server, after «Підтвердити» was refused on a changed transaction. */
export async function reloadCard(api: ApiClient, card: ReviewCard): Promise<ReviewCard | null> {
  const [tx, category] = await Promise.all([
    outcome(
      api.GET("/v1/transactions/{transactionId}", { params: { path: { transactionId: card.item.id } } }),
    ),
    categoryOf(api, card.item.id),
  ]);
  if (!tx.ok || !category.ok) return null;
  return {
    item: tx.data as TransactionItem,
    categoryId: category.data,
    account: card.account,
    changed: true,
  };
}

/** FR 4: «Підтвердити» with the version and the category the card shows (FR 7). */
export const confirmCard = (api: ApiClient, item: TransactionItem, categoryId: string | null) =>
  outcome(
    api.POST("/v1/transactions/{transactionId}/review/confirm", {
      params: { path: { transactionId: item.id } },
      body: { version: item.version, categoryId },
    }),
  );

/** FR 6: «Відмінити» of a confirmation — the transaction is back in the queue. */
export const reopenCard = (api: ApiClient, item: TransactionItem) =>
  outcome(
    api.POST("/v1/transactions/{transactionId}/review/reopen", {
      params: { path: { transactionId: item.id } },
      body: { version: item.version },
    }),
  );

/** FR 4, FR 16: the pencil's category on one transaction (then confirmed). */
export const setCategory = (api: ApiClient, id: string, categoryId: string | null) =>
  outcome(
    api.PUT("/v1/transactions/{transactionId}/category", {
      params: { path: { transactionId: id } },
      body: { categoryId },
    }),
  );

/** FR 16: «Часто для <мерчанта>» — the categories the space uses most with the group's description. */
export async function frequentFor(api: ApiClient, counterparty: string | null): Promise<string[]> {
  if (!counterparty) return [];
  const o = await outcome(api.GET("/v1/category-suggestions", { params: { query: { counterparty } } }));
  return o.ok && o.data.top.kind === "frequent" ? o.data.top.categoryIds : [];
}

/** The most ids of a group read for one «Підтвердити» (the bulk selection takes at most 5 000). */
const GROUP_IDS_MAX = 5000;

/** FR 14, FR 16: every id of a group, page by page (ARC-07, at most 100 a page). */
export async function groupIds(api: ApiClient, groupId: string): Promise<Outcome<string[]>> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const o = await outcome(
      api.GET("/v1/transaction-review/merchant-groups/{groupId}/transactions", {
        params: { path: { groupId }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!o.ok) return o;
    ids.push(...o.data.items);
    cursor = o.data.nextCursor ?? undefined;
  } while (cursor && ids.length < GROUP_IDS_MAX);
  return { ok: true, data: ids };
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * One bulk action over `ids`, in parts of at most `BULK_MAX` records (DAT-03 FR 7), each awaited to its end: a part
 * that runs in the background is read every second until it is done. Fails at the first part that fails.
 */
export async function runBulk(
  api: ApiClient,
  action: "transactions.set-category" | "transactions.confirm-category",
  ids: readonly string[],
  params: Record<string, unknown>,
): Promise<Outcome<BulkReport[]>> {
  const reports: BulkReport[] = [];
  for (let at = 0; at < ids.length; at += BULK_MAX) {
    const part = ids.slice(at, at + BULK_MAX);
    const started = await outcome(
      api.POST("/v1/bulk-actions", {
        params: { header: { "Idempotency-Key": crypto.randomUUID() } },
        body: { action, selection: { kind: "ids", ids: part }, params },
      }),
    );
    if (!started.ok) return started;
    let report: BulkReport = started.data;
    while (report.status === "running") {
      await wait(POLL_MS);
      const read = await outcome(
        api.GET("/v1/bulk-actions/{actionId}", { params: { path: { actionId: report.id } } }),
      );
      if (!read.ok) return read;
      report = read.data;
    }
    reports.push(report);
  }
  return { ok: true, data: reports };
}

/** FR 14 «Запам'ятати: <мерчант> → <категорія>»: a rule for new transactions of the merchant. */
export const rememberRule = (api: ApiClient, merchant: string, categoryId: string) =>
  outcome(
    api.POST("/v1/category-rules", {
      body: { conditions: [{ field: "merchant", operator: "equals", value: merchant }], categoryId },
    }),
  );

export type { BulkReport };
