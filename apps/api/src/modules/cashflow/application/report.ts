import type { Money } from "@willowsum/domain-kernel";
import {
  monthFigures,
  periodTotals,
  type CashflowCategory,
  type CountedLine,
  type Month,
  type MonthFigures,
  type PeriodTotals,
} from "../domain/index.ts";

/**
 * «Грошовий потік» of a period (BUD-08@PoC; wave 2 row 37, server part a): read only, nothing stored or changed. The
 * ports are other modules' public interfaces, wired in adapters/http/services.ts.
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

export interface CashflowDeps {
  readonly reads: CashflowReads;
  /** The space's reporting currency (FR 12: the report's currency). */
  readonly currency: string;
  /** «Сьогодні», YYYY-MM-DD. */
  readonly today: () => string;
}

export interface CashflowReport {
  readonly currency: string;
  readonly months: readonly MonthFigures[];
  readonly totals: PeriodTotals;
  /** FR 8, edge case 3: the one-sided operations awaiting their pair, left out of income and spending. */
  readonly unpairedTransfers: number;
  /** FR 12, edge case 4. */
  readonly nearestRateCount: number;
  readonly unavailableCount: number;
  /** «Немає транзакцій рахунків бюджету за цей період». */
  readonly empty: boolean;
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
  const pending = rows.length === 0 ? new Set<string>() : await reads.pendingTransferSides(householdId);
  const counted = rows.filter((r) => !pending.has(r.id));
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
  const converted = await reads.convert(
    lines.map((l) => ({ amount: l.amount, date: l.date })),
    currency,
  );
  const inCurrency: CountedLine[] = [];
  lines.forEach((l, i) => {
    const value = converted.values[i];
    if (value) inCurrency.push({ month: l.date.slice(0, 7), categoryId: l.categoryId, amount: value });
  });
  const categories = new Map((await reads.categories(householdId)).map((c) => [c.id, c]));
  const figures = monthFigures(months, inCurrency, categories, currency);
  return {
    currency,
    months: figures,
    totals: periodTotals(figures, currency),
    unpairedTransfers: rows.length - counted.length,
    nearestRateCount: converted.nearestRateCount,
    unavailableCount: converted.unavailableCount,
    empty: rows.length === 0,
  };
}
