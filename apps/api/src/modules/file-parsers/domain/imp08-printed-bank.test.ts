import { describe, expect, it } from "vitest";
import { bankName, detectAccount, PRINTED_BANK_LIMITS, printedBank, type Institution } from "./detect.ts";

/**
 * IMP-08@PoC FR 2, AC 17 (Рішення власника (2026-11-26, чат), row 230b: «визначати банк з виписки - так»): a bank
 * that is not in the NBU directory is still detected, as the rows before the table print it, marked
 * `bankInDirectory: false`; a printed name never carries more than 4 digits. Synthetic values built at runtime.
 */
const BANKS: readonly Institution[] = [{ name: "ПУМБ", legalName: 'АТ "ПУМБ"' }];
const CARD = ["4149", "4999", "1234", "5678"].join(" ");

describe("IMP-08@PoC FR 2 (row 230b): the bank outside the directory", () => {
  it("IMP-08@PoC AC 17: a Revolut-like statement (bank not in the directory) gives the printed bank, not the directory's", () => {
    expect(detectAccount([["Revolut Bank UAB"], ["EUR Statement"]], ["EUR"], BANKS)).toEqual({
      bank: "Revolut Bank UAB",
      bankInDirectory: false,
      currency: "EUR",
    });
    // A directory bank still wins and is marked as the directory's.
    expect(detectAccount([["Bank", "ПУМБ"]], [], BANKS)).toEqual({ bank: "ПУМБ", bankInDirectory: true });
  });

  it("IMP-08@PoC FR 2: the value after a label «Банк» / «Bank name» (next cell or after a colon) is the bank", () => {
    expect(printedBank([["Банк", "  Wise   Europe SA "]])).toBe("Wise Europe SA");
    expect(printedBank([["Bank name: N26 Bank GmbH"]])).toBe("N26 Bank GmbH");
    expect(printedBank([["Назва банку", "Revolut"]])).toBe("Revolut");
  });

  it("IMP-08@PoC FR 2: a title, a field or two different names are not a bank — the person picks it", () => {
    expect(printedBank([["Bank statement"]])).toBeNull();
    expect(printedBank([["Виписка по рахунку в банку"]])).toBeNull();
    expect(printedBank([["Revolut Bank UAB"], ["N26 Bank GmbH"]])).toBeNull();
    expect(
      printedBank([
        ["Bank", "Revolut"],
        ["Bank", "Wise"],
      ]),
    ).toBeNull();
    expect(printedBank([["Bank"]])).toBeNull();
    expect(printedBank([])).toBeNull();
  });

  it("IMP-08@PoC FR 2: a printed bank name with a long digit run never passes beyond 4 digits", () => {
    expect(printedBank([["Bank", `Revolut ${CARD}`]])).toBeNull();
    expect(printedBank([[`Revolut Bank ${CARD}`]])).toBeNull();
    expect(detectAccount([["Bank", `Revolut ${CARD}`]], [], BANKS).bank).toBeUndefined();
    expect(bankName("Банк 3/4")).toBe("Банк 3/4");
    expect(bankName("Bank 12345")).toBeNull();
  });

  it("IMP-08@PoC FR 2: the name is one line of at most 100 characters, without control or direction marks", () => {
    expect(bankName("Revolut‮ Bank\nUAB")).toBe("Revolut Bank UAB");
    expect(bankName("x".repeat(PRINTED_BANK_LIMITS.length + 1))).toBeNull();
    expect(bankName("1234")).toBeNull();
    expect(bankName("   ")).toBeNull();
  });
});
