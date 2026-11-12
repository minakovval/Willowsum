import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupRealModules, realModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createFxRates } from "./index.ts";

/**
 * Security review of PR #120 (VAL-05@PoC): rates are platform reference data; only the fx-rates role writes
 * them; a cross rate uses the rates of one date, never a later one; a missing rate is «no rate», never 0 or 1.
 */
let db: RealModulesDatabase;
const reader = () => createFxRates({ db: db.databases.for("fx-rates"), now: () => Date.UTC(2026, 10, 14) });

async function seed(rows: [date: string, currency: string, rate: string][]) {
  for (const [d, c, r] of rows)
    await db.owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ($1, $2, $3, 'NBU', now())`,
      [d, c, r],
    );
}

beforeAll(async () => {
  db = await setupRealModules();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.owner.query("TRUNCATE fx_rates.rates, fx_rates.updates, fx_rates.stale_alerts");
});

describe("sec#120: fx-rates isolation, grants and lookup", () => {
  it("only the fx-rates roles hold privileges on fx_rates tables; PUBLIC and every other module role hold none", async () => {
    const { rows } = await db.owner.query<{ grantee: string; t: string; p: string }>(
      `SELECT grantee, table_name AS t, privilege_type AS p FROM information_schema.role_table_grants
        WHERE table_schema = 'fx_rates' AND grantee NOT IN ('ws_mod_fx_rates', 'ws_own_fx_rates')
          AND grantee <> (SELECT rolname FROM pg_roles r JOIN pg_class c ON c.relowner = r.oid
                          JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'fx_rates' AND c.relname = 'rates')`,
    );
    expect(rows).toEqual([]);
    const usage = await db.owner.query<{ r: string }>(
      `SELECT rolname AS r FROM pg_roles WHERE rolname LIKE 'ws\\_%'
         AND rolname NOT IN ('ws_mod_fx_rates', 'ws_own_fx_rates')
         AND has_schema_privilege(rolname, 'fx_rates', 'USAGE')`,
    );
    expect(usage.rows).toEqual([]);
  });

  it("another module's own connection cannot write or read rates", async () => {
    const other = realModules.find((m) => m !== "fx-rates")!;
    await expect(
      db.databases
        .for(other)
        .transaction((q) =>
          q.query(
            `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ('2026-11-12','EUR',1,'NBU',now())`,
          ),
        ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.databases.for(other).transaction((q) => q.query(`SELECT 1 FROM fx_rates.rates`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("FR3: a cross rate takes both currencies from one date — the latest date that has both, never a mix", async () => {
    await seed([
      ["2026-11-12", "EUR", "45"],
      ["2026-11-12", "PLN", "11.25"],
      ["2026-11-13", "EUR", "50"],
    ]);
    const q = await reader().rate("PLN", "EUR", "2026-11-13");
    expect([q.rate.rate.toFixed(), q.rate.date]).toEqual(["0.25", "2026-11-12"]);
  });

  it("FR3: the nearest earlier rate, never a later one, even when a later date is stored", async () => {
    await seed([
      ["2026-11-09", "EUR", "43"],
      ["2026-11-10", "EUR", "44"],
      ["2026-11-12", "EUR", "45"],
    ]);
    const q = await reader().rate("EUR", "UAH", "2026-11-11");
    expect([q.rate.rate.toFixed(), q.rate.date]).toEqual(["44", "2026-11-10"]);
    const c = await reader().convert(Money.of("10", "EUR"), "UAH", "2026-11-11");
    expect([c.conversion.to.toDecimalString(), c.conversion.approximate]).toEqual(["440", true]);
  });

  it("a missing rate is «no rate» (RateUnavailableError), never 0 or 1", async () => {
    await seed([["2026-11-12", "EUR", "45"]]);
    for (const [from, to] of [
      ["PLN", "EUR"],
      ["EUR", "PLN"],
      ["PLN", "UAH"],
      ["UAH", "PLN"],
    ] as const)
      await expect(reader().rate(from, to, "2026-11-12")).rejects.toMatchObject({
        name: "RateUnavailableError",
      });
    await expect(reader().convert(Money.of("1", "PLN"), "UAH", "2026-11-12")).rejects.toMatchObject({
      name: "RateUnavailableError",
    });
  });

  it("the database refuses a zero, negative or UAH rate even from the module's own role", async () => {
    for (const [c, r] of [
      ["EUR", "0"],
      ["EUR", "-1"],
      ["UAH", "1"],
      ["eur", "1"],
    ])
      await expect(
        db.databases
          .for("fx-rates")
          .transaction((q) =>
            q.query(
              `INSERT INTO rates (rate_date, currency, rate, source, fetched_at) VALUES ('2026-11-12',$1,$2,'NBU',now())`,
              [c, r],
            ),
          ),
      ).rejects.toThrow(/check constraint/);
  });
});
