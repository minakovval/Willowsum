import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../domain/index.ts";
import {
  assertDate,
  assertMoment,
  BALANCE_ATTEMPTS,
  balanceAt,
  dailyIntegrityCheck,
  post,
  correct,
  reverse,
  type Entry,
  type IntegrityCheck,
  type IntegrityFindings,
  type LedgerStore,
  type LedgerTx,
} from "./index.ts";

/** FIN-04@PoC on the use cases with stub stores: guards before the database, the daily check's report. */

const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const A = "00000000-0000-4000-8000-00000000000a";
const SOURCE = { module: "transactions", id: "00000000-0000-4000-8000-0000000000f1" };

/** A store that fails the test if it is opened. */
const untouched: LedgerStore = {
  inHousehold: () => {
    throw new Error("the store must not be touched");
  },
};
const deps = { store: untouched, newId: () => A };
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code,
  );

describe("ARC-11: an event without a rule, or with an invalid date, is refused before anything is written", () => {
  it("unknown event type", async () => {
    const event = { type: "gift", account: A, amount: Money.of("1", "EUR") } as unknown as LedgerEvent;
    // post() opens the transaction, then refuses inside it before any read or write.
    let reads = 0;
    const counting: LedgerStore = {
      inHousehold: (_h, work) =>
        work(
          new Proxy({} as never, {
            get: () => () => {
              reads++;
              return Promise.resolve(null);
            },
          }),
        ),
    };
    expect(
      await code(
        post({ store: counting, newId: () => A }, H1, {
          source: SOURCE,
          idempotencyKey: "k",
          operationDate: "2026-06-30",
          event,
        }),
      ),
    ).toBe("UNKNOWN_EVENT_TYPE");
    expect(reads).toBe(0);
  });

  it("FIN-04 FR 6: a balance date is a calendar date", async () => {
    for (const bad of ["2026-02-30", "2026-6-30", "30.06.2026", "1899-12-31", ""])
      expect(() => assertDate(bad), bad).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    assertDate("2028-02-29");
    expect(await code(balanceAt(deps, H1, A, "2026-13-01"))).toBe("INVALID_DATE");
    expect(await code(balanceAt(deps, H1, "not-a-uuid", "2026-06-30"))).toBe("UNKNOWN_ACCOUNT");
    expect(await code(balanceAt(deps, H1, A, "2026-06-30", { asKnownAt: "yesterday" }))).toBe("INVALID_DATE");
  });

  it("ARC-11: «as known at» is a strict ISO 8601 moment, refused as INVALID_DATE before the database", async () => {
    // Date.parse accepts every one of these; PostgreSQL would refuse some of them with a raw 22007.
    for (const bad of [
      "2026-06-30",
      "2026-06-30 10:00:00Z",
      "2026-06-30T10:00:00",
      "2026-06-30T10:00Z",
      "2026-02-30T10:00:00Z",
      "2026-06-30T24:00:00Z",
      "2026-06-30T10:00:00.1234567Z",
      "+012026-06-30T10:00:00Z",
      "Tue, 30 Jun 2026 10:00:00 GMT",
      "June 30, 2026",
      "",
    ]) {
      expect(() => assertMoment(bad), bad).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
      expect(await code(balanceAt(deps, H1, A, "2026-06-30", { asKnownAt: bad })), bad).toBe("INVALID_DATE");
    }
    for (const good of ["2026-06-30T10:00:00Z", "2026-06-30T10:00:00.123456Z", "2026-06-30T12:30:00.5+02:00"])
      assertMoment(good);
  });
});

describe("FIN-04 FR 5, ARC-11: repeats and reversals are decided before anything is written", () => {
  const ENTRY: Entry = {
    id: "00000000-0000-4000-8000-0000000000e0",
    source: SOURCE,
    eventType: "transaction",
    operationDate: "2026-06-30",
    recordedAt: "2026-06-30T10:00:00.000000Z",
    rulesVersion: 1,
    reversesEntryId: null,
    postings: [],
    conversions: [],
  };
  /** A transaction stub: the given reads; any write fails the test. */
  const stub = (reads: {
    entryByKey?: Entry | null;
    entry?: Entry | null;
    reversalOf?: string | null;
  }): LedgerStore => ({
    inHousehold: (_h, work) =>
      work({
        entryByKey: async () => reads.entryByKey ?? null,
        entry: async () => reads.entry ?? null,
        reversalOf: async () => reads.reversalOf ?? null,
        accounts: async () => {
          throw new Error("no account is read for a repeat");
        },
        insertEntry: async () => {
          throw new Error("nothing is written");
        },
      } as never),
  });

  it("ARC-11: a repeated idempotency key returns the entry it made without reading accounts or writing", async () => {
    const event = { type: "transaction" as const, account: A, amount: Money.of("-5", "EUR") };
    const input = { source: SOURCE, idempotencyKey: "k", operationDate: "2026-06-30", event };
    expect(await post({ store: stub({ entryByKey: ENTRY }), newId: () => A }, H1, input)).toBe(ENTRY);
  });

  it("FIN-04 FR 5: an entry already reversed is not reversed again", async () => {
    const store = stub({ entry: ENTRY, reversalOf: "00000000-0000-4000-8000-0000000000e9" });
    expect(await code(reverse({ store, newId: () => A }, H1, ENTRY.id, "k2"))).toBe("ALREADY_REVERSED");
  });
});

