import { randomUUID } from "node:crypto";
import { exchangeRate, Money, type ExchangeRate } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLedger,
  createLedgerErasure,
  type Ledger,
  type LedgerAccount,
  type PostInput,
} from "../src/modules/ledger/index.ts";
import { withTestErasureDatabases } from "./erasure-helpers.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * FIN-04@PoC EC1 and ARC-11 «Запис проводок» on a real PostgreSQL, through the ledger module's own role: an event in
 * another currency than its account is one entry of balanced pairs, one per currency, bridged by the space's
 * «Валютна різниця» of each currency (made on first use); the entry keeps the explicit dated rate; the database still
 * balances every currency by the pair model and refuses a cross-currency entry without its rate. Synthetic data only.
 */

let db: RealModulesDatabase;
let ledger: Ledger;

beforeAll(async () => {
  db = await setupRealModules(4);
  ledger = createLedger(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const eur = (amount: string) => Money.of(amount, "EUR");
const usd = (amount: string) => Money.of(amount, "USD");
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );
const rate = (value: string, date = "2026-06-15", base = "EUR", quote = "USD"): ExchangeRate =>
  exchangeRate({ base, quote, rate: value, date, source: "synthetic" });

async function space(): Promise<{ householdId: string; eurCash: LedgerAccount; usdCash: LedgerAccount }> {
  const householdId = randomUUID();
  const open = (currency: string) =>
    ledger.openAccount(householdId, { module: "accounts", id: randomUUID() }, { type: "asset", currency });
  return { householdId, eurCash: await open("EUR"), usdCash: await open("USD") };
}

const input = (event: PostInput["event"], operationDate = "2026-06-15", key = randomUUID()): PostInput => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate,
  event,
});

const balance = async (householdId: string, accountId: string, date = "2026-12-31") =>
  (await ledger.balanceAt(householdId, accountId, date)).toDecimalString();

/** The superuser's view of the space's «Валютна різниця» accounts (bypasses the policy). */
async function fxAccounts(householdId: string) {
  const { rows } = await db.owner.query<{ id: string; currency: string; type: string }>(
    `SELECT id, currency, type FROM ledger.accounts WHERE household_id = $1 AND service_kind = 'fx-difference'
      ORDER BY currency`,
    [householdId],
  );
  return rows;
}

async function storedConversions(entryId: string) {
  const { rows } = await db.owner.query(
    `SELECT currency, amount::text, entry_currency, entry_amount::text, rate::text, rate_date::text, rate_source,
            converted::text, difference::text
       FROM ledger.conversions WHERE entry_id = $1 ORDER BY seq`,
    [entryId],
  );
  return rows;
}

