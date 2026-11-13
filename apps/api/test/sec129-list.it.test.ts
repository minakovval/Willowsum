import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { syntheticHouseholds } from "@willowsum/synthetic";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFxRates, officialDatedRates } from "../src/modules/fx-rates/index.ts";
import { CONTEXT_ROLE } from "../src/platform/db/isolation.ts";
import { enableContextLogin, enableModuleLogin, migrate } from "../src/platform/db/migrate.ts";
import { ModuleDatabases } from "../src/platform/db/module-db.ts";
import { filterValue } from "../src/platform/http/list-query.ts";
import { defineList, type ListRequest } from "../src/platform/lists/list-engine.ts";
import { createListTotals } from "../src/platform/lists/list-total.ts";
import { moduleRoleName } from "../src/platform/modules/rules.ts";
import { createTestDatabase, urlAs } from "./db.ts";
import { migrateRealModules, realModules } from "./real-modules.ts";

/**
 * Security review of PR #129 (DAT-01@PoC), round 1: gaps found by mutation testing of the list engine and totals.
 * Setup as in dat01-list.it.test.ts.
 *
 * DAT-01@PoC on a real PostgreSQL: the list engine runs as a module's own role inside a household transaction
 * (row policy of ARC-03), and the totals convert with the real fx-rates module reading its rate history (NBU,
 * cross rates through the hryvnia). The fixture module `listings` has one list table `entries`. The clock is
 * fixed: «today» is 2026-11-12.
 */
const fixtures = fileURLToPath(new URL("./fixtures/db-modules", import.meta.url));
const NOW = Date.UTC(2026, 10, 12, 10, 0);
const [spaceA, spaceB] = syntheticHouseholds("sec129-list", 2).map((h) => h.id) as [string, string];

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

describe("sec129: amounts never pass through a JS number or a float (hard rule «Money»)", () => {
  it("sec129: a sum beyond 2^53 stays exact on the page's totals (kills: sum via Number / ::float8)", async () => {
    await seed(spaceA, [
      { on: "2026-10-01", amount: "12345678901234567.89", currency: "EUR" },
      { on: "2026-10-01", amount: "0.01", currency: "EUR" },
      { on: "2026-10-01", amount: "0.000000000000000001", currency: "EUR" },
    ]);
    const { groups, total } = await listOf(spaceA);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sum.toDecimalString()).toBe("12345678901234567.900000000000000001");
    expect(total.total?.toDecimalString()).toBe("12345678901234567.900000000000000001");
  });

  it("sec129: a converted sum beyond 2^53 stays exact (UAH → EUR at 40)", async () => {
    await eurRate("2026-10-01", "40");
    await seed(spaceA, [
      { on: "2026-10-01", amount: "4000000000000000000.04", currency: "UAH" },
      { on: "2026-10-01", amount: "0.000000000000000040", currency: "UAH" },
    ]);
    const { total } = await listOf(spaceA);
    expect(total.total?.toDecimalString()).toBe("100000000000000000.001000000000000001");
  });
});

describe("sec129: the rate is never one from after the transaction's date", () => {
  it("sec129: only a later rate exists → «немає курсу», not the later rate", async () => {
    await eurRate("2026-10-02", "40");
    await eurRate("2026-11-12", "50");
    await seed(spaceA, [{ on: "2026-10-01", amount: "-1000.00", currency: "UAH" }]);
    const { total } = await listOf(spaceA);
    expect(total.total).toBeNull();
    expect(total).toMatchObject({ noRateCount: 1, approximate: false });
  });

  it("sec129: officialDatedRates passes a store rejection through; it never turns it into «немає курсу»", async () => {
    // Proves the adapter only. That the list total then fails is proven end to end in dat01-list.it.test.ts
    // («a database error while reading the rates fails the total»).
    const broken = officialDatedRates({
      rates: () => Promise.reject(new Error("connection terminated")),
    });
    await expect(broken.rates([{ from: "UAH", to: "EUR", date: "2026-10-01" }])).rejects.toThrow(
      "connection terminated",
    );
    const missing = officialDatedRates(createFxRates({ db: databases.for("fx-rates"), now: () => NOW }));
    await expect(missing.rates([{ from: "UAH", to: "EUR", date: "2026-10-01" }])).resolves.toEqual([null]);
  });
});

