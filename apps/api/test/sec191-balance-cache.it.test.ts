import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseLedgerStore } from "../src/modules/ledger/adapters/index.ts";
import type { LedgerStore } from "../src/modules/ledger/application/index.ts";
import { Money } from "@willowsum/domain-kernel";
import { createLedger, createLedgerIntegrityCheck, type Ledger } from "../src/modules/ledger/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #191 (ARC-11 daily balance cache): the commit-time trigger must refuse a posting that skips the
 * cache (an older code version during a rolling deploy, or a direct INSERT) also while another transaction is creating
 * the account's first cache (the first entry after deploy, or the rebuild command). Synthetic space and amounts.
 */

let db: RealModulesDatabase;
let ledger: Ledger;
let store: LedgerStore;

beforeAll(async () => {
  db = await setupRealModules(8);
  ledger = createLedger(db.databases.for("ledger"));
  store = databaseLedgerStore(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

async function bypassPosting(householdId: string, debit: string, credit: string): Promise<string> {
  const id = randomUUID();
  return db.databases
    .for("ledger")
    .inHousehold(householdId, async (q) => {
      await q.query(
        `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
         VALUES ($1, $2, 'transactions', $2, 'transfer', '2026-06-02', 1, $3)`,
        [householdId, id, `bypass-${id}`],
      );
      await q.query(`INSERT INTO postings VALUES ($1, $2, 1, $3, $4, 7, 'EUR')`, [
        householdId,
        id,
        debit,
        credit,
      ]);
    })
    .then(
      () => "ok",
      (e: { code?: string }) => e.code ?? String(e),
    );
}

describe("sec191: the commit-time trigger guards both sides of a posting", () => {
  it("a posting that skips the cache is refused when only its credit, or only its debit, account has a cache", async () => {
    const householdId = randomUUID();
    const open = () =>
      ledger.openAccount(
        householdId,
        { module: "accounts", id: randomUUID() },
        { type: "asset", currency: "EUR" },
      );
    const cash = await open();
    const savings = await open();
    expect(await ledger.rebuildBalances(householdId, savings.id)).toEqual({ accounts: 1, days: 0 });
    expect(await bypassPosting(householdId, cash.id, savings.id)).toBe("23514");
    expect(await bypassPosting(householdId, savings.id, cash.id)).toBe("23514");
  });
});

describe("sec191: the daily check compares the whole cache with the postings", () => {
  const damages: Record<string, (householdId: string, cash: string) => string> = {
    credits: () =>
      `UPDATE ledger.daily_balances SET credits = credits + 1 WHERE household_id = $1 AND account_id = $2 AND day = '2026-06-10'`,
    "a missing day": () =>
      `DELETE FROM ledger.daily_balances WHERE household_id = $1 AND account_id = $2 AND day = '2026-06-05'`,
    "the time of recording": () =>
      `UPDATE ledger.balance_versions SET last_recorded_at = last_recorded_at - interval '1 day' WHERE household_id = $1 AND account_id = $2`,
  };
  for (const [what, sql] of Object.entries(damages))
    it(`a cache that differs from the postings in ${what} is counted by balance-cache`, async () => {
      const householdId = randomUUID();
      const open = () =>
        ledger.openAccount(
          householdId,
          { module: "accounts", id: randomUUID() },
          { type: "asset", currency: "EUR" },
        );
      const cash = await open();
      const savings = await open();
      for (const [day, amount] of [
        ["2026-06-05", "2.5"],
        ["2026-06-10", "4"],
      ] as const)
        await ledger.post(householdId, {
          source: { module: "transactions", id: randomUUID() },
          idempotencyKey: randomUUID(),
          operationDate: day,
          event: { type: "transfer", from: cash.id, to: savings.id, amount: Money.of(amount, "EUR") },
        });
      const check = createLedgerIntegrityCheck(
        db.databases.for("ledger"),
        async () => [householdId],
        () => undefined,
        () => undefined,
      );
      expect((await check.run())["balance-cache"]).toBe(0);
      await db.owner.query(sql(householdId, cash.id), [householdId, cash.id]);
      expect((await check.run())["balance-cache"]).toBe(1);
    });
});

describe("sec191: no stale balance cache while an account's first cache is being created", () => {
  it("a posting that skips the cache and commits during the first-cache creation is refused (no silent divergence)", async () => {
    const householdId = randomUUID();
    const open = () =>
      ledger.openAccount(
        householdId,
        { module: "accounts", id: randomUUID() },
        { type: "asset", currency: "EUR" },
      );
    const cash = await open();
    const savings = await open();

    // Transaction 1 creates the first cache of `savings` (as the first entry after deploy or the rebuild do) and stays open.
    let built!: () => void;
    const isBuilt = new Promise<void>((r) => (built = r));
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    const builder = store.inHousehold(householdId, async (tx) => {
      await tx.rebuildBalance(savings.id);
      built();
      await released;
    });
    await isBuilt;

    // Transaction 2 writes an entry the way an older code version does: postings only, no cache.
    const id = randomUUID();
    const bypass = db.databases
      .for("ledger")
      .inHousehold(householdId, async (q) => {
        await q.query(
          `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
           VALUES ($1, $2, 'transactions', $2, 'transfer', '2026-06-02', 1, $3)`,
          [householdId, id, `bypass-${id}`],
        );
        await q.query(`INSERT INTO postings VALUES ($1, $2, 1, $3, $4, 7, 'EUR')`, [
          householdId,
          id,
          cash.id,
          savings.id,
        ]);
      })
      .then(
        () => "ok",
        (e: { code?: string }) => e.code ?? String(e),
      );
    // Give transaction 2 time to reach its commit (it either commits or waits for transaction 1).
    const early = await Promise.race([bypass, new Promise((r) => setTimeout(() => r("waiting"), 1500))]);
    release();
    await builder;
    const outcome = await bypass;

    // Either the bypass is refused, or it committed before the cache read the postings: never a cache without it.
    const check = createLedgerIntegrityCheck(
      db.databases.for("ledger"),
      async () => [householdId],
      () => undefined,
      () => undefined,
    );
    expect((await check.run())["balance-cache"]).toBe(0);
    expect({ early, outcome }).toEqual({ early: "waiting", outcome: "23514" });
  });
});
