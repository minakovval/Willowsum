import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday, type ListTotals } from "../../../../platform/lists/list-total.ts";
import type { AccountDirectory } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { REPORTING_CURRENCY } from "../../../fx-rates/index.ts";
import type { TransactionAudit, TransactionsDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-transactions-services");

/**
 * What the API process wires for the transactions routes (src/api.ts → `ctx.services`): the accounts module's
 * directory, the journal (ledger), the totals of the list at the official dated rates (DAT-01, fx-rates), the audit
 * log and the clock. Every port takes the caller's space from `ctx.principal`.
 */
export interface TransactionsServices {
  readonly [BRAND]: true;
  readonly deps: TransactionsDeps;
  readonly totals: ListTotals;
  /** The profile currency of the totals (EUR for every space in this release, ACC-06). */
  readonly reportingCurrency: string;
}

export function createTransactionsServices(options: {
  readonly accounts: AccountDirectory;
  readonly ledger: TransactionsDeps["ledger"];
  /** `createListTotals` of platform/lists with fx-rates' `officialDatedRates`, on the same clock. */
  readonly totals: ListTotals;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): TransactionsServices {
  return {
    [BRAND]: true,
    deps: {
      accounts: options.accounts,
      ledger: options.ledger,
      audit: transactionAudit(options.audit),
      newId: options.newId,
      // «Сьогодні» of the form (FR 29): the Kyiv date, the day of the official rates; never earlier than the UTC
      // date, so a transaction of the user's today is never refused as a future one (the profile's time zone,
      // ACC-05, is not known to this module yet).
      today: () => kyivToday(options.clock.now()),
    },
    totals: options.totals,
    reportingCurrency: REPORTING_CURRENCY,
  };
}

/** The services of a transactions route; without them (never in the API process) the route answers 500. */
export function transactionsServices(ctx: ProtectedContext): TransactionsServices {
  const services = ctx.services as Partial<TransactionsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as TransactionsServices;
}

/**
 * The transaction's entries in the space's own log (FIN-03 FR 20, П-10), written by the hand-off (ARC-04) with its key:
 * the values come from the hand-off with the counterparty and the description masked already (application/hand-off.ts
 * `transactionAuditValues`); the log masks them again (`sensitive`). Also the worker's (src/wiring.ts).
 */
export function transactionAudit(audit: Pick<AuditLog, "record">): TransactionAudit {
  return {
    async changed(householdId, actorAccountId, transactionId, action, values, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "transactions.transaction", id: transactionId },
        action,
        changes: values.map((v) => ({
          field: v.field,
          before: v.before,
          after: v.after,
          sensitive: v.sensitive,
        })),
        key,
      });
    },
  };
}
