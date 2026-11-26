import { Money } from "@willowsum/domain-kernel";
import type { FxReporting } from "../../fx-rates/index.ts";
import type { BudgetRates } from "../application/index.ts";
import type { PlanRate } from "../domain/index.ts";

/**
 * BUD-02@PoC FR 24 («Валюта категорії»): the rate of each category currency into the budget's on a date, over the public
 * interface of fx-rates — the date's rate or the nearest earlier one, a cross rate through the hryvnia, as every other
 * conversion of the budget (business rules). One rates read for all the currencies; a currency without any rate is
 * left out of the map.
 */
export function createBudgetRates(fx: Pick<FxReporting, "total">): BudgetRates {
  return {
    async rates(currencies, to, date) {
      const other = [...new Set(currencies)].filter((c) => c !== to);
      const out = new Map<string, PlanRate>();
      if (other.length === 0) return out;
      const reported = await fx.total(
        other.map((c) => ({ amount: Money.of("1", c), date })),
        to,
      );
      reported.items.forEach((item, i) => {
        if (item.kind !== "converted") return;
        const c = item.conversion;
        out.set(other[i]!, { currency: other[i]!, rate: c.rate, date: c.rateDate, source: c.source });
      });
      return out;
    },
  };
}
