import { Decimal, Money, exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { rateCoversDate, todayRateIsApproximate } from "../src/modules/fx-rates/index.ts";
import type { AmountGroup } from "../src/platform/lists/list-engine.ts";
import { createListTotals, type DatedRates } from "../src/platform/lists/list-total.ts";

/**
 * DAT-01@PoC FR 12 with fx-rates' real rules (follow-up of #203): the list totals engine in `src/platform` may not
 * import a module, so its unit test keeps a copy of the «today» age rule; this test feeds the engine the real
 * `todayRateIsApproximate` and `rateCoversDate`, so a copy that drifts from the rule is caught here.
 */
const NOW = Date.UTC(2026, 10, 12, 10, 0); // Thursday 2026-11-12 in Kyiv
const group = (currency: string, date: string | null, sum: string, count = 1): AmountGroup => ({
  currency,
  date,
  sum: Money.of(sum, currency),
  count,
});

/** UAH per EUR by date; the rate of a date or the nearest earlier one, like fx-rates. */
function eurRates(pivot: Record<string, string>): DatedRates {
  return {
    async rates(requests) {
      return requests.map((r): ExchangeRate | null => {
        const on = Object.keys(pivot)
          .filter((d) => d <= r.date)
          .sort()
          .at(-1);
        if (on === undefined || r.from !== "UAH" || r.to !== "EUR") return null;
        return exchangeRate({
          base: "UAH",
          quote: "EUR",
          rate: new Decimal(1).dividedBy(new Decimal(pivot[on]!)),
          date: on,
          source: "NBU",
        });
      });
    },
    covers: rateCoversDate,
    staleForToday: todayRateIsApproximate,
  };
}

describe("DAT-01@PoC FR 12: the age of «today»'s rate, with the real rule of fx-rates", () => {
  it("DAT-01@PoC FR 12: a value or balance (no date) at a rate up to 3 days old is not «приблизно»; at 4 days it is", async () => {
    for (const [latest, stale] of [
      ["2026-11-10", false],
      ["2026-11-09", false],
      ["2026-11-08", true],
    ] as const) {
      const result = await createListTotals({ rates: eurRates({ [latest]: "40" }), now: () => NOW }).total(
        [group("UAH", null, "400", 3)],
        "EUR",
      );
      expect(result.total?.equals(Money.of("10", "EUR")), latest).toBe(true);
      expect(result, latest).toMatchObject({
        approximate: stale,
        nearestRateCount: 0,
        staleRateCount: stale ? 3 : 0,
      });
    }
  });

  it("DAT-01@PoC FR 12: «older than 3 days» counts from the Kyiv date of the clock", async () => {
    const rates = eurRates({ "2026-11-09": "40" }); // Monday
    const at = (ms: number) =>
      createListTotals({ rates, now: () => ms }).total([group("UAH", null, "400")], "EUR");
    expect(await at(Date.UTC(2026, 10, 12, 21, 59))).toMatchObject({ approximate: false, staleRateCount: 0 });
    expect(await at(Date.UTC(2026, 10, 12, 22, 0))).toMatchObject({ approximate: true, staleRateCount: 1 });
  });
});
