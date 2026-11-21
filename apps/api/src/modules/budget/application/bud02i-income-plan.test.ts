import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { BudgetCategory } from "../domain/index.ts";
import { checkIncome } from "./budget.ts";

/** BUD-02@PoC FR 21: «План доходу» of a request — income categories of the space, the income plan their sum. */
const eur = (amount: string) => Money.of(amount, "EUR");
const money = (amount: string) => ({ amount, currency: "EUR" });
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
  essential: null,
  ...extra,
});
const categories = new Map(
  [
    cat("salary", "income"),
    cat("freelance", "income"),
    cat("rent", "income"),
    cat("old-income", "income", { state: "retired", mergedInto: "freelance" }),
    cat("hidden-income", "income", { state: "hidden" }),
    cat("groceries", "expense"),
  ].map((c) => [c.id, c]),
);

describe("BUD-02@PoC FR 21: the income plan is the sum of the categories' plans", () => {
  it("BUD-02@PoC FR 21: a plan by category sums its lines; a category must be an active income one of the space, once; not with `incomePlan`", () => {
    const ok = checkIncome(
      {
        incomePlans: [
          { categoryId: "salary", amount: money("5000") },
          { categoryId: "rent", amount: money("400.5") },
        ],
      },
      categories,
      "EUR",
    );
    expect(ok.issues).toEqual([]);
    expect(ok.total).toEqual(eur("5400.5"));
    expect(checkIncome({ incomePlans: [] }, categories, "EUR").total).toEqual(eur("0"));
    expect(
      checkIncome(
        {
          incomePlan: money("1"),
          incomePlans: [
            { categoryId: "nope", amount: money("1") },
            { categoryId: "groceries", amount: money("1") },
            { categoryId: "hidden-income", amount: money("1") },
            { categoryId: "old-income", amount: money("1") },
            { categoryId: "salary", amount: money("1") },
            { categoryId: "salary", amount: money("2") },
            { categoryId: "rent", amount: money("-1") },
            { categoryId: "freelance", amount: { amount: "1", currency: "UAH" } },
          ],
        },
        categories,
        "EUR",
      ),
    ).toEqual({
      total: null,
      rows: [{ categoryId: "salary", amount: eur("1") }],
      issues: [
        { field: "incomePlans.0.categoryId", issue: "not_found" },
        { field: "incomePlans.1.categoryId", issue: "not_income" },
        { field: "incomePlans.2.categoryId", issue: "hidden" },
        { field: "incomePlans.3.categoryId", issue: "not_found" },
        { field: "incomePlans.5.categoryId", issue: "duplicate" },
        { field: "incomePlans.6.amount", issue: "invalid" },
        { field: "incomePlans.7.amount.currency", issue: "currency" },
        { field: "incomePlan", issue: "with_income_plans" },
      ],
    });
  });
});
