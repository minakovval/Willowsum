import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  chosenIssues,
  counterpartOf,
  counterpartRateRequest,
  type ChosenTransaction,
  type CounterpartTransaction,
} from "./counterparts.ts";

/** IMP-03@PoC FR 24 «Позначити як переказ»: what each candidate row shows once chosen — no I/O, synthetic data. */
const CURRENT = "11111111-1111-4111-8111-111111111111";
const SAVINGS = "22222222-2222-4222-8222-222222222222";
const UAH = "33333333-3333-4333-8333-333333333333";

const chosen = (
  amount: string,
  currency = "EUR",
  extra: Partial<ChosenTransaction> = {},
): ChosenTransaction => ({
  transactionId: "t-chosen",
  accountId: CURRENT,
  amount: Money.of(amount, currency),
  date: "2026-10-10",
  status: "posted",
  hidden: false,
  split: false,
  inTransfer: false,
  ...extra,
});

const candidate = (amount: string, currency = "EUR", date = "2026-10-12"): CounterpartTransaction => ({
  transactionId: "t-other",
  accountId: currency === "EUR" ? SAVINGS : UAH,
  amount: Money.of(amount, currency),
  date,
  counterparty: "Синтетичний переказ",
  description: null,
});

describe("IMP-03@PoC FR 24: the candidates of «Позначити як переказ»", () => {
  it("IMP-03@PoC FR 24: −200,00 EUR with +199,00 EUR — the difference 1,00 € becomes the fee «Комісії банку», and the pair can be made", () => {
    const c = counterpartOf(chosen("-200.00"), candidate("199.00"), null);
    expect(c).toMatchObject({ kind: "same-currency", markable: true });
    expect(c.difference?.toJSON()).toEqual({ amount: "-1", currency: "EUR" });
    expect(c.outflow.transactionId).toBe("t-chosen");
    expect(c.inflow.transactionId).toBe("t-other");
  });

  it("IMP-03@PoC FR 24: chosen on the credit side the debit is the candidate; a credit above the debit is not markable (the search never lists one)", () => {
    const c = counterpartOf(chosen("2050.00"), candidate("-2000.00"), null);
    expect(c.outflow.transactionId).toBe("t-other");
    expect(c).toMatchObject({ kind: "same-currency", markable: false });
    expect(c.difference?.toJSON()).toEqual({ amount: "50", currency: "EUR" });
  });

  it("IMP-03@PoC FR 24, FR 21: in another currency — the pair's rate next to the reference one and the difference against it", () => {
    const pick = chosen("-2000.00");
    const other = candidate("80000.00", "UAH", "2026-10-11");
    expect(counterpartRateRequest(pick, other)).toEqual({ from: "EUR", to: "UAH", date: "2026-10-10" });
    const rate = { base: "EUR", quote: "UAH", rate: new Decimal("41"), date: "2026-10-10", source: "nbu" };
    const c = counterpartOf(pick, other, rate);
    expect(c.kind).toBe("cross-currency");
    if (c.kind !== "cross-currency") return;
    expect(c.bankRate.toFixed()).toBe("40");
    expect(c.converted?.toJSON()).toEqual({ amount: "82000", currency: "UAH" });
    expect(c.difference?.amount.toFixed(2)).toBe("-2000.00");
    expect(c.markable).toBe(true);
  });

  it("IMP-03@PoC FR 24: in another currency without a known rate — still a candidate, no difference shown, not markable (`rate_unavailable`)", () => {
    const c = counterpartOf(chosen("-2000.00"), candidate("80000.00", "UAH"), null);
    expect(c).toMatchObject({
      kind: "cross-currency",
      rate: null,
      converted: null,
      difference: null,
      markable: false,
    });
  });

  it("IMP-03@PoC FR 24, FR 21: a rate of another pair of currencies is never used for the difference", () => {
    const wrong = {
      base: "UAH",
      quote: "EUR",
      rate: new Decimal("0.025"),
      date: "2026-10-10",
      source: "nbu",
    };
    const c = counterpartOf(chosen("-2000.00"), candidate("80000.00", "UAH"), wrong);
    expect(c).toMatchObject({
      kind: "cross-currency",
      rate: null,
      converted: null,
      difference: null,
      markable: false,
    });
  });

  it("IMP-03@PoC FR 24: a transaction that is pending, hidden, split, already in a transfer or zero has no candidates", () => {
    expect(chosenIssues(chosen("-75.00"))).toEqual([]);
    expect(
      chosenIssues(chosen("0.00", "EUR", { status: "pending", hidden: true, split: true, inTransfer: true })),
    ).toEqual(["pending", "hidden", "split", "in_transfer", "zero"]);
  });
});
