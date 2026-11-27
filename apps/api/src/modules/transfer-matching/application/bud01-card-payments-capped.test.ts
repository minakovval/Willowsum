import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it, vi } from "vitest";
import { markCardPayments } from "./card-payments.ts";
import { CANDIDATES_MAX } from "./proposals.ts";

/** BUD-01@PoC FR 7 (#731 item 1): the card payments are never marked from a capped read of the candidates. */
const CURRENT = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

const pair = (i: number) => ({
  outflow: {
    transactionId: `out-${i}`,
    accountId: CURRENT,
    amount: Money.of("-600.00", "EUR"),
    date: "2026-10-10",
    importBatchId: "batch",
  },
  inflow: {
    transactionId: `in-${i}`,
    accountId: CARD,
    amount: Money.of("600.00", "EUR"),
    date: "2026-10-10",
    importBatchId: "batch",
  },
});

function deps(count: number) {
  const mark = vi.fn(async () => true);
  return {
    mark,
    deps: {
      candidates: { candidatePairs: async () => Array.from({ length: count }, (_, i) => pair(i)) },
      rates: async () => [],
      cards: async () => new Set([CARD]),
      enabled: async () => true,
      mark,
    },
  };
}

describe("BUD-01@PoC FR 7: a card payment from an own account is marked only when it is surely unambiguous", () => {
  it("BUD-01@PoC FR 7: a read past its cap (more candidate pairs than it looks at) marks none (#731 item 1)", async () => {
    const capped = deps(CANDIDATES_MAX + 1);
    expect(await markCardPayments(capped.deps, "h", "a", { importBatchId: "batch" })).toBe(0);
    expect(capped.mark).not.toHaveBeenCalled();
    const whole = deps(1);
    expect(await markCardPayments(whole.deps, "h", "a", { importBatchId: "batch" })).toBe(1);
  });
});
