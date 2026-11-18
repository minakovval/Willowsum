import { Decimal, Money } from "@willowsum/domain-kernel";
import type { Debt, PlanBody, ScenarioBody } from "./api.ts";

/**
 * BUD-19@PoC FR 2, FR 4, FR 5: the assumptions of a scenario as the user types them. Interest, the payoff month and
 * every schedule are the server's (FR 3): this file only decides what to ask and checks what was typed. Amounts are
 * decimal strings, never numbers (AGENTS.md «Money»).
 */
export interface OneOff {
  readonly id: number;
  readonly month: string;
  readonly amount: string | null;
}

export interface Assumptions {
  readonly balance: string | null;
  /** The text of the rate field, as typed. */
  readonly rate: string;
  readonly payment: string | null;
  readonly extra: string | null;
  readonly oneOffs: readonly OneOff[];
  readonly addPlanned: boolean;
}

const RATE = /^(\d{1,3})(?:[.,](\d{1,4}))?$/;

/** The rate as the API takes it («7,5» → «7.5»), or null when it is not a number from 0 to 100. */
export function parseRate(text: string): string | null {
  const m = RATE.exec(text.trim());
  if (!m) return null;
  const value = `${m[1]}${m[2] ? `.${m[2]}` : ""}`;
  return new Decimal(value).lte(100) ? value : null;
}

/** The text a rate shows in its field: a comma in Ukrainian («9,9»). */
export const rateText = (rate: string | null, comma: boolean): string =>
  rate === null ? "" : comma ? rate.replace(".", ",") : rate;

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  a != null && b != null && new Decimal(a).equals(b);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (value: string): boolean => MONTH.test(value);

/** The fields start from the saved plan when there is one, otherwise from the debt's own terms (FR 2). */
export function initialAssumptions(debt: Debt, comma: boolean): Assumptions {
  const plan = debt.plan;
  if (plan)
    return {
      balance: plan.balance.amount,
      rate: rateText(plan.annualRate, comma),
      payment: plan.monthlyPayment.amount,
      extra: plan.extraMonthly.amount,
      oneOffs: plan.oneOffs.map((o, id) => ({ id, month: `${o.month}-01`, amount: o.amount.amount })),
      addPlanned: plan.addToPlannedExpenses,
    };
  return {
    balance: debt.balance.amount,
    rate: rateText(debt.annualRate, comma),
    payment: debt.monthlyPayment?.amount ?? null,
    extra: null,
    oneOffs: [],
    addPlanned: false,
  };
}

/**
 * What to send for the scenario: only the values that differ from the debt are overrides (FR 2). `null` — the rate
 * or the payment is still missing (AC5) or the balance is empty: nothing is asked, the debt asks for them.
 */
export function scenarioBody(debt: Debt, a: Assumptions): ScenarioBody | null {
  const rate = parseRate(a.rate);
  if (rate === null || a.payment === null || a.balance === null) return null;
  if (!new Decimal(a.payment).gt(0)) return null;
  const body: ScenarioBody = {};
  if (!same(a.balance, debt.balance.amount)) body.balance = a.balance;
  if (!same(rate, debt.annualRate)) body.annualRate = rate;
  if (!same(a.payment, debt.monthlyPayment?.amount)) body.monthlyPayment = a.payment;
  if (a.extra !== null && new Decimal(a.extra).gt(0)) body.extraMonthly = a.extra;
  // The date field gives YYYY-MM-DD; the API takes the month.
  const oneOffs = a.oneOffs.flatMap((o) =>
    isMonth(o.month.slice(0, 7)) && o.amount !== null && new Decimal(o.amount).gt(0)
      ? [{ month: o.month.slice(0, 7), amount: o.amount }]
      : [],
  );
  if (oneOffs.length > 0) body.oneOffs = oneOffs;
  return body;
}

export const planBody = (body: ScenarioBody, addPlanned: boolean): PlanBody => ({
  ...body,
  addToPlannedExpenses: addPlanned,
});

/** One month of the chart's text alternative: the balance of each calculation, `null` where it has none. */
export interface MonthRow {
  readonly month: string;
  readonly base: string | null;
  readonly scenario: string | null;
}

export type Point = { month: string; balance: { amount: string } };

/** The table that stands for the line chart (FR 10): the months of both schedules, in order. */
export function monthRows(base: readonly Point[], scenario: readonly Point[]): MonthRow[] {
  const months = [...new Set([...base, ...scenario].map((p) => p.month))].sort();
  const baseBy = new Map(base.map((p) => [p.month, p.balance.amount]));
  const scenarioBy = new Map(scenario.map((p) => [p.month, p.balance.amount]));
  return months.map((month) => ({
    month,
    base: baseBy.get(month) ?? null,
    scenario: scenarioBy.get(month) ?? null,
  }));
}

