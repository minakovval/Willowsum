import type { ApiClient, operations } from "@willowsum/api-contract";
import { newIdempotencyKey } from "@willowsum/api-contract";
import { outcome } from "../../auth/api.ts";
import type { Load } from "../../recurring/data.ts";

type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

/**
 * BUD-02@PoC e) (wave 2, row 124): what the wizard S-122 … S-124 reads — `GET /v1/budget/wizard` (the three starts,
 * the offer «за моїми витратами»: the averages and the limits rounded by the server), `GET /v1/budget` (a budget
 * already there) and `GET /v1/categories` (the names and the groups). Every figure is the API's: the screen computes
 * no average, rounding, share of a period, surplus or deficit. The entered amounts leave as decimal strings.
 */
export type Wizard = Json<operations["getBudgetWizard"]>;
export type Start = Wizard["starts"][number];
type Tree = Json<operations["listCategories"]>;
export type Money = { amount: string; currency: string };

export interface WizardCategory {
  readonly id: string;
  readonly name: string;
  /** The server's average of the last 3 months (`fromSpending`), or null. */
  readonly average: Money | null;
  /** The server's suggestion rounded to 10, or null (`fromSpending`, less than 5 of the unit). */
  readonly suggested: Money | null;
}
export interface WizardGroup {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly WizardCategory[];
}

export type WizardData =
  | { readonly kind: "exists" }
  | {
      readonly kind: "ready";
      readonly wizard: Wizard;
      readonly currency: string;
      readonly groups: readonly WizardGroup[];
    };

export async function loadWizard(api: ApiClient): Promise<Load<WizardData>> {
  const budget = await outcome(api.GET("/v1/budget"));
  if (!budget.ok) return { state: "error", failure: budget };
  if (budget.data.budget !== null) return { state: "ready", data: { kind: "exists" } };
  const [wizard, tree, space] = await Promise.all([
    outcome(api.GET("/v1/budget/wizard")),
    outcome(api.GET("/v1/categories")),
    outcome(api.GET("/v1/space")),
  ]);
  if (!wizard.ok) return { state: "error", failure: wizard };
  if (!tree.ok) return { state: "error", failure: tree };
  if (!space.ok) return { state: "error", failure: space };
  return {
    state: "ready",
    data: {
      kind: "ready",
      wizard: wizard.data,
      currency: space.data.reportingCurrency,
      groups: groupsOf(tree.data, wizard.data),
    },
  };
}

function groupsOf(tree: Tree, wizard: Wizard): WizardGroup[] {
  const spending = new Map(wizard.fromSpending.categories.map((c) => [c.categoryId, c]));
  return tree.groups
    .filter((g) => g.kind === "expense")
    .map((g) => ({
      id: g.id,
      name: g.name,
      categories: g.categories
        .filter((c) => c.kind === "expense" && !c.hidden)
        .map((c) => ({
          id: c.id,
          name: c.name,
          average: spending.get(c.id)?.average ?? null,
          suggested: spending.get(c.id)?.limit ?? null,
        })),
    }))
    .filter((g) => g.categories.length > 0);
}

type Amount = { amount: string; currency: string };
/** A row of «Розподіл» as the contract has it; «Із заощаджень» and «У борг» are not saved in PoC and not sent. */
export type AllocationRow =
  | { kind: "goal" | "from-goal"; goalId: string; amount: Amount }
  | { kind: "debt"; accountId: string; amount: Amount }
  | { kind: "savings"; amount: Amount };

/** The body of `POST /v1/budget`: entered amounts as decimal strings; a category with an empty field has no limit. */
export function createBody(args: {
  readonly start: Start;
  readonly currency: string;
  readonly income: string | null;
  readonly limits: ReadonlyMap<string, string | null>;
  /** The typed rows of «Розподіл» (BUD-02@PoC FR 15); none — the key is left out. */
  readonly rows?: readonly AllocationRow[];
}) {
  const limits = [...args.limits]
    .filter((e): e is [string, string] => e[1] !== null)
    .map(([categoryId, amount]) => ({ categoryId, amount: { amount, currency: args.currency } }));
  return {
    // A first of the month has the one start; `period-start` is the current month, `next-period` the next one.
    firstPeriod: args.start.firstPeriod,
    proportional: args.start.start === "proportional",
    // An empty income plan is left out: the server's default is 0 (BUD-02 POST), not a figure of the client.
    ...(args.income !== null ? { incomePlan: { amount: args.income, currency: args.currency } } : {}),
    limits,
    ...(args.rows && args.rows.length > 0 ? { allocation: [...args.rows] } : {}),
  };
}

export async function createBudget(api: ApiClient, body: ReturnType<typeof createBody>, key: string) {
  return outcome(api.POST("/v1/budget", { params: { header: { "Idempotency-Key": key } }, body }));
}

export const newKey = newIdempotencyKey;
