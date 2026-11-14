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

/**
 * UAH per one unit, by currency and date; the rate of a date or the nearest earlier one, like fx-rates. `asked`
 * lists every rate asked for, `calls` how many reads the total made.
 */
function officialRates(
  pivot: Record<string, Record<string, string>>,
): DatedRates & { asked: string[]; calls: number } {
  const asked: string[] = [];
  const uahPer = (currency: string, date: string): { rate: Decimal; date: string } | null => {
    if (currency === "UAH") return { rate: new Decimal(1), date };
    const dates = Object.keys(pivot[currency] ?? {})
      .filter((d) => d <= date)
      .sort();
    const d = dates.at(-1);
    return d === undefined ? null : { rate: new Decimal(pivot[currency]![d]!), date: d };
  };
  const one = (from: string, to: string, date: string): ExchangeRate | null => {
    asked.push(`${from}>${to}@${date}`);
    const a = uahPer(from, date);
    const b = uahPer(to, date);
    if (!a || !b) return null;
    const on = a.date < b.date ? a.date : b.date;
    return exchangeRate({ base: from, quote: to, rate: a.rate.dividedBy(b.rate), date: on, source: "NBU" });
  };
  const fake = {
    asked,
    calls: 0,
    async rates(requests: readonly { from: string; to: string; date: string }[]) {
      fake.calls += 1;
      return requests.map((r) => one(r.from, r.to, r.date));
    },
    // A copy of fx-rates' rules (VAL-04 AC4, AC5, EC1, EC2): platform code may not import a module. The real ones are
    // checked by dat01-list.it.test.ts and test/dat01-list-total-real-rule.test.ts.
    staleForToday(rateDate: string, today: string) {
      return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rateDate}T00:00:00Z`) > 3 * 86_400_000;
    },
    covers(rateDate: string, date: string) {
      for (let d = new Date(`${rateDate}T00:00:00Z`); d.toISOString().slice(0, 10) < date;) {
        d = new Date(d.getTime() + 86_400_000);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) return false;
      }
      return rateDate <= date;
    },
  };
  return fake;
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
    const rates = officialRates({ EUR: { "2026-10-29": "40" } });
    const result = await totals(rates).total(
      [group("EUR", "2026-11-03", "-140", 2), group("UAH", "2026-11-01", "-1000")],
      "EUR",
    );
    expect(result.total?.equals(money("-165", "EUR"))).toBe(true);
    expect(result).toMatchObject({ count: 3, converted: true, approximate: true, nearestRateCount: 1 });
  });

  it("DAT-01@PoC AC4: once the rate of that date (50) appears, the total is −160,00 € without «приблизно»", async () => {
    const pivot: Record<string, Record<string, string>> = { EUR: { "2026-10-29": "40" } };
    const rates = officialRates(pivot);
    const groups = [group("EUR", "2026-11-03", "-140", 2), group("UAH", "2026-11-01", "-1000")];
    expect((await totals(rates).total(groups, "EUR")).approximate).toBe(true);
    pivot["EUR"]!["2026-11-01"] = "50";
    const result = await totals(rates).total(groups, "EUR");
    expect(result.total?.equals(money("-160", "EUR"))).toBe(true);
    expect(result).toMatchObject({ approximate: false, nearestRateCount: 0, noRateCount: 0 });
  });

  it("DAT-01@PoC AC5, EC4: the official NBU rate (40), not the bank's actual rate (41): −25,00 €, not −24,39 €", async () => {
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

  it("DAT-01@PoC AC4: a Saturday or Sunday amount at Friday's rate is the rate of that date, as in fx-rates (not «приблизно»); a Monday at Friday's rate is", async () => {
    const rates = officialRates({ EUR: { "2026-11-13": "40" } });
    const weekend = await totals(rates).total(
      [group("UAH", "2026-11-14", "400"), group("UAH", "2026-11-15", "400")],
      "EUR",
    );
    expect(weekend).toMatchObject({ approximate: false, nearestRateCount: 0 });
    const monday = await totals(rates).total([group("UAH", "2026-11-16", "400")], "EUR");
    expect(monday).toMatchObject({ approximate: true, nearestRateCount: 1 });
  });

  // The requirement changed (owner decision 2026-11-13, #185; DAT-01@PoC FR 12, VAL-04@PoC EC2): a value or balance
  // at a rate older than 3 calendar days is «приблизно». This replaces the tests «… at the latest official rate,
  // older than today, is never «приблизно»» (#129, #182): a rate up to 3 days old still is not.
  it("DAT-01@PoC FR 12: a value or balance (no date) at the latest official rate up to 3 calendar days old is not «приблизно»", async () => {
    for (const latest of ["2026-11-10", "2026-11-09"]) {
      // today is Thu 12.11; the latest rate is 2 (Tue 10.11), then 3 (Mon 09.11) days old
      const rates = officialRates({ EUR: { [latest]: "40" } });
      const result = await totals(rates).total([group("UAH", null, "400", 3)], "EUR");
      expect(result.total?.equals(money("10", "EUR")), latest).toBe(true);
      expect(result, latest).toMatchObject({ approximate: false, nearestRateCount: 0, staleRateCount: 0 });
    }
  });

  it("DAT-01@PoC FR 12: a value or balance (no date) at a rate older than 3 calendar days is «приблизно», not a nearest-rate transaction", async () => {
    // today is Thu 12.11; the latest rate is Sun 08.11 (4 days); the transaction of 08.11 has its own date's rate
    const rates = officialRates({ EUR: { "2026-11-08": "40" } });
    const result = await totals(rates).total(
      [group("UAH", null, "400", 3), group("EUR", "2026-11-03", "-5"), group("UAH", "2026-11-08", "-40")],
      "EUR",
    );
    expect(result.total?.equals(money("4", "EUR"))).toBe(true); // 10 − 5 − 1
    expect(result).toMatchObject({ approximate: true, nearestRateCount: 0, staleRateCount: 3, count: 5 });
  });

  it("DAT-01@PoC FR 12: «older than 3 days» counts from the Kyiv date of the clock", async () => {
    const rates = officialRates({ EUR: { "2026-11-09": "40" } }); // Monday
    const at = (ms: number) =>
      createListTotals({ rates, now: () => ms }).total([group("UAH", null, "400")], "EUR");
    // 2026-11-12 21:59 UTC is Thursday 12.11 in Kyiv (3 days); 22:00 UTC is Friday 13.11 (4 days).
    expect(await at(Date.UTC(2026, 10, 12, 21, 59))).toMatchObject({ approximate: false, staleRateCount: 0 });
    expect(await at(Date.UTC(2026, 10, 12, 22, 0))).toMatchObject({ approximate: true, staleRateCount: 1 });
  });

  it("DAT-01@PoC EC3: several transactions on a date without a rate are all counted at the nearest rate", async () => {
    const result = await totals(officialRates({ EUR: { "2026-10-29": "40" } })).total(
      [group("UAH", "2026-11-01", "-2000", 4), group("UAH", "2026-10-29", "400")],
      "EUR",
    );
    expect(result.total?.equals(money("-40", "EUR"))).toBe(true);
    expect(result).toMatchObject({ approximate: true, nearestRateCount: 4 });
  });

  it("DAT-01@PoC FR 12: a cross rate through the hryvnia (USD → EUR) is the official one of the date", async () => {
    const rates = officialRates({ EUR: { "2026-10-01": "40" }, USD: { "2026-10-01": "36" } });
    const result = await totals(rates).total([group("USD", "2026-10-01", "-100")], "EUR");
    expect(result.total?.equals(money("-90", "EUR"))).toBe(true);
  });

  it("DAT-01@PoC AC6: no EUR rate on or before 05.01 → partial −100,00 € «без 1 запису: немає курсу», not 0, not a later rate", async () => {
    const rates = officialRates({ EUR: { "2026-11-01": "40" } });
    const result = await totals(rates).total(
      [group("EUR", "2026-11-03", "-100"), group("UAH", "2026-01-05", "-1000")],
      "EUR",
    );
    expect(result.total?.equals(money("-100", "EUR"))).toBe(true);
    expect(result).toMatchObject({
      count: 2,
      partial: true,
      noRateCount: 1,
      approximate: false,
      converted: true,
    });
  });

  it("DAT-01@PoC EC5: records without any rate are left out; the rest keep «приблизно» and its count", async () => {
    const rates = officialRates({ EUR: { "2026-10-29": "40" } });
    const result = await totals(rates).total(
      [
        group("EUR", "2026-11-03", "-10"),
        group("UAH", "2026-11-01", "-400", 3), // nearest earlier rate (29.10, a Thursday: the weekend rule needs Friday)
        group("UAH", "2026-10-01", "-4000", 2), // before every rate: left out
        group("GBP", "2026-11-01", "-1"), // never quoted: left out
      ],
      "EUR",
    );
    expect(result.total?.equals(money("-20", "EUR"))).toBe(true);
    expect(result).toMatchObject({
      count: 7,
      partial: true,
      noRateCount: 3,
      approximate: true,
      nearestRateCount: 3,
    });
  });

  it("DAT-01@PoC EC5: no record has a rate → no total at all, only the marker; never 0", async () => {
    const result = await totals(officialRates({})).total([group("UAH", "2026-10-01", "-1000", 2)], "EUR");
    expect(result.total).toBeNull();
    expect(result).toMatchObject({ count: 2, partial: true, noRateCount: 2 });
  });

  it("DAT-01@PoC FR 12: every rate of a total is read in one call, each (currency, date) once", async () => {
    const rates = officialRates({ EUR: { "2016-01-01": "40" }, USD: { "2016-01-01": "32" } });
    const days = Array.from({ length: 400 }, (_, i) =>
      new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    );
    const groups = days.flatMap((d) => [group("UAH", d, "-1"), group("USD", d, "-1"), group("EUR", d, "-1")]);
    const result = await totals(rates).total([...groups, group("UAH", days[0]!, "-1")], "EUR");
    expect(rates.calls).toBe(1);
    expect(rates.asked).toHaveLength(800);
    expect(result).toMatchObject({ count: 1201, partial: false, noRateCount: 0 });
  });

  it("DAT-01@PoC FR 12: a failed rate read fails the total, it is never shown as «немає курсу»", async () => {
    const broken: DatedRates = {
      rates: () => Promise.reject(new Error("connection terminated")),
      covers: () => true,
      staleForToday: () => false,
    };
    await expect(totals(broken).total([group("UAH", "2026-10-01", "-1")], "EUR")).rejects.toThrow(
      "connection terminated",
    );
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
    expect(empty).toMatchObject({ count: 0, converted: false, partial: false, noRateCount: 0 });
    expect(empty.total?.isZero()).toBe(true);
  });

  it("DAT-01@PoC FR 12: today is the Kyiv date of the injected clock", () => {
    expect(kyivToday(Date.UTC(2026, 10, 12, 22, 30))).toBe("2026-11-13");
    expect(kyivToday(Date.UTC(2026, 10, 12, 21, 30))).toBe("2026-11-12");
  });
});
