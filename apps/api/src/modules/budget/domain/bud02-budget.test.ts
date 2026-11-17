import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  addMonths,
  firstPeriodChoices,
  includedByDefault,
  limitIssue,
  parseBudgetAmount,
  periodDays,
  periodFigures,
  periodMode,
  periodsToSnapshot,
  type BudgetCategory,
  type PeriodPlan,
} from "./index.ts";

/** BUD-02@PoC a) on the pure rules of the budget: periods, default accounts, a period's figures. Synthetic data. */

const eur = (amount: string) => Money.of(amount, "EUR");
const cat = (
  id: string,
  kind: BudgetCategory["kind"],
  extra: Partial<BudgetCategory> = {},
): BudgetCategory => ({
  id,
  groupId: `g-${kind}`,
  kind,
  state: "active",
  mergedInto: null,
  essential: kind === "expense" ? false : null,
  ...extra,
});
const categories = new Map(
  [
    cat("groceries", "expense", { essential: true }),
    cat("cafes", "expense"),
    cat("travel", "expense"),
    cat("salary", "income"),
    cat("transfer", "service"),
    cat("old", "expense", { state: "retired", mergedInto: "cafes" }),
  ].map((c) => [c.id, c]),
);
const plan = (limits: [string, string][]): PeriodPlan => ({
  incomePlan: eur("3000"),
  plannedSavings: eur("0"),
  limits: limits.map(([categoryId, amount]) => ({ categoryId, amount: eur(amount), mandatory: false })),
});

describe("BUD-02@PoC: the calendar month", () => {
  it("BUD-02@PoC FR 4: the only period is the calendar month — its days, the next and previous months", () => {
    expect(periodDays("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodDays("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("BUD-02@PoC FR 6: every period is a calendar month — the past, the current and a future one", () => {
    expect(periodMode("2026-10", "2026-11-18")).toBe("past");
    expect(periodMode("2026-11", "2026-11-01")).toBe("current");
    expect(periodMode("2026-12", "2026-11-30")).toBe("future");
  });

  it("BUD-02@PoC FR 5: the first period is the current month or the next one; on the 1st of a month — the current one", () => {
    expect(firstPeriodChoices("2026-11-18")).toEqual(["2026-11", "2026-12"]);
    expect(firstPeriodChoices("2026-12-01")).toEqual(["2026-12"]);
  });

  it("BUD-02@PoC FR 11: every finished period since the first one without a snapshot gets one; the current never", () => {
    expect(periodsToSnapshot("2026-08", "2026-11-18", new Set(["2026-09"]))).toEqual(["2026-08", "2026-10"]);
    expect(periodsToSnapshot("2026-11", "2026-11-18", new Set())).toEqual([]);
  });
});

describe("BUD-02@PoC: limits and accounts", () => {
  it("BUD-02@PoC FR 10: current accounts, credit cards and cash are in the budget by default; savings, deposits, loans not", () => {
    expect(["current", "credit-card", "cash"].every(includedByDefault)).toBe(true);
    expect(["savings", "deposit", "loan"].some(includedByDefault)).toBe(false);
  });

  it("BUD-02@PoC FR 7: a limit belongs to an active expense category; ≥ 0 in the budget's currency", () => {
    expect(limitIssue(categories.get("cafes"))).toBeNull();
    expect(limitIssue(categories.get("salary"))).toBe("not_expense");
    expect(limitIssue(categories.get("transfer"))).toBe("not_expense");
    expect(limitIssue(cat("x", "expense", { state: "hidden" }))).toBe("hidden");
    expect(limitIssue(categories.get("old"))).toBe("not_found");
    expect(limitIssue(undefined)).toBe("not_found");
    expect(parseBudgetAmount("l", { amount: "600.00", currency: "EUR" }, "EUR")).toEqual(eur("600"));
    expect(parseBudgetAmount("l", { amount: "600", currency: "UAH" }, "EUR")).toEqual({
      field: "l.currency",
      issue: "currency",
    });
    expect(parseBudgetAmount("l", { amount: "-1", currency: "EUR" }, "EUR")).toEqual({
      field: "l",
      issue: "invalid",
    });
    expect(parseBudgetAmount("l", { amount: "1.001", currency: "EUR" }, "EUR")).toEqual({
      field: "l",
      issue: "invalid",
    });
  });
});

describe("BUD-02@PoC: what a period shows", () => {
  it("BUD-02@PoC AC5: «Подорожі» without a limit with 150 € spent is in «Поза планом»", () => {
    const f = periodFigures(plan([["groceries", "600"]]), categories, [
      { categoryId: "travel", amount: eur("-150") },
      { categoryId: "groceries", amount: eur("-200") },
    ]);
    expect(f.outsidePlan).toEqual([{ categoryId: "travel", spent: eur("150") }]);
    expect(f.totals).toEqual({
      limits: eur("600"),
      spent: eur("200"),
      outsidePlan: eur("150"),
      incomeActual: eur("0"),
    });
    expect(f.lines[0]).toMatchObject({ categoryId: "groceries", spent: eur("200"), remaining: eur("400") });
  });

  it("BUD-02@PoC EC4: a refund lowers the spending of its category", () => {
    const f = periodFigures(plan([["cafes", "300"]]), categories, [
      { categoryId: "cafes", amount: eur("-360") },
      { categoryId: "cafes", amount: eur("40") },
    ]);
    expect(f.lines[0]).toMatchObject({ spent: eur("320"), remaining: eur("-20") });
  });

  it("BUD-02@PoC FR 9: income is the income categories; transfers are neither; an uncategorized outflow is «Без категорії» in «Поза планом»", () => {
    const f = periodFigures(plan([]), categories, [
      { categoryId: "salary", amount: eur("2500") },
      { categoryId: "transfer", amount: eur("-500") },
      { categoryId: null, amount: eur("-30") },
      { categoryId: null, amount: eur("70") },
      { categoryId: "old", amount: eur("-12") },
    ]);
    expect(f.totals.incomeActual).toEqual(eur("2500"));
    expect(f.outsidePlan).toEqual([
      { categoryId: null, spent: eur("30") },
      { categoryId: "cafes", spent: eur("12") },
    ]);
  });

  it("BUD-02@PoC FR 16 (server part): a future month shows the plan only", () => {
    const f = periodFigures(plan([["groceries", "600"]]), categories, null);
    expect(f.lines[0]).toMatchObject({ limit: eur("600"), spent: null, remaining: null });
    expect(f.totals).toMatchObject({ spent: null, outsidePlan: null, incomeActual: null });
  });
});
