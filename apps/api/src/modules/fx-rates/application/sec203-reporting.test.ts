import { Decimal, Money, exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { createFxReportingReader } from "./reporting.ts";

/**
 * Security review of PR #203 (VAL-04@PoC EC2): a dated amount is never counted as a stale «today» amount, whatever
 * the age of the rate it used. Fake rates: every UAH → EUR rate is the one of 2026-11-04, 0.025; now is Monday
 * 2026-11-16 (Kyiv).
 */
const NOW = Date.UTC(2026, 10, 16, 10, 0);
const reader = createFxReportingReader({
  now: () => NOW,
  fx: {
    async rates(requests): Promise<(ExchangeRate | null)[]> {
      return requests.map((r) =>
        exchangeRate({
          base: r.from,
          quote: r.to,
          rate: new Decimal("0.025"),
          date: "2026-11-04",
          source: "NBU",
        }),
      );
    },
  },
});

describe("VAL-04@PoC EC2: only «today» amounts are counted as stale", () => {
  it("VAL-04@PoC EC2: a dated amount at a rate older than 3 days is a nearest-rate amount, never a stale «today» one", async () => {
    const total = await reader.total([
      { amount: Money.of("400", "UAH"), date: "2026-11-12" },
      { amount: Money.of("400", "UAH"), date: null },
    ]);
    expect([
      total.approximate,
      total.nearestRateCount,
      total.staleRateCount,
      total.total?.toDecimalString(),
    ]).toEqual([true, 1, 1, "20"]);
  });
});
