import { useCallback, useEffect, useState } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/**
 * FIN-12@PoC c), GRID-02@PoC FR 2 — what S-053 «Картка рахунку» reads. The account (`GET /v1/accounts/{id}`) decides
 * the page; its transactions and its regular payments are blocks of their own: when one fails, the rest of the card
 * stays (canvas «PoC · Стани»: «Не вдалося показати картку. Решта сторінки працює.»).
 */
export type AccountDetail =
  paths["/v1/accounts/{accountId}"]["get"]["responses"]["200"]["content"]["application/json"];
type TransactionItem =
  paths["/v1/transactions"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type RecurringPayment =
  paths["/v1/recurring/payments"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
type CategoryGroups =
  paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"]["groups"];

/** One block of the card. `missing` — the account is not in this space (or does not exist): «Не знайдено». */
export type Block<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly supportId?: string };

function failed(o: Exclude<Outcome<unknown>, { ok: true }>): Block<never> {
  if (o.kind === "problem" && o.problem.code === "NOT_FOUND") return { kind: "missing" };
  return o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" };
}

/** The category of a row: its name and the icon the category list gives it. */
export interface RowCategory {
  readonly name: string;
  readonly icon: string;
}

export interface AccountTransaction {
  readonly item: TransactionItem;
  /** `null`: «Без категорії». */
  readonly category: RowCategory | null;
}

export interface AccountTransactions {
  readonly rows: readonly AccountTransaction[];
  /** All shown transactions of the account: «Усі N транзакцій рахунку». */
  readonly count: number;
}

/** How many of the newest transactions the card shows (canvas PocMoneyAccount: «6 з 28»). */
export const CARD_ROWS = 6;

async function loadTransactions(api: ApiClient, accountId: string): Promise<Block<AccountTransactions>> {
  const list = await outcome(
    api.GET("/v1/transactions", {
      // The list's default order is the newest first (FIN-03 FR 13); 25 is its smallest page.
      params: { query: { filter: `accountId.eq:${accountId}`, pageSize: "25" } },
    }),
  );
  if (!list.ok) return failed(list);
  const items = list.data.items.slice(0, CARD_ROWS);
  if (items.length === 0) return { kind: "ready", data: { rows: [], count: list.data.count } };
  // The list carries no category: each shown row asks for its own (at most CARD_ROWS reads), the names come from
  // the category tree. A row whose category cannot be read would wrongly say «Без категорії», so any failure is
  // the block's error instead.
  const [tree, ...categories] = await Promise.all([
    outcome(api.GET("/v1/categories")),
    ...items.map((t) =>
      outcome(
        api.GET("/v1/transactions/{transactionId}/category", { params: { path: { transactionId: t.id } } }),
      ),
    ),
  ]);
  if (!tree.ok) return failed(tree);
  const names = categoryNames(tree.data.groups);
  const rows: AccountTransaction[] = [];
  for (const [i, item] of items.entries()) {
    const c = categories[i]!;
    if (!c.ok) return failed(c);
    const id = c.data.categoryId;
    rows.push({ item, category: id ? (names.get(id) ?? null) : null });
  }
  return { kind: "ready", data: { rows, count: list.data.count } };
}

function categoryNames(groups: CategoryGroups): Map<string, RowCategory> {
  const out = new Map<string, RowCategory>();
  for (const g of groups) for (const c of g.categories) out.set(c.id, { name: c.name, icon: c.icon });
  return out;
}

async function loadRecurring(api: ApiClient, accountId: string): Promise<Block<readonly RecurringPayment[]>> {
  const o = await outcome(api.GET("/v1/recurring/payments"));
  if (!o.ok) return failed(o);
  // The card's block names the payments charged to this account: expenses with a next charge, soonest first.
  const own = o.data.items
    .filter((p) => p.accountId === accountId && p.type === "expense" && p.nextDate !== null)
    .sort((a, b) => (a.nextDate ?? "").localeCompare(b.nextDate ?? "") || a.name.localeCompare(b.name));
  return { kind: "ready", data: own };
}

async function loadAccount(api: ApiClient, accountId: string): Promise<Block<AccountDetail>> {
  const o = await outcome(api.GET("/v1/accounts/{accountId}", { params: { path: { accountId } } }));
  return o.ok ? { kind: "ready", data: o.data } : failed(o);
}

/**
 * Reads on mount and on `retry()`; an answer that comes after unmount is dropped. Another account is another mount: the
 * page is keyed by the account (`AccountCardPage`).
 */
function useBlock<T>(
  accountId: string,
  load: (api: ApiClient, accountId: string) => Promise<Block<T>>,
): { state: Block<T>; retry: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Block<T>>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    // A throw is the error state, never an endless «loading».
    load(api, accountId).then(
      (r) => {
        if (live) setState(r);
      },
      () => {
        if (live) setState({ kind: "error" });
      },
    );
    return () => {
      live = false;
    };
  }, [api, accountId, load, attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}

export const useAccount = (accountId: string) => useBlock(accountId, loadAccount);
export const useAccountTransactions = (accountId: string) => useBlock(accountId, loadTransactions);
export const useAccountRecurring = (accountId: string) => useBlock(accountId, loadRecurring);
