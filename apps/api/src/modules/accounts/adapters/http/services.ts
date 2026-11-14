import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { Ledger } from "../../../ledger/index.ts";
import type { Liabilities } from "../../../liabilities/index.ts";
import type { AccountAudit, AccountsDeps, NumberSeal } from "../../application/index.ts";
import { maskedNumber } from "../../domain/index.ts";

const BRAND = Symbol("willowsum-accounts-services");

/**
 * What the API process wires for the accounts routes (src/api.ts → `ctx.services`): the journal (ledger), the
 * liabilities, the space's key for the number (household `SpaceKeys`), the audit log and the clock. Every port takes
 * the caller's space from `ctx.principal`.
 */
export interface AccountsServices {
  readonly [BRAND]: true;
  readonly deps: AccountsDeps;
}

export function createAccountsServices(options: {
  readonly ledger: Pick<Ledger, "openAccount" | "post" | "balanceAt">;
  readonly liabilities: Pick<Liabilities, "register" | "forAccount">;
  readonly keys: NumberSeal;
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
 * The account's entry in the space's own log (FIN-01 FR 17, П-10): every field with its new value; the full number
 * is masked by the log itself (`sensitive`), and only «••1234» is kept in the clear (FIN-01 AC7). The note is free
 * text and masked too.
 */
function accountAudit(audit: Pick<AuditLog, "record">): AccountAudit {
  return {
    async accountCreated(householdId, actorAccountId, account, currencies, owner) {
      const change = (field: string, after: string | null, sensitive = false) => ({
        field,
        before: null,
        after,
        sensitive,
      });
      await audit.record(householdId, {
        actor: { kind: "user", id: actorAccountId },
        channel: "web",
        entity: { type: "accounts.account", id: account.id },
        action: "create",
        changes: [
          change("kind", account.kind),
          change("name", account.name),
          change("institutionName", account.institutionName),
          change("institutionCountry", account.institutionCountry),
          change("number", account.numberSealed === null ? null : "sealed", true),
          change("numberLast4", account.numberLast4 === null ? null : maskedNumber(account.numberLast4)),
          change("note", account.note, true),
          change("annualRate", account.annualRate),
          change("depositOpenedOn", account.depositOpenedOn),
          change("depositMaturesOn", account.depositMaturesOn),
          change("openedOn", account.openedOn),
          change("status", account.status),
          change("source", account.source),
          ...currencies.flatMap((c, i) => [
            change(`currencies.${i}.currency`, c.currency),
            change(`currencies.${i}.openingBalance`, c.balance.toDecimalString()),
            change(`currencies.${i}.balanceDate`, c.date),
          ]),
          change("owners.0.ownerAccountId", owner.ownerAccountId),
          change("owners.0.share", owner.share),
          change("owners.0.validFrom", owner.validFrom),
        ],
      });
    },
  };
}
