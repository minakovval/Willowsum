import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFxReporting, REPORTING_CURRENCY } from "../src/modules/fx-rates/index.ts";
import { createLedger } from "../src/modules/ledger/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * VAL-04@PoC AC1 on a real PostgreSQL: with the space's reporting currency EUR, a transaction of 1 000 000 UAH on a
 * UAH account is stored in UAH, unconverted, and showing it in EUR changes nothing that is stored. The ledger stands
 * in for the transactions module (still a skeleton): it is where every amount is kept (ARC-11). Synthetic amounts.
 */
let db: RealModulesDatabase;

beforeAll(async () => {
  db = await setupRealModules(3);
});
afterAll(async () => {
  await db?.close();
});

const storedPostings = async (householdId: string) =>
  (
    await db.owner.query<{ amount: string; currency: string }>(
      `SELECT amount::text AS amount, currency FROM ledger.postings WHERE household_id = $1`,
      [householdId],
    )
  ).rows;

describe("VAL-04@PoC AC1: amounts are stored in their original currency", () => {
  it("VAL-04@PoC AC1: a 1 000 000 UAH transaction on a UAH account is stored in UAH without conversion (reporting currency EUR)", async () => {
    expect(REPORTING_CURRENCY).toBe("EUR");
    const ledger = createLedger(db.databases.for("ledger"));
    const householdId = randomUUID();
    const account = await ledger.openAccount(
      householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "UAH" },
    );
    await ledger.post(householdId, {
      source: { module: "transactions", id: randomUUID() },
      idempotencyKey: randomUUID(),
      operationDate: "2026-11-12",
      event: { type: "transaction", account: account.id, amount: Money.of("1000000", "UAH") },
    });
    expect(await storedPostings(householdId)).toEqual([
      { amount: "1000000.000000000000000000", currency: "UAH" },
    ]);
    const balance = await ledger.balanceAt(householdId, account.id, "2026-11-12");
    expect([balance.toDecimalString(), balance.currency]).toEqual(["1000000", "UAH"]);

    // Showing it in EUR is a read: the result carries the rate, nothing stored changes.
    await db.owner.query(
      `INSERT INTO fx_rates.rates (rate_date, currency, rate, source, fetched_at) VALUES ('2026-11-12', 'EUR', '50', 'NBU', now())`,
    );
    const shown = await createFxReporting({
      db: db.databases.for("fx-rates"),
      now: () => Date.UTC(2026, 10, 12, 12),
    }).toReporting({ amount: balance, date: null });
    expect(shown.kind === "converted" && shown.value.toDecimalString()).toBe("20000");
    expect(await storedPostings(householdId)).toEqual([
      { amount: "1000000.000000000000000000", currency: "UAH" },
    ]);
  });
});
