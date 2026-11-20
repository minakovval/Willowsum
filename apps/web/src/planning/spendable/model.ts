import type { ApiClient, operations } from "@willowsum/api-contract";
import { overLevel, type OverLevel } from "@willowsum/ui";
import { outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";
import { loadNames, type Names } from "../plan/model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-03@PoC b) (wave 2, row 126): what the card «Можна витратити» of S-121 reads — `GET /v1/budget/periods/{period}/spendable`
 * (BUD-03@PoC c, d): every sum, the daily limit, the overspend and the five rows come from the API; the web only
 * formats them (no money arithmetic here). `GET /v1/me/features` tells whether «План» (`budget.plan`) is on: the action
 * «Зменшити внесок у ціль цього місяця» opens its grid only then.
 */
export type Spendable = Json<operations["getBudgetSpendable"]>;
export type Figures = NonNullable<Spendable["figures"]>;
export type Money = Figures["amount"];

export interface SpendableData {
  readonly spendable: Spendable;
  /** `budget.plan` is on for the space (the grid of «План» exists); off — the goals' own page is the place. */
  readonly planOn: boolean;
}

/**
 * The card of a month without it: the API answers `NOT_FOUND` for a space without the function (flag
 * `budget.spendable` off) or a member whose scope closes the budget — the slot stays empty, nothing breaks.
 */
export type SpendableLoad = Load<SpendableData | null>;

export async function loadSpendable(api: ApiClient, period: string): Promise<SpendableLoad> {
  const [result, features] = await Promise.all([
    outcome(api.GET("/v1/budget/periods/{period}/spendable", { params: { path: { period } } })),
    outcome(api.GET("/v1/me/features")),
  ]);
  if (!result.ok) {
    if (result.kind === "problem" && result.problem.code === "NOT_FOUND")
      return { state: "ready", data: null };
    return { state: "error", failure: result };
  }
  // The features are only a hint for one action: without them the safe place (the goals' page) is used.
  const planOn = features.ok && (features.data.features as readonly string[]).includes("budget.plan");
  return { state: "ready", data: { spendable: result.data, planOn } };
}

/** The labels of the sources in the breakdown (payments, loans, goals, debts, categories); loaded when it opens. */
export interface SourceNames extends Names {
  readonly accounts: ReadonlyMap<string, string>;
}

export async function loadSourceNames(api: ApiClient): Promise<SourceNames | null> {
  const [names, accounts] = await Promise.all([loadNames(api), outcome(api.GET("/v1/accounts"))]);
  if (!names.ok) return null;
  return {
    ...names.data,
    accounts: new Map(accounts.ok ? accounts.data.items.map((a) => [a.id, a.name]) : []),
  };
}

/** The shade `over-1` … `over-8` of «Перевитрата» by the share of N in the optional limits (DS-23 FR 4). */
export const shadeOf = (overspend: NonNullable<Figures["overspend"]>): OverLevel =>
  overLevel(overspend.amount.amount, overspend.base.amount);

/** The source names that have no figure, in the order of the card's rows. */
export const SOURCE_KEYS = ["obligations", "incomes", "goals", "plannedExpenses"] as const;
