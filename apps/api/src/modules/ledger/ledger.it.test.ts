import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { syntheticMailSender, type MailSender } from "../../platform/adapters/mail/index.ts";
import { exportedText, testTelemetryForFile } from "../../platform/telemetry/testing.ts";
import { setupRealModules, type RealModulesDatabase } from "../../../test/real-modules.ts";
import { databaseLedgerStore } from "./adapters/index.ts";
import { post as postWith, type LedgerStore } from "./application/index.ts";
import {
  createLedger,
  createLedgerIntegrityCheck,
  type Ledger,
  type LedgerAccount,
  type PostInput,
} from "./index.ts";

/**
 * FIN-04@PoC (wave 1: AC1–AC4, core of AC6) and ARC-11 on a real PostgreSQL, through the ledger module's own role:
 * balanced atomic posting sets, rollback, reversal instead of change, balance on a date, the database constraints
 * and the daily integrity check. Spaces and ids are random; amounts are synthetic.
 */

const telemetry = testTelemetryForFile();
let db: RealModulesDatabase;
let ledger: Ledger;

beforeAll(async () => {
  db = await setupRealModules(6);
  ledger = createLedger(db.databases.for("ledger"));
});

afterAll(async () => {
  await db?.close();
});

const eur = (amount: string) => Money.of(amount, "EUR");
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

async function space(): Promise<{ householdId: string; cash: LedgerAccount; savings: LedgerAccount }> {
  const householdId = randomUUID();
  const open = (currency = "EUR") =>
    ledger.openAccount(householdId, { module: "accounts", id: randomUUID() }, { type: "asset", currency });
  return { householdId, cash: await open(), savings: await open() };
}

const input = (
  event: PostInput["event"],
  operationDate = "2026-06-15",
  key: string = randomUUID(),
): PostInput => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate,
  event,
});

/** The superuser's view of an entry's rows (bypasses the policy): for checking what is stored. */
async function stored(entryId: string) {
  const entry = await db.owner.query(`SELECT * FROM ledger.entries WHERE id = $1`, [entryId]);
  const postings = await db.owner.query(
    `SELECT debit_account_id, credit_account_id, amount::text AS amount, currency FROM ledger.postings
      WHERE entry_id = $1 ORDER BY seq`,
    [entryId],
  );
  return { entry: entry.rows, postings: postings.rows };
}

/** SQL as the ledger module's role, bound to a space; resolves to the SQLSTATE or "ok". */
const asModule = (householdId: string, sql: string, values: unknown[] = []) =>
  code(db.databases.for("ledger").inHousehold(householdId, (q) => q.query(sql, values)));

