import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  daysBefore,
  isCardPayment,
  ONE_SIDED_AFTER_DAYS,
  oneSidedEvidence,
  oneSidedToFlag,
  type SingleTransaction,
} from "./one-sided.ts";

const CURRENT = "00000000-0000-4000-8000-000000000001";
const CARD = "00000000-0000-4000-8000-000000000002";
const TODAY = "2026-10-20";

function single(
  amount: string,
  date: string,
  text: string,
  accountId = CURRENT,
  id = `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
): SingleTransaction {
  return {
    transactionId: id,
    accountId,
    amount: Money.of(amount, "EUR"),
    date,
    counterparty: null,
    description: text,
  };
}

const context = { today: TODAY, cards: new Set([CARD]), proposed: new Set<string>() };

describe("IMP-03@PoC FR 14: a free transaction that says «переказ» and points to an own account is flagged after 4 days", () => {
  it("IMP-03@PoC AC9: «переказ на власний рахунок» with no other side for 4 days is a one-sided transfer", () => {
    expect(ONE_SIDED_AFTER_DAYS).toBe(4);
    const t = single("-300.00", "2026-10-16", "Переказ на власний рахунок");
    expect(oneSidedEvidence(t, context)).toEqual(["transfer-words", "own-account-words"]);
  });

  it("IMP-03@PoC FR 14: only 3 days old — no flag yet; the bound of 4 days is inclusive", () => {
    expect(
      oneSidedEvidence(single("-300.00", "2026-10-17", "Переказ на власний рахунок"), context),
    ).toBeNull();
    expect(daysBefore("2026-03-02", 4)).toBe("2026-02-26");
  });

  it("IMP-03@PoC FR 14: «переказ» alone, or «власний рахунок» alone, is no one-sided transfer", () => {
    expect(oneSidedEvidence(single("-300.00", "2026-10-01", "Переказ Олені"), context)).toBeNull();
    expect(oneSidedEvidence(single("-300.00", "2026-10-01", "Власний рахунок"), context)).toBeNull();
  });

  it("IMP-03@PoC FR 14: the words in other languages, any case and spacing", () => {
    expect(
      oneSidedEvidence(single("-50.00", "2026-10-01", "ÜBERWEISUNG  auf eigenes   Konto"), context),
    ).not.toBeNull();
    expect(
      oneSidedEvidence(single("50.00", "2026-10-01", "Transfer from own account"), context),
    ).not.toBeNull();
  });

  it("IMP-03@PoC FR 14: a side of an open proposal is never flagged — its pair waits for «Підтвердити»", () => {
    const t = single("-300.00", "2026-10-01", "Переказ на власний рахунок");
    expect(oneSidedEvidence(t, { ...context, proposed: new Set([t.transactionId]) })).toBeNull();
    expect(oneSidedToFlag([t], { ...context, proposed: new Set([t.transactionId]) })).toEqual([]);
  });
});

describe("IMP-03@PoC FR 15: a credit card's line that reads as its repayment", () => {
  it("IMP-03@PoC AC10: «Payment received — thank you» +600,00 EUR on the card is flagged at once with «платіж на картку»", () => {
    const t = single("600.00", TODAY, "Payment received — thank you", CARD);
    expect(isCardPayment(t, context.cards)).toBe(true);
    expect(oneSidedToFlag([t], context)).toEqual([
      { transactionId: t.transactionId, evidence: ["card-payment"] },
    ]);
  });

  it("IMP-03@PoC FR 15: autopay, an online payment, «pagamento de fatura», «Zahlungseingang» are card payments", () => {
    for (const text of ["AUTOPAY", "Онлайн-платіж", "Pagamento de fatura", "Zahlungseingang"])
      expect(isCardPayment(single("100.00", TODAY, text, CARD), context.cards), text).toBe(true);
  });

  it("IMP-03@PoC FR 15: a refund, cashback, interest, a bonus, a reversal or a statement credit is no card payment", () => {
    for (const text of [
      "Payment received refund",
      "Cashback payment received",
      "Interest autopay",
      "Bonus online payment",
      "Сторно автоплатіж",
      "Statement credit — payment received",
    ])
      expect(isCardPayment(single("100.00", TODAY, text, CARD), context.cards), text).toBe(false);
  });

  it("IMP-03@PoC FR 15: only a positive line of a credit card — the same text elsewhere or negative is none", () => {
    expect(isCardPayment(single("100.00", TODAY, "Payment received", CURRENT), context.cards)).toBe(false);
    expect(isCardPayment(single("-100.00", TODAY, "Payment received", CARD), context.cards)).toBe(false);
  });
});
