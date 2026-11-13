import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createFxRates, createFxReporting, type ReportedAmount } from "./index.ts";

/**
 * VAL-04@PoC on a real PostgreSQL: amounts in their own currency are shown in the space's reporting currency (EUR)
 * at the official NBU rate of their date (cross rates through the hryvnia), with the rate, its date and its source;
 * weekends take Friday's rate; a missing rate of the date gives the nearest earlier one marked «приблизно»; a
 * currency with no rate at all stays in its own currency («Курс недоступний») and out of the total. Rates are
 * synthetic numbers written straight into the module's history; the clock is fixed per test.
 */
let db: RealModulesDatabase;
// «Today» is Monday 2026-11-16 in Kyiv.
const NOW = Date.UTC(2026, 10, 16, 10, 0);
const reporting = () => createFxReporting({ db: db.databases.for("fx-rates"), now: () => NOW });

async function seed(rows: [date: string, currency: string, rate: string][]) {
  for (const [d, c, r] of rows)
    await db.owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
      [d, c, r],
    );
}

const converted = (item: ReportedAmount) => {
  if (item.kind !== "converted") throw new Error(`expected a conversion, got ${item.kind}`);
  return item;
};

beforeAll(async () => {
  db = await setupRealModules();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.owner.query("TRUNCATE fx_rates.rates, fx_rates.updates, fx_rates.stale_alerts");
});

