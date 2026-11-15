import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { isDuplicateNow, type DuplicateDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-duplicate-matching-services");

/**
 * What the API process wires for the duplicate-matching routes (src/api.ts → `ctx.services`): the transactions module's
 * candidate pairs. The caller's space comes from `ctx.principal`.
 */
export interface DuplicateMatchingServices {
  readonly [BRAND]: true;
  readonly deps: DuplicateDeps;
}

export function createDuplicateMatchingServices(deps: DuplicateDeps): DuplicateMatchingServices {
  return { [BRAND]: true, deps };
}

/**
 * The check the transactions module asks before «Приховати транзакцію» (FIN-03 FR 18; its `DuplicateCheck`, wired in
 * src/main.ts): whether the transaction is a «Можливий дубль» now.
 */
export function createDuplicateCheck(deps: DuplicateDeps): {
  isPossibleDuplicate(householdId: string, transactionId: string): Promise<boolean>;
} {
  return { isPossibleDuplicate: (householdId, transactionId) => isDuplicateNow(deps, householdId, transactionId) };
}

/** The services of a duplicate-matching route; without them (never in the API process) the route answers 500. */
export function duplicateMatchingServices(ctx: ProtectedContext): DuplicateMatchingServices {
  const services = ctx.services as Partial<DuplicateMatchingServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as DuplicateMatchingServices;
}
