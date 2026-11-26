import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import type { FxReporting } from "../../../fx-rates/index.ts";
import {
  applyHandOff,
  type PaymentDeps,
  type ProposalDeps,
  type RecurringAudit,
  type RecurringHandOff,
  type CalendarDeps,
  type TrackingDeps,
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
  readonly tracking: TrackingDeps;
  readonly calendar: CalendarDeps;
  readonly audit: RecurringAudit;
}

/** FR 16: no «Кредит» accounts — a wiring without modules accounts, liabilities and ledger (unit tests). */
const NO_LOANS: CalendarDeps["loans"] = {
  list: async () => [],
  inflows: async () => [],
  debt: async () => {
    throw new Error("recurring: no loans wired");
  },
};

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
  readonly history: ProposalDeps["history"] & TrackingDeps["history"];
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
  /** Module categorization's `TransactionCategories`: the category of a transaction (FR 8, row 26). */
  readonly transactionCategories: TrackingDeps["categories"];
  /** Module fx-rates' `FxReporting`: a charge in another currency at the rate of its date (FR 12, row 26). */
  readonly fx: Pick<FxReporting, "total">;
  /**
   * FR 16: the space's «Кредит» accounts with their terms (modules accounts and liabilities), the payments to them
   * (module transactions) and their debt (module ledger) — wired in src/main.ts; none when left out.
   */
  readonly loans?: CalendarDeps["loans"];
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
    tracking: {
      history: options.history,
      merchants: options.merchants,
      categories: options.transactionCategories,
      async convert(amounts, currency) {
        const reported = await options.fx.total(amounts, currency);
        return reported.items.map((item) =>
          item.kind === "rate-unavailable"
            ? null
            : { value: item.value, approximate: item.kind === "converted" && item.conversion.approximate },
        );
      },
      today,
      newId: options.newId,
    },
    calendar: {
      loans: options.loans ?? NO_LOANS,
      async report(amounts, currency) {
        // FR 7: «за поточним курсом»; without today's rate the nearest earlier one, «приблизно».
        const reported = await options.fx.total(
          amounts.map((amount) => ({ amount, date: null })),
          currency,
        );
        let approximate = false;
        const values = reported.items.map((item) => {
          if (item.kind === "rate-unavailable") return null;
          if (item.kind === "converted" && item.conversion.approximate && !item.value.isZero())
            approximate = true;
          return item.value;
        });
        return { values, approximate };
      },
      today,
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
