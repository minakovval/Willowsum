import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { monthFigures, type CashflowCategory } from "./cashflow.ts";

/**
 * FIN-03@PoC FR 8, AC31 (owner, 2026-11-26, decision 11; review of #728): «Грошовий потік» counts a transfer's gain
 * against the official rate as income in «Комісії банку», its loss as spending — never a gain as lower spending.
 */
const FEES = "fees";
const categories = new Map<string, CashflowCategory>([
  [FEES, { id: FEES, kind: "expense", state: "active", mergedInto: null, systemKey: "bank-fees" }],
]);
const eur = (a: string) => Money.of(a, "EUR");

describe("FIN-03@PoC FR 8: the cash flow counts a transfer's gain as income, its loss as spending", () => {
  it("FIN-03@PoC AC31: a gain of 30 € — income 30 €, spending 0", () => {
    const [m] = monthFigures(
      ["2026-10"],
      [{ month: "2026-10", categoryId: FEES, amount: eur("30"), asIncome: true }],
      categories,
      "EUR",
    );
    expect(m!.income.toDecimalString()).toBe("30");
    expect(m!.expenses.isZero()).toBe(true);
  });

  it("FIN-03@PoC AC31: a loss of 30 € — spending 30 €, income 0", () => {
    const [m] = monthFigures(
      ["2026-10"],
      [{ month: "2026-10", categoryId: FEES, amount: eur("-30") }],
      categories,
      "EUR",
    );
    expect(m!.expenses.toDecimalString()).toBe("30");
    expect(m!.income.isZero()).toBe(true);
  });
});
