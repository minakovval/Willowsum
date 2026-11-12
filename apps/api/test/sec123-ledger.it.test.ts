import { randomUUID } from "node:crypto";
import { Money } from "@willowsum/domain-kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLedger,
  createLedgerIntegrityCheck,
  type Ledger,
  type LedgerAccount,
  type PostInput,
} from "../src/modules/ledger/index.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #123 (FIN-04@PoC part 2): reversal and correction (AC3) and the daily integrity check
 * (core of AC7), on a real PostgreSQL through the ledger module's own role. Spaces, ids and amounts are synthetic.
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
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

type Space = { householdId: string; cash: LedgerAccount; savings: LedgerAccount; third: LedgerAccount };

async function space(): Promise<Space> {
  const householdId = randomUUID();
  const open = () =>
    ledger.openAccount(
      householdId,
      { module: "accounts", id: randomUUID() },
      { type: "asset", currency: "EUR" },
    );
  return { householdId, cash: await open(), savings: await open(), third: await open() };
}

const spend = (s: Space, amount: string, key = randomUUID(), date = "2026-06-15"): PostInput => ({
  source: { module: "transactions", id: randomUUID() },
  idempotencyKey: key,
  operationDate: date,
  event: { type: "transaction", account: s.cash.id, amount: eur(amount) },
});

const balance = async (s: Space, account = s.cash.id) =>
  (await ledger.balanceAt(s.householdId, account, "2026-12-31")).toDecimalString();

/** Entries of a space as the superuser sees them (bypasses the policy). */
const entryCount = async (householdId: string) =>
  Number(
    (await db.owner.query(`SELECT count(*) AS n FROM ledger.entries WHERE household_id = $1`, [householdId]))
      .rows[0].n,
  );

