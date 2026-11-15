import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { LedgerError, postingsFor } from "./index.ts";

/** PR 284 security review: the bound of the legs of one event is 100 (IMP-02@PoC FR 5), as a literal, not the constant. */
const WALLET = "00000000-0000-4000-8000-000000000001";
const legs = (n: number) =>
  Array.from({ length: n }, () => ({ account: WALLET, amount: Money.of("1", "EUR") }));

describe("IMP-02@PoC FR 5: an event has at most 100 legs", () => {
  it("100 legs are one posting each", () => {
    expect(postingsFor({ type: "legs", legs: legs(100) })).toHaveLength(100);
  });
  it("101 legs are refused as INVALID_EVENT", () => {
    let code: string | undefined;
    try {
      postingsFor({ type: "legs", legs: legs(101) });
    } catch (e) {
      code = e instanceof LedgerError ? e.code : "other";
    }
    expect(code).toBe("INVALID_EVENT");
  });
});
