import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { change } from "./index.ts";

/** Security review of #605 (BUD-06@PoC a): the percent never passes through a JS number. Synthetic. */
const eur = (amount: string) => Money.of(amount, "EUR");

describe("BUD-06@PoC (security review of #605): the change and the window", () => {
  it("BUD-06@PoC FR 1: the percent is rounded as a decimal, half to even — 0,05 % is «0.0», 0,15 % is «0.2»", () => {
    expect(change(eur("100.05"), eur("100"), "expense").percent).toBe("0.0");
    expect(change(eur("100.15"), eur("100"), "expense").percent).toBe("0.2");
    expect(change(eur("100.25"), eur("100"), "expense").percent).toBe("0.2");
    // Past the 15–17 digits of a float: the share is exact.
    expect(change(eur("300000000000000.45"), eur("200000000000000"), "expense").percent).toBe("50.0");
  });
});