export const maxBalance = (...schedules: readonly (readonly Point[])[]): string =>
  schedules
    .flat()
    .reduce(
      (m, p) => (new Decimal(p.balance.amount).gt(m) ? new Decimal(p.balance.amount) : m),
      new Decimal("0"),
    )
    .toFixed();

/**
 * The SVG path of one schedule on a `width` × `height` chart (strings of whole pixels): the month's place along the
 * axis and the balance's share of the largest balance up the other. Drawing only — no amount is read back from it.
 */
export function linePath(
  points: readonly Point[],
  months: readonly string[],
  max: string,
  { width, height, pad }: { width: string; height: string; pad: string },
): string {
  const top = new Decimal(max);
  const run = new Decimal(width).minus(new Decimal(pad).times("2"));
  const rise = new Decimal(height).minus(new Decimal(pad).times("2"));
  const steps = new Decimal(Math.max(months.length - 1, 1).toString());
  const index = new Map(months.map((m, i) => [m, i.toString()]));
  return points
    .map((p, i) => {
      const x = new Decimal(pad).plus(run.times(index.get(p.month) ?? "0").div(steps));
      const part = top.isZero() ? new Decimal("0") : new Decimal(p.balance.amount).div(top);
      const y = new Decimal(height).minus(pad).minus(rise.times(part));
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** What the user typed on «Стратегія» for one debt that has no payment or rate of its own (a card has none). */
export interface Entry {
  readonly min: string | null;
  readonly rate: string;
}
export type Entries = Readonly<Record<string, Entry>>;

/** A saved plan's payment and rate prefill the entries of a debt that lacks them. */
export function initialEntries(debts: readonly Debt[], comma: boolean): Entries {
  return Object.fromEntries(
    debts.map((d) => [
      d.accountId,
      { min: d.plan?.monthlyPayment.amount ?? null, rate: rateText(d.plan?.annualRate ?? null, comma) },
    ]),
  );
}

/** The payment and the rate the calculation would use: the debt's own, else what was entered. */
export function termsOf(
  debt: Debt,
  entry: Entry | undefined,
): { payment: string | null; rate: string | null } {
  const payment = debt.monthlyPayment?.amount ?? entry?.min ?? null;
  return {
    payment: payment !== null && new Decimal(payment).gt(0) ? payment : null,
    rate: debt.annualRate ?? (entry ? parseRate(entry.rate) : null),
  };
}

const takesPart = (d: Debt, entries: Entries): boolean => {
  const t = termsOf(d, entries[d.accountId]);
  return t.payment !== null && t.rate !== null;
};

/**
 * «Усього на борги / міс.» by default: the minimum payments of the debts that take part, in one currency (the
 * one-currency guard of #545: `Money` refuses to add two currencies, and the debts are filtered by currency first).
 */
export function minimumTotal(debts: readonly Debt[], currency: string, entries: Entries): Money {
  return debts
    .filter((d) => d.balance.currency === currency && takesPart(d, entries))
    .reduce(
      (sum, d) => sum.plus(Money.of(termsOf(d, entries[d.accountId]).payment!, currency)),
      Money.zero(currency),
    );
}

/** The currencies of the debts that take part in the strategy, the first debt's currency first. */
export function strategyCurrencies(debts: readonly Debt[], entries: Entries): string[] {
  return [...new Set(debts.filter((d) => takesPart(d, entries)).map((d) => d.balance.currency))];
}

/** `debts[]` of the request: the minimum payment and the rate entered for the debts that lack them (decimal strings). */
export function strategyDebts(
  debts: readonly Debt[],
  entries: Entries,
  currency: string,
): { accountId: string; minimumPayment?: string; annualRate?: string }[] {
  return debts
    .filter((d) => d.balance.currency === currency)
    .flatMap((d) => {
      const e = entries[d.accountId];
      const t = termsOf(d, e);
      const item: { accountId: string; minimumPayment?: string; annualRate?: string } = {
        accountId: d.accountId,
      };
      if (d.monthlyPayment === null && t.payment !== null) item.minimumPayment = t.payment;
      if (d.annualRate === null && t.rate !== null) item.annualRate = t.rate;
      return item.minimumPayment !== undefined || item.annualRate !== undefined ? [item] : [];
    });
}