describe("sec123 — correction (FIN-04 FR 5, AC3): atomic, never in place, the resulting balance is right", () => {
  it("a replacement that fails leaves the original unreversed (reversal and new entry in one transaction)", async () => {
    const s = await space();
    const first = await ledger.post(s.householdId, spend(s, "-50"));
    const bad: PostInput = {
      ...spend(s, "-70"),
      event: { type: "transaction", account: randomUUID(), amount: eur("-70") },
    };
    expect(await code(ledger.correct(s.householdId, first.id, bad))).toBe("UNKNOWN_ACCOUNT");
    expect(await entryCount(s.householdId)).toBe(1);
    expect(await balance(s)).toBe("-50");
    // The original can still be reversed: no half-done correction holds its reversal slot.
    expect(await code(ledger.reverse(s.householdId, first.id, randomUUID()))).toBe("ok");
  });

  it("correcting an entry already reversed writes nothing", async () => {
    const s = await space();
    const first = await ledger.post(s.householdId, spend(s, "-50"));
    await ledger.reverse(s.householdId, first.id, randomUUID());
    expect(await code(ledger.correct(s.householdId, first.id, spend(s, "-70")))).toBe("ALREADY_REVERSED");
    expect(await entryCount(s.householdId)).toBe(2);
    expect(await balance(s)).toBe("0");
  });

  it("a repeated correction returns what it made; the balance counts the replacement once", async () => {
    const s = await space();
    const first = await ledger.post(s.householdId, spend(s, "-50"));
    const replacement = spend(s, "-70");
    const a = await ledger.correct(s.householdId, first.id, replacement);
    const b = await ledger.correct(s.householdId, first.id, replacement);
    expect([b.reversal.id, b.entry.id]).toEqual([a.reversal.id, a.entry.id]);
    expect(await balance(s)).toBe("-70");
  });

  it("another space's entry is ENTRY_NOT_FOUND for reverse and correct; neither space gets a row", async () => {
    const mine = await space();
    const other = await space();
    const theirs = await ledger.post(other.householdId, spend(other, "-50"));
    expect(await code(ledger.correct(mine.householdId, theirs.id, spend(mine, "-70")))).toBe(
      "ENTRY_NOT_FOUND",
    );
    expect(await code(ledger.reverse(mine.householdId, theirs.id, randomUUID()))).toBe("ENTRY_NOT_FOUND");
    expect(await entryCount(mine.householdId)).toBe(0);
    expect(await entryCount(other.householdId)).toBe(1);
    expect(await balance(other, other.cash.id)).toBe("-50");
  });

  // BLOCKING 1 — journal.ts correct(): the replacement goes through postIn, which returns ANY entry already made with
  // its key. A replacement that carries the original's key (the source record's id reused for the edit, ARC-11 makes
  // the source's id the key) reverses the original and "returns" the original as the new entry: the edit is lost
  // and the balance is 0 instead of -70, with no error.
  it("BLOCKING: a correction whose replacement key is already used by another entry is refused", async () => {
    const s = await space();
    const key = randomUUID();
    const first = await ledger.post(s.householdId, spend(s, "-50", key));
    const outcome = await code(ledger.correct(s.householdId, first.id, spend(s, "-70", key)));
    expect(outcome).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await balance(s)).toBe("-50");
    expect(await entryCount(s.householdId)).toBe(1);
  });

  it("a correction whose replacement key belongs to a third entry is refused; nothing is reversed", async () => {
    const s = await space();
    const first = await ledger.post(s.householdId, spend(s, "-50"));
    const otherKey = randomUUID();
    await ledger.post(s.householdId, spend(s, "-20", otherKey));
    expect(await code(ledger.correct(s.householdId, first.id, spend(s, "-70", otherKey)))).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect(await balance(s)).toBe("-70");
    expect(await entryCount(s.householdId)).toBe(2);
  });

  // BLOCKING 2 — journal.ts reverseIn(): a repeated key returns the entry it names whatever it is. reverse(X, k) with
  // k already used by another entry (a post, or the reversal of Y) reports success and returns that entry; X stays
  // unreversed, so a deletion silently does nothing to the balance.
  it("BLOCKING: reverse() with a key already used for another entry is refused, not a silent no-op", async () => {
    const s = await space();
    const x = await ledger.post(s.householdId, spend(s, "-50"));
    const y = await ledger.post(s.householdId, spend(s, "-20"));
    const key = randomUUID();
    await ledger.reverse(s.householdId, y.id, key);
    expect(await code(ledger.reverse(s.householdId, x.id, key))).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await balance(s)).toBe("-50");
  });
});

