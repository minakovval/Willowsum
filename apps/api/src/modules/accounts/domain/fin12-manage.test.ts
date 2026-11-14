import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  balanceUpdatePlan,
  closingDateIssue,
  statementPlan,
  typedBalance,
  type LiveAdjustment,
} from "./index.ts";

/** FIN-12@PoC on the pure rules of managing an account: closing dates, «Оновити залишок», the statement's recount. */

const eur = (amount: string) => Money.of(amount, "EUR");
const live = (amount: string, date = "2026-10-01"): LiveAdjustment => ({
  entryId: "00000000-0000-4000-8000-0000000000a1",
  amount: eur(amount),
  date,
});

describe("FIN-12@PoC FR 14: «Оновити залишок» — one adjustment of the difference", () => {
  it("FIN-12@PoC AC13: 5 200,00 € in Willowsum, 5 150,00 € entered — a new adjustment of −50,00 €", () => {
    expect(balanceUpdatePlan(eur("5200"), eur("5150"), null)).toEqual({ kind: "post", amount: eur("-50") });
  });

  it("FIN-12@PoC AC14: an adjustment of −20,00 € and 300,00 € — 250,00 € changes the same adjustment to −70,00 €", () => {
    expect(balanceUpdatePlan(eur("300"), eur("250"), live("-20"))).toEqual({
      kind: "correct",
      entryId: live("-20").entryId,
      amount: eur("-70"),
    });
  });

  it("FIN-12@PoC AC16: the balance entered equals Willowsum's — no transaction", () => {
    expect(balanceUpdatePlan(eur("5200"), eur("5200.00"), null)).toEqual({ kind: "none" });
    expect(balanceUpdatePlan(eur("300"), eur("300"), live("-20"))).toEqual({ kind: "none" });
  });

  it("FIN-12@PoC FR 14: a difference that cancels the adjustment removes it (its reversal), never a zero entry", () => {
    expect(balanceUpdatePlan(eur("280"), eur("300"), live("-20"))).toEqual({
      kind: "reverse",
      entryId: live("-20").entryId,
    });
  });

  it("FIN-12@PoC FR 15: «Кредит» — the debt is typed as a positive amount and the balance is shown negative", () => {
    expect(typedBalance("loan", "1200.00", "EUR")).toEqual(eur("-1200"));
    expect(typedBalance("credit-card", "-5", "EUR")).toBeNull();
    expect(typedBalance("current", "-15.50", "EUR")).toEqual(eur("-15.5"));
    expect(typedBalance("cash", "-1", "EUR")).toBeNull();
    expect(typedBalance("cash", "1.005", "EUR")).toBeNull();
  });
});

describe("FIN-12@PoC FR 15: a temporary adjustment is recounted by the next statement with a closing balance", () => {
  it("FIN-12@PoC AC15: 1 000,00 € without the adjustment, +40,00 €, the statement ends at 1 040,00 € — +40,00 € dated the statement's end", () => {
    expect(statementPlan(eur("1000"), eur("1040"), live("40"), "2026-10-31")).toEqual({
      kind: "correct",
      entryId: live("40").entryId,
      amount: eur("40"),
    });
  });

  it("FIN-12@PoC FR 15: a new difference of zero removes the adjustment; another difference changes it", () => {
    expect(statementPlan(eur("1000"), eur("1000"), live("40"), "2026-10-31")).toEqual({
      kind: "reverse",
      entryId: live("40").entryId,
    });
    expect(statementPlan(eur("1000"), eur("990"), live("40"), "2026-10-31")).toEqual({
      kind: "correct",
      entryId: live("40").entryId,
      amount: eur("-10"),
    });
  });

  it("FIN-12@PoC FR 15: the same amount on the same date changes nothing; no adjustment — the statement creates none (FIN-04 FR 11)", () => {
    expect(statementPlan(eur("1000"), eur("1040"), live("40", "2026-10-31"), "2026-10-31")).toEqual({
      kind: "none",
    });
    expect(statementPlan(eur("1000"), eur("1040"), null, "2026-10-31")).toEqual({ kind: "none" });
  });
});

describe("FIN-12@PoC FR 7: the closing date", () => {
  it("FIN-12@PoC FR 7: a calendar date from the opening date to today", () => {
    expect(closingDateIssue("2026-09-30", "2024-10-01", "2026-10-17")).toBeNull();
    expect(closingDateIssue("2026-10-17", "2026-10-17", "2026-10-17")).toBeNull();
    expect(closingDateIssue("2026-10-18", "2024-10-01", "2026-10-17")).toBe("in_future");
    expect(closingDateIssue("2024-09-30", "2024-10-01", "2026-10-17")).toBe("before_opening");
    expect(closingDateIssue("2026-02-30", "2024-10-01", "2026-10-17")).toBe("invalid");
  });
});
