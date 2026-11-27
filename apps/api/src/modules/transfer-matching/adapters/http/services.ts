import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { CounterpartDeps, OneSidedDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-transfer-matching-services");

/**
 * What the API process wires for the transfer-matching routes (src/api.ts → `ctx.services`): the transactions module's
 * candidate pairs (and FR 24's counterparts of one transaction) and the official rates of fx-rates. The caller's space comes from `ctx.principal`.
 */
export interface TransferMatchingServices {
  readonly [BRAND]: true;
  readonly deps: CounterpartDeps;
  /**
   * IMP-03@PoC FR 14, FR 18, FR 23 (row 139a): «Односторонні», «Підтверджені» and «Шукати пари знову»; null when not
   * wired — those routes answer 500.
   */
  readonly oneSided: OneSidedDeps | null;
}

/**
 * `deps`: the proposals' (`ProposalDeps`), the candidates with IMP-03 FR 24's `counterpartsOf`, and the one-sided
 * transfers' ports (`oneSided`).
 */
export function createTransferMatchingServices(
  deps: CounterpartDeps & { readonly oneSided?: OneSidedDeps },
): TransferMatchingServices {
  const { oneSided, ...rest } = deps;
  return { [BRAND]: true, deps: rest, oneSided: oneSided ?? null };
}

/** The services of a transfer-matching route; without them (never in the API process) the route answers 500. */
export function transferMatchingServices(ctx: ProtectedContext): TransferMatchingServices {
  const services = ctx.services as Partial<TransferMatchingServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as TransferMatchingServices;
}
