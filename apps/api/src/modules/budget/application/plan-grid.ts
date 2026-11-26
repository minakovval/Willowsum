import { Money } from "@willowsum/domain-kernel";
import {
  cellPeriodIssue,
  gridMonths,
  incomePlanIssue,
  limitIssue,
  parseBudgetAmount,
  parseCategoryAmount,
  planGrid,
  type BudgetCategory,
  type BudgetIssue,
  type Period,
  type PeriodPlan,
  type PlanDebt,
  type PlanGrid,
  type PlanCell,
  type PlanLineKind,
  type PlanLines,
} from "../domain/index.ts";
import {
  cellHandOff,
  countsFrom,
  ensureSnapshots,
  livePlanToday,
  ratesOn,
  planLines,
  planOf,
  type BudgetDeps,
  type BudgetTx,
  type Caller,
  type Handed,
  type StoredBudget,
  type StoredLimit,
} from "./budget.ts";

/**
 * «Бюджет → План» (BUD-17@PoC a; wave 2 row 35): the grid of the current month and the 11 next (FR 1) — read with the
 * goals (module goals), the debts' minimum payments (`BudgetObligations`) and the extra payments of saved payoff plans
 * (module debt-payoff) — and the change of one cell (FR 2, FR 3).
 */
export async function readPlanGrid(
  deps: BudgetDeps,
  householdId: string,
  budget: StoredBudget,
  categories: readonly BudgetCategory[],
  /** The budget's own rows, read in one budget transaction before the other modules are read (their pools). */
  stored: {
    readonly limits: readonly StoredLimit[];
    /** BUD-02 FR 21, FR 24; FR 1: the income categories' plans — a row each, the section's sum at today's rate. */
    readonly incomePlans?: readonly StoredLimit[];
    readonly cells: readonly PlanCell[];
  },
): Promise<PlanGrid> {
  const today = deps.today();
  const months = gridMonths(today);
  const byId = new Map(categories.map((c) => [c.id, c]));
  // BUD-02 FR 24: a limit of another currency at today's rate, as on «Бюджет».
  const live = await livePlanToday(deps, budget, stored.limits, byId, stored.incomePlans ?? [], stored.cells);
  const base = new Map<Period, PeriodPlan>(months.map((p) => [p, planOf(budget, p, live)]));
  const cells = stored.cells;
  const goals = deps.planSources ? await deps.planSources.goals(householdId, budget.currency) : null;
  // #623 item 5: the months are read at once, not one call after another (up to 36 calls into other modules).
  const read = await Promise.all(
    months.map(async (p) => {
      if (p < budget.firstPeriod) return [] as PlanDebt[] | null;
      const [obligations, extra] = await Promise.all([
        deps.obligations
          ? deps.obligations.month(householdId, p, budget.currency, countsFrom(budget, p))
          : null,
        deps.planSources ? deps.planSources.extraPayments(householdId, p, budget.currency) : null,
      ]);
      if (!obligations || !extra) return null;
      const rows = new Map<string, PlanDebt>();
      for (const d of obligations.debtMinimums)
        rows.set(d.accountId, { accountId: d.accountId, minimum: d.amount, extra: null });
      for (const e of extra)
        rows.set(e.accountId, {
          accountId: e.accountId,
          minimum: rows.get(e.accountId)?.minimum ?? null,
          extra: e.amount,
        });
      // BUD-02 FR 15: the extra payment «Розподіл» planned for a debt this month is the month's own value — it wins
      // over the saved payoff plan's (BUD-17 FR 2); a debt the month no longer owes does not come back for it.
      for (const c of cells)
        if (c.period === p && c.kind === "debt" && c.amount !== null && c.lineId !== null) {
          const row = rows.get(c.lineId);
          if (row) rows.set(c.lineId, { ...row, extra: c.amount });
        }
      return [...rows.values()];
    }),
  );
  const debts = new Map<Period, PlanDebt[] | null>(months.map((p, i) => [p, read[i]!]));
  return planGrid({
    today,
    currency: budget.currency,
    firstPeriod: budget.firstPeriod,
    categories,
    base,
    cells,
    goals,
    debts,
    rates: live.allRates,
  });
}

export interface CellInput {
  readonly period: string;
  readonly kind: PlanLineKind;
  readonly lineId: string | null;
  /** Null — back to the line's default. */
  readonly amount: { readonly amount: string; readonly currency: string } | null;
  /** FR 3: the cell's version as the page read it (0 — the line had no own value in that month). */
  readonly version: number;
}

export type CellResult =
  | {
      readonly kind: "ok";
      readonly value: { readonly amount: Money | null; readonly version: number };
    }
  | { readonly kind: "invalid"; readonly issues: readonly BudgetIssue[] }
  | { readonly kind: "not-found" }
  | { readonly kind: "before-start" }
  /** FR 3: «Значення змінено в іншому вікні» — the page reads the cell again. */
  | { readonly kind: "conflict"; readonly version: number };

