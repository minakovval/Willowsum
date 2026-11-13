import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { SpaceRenameAudit } from "../../application/index.ts";

const BRAND = Symbol("willowsum-household-services");

/** What the API process wires for household's routes (src/api.ts → `ctx.services`): the space's audit log. */
export interface HouseholdServices {
  readonly [BRAND]: true;
  readonly audit: Pick<AuditLog, "record">;
}

export function createHouseholdServices(options: {
  readonly audit: Pick<AuditLog, "record">;
}): HouseholdServices {
  return { [BRAND]: true, audit: options.audit };
}

/** The services of a household route; without them (never in the API process) the route answers 500. */
export function householdServices(ctx: ProtectedContext): HouseholdServices {
  const services = ctx.services as Partial<HouseholdServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as HouseholdServices;
}

/** The rename's entry in the space's own log (П-10): the old and the new name, by the Owner's account. */
export function renameAudit(services: HouseholdServices): SpaceRenameAudit {
  return {
    async spaceRenamed(householdId, accountId, before, after) {
      await services.audit.record(householdId, {
        actor: { kind: "user", id: accountId },
        channel: "web",
        entity: { type: "household.space", id: householdId },
        action: "update",
        changes: [{ field: "name", before, after, sensitive: false }],
      });
    },
  };
}
