// @vitest-environment node
import { describe, expect, it } from "vitest";
import { currencyPlaces, displayAmount, editAmount, parseAmountInput } from "./amount.ts";

/** CMP-02@PoC amount field text: decimal strings in and out, never JS numbers. */
const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("CMP-02@PoC amount text", () => {
  it("CMP-02@PoC FR «Вміст»: the currency's digits come from ISO 4217 (EUR and UAH 2, JPY 0)", () => {
    expect(currencyPlaces("EUR")).toBe(2);
    expect(currencyPlaces("UAH")).toBe(2);
    expect(currencyPlaces("JPY")).toBe(0);
  });

  it("CMP-02@PoC FR «Вміст»: typed text becomes a decimal string padded to the currency's digits", () => {
    expect(parseAmountInput("12,3", "uk", 2)).toEqual({ value: "12.30", problem: null });
    expect(parseAmountInput("3 000,00", "uk", 2)).toEqual({ value: "3000.00", problem: null });
    expect(parseAmountInput("4\u00A0512\u00A0300\u00A0000,00", "uk", 2)).toEqual({
      value: "4512300000.00",
      problem: null,
    });
    expect(parseAmountInput("12.3", "uk", 2)).toEqual({ value: "12.30", problem: null });
    expect(parseAmountInput("−5", "uk", 2)).toEqual({ value: "-5.00", problem: null });
    expect(parseAmountInput("1,234.5", "en", 2)).toEqual({ value: "1234.50", problem: null });
    expect(parseAmountInput("0012", "uk", 0)).toEqual({ value: "12", problem: null });
    expect(parseAmountInput(",5", "uk", 2)).toEqual({ value: "0.50", problem: null });
    expect(parseAmountInput("", "uk", 2)).toEqual({ value: null, problem: null });
  });

  it("CMP-02@PoC AC2: more significant digits than the currency's is a problem, never rounded away; trailing zeros are fine", () => {
    expect(parseAmountInput("12,345", "uk", 2)).toEqual({ value: null, problem: "places" });
    expect(parseAmountInput("12,340", "uk", 2)).toEqual({ value: "12.34", problem: null });
    expect(parseAmountInput("1,5", "uk", 0)).toEqual({ value: null, problem: "places" });
  });

  it("CMP-02@PoC FR «Вміст»: text that is not a number is the «invalid» problem", () => {
    for (const text of ["abc", "1,2,3", "1-2", "--1", "1e5", "."]) {
      expect(parseAmountInput(text, "uk", 2).problem).toBe("invalid");
    }
  });

  it("CMP-02@PoC FR «Довгі значення»: the shown text has the currency's digits; more digits are rounded and flagged", () => {
    expect(norm(displayAmount("uk", "4512300000.00", 2).text)).toBe("4 512 300 000,00");
    expect(displayAmount("uk", "4512300000.00", 2).approx).toBe(false);
    expect(displayAmount("uk", "0.3333", 2)).toEqual({ text: "0,33", approx: true });
    expect(displayAmount("uk", "-42.1", 2)).toEqual({ text: "−42,10", approx: false });
    expect(displayAmount("en", "1234.5", 2)).toEqual({ text: "1,234.50", approx: false });
  });

  it("CMP-02@PoC FR «Довгі значення»: the text to edit keeps every digit", () => {
    expect(editAmount("uk", "0.3333", 2)).toBe("0,3333");
    expect(norm(editAmount("uk", "123456789012345678.00", 2))).toBe("123 456 789 012 345 678,00");
  });

  it("CMP-02@PoC FR «Вміст»: a group separator out of place is not a number, never a larger amount", () => {
    expect(parseAmountInput("12,50", "en", 2)).toEqual({ value: null, problem: "invalid" });
    expect(parseAmountInput("1,2,3", "en", 2)).toEqual({ value: null, problem: "invalid" });
    expect(parseAmountInput("1,234.5", "en", 2)).toEqual({ value: "1234.50", problem: null });
    expect(parseAmountInput("-12,345,678.90", "en", 2)).toEqual({ value: "-12345678.90", problem: null });
  });
});
