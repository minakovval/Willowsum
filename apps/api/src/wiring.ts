/**
 * Process wiring that main.ts uses and tests can check without starting a process (CICD-06, ADR-0004): the
 * extra pool settings of the flag check and the readiness probe. Outside src/platform, because it wires a
 * module (feature-flags) to the platform.
 */
import type pg from "pg";
import { checkFlagsReady, FLAGS_DB_TIMEOUTS, type FlagRuntime } from "./modules/feature-flags/index.ts";
import type { Role } from "./platform/config/config.ts";
import type { ReadinessCheck } from "./platform/process/server.ts";
import { logEvent } from "./platform/telemetry/signals.ts";

/**
 * The flag runtime's reload health as log events (ARC-09): `flags.reload_failed` (ERROR, the error class only)
 * when reloads start failing, `flags.reload_recovered` when one succeeds again.
 */
export function flagReloadHealthLog(failure: string | undefined): void {
  if (failure === undefined) logEvent("flags.reload_recovered", "info", { "ws.module": "feature-flags" });
  else logEvent("flags.reload_failed", "error", { "ws.module": "feature-flags", "error.type": failure });
}

/**
 * Pool settings beyond the connection of one module's pool. The feature-flags pool serves the flag check of
 * every request: a statement, a connection and the client's wait end after 5–6 s, so it never hangs.
 */
export function modulePoolOptions(module: string): pg.PoolConfig {
  return module === "feature-flags" ? { ...FLAGS_DB_TIMEOUTS } : {};
}

/** The binding pool (`ws_context`) runs before every module transaction, the flag reloads included: same limits. */
export function contextPoolOptions(): pg.PoolConfig {
  return { ...FLAGS_DB_TIMEOUTS };
}

/**
 * The readiness probe (ARC-02 FR 4): the schema is at least this code's version; for the api role the flags
 * are fresh too (CICD-06: before they load, or once they are 60 s old, every module answers 503).
 */
export function readinessCheck(deps: {
  readonly role: Role;
  /** How many migrations this code ships that the database lacks. */
  readonly pendingMigrations: () => Promise<number>;
  readonly flags: Pick<FlagRuntime, "loaded" | "fresh" | "refresh">;
}): ReadinessCheck {
  return async () => {
    if ((await deps.pendingMigrations()) > 0) return { ready: false, reason: "schema-behind" };
    if (deps.role === "api") {
      const reason = await checkFlagsReady(deps.flags);
      if (reason !== "ok") return { ready: false, reason };
    }
    return { ready: true };
  };
}
