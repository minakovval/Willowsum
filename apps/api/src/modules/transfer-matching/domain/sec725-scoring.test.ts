import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { proposalOf, type PairCandidate } from "./matching.ts";
import { chooseProposals, scored, type ScoredProposal } from "./scoring.ts";

/** IMP-03@PoC b) (wave 2 row 48): the score, the confidence and the one-to-one choice of proposals, without I/O. */
const CURRENT = "11111111-1111-4111-8111-111111111111";
const SAVINGS = "22222222-2222-4222-8222-222222222222";

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

describe("PR #725 security: the edges of the score and of the one-to-one choice", () => {
  it("sec725 FR 3: a pair of exactly 55 points is a proposal (low confidence); 50 is none", () => {
    // A fee of 2 % (35) three days apart (20): 55 — the least score of a proposal.
    expect(score(pair(["-500.00", "EUR", "2026-03-02"], ["490.00", "EUR", "2026-03-05"]))).toMatchObject({
      score: 55,
      confidence: "low",
    });
    // The exact amount (50) four days apart (no days evidence): 50 — below the least score.
    const far = pair(["-500.00", "EUR", "2026-03-02"], ["500.00", "EUR", "2026-03-06"]);
    expect(
      scored({
        ...far,
        date: "2026-03-02",
        pairKind: "transfer",
        kind: "same-currency",
        fee: Money.zero("EUR"),
      }),
    ).toBeNull();
  });

  it("sec725 FR 12: two debits for one credit — the credit is a side of one proposal only", () => {
    const into = id();
    const [near, far] = [id(), id()];
    const a = score(
      pair(["-200.00", "EUR", "2026-03-02"], ["200.00", "EUR", "2026-03-02"], undefined, [near, into]),
    )!;
    const b = score(
      pair(["-200.00", "EUR", "2026-03-05"], ["200.00", "EUR", "2026-03-02"], undefined, [far, into]),
    )!;
    const chosen = chooseProposals([b, a]);
    expect(chosen.map((p) => p.outflow.transactionId)).toEqual([near]);
    const sides = chosen.flatMap((p) => [p.outflow.transactionId, p.inflow.transactionId]);
    expect(new Set(sides).size).toBe(sides.length);
  });
});
