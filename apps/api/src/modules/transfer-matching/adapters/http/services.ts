import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { ProposalDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-transfer-matching-services");

/**
 * What the API process wires for the transfer-matching routes (src/api.ts → `ctx.services`): the transactions module's
 * candidate pairs and the official rates of fx-rates. The caller's space comes from `ctx.principal`.
 */
export interface TransferMatchingServices {
  readonly [BRAND]: true;
  readonly deps: ProposalDeps;
}

export function createTransferMatchingServices(deps: ProposalDeps): TransferMatchingServices {
  return { [BRAND]: true, deps };
}

/** The services of a transfer-matching route; without them (never in the API process) the route answers 500. */
export function transferMatchingServices(ctx: ProtectedContext): TransferMatchingServices {
  const services = ctx.services as Partial<TransferMatchingServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as TransferMatchingServices;
}
