import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Money } from "@willowsum/domain-kernel";
import { syntheticHouseholds } from "@willowsum/synthetic";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFxRates, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import {
  ModuleDatabases,
  type ModuleDatabase,
  type ModuleQueryRunner,
} from "../src/platform/db/module-db.ts";
import { filterValue } from "../src/platform/http/list-query.ts";
import { defineList, type ListRequest } from "../src/platform/lists/list-engine.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

/**
 * DAT-01@PoC on a real PostgreSQL: the list engine runs as a module's own role inside a household transaction
 * (row policy of ARC-03), and the totals convert with the real fx-rates module reading its rate history (NBU,
 * cross rates through the hryvnia). The fixture module `listings` has one list table `entries`. The clock is
 * fixed: «today» is 2026-11-12.
 */
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const NOW = Date.UTC(2026, 10, 12, 10, 0);
const [spaceA, spaceB] = syntheticHouseholds("dat-01-list", 2).map((h) => h.id) as [string, string];

let db: { url: string; drop: () => Promise<void> };
let owner: pg.Client;
let databases: ModuleDatabases;

const transactions = defineList({
  table: "entries",
  select: { id: "entry_id", bookedOn: "booked_on", amount: "amount", currency: "currency" },
  tieBreaker: "entry_id",
  filters: {
    bookedOn: { column: "booked_on", cast: "date", value: filterValue.isoDate(), operators: ["gte", "lte"] },
    currency: {
      column: "currency",
      cast: "text",
      value: z.string().regex(/^[A-Z]{3}$/),
      operators: ["eq", "in"],
    },
    description: { column: "description", cast: "text", value: z.string().max(200), operators: ["has"] },
    vintage: {
      column: "attributes",
      attribute: "vintage",
      cast: "text",
      value: z.string().max(20),
      operators: ["eq", "empty", "nempty"],
    },
  },
  sorts: { bookedOn: "booked_on", amount: "amount" },
  defaultSort: { field: "bookedOn", direction: "desc" },
  amounts: { amountColumn: "amount", currencyColumn: "currency", rateDate: { column: "booked_on" } },
});

const totals = () =>
  createListTotals({
    rates: officialDatedRates(createFxRates({ db: databases.for("fx-rates"), now: () => NOW })),
    now: () => NOW,
  });

/** Lists space `space` as the fixture module's own role and totals it in EUR. */
async function listOf(space: string, request: ListRequest = {}) {
  const result = await databases.for("listings").inHousehold(space, (q) => transactions.run(q, request));
  return { ...result, total: await totals().total(result.groups, "EUR") };
}

