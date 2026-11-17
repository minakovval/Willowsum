import { useCallback, useEffect, useState } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import {
  isIconName,
  PAGE_SIZES,
  type PageSize,
  type TransactionCategory,
  type TransactionColumn,
  type TransactionSort,
} from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/**
 * FIN-03@PoC c), DAT-01@PoC — what S-046 «Транзакції» reads: one numbered page of `GET /v1/transactions` (the server
 * pages, sorts, searches and totals, FR 5), the category of each shown row, the account names, and the numbers of
 * the tabs «До розбору · N» and «Пари · N».
 */
type ListAnswer = paths["/v1/transactions"]["get"]["responses"]["200"]["content"]["application/json"];
export type TransactionItem = ListAnswer["items"][number];
export type ListSummary = ListAnswer["summary"];
export type SummaryTotal = ListSummary["income"];
type Account =
  paths["/v1/accounts"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
type CategoryGroups =
  paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"]["groups"];

/** What the list keeps when the user leaves and comes back (DAT-01@PoC FR 7, AC1): page, size, sort, search. */
export interface ListView {
  page: number;
  pageSize: PageSize;
  sort: TransactionSort;
  search: string;
}

/** FIN-03@PoC FR 13: «Дата і час», the newest first. */
export const DEFAULT_SORT: TransactionSort = { column: "when", direction: "desc" };
export const DEFAULT_VIEW: ListView = { page: 1, pageSize: 25, sort: DEFAULT_SORT, search: "" };

/** The columns the server sorts by (the whitelist of the list) and the field each one asks for. */
const SORT_FIELD: Partial<Record<TransactionColumn, string>> = {
  merchant: "counterparty",
  when: "date",
  amount: "amount",
};
export const SORTABLE = Object.keys(SORT_FIELD) as TransactionColumn[];

/** The longest search the server accepts (`search.has`, 200 characters): the field takes no more. */
export const SEARCH_MAX_LENGTH = 200;

/**
 * A stored view as the list can send it (DAT-01@PoC FR 7): a page from 1, a size of the page-size choice, a sortable
 * column with its direction and a search the server accepts; anything else and the list starts from `DEFAULT_VIEW`.
 */
export function isListView(value: unknown): value is ListView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const sort = v.sort as Record<string, unknown> | null | undefined;
  return (
    Number.isSafeInteger(v.page) &&
    (v.page as number) >= 1 &&
    (PAGE_SIZES as readonly unknown[]).includes(v.pageSize) &&
    typeof sort === "object" &&
    sort !== null &&
    (SORTABLE as readonly unknown[]).includes(sort.column) &&
    (sort.direction === "asc" || sort.direction === "desc") &&
    typeof v.search === "string" &&
    v.search.length <= SEARCH_MAX_LENGTH
  );
}

/** A press on a header: the same column turns the direction, another one starts ascending (DAT-01@PoC FR 3). */
export function nextSort(sort: TransactionSort, column: TransactionColumn): TransactionSort {
  if (sort.column === column) return { column, direction: sort.direction === "asc" ? "desc" : "asc" };
  return { column, direction: "asc" };
}

export function sortParam(sort: TransactionSort): string {
  const field = SORT_FIELD[sort.column] ?? "date";
  return sort.direction === "desc" ? `-${field}` : field;
}

/** One row as the table shows it. `category` null — «Без категорії». */
export interface ListRow {
  readonly item: TransactionItem;
  readonly category: TransactionCategory | null;
  readonly account: string | undefined;
}

export interface ListPage {
  readonly rows: readonly ListRow[];
  readonly count: number;
  readonly summary: ListSummary;
}

export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string };

function failed(o: Exclude<Outcome<unknown>, { ok: true }>): Loaded<never> {
  if (o.kind === "problem" && (o.problem.code === "NOT_FOUND" || o.problem.code === "MODULE_UNAVAILABLE"))
    return { kind: "off" };
  return o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" };
}

/** «Поточний ··4417»: the name, then the masked last four characters when the account has a number. */
function accountLabel(a: Account): string {
  return a.number ? `${a.name} ··${a.number.last4}` : a.name;
}

const MAX_ACCOUNT_PAGES = 20;

