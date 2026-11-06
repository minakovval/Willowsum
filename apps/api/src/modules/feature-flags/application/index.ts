// Application layer of feature-flags: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { AUDIT_ENTITY, createFlagAdmin } from "./admin.ts";
export type { FlagAdmin } from "./admin.ts";
export type { FlagActor, FlagAudit, FlagSnapshot, FlagStore } from "./ports.ts";
export {
  checkFlagsReady,
  createFlagRuntime,
  flagsReadiness,
  flagOn,
  flagsOn,
  KILL_SWITCH_MAX_DELAY_MS,
  LOAD_WAIT_MS,
  REFRESH_MS,
} from "./runtime.ts";
export type { FlagCatalogue, FlagRuntime, FlagRuntimeOptions, FlagsReadiness } from "./runtime.ts";
