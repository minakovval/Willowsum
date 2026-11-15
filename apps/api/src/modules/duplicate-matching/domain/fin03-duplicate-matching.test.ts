import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  decideIncoming,
  isPossibleDuplicate,
  MATCH_WINDOW_DAYS,
  type DuplicateSide,
  type ExistingTransaction,
} from "./matching.ts";

/** FIN-03@PoC b) (wave 2 row 16c): the rule of «Можливий дубль» and of the automatic merge, without I/O. */
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let n = 0;
const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;

function side(amount: string, date: string, accountId = ACCOUNT, currency = "EUR"): DuplicateSide {
  return { transactionId: id(), accountId, amount: Money.of(amount, currency), date };
}

function manual(amount: string, date: string, matched = false): ExistingTransaction {
  return { ...side(amount, date), source: "manual", matched };
}

describe("FIN-03@PoC FR 12: «Можливий дубль» — the same account, amount and currency, dates within 3 days", () => {
  it("FIN-03@PoC FR 12: −30 EUR on one account within 3 days either way is a possible duplicate", () => {
    const a = side("-30.00", "2026-10-10");
    expect(MATCH_WINDOW_DAYS).toBe(3);
    for (const date of ["2026-10-07", "2026-10-10", "2026-10-13"])
      expect(isPossibleDuplicate(a, side("-30", date))).toBe(true);
  });

  it("FIN-03@PoC FR 12: 4 days apart, another account, another amount or another currency is no duplicate; nor a transaction with itself", () => {
    const a = side("-30.00", "2026-10-10");
    expect(isPossibleDuplicate(a, side("-30.00", "2026-10-14"))).toBe(false);
    expect(isPossibleDuplicate(a, side("-30.00", "2026-10-06"))).toBe(false);
    expect(isPossibleDuplicate(a, side("-30.00", "2026-10-10", OTHER))).toBe(false);
    expect(isPossibleDuplicate(a, side("-30.01", "2026-10-10"))).toBe(false);
    expect(isPossibleDuplicate(a, side("30.00", "2026-10-10"))).toBe(false);
    expect(isPossibleDuplicate(a, side("-30.00", "2026-10-10", ACCOUNT, "USD"))).toBe(false);
    expect(isPossibleDuplicate(a, a)).toBe(false);
  });

  it("FIN-03@PoC FR 12: the window counts calendar days across a month and a year", () => {
    expect(isPossibleDuplicate(side("-5", "2026-12-30"), side("-5", "2027-01-02"))).toBe(true);
    expect(isPossibleDuplicate(side("-5", "2026-02-27"), side("-5", "2026-03-03"))).toBe(false);
  });
});

describe("FIN-03@PoC FR 10: a bank transaction merges with a manual one automatically only with high confidence", () => {
  it("FIN-03@PoC FR 10: the only candidate, manual and not matched yet — merged", () => {
    const only = manual("-30.00", "2026-10-10");
    const decision = decideIncoming(side("-30.00", "2026-10-12"), [only, manual("-31.00", "2026-10-12")]);
    expect(decision).toEqual({ kind: "merge", with: only });
  });

  it("FIN-03@PoC AC6: two manual −30 EUR within 3 days, a bank −30 EUR arrives — no merge, «Можливий дубль» with both", () => {
    const first = manual("-30.00", "2026-10-09");
    const second = manual("-30.00", "2026-10-11");
    const decision = decideIncoming(side("-30.00", "2026-10-12"), [first, second]);
    expect(decision).toEqual({ kind: "possible-duplicate", candidates: [first, second] });
  });

  it("FIN-03@PoC FR 10: a manual one matched already, or an imported one, is no high confidence — «Можливий дубль»", () => {
    const matched = manual("-30.00", "2026-10-10", true);
    expect(decideIncoming(side("-30.00", "2026-10-10"), [matched])).toEqual({
      kind: "possible-duplicate",
      candidates: [matched],
    });
    const imported: ExistingTransaction = {
      ...side("-30.00", "2026-10-10"),
      source: "imported",
      matched: false,
    };
    expect(decideIncoming(side("-30.00", "2026-10-11"), [imported]).kind).toBe("possible-duplicate");
  });

  it("FIN-03@PoC FR 10: no transaction by the rule of FR 12 — a new one", () => {
    expect(decideIncoming(side("-30.00", "2026-10-20"), [manual("-30.00", "2026-10-10")])).toEqual({
      kind: "new",
    });
  });
});