async function accountNames(api: ApiClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ACCOUNT_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", {
        params: { query: { limit: 100, includeClosed: "true", ...(cursor ? { cursor } : {}) } },
      }),
    );
    // A list without names still works: the column shows «—» (the rows and the totals are what matters).
    if (!o.ok) return names;
    for (const a of o.data.items) names.set(a.id, accountLabel(a));
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return names;
}

/** The category tree: a category's name, its icon and the tone of its group (the chart palette, 1–8). */
function categoryIndex(groups: CategoryGroups): Map<string, TransactionCategory> {
  const out = new Map<string, TransactionCategory>();
  groups.forEach((g, i) => {
    const tone = g.kind === "service" ? "transfer" : (((i % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    for (const c of g.categories)
      out.set(c.id, { name: c.name, icon: isIconName(c.icon) ? c.icon : undefined, tone });
  });
  return out;
}

export async function loadPage(api: ApiClient, view: ListView): Promise<Loaded<ListPage>> {
  const query = view.search.trim();
  const list = await outcome(
    api.GET("/v1/transactions", {
      params: {
        query: {
          page: String(view.page),
          pageSize: String(view.pageSize) as "25" | "50" | "100",
          sort: sortParam(view.sort),
          ...(query ? { filter: `search.has:${query}` } : {}),
        },
      },
    }),
  );
  if (!list.ok) return failed(list);
  const items = list.data.items;
  // The list carries no category: each shown row asks for its own, the names come from the category tree. A row
  // whose category cannot be read would wrongly say «Без категорії», so any failure is the list's error instead.
  const [names, tree, ...categories] = await Promise.all([
    accountNames(api),
    outcome(api.GET("/v1/categories")),
    ...items.map((t) =>
      outcome(
        api.GET("/v1/transactions/{transactionId}/category", { params: { path: { transactionId: t.id } } }),
      ),
    ),
  ]);
  if (!tree.ok) return failed(tree);
  const index = categoryIndex(tree.data.groups);
  const rows: ListRow[] = [];
  for (const [i, item] of items.entries()) {
    const c = categories[i]!;
    if (!c.ok) return failed(c);
    const id = c.data.categoryId;
    rows.push({ item, category: id ? (index.get(id) ?? null) : null, account: names.get(item.accountId) });
  }
  return { kind: "ready", data: { rows, count: list.data.count, summary: list.data.summary } };
}

/**
 * The page of the list for `view`; a new view keeps the shown page on screen (`refreshing`) until the next one is
 * there, so the pagination and the toolbar stay in place. A throw is the error state, never an endless «loading».
 */
export function useTransactionsPage(view: ListView): {
  state: Loaded<ListPage>;
  refreshing: boolean;
  retry: () => void;
} {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const { page, pageSize, sort, search } = view;
  // The answer remembers what it answers: while it is not the current view's, the next page is on its way.
  const key = JSON.stringify([page, pageSize, sort.column, sort.direction, search, attempt]);
  const [answer, setAnswer] = useState<{ key: string; state: Loaded<ListPage> }>({
    key: "",
    state: { kind: "loading" },
  });
  useEffect(() => {
    let live = true;
    const settle = (state: Loaded<ListPage>) => {
      if (live) setAnswer({ key, state });
    };
    loadPage(api, { page, pageSize, sort: { column: sort.column, direction: sort.direction }, search }).then(
      settle,
      () => settle({ kind: "error" }),
    );
    return () => {
      live = false;
    };
    // `key` carries the view's parts and the attempt.
  }, [api, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => {
    setAnswer({ key: "", state: { kind: "loading" } });
    setAttempt((n) => n + 1);
  }, []);
  return { state: answer.state, refreshing: answer.key !== key, retry };
}

/** The numbers of the tabs: `null` until read or when the read failed — the tab then shows its name only. */
export function useTabCounts(): { review: number | null; pairs: number | null } {
  const api = useAuthApi();
  const [review, setReview] = useState<number | null>(null);
  const [pairs, setPairs] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/transaction-review")).then((o) => {
      if (live && o.ok) setReview(o.data.count);
    });
    void outcome(api.GET("/v1/transfer-proposals")).then((o) => {
      if (live && o.ok) setPairs(o.data.count);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return { review, pairs };
}