describe("FIN-04@PoC EC1: an event in another currency than the account is recorded through «Валютна різниця»", () => {
  it("FIN-04@PoC EC1: a spending of 100 USD from a EUR account settled as 93.10 EUR — actual amounts kept, one pair per currency", async () => {
    const s = await space();
    const entry = await ledger.post(
      s.householdId,
      input({
        type: "fx-transaction",
        account: s.eurCash.id,
        amount: usd("-100"),
        settled: eur("-93.10"),
        rate: rate("1.08"),
      }),
    );
    const fx = await fxAccounts(s.householdId);
    expect(fx.map((a) => [a.currency, a.type])).toEqual([
      ["EUR", "equity"],
      ["USD", "equity"],
    ]);
    const [fxEur, fxUsd] = fx;
    expect(
      entry.postings.map((p) => [
        p.debitAccountId,
        p.creditAccountId,
        p.amount.toDecimalString(),
        p.amount.currency,
      ]),
    ).toEqual([
      [fxEur!.id, s.eurCash.id, "93.1", "EUR"],
      [expect.any(String), fxUsd!.id, "100", "USD"],
    ]);
    // The account holds its actual amount in its own currency.
    expect(await balance(s.householdId, s.eurCash.id)).toBe("-93.1");
    // «Валютна різниця» holds each currency's side; the two together are the conversion difference at the rate.
    expect(await balance(s.householdId, fxEur!.id)).toBe("-93.1");
    expect(await balance(s.householdId, fxUsd!.id)).toBe("100");
  });

  it("FIN-04@PoC EC1: the entry keeps the rate (exact decimal), its date and source, the converted amount and the difference", async () => {
    const s = await space();
    const entry = await ledger.post(
      s.householdId,
      input(
        {
          type: "fx-transfer",
          from: s.usdCash.id,
          to: s.eurCash.id,
          sent: usd("500"),
          received: eur("461.25"),
          rate: rate("1.083456789012345678", "2026-06-12"),
        },
        "2026-06-15",
      ),
    );
    const expected = {
      currency: "EUR",
      amount: "461.250000000000000000",
      entry_currency: "USD",
      entry_amount: "500.000000000000000000",
      rate: "1.083456789012345678",
      rate_date: "2026-06-12",
      rate_source: "synthetic",
      // 461.25 × 1.083456789012345678 = 499.7444439319444439775; kept at 18 decimals (half to even).
      converted: "499.744443931944443978",
      difference: "-0.255556068055556022",
    };
    expect(await storedConversions(entry.id)).toEqual([expected]);
    const [c] = entry.conversions;
    expect([
      c!.amount.toDecimalString(),
      c!.entryAmount.toDecimalString(),
      c!.converted.toDecimalString(),
    ]).toEqual(["461.25", "500", "499.744443931944443978"]);
    expect([c!.rate.base, c!.rate.quote, c!.rate.rate.toString(), c!.rate.date, c!.rate.source]).toEqual([
      "EUR",
      "USD",
      "1.083456789012345678",
      "2026-06-12",
      "synthetic",
    ]);
    expect(await balance(s.householdId, s.usdCash.id)).toBe("-500");
    expect(await balance(s.householdId, s.eurCash.id)).toBe("461.25");
  });

  it("FIN-04@PoC EC1: «Валютна різниця» is made once per space and currency, on first use, and reused", async () => {
    const s = await space();
    const other = await space();
    const fxTx = (householdId: string, account: string) =>
      ledger.post(
        householdId,
        input({ type: "fx-transaction", account, amount: usd("10"), settled: eur("9"), rate: rate("1.1") }),
      );
    expect(await fxAccounts(s.householdId)).toEqual([]);
    await fxTx(s.householdId, s.eurCash.id);
    const first = await fxAccounts(s.householdId);
    await fxTx(s.householdId, s.eurCash.id);
    expect(await fxAccounts(s.householdId)).toEqual(first);
    expect(first).toHaveLength(2);
    await fxTx(other.householdId, other.eurCash.id);
    const theirs = await fxAccounts(other.householdId);
    expect(theirs.map((a) => a.id).some((id) => first.some((f) => f.id === id))).toBe(false);
    expect(await balance(s.householdId, first[0]!.id)).toBe("18");
  });

  it("FIN-04@PoC EC1: a reversal keeps the same rate and brings every currency's balances back", async () => {
    const s = await space();
    const entry = await ledger.post(
      s.householdId,
      input({
        type: "fx-transfer",
        from: s.usdCash.id,
        to: s.eurCash.id,
        sent: usd("50"),
        received: eur("46"),
        rate: rate("1.08"),
      }),
    );
    const reversal = await ledger.reverse(s.householdId, entry.id, randomUUID());
    expect(await storedConversions(reversal.id)).toEqual(await storedConversions(entry.id));
    for (const a of [s.usdCash, s.eurCash, ...(await fxAccounts(s.householdId))])
      expect(await balance(s.householdId, a.id)).toBe("0");
    // A change of the event: reversal and the new entry with a new rate, in one transaction.
    const fixed = await ledger.post(
      s.householdId,
      input({
        type: "fx-transfer",
        from: s.usdCash.id,
        to: s.eurCash.id,
        sent: usd("50"),
        received: eur("46"),
        rate: rate("1.08"),
      }),
    );
    const changed = await ledger.correct(
      s.householdId,
      fixed.id,
      input({
        type: "fx-transfer",
        from: s.usdCash.id,
        to: s.eurCash.id,
        sent: usd("50"),
        received: eur("45.50"),
        rate: rate("1.1"),
      }),
    );
    expect(changed.entry.conversions[0]!.rate.rate.toString()).toBe("1.1");
    expect(await balance(s.householdId, s.eurCash.id)).toBe("45.5");
  });

  it("FIN-04@PoC EC1: an invalid rate writes nothing — the event, its pairs and its service accounts are refused together", async () => {
    const s = await space();
    const key = randomUUID();
    expect(
      await code(
        ledger.post(
          s.householdId,
          input(
            {
              type: "fx-transaction",
              account: s.eurCash.id,
              amount: usd("-1"),
              settled: eur("-1"),
              rate: rate("1.08", "2026-06-16"),
            },
            "2026-06-15",
            key,
          ),
        ),
      ),
    ).toBe("INVALID_RATE");
    // The account must be in the settled currency: a EUR amount on a USD account is still unbalanced.
    expect(
      await code(
        ledger.post(
          s.householdId,
          input({
            type: "fx-transaction",
            account: s.usdCash.id,
            amount: usd("-1"),
            settled: eur("-1"),
            rate: rate("1.08"),
          }),
        ),
      ),
    ).toBe("UNBALANCED");
    const { rows } = await db.owner.query(
      `SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`,
      [s.householdId],
    );
    expect(rows[0]!.n).toBe(0);
    expect(await fxAccounts(s.householdId)).toEqual([]);
  });
});