describe("sec123 — the daily integrity check (FIN-04 FR 9, AC7): no false positives, no false negatives", () => {
  /** Writes rows past every key and trigger, as only a restore or a dropped constraint could. */
  async function damage(rows: (q: (sql: string, values: unknown[]) => Promise<unknown>) => Promise<void>) {
    await db.owner.query("BEGIN");
    try {
      await db.owner.query("SET LOCAL session_replication_role = replica");
      await rows((sql, values) => db.owner.query(sql, values));
      await db.owner.query("COMMIT");
    } catch (error) {
      await db.owner.query("ROLLBACK");
      throw error;
    }
  }
  const ENTRY = `INSERT INTO ledger.entries (household_id, id, source_module, source_id, event_type, operation_date,
      rules_version, idempotency_key, reverses_entry_id)
    VALUES ($1, $2::uuid, 'transactions', $2::uuid, $3, $5::date, 1, $2::uuid::text, $4)`;
  const POSTING = `INSERT INTO ledger.postings VALUES ($1, $2, $3, $4, $5, $6, 'EUR')`;

  const checkOf = (...householdIds: string[]) =>
    createLedgerIntegrityCheck(
      db.databases.for("ledger"),
      async () => householdIds,
      () => undefined,
    );

  it("valid reversals and corrections are not reported (kills mutants that flag every reversal)", async () => {
    const s = await space();
    const a = await ledger.post(s.householdId, spend(s, "-50"));
    await ledger.reverse(s.householdId, a.id, randomUUID());
    const b = await ledger.post(s.householdId, {
      ...spend(s, "1"),
      event: { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("12.345") },
    });
    await ledger.correct(s.householdId, b.id, spend(s, "-7.5"));
    expect(await checkOf(s.householdId).run()).toEqual({
      "unbalanced-entry": 0,
      "empty-entry": 0,
      "reversal-mismatch": 0,
    });
  });

  it("every kind of broken reversal is counted", async () => {
    const s = await space();
    const orig = await ledger.post(s.householdId, {
      ...spend(s, "1"),
      event: { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("10") },
    });
    const orig2 = await ledger.post(s.householdId, {
      ...spend(s, "1"),
      event: { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("10") },
    });
    const orig3 = await ledger.post(s.householdId, {
      ...spend(s, "1"),
      event: { type: "transfer", from: s.cash.id, to: s.savings.id, amount: eur("10") },
    });
    const goodRev = await ledger.reverse(s.householdId, orig.id, randomUUID());
    const p = orig.postings[0]!;
    const missing = randomUUID();
    const ofReversal = randomUUID();
    const sameSides = randomUUID();
    const extraLeg = randomUUID();
    await damage(async (q) => {
      // Points to an entry that does not exist.
      await q(ENTRY, [s.householdId, missing, "reversal", randomUUID(), "2026-06-15"]);
      await q(POSTING, [s.householdId, missing, 1, s.cash.id, s.savings.id, "10"]);
      // Reverses a reversal (exactly offsetting it).
      await q(ENTRY, [s.householdId, ofReversal, "reversal", goodRev.id, "2026-06-15"]);
      await q(POSTING, [s.householdId, ofReversal, 1, p.debitAccountId, p.creditAccountId, "10"]);
      // Same sides as the original: doubles it instead of offsetting it.
      await q(ENTRY, [s.householdId, sameSides, "reversal", orig2.id, "2026-06-15"]);
      await q(POSTING, [s.householdId, sameSides, 1, p.debitAccountId, p.creditAccountId, "10"]);
      // Offsets the original, plus a leg on a third account.
      await q(ENTRY, [s.householdId, extraLeg, "reversal", orig3.id, "2026-06-15"]);
      await q(POSTING, [s.householdId, extraLeg, 1, p.creditAccountId, p.debitAccountId, "10"]);
      await q(POSTING, [s.householdId, extraLeg, 2, s.third.id, s.cash.id, "1"]);
    });
    expect((await checkOf(s.householdId).run())["reversal-mismatch"]).toBe(4);
  });

  it("a posting on another space's account (same currency) is an unbalanced entry of this space", async () => {
    const s = await space();
    const other = await space();
    const e = randomUUID();
    await damage(async (q) => {
      await q(ENTRY, [s.householdId, e, "transfer", null, "2026-06-15"]);
      await q(POSTING, [s.householdId, e, 1, other.cash.id, s.cash.id, "5"]);
    });
    expect((await checkOf(s.householdId).run())["unbalanced-entry"]).toBe(1);
  });

  it("findings of every listed space are summed; an unlisted space is not read", async () => {
    const a = await space();
    const b = await space();
    for (const s of [a, b])
      await damage(async (q) => {
        await q(ENTRY, [s.householdId, randomUUID(), "transfer", null, "2026-06-15"]);
      });
    expect((await checkOf(a.householdId, b.householdId).run())["empty-entry"]).toBe(2);
    expect((await checkOf(a.householdId).run())["empty-entry"]).toBe(1);
  });

  // Non-blocking — a reversal must be dated as its original (AC4 relies on it); the check does not look at the date.
  it("a reversal dated differently from its original is a reversal mismatch", async () => {
    const s = await space();
    const orig = await ledger.post(s.householdId, spend(s, "-50"));
    const p = orig.postings[0]!;
    const r = randomUUID();
    await damage(async (q) => {
      await q(ENTRY, [s.householdId, r, "reversal", orig.id, "2026-07-15"]);
      await q(POSTING, [s.householdId, r, 1, p.creditAccountId, p.debitAccountId, "50"]);
    });
    expect((await checkOf(s.householdId).run())["reversal-mismatch"]).toBe(1);
  });
});
