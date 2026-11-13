/**
 * Process wiring that main.ts uses and tests can check without starting a process (CICD-06, ADR-0004): the
 * extra pool settings of the flag check and the readiness probe. Outside src/platform, because it wires a
 * module (feature-flags) to the platform.
 */
import type pg from "pg";
import type { AuditLog } from "./modules/audit/index.ts";
import { checkFlagsReady, FLAGS_DB_TIMEOUTS, type FlagRuntime } from "./modules/feature-flags/index.ts";
import type { HouseholdSpaces, SpaceKeys } from "./modules/household/index.ts";
import { createIdentityMaintenance } from "./modules/identity/index.ts";
import { createLedgerIntegrityCheck, type LedgerIntegrityAlerts } from "./modules/ledger/index.ts";
import type { Role } from "./platform/config/config.ts";
import type { ModuleDatabases } from "./platform/db/module-db.ts";
import type { DailyTask } from "./platform/process/daily.ts";
import {
  DEFAULT_CONCURRENCY,
  postgresJobStore,
  purgeQueues,
  type EventSubscription,
  type WorkerQueue,
} from "./platform/queue/index.ts";
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

/**
 * Connections per module pool. The worker holds one connection of a module for each job it runs (the handler and the
 * job's `done` share one transaction) and needs one more for the next pass's dispatch and claim, so its pools get
 * `DEFAULT_CONCURRENCY + 1`; with fewer, a fourth job of one module waits for a connection and the serial pass behind
 * it stalls the whole worker (review of #174, N1). The other roles keep the default of `ModuleDatabases` (3).
 */
export function modulePoolSize(role: Role): number | undefined {
  return role === "worker" ? DEFAULT_CONCURRENCY + 1 : undefined;
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
 * here deletes the data of an account or a space (the queue's retention cleanup deletes only the queue's working
 * copies — events already handed over and finished jobs — never the records they report). `now` is the clock of the tasks that judge rows by age (tests
 * pass their own; main.ts the wall clock). `alertMail` is the mail adapter and the product owner's address for the
 * integrity letter (FIN-04 FR 10); without it a discrepancy is an «error» event that no letter could go out.
 * `spaceKeys` adds the rewrap of the keys of spaces after a master key rotation (ARC-06 FR 3; ADR-0012); it changes
 * only the wrap of a key, never the data of a space (main.ts always passes it).
 */
export function schedulerDailyTasks(deps: {
  readonly databases: Pick<ModuleDatabases, "for">;
  readonly audit: Pick<AuditLog, "recordPlatform">;
  readonly spaces: Pick<HouseholdSpaces, "spaceIds">;
  readonly now?: () => number;
  readonly alertMail?: LedgerIntegrityAlerts["alertMail"];
  readonly spaceKeys?: Pick<SpaceKeys, "rewrapAll">;
}): DailyTask[] {
  const now = deps.now ?? Date.now;
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
  const tasks: DailyTask[] = [
    { name: "identity.daily-cleanup", run: () => maintenance.dailyCleanup() },
    { name: "ledger.integrity-check", run: async () => void (await ledgerCheck.run()) },
    // ARC-04 retention: dispatched events and finished jobs of every queue (platform/queue/retention.ts). Only the
    // queue's working copies go; the changes they report stay in the modules' own tables.
    {
      name: "queue.retention-cleanup",
      run: () =>
        purgeQueues({
          stores: workerQueues(deps.databases).queues.map((q) => q.store),
          households: () => deps.spaces.spaceIds(),
          now,
        }),
    },
  ];
  const spaceKeys = deps.spaceKeys;
  if (spaceKeys)
    tasks.push({
      name: "household.space-keys",
      run: async () => {
        const result = await spaceKeys.rewrapAll();
        // Counts only: never a space's id, a key or its wrap.
        if (result.failed > 0)
          logEvent("household.space_keys_failed", "error", {
            "ws.module": "household",
            "ws.household.spaces": result.failed,
          });
      },
    });
  return tasks;
}

/**
 * The worker role's queues (ARC-04): each module that publishes events or runs jobs adds its store
 * (`postgresJobStore(databases.for(<module>))`) and handlers here, and each consumer of an event its subscription.
 * The scheduler's retention cleanup goes over the same stores. `ledger` publishes «проводку записано» (ARC-11); no
 * module consumes it yet, so the worker marks its events dispatched and hands them to no one (ADR-0014).
 */
export function workerQueues(databases: Pick<ModuleDatabases, "for">): {
  readonly queues: readonly WorkerQueue[];
  readonly subscriptions: readonly EventSubscription[];
} {
  return {
    queues: [{ store: postgresJobStore(databases.for("ledger")), handlers: [] }],
    subscriptions: [],
  };
}
