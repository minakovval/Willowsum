import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../domain/index.ts";
import {
  assertDate,
  balanceAt,
  dailyIntegrityCheck,
  post,
  reverse,
  type Entry,
  type IntegrityCheck,
  type IntegrityFindings,
  type LedgerStore,
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

describe("FIN-04 AC7 (core): the daily integrity check", () => {
  const findings = (byHousehold: Record<string, Partial<IntegrityFindings>>): LedgerStore => ({
    inHousehold: (householdId, work) =>
      work({
        integrity: async () => ({
          "unbalanced-entry": 0,
          "empty-entry": 0,
          "reversal-mismatch": 0,
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
    expect(total).toEqual({ "unbalanced-entry": 3, "empty-entry": 0, "reversal-mismatch": 1 });
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
});