describe("FIN-04 AC1: an event becomes a posting set whose debits equal its credits per currency", () => {
  it("FIN-04 FR 7: a spending — one posting from the account to the service account «Зовнішні кошти», in one transaction", async () => {
    const s = await space();
    const entry = await ledger.post(
      s.householdId,
      input({ type: "transaction", account: s.cash.id, amount: eur("-42.17") }),
    );
    expect(entry).toMatchObject({
      eventType: "transaction",
      operationDate: "2026-06-15",
      rulesVersion: 1,
      reversesEntryId: null,
    });
    const rows = await stored(entry.id);
    expect(rows.entry).toHaveLength(1);
    expect(rows.postings).toEqual([
      {
        debit_account_id: expect.any(String),
        credit_account_id: s.cash.id,
        amount: "42.170000000000000000",
        currency: "EUR",
      },
    ]);
    // The other side is the space's service account «Зовнішні кошти» in EUR, made on first use.
    const external = await db.owner.query(
      `SELECT type, currency, service_kind FROM ledger.accounts WHERE id = $1`,
      [rows.postings[0].debit_account_id],
    );
    expect(external.rows).toEqual([{ type: "equity", currency: "EUR", service_kind: "external-funds" }]);
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-06-30")).toDecimalString()).toBe("-42.17");
  });

  it("FIN-04 FR 4: a mortgage payment — two postings, both debits and the credit in one entry", async () => {
    const s = await space();
    const liability = await ledger.openAccount(
      s.householdId,
      { module: "liabilities", id: randomUUID() },
      { type: "liability", currency: "EUR" },
    );
    const interest = await ledger.openAccount(
      s.householdId,
      { module: "liabilities", id: randomUUID() },
      { type: "expense", currency: "EUR" },
    );
    const entry = await ledger.post(
      s.householdId,
      input({
        type: "mortgage-payment",
        liability: liability.id,
        interestExpense: interest.id,
        account: s.cash.id,
        principal: eur("800"),
        interest: eur("200"),
      }),
    );
    expect(
      entry.postings.map((p) => [p.debitAccountId, p.creditAccountId, p.amount.toDecimalString()]),
    ).toEqual([
      [liability.id, s.cash.id, "800"],
      [interest.id, s.cash.id, "200"],
    ]);
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-12-31")).toDecimalString()).toBe("-1000");
    expect((await ledger.balanceAt(s.householdId, liability.id, "2026-12-31")).toDecimalString()).toBe(
      "-800",
    );
  });

  it("ARC-11: a repeated event (same idempotency key) returns the entry it made; concurrent repeats make one", async () => {
    const s = await space();
    const event = input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("100") });
    const results = await Promise.all(Array.from({ length: 5 }, () => ledger.post(s.householdId, event)));
    expect(new Set(results.map((e) => e.id)).size).toBe(1);
    const again = await ledger.post(s.householdId, event);
    expect(again.id).toBe(results[0]!.id);
    const n = await db.owner.query(`SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`, [
      s.householdId,
    ]);
    expect(n.rows[0].n).toBe(1);
    expect((await ledger.balanceAt(s.householdId, s.savings.id, "2026-12-31")).toDecimalString()).toBe("100");
  });

  it("an account in another currency than the amount is refused; nothing is written", async () => {
    const s = await space();
    const usd = await ledger.openAccount(
      s.householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "USD" },
    );
    expect(
      await code(
        ledger.post(
          s.householdId,
          input({ type: "transfer", from: s.cash.id, to: usd.id, amount: eur("5") }),
        ),
      ),
    ).toBe("UNBALANCED");
    const n = await db.owner.query(`SELECT count(*)::int AS n FROM ledger.entries WHERE household_id = $1`, [
      s.householdId,
    ]);
    expect(n.rows[0].n).toBe(0);
  });

  it("ARC-11: an event type without a rule is refused", async () => {
    const s = await space();
    const event = { type: "gift", account: s.cash.id, amount: eur("1") } as unknown as PostInput["event"];
    expect(await code(ledger.post(s.householdId, input(event)))).toBe("UNKNOWN_EVENT_TYPE");
  });
});

describe("FIN-04 AC2, FR 1: a posting set that fails half-way leaves nothing (one ACID transaction)", () => {
  it("the entry is written, its postings fail (a key the database refuses): no entry, no posting, no account", async () => {
    const s = await space();
    const real = databaseLedgerStore(db.databases.for("ledger"));
    // After the entry row is in, the postings name an account of another currency: the database refuses them.
    const failing: LedgerStore = {
      inHousehold: (householdId, work) =>
        real.inHousehold(householdId, (tx) =>
          work({
            ...tx,
            insertPostings: (entryId, postings) =>
              tx.insertPostings(entryId, [...postings, { ...postings[0]!, amount: Money.of("1", "USD") }]),
          }),
        ),
    };
    const event = input({ type: "transaction", account: s.cash.id, amount: eur("3150") });
    expect(await code(postWith({ store: failing, newId: randomUUID }, s.householdId, event))).toBe("23503");
    const counts = await db.owner.query(
      `SELECT (SELECT count(*) FROM ledger.entries WHERE household_id = $1)::int AS entries,
              (SELECT count(*) FROM ledger.postings WHERE household_id = $1)::int AS postings,
              (SELECT count(*) FROM ledger.accounts WHERE household_id = $1 AND service_kind IS NOT NULL)::int AS service`,
      [s.householdId],
    );
    expect(counts.rows[0]).toEqual({ entries: 0, postings: 0, service: 0 });
    // The same event then posts normally: the failed attempt left no idempotency key behind.
    const entry = await ledger.post(s.householdId, event);
    expect((await stored(entry.id)).postings).toHaveLength(1);
  });

  it("a failure after the postings (before commit) rolls them back too", async () => {
    const s = await space();
    const real = databaseLedgerStore(db.databases.for("ledger"));
    const failing: LedgerStore = {
      inHousehold: (householdId, work) =>
        real.inHousehold(householdId, async (tx) => {
          await work(tx);
          throw new Error("crash before commit");
        }),
    };
    const event = input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("10") });
    await expect(postWith({ store: failing, newId: randomUUID }, s.householdId, event)).rejects.toThrow(
      "crash before commit",
    );
    const n = await db.owner.query(`SELECT count(*)::int AS n FROM ledger.postings WHERE household_id = $1`, [
      s.householdId,
    ]);
    expect(n.rows[0].n).toBe(0);
  });
});

