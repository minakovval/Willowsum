import { describe, expect, it } from "vitest";
import { parseNbuRates } from "./index.ts";

/** Review of PR #121: the NUMERIC(38,18) guard holds on its own, not only through the plausibility bound. */
const one = (rate: string) =>
  parseNbuRates(`[{"cc":"EUR","rate":${rate},"exchangedate":"12.11.2026"}]`, "2026-11-12");

describe("sec#121: NBU rate scale", () => {
  it("a rate inside the plausible range with 19 decimals is refused; 18 decimals pass unchanged", () => {
    expect(() => one("45.1234567890123456789")).toThrow();
    expect(one("45.123456789012345678")[0]!.rate.toFixed()).toBe("45.123456789012345678");
  });

  it("the smallest real NBU rates (order of 10^-4 … 10^-5 UAH: LBP, IRR, VND, IDR, UZS) pass", () => {
    for (const rate of ["0.00046234", "0.000041", "0.0016429", "0.0024893", "0.0033"])
      expect(one(rate)[0]!.rate.toFixed(), rate).toBe(rate);
  });
});
