import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, type Outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";
import { loadCompare, type CompareData } from "../compare/model.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * FLW-38@PoC FR 1 (wave 2, row 149): what S-135 «Підсумок періоду» reads — `GET /v1/budget/periods/{period}/summary`
 * (the income and the expenses against the plan of the snapshot, the net flow, the savings rate and the month's regular
 * payments), the payments' names from `GET /v1/recurring/payments` and the three largest changes against the average of
 * 3 months from `GET /v1/budget/compare`. Every amount is shown as the API gives it: nothing is added or divided here.
 */
export type Summary = Json<operations["getBudgetPeriodSummary"]>;
export type Money = Summary["netFlow"];
export type Regular = NonNullable<Summary["regularPayments"]>;
export type Charge = Regular["items"][number];
type Payments = Json<operations["listRecurringPayments"]>;

export interface SummaryData {
  readonly summary: Summary;
  /** The payments' names by id; a payment that is not in the list (removed since) has no name. */
  readonly names: ReadonlyMap<string, string>;
}

/** The two answers that are not a failure of the page: the month is not over, or the budget did not exist yet. */
export type Refusal = "notFinished" | "beforeStart";

export type SummaryLoad = Load<SummaryData | { readonly refusal: Refusal }>;

export const isRefusal = (
  d: SummaryData | { readonly refusal: Refusal },
): d is { readonly refusal: Refusal } => "refusal" in d;

/** `400 period: not_finished` (the current or a later month) and `404 BUDGET_PERIOD_BEFORE_START` are states, not errors. */
function refusalOf(o: Exclude<Outcome<unknown>, { ok: true }>): Refusal | null {
  if (o.kind !== "problem") return null;
  if (o.problem.code === "BUDGET_PERIOD_BEFORE_START") return "beforeStart";
  if (o.problem.code !== "VALIDATION_FAILED") return null;
  const errors = (o.problem as { errors?: readonly { issue?: string }[] }).errors ?? [];
  return errors.some((e) => e.issue === "not_finished") ? "notFinished" : null;
}

export async function loadSummary(api: ApiClient, period: string): Promise<SummaryLoad> {
  const [summary, payments] = await Promise.all([
    outcome(api.GET("/v1/budget/periods/{period}/summary", { params: { path: { period } } })),
    outcome(api.GET("/v1/recurring/payments")),
  ]);
  if (!summary.ok) {
    const refusal = refusalOf(summary);
    return refusal ? { state: "ready", data: { refusal } } : { state: "error", failure: summary };
  }
  // The names are labels: without the list the card still shows the dates and the amounts.
  const list: Payments["items"] = payments.ok ? payments.data.items : [];
  return {
    state: "ready",
    data: { summary: summary.data, names: new Map(list.map((p): [string, string] => [p.id, p.name])) },
  };
}

/** BUD-06 «Середнє за 3 міс.» of the month: the base of the three largest changes (FLW-38 FR 3, AC1). */
export const loadLargest = (api: ApiClient, period: string): Promise<Load<CompareData>> =>
  loadCompare(api, { type: "month", period, base: "avg3", full: false, view: "compare" });
