import { Decimal, Money, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { transferDifference, transferReceived } from "./transfers.ts";

/**
 * Security review of PR #728 (FIN-03@PoC FR 8, AC31; money): the difference a marked transfer adds to the budget is
 * exact decimal arithmetic — the sign, the rounding rule, the side, no float, never a throw. Synthetic amounts.
 */
const rate = (base: string, quote: string, value: string): ExchangeRate => ({
  base,
  quote,
  rate: new Decimal(value),
  date: "2026-10-14",
  source: "NBU",
});
const side = (amount: string, currency: string) => ({ amount: Money.of(amount, currency) });

describe("FIN-03@PoC FR 8: the transfer's difference is exact (security review #728)", () => {
  it("FIN-03@PoC FR 8: a tie at the credit currency's minor unit rounds half to even — 2,5 JPY is 2, 3,5 JPY is 4", () => {
    // 1 JPY = 0,4 EUR: 1,00 EUR is 2,5 JPY, 1,40 EUR is 3,5 JPY.
    const kept = rate("JPY", "EUR", "0.4");
    expect(transferDifference(side("-1.00", "EUR"), side("2", "JPY"), kept)).toBeNull();
    expect(transferDifference(side("-1.40", "EUR"), side("4", "JPY"), kept)).toBeNull();
    expect(transferDifference(side("-1.00", "EUR"), side("3", "JPY"), kept)?.amount.toDecimalString()).toBe(
      "1",
    );
    expect(transferDifference(side("-1.40", "EUR"), side("3", "JPY"), kept)?.amount.toDecimalString()).toBe(
      "-1",
    );
  });

  it("FIN-03@PoC FR 8: fifteen integer digits keep every cent — no float on the way", () => {
    const kept = rate("UAH", "EUR", "0.022988505747126437");
    const out = "-123456789012345.67";
    // The kept rate is the 18-decimal reciprocal of the official 43,5: the credit is measured against 43,5 itself.
    const atRate = new Decimal("123456789012345.67")
      .times("43.5")
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const received = atRate.minus("0.01");
    const d = transferDifference(side(out, "EUR"), side(received.toFixed(), "UAH"), kept)!;
    expect(d.amount.toDecimalString()).toBe("-0.01");
    expect(d.amount.currency).toBe("UAH");
    expect(d.side).toBe("inflow");
  });

  it("FIN-03@PoC FR 8: the loss is negative and the gain positive whatever the direction of the rate", () => {
    // UAH out, EUR in: 1 EUR = 43,5 UAH is kept. 4 350,00 UAH is 100,00 EUR.
    const kept = rate("EUR", "UAH", "43.5");
    expect(transferDifference(side("-4350.00", "UAH"), side("99.00", "EUR"), kept)).toEqual({
      amount: Money.of("-1", "EUR"),
      side: "inflow",
    });
    expect(transferDifference(side("-4350.00", "UAH"), side("101.00", "EUR"), kept)).toEqual({
      amount: Money.of("1", "EUR"),
      side: "inflow",
    });
  });

  it("FIN-03@PoC FR 8: a zero rate or an amount at the rate past a stored amount gives no difference, never a throw", () => {
    expect(transferDifference(side("-1.00", "EUR"), side("1.00", "UAH"), rate("UAH", "EUR", "0"))).toBeNull();
    expect(
      transferDifference(
        side("-99999999999999999999.00", "EUR"),
        side("1.00", "UAH"),
        rate("UAH", "EUR", "0.000000000000000001"),
      ),
    ).toBeNull();
  });

  // Review of #728: the forward rate rounds 4 350,435 to 4 350,44, the kept opposite rate to 4 350,43 — no difference.
  it("FIN-03@PoC FR 8: a credit the server itself counted at the official rate of the date shows no difference (EUR to UAH at 43,50, 100,01 EUR)", () => {
    // «Переказ між рахунками» without «Отримано»: the credit is the debit at the forward rate, half to even.
    const forward = rate("EUR", "UAH", "43.5");
    const received = transferReceived(Money.of("100.01", "EUR"), "UAH", null, forward, "2026-10-14") as Money;
    expect(received.toDecimalString()).toBe("4350.44");
    // The transfer keeps the opposite rate, 1 UAH = 1 ÷ 43,5 EUR at 18 decimals (fx-rates).
    const kept = rate("UAH", "EUR", "0.022988505747126437");
    expect(transferDifference(side("-100.01", "EUR"), { amount: received }, kept)).toBeNull();
  });
  // Confirmation of #728: at a half-cent tie the kept reciprocal rounds the other way than the official rate.
  it("FIN-03@PoC FR 8: one cent off the official conversion at a half-cent tie is one cent (1,01 EUR at 43,50 is 43,935 → 43,94 UAH)", () => {
    const kept = rate("UAH", "EUR", "0.022988505747126437");
    expect(
      transferDifference(side("-1.01", "EUR"), side("43.95", "UAH"), kept)?.amount.toDecimalString(),
    ).toBe("0.01");
    expect(
      transferDifference(side("-1.01", "EUR"), side("43.93", "UAH"), kept)?.amount.toDecimalString(),
    ).toBe("-0.01");
    expect(transferDifference(side("-1.01", "EUR"), side("43.94", "UAH"), kept)).toBeNull();
  });

  it("FIN-03@PoC FR 8: the kept rate is the official one (UAH out at 1 EUR = 43,5 UAH) — measured at it directly", () => {
    const kept = rate("EUR", "UAH", "43.5");
    // 43,93 UAH ÷ 43,5 = 1,0099… → 1,01 EUR.
    expect(transferDifference(side("-43.93", "UAH"), side("1.01", "EUR"), kept)).toBeNull();
    expect(
      transferDifference(side("-43.93", "UAH"), side("1.00", "EUR"), kept)?.amount.toDecimalString(),
    ).toBe("-0.01");
  });
  it("FIN-03@PoC FR 8: a short kept rate is not swapped for its 15-digit reciprocal — 999 999 999 999 999,00 UAH at 43,5 is 22 988 505 747 126,41 EUR", () => {
    const kept = rate("EUR", "UAH", "43.5");
    const out = side("-999999999999999.00", "UAH");
    // × 0,0229885057471264 (1 ÷ 43,5 at 15 digits) would give 22 988 505 747 126,38: three cents short, a real loss.
    expect(transferDifference(out, side("22988505747126.41", "EUR"), kept)).toBeNull();
    expect(transferDifference(out, side("22988505747126.38", "EUR"), kept)?.amount.toDecimalString()).toBe(
      "-0.03",
    );
  });
});