describe("FIN-04 AC3: a change or a deletion reverses the old postings; nothing is changed in place", () => {
  it("a changed amount: the old entry stays, a reversal offsets it, the new entry is separate", async () => {
    const s = await space();
    const first = await ledger.post(
      s.householdId,
      input({ type: "transaction", account: s.cash.id, amount: eur("-50") }, "2026-05-10"),
    );
    const before = await stored(first.id);
    const { reversal, entry } = await ledger.correct(
      s.householdId,
      first.id,
      input({ type: "transaction", account: s.cash.id, amount: eur("-70") }, "2026-05-10"),
    );
    expect(await stored(first.id)).toEqual(before);
    expect(reversal).toMatchObject({
      eventType: "reversal",
      reversesEntryId: first.id,
      operationDate: "2026-05-10",
      source: first.source,
    });
    expect(
      reversal.postings.map((p) => [p.debitAccountId, p.creditAccountId, p.amount.toDecimalString()]),
    ).toEqual(first.postings.map((p) => [p.creditAccountId, p.debitAccountId, p.amount.toDecimalString()]));
    expect(entry.id).not.toBe(first.id);
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-05-31")).toDecimalString()).toBe("-70");
  });

  it("a deletion: the reversal returns the balance; an entry is reversed once; a reversal is not reversed", async () => {
    const s = await space();
    const first = await ledger.post(
      s.householdId,
      input({ type: "balance-adjustment", account: s.cash.id, amount: eur("-50") }),
    );
    const reversal = await ledger.reverse(s.householdId, first.id, "delete-1");
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-12-31")).toDecimalString()).toBe("0");
    expect((await ledger.reverse(s.householdId, first.id, "delete-1")).id).toBe(reversal.id);
    expect(await code(ledger.reverse(s.householdId, first.id, "delete-2"))).toBe("ALREADY_REVERSED");
    expect(await code(ledger.reverse(s.householdId, reversal.id, "delete-3"))).toBe("REVERSAL_OF_REVERSAL");
    expect(await code(ledger.reverse(s.householdId, randomUUID(), "delete-4"))).toBe("ENTRY_NOT_FOUND");
  });

  it("a change whose replacement key has 192–200 characters is accepted, and its repeat returns the same pair", async () => {
    const s = await space();
    for (const length of [192, 200]) {
      const first = await ledger.post(
        s.householdId,
        input({ type: "transaction", account: s.cash.id, amount: eur("-50") }),
      );
      const replacement = input(
        { type: "transaction", account: s.cash.id, amount: eur("-70") },
        "2026-06-15",
        "k".repeat(length - String(length).length) + String(length),
      );
      const a = await ledger.correct(s.householdId, first.id, replacement);
      const b = await ledger.correct(s.householdId, first.id, replacement);
      expect([b.reversal.id, b.entry.id]).toEqual([a.reversal.id, a.entry.id]);
    }
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-12-31")).toDecimalString()).toBe("-140");
  });

  it("concurrent deletions of one entry make one reversal", async () => {
    const s = await space();
    const first = await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("5") }),
    );
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, i) => code(ledger.reverse(s.householdId, first.id, `concurrent-${i}`))),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o !== "ok").every((o) => o === "ALREADY_REVERSED")).toBe(true);
  });
});

