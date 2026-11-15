import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import {
  bulkRegistry,
  type BulkActionHandler,
  type BulkDeps,
  type BulkTarget,
} from "../../application/index.ts";

const BRAND = Symbol("willowsum-bulk-actions-services");

/** Records per part of a background run: «Оброблено X з N» moves every 25 records. */
export const PART_SIZE = 25;

/**
 * What the API process and the worker wire for bulk actions (src/api.ts → `ctx.services`; src/wiring.ts): the targets
 * (one per entity, the owning module's public interface), the actions of the selection panels, the audit log of the
 * group entry, the clock and ids.
 */
export interface BulkActionsServices {
  readonly [BRAND]: true;
  readonly deps: BulkDeps;
  readonly audit: Pick<AuditLog, "record">;
}

export function createBulkActionsServices(options: {
  readonly targets: readonly BulkTarget[];
  readonly actions: readonly BulkActionHandler[];
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
  readonly partSize?: number;
}): BulkActionsServices {
  return {
    [BRAND]: true,
    deps: {
      registry: bulkRegistry(options.targets, options.actions),
      clock: options.clock,
      newId: options.newId,
      partSize: options.partSize ?? PART_SIZE,
    },
    audit: options.audit,
  };
}

/** The services of a bulk-actions route; without them (never in the API process) the route answers 500. */
export function bulkActionsServices(ctx: ProtectedContext): BulkActionsServices {
  const services = ctx.services as Partial<BulkActionsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as BulkActionsServices;
}
