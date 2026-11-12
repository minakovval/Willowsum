import { Decimal, Money, exchangeRate, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { AmountGroup } from "./list-engine.ts";
import { createListTotals, kyivToday, type DatedRates } from "./list-total.ts";

/**
 * DAT-01@PoC FR 12 on the domain side: the totals row of a list in the reporting currency. Rates are official
 * NBU rates to the hryvnia by date; every pair crosses through the hryvnia (as the fx-rates module reads them).
 * The clock is fixed per test.
 */
const NOW = Date.UTC(2026, 10, 12, 10, 0); // 2026-11-12 in Kyiv
const money = (amount: string, currency: string) => Money.of(amount, currency);
const group = (currency: string, date: string | null, sum: string, count = 1): AmountGroup => ({
  currency,
  date,
  sum: money(sum, currency),
  count,
});

/** UAH per one unit, by currency and date; the rate of a date or the nearest earlier one, like fx-rates. */
function officialRates(pivot: Record<string, Record<string, string>>): DatedRates & { asked: string[] } {
  const asked: string[] = [];
  const uahPer = (currency: string, date: string): { rate: Decimal; date: string } | null => {
    if (currency === "UAH") return { rate: new Decimal(1), date };
    const dates = Object.keys(pivot[currency] ?? {})
      .filter((d) => d <= date)
      .sort();
    const d = dates.at(-1);
    return d === undefined ? null : { rate: new Decimal(pivot[currency]![d]!), date: d };
  };
  return {
    asked,
    async rate(from, to, date): Promise<ExchangeRate | null> {
      asked.push(`${from}>${to}@${date}`);
      const a = uahPer(from, date);
      const b = uahPer(to, date);
      if (!a || !b) return null;
      const on = a.date < b.date ? a.date : b.date;
      return exchangeRate({ base: from, quote: to, rate: a.rate.dividedBy(b.rate), date: on, source: "NBU" });
    },
  };
}

const totals = (rates: DatedRates) => createListTotals({ rates, now: () => NOW });

describe("DAT-01@PoC: totals in the reporting currency at the official rate of each transaction's date", () => {
  it("DAT-01@PoC AC2: −100 EUR (03.11) and −1 000 UAH (01.10, 40 UAH/EUR; today 50) total −125,00 € «конвертовано»", async () => {
    const rates = officialRates({ EUR: { "2026-10-01": "40", "2026-11-12": "50" } });
    const result = await totals(rates).total(
      [group("EUR", "2026-11-03", "-100"), group("UAH", "2026-10-01", "-1000")],
      "EUR",
    );
    expect(result.total?.equals(money("-125", "EUR"))).toBe(true);
    expect(result.total?.equals(money("-120", "EUR"))).toBe(false);
    expect(result).toMatchObject({ count: 2, converted: true, approximate: false, nearestRateCount: 0 });
    expect(rates.asked).toEqual(["UAH>EUR@2026-10-01"]);
  });

  it("DAT-01@PoC AC3: no rate on the hryvnia transaction's date → nearest rate 40, −165,00 € «приблизно», «1 транзакція за найближчим курсом»", async () => {
    const rates = officialRates({ EUR: { "2026-10-30": "40" } });
    const result = await totals(rates).total(
      [group("EUR", "2026-11-03", "-140", 2), group("UAH", "2026-11-01", "-1000")],
      "EUR",
    );
    expect(result.total?.equals(money("-165", "EUR"))).toBe(true);
    expect(result).toMatchObject({ count: 3, converted: true, approximate: true, nearestRateCount: 1 });
  });

  it("DAT-01@PoC AC4: once the rate of that date (50) appears, the total is −160,00 € without «приблизно»", async () => {
    const pivot: Record<string, Record<string, string>> = { EUR: { "2026-10-30": "40" } };
    const rates = officialRates(pivot);
    const groups = [group("EUR", "2026-11-03", "-140", 2), group("UAH", "2026-11-01", "-1000")];
    expect((await totals(rates).total(groups, "EUR")).approximate).toBe(true);
    pivot["EUR"]!["2026-11-01"] = "50";
    const result = await totals(rates).total(groups, "EUR");
    expect(result.total?.equals(money("-160", "EUR"))).toBe(true);
    expect(result).toMatchObject({ approximate: false, nearestRateCount: 0, noRateCount: 0 });
  });

  it("DAT-01@PoC AC5: the official NBU rate (40), not the bank's actual rate (41): −25,00 €, not −24,39 €", async () => {
    // A group carries only currency, date and sum: a bank or user rate has no way into the total.
    const result = await totals(officialRates({ EUR: { "2026-10-01": "40" } })).total(
      [group("UAH", "2026-10-01", "-1000")],
      "EUR",
    );
    expect(result.total?.equals(money("-25", "EUR"))).toBe(true);
  });

  it("DAT-01@PoC EC2: transactions at their dates' rates; values and balances (no date) at today's rate", async () => {
    const rates = officialRates({ EUR: { "2026-10-01": "40", "2026-11-12": "50" } });
    const result = await totals(rates).total(
      [group("UAH", "2026-10-01", "-1000"), group("UAH", null, "5000")],
      "EUR",
    );
    expect(result.total?.equals(money("75", "EUR"))).toBe(true); // −25 + 100
    expect(rates.asked).toEqual(["UAH>EUR@2026-10-01", `UAH>EUR@${kyivToday(NOW)}`]);
    expect(result).toMatchObject({ converted: true, approximate: false });
  });

  it("DAT-01@PoC EC3: several transactions on a date without a rate are all counted at the nearest rate", async () => {
    const result = await totals(officialRates({ EUR: { "2026-10-30": "40" } })).total(
      [group("UAH", "2026-11-01", "-2000", 4), group("UAH", "2026-10-30", "400")],
      "EUR",
    );
    expect(result.total?.equals(money("-40", "EUR"))).toBe(true);
    expect(result).toMatchObject({ approximate: true, nearestRateCount: 4 });
  });

  it("DAT-01@PoC EC4: a cross rate through the hryvnia (USD → EUR) is the official one of the date", async () => {
    const rates = officialRates({ EUR: { "2026-10-01": "40" }, USD: { "2026-10-01": "36" } });
    const result = await totals(rates).total([group("USD", "2026-10-01", "-100")], "EUR");
    expect(result.total?.equals(money("-90", "EUR"))).toBe(true);
  });

  it("DAT-01@PoC FR 12: no rate at all → no total and the marker «немає курсу», never 0", async () => {
    const result = await totals(officialRates({ EUR: { "2026-11-01": "40" } })).total(
      [group("EUR", "2026-11-03", "-100"), group("UAH", "2026-10-01", "-1000", 2)],
      "EUR",
    );
    expect(result.total).toBeNull();
    expect(result).toMatchObject({ count: 3, noRateCount: 2, approximate: false, converted: true });
  });

  it("DAT-01@PoC FR 12: one currency → its exact sum, no «конвертовано», no rate asked; an empty list → 0", async () => {
    const rates = officialRates({});
    const result = await totals(rates).total(
      [group("EUR", "2026-11-03", "-100.10"), group("EUR", "2026-11-04", "0.05")],
      "EUR",
    );
    expect(result.total?.equals(money("-100.05", "EUR"))).toBe(true);
    expect(result.converted).toBe(false);
    expect(rates.asked).toEqual([]);
    const empty = await totals(rates).total([], "UAH");
    expect(empty).toMatchObject({ count: 0, converted: false, noRateCount: 0 });
    expect(empty.total?.isZero()).toBe(true);
  });

  it("DAT-01@PoC FR 12: today is the Kyiv date of the injected clock", () => {
    expect(kyivToday(Date.UTC(2026, 10, 12, 22, 30))).toBe("2026-11-13");
    expect(kyivToday(Date.UTC(2026, 10, 12, 21, 30))).toBe("2026-11-12");
  });
});
