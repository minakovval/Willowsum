import { exchangeRate, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { transferReceived } from "./transfers.ts";

/**
 * FIN-03@PoC FR 1, FR 28 (issue #437): «Переказ між рахунками» of «Нова транзакція» — what reaches the other account,
 * without I/O. Synthetic amounts and rates.
 */
const eur = (a: string) => Money.of(a, "EUR");
const DATE = "2026-10-14";
/** 1 EUR = 43,5 UAH (official NBU rate of the date, VAL-04 FR 4). */
const EUR_UAH = exchangeRate({ base: "EUR", quote: "UAH", rate: "43.5", date: DATE, source: "NBU" });

describe("FIN-03@PoC FR 28: «Переказ між рахунками» — the credit of a transfer created in one action", () => {
  it("FIN-03@PoC FR 28: in one currency the credit is the amount itself unless the user entered a smaller one (the fee, FR 8)", () => {
    expect(transferReceived(eur("100.00"), "EUR", null, null, DATE)).toEqual(eur("100.00"));
    expect(transferReceived(eur("100.00"), "EUR", eur("98.00"), null, DATE)).toEqual(eur("98.00"));
    expect(transferReceived(eur("100.00"), "EUR", eur("100.01"), null, DATE)).toEqual({
      field: "received",
      issue: "amount_mismatch",
    });
  });

  it("FIN-03@PoC FR 8: in two currencies the credit is the amount at the official rate of the date", () => {
    expect(transferReceived(eur("1000.00"), "UAH", null, EUR_UAH, DATE)).toEqual(Money.of("43500", "UAH"));
    // The actual credit the user entered stays as it is (FR 8: the difference goes through «Валютна різниця»).
    expect(transferReceived(eur("1000.00"), "UAH", Money.of("42900", "UAH"), EUR_UAH, DATE)).toEqual(
      Money.of("42900", "UAH"),
    );
    expect(transferReceived(eur("1000.00"), "UAH", null, null, DATE)).toBe("rate_unavailable");
  });

  it("FIN-03@PoC FR 8: the converted credit is rounded half to even to the currency's minor units (#419)", () => {
    // 0,01 EUR × 0,5 = 0,005 → 0,00 (even), 0,03 × 0,5 = 0,015 → 0,02 (even), never half up.
    const half = exchangeRate({ base: "EUR", quote: "USD", rate: "0.5", date: DATE, source: "NBU" });
    expect(transferReceived(eur("0.03"), "USD", null, half, DATE)).toEqual(Money.of("0.02", "USD"));
    expect(transferReceived(eur("0.05"), "USD", null, half, DATE)).toEqual(Money.of("0.02", "USD"));
    expect(transferReceived(eur("0.07"), "USD", null, half, DATE)).toEqual(Money.of("0.04", "USD"));
    // Too small to reach a minor unit of the credit: a transfer moves money.
    expect(transferReceived(eur("0.01"), "USD", null, half, DATE)).toEqual({
      field: "amount",
      issue: "zero",
    });
  });
});