async function seed(
  space: string,
  rows: {
    on: string;
    amount: string;
    currency: string;
    bankRate?: string;
    description?: string;
    attributes?: object;
  }[],
) {
  for (const r of rows)
    await owner.query(
      `INSERT INTO listings.entries (household_id, booked_on, amount, currency, bank_rate, description, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        space,
        r.on,
        r.amount,
        r.currency,
        r.bankRate ?? null,
        r.description ?? "",
        JSON.stringify(r.attributes ?? {}),
      ],
    );
}

/** Official NBU rate: 1 EUR = `uah` UAH on `date`. */
async function eurRate(date: string, uah: string) {
  await owner.query(
    `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, 'EUR', $2, 'NBU', now())`,
    [date, uah],
  );
}

const eur = (amount: string) => Money.of(amount, "EUR");

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new pg.Client({ connectionString: db.url });
  await owner.connect();
  await migrateRealModules(owner, db.url);
  await migrate(owner, { modules: ["listings"], modulesDir: fixtures });
  const password = randomBytes(12).toString("hex");
  for (const module of [...realModules, "listings"]) await enableModuleLogin(owner, module, password);
  await enableContextLogin(owner, password);
  databases = new ModuleDatabases({
    connectionFor: (module) => ({ connectionString: urlAs(db.url, moduleRoleName(module), password) }),
    context: { connectionString: urlAs(db.url, CONTEXT_ROLE, password) },
  });
});

afterAll(async () => {
  await databases?.end();
  await owner?.end();
  await db?.drop();
});

beforeEach(async () => {
  await owner.query("TRUNCATE listings.entries, fx_rates.rates");
});

describe("DAT-01@PoC: totals at the official rate of each transaction's date (PostgreSQL + fx-rates)", () => {
  it("DAT-01@PoC AC2: −100,00 EUR (03.11) + −1 000,00 UAH (01.10 at 40, today 50) → −125,00 € «конвертовано»", async () => {
    await eurRate("2026-10-01", "40");
    await eurRate("2026-11-03", "50");
    await eurRate("2026-11-12", "50");
    await seed(spaceA, [
      { on: "2026-11-03", amount: "-100.00", currency: "EUR" },
      { on: "2026-10-01", amount: "-1000.00", currency: "UAH" },
    ]);
    const { total, count } = await listOf(spaceA);
    expect(count).toBe(2);
    expect(total.total?.equals(eur("-125"))).toBe(true);
    expect(total).toMatchObject({ converted: true, approximate: false, nearestRateCount: 0, noRateCount: 0 });
  });

  it("DAT-01@PoC AC3: no rate on the UAH transaction's date → nearest 40: −165,00 € «приблизно», 1 транзакція", async () => {
    await eurRate("2026-10-29", "40");
    await seed(spaceA, [
      { on: "2026-11-03", amount: "-100.00", currency: "EUR" },
      { on: "2026-11-03", amount: "-40.00", currency: "EUR" },
      { on: "2026-11-01", amount: "-1000.00", currency: "UAH" },
    ]);
    const { total } = await listOf(spaceA);
    expect(total.total?.equals(eur("-165"))).toBe(true);
    expect(total).toMatchObject({ count: 3, approximate: true, nearestRateCount: 1 });
  });

  it("DAT-01@PoC AC4: a Saturday or Sunday at Friday's rate (the real fx-rates rule) is not «приблизно»; a Monday at Friday's rate is", async () => {
    await eurRate("2026-10-30", "40");
    await seed(spaceA, [
      { on: "2026-10-31", amount: "-400.00", currency: "UAH" },
      { on: "2026-11-01", amount: "-400.00", currency: "UAH" },
    ]);
    expect((await listOf(spaceA)).total).toMatchObject({ approximate: false, nearestRateCount: 0 });
    await seed(spaceA, [{ on: "2026-11-02", amount: "-400.00", currency: "UAH" }]);
    expect((await listOf(spaceA)).total).toMatchObject({ approximate: true, nearestRateCount: 1 });
  });

  it("DAT-01@PoC AC4: the rate of that date (50) appears → −160,00 € without «приблизно» or the nearest-rate hint", async () => {
    await eurRate("2026-10-29", "40");
    await seed(spaceA, [
      { on: "2026-11-03", amount: "-100.00", currency: "EUR" },
      { on: "2026-11-03", amount: "-40.00", currency: "EUR" },
      { on: "2026-11-01", amount: "-1000.00", currency: "UAH" },
    ]);
    expect((await listOf(spaceA)).total.approximate).toBe(true);
    await eurRate("2026-11-01", "50");
    const { total } = await listOf(spaceA);
    expect(total.total?.equals(eur("-160"))).toBe(true);
    expect(total).toMatchObject({ approximate: false, nearestRateCount: 0 });
  });

  it("DAT-01@PoC AC5, EC4: bank rate 41 on the record, official NBU rate 40 → −25,00 €, not −24,39 €", async () => {
    await eurRate("2026-10-01", "40");
    await seed(spaceA, [{ on: "2026-10-01", amount: "-1000.00", currency: "UAH", bankRate: "41" }]);
    const { total } = await listOf(spaceA);
    expect(total.total?.equals(eur("-25"))).toBe(true);
  });

  it("DAT-01@PoC AC6: a transaction older than every EUR rate → partial −100,00 € «без 1 запису: немає курсу», never 0 or a later rate", async () => {
    await eurRate("2026-11-01", "40");
    await seed(spaceA, [
      { on: "2026-11-03", amount: "-100.00", currency: "EUR" },
      { on: "2026-01-05", amount: "-1000.00", currency: "UAH" },
    ]);
    const { total } = await listOf(spaceA);
    expect(total.total?.equals(eur("-100"))).toBe(true);
    expect(total).toMatchObject({ count: 2, partial: true, noRateCount: 1, approximate: false });
  });

  it("DAT-01@PoC FR 12: balances at today's rate with the real fx-rates rule — 3 calendar days plain, older «приблизно» (owner decision 2026-11-13)", async () => {
    // Today is Thursday 2026-11-12 in Kyiv.
    const balances = [{ currency: "UAH", date: null, sum: Money.of("400", "UAH"), count: 2 }];
    await eurRate("2026-11-09", "40"); // Monday: 3 days
    expect(await totals().total(balances, "EUR")).toMatchObject({ approximate: false, staleRateCount: 0 });
    await owner.query("TRUNCATE fx_rates.rates");
    await eurRate("2026-11-08", "40"); // Sunday: 4 days
    const stale = await totals().total(balances, "EUR");
    expect(stale.total?.equals(eur("10"))).toBe(true);
    expect(stale).toMatchObject({ approximate: true, staleRateCount: 2, nearestRateCount: 0 });
  });

  it("DAT-01@PoC EC5: no record has any rate → no total, only the marker", async () => {
    await eurRate("2026-11-01", "40");
    await seed(spaceA, [{ on: "2026-01-05", amount: "-1000.00", currency: "UAH" }]);
    const { total } = await listOf(spaceA);
    expect(total.total).toBeNull();
    expect(total).toMatchObject({ partial: true, noRateCount: 1 });
  });
});

/** The fx-rates database with every query counted (one read per total, not one per currency and day). */
function countingDatabase(): { db: ModuleDatabase; queries: () => number } {
  const real = databases.for("fx-rates");
  let queries = 0;
  const db = {
    module: real.module,
    transaction: <T>(work: (q: ModuleQueryRunner) => Promise<T>) =>
      real.transaction((q) =>
        work({
          query: (text, values) => {
            queries += 1;
            return q.query(text, values);
          },
        }),
      ),
  } as unknown as ModuleDatabase;
  return { db, queries: () => queries };
}

describe("DAT-01@PoC FR 12: all the rates of a total in one query (security review of PR #129)", () => {
  it("DAT-01@PoC FR 12: 1 095 days in UAH, USD and GBP → one rate query; each the rate of its date or the latest earlier one", async () => {
    // Rates on weekdays only; GBP and USD from 2024, EUR from 2023; GBP from another source on Mondays.
    const values: string[] = [];
    for (let i = 0; i < 1100; i++) {
      const d = new Date(Date.UTC(2023, 0, 2 + i));
      const day = d.toISOString().slice(0, 10);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      values.push(`('${day}', 'EUR', ${40 + (i % 7)}, 'NBU', now())`);
      if (day >= "2024-01-01") {
        values.push(`('${day}', 'USD', ${36 + (i % 5)}, 'NBU', now())`);
        values.push(`('${day}', 'GBP', ${48 + (i % 3)}, '${d.getUTCDay() === 1 ? "OTHER" : "NBU"}', now())`);
      }
    }
    await owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ${values.join(", ")}`,
    );
    const days = Array.from({ length: 1095 }, (_, i) =>
      new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    );
    const groups = days.flatMap((d) =>
      ["UAH", "USD", "GBP"].map((currency) => ({
        currency,
        date: d,
        sum: Money.of("-1", currency),
        count: 1,
      })),
    );
    const counting = countingDatabase();
    const fx = createFxRates({ db: counting.db, now: () => NOW });
    const result = await createListTotals({ rates: officialDatedRates(fx), now: () => NOW }).total(
      groups,
      "EUR",
    );
    expect(counting.queries()).toBe(1);
    expect(result.count).toBe(3285);
    expect(result.noRateCount).toBeGreaterThan(0); // USD and GBP before 2024, the 1 January of 2023
    expect(result.total).not.toBeNull();

    // The batch read gives exactly what the one-by-one read gives (`rate`: latest date on or before, one source).
    const sample = days.filter((_, i) => i % 37 === 0);
    const requests = sample.flatMap((date) =>
      ["UAH", "USD", "GBP"].map((from) => ({ from, to: "EUR", date })),
    );
    const batch = await fx.rates(requests);
    for (const [i, r] of requests.entries()) {
      const single = await fx.rate(r.from, r.to, r.date).then(
        (q) => q.rate,
        () => null,
      );
      const got = batch[i] ?? null;
      expect(got && { rate: got.rate.toFixed(), date: got.date, source: got.source }).toEqual(
        single && { rate: single.rate.toFixed(), date: single.date, source: single.source },
      );
      if (got) expect(got.date <= r.date).toBe(true);
    }
  });

  it("DAT-01@PoC FR 12: a database error while reading the rates fails the total, never «немає курсу»", async () => {
    await eurRate("2026-10-01", "40");
    await seed(spaceA, [{ on: "2026-10-01", amount: "-1000.00", currency: "UAH" }]);
    const result = await databases.for("listings").inHousehold(spaceA, (q) => transactions.run(q, {}));
    await owner.query("ALTER TABLE fx_rates.rates RENAME TO rates_gone");
    try {
      await expect(totals().total(result.groups, "EUR")).rejects.toThrow();
    } finally {
      await owner.query("ALTER TABLE fx_rates.rates_gone RENAME TO rates");
    }
  });
});

