import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome } from "../../auth/api.ts";
import type { Goal } from "../goals/model.ts";
import type { Money } from "./wizard.ts";
import { createBody } from "./wizard.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-02@PoC FR 15, AC6, AC7 (wave 2, row 31, UI): what the step «Розподіл» (S-287) and the bottom strip of the limits
 * step read — the server's `POST /v1/budget/allocation` (a calculation, nothing is saved: the difference, its kind, the
 * chosen amounts against it) and the lists the rows are made of (goals, debts, accounts). The screen computes no sum,
 * difference, rest or status; the chosen amounts leave as decimal strings.
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

export type PlanArgs = Parameters<typeof createBody>[0];

/** The preview of the plan not saved yet: the same body as `POST /v1/budget` and the chosen amounts. */
export async function previewAllocation(api: ApiClient, args: PlanArgs, chosen: readonly string[]) {
  const { firstPeriod, proportional, incomePlan, limits } = createBody(args);
  return outcome(
    api.POST("/v1/budget/allocation", {
      body: {
        firstPeriod,
        proportional,
        ...(incomePlan ? { incomePlan } : {}),
        limits,
        ...(chosen.length > 0
          ? { chosen: chosen.map((amount) => ({ amount, currency: args.currency })) }
          : {}),
      },
    }),
  );
}
