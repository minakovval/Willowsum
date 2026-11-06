// Public interface of the feature-flags module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { FEATURE_KEYS } from "../plan-catalog/index.ts";
import { databaseFlagStore, featureFlagsRoutes } from "./adapters/index.ts";
import {
  createFlagAdmin,
  createFlagRuntime,
  type FlagAdmin,
  type FlagAudit,
  type FlagRuntime,
  type FlagRuntimeOptions,
} from "./application/index.ts";
import { FLAG_KEYS } from "./domain/index.ts";

export const featureFlagsModule = defineModule({
  name: "feature-flags",
  publishes: [],
  consumes: [],
  routes: featureFlagsRoutes,
});

// ARC-01 FR 7: every function of the feature catalogue has a flag, and every flag is a function of it.
{
  const missing = FEATURE_KEYS.filter((k) => !(FLAG_KEYS as readonly string[]).includes(k));
  const extra = FLAG_KEYS.filter((k) => !(FEATURE_KEYS as readonly string[]).includes(k));
  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `feature-flags: flags and feature keys differ (no flag: ${missing.join(", ") || "—"}; no feature key: ${extra.join(", ") || "—"})`,
    );
}

export { AUDIT_ENTITY, KILL_SWITCH_MAX_DELAY_MS, REFRESH_MS } from "./application/index.ts";
export type { FlagActor, FlagAdmin, FlagRuntime, FlagSnapshot } from "./application/index.ts";
export {
  FLAG_KEYS,
  FLAGS,
  FULL_ROLLOUT_MAX_DAYS,
  ROLLOUT_STAGES,
  bucketOf,
  flagReviewProblems,
  utcDay,
} from "./domain/index.ts";
export type { FlagDefinition, FlagKey, FlagKind, Rollout, RolloutStage } from "./domain/index.ts";

/** The flag check of one API process (src/api.ts): `db` is `ModuleDatabases.for("feature-flags")`. */
export function createFlagRuntimeFor(db: ModuleDatabase, options?: FlagRuntimeOptions): FlagRuntime {
  return createFlagRuntime(databaseFlagStore(db), options);
}

/**
 * The internal interface that changes flags, kill switches and test spaces, each change audited. `db` is
 * this module's database, `audit` the audit log (`createAuditLog(ModuleDatabases.for("audit"))`), `modules`
 * the modules that may be switched off.
 */
export function createFlagAdminFor(
  db: ModuleDatabase,
  audit: FlagAudit,
  modules: readonly string[],
): FlagAdmin {
  return createFlagAdmin({ store: databaseFlagStore(db), audit, modules });
}