describe("DAT-01@PoC FR 9: count and totals only within the caller's permissions (one user per space in PoC)", () => {
  beforeEach(async () => {
    await eurRate("2026-10-01", "40");
    await seed(spaceA, [
      { on: "2026-10-01", amount: "-10.00", currency: "EUR" },
      { on: "2026-10-02", amount: "-20.00", currency: "EUR" },
    ]);
    await seed(spaceB, [
      { on: "2026-10-01", amount: "-99999.00", currency: "EUR" },
      { on: "2026-10-01", amount: "-40000.00", currency: "UAH" },
    ]);
  });

  it("DAT-01@PoC FR 9: another space's records add nothing to the page, the count or the sum", async () => {
    const a = await listOf(spaceA);
    expect(a.count).toBe(2);
    expect(a.items).toHaveLength(2);
    expect(a.total.total?.equals(eur("-30"))).toBe(true);
    expect(a.total.converted).toBe(false);
    const b = await listOf(spaceB);
    expect(b.count).toBe(2);
    expect(b.total.total?.equals(eur("-100999"))).toBe(true);
  });

  it("DAT-01@PoC FR 9: a session bound to no space sees no rows, count or sum", async () => {
    const none = await databases
      .for("listings")
      .transaction((q) => transactions.run({ ...q, householdId: spaceA }, {}));
    expect(none).toMatchObject({ count: 0, items: [], groups: [] });
  });

  it("DAT-01@PoC FR 4: the count and the totals follow the applied filters, like the rows", async () => {
    const filtered = await listOf(spaceA, { filter: ["bookedOn.gte:2026-10-02"] });
    expect(filtered.count).toBe(1);
    expect(filtered.total.total?.equals(eur("-20"))).toBe(true);
  });
});

