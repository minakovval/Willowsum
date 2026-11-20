import type { Money } from "@willowsum/domain-kernel";
import {
  monthFigures,
  monthFlows,
  periodFlows,
  periodTotals,
  resolve,
  loanDebtDates,
  loanMonths,
  transferFlow,
  type CashflowCategory,
  type CountedLine,
  type FlowLine,
  type Flows,
  type GoalAccountSpan,
  type LoanOperation,
  type Month,
  type MonthFigures,
  type PeriodTotals,
} from "../domain/index.ts";

/**
 * «Грошовий потік» of a period (BUD-08@PoC; wave 2 row 37, server parts a and b): read only, nothing stored or changed.
 * The ports are other modules' public interfaces, wired in adapters/http/services.ts.
 */

/** A transaction of a budget account as module transactions gives it (`BudgetTransactions.inPeriod`). */
export interface CashflowTransaction {
  readonly id: string;
  readonly amount: Money;
  readonly date: string;
  readonly parts:
    readonly { readonly categoryId: string; readonly month: string | null; readonly amount: Money }[] | null;
}

/** One amount at the rate of its date in the report's currency (module fx-rates); null — «Курс недоступний». */
export interface CashflowConverted {
  readonly values: readonly (Money | null)[];
  readonly nearestRateCount: number;
  readonly unavailableCount: number;
}

