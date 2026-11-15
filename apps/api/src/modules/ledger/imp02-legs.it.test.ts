import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { createLedger, type Ledger, type PostInput } from "./index.ts";

/**
 * IMP-02@PoC FR 5, FR 6, AC10, AC11 on a real PostgreSQL, through the ledger module's own role: an event with a main leg
 * and a separate fee leg, kept as legs of the entry and offset by its reversal; an amount of 18 decimals stored and read
 * back exactly. Spaces and ids are random; amounts are synthetic.
 */

let db: RealModulesDatabase;
let ledger: Ledger;

beforeAll(async () => {
  db = await setupRealModules(6);
  ledger = createLedger(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const open = (householdId: string, currency: string) =>
  ledger.openAccount(householdId, { module: "accounts", id: randomUUID() }, { type: "asset", currency });

const input = (event: PostInput["event"], key: string = randomUUID()): PostInput => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate: "2026-06-15",
  event,
});

describe("IMP-02@PoC FR 5: an operation (event) has legs and a separate fee leg", () => {
  it("IMP-02@PoC AC11: a card payment of 40,00 EUR with a bank fee of 1,50 EUR — the entry has the main leg and a separate fee leg; the balance loses both", async () => {
    const householdId = randomUUID();
    const wallet = await open(householdId, "EUR");
    const entry = await ledger.post(
      householdId,
      input({
        type: "legs",
        legs: [{ account: wallet.id, amount: Money.of("-40.00", "EUR") }],
        fee: { account: wallet.id, amount: Money.of("1.50", "EUR") },
      }),
    );
    expect(entry.eventType).toBe("legs");
    expect(entry.legs).toEqual([
      { kind: "main", accountId: wallet.id, amount: Money.of("-40", "EUR") },
      { kind: "fee", accountId: wallet.id, amount: Money.of("1.5", "EUR") },
    ]);
    expect(entry.postings.map((p) => p.leg)).toEqual(["main", "fee"]);
    const { rows } = await db.owner.query(
      `SELECT leg, amount::text AS amount FROM ledger.postings WHERE entry_id = $1 ORDER BY seq`,
      [entry.id],
    );
    expect(rows).toEqual([
      { leg: "main", amount: "40.000000000000000000" },
      { leg: "fee", amount: "1.500000000000000000" },
    ]);
    expect(await ledger.balanceAt(householdId, wallet.id, "2026-06-30")).toEqual(Money.of("-41.5", "EUR"));

    // Deleting the operation reverses both legs, each in its leg.
    const reversal = await ledger.reverse(householdId, entry.id, `test.reverse:${entry.id}`);
    expect(reversal.legs).toEqual([
      { kind: "main", accountId: wallet.id, amount: Money.of("40", "EUR") },
      { kind: "fee", accountId: wallet.id, amount: Money.of("-1.5", "EUR") },
    ]);
    expect((await ledger.balanceAt(householdId, wallet.id, "2026-06-30")).isZero()).toBe(true);
  });

  it("IMP-02@PoC FR 5: an operation without a fee has its legs only; an entry of another event has no legs", async () => {
    const householdId = randomUUID();
    const a = await open(householdId, "EUR");
    const b = await open(householdId, "EUR");
    const entry = await ledger.post(
      householdId,
      input({
        type: "legs",
        legs: [
          { account: a.id, amount: Money.of("12.30", "EUR") },
          { account: b.id, amount: Money.of("-2.30", "EUR") },
        ],
      }),
    );
    expect(entry.legs.map((l) => [l.kind, l.accountId, l.amount.toDecimalString()])).toEqual([
      ["main", a.id, "12.3"],
      ["main", b.id, "-2.3"],
    ]);
    const plain = await ledger.post(
      householdId,
      input({ type: "transaction", account: a.id, amount: Money.of("-1", "EUR") }),
    );
    expect(plain.legs).toEqual([]);
    expect(plain.postings[0]).not.toHaveProperty("leg");
  });

  it("the database refuses a leg that is not a code", async () => {
    await expect(
      db.owner.query(
        `INSERT INTO ledger.postings (household_id, entry_id, seq, debit_account_id, credit_account_id,
        amount, currency, leg) VALUES ($1, $1, 1, $1, $2, 1, 'EUR', 'Комісія банку')`,
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("IMP-02@PoC FR 6: amounts are exact decimals with 18 places", () => {
  it("IMP-02@PoC AC10: an operation of 0,000000000000000001 ETH is stored with all 18 decimals and read back exactly", async () => {
    const householdId = randomUUID();
    const wallet = await open(householdId, "ETH");
    const tiny = Money.of("0.000000000000000001", "ETH");
    const entry = await ledger.post(
      householdId,
      input({ type: "legs", legs: [{ account: wallet.id, amount: tiny }] }),
    );
    expect(entry.legs[0]!.amount.toDecimalString()).toBe("0.000000000000000001");
    const { rows } = await db.owner.query(
      `SELECT amount::text AS amount, currency FROM ledger.postings WHERE entry_id = $1`,
      [entry.id],
    );
    expect(rows).toEqual([{ amount: "0.000000000000000001", currency: "ETH" }]);
    // A second one: the balance is the exact sum, 2 × 10⁻¹⁸.
    await ledger.post(householdId, input({ type: "legs", legs: [{ account: wallet.id, amount: tiny }] }));
    expect((await ledger.balanceAt(householdId, wallet.id, "2026-06-30")).toDecimalString()).toBe(
      "0.000000000000000002",
    );
  });
});
