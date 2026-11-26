import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { proposalOf, type PairCandidate } from "./matching.ts";
import { chooseProposals, confidenceOf, minorUnit, scored, type ScoredProposal } from "./scoring.ts";

/** IMP-03@PoC b) (wave 2 row 48): the score, the confidence and the one-to-one choice of proposals, without I/O. */
const CURRENT = "11111111-1111-4111-8111-111111111111";
const SAVINGS = "22222222-2222-4222-8222-222222222222";
const CARD = "33333333-3333-4333-8333-333333333333";

let next = 0;
const id = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++next).padStart(12, "0")}`;

function pair(
  out: [string, string, string],
  into: [string, string, string],
  accounts: [string, string] = [CURRENT, SAVINGS],
  ids: [string, string] = [id(), id()],
): PairCandidate {
  return {
    outflow: {
      transactionId: ids[0],
      accountId: accounts[0],
      amount: Money.of(out[0], out[1]),
      date: out[2],
    },
    inflow: {
      transactionId: ids[1],
      accountId: accounts[1],
      amount: Money.of(into[0], into[1]),
      date: into[2],
    },
  };
}

function score(c: PairCandidate, rate: Parameters<typeof proposalOf>[1] = null): ScoredProposal | null {
  const p = proposalOf(c, rate);
  return p && scored(p);
}

describe("IMP-03@PoC FR 3: the score 0–100 is the sum of the evidence; a proposal from 55; high from 80, medium from 65", () => {
  it("IMP-03@PoC FR 3: the confidence bands", () => {
    expect([confidenceOf(100), confidenceOf(80), confidenceOf(79), confidenceOf(65)]).toEqual([
      "high",
      "high",
      "medium",
      "medium",
    ]);
    expect([confidenceOf(64), confidenceOf(55)]).toEqual(["low", "low"]);
  });

  it("IMP-03@PoC AC1: −500,00 EUR on the current account on 2 March and +500,00 EUR on savings on 3 March — a transfer with high confidence", () => {
    const p = score(pair(["-500.00", "EUR", "2026-03-02"], ["500.00", "EUR", "2026-03-03"]));
    expect(p).toMatchObject({ pairKind: "transfer", confidence: "high", score: 80 });
    expect(p?.evidence).toEqual([
      { code: "exact-amount", points: 50 },
      { code: "days-apart", points: 30, days: 1 },
    ]);
  });

  it("IMP-03@PoC AC3: −100,00 EUR and +99,99 EUR is the exact amount within ±0,01 — proposed", () => {
    const p = score(pair(["-100.00", "EUR", "2026-03-02"], ["99.99", "EUR", "2026-03-02"]));
    expect(p?.evidence[0]).toEqual({ code: "exact-amount", points: 50 });
    expect(p).toMatchObject({ score: 85, confidence: "high" });
    // ±1 minor unit of the currency: 0,01 EUR, 1 JPY, 0,001 KWD.
    expect([minorUnit("EUR"), minorUnit("JPY"), minorUnit("KWD")].map((d) => d.toFixed())).toEqual([
      "0.01",
      "1",
      "0.001",
    ]);
    const jpy = score(pair(["-10000", "JPY", "2026-03-02"], ["9999", "JPY", "2026-03-02"]));
    expect(jpy?.evidence[0]?.code).toBe("exact-amount");
    const kwd = score(pair(["-100.000", "KWD", "2026-03-02"], ["99.998", "KWD", "2026-03-02"]));
    expect(kwd?.evidence[0]?.code).toBe("amount-less-fee");
  });

  it("IMP-03@PoC AC14: two own accounts without an identifier or marker words whose evidence is below 55 — no proposal", () => {
    // A fee of 2 % (25) two days apart (20): 45.
    expect(score(pair(["-500.00", "EUR", "2026-03-02"], ["490.00", "EUR", "2026-03-04"]))).toBeNull();
    // The same fee on the same day (35): 60 — a low-confidence proposal.
    expect(score(pair(["-500.00", "EUR", "2026-03-02"], ["490.00", "EUR", "2026-03-02"]))).toMatchObject({
      score: 60,
      confidence: "low",
    });
  });

  it("IMP-03@PoC FR 4: a fee up to 0,5 % scores more than one up to 2 %; the days score 35, 30, 20, 10", () => {
    const fee = (into: string) =>
      score(pair(["-1000.00", "EUR", "2026-03-02"], [into, "EUR", "2026-03-02"]))?.evidence[0];
    expect(fee("995.00")).toEqual({ code: "amount-less-fee", points: 40 });
    expect(fee("994.99")).toEqual({ code: "amount-less-fee", points: 25 });
    const days = (date: string) =>
      score(pair(["-100.00", "EUR", "2026-03-02"], ["100.00", "EUR", date]))?.score;
    expect([days("2026-03-02"), days("2026-03-03"), days("2026-03-04"), days("2026-03-05")]).toEqual([
      85, 80, 70, 60,
    ]);
  });

  it("IMP-03@PoC FR 4: an exchange on one account scores the rate band and the wallet group", () => {
    const rate = exchangeRate({
      base: "UAH",
      quote: "EUR",
      rate: "0.0224719",
      date: "2026-03-02",
      source: "NBU",
    });
    const p = score(
      pair(["-1000.00", "UAH", "2026-03-02"], ["22.50", "EUR", "2026-03-02"], [CARD, CARD]),
      rate,
    );
    expect(p).toMatchObject({ pairKind: "exchange", score: 90, confidence: "high" });
    expect(p?.evidence.map((e) => e.code)).toEqual(["rate-within-1", "same-day", "same-wallet-group"]);
  });
});

describe("IMP-03@PoC FR 12: open proposals are one-to-one; FR 7: candidates within 5 points are «неоднозначно з…»", () => {
  it("IMP-03@PoC FR 12: two credits for one debit — only the better pair is a proposal; the other credit is free", () => {
    const out = id();
    const [near, far] = [id(), id()];
    const a = score(
      pair(["-200.00", "EUR", "2026-03-02"], ["200.00", "EUR", "2026-03-02"], undefined, [out, near]),
    )!;
    const b = score(
      pair(["-200.00", "EUR", "2026-03-02"], ["200.00", "EUR", "2026-03-05"], undefined, [out, far]),
    )!;
    const chosen = chooseProposals([b, a]);
    expect(chosen.map((p) => p.inflow.transactionId)).toEqual([near]);
    // 85 against 60: beyond 5 points, not ambiguous.
    expect(chosen[0]!.ambiguousWith).toEqual([]);
  });

  it("IMP-03@PoC EC4: candidates with close scores — the proposal shows «неоднозначно з…» the other", () => {
    const out = id();
    const [sameDay, nextDay] = [id(), id()];
    const a = score(
      pair(["-50.00", "EUR", "2026-03-02"], ["50.00", "EUR", "2026-03-02"], undefined, [out, sameDay]),
    )!;
    const b = score(
      pair(["-50.00", "EUR", "2026-03-02"], ["50.00", "EUR", "2026-03-03"], undefined, [out, nextDay]),
    )!;
    expect([a.score, b.score]).toEqual([85, 80]);
    const [chosen, ...rest] = chooseProposals([a, b]);
    expect(rest).toEqual([]);
    expect(chosen!.inflow.transactionId).toBe(sameDay);
    expect(chosen!.ambiguousWith).toEqual([{ transactionId: nextDay, score: 80 }]);
  });

  it("IMP-03@PoC FR 7: at an equal score the kind, then fewer days, then the smaller difference wins", () => {
    const out = id();
    const [small, large] = [id(), id()];
    // Both 40 + 35 on the same day: the 1,00 EUR fee beats the 2,00 EUR fee.
    const a = score(
      pair(["-1000.00", "EUR", "2026-03-02"], ["998.00", "EUR", "2026-03-02"], undefined, [out, large]),
    )!;
    const b = score(
      pair(["-1000.00", "EUR", "2026-03-02"], ["999.00", "EUR", "2026-03-02"], undefined, [out, small]),
    )!;
    expect(a.score).toBe(b.score);
    const [chosen] = chooseProposals([a, b]);
    expect(chosen!.inflow.transactionId).toBe(small);
    expect(chosen!.ambiguousWith).toEqual([{ transactionId: large, score: a.score }]);
    // The order of the input does not change the choice.
    expect(chooseProposals([b, a])[0]!.inflow.transactionId).toBe(small);
  });

  it("IMP-03@PoC FR 12: a chain of pairs — each transaction is a side of one proposal at most; the chosen keep their order", () => {
    const [o1, o2, i1, i2] = [id(), id(), id(), id()];
    const p11 = score(
      pair(["-10.00", "EUR", "2026-03-02"], ["10.00", "EUR", "2026-03-02"], undefined, [o1, i1]),
    )!;
    const p21 = score(
      pair(["-10.00", "EUR", "2026-03-02"], ["10.00", "EUR", "2026-03-03"], undefined, [o2, i1]),
    )!;
    const p22 = score(
      pair(["-10.00", "EUR", "2026-03-03"], ["10.00", "EUR", "2026-03-03"], undefined, [o2, i2]),
    )!;
    const chosen = chooseProposals([p22, p21, p11]);
    expect(chosen.map((p) => [p.outflow.transactionId, p.inflow.transactionId])).toEqual([
      [o2, i2],
      [o1, i1],
    ]);
    const sides = chosen.flatMap((p) => [p.outflow.transactionId, p.inflow.transactionId]);
    expect(new Set(sides).size).toBe(sides.length);
  });
});
