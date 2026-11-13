/**
 * Process wiring that main.ts uses and tests can check without starting a process (CICD-06, ADR-0004): the
 * extra pool settings of the flag check and the readiness probe. Outside src/platform, because it wires a
 * module (feature-flags) to the platform.
 */
import type pg from "pg";
import type { AuditLog } from "./modules/audit/index.ts";
import { checkFlagsReady, FLAGS_DB_TIMEOUTS, type FlagRuntime } from "./modules/feature-flags/index.ts";
import type { HouseholdSpaces } from "./modules/household/index.ts";
import { createIdentityMaintenance } from "./modules/identity/index.ts";
import { createLedgerIntegrityCheck, type LedgerIntegrityAlerts } from "./modules/ledger/index.ts";
import type { Role } from "./platform/config/config.ts";
import type { ModuleDatabases } from "./platform/db/module-db.ts";
import type { DailyTask } from "./platform/process/daily.ts";
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

/**
 * The scheduler role's daily tasks (ADR-0010), in the order they run. NFR-12@PoC: the only automatic deletion of
 * a person's data is identity's removal of unconfirmed accounts 30 days after their latest sign-up; no other task
 * here deletes the data of an account or a space. `now` is the clock of the tasks that judge rows by age (tests
 * pass their own; main.ts the wall clock). `alertMail` is the mail adapter and the product owner's address for the
 * integrity letter (FIN-04 FR 10); without it a discrepancy is an «error» event that no letter could go out.
 */
export function schedulerDailyTasks(deps: {
  readonly databases: Pick<ModuleDatabases, "for">;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly spaces: Pick<HouseholdSpaces, "spaceIds">;
  readonly now?: () => number;
  readonly alertMail?: LedgerIntegrityAlerts["alertMail"];
}): DailyTask[] {
  const maintenance = createIdentityMaintenance({
    db: deps.databases.for("identity"),
    audit: deps.audit,
    ...(deps.now ? { now: deps.now } : {}),
  });
  // FIN-04 FR 9, FR 10: the ledger's daily integrity check over every space (a failure is an «error» log event) and
  // one letter to the product owner per discrepancy period; without a recipient, an «error» event instead.
  const ledgerCheck = createLedgerIntegrityCheck(
    deps.databases.for("ledger"),
    () => deps.spaces.spaceIds(),
    undefined,
    undefined,
    deps.alertMail ? { alertMail: deps.alertMail } : {},
  );
  return [
    { name: "identity.daily-cleanup", run: () => maintenance.dailyCleanup() },
    { name: "ledger.integrity-check", run: async () => void (await ledgerCheck.run()) },
  ];
}
