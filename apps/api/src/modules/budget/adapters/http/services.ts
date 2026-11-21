import { AmountOutOfRangeError, Decimal } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AccountList } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { TransactionCategories } from "../../../categorization/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import type { FxReporting } from "../../../fx-rates/index.ts";
import type { GoalSpends } from "../../../goals/index.ts";
import { SPACE_REPORTING_CURRENCY } from "../../../household/index.ts";
import type { BudgetTransactions } from "../../../transactions/index.ts";
import {
  applyHandOff,
  type BudgetAudit,
  type BudgetChargeHistory,
  type BudgetDeps,
  type BudgetHandOff,
  type BudgetObligations,
  type BudgetPlanSources,
  type BudgetReads,
} from "../../application/index.ts";
import { periodDays, periodOf, type CountedAmount } from "../../domain/index.ts";
import { overBudgetCap } from "../money-range.ts";

/**
 * The most the absolute values of one read may add up to (#586): the figures sum them by category and in total, with
 * the limits, inside the money type's 20 integer digits.
 */
const BUDGET_MAX_ABSOLUTE_SUM = new Decimal("1e18");

/** The most amounts read one by one when the rates' reader leaves the money type on the whole sum (#594). */
const ONE_BY_ONE_MAX_AMOUNTS = 1000;

const BRAND = Symbol("willowsum-budget-services");

/** What the API process wires for the budget routes (src/api.ts → `ctx.services`). */
export interface BudgetServices {
  readonly [BRAND]: true;
  readonly deps: BudgetDeps;
  readonly audit: BudgetAudit;
}

/**
 * FR 12 and the business rules over the public interfaces of `transactions` (the period's transactions of the budget
 * accounts with their split parts), `categorization` (the category of each unsplit one) and `fx-rates` (each amount at
 * the rate of its transaction's date, the nearest available one «приблизно», none — left out).
 */
export function budgetReads(options: {
  readonly categories: Pick<CategoryDirectory, "categories">;
  readonly accounts: AccountList;
  readonly transactions: BudgetTransactions;
  readonly categorization: TransactionCategories;
  readonly fx: Pick<FxReporting, "total">;
  /** BUD-03@PoC EC5: the transactions written off from a goal (module goals); left out (a test's server) — none. */
  readonly goalSpends?: GoalSpends;
}): BudgetReads {
  return {
    categories: async (householdId) => [...(await options.categories.categories(householdId))],
    accounts: async (householdId) => [...(await options.accounts.accounts(householdId))],
    async amounts(householdId, accountIds, period, currency, since, until, opts) {
      const { from, to } = periodDays(period);
      const last = until !== undefined && until < to ? until : to;
      return counted(householdId, accountIds, from, last, currency, since, opts?.withoutGoalSpends === true);
    },
    window: (householdId, accountIds, from, to, currency) =>
      counted(householdId, accountIds, from, to, currency),
    historyStart: (householdId, accountIds) => options.transactions.firstDate(householdId, accountIds),
  };

  /**
   * The amounts of the dates `from`–`to` (a month, or BUD-06's window of months): a share «На кілька місяців» counts in
   * its month when the 1st of it is in the dates, every other amount by its date. FR 14: a proportional first period
   * counts from `since` (a share — the whole month's).
   */
  async function counted(
    householdId: string,
    accountIds: readonly string[],
    from: string,
    to: string,
    currency: string,
    since?: string,
    withoutGoalSpends = false,
  ) {
    let rows = (await options.transactions.inPeriod(householdId, accountIds, from, to)).filter(
      (r) => since === undefined || r.date >= since || r.parts?.some((p) => p.month !== null),
    );
    // BUD-03@PoC EC5 (BUD-05@PoC FR 8): a transaction written off from a goal no longer lowers «Можна витратити» —
    // the whole transaction leaves the sum, so the goal's money held back by its contribution is not taken a second
    // time, whatever month it was put aside in. Before any conversion: its rate is no matter of the sum either.
    if (withoutGoalSpends && options.goalSpends && rows.length > 0) {
      const spent = await options.goalSpends.spent(
        householdId,
        rows.map((r) => r.id),
      );
      if (spent.size > 0) rows = rows.filter((r) => !spent.has(r.id));
    }
    const own = await options.categorization.categoriesOf(
      householdId,
      rows.filter((r) => r.parts === null).map((r) => r.id),
    );
    const counted: {
      categoryId: string | null;
      amount: CountedAmount["amount"];
      date: string;
      period: string;
    }[] = [];
    const inDates = (date: string) => date >= from && date <= to;
    for (const r of rows) {
      if (r.parts === null)
        counted.push({
          categoryId: own.get(r.id) ?? null,
          amount: r.amount,
          date: r.date,
          period: periodOf(r.date),
        });
      else
        for (const p of r.parts)
          // A share «На кілька місяців» counts in its month; a part of a split by categories on the date.
          if (
            p.month !== null ? inDates(p.month) : inDates(r.date) && (since === undefined || r.date >= since)
          )
            counted.push({
              categoryId: p.categoryId,
              amount: p.amount,
              date: r.date,
              period: periodOf(p.month ?? r.date),
            });
    }
    // #586: the cap before any conversion or sum — an amount over it is left out, as one without a rate.
    const inRange = counted.filter((c) => !overBudgetCap(c.amount));
    const allLeftOut = { amounts: [], nearestRateCount: 0, unavailableCount: counted.length };
    const read = (xs: typeof inRange) =>
      options.fx.total(
        xs.map((c) => ({ amount: c.amount, date: c.date })),
        currency,
      );
    let items: Awaited<ReturnType<typeof read>>["items"][number][];
    let unavailable = 0;
    let nearest = 0;
    try {
      const all = await read(inRange);
      items = [...all.items];
      unavailable = all.unavailableCount;
      nearest = all.nearestRateCount;
    } catch (error) {
      // The rates' reader adds the converted amounts up itself: past the money type, no figure, never a 500 (#573).
      if (!(error instanceof AmountOutOfRangeError)) throw error;
      // #594: then one by one, so only an amount that leaves the type alone is left out (as the cash flow does). Bounded:
      // not above 1 000 amounts, nor when the originals alone pass the bound — no rates call per transaction of a big read.
      const originals = inRange.reduce((sum, c) => sum.plus(c.amount.amount.abs()), new Decimal("0"));
      if (inRange.length > ONE_BY_ONE_MAX_AMOUNTS || originals.greaterThan(BUDGET_MAX_ABSOLUTE_SUM))
        return allLeftOut;
      items = [];
      for (const c of inRange) {
        try {
          const one = await read([c]);
          items.push(one.items[0]!);
          unavailable += one.unavailableCount;
          nearest += one.nearestRateCount;
        } catch (e) {
          if (!(e instanceof AmountOutOfRangeError)) throw e;
          items.push({ kind: "rate-unavailable", original: c.amount });
          unavailable += 1;
        }
      }
    }
    const amounts: (CountedAmount & { period: string })[] = [];
    let leftOut = counted.length - inRange.length + unavailable;
    let absolute = new Decimal("0");
    items.forEach((item, i) => {
      if (item.kind === "rate-unavailable") return;
      if (overBudgetCap(item.value)) {
        leftOut += 1;
        // Every amount here has its date: «приблизно» is the nearest rate only.
        if (item.kind === "converted" && item.conversion.approximate) nearest -= 1;
        return;
      }
      absolute = absolute.plus(item.value.amount.abs());
      amounts.push({ categoryId: inRange[i]!.categoryId, amount: item.value, period: inRange[i]!.period });
    });
    // The figures sum these by category and in total: past the bound, no figure beats a wrong one or a 500.
    if (absolute.greaterThan(BUDGET_MAX_ABSOLUTE_SUM)) return allLeftOut;
    return { amounts, nearestRateCount: nearest, unavailableCount: leftOut };
  }
}

