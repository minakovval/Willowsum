import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import { groupOf, type AccountDirectory } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { AmountOutOfRangeError, Money } from "@willowsum/domain-kernel";
import type { Entry, Ledger } from "../../../ledger/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import type { TransactionCategories } from "../../../categorization/index.ts";
import type { FxReporting } from "../../../fx-rates/index.ts";
import type { GoalTransactions, TransactionLookup } from "../../../transactions/index.ts";
import {
  applyHandOff,
  type AccountBalances,
  type SpendableTransactions,
  type GoalHandOff,
  type GoalReads,
  type GoalsAudit,
  type GoalsDeps,
} from "../../application/index.ts";
import { countsAsSpending, cushionSpending } from "../../domain/index.ts";

const BRAND = Symbol("willowsum-goals-services");

/**
 * What the API process wires for the goals routes (src/api.ts → `ctx.services`): the accounts directory and the
 * journal for the balances of the parts' accounts, the audit log and the clock.
 */
export interface GoalsServices {
  readonly [BRAND]: true;
  readonly deps: GoalsDeps;
  readonly audit: GoalsAudit;
}

/** A part's account (FR 2): a cash account of the space, open, with a wallet in the goal's currency. */
export function accountBalances(
  accounts: Pick<AccountDirectory, "postingAccount">,
  ledger: Pick<Ledger, "balanceAt">,
): AccountBalances {
  return {
    async balance(householdId, accountId, currency, date) {
      const account = await accounts.postingAccount(householdId, accountId);
      // A credit account's balance is a debt (FIN-01 FR 14): no goal keeps money there (lead decision).
      if (!account || groupOf(account.kind) === "credit") return "not-found";
      if (account.status === "closed") return "closed";
      const wallet = account.subaccounts.find((s) => s.currency === currency);
      if (!wallet) return "currency";
      return ledger.balanceAt(householdId, wallet.ledgerAccountId, date);
    },
  };
}

/** The source of a transaction's journal event (module `transactions`, FIN-03 FR 1) and its event type. */
const TRANSACTION_EVENT = "transaction" as const;
const sourceOf = (transactionId: string) => ({ module: "transactions", id: transactionId });

/** What the entry moves on the ledger account, signed from its side (positive into it). */
function signedOn(entry: Entry, ledgerAccountId: string, currency: string): Money {
  let sum = Money.zero(currency);
  for (const p of entry.postings) {
    if (p.amount.currency !== currency) continue;
    if (p.debitAccountId === ledgerAccountId) sum = sum.plus(p.amount);
    if (p.creditAccountId === ledgerAccountId) sum = sum.minus(p.amount);
  }
  return sum;
}

/**
 * «Витратити» (FR 8) over the public interfaces of `transactions` (the transaction and its marks), `accounts` (the
 * account's wallet in the currency) and `ledger` (the transaction's event in effect and what it took from the wallet).
 */
export function spendableTransactions(
  transactions: Pick<TransactionLookup, "facts">,
  accounts: Pick<AccountDirectory, "postingAccount">,
  ledger: Pick<Ledger, "liveEntries">,
): SpendableTransactions {
  return {
    async outflow(householdId, transactionId, accountId, currency) {
      const facts = (await transactions.facts(householdId, [transactionId])).get(transactionId);
      if (!facts) return "not-found";
      if (facts.transfer) return "transfer";
      const account = await accounts.postingAccount(householdId, accountId);
      if (!account) return "not-found";
      const entry = (await ledger.liveEntries(householdId, sourceOf(transactionId), TRANSACTION_EVENT)).at(
        -1,
      );
      if (facts.merged || !entry) return "not-posted";
      const wallet = account.subaccounts.find((w) => w.currency === currency);
      const moved = wallet ? signedOn(entry, wallet.ledgerAccountId, currency) : null;
      if (moved === null || !moved.isNegative()) return "not-outflow";
      return { entryId: entry.id, amount: moved.negated(), date: entry.operationDate };
    },
    async inEffect(householdId, transactionId, entryId) {
      const live = await ledger.liveEntries(householdId, sourceOf(transactionId), TRANSACTION_EVENT);
      return live.some((e) => e.id === entryId);
    },
  };
}

/** What the cushion and the list of «Витратити» read of other modules (their public interfaces only). */
export interface CushionPorts {
  readonly transactions: GoalTransactions;
  readonly fx: Pick<FxReporting, "total">;
  /** Module categorization: the category of a transaction that is not split. */
  readonly categorization: TransactionCategories;
  /** Module categories: the space's tree with kinds and merges. */
  readonly categories: Pick<CategoryDirectory, "categories">;
}

/**
 * FR 10, FR 8 over the public interfaces of `transactions` (the window's transactions as the budget counts them; the
 * page of spendable transactions), `categorization` and `categories` (spending as the budget counts it: refunds lower
 * their category, service and income categories are not spending) and `fx-rates` (each amount at its date's official
 * rate, the nearest earlier one marked; VAL-04). An amount without a rate is left out and counted.
 */