describe("ARC-11: an idempotency key is a code, refused before the database", () => {
  const event = { type: "transaction" as const, account: A, amount: Money.of("-5", "EUR") };
  const input = (idempotencyKey: string) => ({
    source: SOURCE,
    idempotencyKey,
    operationDate: "2026-06-30",
    event,
  });
  /** Counts every read or write of the transaction; none is allowed for a refused key. */
  const counted = () => {
    const calls = { n: 0 };
    const store: LedgerStore = {
      inHousehold: (_h, work) =>
        work(
          new Proxy({} as never, {
            get: () => () => {
              calls.n++;
              return Promise.resolve(null);
            },
          }),
        ),
    };
    return { store, calls };
  };

  it.each(["Кава в аеропорту", "a b", "", "x".repeat(201), "key\n"])(
    "post, reverse and correct refuse %j with INVALID_IDEMPOTENCY_KEY",
    async (bad) => {
      const { store, calls } = counted();
      const d = { store, newId: () => A };
      expect(await code(post(d, H1, input(bad)))).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(await code(reverse(d, H1, A, bad))).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(await code(correct(d, H1, A, input(bad)))).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(calls.n).toBe(0);
    },
  );

  it("a code of 200 allowed characters is accepted by the guard", async () => {
    const { store } = counted();
    // It passes the key guard and fails later on the missing entry, never as INVALID_IDEMPOTENCY_KEY.
    expect(await code(reverse({ store, newId: () => A }, H1, A, "A0:._-".repeat(33) + "ab"))).toBe(
      "ENTRY_NOT_FOUND",
    );
  });
});

describe("FIN-04 AC6 (core): the daily integrity check", () => {
  const findings = (byHousehold: Record<string, Partial<IntegrityFindings>>): LedgerStore => ({
    inHousehold: (householdId, work) =>
      work({
        integrity: async () => ({
          "unbalanced-entry": 0,
          "empty-entry": 0,
          "reversal-mismatch": 0,
          "balance-cache": 0,
          ...byHousehold[householdId],
        }),
      } as never),
  });

  it("FIN-04 FR 9, FR 10: each failing check is reported once with the number of entries over all spaces", async () => {
    const reports: [IntegrityCheck, number][] = [];
    const total = await dailyIntegrityCheck({
      store: findings({
        [H1]: { "unbalanced-entry": 2 },
        [H2]: { "unbalanced-entry": 1, "reversal-mismatch": 1 },
      }),
      spaces: async () => [H1, H2],
      report: (check, entries) => reports.push([check, entries]),
    });
    expect(reports).toEqual([
      ["unbalanced-entry", 3],
      ["reversal-mismatch", 1],
    ]);
    expect(total).toEqual({
      "unbalanced-entry": 3,
      "empty-entry": 0,
      "reversal-mismatch": 1,
      "balance-cache": 0,
    });
  });

  it("FIN-04 FR 9: one space whose check fails is counted and the other spaces are still checked and reported", async () => {
    const H3 = "33333333-3333-4333-8333-333333333333";
    const reports: [IntegrityCheck, number][] = [];
    const failures: number[] = [];
    const ok = findings({ [H1]: { "empty-entry": 1 }, [H3]: { "reversal-mismatch": 2 } });
    const total = await dailyIntegrityCheck({
      store: {
        inHousehold: (householdId, work) =>
          householdId === H2 ? Promise.reject(new Error("query failed")) : ok.inHousehold(householdId, work),
      },
      spaces: async () => [H1, H2, H3],
      report: (check, entries) => reports.push([check, entries]),
      failed: (spaces) => failures.push(spaces),
    });
    expect(reports).toEqual([
      ["empty-entry", 1],
      ["reversal-mismatch", 2],
    ]);
    expect(failures).toEqual([1]);
    expect(total).toEqual({
      "unbalanced-entry": 0,
      "empty-entry": 1,
      "reversal-mismatch": 2,
      "balance-cache": 0,
    });
  });

  it("a clean journal reports nothing", async () => {
    const reports: unknown[] = [];
    await dailyIntegrityCheck({
      store: findings({}),
      spaces: async () => [H1, H2],
      report: (...r) => reports.push(r),
    });
    expect(reports).toEqual([]);
  });

  it("no failed space, no failure report", async () => {
    const failures: number[] = [];
    await dailyIntegrityCheck({
      store: findings({}),
      spaces: async () => [H1, H2],
      report: () => undefined,
      failed: (spaces) => failures.push(spaces),
    });
    expect(failures).toEqual([]);
  });
});