/**
 * Which line a cell may belong to (FR 1): an active expense category, an active income category of the budget's plan
 * (owner decision 2026-11-21, 2 б — `incomePlans`; one without a plan has no row: 404-like `not_found`), an active
 * goal, or none for «Заощадження без цілі».
 */
function lineIssue(
  input: CellInput,
  categories: ReadonlyMap<string, BudgetCategory>,
  lines: PlanLines,
  incomePlans: readonly StoredLimit[],
): string | null {
  switch (input.kind) {
    case "limit":
      return input.lineId === null ? "required" : limitIssue(categories.get(input.lineId));
    case "income": {
      if (input.lineId === null) return "required";
      const issue = incomePlanIssue(categories.get(input.lineId));
      if (issue) return issue;
      return incomePlans.some((l) => l.categoryId === input.lineId) ? null : "not_found";
    }
    case "goal":
      return input.lineId !== null && lines.goalIds.has(input.lineId) ? null : "not_found";
    case "savings":
      return input.lineId === null ? null : "invalid";
  }
}

/**
 * FR 2, FR 3, AC2–AC4, AC7: one cell of the current or a future month, saved at once (no «Зберегти»); a past month is
 * read only. Under the budget's row lock, so two saves of one cell are serialised: the one that carries an old version
 * is refused, never a silent overwrite. The same value again writes nothing.
 */
export async function setPlanCell(
  deps: BudgetDeps,
  tx: BudgetTx,
  caller: Caller,
  input: CellInput,
  categories: ReadonlyMap<string, BudgetCategory>,
  /** The lines of `input.period`, read before the budget transaction (`planLines`). */
  lines: PlanLines,
): Promise<Handed<CellResult>> {
  const none = (result: CellResult): Handed<CellResult> => ({ result, handOffs: [] });
  const budget = await tx.budget(caller.householdId, true);
  if (!budget) return none({ kind: "not-found" });
  const today = deps.today();
  const issues: BudgetIssue[] = [];
  const periodIssue = cellPeriodIssue(input.period, today);
  if (periodIssue) issues.push({ field: "period", issue: periodIssue });
  const incomePlans = input.kind === "income" ? await tx.incomePlans(caller.householdId, budget.id) : [];
  const line = lineIssue(input, categories, lines, incomePlans);
  if (line) issues.push({ field: "lineId", issue: line });
  // BUD-17 business rules (owner decision 2026-11-26): a category's cell is in the currency of its limit or its income
  // plan (BUD-02 FR 24).
  const own = input.kind === "limit" ? await tx.limits(caller.householdId, budget.id) : incomePlans;
  const lineCurrency =
    input.kind === "limit" || input.kind === "income"
      ? (own.find((l) => l.categoryId === input.lineId)?.amount.currency ?? budget.currency)
      : budget.currency;
  const rates =
    lineCurrency === budget.currency
      ? new Map()
      : await ratesOn(deps, [lineCurrency], budget.currency, today);
  const amount = input.amount
    ? lineCurrency === budget.currency
      ? parseBudgetAmount("amount", input.amount, budget.currency)
      : input.amount.currency === lineCurrency
        ? parseCategoryAmount("amount", input.amount, budget.currency, rates)
        : { field: "amount.currency", issue: "currency" }
    : null;
  if (amount !== null && !(amount instanceof Money)) issues.push(amount);
  if (issues.length > 0) return none({ kind: "invalid", issues });
  if (input.period < budget.firstPeriod) return none({ kind: "before-start" });
  const after = amount as Money | null;
  const stored = (await tx.planCells(caller.householdId, budget.id, input.period)).find(
    (c) => c.period === input.period && c.kind === input.kind && c.lineId === input.lineId,
  );
  const version = stored?.version ?? 0;
  if (version !== input.version) return none({ kind: "conflict", version });
  const before = stored?.amount ?? null;
  if (before === null ? after === null : after !== null && before.equals(after))
    return none({ kind: "ok", value: { amount: before, version } });
  await ensureSnapshots(
    deps,
    tx,
    caller.householdId,
    budget,
    today,
    categories,
    planLines(deps, caller.householdId, budget.currency),
  );
  const next = await tx.setPlanCell(
    caller.householdId,
    budget.id,
    { period: input.period, kind: input.kind, lineId: input.lineId, amount: after },
    after?.currency ?? lineCurrency,
  );
  const h = cellHandOff(deps, caller, budget, input, before, after);
  await tx.enqueueHandOff(h);
  return { result: { kind: "ok", value: { amount: after, version: next } }, handOffs: [h] };
}
