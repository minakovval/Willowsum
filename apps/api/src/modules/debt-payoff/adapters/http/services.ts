import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { CreditAccounts } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { Ledger } from "../../../ledger/index.ts";
import type { Liabilities } from "../../../liabilities/index.ts";
import {
  applyHandOff,
  PLAN_ENTITY,
  type Debt,
  type DebtSource,
  type PlanDeps,
  type PlanHandOff,
  type PlansAudit,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-debt-payoff-services");

/** How far back «Погашено N %» looks for the largest debt at a month's end (lead decision): 120 months. */
const START_LOOKBACK_MONTHS = 120;

export interface DebtPayoffServices {
  readonly [BRAND]: true;
  readonly deps: PlanDeps & { readonly debts: DebtSource; readonly today: () => string };
  readonly audit: PlansAudit;
}

/** The last day of the month before `date`'s (YYYY-MM-DD). */
function endOfPreviousMonth(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}

/** The month ends after `from` up to and including `to` (both YYYY-MM-DD), the latest `max` of them. */
function monthEnds(from: string, to: string, max: number): string[] {
  const ends: string[] = [];
  for (let end = to; end > from && ends.length < max; end = endOfPreviousMonth(end)) ends.push(end);
  return ends;
}

/**
 * The debts of the space (FR 11): its active credit cards and loans (accounts), each with its liability's rate and
 * payment (liabilities) and what is owed — the journal's balance of its wallet in the liability's currency, negated.
 */
export function debtSource(
  accounts: CreditAccounts,
  liabilities: Pick<Liabilities, "forAccount">,
  ledger: Pick<Ledger, "balanceAt">,
): DebtSource {
  return {
    async debts(householdId, today) {
      const result: Debt[] = [];
      for (const account of await accounts.list(householdId)) {
        const liability = await liabilities.forAccount(householdId, account.accountId);
        const wallet =
          account.subaccounts.find((s) => s.currency === liability?.currency) ?? account.subaccounts[0];
        if (!wallet) continue;
        const owed = async (date: string) =>
          (await ledger.balanceAt(householdId, wallet.ledgerAccountId, date)).negated();
        const balance = await owed(today);
        const lastMonth = endOfPreviousMonth(today);
        const opening = await owed(wallet.balanceDate);
        const balanceLastMonth = lastMonth < wallet.balanceDate ? opening : await owed(lastMonth);
        let startBalance = opening.compare(balance) >= 0 ? opening : balance;
        for (const end of monthEnds(wallet.balanceDate, lastMonth, START_LOOKBACK_MONTHS)) {
          const debt = end === lastMonth ? balanceLastMonth : await owed(end);
          if (debt.compare(startBalance) > 0) startBalance = debt;
        }
        result.push({
          accountId: account.accountId,
          kind: account.kind,
          name: account.name,
          currency: wallet.currency,
          balance,
          balanceLastMonth,
          startBalance,
          annualRate: liability?.annualRate ?? null,
          monthlyPayment:
            liability?.monthlyPayment && liability.monthlyPayment.currency === wallet.currency
              ? liability.monthlyPayment
              : null,
        });
      }
      return result;
    },
  };
}

/** The plans' entries in the space's own log (BUD-19 «Права доступу», П-10): amounts and rates are not personal data. */
export function plansAudit(audit: Pick<AuditLog, "record">): PlansAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: PLAN_ENTITY, id: handOff.entityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

export function createDebtPayoffServices(options: {
  readonly accounts: CreditAccounts;
  readonly liabilities: Pick<Liabilities, "forAccount">;
  readonly ledger: Pick<Ledger, "balanceAt">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): DebtPayoffServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      // «Сьогодні» — the Kyiv date, as the goals' and the transactions'.
      today: () => kyivToday(options.clock.now()),
      debts: debtSource(options.accounts, options.liabilities, options.ledger),
    },
    audit: plansAudit(options.audit),
  };
}

/** The services of a debt-payoff route; without them (never in the API process) the route answers 500. */
export function debtPayoffServices(ctx: ProtectedContext): DebtPayoffServices {
  const services = ctx.services as Partial<DebtPayoffServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as DebtPayoffServices;
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away. A failure is no failure of the request: the plan is
 * saved and its job is in the queue, so the worker writes the entry (WARN `debt_payoff.hand_off_deferred`, class only).
 */
export async function handOffNow(
  audit: PlansAudit,
  householdId: string,
  handOffs: readonly PlanHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("debt_payoff.hand_off_deferred", "warn", {
      "ws.module": "debt-payoff",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
