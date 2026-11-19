import { AmountOutOfRangeError, type Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import type { AccountList } from "../../../accounts/index.ts";
import { DEFAULT_BUDGET_KINDS } from "../../../budget/index.ts";
import type { TransactionCategories } from "../../../categorization/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import type { FxReporting } from "../../../fx-rates/index.ts";
import { SPACE_REPORTING_CURRENCY } from "../../../household/index.ts";
import type { BudgetTransactions } from "../../../transactions/index.ts";
import type { TransferProposalSides } from "../../../transfer-matching/index.ts";
import type { CashflowDeps, CashflowReads } from "../../application/index.ts";

/** Amounts over 15 integer digits are not counted (the budget's rule, #565, #573). */
const tooBig = (m: Money) => m.amount.abs().truncated().toFixed().length > 15;

const BRAND = Symbol("willowsum-cashflow-services");

/** What the API process wires for the cashflow route (src/api.ts → `ctx.services`). */
export interface CashflowServices {
  readonly [BRAND]: true;
  readonly deps: CashflowDeps;
}

export interface CashflowPorts {
  readonly categories: Pick<CategoryDirectory, "categories">;
  readonly accounts: AccountList;
  readonly transactions: BudgetTransactions;
  readonly categorization: TransactionCategories;
  readonly transfers: TransferProposalSides;
  readonly fx: Pick<FxReporting, "total">;
}

/**
 * FR 8, FR 12, FR 13 over the public interfaces of `categories`, `accounts`, `transactions` (the shown transactions of
 * the accounts without transfers between own accounts, with their split parts), `categorization`, `transfer-matching`
 * (proposed pairs) and `fx-rates` (the rate of each date, the nearest one «приблизно», none — left out).
 *
 * FR 12 «рахунки бюджету»: the budget's default accounts — current, credit cards, cash — while module budget has no
 * public reader of its switched accounts (follow-up of wave 2 row 37; lead decision 2026-11-19).
 */
export function cashflowReads(ports: CashflowPorts): CashflowReads {
  return {
    categories: async (householdId) => [...(await ports.categories.categories(householdId))],
    accountIds: async (householdId) =>
      (await ports.accounts.accounts(householdId))
        .filter((a) => DEFAULT_BUDGET_KINDS.includes(a.kind))
        .map((a) => a.accountId),
    transactions: (householdId, accountIds, from, to) =>
      ports.transactions.inPeriod(householdId, accountIds, from, to),
    categoriesOf: (householdId, ids) => ports.categorization.categoriesOf(householdId, ids),
    pendingTransferSides: (householdId) => ports.transfers.pendingSides(householdId),
    // The cap before any sum or conversion: the rates' reader adds the amounts up itself (#567, #573). An amount over
    // 15 integer digits, before or after conversion, is left out and counted with the unavailable ones — never a 500.
    async convert(amounts, currency) {
      const values: (Money | null)[] = amounts.map(() => null);
      let nearestRateCount = 0;
      const read = async (indexes: readonly number[]) => {
        const total = await ports.fx.total(
          indexes.map((i) => amounts[i]!),
          currency,
        );
        total.items.forEach((item, k) => {
          if (item.kind !== "rate-unavailable" && !tooBig(item.value)) values[indexes[k]!] = item.value;
        });
        nearestRateCount += total.nearestRateCount;
      };
      const kept = amounts.map((_, i) => i).filter((i) => !tooBig(amounts[i]!.amount));
      try {
        await read(kept);
      } catch (error) {
        if (!(error instanceof AmountOutOfRangeError)) throw error;
        // Many capped amounts at a big rate can still leave the money type in the reader's own sum: one by one.
        for (const i of kept)
          await read([i]).catch((e: unknown) => {
            if (!(e instanceof AmountOutOfRangeError)) throw e;
          });
      }
      return { values, nearestRateCount, unavailableCount: values.filter((v) => v === null).length };
    },
  };
}

export function createCashflowServices(
  options: CashflowPorts & { readonly clock: { now(): number } },
): CashflowServices {
  return {
    [BRAND]: true,
    deps: {
      reads: cashflowReads(options),
      currency: SPACE_REPORTING_CURRENCY,
      // «Сьогодні» — the Kyiv date, as the budget's (the space's time zone is not known to the modules yet).
      today: () => kyivToday(options.clock.now()),
    },
  };
}

/** The services of the cashflow route; without them (never in the API process) the route answers 500. */
export function cashflowServices(ctx: ProtectedContext): CashflowServices {
  const services = ctx.services as Partial<CashflowServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as CashflowServices;
}
