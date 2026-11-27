import { Decimal, Money, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { transferDifference } from "./transfers.ts";

/**
 * FIN-03@PoC FR 8, AC31 (owner, 2026-11-26, decision 11; IMP-03@PoC FR 9, FR 21): what the budget counts of a marked
 * transfer in «Комісії банку», without I/O. Synthetic amounts; the rate is the one a transfer keeps — 1 unit of the
 * credit's currency in the debit's (43,50 UAH per EUR is kept as 1 UAH = 1 ÷ 43,5 EUR at 18 decimals, as fx-rates gives it).
 */
const eur = (a: string) => ({ amount: Money.of(a, "EUR") });
const uah = (a: string) => ({ amount: Money.of(a, "UAH") });
const kept: ExchangeRate = {
  base: "UAH",
  quote: "EUR",
  rate: new Decimal("0.022988505747126437"),
  date: "2026-10-14",
  source: "NBU",
};

describe("FIN-03@PoC FR 8: the difference of a transfer is «Комісії банку» of the budget", () => {
  it("FIN-03@PoC AC31: −100,00 EUR / +4 320,00 UAH at 43,50 — a loss of 30,00 UAH (an expense) on the credit's side", () => {
    const d = transferDifference(eur("-100.00"), uah("4320.00"), kept)!;
    expect(d.side).toBe("inflow");
    expect(d.amount.currency).toBe("UAH");
    expect(d.amount.toDecimalString()).toBe("-30");
  });

  it("FIN-03@PoC AC31: +4 380,00 UAH for the same −100,00 EUR — a gain of 30,00 UAH (an income) in the same category", () => {
    const d = transferDifference(eur("-100.00"), uah("4380.00"), kept)!;
    expect(d.amount.toDecimalString()).toBe("30");
    expect(d.side).toBe("inflow");
  });

  it("FIN-03@PoC FR 8: exactly the official rate — no difference; no kept rate — none", () => {
    expect(transferDifference(eur("-100.00"), uah("4350.00"), kept)).toBeNull();
    expect(transferDifference(eur("-100.00"), uah("4320.00"), null)).toBeNull();
  });

  it("FIN-03@PoC FR 8: in one currency the difference is the fee, on the debit's side", () => {
    expect(transferDifference(eur("-500.00"), eur("498.00"), null)).toEqual({
      amount: Money.of("-2", "EUR"),
      side: "outflow",
    });
    expect(transferDifference(eur("-500.00"), eur("500.00"), null)).toBeNull();
  });

  it("FIN-03@PoC FR 8: the amount at the rate is rounded half to even to the credit currency's minor units", () => {
    // A credit currency without minor units: 1 JPY = 0,0061 EUR.
    const jpy: ExchangeRate = { ...kept, base: "JPY", quote: "EUR", rate: new Decimal("0.0061") };
    const d = transferDifference(eur("-1.00"), { amount: Money.of("160", "JPY") }, jpy)!;
    // 1 ÷ 0,0061 = 163,934… → 164 JPY; 160 − 164 = −4.
    expect(d.amount.toDecimalString()).toBe("-4");
  });
});
