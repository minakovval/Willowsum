import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { apiRoutes, mountApi } from "../src/api.ts";
import { createAuditLog, type AuditLog } from "../src/modules/audit/index.ts";
import {
  FIXED_CONVERSION_SOURCE,
  REPORTING_CURRENCY,
  createFxRates,
  createFxReporting,
  officialDatedRates,
  type ReportedAmount,
} from "../src/modules/fx-rates/index.ts";
import {
  SPACE_REPORTING_CURRENCY,
  createHouseholdServices,
  type HouseholdSpaces,
} from "../src/modules/household/index.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeFlags, principalHeader, testAuthenticate } from "./http.ts";
import { householdSpaces, setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * ACC-06@PoC, server side, on a real PostgreSQL: the reporting currency is an attribute of the space, EUR for every
 * space and any locale with no way to choose it (FR 1, FR 2, AC1, AC2), and amounts in another currency are shown in
 * the space's reporting currency with the data of the «≈» hint — original amount, rate, rate date, source, and
 * «найближчий доступний курс» (FR 3, AC3, AC4, edge case 1) — and a replaced currency at the fixed rate of the
 * directory (edge case 2). The hint itself, its hover and keyboard focus, is the UI's (wave 2 row 111). Accounts,
 * names, amounts and rates are synthetic; the clock is fixed.
 */
const WEB = "http://localhost:5173";
const openapi = JSON.parse(
  readFileSync(new URL("../../../packages/api-contract/openapi.json", import.meta.url), "utf8"),
) as { paths: Record<string, Record<string, { requestBody?: unknown }>> };
// «Today» is Monday 2026-11-16 in Kyiv.
const NOW = Date.UTC(2026, 10, 16, 10, 0);

let db: RealModulesDatabase;
let spaces: HouseholdSpaces;
let audit: AuditLog;
let app: ReturnType<typeof buildServer>;

interface Space {
  readonly accountId: string;
  readonly householdId: string;
}

async function newSpace(displayName: string): Promise<Space> {
  const accountId = randomUUID();
  const { householdId } = await spaces.ensureFirstSpace({ accountId, displayName });
  return { accountId, householdId };
}

function call(space: Space, method: "GET" | "PATCH", body?: unknown, locale = "uk-UA") {
  return app.inject({
    method,
    url: "/v1/space",
    headers: {
      origin: WEB,
      "accept-language": locale,
      ...principalHeader({ userId: space.accountId, householdId: space.householdId }),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

async function storedCurrency(householdId: string): Promise<string> {
  const { rows } = await db.owner.query<{ reporting_currency: string }>(
    `SELECT reporting_currency FROM household.households WHERE household_id = $1`,
    [householdId],
  );
  return rows[0]!.reporting_currency;
}

/** The space's reporting currency as the API gives it: what every amount of the space is shown in. */
async function reportingCurrencyOf(space: Space): Promise<string> {
  const res = await call(space, "GET");
  expect(res.statusCode).toBe(200);
  return (res.json() as { reportingCurrency: string }).reportingCurrency;
}

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
  db = await setupRealModules(4);
  spaces = householdSpaces(db);
  audit = createAuditLog(db.databases.for("audit"));
  app = buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) =>
      mountApi(a, {
        databases: db.databases,
        entitlements: "all-enabled",
        flags: fakeFlags(),
        authenticate: testAuthenticate,
        household: createHouseholdServices({ audit }),
        allowedOrigins: new Set([WEB]),
      }),
  });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

beforeEach(async () => {
  await db.owner.query("TRUNCATE fx_rates.rates, fx_rates.updates, fx_rates.stale_alerts");
});

describe("ACC-06@PoC FR 1, FR 2: the reporting currency is an attribute of the space, EUR with no choice", () => {
  it("ACC-06@PoC AC1: a new space of any user gets EUR, and its creation is logged with it; there is no step to choose", async () => {
    // The first space is made from the account and its name only: no locale or currency goes in (no step to choose).
    for (const displayName of ["Олена Коваль", "Jan Kowalski", "María García", "Ali"]) {
      const space = await newSpace(displayName);
      expect(await storedCurrency(space.householdId)).toBe("EUR");
      const [created] = (
        await audit.entriesFor(space.householdId, { type: "household.space", id: space.householdId })
      ).filter((e) => e.action === "create");
      expect(created?.changes).toContainEqual({
        field: "reportingCurrency",
        before: null,
        after: "EUR",
        masked: false,
      });
    }
    expect(SPACE_REPORTING_CURRENCY).toBe("EUR");
    // household's attribute and the currency fx-rates converts into by default are the same.
    expect(REPORTING_CURRENCY).toBe(SPACE_REPORTING_CURRENCY);
  });

  it("ACC-06@PoC AC2: with the browser locale uk-UA (or any other) the space reports in EUR", async () => {
    const space = await newSpace("Тарас Шевчук");
    for (const locale of ["uk-UA", "uk", "en-US", "pl-PL", "de-DE", "es-ES"]) {
      const res = await call(space, "GET", undefined, locale);
      expect(res.statusCode, locale).toBe(200);
      expect(res.json()).toEqual({ name: "Родина Шевчук", dataRegion: "eu", reportingCurrency: "EUR" });
    }
  });

  it("ACC-06@PoC FR 1: no route sets the reporting currency; a value sent with a rename is ignored", async () => {
    const space = await newSpace("Ірина Мельник");
    const res = await call(space, "PATCH", { name: "Мельники", reportingCurrency: "UAH" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "Мельники", dataRegion: "eu", reportingCurrency: "EUR" });
    expect(await storedCurrency(space.householdId)).toBe("EUR");
    // The contract has no request body that carries it.
    const writes = Object.values(openapi.paths)
      .flatMap((ops) => Object.values(ops))
      .map((op) => JSON.stringify(op.requestBody ?? null));
    expect(writes.filter((b) => b.includes("reportingCurrency"))).toEqual([]);
    expect(apiRoutes.filter((r) => /currenc/i.test(r.path))).toEqual([]);
  });

  it("ACC-06@PoC FR 2: the database keeps every space in EUR — the default for older spaces, and no other value", async () => {
    const older = randomUUID();
    await db.owner.query(
      `INSERT INTO household.households (household_id, name, data_region, encryption_key_ref)
       VALUES ($1, 'Родина Стара', 'eu', $2)`,
      [older, `pending:${older}`],
    );
    expect(await storedCurrency(older)).toBe("EUR");
    const space = await newSpace("Петро Гнатюк");
    await expect(
      db.owner.query(`UPDATE household.households SET reporting_currency = 'UAH' WHERE household_id = $1`, [
        space.householdId,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "households_reporting_currency_eur" });
    expect(await storedCurrency(space.householdId)).toBe("EUR");
  });
});

describe("ACC-06@PoC FR 3: an amount from another currency in the space's reporting currency, with the data of its hint", () => {
  it("ACC-06@PoC AC3: the converted amount keeps the original amount, the rate, the rate date and the source (НБУ)", async () => {
    const space = await newSpace("Оксана Бойко");
    await seed([
      ["2026-11-12", "EUR", "45.00"],
      ["2026-11-12", "USD", "41.40"],
    ]);
    const currency = await reportingCurrencyOf(space);
    const original = Money.of("100.00", "USD");
    const item = converted(await reporting().toReporting({ amount: original, date: "2026-11-12" }, currency));
    expect(item.original).toBe(original);
    expect([item.value.currency, item.value.toDecimalString()]).toEqual(["EUR", "92"]);
    expect([
      item.conversion.from.toDecimalString(),
      item.conversion.from.currency,
      item.conversion.rate.toFixed(),
      item.conversion.rateDate,
      item.conversion.source,
      item.conversion.approximate,
    ]).toEqual(["100", "USD", "0.92", "2026-11-12", "NBU", false]);
    // An amount already in the reporting currency is not converted: no «≈» and no hint.
    const own = await reporting().toReporting(
      { amount: Money.of("5.00", "EUR"), date: "2026-11-12" },
      currency,
    );
    expect(own.kind).toBe("reporting-currency");
  });

  it("ACC-06@PoC AC4: no rate on the date — the last known rate is used and marked «найближчий доступний курс від <дата>»", async () => {
    const space = await newSpace("Василь Ткач");
    // Thursday 2026-11-12 has rates; Friday 2026-11-13 has none (a feed failure).
    await seed([
      ["2026-11-12", "EUR", "45.00"],
      ["2026-11-12", "PLN", "10.35"],
    ]);
    const currency = await reportingCurrencyOf(space);
    const item = converted(
      await reporting().toReporting({ amount: Money.of("100.00", "PLN"), date: "2026-11-13" }, currency),
    );
    expect([item.conversion.approximate, item.conversion.rateDate, item.conversion.requestedDate]).toEqual([
      true,
      "2026-11-12",
      "2026-11-13",
    ]);
    expect(item.value.toDecimalString()).toBe("23");
  });

  it("ACC-06@PoC EC1: the nearest available rate is replaced by the rate of the date as soon as it appears", async () => {
    const space = await newSpace("Галина Савчук");
    await seed([
      ["2026-11-12", "EUR", "45.00"],
      ["2026-11-12", "PLN", "10.35"],
    ]);
    const currency = await reportingCurrencyOf(space);
    const amount = { amount: Money.of("100.00", "PLN"), date: "2026-11-13" };
    const before = await reporting().total([amount], currency);
    expect([before.approximate, before.nearestRateCount]).toEqual([true, 1]);
    await seed([
      ["2026-11-13", "EUR", "46.00"],
      ["2026-11-13", "PLN", "10.58"],
    ]);
    const after = await reporting().total([amount], currency);
    expect([after.approximate, after.nearestRateCount, after.total?.toDecimalString()]).toEqual([
      false,
      0,
      "23",
    ]);
    expect(converted(after.items[0]!).conversion.rateDate).toBe("2026-11-13");
  });
});

describe("ACC-06@PoC edge case 2: a replaced currency through the directory of conversions", () => {
  it("ACC-06@PoC EC2: a BGN balance after 2026-01-01 is shown in EUR at the fixed rate, not at a market rate, never «приблизно»", async () => {
    const space = await newSpace("Мирослава Петренко");
    // The history still has a (synthetic) market BGN rate: the directory wins over it after the changeover.
    await seed([
      ["2026-11-16", "EUR", "46.00"],
      ["2026-11-16", "BGN", "24.00"],
    ]);
    const currency = await reportingCurrencyOf(space);
    const balance = converted(
      await reporting().toReporting({ amount: Money.of("1955.83", "BGN"), date: null }, currency),
    );
    expect(balance.value.amount.toDecimalPlaces(2).toFixed(2)).toBe("1000.00");
    expect([
      balance.conversion.source,
      balance.conversion.rateDate,
      balance.conversion.approximate,
      balance.original.currency,
    ]).toEqual([FIXED_CONVERSION_SOURCE, "2026-11-16", false, "BGN"]);

    // A transaction of a day with no rates at all is converted at the fixed rate too, not marked «приблизно».
    const total = await reporting().total(
      [{ amount: Money.of("195.583", "BGN"), date: "2026-03-10" }],
      currency,
    );
    expect([
      total.approximate,
      total.unavailableCount,
      total.total?.amount.toDecimalPlaces(2).toFixed(2),
    ]).toEqual([false, 0, "100.00"]);

    // The list totals (DAT-01) read the same directory, and so does a single rate.
    const fx = createFxRates({ db: db.databases.for("fx-rates"), now: () => NOW });
    const [listed] = await officialDatedRates(fx).rates([{ from: "BGN", to: "EUR", date: "2026-11-16" }]);
    expect([listed?.source, listed?.rate.toFixed()]).toEqual([
      FIXED_CONVERSION_SOURCE,
      balance.conversion.rate.toFixed(),
    ]);
    expect((await fx.rate("BGN", "EUR", "2026-11-16")).rate.source).toBe(FIXED_CONVERSION_SOURCE);
  });

  it("ACC-06@PoC EC2: before the changeover a BGN amount uses the official rate of its date", async () => {
    await seed([
      ["2025-12-30", "EUR", "48.00"],
      ["2025-12-30", "BGN", "24.00"],
    ]);
    const item = converted(
      await reporting().toReporting(
        { amount: Money.of("100.00", "BGN"), date: "2025-12-30" },
        SPACE_REPORTING_CURRENCY,
      ),
    );
    expect([item.conversion.source, item.conversion.rate.toFixed(), item.value.toDecimalString()]).toEqual([
      "NBU",
      "0.5",
      "50",
    ]);
    // Before 2026 and with no BGN rate at all: no rate, never the fixed one.
    const missing = await reporting().toReporting({ amount: Money.of("1.00", "BGN"), date: "2025-06-02" });
    expect(missing.kind).toBe("rate-unavailable");
  });
});
