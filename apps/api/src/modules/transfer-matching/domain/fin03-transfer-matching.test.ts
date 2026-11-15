import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { candidateQuery, proposalOf, rateRequestOf, transferDate, type PairCandidate } from "./matching.ts";

/** FIN-03@PoC b) (wave 2 row 16b): the rules that find a transfer between own accounts, without I/O. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function pair(
  out: [string, string, string],
  into: [string, string, string],
  accounts: [string, string] = [A, B],
): PairCandidate {
  return {
    outflow: {
      transactionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountId: accounts[0],
      amount: Money.of(out[0], out[1]),
      date: out[2],
    },
    inflow: {
      transactionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      accountId: accounts[1],
      amount: Money.of(into[0], into[1]),
      date: into[2],
    },
  };
}

const eurUah = (rate: string, date = "2026-10-14") =>
  exchangeRate({ base: "EUR", quote: "UAH", rate, date, source: "NBU" });

describe("FIN-03@PoC FR 5: a pair is a debit on one own account and a credit on another within 3 days", () => {
  it("FIN-03@PoC AC2: −500 EUR on A and +498 EUR on B two days later is a proposal with a fee of 2 EUR", () => {
    const proposal = proposalOf(
      pair(["-500.00", "EUR", "2026-10-13"], ["498.00", "EUR", "2026-10-15"]),
      null,
    );
    expect(proposal).toMatchObject({ kind: "same-currency", date: "2026-10-13" });
    expect(proposal?.kind === "same-currency" && proposal.fee.toDecimalString()).toBe("-2");
  });

  it("FIN-03@PoC FR 5: in one currency the difference is 0 to 2 % — equal amounts match, 2 % matches, more or a larger credit do not", () => {
    const at = (into: string) =>
      proposalOf(pair(["-500.00", "EUR", "2026-10-13"], [into, "EUR", "2026-10-13"]), null);
    const equal = at("500.00");
    expect(equal).toMatchObject({ kind: "same-currency" });
    expect(equal?.kind === "same-currency" && equal.fee.isZero()).toBe(true);
    expect(at("490.00")).not.toBeNull();
    expect(at("489.99")).toBeNull();
    expect(at("500.01")).toBeNull();
  });

  it("FIN-03@PoC FR 5: more than 3 days apart is no pair, in either order", () => {
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-10-10"], ["100.00", "EUR", "2026-10-13"]), null),
    ).not.toBeNull();
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-10-10"], ["100.00", "EUR", "2026-10-14"]), null),
    ).toBeNull();
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-10-14"], ["100.00", "EUR", "2026-10-10"]), null),
    ).toBeNull();
    // Across a month end the days are calendar days.
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-09-29"], ["100.00", "EUR", "2026-10-02"]), null),
    ).not.toBeNull();
  });

  it("FIN-03@PoC FR 5: both sides on one account are no transfer between accounts", () => {
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-10-10"], ["100.00", "EUR", "2026-10-10"], [A, A]), null),
    ).toBeNull();
  });

  it("FIN-03@PoC AC4: −1 000 EUR and +42 900 UAH a day later at 43,50 UAH per EUR is a currency transfer — 1,38 % is within 3 %", () => {
    const candidate = pair(["-1000.00", "EUR", "2026-10-14"], ["42900.00", "UAH", "2026-10-15"]);
    expect(rateRequestOf(candidate)).toEqual({ from: "EUR", to: "UAH", date: "2026-10-14" });
    const proposal = proposalOf(candidate, eurUah("43.5"));
    expect(proposal).toMatchObject({ kind: "cross-currency", date: "2026-10-14" });
    if (proposal?.kind !== "cross-currency") throw new Error("expected a currency transfer");
    expect(proposal.converted.toDecimalString()).toBe("43500");
    expect(proposal.difference.toDecimalString()).toBe("-600");
  });

  it("FIN-03@PoC FR 5: in two currencies up to 3 % either way at the rate of the date matches; beyond it, or without a rate, not", () => {
    const at = (into: string, rate: string | null) =>
      proposalOf(
        pair(["-1000.00", "EUR", "2026-10-14"], [into, "UAH", "2026-10-14"]),
        rate === null ? null : eurUah(rate),
      );
    expect(at("42195.00", "43.5")).not.toBeNull(); // −3 %
    expect(at("44805.00", "43.5")).not.toBeNull(); // +3 %
    expect(at("42194.99", "43.5")).toBeNull();
    expect(at("44805.01", "43.5")).toBeNull();
    expect(at("42900.00", null)).toBeNull();
  });
});

describe("FIN-03@PoC edge case 1: a transfer whose sides have different dates is dated by the earlier side", () => {
  it("FIN-03@PoC EC1: the date of the transfer is the earlier date, whichever side it is", () => {
    expect(transferDate(pair(["-1.00", "EUR", "2026-10-15"], ["1.00", "EUR", "2026-10-13"]))).toBe(
      "2026-10-13",
    );
    expect(transferDate(pair(["-1.00", "EUR", "2026-10-12"], ["1.00", "EUR", "2026-10-13"]))).toBe(
      "2026-10-12",
    );
  });
});

describe("FIN-03@PoC FR 5: the search the transactions module runs for candidates", () => {
  it("FIN-03@PoC FR 5: the window is 3 days and a credit in one currency is at least 98 % of the debit", () => {
    expect(candidateQuery).toEqual({ windowDays: 3, sameCurrencyMinShare: "0.98" });
  });
});