describe("VAL-04@PoC: currencies and conversion", () => {
  it("VAL-04@PoC FR 1: an amount keeps its original currency; the reporting value is a separate, unrounded result", async () => {
    await seed([["2026-11-12", "EUR", "45.00"]]);
    const original = Money.of("1000000", "UAH");
    const item = converted(await reporting().toReporting({ amount: original, date: "2026-11-12" }));
    expect(item.original).toBe(original);
    expect([item.original.toDecimalString(), item.original.currency]).toEqual(["1000000", "UAH"]);
    expect([item.value.currency, item.value.toDecimalString()]).toEqual(["EUR", "22222.222222222222"]);
  });

  it("VAL-04@PoC FR 2: the reporting currency is EUR by default; an amount already in EUR is not converted", async () => {
    const item = await reporting().toReporting({ amount: Money.of("12.30", "EUR"), date: "2026-11-12" });
    expect(item).toEqual({
      kind: "reporting-currency",
      original: Money.of("12.30", "EUR"),
      value: Money.of("12.30", "EUR"),
    });
    const total = await reporting().total([]);
    expect([total.currency, total.total?.toDecimalString()]).toEqual(["EUR", "0"]);
  });

  it("VAL-04@PoC AC2: amounts use the rate of their date, «today» the latest daily rate, and each keeps the rate, its date and source", async () => {
    await seed([
      ["2026-11-12", "EUR", "45.00"],
      ["2026-11-12", "USD", "41.40"],
      ["2026-11-16", "EUR", "46.00"],
      ["2026-11-16", "USD", "41.86"],
    ]);
    const total = await reporting().total([
      { amount: Money.of("100.00", "USD"), date: "2026-11-12" }, // a transaction: the rate of its date
      { amount: Money.of("100.00", "USD"), date: null }, // a balance: today's rate
      { amount: Money.of("5.00", "EUR"), date: "2026-11-12" },
    ]);
    const [tx, balance] = total.items.map((i) => (i.kind === "converted" ? i : null));
    expect([tx?.conversion.rateDate, tx?.conversion.rate.toFixed(), tx?.conversion.source]).toEqual([
      "2026-11-12",
      "0.92",
      "NBU",
    ]);
    expect([
      balance?.conversion.rateDate,
      balance?.conversion.rate.toFixed(),
      balance?.conversion.source,
    ]).toEqual(["2026-11-16", "0.91", "NBU"]);
    expect([tx?.conversion.approximate, balance?.conversion.approximate]).toEqual([false, false]);
    expect([total.total?.toDecimalString(), total.approximate, total.unavailableCount]).toEqual([
      "188",
      false,
      0,
    ]);
  });

  it("VAL-04@PoC FR 3: with no rate of today yet, «today» uses the latest daily rate and shows its date, not «приблизно»", async () => {
    await seed([["2026-11-13", "EUR", "50.00"]]);
    const item = converted(await reporting().toReporting({ amount: Money.of("450", "UAH"), date: null }));
    expect([item.conversion.rateDate, item.conversion.requestedDate, item.conversion.approximate]).toEqual([
      "2026-11-13",
      "2026-11-16",
      false,
    ]);
    expect(item.value.toDecimalString()).toBe("9");
  });

  it("VAL-04@PoC FR 3: «today» with a latest rate of a week ago is still not «приблизно» (open owner question)", async () => {
    await seed([["2026-11-09", "EUR", "50.00"]]);
    const item = converted(await reporting().toReporting({ amount: Money.of("450", "UAH"), date: null }));
    expect([item.conversion.rateDate, item.conversion.approximate]).toEqual(["2026-11-09", false]);
  });

  it("VAL-04@PoC AC3: PLN/CHF has no direct NBU rate → cross rate through the hryvnia from the NBU rates of the same date", async () => {
    await seed([
      ["2026-11-11", "CHF", "60.00"],
      ["2026-11-12", "PLN", "11.25"],
      ["2026-11-12", "CHF", "50.00"],
    ]);
    const item = converted(
      await reporting().toReporting({ amount: Money.of("1000.00", "PLN"), date: "2026-11-12" }, "CHF"),
    );
    expect([
      item.conversion.rate.toFixed(),
      item.conversion.rateDate,
      item.conversion.source,
      item.value.toDecimalString(),
      item.value.currency,
    ]).toEqual(["0.225", "2026-11-12", "NBU", "225", "CHF"]);
    expect(item.conversion.approximate).toBe(false);
  });

  it("VAL-04@PoC FR 4: a cross rate never mixes dates: one currency missing on the date → both from the nearest common date", async () => {
    await seed([
      ["2026-11-11", "PLN", "11.00"],
      ["2026-11-11", "CHF", "44.00"],
      ["2026-11-12", "CHF", "50.00"],
    ]);
    const item = converted(
      await reporting().toReporting({ amount: Money.of("100", "PLN"), date: "2026-11-12" }, "CHF"),
    );
    expect([item.conversion.rateDate, item.conversion.rate.toFixed(), item.conversion.approximate]).toEqual([
      "2026-11-11",
      "0.25",
      true,
    ]);
  });

  it("VAL-04@PoC AC4: a Saturday amount uses Friday's rate, which is the rate of that date (not «приблизно»)", async () => {
    await seed([
      ["2026-11-12", "USD", "40.00"],
      ["2026-11-13", "USD", "41.00"],
      ["2026-11-13", "EUR", "45.10"],
      ["2026-11-16", "USD", "42.00"],
      ["2026-11-16", "EUR", "46.00"],
    ]);
    const item = converted(
      await reporting().toReporting({ amount: Money.of("100.00", "USD"), date: "2026-11-14" }),
    );
    expect([item.conversion.rateDate, item.conversion.approximate]).toEqual(["2026-11-13", false]);
    expect(item.conversion.rate.toFixed()).toBe("0.909090909090909091");
    // The same rule in the plain reader.
    const { conversion } = await createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW }).convert(
      Money.of("100.00", "USD"),
      "EUR",
      "2026-11-15",
    );
    expect([conversion.rateDate, conversion.approximate]).toEqual(["2026-11-13", false]);
  });

  it("VAL-04@PoC EC1: a holiday or a missed working day is not a weekend: the earlier rate is used and marked «приблизно»", async () => {
    await seed([["2026-11-12", "EUR", "45.00"]]);
    const item = converted(
      await reporting().toReporting({ amount: Money.of("90", "UAH"), date: "2026-11-14" }),
    );
    expect([item.conversion.rateDate, item.conversion.approximate]).toEqual(["2026-11-12", true]);
  });

  it("VAL-04@PoC EC2: a currency with restricted convertibility is converted at the official rate with the warning flag", async () => {
    await seed([
      ["2026-11-12", "BYN", "12.50"],
      ["2026-11-12", "EUR", "50.00"],
    ]);
    const total = await reporting().total([
      { amount: Money.of("100", "BYN"), date: "2026-11-12" },
      { amount: Money.of("100", "UAH"), date: "2026-11-12" },
    ]);
    const [byn, uah] = total.items.map(converted);
    expect([byn!.restricted, byn!.value.toDecimalString(), byn!.conversion.source]).toEqual([
      true,
      "25",
      "NBU",
    ]);
    expect(uah!.restricted).toBe(false);
    expect([total.restricted, total.total?.toDecimalString()]).toEqual([true, "27"]);
  });

  it("VAL-04@PoC EC2: a restricted reporting currency also carries the warning flag, although the amount's currency is not restricted", async () => {
    await seed([
      ["2026-11-12", "BYN", "12.50"],
      ["2026-11-12", "USD", "40.00"],
    ]);
    const total = await reporting().total([{ amount: Money.of("100", "USD"), date: "2026-11-12" }], "BYN");
    expect([total.restricted, converted(total.items[0]!).restricted]).toEqual([true, true]);
  });

  it("VAL-04@PoC FR 3: a malformed or impossible date is an input error, never «Курс недоступний»", async () => {
    for (const date of ["today", "2026-02-30", "2026-13-01", "14.11.2026"])
      await expect(reporting().total([{ amount: Money.of("100", "UAH"), date }]), date).rejects.toThrow(
        /YYYY-MM-DD/,
      );
  });

  it("VAL-04@PoC EC3: no rate of the date but an earlier one → the nearest rate, «приблизно»; refined once the date's rate arrives", async () => {
    await seed([["2026-11-09", "EUR", "40.00"]]);
    const items = [
      { amount: Money.of("440", "UAH"), date: "2026-11-12" },
      { amount: Money.of("10", "EUR"), date: "2026-11-12" },
    ];
    const before = await reporting().total(items);
    expect([
      converted(before.items[0]!).conversion.rateDate,
      converted(before.items[0]!).conversion.approximate,
      before.approximate,
      before.nearestRateCount,
      before.total?.toDecimalString(),
    ]).toEqual(["2026-11-09", true, true, 1, "21"]);

    await seed([["2026-11-12", "EUR", "50.00"]]);
    const after = await reporting().total(items);
    expect([
      converted(after.items[0]!).conversion.rateDate,
      after.approximate,
      after.nearestRateCount,
      after.total?.toDecimalString(),
    ]).toEqual(["2026-11-12", false, 0, "18.8"]);
  });

  it("VAL-04@PoC EC4: a currency with no rate at all stays in its own currency, «Курс недоступний», out of the total; the total is «приблизно» with the count", async () => {
    await seed([["2026-11-12", "EUR", "40.00"]]);
    const total = await reporting().total([
      { amount: Money.of("400", "UAH"), date: "2026-11-12" },
      { amount: Money.of("5000", "GEL"), date: "2026-11-12" },
      { amount: Money.of("70", "GEL"), date: null },
      { amount: Money.of("1.50", "EUR"), date: "2026-11-12" },
    ]);
    expect(total.items.map((i) => i.kind)).toEqual([
      "converted",
      "rate-unavailable",
      "rate-unavailable",
      "reporting-currency",
    ]);
    const missing = total.items[1]!;
    expect(missing).toEqual({ kind: "rate-unavailable", original: Money.of("5000", "GEL") });
    expect([
      total.total?.toDecimalString(),
      total.approximate,
      total.unavailableCount,
      total.nearestRateCount,
    ]).toEqual(["11.5", true, 2, 0]);

    // Only amounts without a rate: no total at all, never 0.
    const none = await reporting().total([{ amount: Money.of("1", "GEL"), date: null }]);
    expect([none.total, none.approximate, none.unavailableCount]).toEqual([null, true, 1]);

    // Once the rate appears, the amount joins the total.
    await seed([["2026-11-12", "GEL", "16.00"]]);
    const later = await reporting().total([{ amount: Money.of("5000", "GEL"), date: "2026-11-12" }]);
    expect([later.total?.toDecimalString(), later.approximate, later.unavailableCount]).toEqual([
      "2000",
      false,
      0,
    ]);
  });
});
