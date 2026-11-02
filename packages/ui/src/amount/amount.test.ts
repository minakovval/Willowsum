import { describe, expect, it } from "vitest";
import { formatCompactAmount } from "./compact.ts";
import { chooseFit } from "./fit.ts";

const NB = " ";
const c = (value: string, currency = "€") =>
  formatCompactAmount({ value, currency })?.replace(/\u00A0/g, " ");

describe("formatCompactAmount (CMP-07)", () => {
  it("follows the documented examples", () => {
    expect(c("12345678901234.00")).toBe("€ 12,35 tn");
    expect(c("128400")).toBe("€ 128,4 k");
    expect(c("12345678901.00")).toBe("€ 12,35 bn");
  });
  it("keeps the minus and the currency in front", () => {
    expect(c("-1240500", "₴")).toBe("−₴ 1,24 M");
  });
  it("carries into the next unit when rounding reaches a thousand", () => {
    expect(c("999960")).toBe("€ 1,00 M");
  });
  it("caps at 999+ qn", () => {
    expect(c("9".repeat(25))).toBe("€ 999+ qn");
  });
  it("switches to one decimal when rounding reaches 100", () => {
    expect(c("99995")).toBe("€ 100,0 k");
    expect(c("99999.5")).toBe("€ 100,0 k");
  });
  it("returns null for anything that is not a plain decimal string", () => {
    for (const bad of ["1 234", "1,234.56", "--5000", "abcd", "1e50", "Infinity1", ""]) {
      expect(formatCompactAmount({ value: bad, currency: "€" })).toBeNull();
    }
  });
  it("returns null below 1 000", () => {
    expect(formatCompactAmount({ value: "999.99", currency: "€" })).toBeNull();
  });
  it("uses no-break spaces", () => {
    expect(formatCompactAmount({ value: "128400", currency: "€" })).toBe(`€${NB}128,4${NB}k`);
  });
});

describe("chooseFit (CMP-07 order)", () => {
  // Width grows with characters and scale; the box is `box` units wide.
  const fitsIn = (box: number) => (text: string, scale: number) => text.length * scale <= box;
  const full = "€ 12 345 678 901 234,00"; // 23 chars
  const compact = "€ 12,35 tn"; // 10 chars
  it("keeps the full value when it fits", () => {
    expect(chooseFit(full, compact, fitsIn(30))).toEqual({ text: full, scale: 1, abbreviated: false });
  });
  it("shrinks the full value to 80 % first", () => {
    expect(chooseFit(full, compact, fitsIn(19))).toEqual({ text: full, scale: 0.8, abbreviated: false });
  });
  it("then abbreviates at 80 %, then shrinks down to 55 %", () => {
    expect(chooseFit(full, compact, fitsIn(8))).toEqual({ text: compact, scale: 0.8, abbreviated: true });
    expect(chooseFit(full, compact, fitsIn(6))).toEqual({ text: compact, scale: 0.6, abbreviated: true });
    expect(chooseFit(full, compact, fitsIn(2))).toEqual({ text: compact, scale: 0.55, abbreviated: true });
  });
});
