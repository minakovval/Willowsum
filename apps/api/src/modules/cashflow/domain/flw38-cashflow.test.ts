import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { monthFigures, ratePercent, type CashflowCategory, type CountedLine } from "./index.ts";

/**
 * FLW-38@PoC AC5 on the tab «Грошовий потік» (S-134, `GET /v1/cashflow`): the month's net flow and savings rate. The
 * same month on «Підсумок періоду» (S-135) is the budget module's test `flw38-summary.test.ts`. Synthetic amounts.
 */
const eur = (a: string) => Money.of(a, "EUR");
const cats = new Map<string, CashflowCategory>([
  ["salary", { id: "salary", kind: "income", state: "active", mergedInto: null }],
  ["food", { id: "food", kind: "expense", state: "active", mergedInto: null }],
]);
const line = (categoryId: string, amount: string): CountedLine => ({
  month: "2026-10",
  categoryId,
  amount: eur(amount),
});

describe("FLW-38@PoC AC5: «Грошовий потік» of a month", () => {
  it("FLW-38@PoC AC5: income 4 000 € and expenses 3 100 € — net flow 900 €, savings rate 22,5 %", () => {
    const [m] = monthFigures(
      ["2026-10"],
      [line("salary", "4000"), line("food", "-1800"), line("food", "-1300")],
      cats,
      "EUR",
    );
    expect(m!.netFlow.equals(eur("900"))).toBe(true);
    expect(ratePercent(m!.savingsRate)).toBe("22.5");
  });
});
