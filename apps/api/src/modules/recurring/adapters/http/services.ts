import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday } from "../../../../platform/lists/list-total.ts";
import type { ProposalDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-recurring-services");

/**
 * What the API process wires for the recurring routes (src/api.ts → `ctx.services`): module transactions' history,
 * module merchants' directory, module accounts' directory (the kind of an account) and the clock. Every port takes the
 * caller's space.
 */
export interface RecurringServices {
  readonly [BRAND]: true;
  readonly deps: ProposalDeps;
}

export function createRecurringServices(options: {
  readonly history: ProposalDeps["history"];
  readonly merchants: ProposalDeps["merchants"];
  /** Module accounts' `AccountDirectory`. */
  readonly accounts: {
    postingAccount(householdId: string, accountId: string): Promise<{ readonly kind: string } | null>;
  };
  readonly clock: { now(): number };
}): RecurringServices {
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
      // «Сьогодні» — the Kyiv date, as the transactions' (the profile's time zone is not known to this module yet).
      today: () => kyivToday(options.clock.now()),
    },
  };
}

/** The services of a recurring route; without them (never in the API process) the route answers 500. */
export function recurringServices(ctx: ProtectedContext): RecurringServices {
  const services = ctx.services as Partial<RecurringServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as RecurringServices;
}
