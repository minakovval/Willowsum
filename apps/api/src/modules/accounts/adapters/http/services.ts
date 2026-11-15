import { Money } from "@willowsum/domain-kernel";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { REPORTING_CURRENCY, type FxReporting } from "../../../fx-rates/index.ts";
import type { Liabilities } from "../../../liabilities/index.ts";
import type { AccountAudit, AccountsDeps, NumberSeal } from "../../application/index.ts";

const BRAND = Symbol("willowsum-accounts-services");

/**
 * What the API process wires for the accounts routes (src/api.ts → `ctx.services`): the journal (ledger), the
 * liabilities, the space's key for the number (household `SpaceKeys`), the official rates (fx-rates `FxReporting`),
 * the audit log and the clock. Every port takes
 * the caller's space from `ctx.principal`.
 */
export interface AccountsServices {
  readonly [BRAND]: true;
  readonly deps: AccountsDeps;
}

export function createAccountsServices(options: {
  readonly ledger: AccountsDeps["ledger"];
  readonly liabilities: Pick<Liabilities, "register" | "forAccount" | "changeKind" | "changeTerms">;
  readonly keys: NumberSeal;
  /** fx-rates' `createFxReporting` on the same clock: «Гроші разом» and the list in the profile currency. */
  readonly fx: Pick<FxReporting, "total">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): AccountsServices {
  return {
    [BRAND]: true,
    deps: {
      ledger: options.ledger,
      liabilities: options.liabilities,
      seal: options.keys,
      fx: options.fx,
      // The profile currency: EUR for every space in this release (ACC-06@PoC; household offers no other).
      reportingCurrency: REPORTING_CURRENCY,
      audit: accountAudit(options.audit),
      newId: options.newId,
      // The UTC date; the profile's time zone (ACC-05) is not known to this module yet.
      today: () => new Date(options.clock.now()).toISOString().slice(0, 10),
    },
  };
}

/** The services of an accounts route; without them (never in the API process) the route answers 500. */
export function accountsServices(ctx: ProtectedContext): AccountsServices {
  const services = ctx.services as Partial<AccountsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as AccountsServices;
}

/**
 * The account's entries in the space's own log (П-10), each written once per key by the hand-off (ARC-04 FR 3). The
 * values come from the hand-off's job with the sensitive ones masked already (application/hand-off.ts); the log masks
 * them again (`sensitive`). Also the worker's (src/wiring.ts, `createAccountsWorkerQueue`).
 */
export function accountAudit(audit: Pick<AuditLog, "record">): AccountAudit {
  return {
    async accountCreated(householdId, actorAccountId, accountId, values, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "accounts.account", id: accountId },
        action: "create",
        changes: values.map((v) => ({
          field: v.field,
          before: null,
          after: v.after,
          sensitive: v.sensitive,
        })),
        key,
      });
    },
    async statusChanged(householdId, actorAccountId, accountId, status, key) {
      const settlement = status.settlement;
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "accounts.account", id: accountId },
        action: "update",
        changes: [
          { field: "status", before: status.before.status, after: status.after.status, sensitive: false },
          {
            field: "closedOn",
            before: status.before.closedOn,
            after: status.after.closedOn,
            sensitive: false,
          },
          ...(settlement
            ? [
                { field: "settlement.kind", before: null, after: settlement.kind, sensitive: false },
                ...(settlement.kind === "transfer"
                  ? [
                      {
                        field: "settlement.toAccountId",
                        before: null,
                        after: settlement.toAccountId,
                        sensitive: false,
                      },
                    ]
                  : []),
                ...settlement.amounts.map((a) => ({
                  field: `settlement.${a.currency}`,
                  before: null,
                  // The canonical decimal, as the amount's own entries show it.
                  after: Money.of(a.balance, a.currency).toDecimalString(),
                  sensitive: false,
                })),
              ]
            : []),
        ],
        key,
      });
    },
    async settingsChanged(householdId, actorAccountId, accountId, changes, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "accounts.account", id: accountId },
        action: "update",
        changes: [...changes],
        key,
      });
    },
    async transferred(householdId, actorAccountId, accountId, transfer, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "accounts.account", id: accountId },
        action: "update",
        changes: [
          { field: "settlement.kind", before: null, after: "transfer", sensitive: false },
          { field: "settlement.toAccountId", before: null, after: transfer.toAccountId, sensitive: false },
          {
            field: `settlement.${transfer.currency}`,
            before: null,
            after: transfer.amount.toDecimalString(),
            sensitive: false,
          },
          { field: "settlement.entryId", before: null, after: transfer.entryId, sensitive: false },
        ],
        key,
      });
    },
    async adjustmentChanged(householdId, actor, channel, subaccount, before, after, key) {
      const value = (a: typeof before, field: "entryId" | "amount" | "date") =>
        a === null ? null : field === "amount" ? a.amount.toDecimalString() : a[field];
      await audit.record(householdId, {
        actor,
        channel,
        // One adjustment per currency of an account: its history is the subaccount's (FIN-12 FR 14).
        entity: { type: "accounts.balance-adjustment", id: subaccount.id },
        action: before === null ? "create" : after === null ? "delete" : "update",
        changes: [
          { field: "accountId", before: subaccount.accountId, after: subaccount.accountId, sensitive: false },
          { field: "currency", before: subaccount.currency, after: subaccount.currency, sensitive: false },
          ...(["entryId", "amount", "date"] as const).map((field) => ({
            field,
            before: value(before, field),
            after: value(after, field),
            sensitive: false,
          })),
        ],
        key,
      });
    },
  };
}