export function goalReads(ports: CushionPorts): GoalReads {
  const { transactions, fx } = ports;
  return {
    async expenses(householdId, window, currency) {
      try {
        const rows = await transactions.countedInWindow(householdId, window.from, window.to);
        const [own, tree] = await Promise.all([
          ports.categorization.categoriesOf(
            householdId,
            rows.filter((r) => r.parts === null).map((r) => r.id),
          ),
          ports.categories.categories(householdId),
        ]);
        const categories = new Map(tree.map((c) => [c.id, c]));
        // As the budget period counts them: a share «На кілька місяців» on its month's first day, a part of a split
        // by categories and a whole transaction on its date; only what falls in the window.
        // The rate is of the transaction's own date for every part, as the budget converts it (#592).
        const counted: {
          categoryId: string | null;
          amount: Money;
          date: string;
          rateDate: string;
          oneOff: boolean;
        }[] = [];
        for (const r of rows) {
          if (r.parts === null)
            counted.push({
              categoryId: own.get(r.id) ?? null,
              amount: r.amount,
              date: r.date,
              rateDate: r.date,
              oneOff: r.oneOff === true,
            });
          else
            for (const p of r.parts)
              counted.push({
                categoryId: p.categoryId,
                amount: p.amount,
                date: p.month ?? r.date,
                rateDate: r.date,
                oneOff: r.oneOff === true,
              });
        }
        const spending = counted.filter(
          (c) =>
            c.date >= window.from &&
            c.date <= window.to &&
            countsAsSpending(categories, c.categoryId, c.amount),
        );
        // BUD-06@PoC FR 8: «Одноразова витрата» leaves the sum, but its month stays a month of history (#685).
        const inWindow = spending.filter((c) => !c.oneOff);
        const reported = await fx.total(
          inWindow.map((c) => ({ amount: c.amount, date: c.rateDate })),
          currency,
        );
        const converted: { categoryId: string | null; amount: Money }[] = [];
        reported.items.forEach((item, i) => {
          if (item.kind !== "rate-unavailable")
            converted.push({ categoryId: inWindow[i]!.categoryId, amount: item.value });
        });
        const firstDate =
          spending
            .filter((c) => c.amount.isNegative())
            .map((c) => c.date)
            .sort()[0] ?? null;
        return {
          total:
            reported.total === null && inWindow.length > 0
              ? null
              : cushionSpending(converted, categories, currency),
          firstDate,
          nearestRateCount: reported.nearestRateCount,
          unavailableCount: reported.unavailableCount,
        };
      } catch (error) {
        // A sum, its conversion or the total leaves NUMERIC(38,18): there is no average to show (the form then asks
        // for the target), never a 500 (security review of #584; the same class as #573).
        if (!(error instanceof AmountOutOfRangeError)) throw error;
        return { total: null, firstDate: null, nearestRateCount: 0, unavailableCount: 1 };
      }
    },
    candidates: (householdId, query) => transactions.spendCandidates(householdId, query),
  };
}

/** The goals' entries in the space's own log (BUD-05 «Права доступу», П-10): who, when, each field before and after. */
export function goalsAudit(audit: Pick<AuditLog, "record">): GoalsAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor:
          handOff.actorAccountId === null ? { kind: "system" } : { kind: "user", id: handOff.actorAccountId },
        channel: handOff.actorAccountId === null ? "system" : "web",
        entity: { type: handOff.entity, id: handOff.entityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

export function createGoalsServices(options: {
  readonly accounts: Pick<AccountDirectory, "postingAccount">;
  readonly ledger: Pick<Ledger, "balanceAt" | "liveEntries">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
  /** Module transactions' lookup, for «Витратити» (FR 8); without it «Витратити» answers 500. */
  readonly transactions?: Pick<TransactionLookup, "facts">;
  /**
   * Module transactions' reads for goals and module fx-rates' conversion: «Подушка безпеки» (FR 10) and the list of
   * «Витратити» (FR 8, #559); without them those two routes answer 500.
   */
  readonly reads?: CushionPorts;
}): GoalsServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      // «Сьогодні» — the Kyiv date, as the transactions' (the profile's time zone is not known to this module yet).
      today: () => kyivToday(options.clock.now()),
      balances: accountBalances(options.accounts, options.ledger),
      transactions: options.transactions
        ? spendableTransactions(options.transactions, options.accounts, options.ledger)
        : null,
      reads: options.reads ? goalReads(options.reads) : null,
    },
    audit: goalsAudit(options.audit),
  };
}

/** The services of a goals route; without them (never in the API process) the route answers 500. */
export function goalsServices(ctx: ProtectedContext): GoalsServices {
  const services = ctx.services as Partial<GoalsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as GoalsServices;
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away. A failure is no failure of the request: the change is
 * made and its job is in the goals queue, so the worker writes the entry (WARN `goals.hand_off_deferred`, class only).
 */
export async function handOffNow(
  audit: GoalsAudit,
  householdId: string,
  handOffs: readonly GoalHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("goals.hand_off_deferred", "warn", {
      "ws.module": "goals",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
