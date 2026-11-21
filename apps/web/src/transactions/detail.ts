import { useCallback, useEffect, useState } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import { isIconName, type TransactionCategory } from "@willowsum/ui";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";
import { maskedNumber } from "../accounts/format.ts";
import type { SplitCategory } from "./api.ts";

/**
 * FIN-03@PoC d) — what S-047 «Деталь транзакції» reads: the transaction (`GET /v1/transactions/{id}`; another space's or
 * a deleted one is «не знайдено», FIN-03@PoC AC12), its category with the source, the account's name, whether it is a
 * «Можливий дубль» now (FR 18: only then can it be hidden), and «Історія змін» (`…/history`, FR 20, FR 27).
 */
export type TransactionDetail =
  paths["/v1/transactions/{transactionId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type CategorySource =
  paths["/v1/transactions/{transactionId}/category"]["get"]["responses"]["200"]["content"]["application/json"]["source"];
export type HistoryAnswer =
  paths["/v1/transactions/{transactionId}/history"]["get"]["responses"]["200"]["content"]["application/json"];
export type HistoryEntry = HistoryAnswer["items"][number];
type CategoryGroups =
  paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"]["groups"];

export type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly supportId?: string };

export interface DetailData {
  readonly transaction: TransactionDetail;
  /** `null` — «Без категорії». */
  readonly category: TransactionCategory | null;
  readonly categorySource: CategorySource;
  /** «Поточний ··4417»; undefined when the account cannot be read (the line leaves it out). */
  readonly account: string | undefined;
  /** In a «Можливий дубль» pair now (FIN-03@PoC FR 12, FR 18). */
  readonly possibleDuplicate: boolean;
  /** Category and account names by id, for «Історія змін» and the parts of a split. */
  readonly names: ReadonlyMap<string, string>;
  /** The categories a part of «Розділити» may take (BUD-13@PoC FR 6): not hidden; the dialog keeps the transaction's type. */
  readonly splitCategories: readonly SplitCategory[];
  /** The flag `transactions.one-off` is on for the space (`GET /v1/me/features`); a failed read counts as off (BUD-06@PoC FR 8). */
  readonly oneOffOn: boolean;
}

function failed(o: Exclude<Outcome<unknown>, { ok: true }>): Loaded<never> {
  if (o.kind === "problem" && (o.problem.code === "NOT_FOUND" || o.problem.code === "MODULE_UNAVAILABLE"))
    return { kind: "missing" };
  return o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" };
}

