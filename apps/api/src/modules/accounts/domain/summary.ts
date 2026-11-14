import { Decimal, type Money } from "@willowsum/domain-kernel";
import type { AccountKind } from "./accounts.ts";

/**
 * «Гроші разом» (FIN-01@PoC FR 18): the cash accounts minus the credit cards' debt, in the profile currency. A loan
 * («Кредит») never counts: its debt is shown only in the «Кредитні» header as «Кредити: −<сума>» (FR 19, AC18).
 */
export function inMoneyTogether(kind: AccountKind): boolean {
  return kind !== "loan";
}

/**
 * The breakdown by currency: the exact sum of each currency's balances (shown from the holder's side, so a card's
 * debt is negative), in the order the currencies first appear. Never rounded.
 */
export function netByCurrency(balances: readonly Money[]): Money[] {
  const sums = new Map<string, Money>();
  for (const balance of balances) {
    const sum = sums.get(balance.currency);
    sums.set(balance.currency, sum ? sum.plus(balance) : balance);
  }
  return [...sums.values()];
}

const HUNDRED = new Decimal("100");

/**
 * The legend's share of each currency (FR 18, AC12) as whole percents of the positive equivalents, adding up to 100
 * (largest remainder; a tie goes to the earlier one). A currency without a rate (null) or whose net is not positive
 * (a card's debt above its cash) has no segment and no share (lead decision 2026-11-14). Percents are not money:
 * computed from exact Decimals, rounded only here, for display.
 */
export function wholePercents(values: readonly (Decimal | null)[]): (number | null)[] {
  const positive = values.map((v) => (v !== null && v.gt(0) ? v : null));
  const sum = positive.reduce<Decimal>((acc, v) => (v ? acc.plus(v) : acc), new Decimal("0"));
  if (sum.isZero()) return values.map(() => null);
  const exact = positive.map((v) => (v ? v.times(HUNDRED).div(sum) : null));
  const floors = exact.map((v) => (v ? v.floor() : null));
  let left = HUNDRED.minus(floors.reduce<Decimal>((acc, v) => (v ? acc.plus(v) : acc), new Decimal("0")));
  const order = exact
    .map((v, i) => ({ i, rest: v ? v.minus(v.floor()) : null }))
    .filter((x): x is { i: number; rest: Decimal } => x.rest !== null)
    .sort((a, b) => b.rest.comparedTo(a.rest) || a.i - b.i);
  const whole = [...floors];
  for (const { i } of order) {
    if (left.lte(0)) break;
    whole[i] = whole[i]!.plus("1");
    left = left.minus("1");
  }
  // A whole number 0–100, written as an integer (never a float of an amount).
  const result = whole.map((v) => (v ? Number.parseInt(v.toFixed(0), 10) : null));
  return result;
}
