import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome } from "../../auth/api.ts";
import type { Goal } from "../goals/model.ts";
import type { Money } from "./wizard.ts";
import { createBody, type AllocationRow } from "./wizard.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-02@PoC FR 15, AC6, AC7 (wave 2, row 31, UI): what the step «Розподіл» (S-287) and the bottom strip of the limits
 * step read — the server's `POST /v1/budget/allocation` (a calculation, nothing is saved: the difference, its kind, the
 * typed rows against it, «Можна витратити в <місяць> ≈ M») and the lists the rows are made of (goals, debts). The screen
 * computes no sum, difference, rest or status; the amounts leave as decimal strings in typed rows, the same as in
 * `POST /v1/budget` (never `chosen`, which counts a goal twice, #661).
 */
export type Allocation = Json<operations["previewBudgetAllocation"]>;
type DebtItem = Json<operations["listDebts"]>["debts"][number];
type AccountItem = Json<operations["listAccounts"]>["items"][number];

export interface DebtRow {
  readonly id: string;
  readonly name: string;
  readonly balance: Money;
  readonly annualRate: string | null;
  readonly minimum: Money | null;
}
export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly mask: string | null;
  /** Savings: the balance in the budget currency; a card: the available limit. */
  readonly amount: Money | null;
}
export interface Distribution {
  readonly goals: readonly Goal[];
  readonly debts: readonly DebtRow[];
  readonly savings: readonly SourceRow[];
  readonly cards: readonly SourceRow[];
}

const wallet = (a: AccountItem, currency: string): Money | null => {
  const w = a.currencies.find((c) => c.currency === currency);
  return w ? { amount: w.amount.amount, currency } : null;
};

export async function loadDistribution(
  api: ApiClient,
  currency: string,
): Promise<{ ok: true; data: Distribution } | { ok: false }> {
  const [goals, debts, accounts] = await Promise.all([
    outcome(api.GET("/v1/goals")),
    outcome(api.GET("/v1/debts")),
    outcome(api.GET("/v1/accounts", { params: { query: { limit: 100 } } })),
  ]);
  if (!goals.ok || !debts.ok || !accounts.ok) return { ok: false };
  const active = accounts.data.items.filter((a) => a.status === "active");
  return {
    ok: true,
    data: {
      goals: goals.data.goals.filter((g) => !g.achieved && g.target.currency === currency),
      debts: debts.data.debts
        .filter((d: DebtItem) => d.balance.currency === currency && d.balance.amount !== "0")
        .map((d: DebtItem) => ({
          id: d.accountId,
          name: d.name,
          balance: d.balance,
          annualRate: d.annualRate,
          minimum: d.monthlyPayment,
        })),
      savings: active
        .filter((a) => a.kind === "savings" || a.kind === "deposit")
        .map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.number?.masked ?? null,
          amount: wallet(a, currency),
        })),
      cards: active
        .filter((a) => a.kind === "credit-card")
        .map((a) => ({
          id: a.id,
          name: a.name,
          mask: a.number?.masked ?? null,
          amount: a.creditCard?.available ?? null,
        })),
    },
  };
}

export type PlanArgs = Omit<Parameters<typeof createBody>[0], "rows">;
export type AllocationRows = readonly AllocationRow[];

/** Keys of the amounts typed on «Розподіл»: `plan:` rows of a surplus, `src:` rows of a deficit. */
export const PLAN = "plan:";
export const SRC = "src:";

/**
 * The typed rows (`goal`, `debt`, `savings`, `from-goal`) of the amounts typed on the step, in the order of the keys
 * (BUD-02@PoC FR 15). An empty or zero amount is no row. «Із заощаджень» and «У борг» are not saved in PoC (owner,
 * 2026-11-20, Q3 а: «не зберігаються, і екран про це пише»; the server refuses both), so the step shows them as not
 * saved and no key of theirs becomes a row.
 */
export function allocationRows(
  chosen: ReadonlyMap<string, string | null>,
  kind: string | undefined,
  currency: string,
): AllocationRows {
  const prefix = kind === "surplus" ? PLAN : kind === "deficit" ? SRC : null;
  if (prefix === null) return [];
  const rows: AllocationRow[] = [];
  for (const [key, value] of chosen) {
    if (!key.startsWith(prefix) || value === null || !/[1-9]/.test(value)) continue;
    const amount = { amount: value, currency };
    const [, type, id] = key.split(":");
    if (prefix === PLAN) {
      if (type === "goal" && id) rows.push({ kind: "goal", goalId: id, amount });
      else if (type === "debt" && id) rows.push({ kind: "debt", accountId: id, amount });
      else if (type === "save") rows.push({ kind: "savings", amount });
    } else if (type === "goal" && id) rows.push({ kind: "from-goal", goalId: id, amount });
  }
  return rows;
}

/** The preview of the plan not saved yet: the same body as `POST /v1/budget`, with the typed rows of the step. */
export async function previewAllocation(api: ApiClient, args: PlanArgs, rows: AllocationRows) {
  return outcome(api.POST("/v1/budget/allocation", { body: createBody({ ...args, rows }) }));
}