/** The budget's entries in the space's own log (BUD-02 «Права доступу», П-10): who, when, each field before and after. */
export function budgetAudit(audit: Pick<AuditLog, "record">): BudgetAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: handOff.entity, id: handOff.entityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

export function createBudgetServices(options: {
  readonly categories: Pick<CategoryDirectory, "categories">;
  readonly accounts: AccountList;
  readonly transactions: BudgetTransactions;
  readonly categorization: TransactionCategories;
  readonly fx: Pick<FxReporting, "total">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
  /**
   * FR 3, FR 15, FR 16, FR 19: the month's regular payments and debt minimums (`createBudgetObligations`, wired by the
   * API process, #567). Left out (a test's server): every figure that needs them is null.
   */
  readonly obligations?: BudgetObligations;
  /** BUD-17: the goals and the debts' extra payments of «План» (`createBudgetPlanSources`); left out — none. */
  readonly planSources?: BudgetPlanSources;
  /** BUD-03@PoC EC5: «Витратити з цілі» (`createGoalSpends`); left out (a test's server) — no spends left out. */
  readonly goalSpends?: GoalSpends;
  /** FLW-38 (S-135): a finished month's regular charges (`createRecurringHistory`); left out — `regularPayments` null. */
  readonly chargeHistory?: BudgetChargeHistory;
  /**
   * BUD-17 (owner decision 2026-11-20, batch 2, item 2): whether «План» (`budget.plan`) is on for the space; while it is
   * off the months' own values act nowhere. Required: a server without it does not build (#652 security review).
   */
  readonly planEnabled: (householdId: string) => Promise<boolean>;
}): BudgetServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      // «Сьогодні» — the Kyiv date, as the transactions' (the profile's time zone is not known to this module yet).
      today: () => kyivToday(options.clock.now()),
      reportingCurrency: SPACE_REPORTING_CURRENCY,
      reads: budgetReads(options),
      obligations: options.obligations ?? null,
      planSources: options.planSources ?? null,
      chargeHistory: options.chargeHistory ?? null,
      planEnabled: options.planEnabled,
    },
    audit: budgetAudit(options.audit),
  };
}

/** The services of a budget route; without them (never in the API process) the route answers 500. */
export function budgetServices(ctx: ProtectedContext): BudgetServices {
  const services = ctx.services as Partial<BudgetServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as BudgetServices;
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away. A failure is no failure of the request: the change is
 * made and its job is in the budget queue, so the worker writes the entry (WARN `budget.hand_off_deferred`, class only).
 */
export async function handOffNow(
  audit: BudgetAudit,
  householdId: string,
  handOffs: readonly BudgetHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("budget.hand_off_deferred", "warn", {
      "ws.module": "budget",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