export interface CashflowReads {
  /** The space's category tree, hidden and merged categories too (module categories). */
  categories(householdId: string): Promise<readonly CashflowCategory[]>;
  /** FR 12: the accounts of the budget. */
  accountIds(householdId: string): Promise<readonly string[]>;
  /** The shown transactions of the accounts from `from` to `to`, without transfers between own accounts (transactions). */
  transactions(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<readonly CashflowTransaction[]>;
  /** The category of each unsplit transaction of `ids`; uncategorized ones are absent (categorization). */
  categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** FR 8: the transactions that are a side of a proposed, not yet confirmed transfer (transfer-matching). */
  pendingTransferSides(householdId: string): Promise<ReadonlySet<string>>;
  /** FR 12: each amount at the rate of its date, the nearest available one «приблизно» (fx-rates). */
  convert(
    amounts: readonly { readonly amount: Money; readonly date: string }[],
    currency: string,
  ): Promise<CashflowConverted>;
}

/** A side of a marked transfer between own accounts (transactions). */
export interface CashflowTransferSide {
  readonly id: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
}

/** A transaction of a loan's account (transactions): sides of a transfer too. */
export interface CashflowLoanOperation extends CashflowTransferSide {
  readonly source: "manual" | "imported";
}

/**
 * An active loan of the space (accounts) with the journal account of its wallet in its currency, the day its balance
 * was entered, and its dated rates (liabilities; `validFrom` null — since the registration; per cent, null — none).
 */
export interface CashflowLoan {
  readonly accountId: string;
  readonly currency: string;
  readonly ledgerAccountId: string;
  readonly openedOn: string;
  /** The date of the wallet's «Оновити залишок» adjustment in effect (FIN-12 FR 15): the journal holds the real debt. */
  readonly adjustedOn?: string | null;
  readonly rates: readonly { readonly validFrom: string | null; readonly annualRate: string | null }[];
}

/** Part b's reads (FR 5–7, FR 10). */
export interface CashflowFlowReads {
  /** FR 6: the space's brokerage (and pension) accounts. */
  investmentAccountIds(householdId: string): Promise<ReadonlySet<string>>;
  /** FR 5, FR 6: the marked transfers whose outflow is dated in the dates (transactions). */
  transfers(
    householdId: string,
    from: string,
    to: string,
  ): Promise<readonly { readonly outflow: CashflowTransferSide; readonly inflow: CashflowTransferSide }[]>;
  /** FR 5: the own accounts of goals, closed goals' too (goals). */
  goalAccounts(householdId: string): Promise<readonly GoalAccountSpan[]>;
  /** FR 5: the «Внести» marks in the dates, in each goal's currency (goals). */
  goalMarks(
    householdId: string,
    from: string,
    to: string,
  ): Promise<readonly { readonly goalId: string; readonly amount: Money; readonly date: string }[]>;
  /** FR 10: what of these transactions is spent from a goal, in the goal's currency (goals). */
  goalSpends(householdId: string, transactionIds: readonly string[]): Promise<ReadonlyMap<string, Money>>;
  /** FR 7: the space's active loans (accounts). */
  loans(householdId: string): Promise<readonly CashflowLoan[]>;
  /** FR 7: the operations of the loans' accounts in the dates, oldest first (transactions). */
  loanOperations(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
  ): Promise<readonly CashflowLoanOperation[]>;
  /** FR 7: what the loan's wallet owes at the end of each date, in one read (ledger). */
  debtsAt(householdId: string, ledgerAccountId: string, dates: readonly string[]): Promise<readonly Money[]>;
}

export interface CashflowDeps {
  readonly reads: CashflowReads & CashflowFlowReads;
  /** The space's reporting currency (FR 12: the report's currency). */
  readonly currency: string;
  /** «Сьогодні», YYYY-MM-DD. */
  readonly today: () => string;
}

export interface CashflowReport {
  readonly currency: string;
  readonly months: readonly MonthFigures[];
  readonly totals: PeriodTotals;
  /** FR 2, FR 4–7, FR 10: where each month's net flow went, and the period's. */
  readonly monthFlows: readonly Flows[];
  readonly periodFlows: Flows;
  /** Edge case 2: the loans whose payments in the period were not split for want of a rate («внести ставку»). */
  readonly loansWithoutRate: readonly string[];
  /** FR 8, edge case 3: the one-sided operations awaiting their pair, left out of income and spending. */
  readonly unpairedTransfers: number;
  /** FR 12, edge case 4. */
  readonly nearestRateCount: number;
  readonly unavailableCount: number;
  /** «Немає транзакцій рахунків бюджету за цей період». */
  readonly empty: boolean;
}

const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The amounts of one loan month (FR 7): the interest as spending, the principal as «Погашення боргу». */
interface LoanAmounts {
  readonly spending: { categoryId: string | null; amount: Money; date: string }[];
  readonly principal: { amount: Money; date: string }[];
  readonly withoutRate: Set<string>;
}

/** FR 7: the rate in effect on a date — the last period starting on or before it (FIN-12@PoC AC10). */
function rateOn(rates: CashflowLoan["rates"], date: string): string | null {
  let found: string | null = null;
  for (const r of rates) if (r.validFrom === null || r.validFrom <= date) found = r.annualRate;
  return found;
}

/**
 * FR 7, AC7, edge case 2: each active loan's payments — inflows on its account in its currency, a confirmed transfer or
 * an operation entered or imported, not a side of a proposed pair still awaiting confirmation — split into the interest
 * (spending in «Відсотки за кредитами») and the principal, month by month from the loan's opening, so the interest of
 * earlier months is in the debt (`loanMonths`); only the period's months are returned. A month with the bank's own
 * interest operation (imported in «Відсотки за кредитами») is not calculated: that operation is the month's interest
 * spending and every payment lowers the debt. Reads: the loans with their rates, one read of the operations, and one
 * journal read per loan.
 */
async function loanAmounts(
  reads: CashflowFlowReads & Pick<CashflowReads, "categoriesOf">,
  householdId: string,
  from: string,
  to: string,
  pending: () => Promise<ReadonlySet<string>>,
  categories: ReadonlyMap<string, CashflowCategory>,
): Promise<LoanAmounts> {
  const result: LoanAmounts = { spending: [], principal: [], withoutRate: new Set() };
  const loans = await reads.loans(householdId);
  if (loans.length === 0) return result;
  const since = loans.reduce((d, l) => (l.openedOn < d ? l.openedOn : d), from);
  const operations = await reads.loanOperations(
    householdId,
    loans.map((l) => l.accountId),
    since,
    to,
  );
  if (operations.length === 0) return result;
  const awaiting = await pending();
  const own = await reads.categoriesOf(
    householdId,
    operations.map((o) => o.id),
  );
  const interestCategory =
    [...categories.values()].find((c) => c.systemKey === "loan-interest" && c.state !== "retired") ?? null;
  const isInterest = (id: string | undefined) =>
    resolve(categories, id ?? null)?.systemKey === "loan-interest";
  const inPeriod = (date: string) => date >= from && date <= to;
  for (const loan of loans) {
    const ops: LoanOperation[] = operations
      .filter((o) => o.accountId === loan.accountId && o.amount.currency === loan.currency)
      .map((o) => {
        const bankInterest = o.source === "imported" && isInterest(own.get(o.id));
        return {
          id: o.id,
          date: o.date,
          amount: o.amount,
          bankInterest,
          payment: !bankInterest && !o.amount.isNegative() && !o.amount.isZero() && !awaiting.has(o.id),
        };
      });
    if (ops.length === 0) continue;
    const rate = (date: string) => rateOn(loan.rates, date);
    const dates = loanDebtDates(ops, rate);
    const debts = await reads.debtsAt(householdId, loan.ledgerAccountId, dates.map(dayBefore));
    const journal = new Map(dates.map((d, k) => [d, debts[k]!] as const));
    for (const m of loanMonths(ops, rate, journal, loan.adjustedOn ?? null)) {
      if (!inPeriod(`${m.month}-01`)) continue;
      for (const o of m.bankInterest)
        result.spending.push({ categoryId: own.get(o.id) ?? null, amount: o.amount, date: o.date });
      if (m.withoutRate) result.withoutRate.add(loan.accountId);
      for (const split of m.splits) {
        if (!split.interest.isZero())
          result.spending.push({
            categoryId: interestCategory?.id ?? null,
            amount: split.interest.negated(),
            date: split.date,
          });
        result.principal.push({ amount: split.principal, date: split.date });
      }
    }
  }
  return result;
}

const lastDay = (m: Month): string => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

export async function cashflowReport(
  deps: CashflowDeps,
  householdId: string,
  months: readonly Month[],
): Promise<CashflowReport> {
  const { reads, currency } = deps;
  const from = `${months[0]!}-01`;
  const to = lastDay(months[months.length - 1]!);
  const accountIds = await reads.accountIds(householdId);
  // FR 13: a transaction counts on its date of payment only — a share «На кілька місяців» of another date is not here.
  const rows = (await reads.transactions(householdId, accountIds, from, to)).filter(
    (r) => r.date >= from && r.date <= to,
  );
  let pendingSides: Promise<ReadonlySet<string>> | null = null;
  const pending = () => (pendingSides ??= reads.pendingTransferSides(householdId));
  const awaiting = rows.length === 0 ? new Set<string>() : await pending();
  const counted = rows.filter((r) => !awaiting.has(r.id));
  const own = await reads.categoriesOf(
    householdId,
    counted.filter((r) => r.parts === null).map((r) => r.id),
  );
  const lines: { categoryId: string | null; amount: Money; date: string }[] = [];
  for (const r of counted) {
    if (r.parts === null) lines.push({ categoryId: own.get(r.id) ?? null, amount: r.amount, date: r.date });
    else if (r.parts.some((p) => p.month !== null))
      // FR 13: split over months — one record, the whole amount in the month of payment, in its one category.
      lines.push({ categoryId: r.parts[0]?.categoryId ?? null, amount: r.amount, date: r.date });
    // FR 13: split by categories — counted by its parts.
    else for (const p of r.parts) lines.push({ categoryId: p.categoryId, amount: p.amount, date: r.date });
  }
  const categories = new Map((await reads.categories(householdId)).map((c) => [c.id, c]));

  // FR 7: the interest of loan payments is spending; their principal is «Погашення боргу».
  const loans = await loanAmounts(reads, householdId, from, to, pending, categories);
  lines.push(...loans.spending);
  const flows: { kind: FlowLine["kind"]; goalId: string | null; amount: Money; date: string }[] =
    loans.principal.map((p) => ({ kind: "debt", goalId: null, amount: p.amount, date: p.date }));
  // FR 5, FR 6: transfers out of a budget account into a goal's own account or a brokerage one, and back.
  const transfers = await reads.transfers(householdId, from, to);
  if (transfers.length > 0) {
    const budget = new Set(accountIds);
    const investment = await reads.investmentAccountIds(householdId);
    const goalAccounts = await reads.goalAccounts(householdId);
    for (const t of transfers) {
      const flow = transferFlow(
        { fromAccountId: t.outflow.accountId, toAccountId: t.inflow.accountId, date: t.outflow.date },
        budget,
        investment,
        goalAccounts,
      );
      if (flow)
        flows.push({
          kind: flow.kind,
          goalId: flow.kind === "goal" ? flow.goalId : null,
          // A contribution is what left the budget account; a withdrawal what came back to it.
          amount: flow.kind === "withdrawal" ? t.inflow.amount : t.outflow.amount.negated(),
          date: flow.kind === "withdrawal" ? t.inflow.date : t.outflow.date,
        });
    }
  }
  // FR 5: the «Внести» marks of envelopes and mark-only goals.
  for (const m of await reads.goalMarks(householdId, from, to))
    flows.push({ kind: "goal", goalId: m.goalId, amount: m.amount, date: m.date });
  // FR 10, AC2: the counted spending paid from goals — the layer «з цілей».
  if (counted.length > 0) {
    const spent = await reads.goalSpends(
      householdId,
      counted.map((r) => r.id),
    );
    for (const r of counted) {
      const amount = spent.get(r.id);
      if (amount) flows.push({ kind: "from-goals", goalId: null, amount, date: r.date });
    }
  }

  const converted = await reads.convert(
    [...lines, ...flows].map((l) => ({ amount: l.amount, date: l.date })),
    currency,
  );
  const inCurrency: CountedLine[] = [];
  lines.forEach((l, i) => {
    const value = converted.values[i];
    if (value) inCurrency.push({ month: l.date.slice(0, 7), categoryId: l.categoryId, amount: value });
  });
  const flowLines: FlowLine[] = [];
  flows.forEach((f, i) => {
    const value = converted.values[lines.length + i];
    if (value) flowLines.push({ month: f.date.slice(0, 7), kind: f.kind, goalId: f.goalId, amount: value });
  });
  const figures = monthFigures(months, inCurrency, categories, currency);
  const totals = periodTotals(figures, currency);
  return {
    currency,
    months: figures,
    totals,
    monthFlows: monthFlows(figures, flowLines, currency),
    periodFlows: periodFlows(totals, months, flowLines, currency),
    loansWithoutRate: [...loans.withoutRate],
    unpairedTransfers: rows.length - counted.length,
    nearestRateCount: converted.nearestRateCount,
    unavailableCount: converted.unavailableCount,
    empty: rows.length === 0,
  };
}
