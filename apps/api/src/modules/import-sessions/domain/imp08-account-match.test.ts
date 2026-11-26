import { describe, expect, it } from "vitest";
import { accountFor, type AccountCandidate } from "./account-match.ts";

/**
 * IMP-08@PoC FR 2, AC 17 (Рішення власника (2026-11-26, чат), row 230b: «У користувача може бути багато рахунків в
 * одному банку»): the file's account is picked by the card or IBAN tail first, by the bank only when that bank has one
 * account; several accounts of the bank and no tail match — no pick, «Створити рахунок».
 */
const MONO = "Універсал Банк (monobank)";
const black: AccountCandidate = { accountId: "a-black", institution: MONO, last4: "1234" };
const white: AccountCandidate = { accountId: "a-white", institution: MONO, last4: "5678" };
const pumb: AccountCandidate = { accountId: "a-pumb", institution: "ПУМБ", last4: "5678" };
const cash: AccountCandidate = { accountId: "a-cash", institution: null, last4: null };

describe("IMP-08@PoC FR 2 (row 230b): the account of a file among several of one bank", () => {
  it("IMP-08@PoC AC 17: two accounts in one bank, the mask matches the second — the second is picked", () => {
    expect(accountFor({ bank: MONO, mask: "…5678" }, [black, white, cash])).toEqual({
      kind: "picked",
      accountId: "a-white",
    });
    // The tail decides before the bank: the file names no bank.
    expect(accountFor({ mask: "…1234" }, [black, white])).toEqual({ kind: "picked", accountId: "a-black" });
  });

  it("IMP-08@PoC AC 17: two accounts in one bank, no mask match — no pick, no account fits («Створити рахунок»)", () => {
    expect(accountFor({ bank: MONO, mask: "…9021" }, [black, white, cash])).toEqual({ kind: "none" });
  });

  it("IMP-08@PoC FR 2: the bank alone picks only the bank's one account; several — the person picks", () => {
    expect(accountFor({ bank: "ПУМБ" }, [black, pumb])).toEqual({ kind: "picked", accountId: "a-pumb" });
    expect(accountFor({ bank: MONO }, [black, white])).toEqual({ kind: "several" });
    expect(accountFor({ bank: "Revolut Bank UAB" }, [black, white])).toEqual({ kind: "none" });
  });

  it("IMP-08@PoC FR 2: the same tail on two accounts — the one of the file's bank, else the person picks", () => {
    expect(accountFor({ bank: "«пумб»", mask: "…5678" }, [white, pumb])).toEqual({
      kind: "picked",
      accountId: "a-pumb",
    });
    expect(accountFor({ mask: "…5678" }, [white, pumb])).toEqual({ kind: "several" });
  });

  it("IMP-08@PoC FR 2 (review of #718): the one account with the tail is of another bank than the file names — no pick, «Створити рахунок»", () => {
    const pumbOther: AccountCandidate = { accountId: "a-pumb-9", institution: "ПУМБ", last4: "9999" };
    // A ПУМБ statement ••1234 next to «Monobank Чорна» ••1234: the tail does not make it Monobank's.
    expect(accountFor({ bank: "ПУМБ", mask: "…1234" }, [black, pumbOther])).toEqual({ kind: "none" });
    // An account with no bank recorded is no contradiction; a file with no bank neither.
    const noBank: AccountCandidate = { accountId: "a-nobank", institution: null, last4: "1234" };
    expect(accountFor({ bank: "ПУМБ", mask: "…1234" }, [noBank])).toEqual({
      kind: "picked",
      accountId: "a-nobank",
    });
    expect(accountFor({ mask: "…1234" }, [black, pumbOther])).toEqual({
      kind: "picked",
      accountId: "a-black",
    });
    // The same bank written otherwise is the same bank.
    expect(accountFor({ bank: "«пумб»", mask: "…9999" }, [black, pumbOther])).toEqual({
      kind: "picked",
      accountId: "a-pumb-9",
    });
    // A name typed by hand for an account («Інша установа») that is part of the printed one is no contradiction.
    const revolut: AccountCandidate = { accountId: "a-rev-4417", institution: "Revolut", last4: "4417" };
    expect(accountFor({ bank: "Revolut Bank UAB", mask: "…4417" }, [revolut, black])).toEqual({
      kind: "picked",
      accountId: "a-rev-4417",
    });
    expect(accountFor({ bank: MONO, mask: "…4417" }, [{ ...revolut, institution: "monobank" }])).toEqual({
      kind: "picked",
      accountId: "a-rev-4417",
    });
  });

  it("IMP-08@PoC FR 2: a tail no account has — the bank's one account only when it has no number", () => {
    const unnumbered: AccountCandidate = { accountId: "a-rev", institution: "Revolut Bank UAB", last4: null };
    const numbered: AccountCandidate = { ...unnumbered, last4: "4417" };
    expect(accountFor({ bank: "revolut bank uab", mask: "…5678" }, [unnumbered])).toEqual({
      kind: "picked",
      accountId: "a-rev",
    });
    expect(accountFor({ bank: "Revolut Bank UAB", mask: "…5678" }, [numbered])).toEqual({ kind: "none" });
  });

  it("IMP-08@PoC FR 2: a file that names neither a bank nor a number has nothing to match by", () => {
    expect(accountFor({}, [black])).toBeNull();
    expect(accountFor({ mask: "1234 5678 9012 3456" }, [black])).toBeNull();
  });
});