describe("ARC-11@PoC criterion «Перебудова кешу залишків з проводок»: the daily balance cache stays right per currency", () => {
  it("ARC-11@PoC criterion «Перебудова кешу залишків з проводок»: cross-currency entries move each account's cache in its currency; a rebuild gives the same numbers", async () => {
    const s = await space();
    for (const [date, sent, received] of [
      ["2026-06-10", "11", "10"],
      ["2026-06-20", "21", "20.5"],
      ["2026-06-05", "4", "3.25"],
    ] as const)
      await ledger.post(
        s.householdId,
        input(
          {
            type: "fx-transfer",
            from: s.usdCash.id,
            to: s.eurCash.id,
            sent: usd(sent),
            received: eur(received),
            rate: rate("1.08", "2026-06-01"),
          },
          date,
        ),
      );
    const accounts = [s.usdCash, s.eurCash, ...(await fxAccounts(s.householdId))];
    const before = await Promise.all(accounts.map((a) => balance(s.householdId, a.id, "2026-06-15")));
    // The USD account, the EUR account, «Валютна різниця» in EUR and in USD (equity: credits minus debits).
    expect(before).toEqual(["-15", "13.25", "13.25", "-15"]);
    const cached = await db.owner.query<{ currency: string; account_currency: string }>(
      `SELECT DISTINCT b.currency, a.currency AS account_currency FROM ledger.daily_balances b
         JOIN ledger.accounts a ON a.household_id = b.household_id AND a.id = b.account_id
        WHERE b.household_id = $1`,
      [s.householdId],
    );
    expect(cached.rows.length).toBeGreaterThan(1);
    for (const row of cached.rows) expect(row.currency).toBe(row.account_currency);
    await ledger.rebuildBalances(s.householdId);
    expect(await Promise.all(accounts.map((a) => balance(s.householdId, a.id, "2026-06-15")))).toEqual(
      before,
    );
  });
});