describe("sec129: household isolation holds in the SQL itself, not only through the row policy", () => {
  it("sec129: on a connection that bypasses RLS (superuser) the code filter alone keeps another space's rows, count and sum out", async () => {
    await seed(spaceA, [{ on: "2026-10-01", amount: "-10.00", currency: "EUR" }]);
    await seed(spaceB, [
      { on: "2026-10-01", amount: "-99999.00", currency: "EUR" },
      { on: "2026-10-02", amount: "-1.00", currency: "EUR" },
    ]);
    await owner.query("SET search_path TO listings");
    try {
      const runner = {
        householdId: spaceA,
        query: (text: string, values?: unknown[]) => owner.query(text, values),
      } as unknown as Parameters<typeof transactions.run>[0];
      const result = await transactions.run(runner, {});
      expect(result.count).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.groups.map((g) => g.sum.toDecimalString())).toEqual(["-10"]);
    } finally {
      await owner.query("RESET search_path");
    }
  });
});

describe("sec129: hostile list input never reaches SQL as text", () => {
  it.each([
    ["sort with SQL", { sort: "amount; DROP TABLE listings.entries" }],
    ["sort by a raw column", { sort: "household_id" }],
    ["sort by a prototype key", { sort: "__proto__" }],
    ["a filter on the household", { filter: "household.eq:00000000-0000-0000-0000-000000000000" }],
    ["an operator outside the whitelist", { filter: "bookedOn.like:2026" }],
    ["a quoted date value", { filter: "bookedOn.gte:2026-10-01' OR '1'='1" }],
    ["a value for «порожнє»", { filter: "vintage.empty:x' OR 1=1 --" }],
    ["page size 1000", { pageSize: 1000 }],
    ["page size 0", { pageSize: 0 }],
    ["page beyond the cap", { page: 100_001 }],
  ] as [string, ListRequest][])("sec129: %s → 400 VALIDATION_FAILED", async (_what, request) => {
    await expect(listOf(spaceA, request)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("sec129: SQL inside a «містить» value is matched as text", async () => {
    await seed(spaceA, [{ on: "2026-10-01", amount: "-1.00", currency: "EUR", description: "кава" }]);
    expect((await listOf(spaceA, { filter: "description.has:' OR 1=1 --" })).count).toBe(0);
    expect((await listOf(spaceA, { filter: "description.has:%" })).count).toBe(0);
    expect((await owner.query("SELECT count(*)::int AS n FROM listings.entries")).rows[0].n).toBe(1);
  });
});

describe("sec129: stable, complete order across pages on PostgreSQL", () => {
  it("sec129: 130 records with equal sort keys in pages of 25 and 50: every record once, none skipped", async () => {
    await seed(
      spaceA,
      Array.from({ length: 130 }, () => ({ on: "2026-10-01", amount: "-1.00", currency: "EUR" })),
    );
    for (const pageSize of [25, 50] as const) {
      const ids: unknown[] = [];
      for (let page = 1; page <= Math.ceil(130 / pageSize); page++)
        ids.push(...(await listOf(spaceA, { page, pageSize, sort: "-amount" })).items.map((i) => i["id"]));
      expect(ids).toHaveLength(130);
      expect(new Set(ids).size).toBe(130);
    }
  });
});

describe("sec129: a list declaration the table cannot keep is refused (review of #129, non-blocking 2–4)", () => {
  const loose = (tieBreaker: string, column: string) =>
    defineList({
      table: "loose_entries",
      select: { id: "row_id", amount: "amount" },
      tieBreaker,
      filters: {},
      sorts: { amount: "amount" },
      defaultSort: { field: "amount", direction: "desc" },
      amounts: { amountColumn: "amount", currencyColumn: "currency", rateDate: { column } },
    });
  const run = (list: ReturnType<typeof loose>) =>
    databases.for("listings").inHousehold(spaceA, (q) => list.run(q, {}));

  it("sec129: a tie-breaker without a unique key is refused (paging could skip or repeat records)", async () => {
    await expect(run(loose("entry_id", "posted_on"))).rejects.toThrow(/tie-breaker entry_id/);
  });

  it("sec129: a nullable rate-date column is refused (an empty date is never converted at today's rate)", async () => {
    await expect(run(loose("row_id", "booked_on"))).rejects.toThrow(/rate-date column booked_on is date,/);
  });

  it("sec129: a timestamptz rate-date column is refused (the rate day is the Kyiv date, not the session's)", async () => {
    await expect(run(loose("row_id", "booked_at"))).rejects.toThrow(
      /rate-date column booked_at is timestamp with time zone not null/,
    );
  });

  it("sec129: a primary key, or a key unique within the household, with a NOT NULL date column is accepted", async () => {
    await expect(run(loose("row_id", "posted_on"))).resolves.toMatchObject({ count: 0 });
    await expect(run(loose("entry_ref", "posted_on"))).resolves.toMatchObject({ count: 0 });
    await expect(run(transactions)).resolves.toMatchObject({ count: 0 });
  });
});
