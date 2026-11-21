import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { proposalOf, type PairCandidate } from "./matching.ts";

/** Security review of #688: the exact limits of IMP-03 FR 4 and FR 21, without I/O. */
const A = "11111111-1111-4111-8111-111111111111";
const pair = (debit: string, credit: string): PairCandidate => ({
  outflow: {
    transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: A,
    amount: Money.of(debit, "UAH"),
    date: "2026-03-02",
  },
  inflow: {
    transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    accountId: A,
    amount: Money.of(credit, "EUR"),
    date: "2026-03-02",
  },
});
const rate = (r: string) =>
  exchangeRate({ base: "UAH", quote: "EUR", rate: r, date: "2026-03-02", source: "NBU" });

describe("IMP-03@PoC FR 4, FR 21: the limits of the rate band and the bank's rate (security review #688)", () => {
  it("IMP-03@PoC FR 4: exactly 1 % off the reference is still «within-1»; exactly 3 % is still a proposal", () => {
    expect(proposalOf(pair("-1000.00", "25.25"), rate("0.025"))).toMatchObject({ rateBand: "within-1" });
    expect(proposalOf(pair("-1000.00", "24.75"), rate("0.025"))).toMatchObject({ rateBand: "within-1" });
    expect(proposalOf(pair("-1000.00", "25.75"), rate("0.025"))).toMatchObject({ rateBand: "within-3" });
  });

  it("IMP-03@PoC FR 21: the bank's rate is rounded half to even at 18 places", () => {
    const p = proposalOf(pair("-3.00", "2.00"), rate("0.6667"));
    if (p?.kind !== "cross-currency") throw new Error("expected an exchange");
    expect(p.bankRate.toFixed()).toBe("0.666666666666666667");
  });
});