describe("FIN-04 AC4: the balance on 2026-06-30 is the sum of postings up to that date inclusive", () => {
  it("entries before, on and after the date, with a reversal; and «as known at» a moment (ARC-11)", async () => {
    const s = await space();
    const add = (amount: string, date: string) =>
      ledger.post(
        s.householdId,
        input({ type: "transaction", account: s.cash.id, amount: eur(amount) }, date),
      );
    await add("3000", "2026-01-15");
    const early = await add("150.25", "2026-06-30");
    const known = early.recordedAt;
    const reversed = await add("-999.99", "2026-03-01");
    await ledger.reverse(s.householdId, reversed.id, randomUUID());
    await add("-0.25", "2026-06-30");
    await add("-500", "2026-07-01");
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-06-30")).toDecimalString()).toBe("3150");
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-06-29")).toDecimalString()).toBe("3000");
    expect((await ledger.balanceAt(s.householdId, s.cash.id, "2026-07-01")).toDecimalString()).toBe("2650");
    // As the system knew it right after the 150.25: the reversal and the later entries were not recorded yet.
    expect(
      (
        await ledger.balanceAt(s.householdId, s.cash.id, "2026-06-30", { asKnownAt: known })
      ).toDecimalString(),
    ).toBe("3150.25");
    expect(await code(ledger.balanceAt(s.householdId, randomUUID(), "2026-06-30"))).toBe("UNKNOWN_ACCOUNT");
  });

  it("reversals of entries dated before, on and after 2026-06-30 count on the original's date", async () => {
    const s = await space();
    const add = (amount: string, date: string) =>
      ledger.post(
        s.householdId,
        input({ type: "transaction", account: s.cash.id, amount: eur(amount) }, date),
      );
    await add("1000", "2026-01-15");
    const before = await add("-200", "2026-06-29");
    const on = await add("-30.5", "2026-06-30");
    const after = await add("-400", "2026-07-01");
    const balance = async (date: string, asKnownAt?: string) =>
      (
        await ledger.balanceAt(s.householdId, s.cash.id, date, asKnownAt === undefined ? {} : { asKnownAt })
      ).toDecimalString();
    expect([await balance("2026-06-29"), await balance("2026-06-30"), await balance("2026-07-01")]).toEqual([
      "800",
      "769.5",
      "369.5",
    ]);
    const known = after.recordedAt;

    const reversals = [];
    for (const original of [before, on, after])
      reversals.push(await ledger.reverse(s.householdId, original.id, randomUUID()));
    expect(reversals.map((r) => r.operationDate)).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
    // Each reversal is dated as its original: up to the cut-off, the later one has no effect at all.
    expect([await balance("2026-06-28"), await balance("2026-06-29"), await balance("2026-06-30")]).toEqual([
      "1000",
      "1000",
      "1000",
    ]);
    expect(await balance("2026-07-01")).toBe("1000");
    // As known before the reversals were recorded, the old balances are reproduced.
    expect([await balance("2026-06-30", known), await balance("2026-07-01", known)]).toEqual([
      "769.5",
      "369.5",
    ]);
  });
});

