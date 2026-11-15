import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { DuplicateDeps } from "../../application/index.ts";
import { isPossibleDuplicate, MATCH_WINDOW_DAYS, type DuplicatePair } from "../../domain/index.ts";

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
 * The rule the transactions module applies before «Приховати транзакцію» (FIN-03 FR 18; its `DuplicateCheck`, wired in
 * src/main.ts), pure: the window of its search, and whether any pair it found is a «Можливий дубль» now. The search runs
 * in the transactions transaction of the change, under its lock.
 */
export function createDuplicateCheck(): {
  readonly windowDays: number;
  isPossibleDuplicate(pairs: readonly DuplicatePair[]): boolean;
} {
  return {
    windowDays: MATCH_WINDOW_DAYS,
    isPossibleDuplicate: (pairs) => pairs.some((p) => isPossibleDuplicate(p.first, p.second)),
  };
}

/** The services of a duplicate-matching route; without them (never in the API process) the route answers 500. */
export function duplicateMatchingServices(ctx: ProtectedContext): DuplicateMatchingServices {
  const services = ctx.services as Partial<DuplicateMatchingServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as DuplicateMatchingServices;
}