/** The category tree as the list shows it: name, icon and the palette tone of its group (1–8; service — transfer). */
function categoryIndex(groups: CategoryGroups): Map<string, TransactionCategory> {
  const out = new Map<string, TransactionCategory>();
  groups.forEach((g, i) => {
    const tone = g.kind === "service" ? "transfer" : (((i % 8) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    for (const c of g.categories)
      out.set(c.id, { name: c.name, icon: isIconName(c.icon) ? c.icon : undefined, tone });
  });
  return out;
}

export async function loadDetail(api: ApiClient, transactionId: string): Promise<Loaded<DetailData>> {
  const path = { params: { path: { transactionId } } };
  const tx = await outcome(api.GET("/v1/transactions/{transactionId}", path));
  if (!tx.ok) return failed(tx);
  const accountId = tx.data.accountId;
  const [category, tree, account, duplicates, features] = await Promise.all([
    outcome(api.GET("/v1/transactions/{transactionId}/category", path)),
    outcome(api.GET("/v1/categories")),
    outcome(api.GET("/v1/accounts/{accountId}", { params: { path: { accountId } } })),
    outcome(api.GET("/v1/duplicate-proposals")),
    outcome(api.GET("/v1/me/features")),
  ]);
  // A wrong «Без категорії» is worse than the error state; the account name and the duplicate mark are extras.
  if (!category.ok) return failed(category);
  if (!tree.ok) return failed(tree);
  const index = categoryIndex(tree.data.groups);
  const names = new Map<string, string>();
  for (const [id, c] of index) names.set(id, c.name);
  const splitCategories: SplitCategory[] = tree.data.groups.flatMap((g) =>
    g.categories.filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
  );
  let accountName: string | undefined;
  if (account.ok) {
    const mask = account.data.number ? maskedNumber(account.data.number.last4) : null;
    accountName = mask ? `${account.data.name} ${mask}` : account.data.name;
    names.set(accountId, accountName);
  }
  const possibleDuplicate =
    duplicates.ok &&
    duplicates.data.items.some(
      (p) => p.first.transactionId === transactionId || p.second.transactionId === transactionId,
    );
  const id = category.data.categoryId;
  return {
    kind: "ready",
    data: {
      transaction: tx.data,
      category: id ? (index.get(id) ?? null) : null,
      categorySource: category.data.source,
      account: accountName,
      possibleDuplicate,
      names,
      splitCategories,
      oneOffOn: features.ok && (features.data.features as readonly string[]).includes("transactions.one-off"),
    },
  };
}

export async function loadHistory(api: ApiClient, transactionId: string): Promise<Loaded<HistoryAnswer>> {
  const o = await outcome(
    api.GET("/v1/transactions/{transactionId}/history", { params: { path: { transactionId } } }),
  );
  return o.ok ? { kind: "ready", data: o.data } : failed(o);
}

/**
 * Reads on mount and on `retry()`; an answer after unmount is dropped; a throw is the error state. `update` changes
 * the loaded data in place (a saved change answers with the new record), so the page keeps its focus and no skeleton
 * flashes.
 */
export function useLoaded<T>(
  key: string,
  load: (api: ApiClient, key: string) => Promise<Loaded<T>>,
): { state: Loaded<T>; retry: () => void; update: (change: (data: T) => T) => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded<T>>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    load(api, key).then(
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
  }, [api, key, load, attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  const update = useCallback((change: (data: T) => T) => {
    setState((old) => (old.kind === "ready" ? { kind: "ready", data: change(old.data) } : old));
  }, []);
  return { state, retry, update };
}

/** The actions of the menu «…», «Роз'єднати» (FIN-03@PoC FR 11, FR 16, FR 27) and «Об'єднати назад» (BUD-13@PoC FR 8). */
export type DetailAction = "hide" | "show" | "delete" | "unmerge" | "unsplit";

export async function runAction(
  api: ApiClient,
  transactionId: string,
  action: DetailAction,
): Promise<Outcome<unknown>> {
  const path = { params: { path: { transactionId } } };
  switch (action) {
    case "hide":
      return outcome(api.POST("/v1/transactions/{transactionId}/hide", path));
    case "show":
      return outcome(api.POST("/v1/transactions/{transactionId}/show", path));
    case "delete":
      return outcome(api.DELETE("/v1/transactions/{transactionId}", path));
    case "unmerge":
      return outcome(api.DELETE("/v1/transactions/{transactionId}/merge", path));
    case "unsplit":
      return unsplit(api, transactionId);
  }
}

/**
 * BUD-13@PoC FR 1, FR 2: «Нотатка» and «Теги» of S-047 (`PATCH …/attributes`; only the fields sent change, a tag the
 * space lacks is created) and FR 8 «Об'єднати назад» (`DELETE …/split`). Each answers with the transaction.
 */
export const saveAttributes = (
  api: ApiClient,
  transactionId: string,
  body: { note?: string | null; tags?: string[] },
): Promise<Outcome<TransactionDetail>> =>
  outcome(
    api.PATCH("/v1/transactions/{transactionId}/attributes", {
      params: { path: { transactionId } },
      body,
    }),
  );

export const unsplit = (api: ApiClient, transactionId: string): Promise<Outcome<TransactionDetail>> =>
  outcome(api.DELETE("/v1/transactions/{transactionId}/split", { params: { path: { transactionId } } }));

/** The tags of the space for the suggestions of «+ Тег» (BUD-13@PoC FR 2); a failed read offers none. */
export async function loadTagNames(api: ApiClient): Promise<string[]> {
  const o = await outcome(api.GET("/v1/transaction-tags"));
  return o.ok ? o.data.items.map((t) => t.name) : [];
}

/** BUD-06@PoC FR 8, AC4: «Одноразова витрата» on or off (`PUT …/one-off`); answers with the transaction. */
export const saveOneOff = (
  api: ApiClient,
  transactionId: string,
  oneOff: boolean,
): Promise<Outcome<TransactionDetail>> =>
  outcome(
    api.PUT("/v1/transactions/{transactionId}/one-off", {
      params: { path: { transactionId } },
      body: { oneOff },
    }),
  );
