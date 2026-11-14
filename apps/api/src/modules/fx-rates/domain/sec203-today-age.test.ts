import { describe, expect, it } from "vitest";
import { todayRateIsApproximate } from "./index.ts";

/** Security review of PR #203 (VAL-04@PoC EC2): the age rule of «today»'s rate is one-sided and refuses bad dates. */
describe("VAL-04@PoC EC2: the age of the rate of «today»", () => {
  it("VAL-04@PoC EC2: a rate dated more than 3 days after today is never «older» (one-sided, not |today − rateDate|)", () => {
    expect(todayRateIsApproximate("2026-11-21", "2026-11-16")).toBe(false);
    expect(todayRateIsApproximate("2026-11-17", "2026-11-16")).toBe(false);
  });

  it("VAL-04@PoC EC2: a malformed date is refused, never read as plain", () => {
    expect(() => todayRateIsApproximate("2026-11-1", "2026-11-16")).toThrow();
    expect(() => todayRateIsApproximate("2026-11-13", "16.11.2026")).toThrow();
  });
});