describe("ARC-03: a space sees and posts only its own journal", () => {
  it("another space's accounts and entries do not exist for it", async () => {
    const mine = await space();
    const other = await space();
    const theirs = await ledger.post(
      other.householdId,
      input({ type: "transfer", from: other.cash.id, to: other.savings.id, amount: eur("7") }),
    );
    expect(
      await code(
        ledger.post(
          mine.householdId,
          input({ type: "transfer", from: mine.cash.id, to: other.cash.id, amount: eur("7") }),
        ),
      ),
    ).toBe("UNKNOWN_ACCOUNT");
    expect(await code(ledger.balanceAt(mine.householdId, other.cash.id, "2026-12-31"))).toBe(
      "UNKNOWN_ACCOUNT",
    );
    expect(await code(ledger.reverse(mine.householdId, theirs.id, randomUUID()))).toBe("ENTRY_NOT_FOUND");
    // Even SQL without a filter, in the module's role, sees only the bound space.
    const seen = await db.databases
      .for("ledger")
      .inHousehold(
        mine.householdId,
        async (q) =>
          (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM entries WHERE id = $1`, [theirs.id]))
            .rows[0]!.n,
      );
    expect(seen).toBe(0);
    // A posting naming another space's account is refused by the database too (keys include the space).
    const own = await ledger.post(
      mine.householdId,
      input({ type: "transfer", from: mine.cash.id, to: mine.savings.id, amount: eur("1") }),
    );
    expect(
      await asModule(mine.householdId, `INSERT INTO postings VALUES ($1, $2, 2, $3, $4, 1, 'EUR')`, [
        mine.householdId,
        own.id,
        mine.cash.id,
        other.cash.id,
      ]),
    ).toBe("23503");
  });
});

describe("FIN-04 FR 2, FR 5 / ARC-11: the database refuses unbalanced, changed or deleted journal rows", () => {
  let s: Awaited<ReturnType<typeof space>>;
  let entryId: string;
  let usd: LedgerAccount;
  beforeAll(async () => {
    s = await space();
    usd = await ledger.openAccount(
      s.householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "USD" },
    );
    entryId = (
      await ledger.post(
        s.householdId,
        input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("10") }),
      )
    ).id;
  });
  /** A new entry with this one posting, in one transaction of the module role (a posting joins only a new entry). */
  const posting = (debit: string, credit: string, amount: string, currency: string) =>
    code(
      db.databases.for("ledger").inHousehold(s.householdId, async (q) => {
        const id = randomUUID();
        await q.query(
          `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
           VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'transfer', '2026-06-01', 1, $2::uuid::text)`,
          [s.householdId, id],
        );
        await q.query(`INSERT INTO postings VALUES ($1, $2, 1, $3, $4, $5, $6)`, [
          s.householdId,
          id,
          debit,
          credit,
          amount,
          currency,
        ]);
      }),
    );

  it("a posting is balanced by its row: positive amount, two different accounts, both in its currency", async () => {
    expect(await posting(s.savings.id, s.cash.id, "0", "EUR")).toBe("23514");
    expect(await posting(s.savings.id, s.cash.id, "-1", "EUR")).toBe("23514");
    expect(await posting(s.cash.id, s.cash.id, "1", "EUR")).toBe("23514");
    expect(await posting(usd.id, s.cash.id, "1", "EUR")).toBe("23503");
    expect(await posting(s.cash.id, usd.id, "1", "EUR")).toBe("23503");
    expect(await posting(usd.id, s.cash.id, "1", "USD")).toBe("23503");
    expect(await posting(s.savings.id, s.cash.id, "1", "EUR")).toBe("ok");
  });

  it("append-only: UPDATE, DELETE and TRUNCATE are refused for the module role; the time of recording is the database's", async () => {
    for (const table of ["entries", "postings", "accounts"]) {
      expect(await asModule(s.householdId, `UPDATE ${table} SET household_id = household_id`), table).toBe(
        "42501",
      );
      expect(await asModule(s.householdId, `DELETE FROM ${table}`), table).toBe("42501");
      expect(await asModule(s.householdId, `TRUNCATE ${table}`), table).toBe("42501");
      // Refused by privilege before any row is touched (the triggers alone would let a no-row statement pass).
      expect(
        await asModule(s.householdId, `UPDATE ${table} SET household_id = household_id WHERE false`),
        table,
      ).toBe("42501");
      expect(await asModule(s.householdId, `DELETE FROM ${table} WHERE false`), table).toBe("42501");
    }
    const id = randomUUID();
    expect(
      await asModule(
        s.householdId,
        `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key, recorded_at)
         VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'transfer', '2026-06-01', 1, $2::uuid::text, '2020-01-01')`,
        [s.householdId, id],
      ),
    ).toBe("42501");
  });

  it("append-only for every role: even the owner of the database cannot change or delete a journal row", async () => {
    expect(
      await code(db.owner.query(`UPDATE ledger.postings SET amount = 1 WHERE entry_id = $1`, [entryId])),
    ).toBe("42501");
    expect(await code(db.owner.query(`DELETE FROM ledger.entries WHERE id = $1`, [entryId]))).toBe("42501");
  });

  it("an entry is reversed at most once, and a reversal is never reversed — by the keys", async () => {
    const insertReversal = (id: string, of: string) =>
      code(
        db.databases.for("ledger").inHousehold(s.householdId, async (q) => {
          await q.query(
            `INSERT INTO entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key, reverses_entry_id)
             VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'reversal', '2026-06-01', 1, $2::uuid::text, $3)`,
            [s.householdId, id, of],
          );
          await q.query(`INSERT INTO postings VALUES ($1, $2, 1, $3, $4, 10, 'EUR')`, [
            s.householdId,
            id,
            s.cash.id,
            s.savings.id,
          ]);
        }),
      );
    const r1 = randomUUID();
    expect(await insertReversal(r1, entryId)).toBe("ok");
    expect(await insertReversal(randomUUID(), entryId)).toBe("23505");
    expect(await insertReversal(randomUUID(), r1)).toBe("23503");
  });
});

describe("FIN-04 AC6 (core): the daily integrity check finds broken entries and logs an «error» without amounts", () => {
  it("a clean journal: nothing reported; broken rows (written past the constraints): each check counted", async () => {
    const s = await space();
    const usd = await ledger.openAccount(
      s.householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "USD" },
    );
    const kept = await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("3150") }),
    );
    const check = createLedgerIntegrityCheck(db.databases.for("ledger"), async () => [s.householdId]);
    expect(await check.run()).toEqual({ "unbalanced-entry": 0, "empty-entry": 0, "reversal-mismatch": 0 });
    expect(await exportedText(telemetry)).not.toContain("ledger.integrity_violation");

    // Damage as only a restore or a dropped constraint could: the superuser skips the keys and triggers.
    const broken = { unbalanced: randomUUID(), empty: randomUUID(), reversal: randomUUID() };
    await db.owner.query("BEGIN");
    await db.owner.query("SET LOCAL session_replication_role = replica");
    const entry = (id: string, type = "transfer", reverses: string | null = null) =>
      db.owner.query(
        `INSERT INTO ledger.entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key, reverses_entry_id)
         VALUES ($1, $2::uuid, 'transactions', $2::uuid, $3, '2026-06-01', 1, $2::uuid::text, $4)`,
        [s.householdId, id, type, reverses],
      );
    const postingRow = (e: string, debit: string, credit: string, amount: string) =>
      db.owner.query(`INSERT INTO ledger.postings VALUES ($1, $2, 1, $3, $4, $5, 'EUR')`, [
        s.householdId,
        e,
        debit,
        credit,
        amount,
      ]);
    await entry(broken.unbalanced);
    await postingRow(broken.unbalanced, usd.id, s.cash.id, "50");
    await entry(broken.empty);
    await entry(broken.reversal, "reversal", kept.id);
    await postingRow(broken.reversal, s.cash.id, s.savings.id, "3100");
    await db.owner.query("COMMIT");

    expect(await check.run()).toEqual({ "unbalanced-entry": 1, "empty-entry": 1, "reversal-mismatch": 1 });
    const logged = await exportedText(telemetry);
    expect(logged).toContain("ledger.integrity_violation");
    expect(logged).toContain('"severity":"ERROR"');
    // The check and the count pass the redaction filter; nothing else of the space does.
    for (const check of ["unbalanced-entry", "empty-entry", "reversal-mismatch"])
      expect(logged).toContain(`"ws.ledger.check":"${check}","ws.ledger.entries":1`);
    expect(logged).not.toContain("ws.telemetry.redacted");
    for (const secret of [
      "3150",
      "3100",
      "50.0",
      s.householdId,
      s.cash.id,
      usd.id,
      kept.id,
      ...Object.values(broken),
    ])
      expect(logged).not.toContain(secret);
  });
});

describe("FIN-04@PoC FR 10: the owner's letter about a discrepancy, one per period (claims in the ledger schema)", () => {
  // Fixed per test: the claim time comes from the injected clock, never from re-reading the system time.
  const NOW = Date.UTC(2026, 10, 12, 3, 17, 0, 0);
  const clock = { now: () => NOW };

  /** An entry without postings, written past the triggers as only a restore could (an «empty-entry» finding). */
  async function breakSpace(householdId: string): Promise<string> {
    const id = randomUUID();
    await db.owner.query("BEGIN");
    await db.owner.query("SET LOCAL session_replication_role = replica");
    await db.owner.query(
      `INSERT INTO ledger.entries (household_id, id, source_module, source_id, event_type, operation_date, rules_version, idempotency_key)
       VALUES ($1, $2::uuid, 'transactions', $2::uuid, 'transfer', '2026-06-01', 1, $2::uuid::text)`,
      [householdId, id],
    );
    await db.owner.query("COMMIT");
    return id;
  }

  /** The latest state of the claim log: the open period, or null. */
  const state = async () =>
    (
      await db.owner.query<{ period: string | null; at: Date }>(
        `SELECT period, recorded_at AS at FROM ledger.integrity_alerts ORDER BY seq DESC LIMIT 1`,
      )
    ).rows[0] ?? null;

  const checkWith = (householdIds: string[], mail: MailSender | undefined) =>
    createLedgerIntegrityCheck(
      db.databases.for("ledger"),
      async () => householdIds,
      () => undefined,
      () => undefined,
      { clock, ...(mail ? { alertMail: { mail, to: "owner@example.test" } } : {}) },
    );

  /** A clean run over an empty space: ends the period a previous test may have left open. */
  const cleanRun = async (mail: MailSender | undefined = syntheticMailSender()) =>
    checkWith([randomUUID()], mail).run();

  it("FIN-04@PoC AC6: one letter per period across check instances; a clean run ends the period", async () => {
    const outbox = syntheticMailSender();
    await cleanRun(outbox);
    expect(outbox.sent).toEqual([]);
    expect((await state())?.period ?? null).toBeNull();

    const s = await space();
    const kept = await ledger.post(
      s.householdId,
      input({ type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("3150.25") }),
    );
    const brokenId = await breakSpace(s.householdId);
    await checkWith([s.householdId], outbox).run();
    // A second scheduler instance (or a restart) on the next daily run: the claim in the database holds.
    await checkWith([s.householdId], outbox).run();
    expect(outbox.sent).toHaveLength(1);
    expect(await state()).toEqual({
      period: "unbalanced-entry=0;empty-entry=1;reversal-mismatch=0",
      at: new Date(NOW),
    });
    const letter = outbox.sent[0]!;
    expect(letter.to).toBe("owner@example.test");
    expect(letter.text).toContain("Запис без проводок: 1.");
    for (const secret of ["3150", s.householdId, s.cash.id, s.savings.id, kept.id, brokenId])
      expect(`${letter.subject}\n${letter.text}`).not.toContain(secret);

    // A clean run ends the period; the same discrepancy afterwards is a new period with a new letter.
    await cleanRun(outbox);
    expect(await state()).toEqual({ period: null, at: new Date(NOW) });
    await checkWith([s.householdId], outbox).run();
    expect(outbox.sent).toHaveLength(2);
  });

  it("FIN-04@PoC EC3: a letter that could not be sent releases its claim; the next run sends it", async () => {
    await cleanRun();
    const s = await space();
    await breakSpace(s.householdId);
    const failing: MailSender = { send: () => Promise.reject(new TypeError("mail down")) };
    await expect(checkWith([s.householdId], failing).run()).resolves.toMatchObject({ "empty-entry": 1 });
    expect((await state())?.period).toBeNull();
    const logged = await exportedText(telemetry);
    expect(logged).toContain("ledger.integrity_alert_failed");
    expect(logged).toContain('"error.type":"TypeError"');
    const outbox = syntheticMailSender();
    await checkWith([s.householdId], outbox).run();
    expect(outbox.sent).toHaveLength(1);
    expect(await exportedText(telemetry)).toContain("ledger.integrity_alert_sent");
  });

  it("FIN-04@PoC EC4: no recipient — an «error» event, no claim, the check still returns its findings", async () => {
    await cleanRun();
    const before = await state();
    const s = await space();
    await breakSpace(s.householdId);
    await expect(checkWith([s.householdId], undefined).run()).resolves.toMatchObject({ "empty-entry": 1 });
    expect(await state()).toEqual(before);
    const logged = await exportedText(telemetry);
    expect(logged).toContain("alerts.recipient_missing");
    expect(logged).not.toContain("owner@example.test");
  });

  it("the claim log is append-only for the module role and every role; a key with an id or an amount is refused", async () => {
    const asLedger = (sql: string, values: unknown[] = []) =>
      code(db.databases.for("ledger").transaction((q) => q.query(sql, values)));
    const next = async () =>
      Number(
        (await db.owner.query(`SELECT coalesce(max(seq), 0) + 1 AS n FROM ledger.integrity_alerts`)).rows[0]
          .n,
      );
    expect(await asLedger(`UPDATE integrity_alerts SET recorded_at = now() WHERE false`)).toBe("42501");
    expect(await asLedger(`DELETE FROM integrity_alerts WHERE false`)).toBe("42501");
    expect(await asLedger(`TRUNCATE integrity_alerts`)).toBe("42501");
    expect(await code(db.owner.query(`DELETE FROM ledger.integrity_alerts`))).toBe("42501");
    const seq = await next();
    expect(await asLedger(`INSERT INTO integrity_alerts VALUES ($1, $2, now())`, [seq, randomUUID()])).toBe(
      "23514",
    );
    expect(
      await asLedger(`INSERT INTO integrity_alerts VALUES ($1, 'unbalanced-entry=3150.25', now())`, [seq]),
    ).toBe("23514");
    expect(await asLedger(`INSERT INTO integrity_alerts VALUES (0, NULL, now())`)).toBe("23514");
  });
});
