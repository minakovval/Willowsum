import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import { groupOf, type AccountDirectory } from "../../../accounts/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { Ledger } from "../../../ledger/index.ts";
import {
  applyHandOff,
  type AccountBalances,
  type GoalHandOff,
  type GoalsAudit,
  type GoalsDeps,
} from "../../application/index.ts";

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

/** The goals' entries in the space's own log (BUD-05 «Права доступу», П-10): who, when, each field before and after. */
export function goalsAudit(audit: Pick<AuditLog, "record">): GoalsAudit {
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

export function createGoalsServices(options: {
  readonly accounts: Pick<AccountDirectory, "postingAccount">;
  readonly ledger: Pick<Ledger, "balanceAt">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): GoalsServices {
  return {
    [BRAND]: true,
    deps: {
      newId: options.newId,
      // «Сьогодні» — the Kyiv date, as the transactions' (the profile's time zone is not known to this module yet).
      today: () => kyivToday(options.clock.now()),
      balances: accountBalances(options.accounts, options.ledger),
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
  handOff: GoalHandOff | null,
): Promise<void> {
  if (handOff === null) return;
  try {
    await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("goals.hand_off_deferred", "warn", {
      "ws.module": "goals",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