describe("ARC-11@PoC criterion «Незбалансований запис у журналі»: the database keeps every currency balanced and the rate on the entry", () => {
  /** Raw rows as the module role in one transaction; the cache is dropped first so only the journal rules apply. */
  const raw = (
    householdId: string,
    work: (q: { query(sql: string, v?: unknown[]): Promise<unknown> }) => Promise<void>,
  ) =>
    code(
      db.databases.for("ledger").inHousehold(householdId, async (q) => {
        await q.query(`DELETE FROM daily_balances`);
        await q.query(`DELETE FROM balance_versions`);
        await work(q);
      }),
    );
  const ENTRY = `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
                 VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'fx-transfer', '2026-06-15', 1, $2::uuid::text)`;
  const POSTING = `INSERT INTO postings VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  const CONVERSION = `INSERT INTO conversions (household_id, entry_id, seq, currency, amount, entry_currency, entry_amount,
                        rate, rate_date, rate_source, converted)
                      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, '2026-06-15', 'synthetic', $8)`;

  let s: Awaited<ReturnType<typeof space>>;
  let fxEur: string;
  let fxUsd: string;
  beforeAll(async () => {
    s = await space();
    await ledger.post(
      s.householdId,
      input({
        type: "fx-transaction",
        account: s.eurCash.id,
        amount: usd("1"),
        settled: eur("1"),
        rate: rate("1"),
      }),
    );
    [fxEur, fxUsd] = (await fxAccounts(s.householdId)).map((a) => a.id) as [string, string];
  });

  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: a posting across two currencies is still refused by its keys (the pair model)", async () => {
    const id = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await q.query(ENTRY, [s.householdId, id]);
        await q.query(POSTING, [s.householdId, id, 1, s.eurCash.id, s.usdCash.id, "1", "EUR"]);
      }),
    ).toBe("23503");
  });

  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: pairs in two currencies without the entry's rate are refused at commit", async () => {
    const id = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await q.query(ENTRY, [s.householdId, id]);
        await q.query(POSTING, [s.householdId, id, 1, fxUsd, s.usdCash.id, "10", "USD"]);
        await q.query(POSTING, [s.householdId, id, 2, s.eurCash.id, fxEur, "9", "EUR"]);
      }),
    ).toBe("23514");
  });

  it("ARC-11@PoC criterion «Незбалансований запис у журналі»: a rate whose currencies are not the entry's, or a converted amount that is not amount × rate, is refused", async () => {
    const pairs = async (q: { query(sql: string, v?: unknown[]): Promise<unknown> }, id: string) => {
      await q.query(ENTRY, [s.householdId, id]);
      await q.query(POSTING, [s.householdId, id, 1, fxUsd, s.usdCash.id, "10", "USD"]);
      await q.query(POSTING, [s.householdId, id, 2, s.eurCash.id, fxEur, "9", "EUR"]);
    };
    const ok = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await pairs(q, ok);
        await q.query(CONVERSION, [s.householdId, ok, "EUR", "9", "USD", "10", "1.1", "9.9"]);
      }),
    ).toBe("ok");
    const wrongCurrency = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await pairs(q, wrongCurrency);
        await q.query(CONVERSION, [s.householdId, wrongCurrency, "GBP", "9", "USD", "10", "1.1", "9.9"]);
      }),
    ).toBe("23514");
    const wrongProduct = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await pairs(q, wrongProduct);
        await q.query(CONVERSION, [s.householdId, wrongProduct, "EUR", "9", "USD", "10", "1.1", "9.91"]);
      }),
    ).toBe("23514");
    const float = randomUUID();
    expect(
      await raw(s.householdId, async (q) => {
        await pairs(q, float);
        await q.query(CONVERSION, [s.householdId, float, "EUR", "9", "USD", "10", "0", "0"]);
      }),
    ).toBe("23514");
  });

  it("ARC-11@PoC criterion «UPDATE або DELETE журналу роллю застосунку»: a rate joins only its new entry and is never changed or deleted", async () => {
    const [old] = (
      await db.owner.query<{ id: string }>(
        `SELECT entry_id AS id FROM ledger.conversions WHERE household_id = $1 LIMIT 1`,
        [s.householdId],
      )
    ).rows;
    expect(
      await raw(s.householdId, async (q) => {
        await q.query(CONVERSION.replace("1, $3", "2, $3"), [
          s.householdId,
          old!.id,
          "EUR",
          "1",
          "USD",
          "1",
          "1",
          "1",
        ]);
      }),
    ).toBe("23514");
    const asModule = (sql: string) =>
      code(db.databases.for("ledger").inHousehold(s.householdId, (q) => q.query(sql)));
    expect(await asModule(`UPDATE conversions SET rate = rate WHERE false`)).toBe("42501");
    expect(await asModule(`DELETE FROM conversions WHERE false`)).toBe("42501");
    expect(await asModule(`TRUNCATE conversions`)).toBe("42501");
    expect(await code(db.owner.query(`UPDATE ledger.conversions SET rate = rate`))).toBe("42501");
    expect(await code(db.owner.query(`DELETE FROM ledger.conversions`))).toBe("42501");
  });

  it("ARC-03@PoC criterion «Запит, що повертає дані іншого простору»: another space's rates are not seen and cannot be written", async () => {
    const other = await space();
    const seen = await db.databases
      .for("ledger")
      .inHousehold(other.householdId, (q) =>
        q.query<{ n: number }>(`SELECT count(*)::int AS n FROM conversions WHERE household_id = $1`, [
          s.householdId,
        ]),
      );
    expect(seen.rows[0]!.n).toBe(0);
    const [mine] = (
      await db.owner.query<{ id: string }>(
        `SELECT entry_id AS id FROM ledger.conversions WHERE household_id = $1 LIMIT 1`,
        [s.householdId],
      )
    ).rows;
    expect(
      await code(
        db.databases
          .for("ledger")
          .inHousehold(other.householdId, (q) =>
            q.query(CONVERSION.replace("1, $3", "3, $3"), [
              s.householdId,
              mine!.id,
              "EUR",
              "1",
              "USD",
              "1",
              "1",
              "1",
            ]),
          ),
      ),
    ).toBe("42501");
  });
});

describe("NFR-12@PoC FR 3: erasing a space takes the rates of its cross-currency entries with its journal", () => {
  it("NFR-12@PoC FR 3: the erasure role deletes the space's rates; another space's stay", async () => {
    const mine = await space();
    const other = await space();
    for (const s of [mine, other])
      await ledger.post(
        s.householdId,
        input({
          type: "fx-transaction",
          account: s.eurCash.id,
          amount: usd("-5"),
          settled: eur("-4.6"),
          rate: rate("1.08"),
        }),
      );
    const result = await withTestErasureDatabases(db, (era) =>
      createLedgerErasure(era.for("ledger")).eraseHousehold(mine.householdId),
    );
    expect(result).toMatchObject({ conversions: 1, entries: 1 });
    const left = async (householdId: string) =>
      (
        await db.owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ledger.conversions WHERE household_id = $1`,
          [householdId],
        )
      ).rows[0]!.n;
    expect([await left(mine.householdId), await left(other.householdId)]).toEqual([0, 1]);
  });
});