describe("ARC-11 «Баланси і продуктивність»: the balance cache's version check and the cache read", () => {
  const B = "00000000-0000-4000-8000-00000000000b";
  /** A space with two EUR asset accounts; the cache answers per `versions` and records every update try. */
  function cacheStore(conflicts: number, cached: { debits: string; credits: string } | null = null) {
    const tries: {
      account: string;
      expected: number | null;
      day: string;
      debits: string;
      credits: string;
    }[] = [];
    let version: Record<string, number> = { [A]: 3, [B]: 7 };
    let left = conflicts;
    const tx: Partial<LedgerTx> = {
      entryByKey: async () => null,
      accounts: async (ids) => ids.map((id) => ({ id, type: "asset", currency: "EUR" })),
      insertEntry: async () => true,
      insertPostings: async () => undefined,
      entry: async (id) => ({ id }) as Entry,
      recorded: async () => undefined,
      balanceVersion: async (account) => version[account] ?? null,
      moveBalance: async (account, expected, day, debits, credits) => {
        tries.push({
          account,
          expected,
          day,
          debits: debits.toDecimalString(),
          credits: credits.toDecimalString(),
        });
        if (left > 0) {
          // Another entry changed the account first: a new version, nothing written here.
          left--;
          version = { ...version, [account]: version[account]! + 1 };
          return false;
        }
        version = { ...version, [account]: version[account]! + 1 };
        return true;
      },
      cachedTotals: async () => cached,
      totals: async () => ({ debits: "40", credits: "15" }),
    };
    const store: LedgerStore = { inHousehold: (_h, work) => work(tx as LedgerTx) };
    return { store, tries };
  }
  const transfer = (amount: string) => ({
    source: SOURCE,
    idempotencyKey: "k-1",
    operationDate: "2026-06-03",
    event: { type: "transfer", from: B, to: A, amount: Money.of(amount, "EUR") } as LedgerEvent,
  });

  it("ARC-11: each account's cache gets the entry's movement on its date, with the version it read, in the order of the ids", async () => {
    const { store, tries } = cacheStore(0);
    await post({ store, newId: () => "00000000-0000-4000-8000-0000000000e1" }, H1, transfer("0.3"));
    expect(tries).toEqual([
      { account: A, expected: 3, day: "2026-06-03", debits: "0.3", credits: "0" },
      { account: B, expected: 7, day: "2026-06-03", debits: "0", credits: "0.3" },
    ]);
  });

  it("ARC-11: a conflict is retried on the fresh version, so the concurrent entry's amount is not lost", async () => {
    const { store, tries } = cacheStore(2);
    await post({ store, newId: () => "00000000-0000-4000-8000-0000000000e1" }, H1, transfer("5"));
    expect(tries.map((t) => [t.account, t.expected])).toEqual([
      [A, 3],
      [A, 4],
      [A, 5],
      [B, 7],
    ]);
  });

  it("ARC-11: an account that keeps conflicting refuses the entry (rolled back), never writes a stale cache", async () => {
    const { store, tries } = cacheStore(BALANCE_ATTEMPTS);
    expect(
      await code(post({ store, newId: () => "00000000-0000-4000-8000-0000000000e1" }, H1, transfer("5"))),
    ).toBe("BALANCE_CONFLICT");
    expect(tries).toHaveLength(BALANCE_ATTEMPTS);
  });

  it("ARC-11: balanceAt takes the cache when it answers and the postings when it does not — the same sign rules", async () => {
    const served = cacheStore(0, { debits: "100", credits: "0.5" });
    expect(
      (await balanceAt({ store: served.store, newId: () => A }, H1, A, "2026-06-30")).toDecimalString(),
    ).toBe("99.5");
    const raw = cacheStore(0, null);
    expect(
      (await balanceAt({ store: raw.store, newId: () => A }, H1, A, "2026-06-30")).toDecimalString(),
    ).toBe("25");
  });
});
