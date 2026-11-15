import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import type { AuditLog } from "../../../audit/index.ts";
import type { CategoriesAudit, CategoriesDeps } from "../../application/index.ts";

const BRAND = Symbol("willowsum-categories-services");

/** What the API process wires for the categories routes (src/api.ts → `ctx.services`): the audit log and the clock. */
export interface CategoriesServices {
  readonly [BRAND]: true;
  readonly deps: CategoriesDeps;
}

export function createCategoriesServices(options: {
  readonly audit: Pick<AuditLog, "record">;
  readonly clock: { now(): number };
  readonly newId: () => string;
}): CategoriesServices {
  return {
    [BRAND]: true,
    deps: { audit: categoriesAudit(options.audit), newId: options.newId, now: () => options.clock.now() },
  };
}

/** The services of a categories route; without them (never in the API process) the route answers 500. */
export function categoriesServices(ctx: ProtectedContext): CategoriesServices {
  const services = ctx.services as Partial<CategoriesServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as CategoriesServices;
}

/**
 * The tree's entries in the space's own log (BUD-01 «Права доступу», П-10): who, when, each field before and after —
 * on a change only the fields that changed. Names are kept as typed: they are the before and after the log must show
 * (lead decision; the log is the space's own, BUD-01).
 */
export function categoriesAudit(audit: Pick<AuditLog, "record">): CategoriesAudit {
  return {
    async changed(householdId, actor, entity, action, before, after) {
      await audit.record(householdId, {
        actor: actor === "system" ? { kind: "system" } : { kind: "user", id: actor.accountId },
        channel: actor === "system" ? "system" : "web",
        entity,
        action,
        changes: Object.keys(after)
          .filter((field) => before === null || before[field] !== after[field])
          .map((field) => ({
            field,
            before: before?.[field] ?? null,
            after: after[field] ?? null,
            sensitive: false,
          })),
      });
    },
  };
}
