import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { pairKindOf, proposalOf, type PairCandidate } from "./matching.ts";

/** IMP-03@PoC a) (wave 2 row 47): currency exchanges between wallets of one account, without I/O. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function pair(
  out: [string, string, string],
  into: [string, string, string],
  accounts: [string, string] = [A, A],
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

/** The reference rate of 1 UAH in EUR (NBU 1 EUR = 44,50 UAH, as fx-rates gives it: 1 ÷ 44,5, 18 decimals). */
const uahEur = (date = "2026-03-02") =>
  exchangeRate({ base: "UAH", quote: "EUR", rate: "0.022471910112359551", date, source: "NBU" });

describe("IMP-03@PoC FR 2: «обмін валют» — a debit in one currency and a credit in another on two wallets of one account", () => {
  it("IMP-03@PoC AC2: −1 000 UAH and +22,50 EUR between wallets of one account the same day is an exchange with the bank's rate next to the reference one", () => {
    const proposal = proposalOf(
      pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-02"]),
      uahEur(),
    );
    expect(proposal).toMatchObject({ pairKind: "exchange", kind: "cross-currency", date: "2026-03-02" });
    if (proposal?.kind !== "cross-currency") throw new Error("expected an exchange");
    // FR 21: the actual rate of the pair (credit ÷ debit) and the reference rate of the day.
    expect(proposal.bankRate.toFixed()).toBe("0.0225");
    expect(proposal.rate.rate.toFixed()).toBe("0.022471910112359551");
    // FR 4: 22,50 against 22,4719… at the reference rate is 0,125 % off — within 1 %.
    expect(proposal.rateBand).toBe("within-1");
    // FR 21: the difference is no fee — it goes through «Валютна різниця».
    expect(proposal.difference.toDecimalString()).toBe("0.028089887640449");
  });

  it("IMP-03@PoC FR 2: two currencies on two accounts stay a transfer; one currency on one account is no pair", () => {
    const transfer = proposalOf(
      pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-02"], [A, B]),
      uahEur(),
    );
    expect(transfer).toMatchObject({ pairKind: "transfer", kind: "cross-currency" });
    expect(pairKindOf(pair(["-5.00", "EUR", "2026-03-02"], ["5.00", "EUR", "2026-03-02"], [A, B]))).toBe(
      "transfer",
    );
    expect(
      proposalOf(pair(["-100.00", "EUR", "2026-03-02"], ["100.00", "EUR", "2026-03-02"]), null),
    ).toBeNull();
  });

  it("IMP-03@PoC FR 4: the bank's rate within 1 % or within 3 % of the reference; beyond 3 % no exchange", () => {
    const at = (credit: string) =>
      proposalOf(pair(["-1000.00", "UAH", "2026-03-02"], [credit, "EUR", "2026-03-02"]), uahEur());
    // 22,4719… × 1,01 = 22,6966…; × 1,03 = 23,1460…; × 0,97 = 21,7977…
    expect(at("22.69")).toMatchObject({ rateBand: "within-1" });
    expect(at("22.70")).toMatchObject({ rateBand: "within-3" });
    expect(at("23.14")).toMatchObject({ rateBand: "within-3" });
    expect(at("23.15")).toBeNull();
    expect(at("21.80")).toMatchObject({ rateBand: "within-3" });
    expect(at("21.79")).toBeNull();
  });

  it("IMP-03@PoC FR 2: an exchange keeps the transfer window — up to 3 days, the rate of the earlier date — and needs a rate", () => {
    const later = proposalOf(
      pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-05"]),
      uahEur(),
    );
    expect(later).toMatchObject({ pairKind: "exchange", date: "2026-03-02" });
    expect(
      proposalOf(pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-06"]), uahEur()),
    ).toBeNull();
    expect(
      proposalOf(pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-02"]), null),
    ).toBeNull();
  });

  it("IMP-03@PoC FR 21: the bank's rate is exact decimals at 18 places, never a float", () => {
    const proposal = proposalOf(
      pair(["-3.00", "UAH", "2026-03-02"], ["0.07", "EUR", "2026-03-02"]),
      exchangeRate({ base: "UAH", quote: "EUR", rate: "0.0233", date: "2026-03-02", source: "NBU" }),
    );
    if (proposal?.kind !== "cross-currency") throw new Error("expected an exchange");
    expect(proposal.bankRate.toFixed()).toBe("0.023333333333333333");
  });
});
