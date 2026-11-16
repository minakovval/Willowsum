import { useEffect, useState } from "react";
import { newIdempotencyKey, type paths } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../auth/api.ts";
import type { ApiClient } from "@willowsum/api-contract";

/** FIN-03@PoC d): the data of «Нова транзакція» (S-048) — the space's accounts, merchants and categories, and saving. */
export type Account =
  paths["/v1/accounts"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type Merchant =
  paths["/v1/merchants"]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type CategoryGroup =
  paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"]["groups"][number];
export type Transaction =
  paths["/v1/transactions"]["post"]["responses"]["201"]["content"]["application/json"];
export type TxType = "expense" | "income";
export type TxStatus = "posted" | "pending";

/** What a list of the form shows: a list that failed to load leaves its field empty, the form still works. */
export type Choices<T> = { readonly kind: "loading" } | { readonly kind: "ready"; readonly items: T };

const MAX_PAGES = 20;

async function loadAccounts(api: ApiClient): Promise<Account[] | null> {
  const rows: Account[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }),
    );
    if (!o.ok) return null;
    rows.push(...o.data.items);
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return rows.filter((a) => a.status === "active");
}

/**
 * The lists of the form, loaded once when it opens; `reload` after «Новий рахунок» or «Нова категорія». `null` items —
 * the list failed: the field says so (`accounts`) or stays empty (merchants, categories).
 */
export function useFormChoices(api: ApiClient): {
  accounts: Choices<Account[] | null>;
  merchants: Merchant[];
  groups: CategoryGroup[];
  reloadAccounts: () => Promise<Account[] | null>;
  reloadCategories: () => Promise<CategoryGroup[]>;
} {
  const [accounts, setAccounts] = useState<Choices<Account[] | null>>({ kind: "loading" });
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);

  const reloadAccounts = async () => {
    const rows = await loadAccounts(api);
    setAccounts({ kind: "ready", items: rows });
    return rows;
  };
  const reloadCategories = async () => {
    const o = await outcome(api.GET("/v1/categories"));
    const next = o.ok ? o.data.groups : [];
    setGroups(next);
    return next;
  };

  useEffect(() => {
    let live = true;
    void loadAccounts(api).then((rows) => {
      if (live) setAccounts({ kind: "ready", items: rows });
    });
    void outcome(api.GET("/v1/merchants")).then((o) => {
      if (live && o.ok) setMerchants(o.data.items.filter((m) => m.mergedInto === null));
    });
    void outcome(api.GET("/v1/categories")).then((o) => {
      if (live && o.ok) setGroups(o.data.groups);
    });
    return () => {
      live = false;
    };
  }, [api]);

  return { accounts, merchants, groups, reloadAccounts, reloadCategories };
}

/** FR 2: the amount is stored with its sign — «Списання» minus, «Надходження» plus; the field holds the size only. */
export function signed(amount: string, type: TxType): string {
  const size = amount.trim().replace(/^[+-]/, "");
  return type === "expense" ? `-${size}` : size;
}

/** An amount that moves no money («0», «0,00»): the server refuses it (issue `zero`). */
export const isZero = (amount: string): boolean => /^[+-]?0*(\.0*)?$/.test(amount.trim());

/** «Теги»: the names separated by commas, trimmed, without empty or repeated ones (case-insensitive). */
export function tagNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

export interface NewTransaction {
  accountId: string;
  currency: string;
  type: TxType;
  amount: string;
  date: string;
  counterparty: string;
  categoryId: string;
  description: string;
  tags: string[];
  status: TxStatus;
}

/** Why saving failed: a field the server refused, a closed account, or anything else with its support code. */
export type SaveFailure =
  | { readonly kind: "currency" }
  | { readonly kind: "future" }
  | { readonly kind: "closed" }
  | { readonly kind: "other"; readonly supportId?: string | undefined };

export type SaveResult =
  | { readonly kind: "saved"; readonly transaction: Transaction }
  /** The transaction is saved, its category or tags are not (they are separate requests). */
  | { readonly kind: "partial"; readonly transaction: Transaction }
  | { readonly kind: "failed"; readonly failure: SaveFailure };

function failureOf(o: Outcome<unknown>): SaveFailure {
  if (o.ok || o.kind === "network") return { kind: "other" };
  const issues = o.problem.errors ?? [];
  if (issues.some((i) => i.issue === "currency_mismatch")) return { kind: "currency" };
  if (issues.some((i) => i.issue === "date_in_future")) return { kind: "future" };
  if (o.problem.code === "ACCOUNT_CLOSED") return { kind: "closed" };
  return { kind: "other", supportId: o.supportId };
}

/**
 * «Додати транзакцію»: one request creates the transaction (one journal event, FR 2, FR 3; the key makes a repeated
 * press create it once); the category (BUD-01, «вручну») and the tags (BUD-13) are set after it by their own requests,
 * as the API has no such fields on create.
 */
export async function saveTransaction(api: ApiClient, tx: NewTransaction, key: string): Promise<SaveResult> {
  const created = await outcome(
    api.POST("/v1/transactions", {
      params: { header: { "Idempotency-Key": key } },
      body: {
        accountId: tx.accountId,
        amount: { amount: signed(tx.amount, tx.type), currency: tx.currency },
        date: tx.date,
        counterparty: tx.counterparty.trim() || null,
        description: tx.description.trim() || null,
        status: tx.status,
      },
    }),
  );
  if (!created.ok) return { kind: "failed", failure: failureOf(created) };
  const transaction = created.data;
  const path = { transactionId: transaction.id };
  const follow: Promise<Outcome<unknown>>[] = [];
  if (tx.categoryId)
    follow.push(
      outcome(
        api.PUT("/v1/transactions/{transactionId}/category", {
          params: { path },
          body: { categoryId: tx.categoryId },
        }),
      ),
    );
  if (tx.tags.length)
    follow.push(
      outcome(
        api.PATCH("/v1/transactions/{transactionId}/attributes", {
          params: { path },
          body: { tags: tx.tags },
        }),
      ),
    );
  const done = await Promise.all(follow);
  return { kind: done.every((o) => o.ok) ? "saved" : "partial", transaction };
}

export type AccountKind = Account["kind"];
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "current",
  "savings",
  "deposit",
  "cash",
  "credit-card",
  "loan",
];

/** «Новий рахунок» over the form (FR 32): the short form — type, name, currency and balance on today's date. */
export async function createAccount(
  api: ApiClient,
  input: { kind: AccountKind; name: string; currency: string; balance: string; today: string },
): Promise<Outcome<Account>> {
  const o = await outcome(
    api.POST("/v1/accounts", {
      params: { header: { "Idempotency-Key": newIdempotencyKey() } },
      body: {
        kind: input.kind,
        name: input.name.trim(),
        balance: { amount: input.balance, currency: input.currency },
        balanceDate: input.today,
      },
    }),
  );
  return o as Outcome<Account>;
}

/** «Нова категорія» (FR 31): a custom category in a group of the transaction's kind. */
export async function createCategory(
  api: ApiClient,
  input: { groupId: string; name: string },
): Promise<Outcome<{ id: string }>> {
  return (await outcome(
    api.POST("/v1/categories", { body: { groupId: input.groupId, name: input.name.trim() } }),
  )) as Outcome<{ id: string }>;
}
