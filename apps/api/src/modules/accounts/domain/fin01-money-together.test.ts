import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, inMoneyTogether, netByCurrency, wholePercents } from "./index.ts";

/** FIN-01@PoC FR 18 on the pure rules of «Гроші разом»: what is summed, per currency, and the legend's shares. */

const d = (value: string) => new Decimal(value);

describe("FIN-01@PoC FR 18: «Гроші разом» — cash accounts minus the credit cards' debt, without loans", () => {
  it("FIN-01@PoC FR 18: every cash kind and the credit card count; a loan («Кредит») never does", () => {
    const counted = ACCOUNT_KINDS.filter(inMoneyTogether);
    expect(counted).toEqual(["current", "savings", "deposit", "cash", "credit-card"]);
    expect(inMoneyTogether("loan")).toBe(false);
  });

  it("FIN-01@PoC FR 18: the breakdown sums each currency exactly in Decimal (a card's debt is negative)", () => {
    const net = netByCurrency([
      Money.of("11400.00", "EUR"),
      Money.of("829680.00", "UAH"),
      Money.of("0.1", "EUR"),
      Money.of("0.2", "EUR"),
      Money.of("-1200.00", "EUR"),
    ]);
    expect(net.map((m) => m.toJSON())).toEqual([
      { amount: "10200.3", currency: "EUR" },
      { amount: "829680", currency: "UAH" },
    ]);
  });
});

describe("FIN-01@PoC FR 18: the legend's shares are whole percents that add up to 100", () => {
  it("FIN-01@PoC AC12: 18 880,00 € and 11 400,00 € of 30 280,00 € are 62 % and 38 %", () => {
    expect(wholePercents([d("18880.002"), d("11400")])).toEqual([62, 38]);
  });

  it("FIN-01@PoC FR 18: the largest remainders take the rounding, so three equal parts give 34 + 33 + 33", () => {
    expect(wholePercents([d("1"), d("1"), d("1")])).toEqual([34, 33, 33]);
    expect(wholePercents([d("1"), d("1"), d("1")]).reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(100);
  });

  it("FIN-01@PoC FR 18: a currency without a rate or with a net debt has no segment; the others still add up to 100", () => {
    expect(wholePercents([d("300"), null, d("-50"), d("0"), d("100")])).toEqual([75, null, null, null, 25]);
  });

  it("FIN-01@PoC FR 18: no positive amount at all gives no shares", () => {
    expect(wholePercents([])).toEqual([]);
    expect(wholePercents([d("-1"), null])).toEqual([null, null]);
  });
});
