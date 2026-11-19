import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { monthlyInterest, simulate, simulateStrategy } from "./payoff.ts";

/** An independent integer model: minor units as BigInt, the rate as hundredths of a percent, half to even. */
function interestMinor(balance: bigint, rateBp: bigint): bigint {
  const den = 120000n;
  const num = balance * rateBp;
  const q = num / den;
  const twice = (num % den) * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) return q + 1n;
  return q;
}
const CURRENCIES = [
  ["EUR", 2],
  ["JPY", 0],
  ["KWD", 3],
] as const;
const toMoney = (minor: bigint, currency: string, scale: number) => {
  const s = minor.toString().padStart(scale + 1, "0");
  return Money.of(scale === 0 ? s : `${s.slice(0, -scale)}.${s.slice(-scale)}`, currency);
};
/** A small deterministic generator (no Math.random: the run is repeatable). */
function lcg(seed: number) {
  let x = BigInt(seed);
  return (n: number) => {
    x = (x * 6364136223846793005n + 1442695040888963407n) % 18446744073709551616n;
    return Number((x >> 33n) % BigInt(n));
  };
}

describe("BUD-19@PoC FR 3 (security): the schedule in whole minor units, half to even", () => {
  it("BUD-19@PoC FR 3: interest above 2^53 minor units is exact — the amount never passes through a JS number", () => {
    // 90 071 992 547 409.93 € × 12 % ÷ 12 = 900 719 925 474.0993 € → …474.10; a double cannot hold these cents.
    expect(monthlyInterest(Money.of("90071992547409.93", "EUR"), "12").toDecimalString()).toBe(
      "900719925474.1",
    );
    // Halves that are exact only in decimal: 8.20 € × 3 % ÷ 12 = 0.0205 → 0.02; 1.10 € × 30 % ÷ 12 = 0.0275 → 0.03.
    expect(monthlyInterest(Money.of("8.2", "EUR"), "3").toDecimalString()).toBe("0.02");
    expect(monthlyInterest(Money.of("1.1", "EUR"), "30").toDecimalString()).toBe("0.03");
  });

  it("BUD-19@PoC FR 3: every month's interest equals the integer model; payments sum to principal + interest; no balance below zero", () => {
    const rnd = lcg(574);
    for (let n = 0; n < 400; n++) {
      const [currency, scale] = CURRENCIES[rnd(CURRENCIES.length)]!;
      // Rates that make exact half units frequent (multiples of 6 % with balances ending in 5 or 50).
      const rateBp = BigInt([600, 1200, 1800, 2400, 1999, 725, 0, 3600][rnd(8)]!);
      const start = BigInt(rnd(200000) * 5 + 5);
      const first = interestMinor(start, rateBp);
      const payment = first + BigInt(rnd(Number(start / 4n) + 1) + 1);
      const rate = `${rateBp / 100n}.${(rateBp % 100n).toString().padStart(2, "0")}`;
      const r = simulate({
        balance: toMoney(start, currency, scale),
        annualRate: rate,
        monthlyPayment: toMoney(payment, currency, scale),
        extraMonthly: Money.zero(currency),
        oneOffs: [],
      });
      // The model.
      let balance = start;
      let interest = 0n;
      let paidSum = 0n;
      const balances: bigint[] = [];
      while (balance > 0n && balances.length < 1200) {
        const i = interestMinor(balance, rateBp);
        expect(
          monthlyInterest(toMoney(balance, currency, scale), rate).equals(toMoney(i, currency, scale)),
        ).toBe(true);
        interest += i;
        const pay = payment < balance + i ? payment : balance + i;
        paidSum += pay;
        balance = balance + i - pay;
        balances.push(balance);
      }
      if (balance > 0n) {
        expect(r.kind).toBe("over-limit");
        continue;
      }
      if (r.kind !== "paid") throw new Error(`case ${n}: ${r.kind}`);
      expect(r.months).toBe(balances.length);
      expect(r.totalInterest.equals(toMoney(interest, currency, scale))).toBe(true);
      expect(r.balances.map((b) => b.toDecimalString())).toEqual(
        balances.map((b) => toMoney(b, currency, scale).toDecimalString()),
      );
      expect(r.balances.every((b) => !b.isNegative())).toBe(true);
      expect(r.balances.at(-1)!.isZero()).toBe(true);
      // Sum of payments = principal + interest, to the minor unit.
      expect(paidSum).toBe(start + interest);
      // No amount finer than the currency's minor unit.
      expect(r.totalInterest.amount.decimalPlaces()).toBeLessThanOrEqual(scale);
    }
  });

  it("BUD-19@PoC FR 6: «Стратегія» of one debt equals the plan of that debt, in EUR, JPY and KWD", () => {
    const rnd = lcg(554);
    for (let n = 0; n < 200; n++) {
      const [currency, scale] = CURRENCIES[rnd(CURRENCIES.length)]!;
      const start = BigInt(rnd(100000) * 5 + 5);
      const rate = ["6", "12", "18", "24", "19.99"][rnd(5)]!;
      const payment = toMoney(start / 10n + BigInt(rnd(1000) + 1) + start / 30n, currency, scale);
      const balance = toMoney(start, currency, scale);
      const one = simulate({
        balance,
        annualRate: rate,
        monthlyPayment: payment,
        extraMonthly: Money.zero(currency),
        oneOffs: [],
      });
      const many = simulateStrategy(
        [{ id: "d", balance, annualRate: rate, minimumPayment: payment }],
        payment,
        "snowball",
      );
      expect(many.kind).toBe(one.kind);
      if (one.kind === "paid" && many.kind === "paid") {
        expect(many.months).toBe(one.months);
        expect(many.totalInterest.equals(one.totalInterest)).toBe(true);
      }
    }
  });
});