describe("DAT-01@PoC: pages, sorting and list filters on PostgreSQL", () => {
  it("DAT-01@PoC FR 6: 60 records in pages of 25: page 3 holds 51–60 of 60; pages never overlap", async () => {
    await seed(
      spaceA,
      Array.from({ length: 60 }, (_, i) => ({ on: "2026-10-01", amount: `-${i + 1}.00`, currency: "EUR" })),
    );
    const pages = await Promise.all([1, 2, 3].map((page) => listOf(spaceA, { page, pageSize: 25 })));
    expect(pages.map((p) => [p.from, p.to, p.count])).toEqual([
      [1, 25, 60],
      [26, 50, 60],
      [51, 60, 60],
    ]);
    const ids = pages.flatMap((p) => p.items.map((i) => i["id"]));
    expect(new Set(ids).size).toBe(60);
    const beyond = await listOf(spaceA, { page: 4, pageSize: 25 });
    expect(beyond).toMatchObject({ items: [], from: 0, to: 0, count: 60 });
    const all = await listOf(spaceA, { pageSize: 100 });
    expect(all.items).toHaveLength(60);
  });

  it("DAT-01@PoC FR 3: a whitelisted sort ascending, then descending", async () => {
    await seed(spaceA, [
      { on: "2026-10-01", amount: "-5.00", currency: "EUR" },
      { on: "2026-10-01", amount: "7.50", currency: "EUR" },
      { on: "2026-10-01", amount: "-12.25", currency: "EUR" },
    ]);
    const amounts = async (sort: string) =>
      (await listOf(spaceA, { sort })).items.map((i) =>
        Money.of(String(i["amount"]), "EUR").toDecimalString(),
      );
    expect(await amounts("amount")).toEqual(["-12.25", "-5", "7.5"]);
    expect(await amounts("-amount")).toEqual(["7.5", "-5", "-12.25"]);
  });

  it("DAT-01@PoC EC1: a type attribute filter — records without the attribute fall under «порожнє»", async () => {
    await seed(spaceA, [
      { on: "2026-10-01", amount: "-1.00", currency: "EUR", attributes: { vintage: "2015" } },
      { on: "2026-10-02", amount: "-2.00", currency: "EUR", attributes: { area: "64" } },
      { on: "2026-10-03", amount: "-3.00", currency: "EUR" },
    ]);
    expect((await listOf(spaceA, { filter: "vintage.empty:" })).count).toBe(2);
    expect((await listOf(spaceA, { filter: "vintage.nempty:" })).count).toBe(1);
    expect((await listOf(spaceA, { filter: "vintage.eq:2015" })).count).toBe(1);
  });

  it("DAT-01@PoC FR 4: «містить» matches case-insensitively and takes % and _ literally", async () => {
    await seed(spaceA, [
      { on: "2026-10-01", amount: "-1.00", currency: "EUR", description: "Знижка 50% на каву" },
      { on: "2026-10-02", amount: "-2.00", currency: "EUR", description: "Кава 500 г" },
    ]);
    expect((await listOf(spaceA, { filter: "description.has:КАВ" })).count).toBe(2);
    expect((await listOf(spaceA, { filter: "description.has:50%" })).count).toBe(1);
    expect((await listOf(spaceA, { filter: "description.has:_" })).count).toBe(0);
  });
});
describe("rr129: each request keeps its own date in the batched read (kills: dates misaligned with currencies)", () => {
  it("DAT-01@PoC FR 12: two currencies on different dates, in either order, get the rate of their own date", async () => {
    await owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES
         ('2026-10-01', 'EUR', 40, 'NBU', now()), ('2026-10-01', 'USD', 36, 'NBU', now()),
         ('2026-10-05', 'EUR', 50, 'NBU', now()), ('2026-10-05', 'USD', 25, 'NBU', now())`,
    );
    const fx = createFxRates({ db: databases.for("fx-rates"), now: () => NOW });
    const requests = [
      { from: "UAH", to: "EUR", date: "2026-10-01" },
      { from: "USD", to: "EUR", date: "2026-10-05" },
    ];
    for (const order of [requests, [...requests].reverse()]) {
      const got = await fx.rates(order);
      const single = await Promise.all(order.map((r) => fx.rate(r.from, r.to, r.date).then((q) => q.rate)));
      expect(got.map((r) => r && `${r.rate.toFixed()}@${r.date}`)).toEqual(
        single.map((r) => `${r.rate.toFixed()}@${r.date}`),
      );
    }
    const [uah1, usd5] = await fx.rates(requests);
    expect(uah1 && `${uah1.rate.toFixed()}@${uah1.date}`).toBe("0.025@2026-10-01");
    expect(usd5 && `${usd5.rate.toFixed()}@${usd5.date}`).toBe("0.5@2026-10-05");
  });
});
