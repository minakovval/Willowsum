import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import {
  applyHandOff,
  type PaymentDeps,
  type ProposalDeps,
  type RecurringAudit,
  type RecurringHandOff,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-recurring-services");

/**
 * What the API process wires for the recurring routes (src/api.ts → `ctx.services`): module transactions' history,
 * module merchants' directory, module accounts' directory (the kind and state of an account), module categories'
 * directory, the audit log and the clock. Every port takes the caller's space.
 */
export interface RecurringServices {
  readonly [BRAND]: true;
  readonly deps: ProposalDeps;
  readonly payments: PaymentDeps;
  readonly audit: RecurringAudit;
}

/** The payments' entries in the space's own log (BUD-07 «Права доступу», П-10): who, when, each field before and after. */
export function recurringAudit(audit: Pick<AuditLog, "record">): RecurringAudit {
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

export function createRecurringServices(options: {
  readonly history: ProposalDeps["history"];
  readonly merchants: ProposalDeps["merchants"];
  /** Module accounts' `AccountDirectory`. */
  readonly accounts: {
    postingAccount(
      householdId: string,
      accountId: string,
    ): Promise<{ readonly kind: string; readonly status: string } | null>;
  };
  /** Module categories' `CategoryDirectory`: the category of a payment (FR 6). */
  readonly categories: Pick<CategoryDirectory, "category">;
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): RecurringServices {
  // «Сьогодні» — the Kyiv date, as the transactions' (the profile's time zone is not known to this module yet).
  const today = () => kyivToday(options.clock.now());
  return {
    [BRAND]: true,
    deps: {
      history: options.history,
      merchants: options.merchants,
      async accountKinds(householdId, accountIds) {
        const kinds = new Map<string, string>();
        for (const id of accountIds) {
          const account = await options.accounts.postingAccount(householdId, id);
          if (account) kinds.set(id, account.kind);
        }
        return kinds;
      },
      today,
    },
    payments: {
      newId: options.newId,
      today,
      references: {
        async category(householdId, categoryId) {
          const c = await options.categories.category(householdId, categoryId);
          return c ? { kind: c.kind, retired: c.state === "retired" } : null;
        },
        async account(householdId, accountId) {
          const a = await options.accounts.postingAccount(householdId, accountId);
          return a ? { kind: a.kind, closed: a.status === "closed" } : null;
        },
      },
    },
    audit: recurringAudit(options.audit),
  };
}

/** The services of a recurring route; without them (never in the API process) the route answers 500. */
export function recurringServices(ctx: ProtectedContext): RecurringServices {
  const services = ctx.services as Partial<RecurringServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as RecurringServices;
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away. A failure is no failure of the request: the change is
 * made and its job is in the recurring queue, so the worker writes the entry (WARN `recurring.hand_off_deferred`, class
 * only).
 */
export async function handOffNow(
  audit: RecurringAudit,
  householdId: string,
  handOffs: readonly RecurringHandOff[],
): Promise<void> {
  try {
    for (const handOff of handOffs) await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("recurring.hand_off_deferred", "warn", {
      "ws.module": "recurring",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}
