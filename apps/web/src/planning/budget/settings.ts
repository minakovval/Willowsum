import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-02@PoC f) (wave 2, row 125): what S-128 «Рахунки бюджету» and S-288 «Загальне» read — `GET /v1/budget` (the
 * currency), `GET /v1/budget/accounts` (the switches) and `GET /v1/accounts` (the name, the mask, the kind and the
 * balance of a row). The balances are shown as the API gives them; the screen computes no money.
 */
export type Account = Json<operations["listAccounts"]>["items"][number];
export type BudgetAccount = Json<operations["listBudgetAccounts"]>["accounts"][number];

export interface SettingsRow {
  readonly account: Account;
  /** The saved state of the switch. */
  readonly included: boolean;
}

export type SettingsData =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly currency: string; readonly rows: readonly SettingsRow[] };

const MAX_PAGES = 20;

async function loadAccounts(api: ApiClient): Promise<Outcome<readonly Account[]>> {
  const rows: Account[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const o = await outcome(
      api.GET("/v1/accounts", {
        params: { query: { limit: 100, includeClosed: "true", ...(cursor ? { cursor } : {}) } },
      }),
    );
    if (!o.ok) return o;
    rows.push(...o.data.items);
    cursor = o.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return { ok: true, data: rows } as Outcome<readonly Account[]>;
}

export async function loadSettings(api: ApiClient): Promise<Load<SettingsData>> {
  const budget = await outcome(api.GET("/v1/budget"));
  if (!budget.ok) return { state: "error", failure: budget };
  if (budget.data.budget === null) return { state: "ready", data: { kind: "none" } };
  const [switches, accounts] = await Promise.all([
    outcome(api.GET("/v1/budget/accounts")),
    loadAccounts(api),
  ]);
  if (!switches.ok) return { state: "error", failure: switches };
  if (!accounts.ok) return { state: "error", failure: accounts };
  const included = new Map(switches.data.accounts.map((a) => [a.accountId, a.included]));
  const rows = accounts.data
    // A closed account that is still in the budget is listed so it can be switched off; other closed ones are not.
    .filter((a) => included.has(a.id) && (a.status === "active" || included.get(a.id) === true))
    .map((account) => ({ account, included: included.get(account.id) === true }));
  return { state: "ready", data: { kind: "ready", currency: budget.data.budget.currency, rows } };
}
