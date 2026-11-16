/**
 * Process wiring that main.ts uses and tests can check without starting a process (CICD-06, ADR-0004): the
 * extra pool settings of the flag check and the readiness probe. Outside src/platform, because it wires a
 * module (feature-flags) to the platform.
 */
import type pg from "pg";
import {
  createAccountDirectory,
  createAccountsHandOffRecovery,
  createAccountsWorkerQueue,
} from "./modules/accounts/index.ts";
import { createAuditLog, type AuditLog } from "./modules/audit/index.ts";
import {
  createBulkActionsRecovery,
  createBulkActionsServices,
  createBulkActionsWorkerQueue,
  type BulkActionsServices,
} from "./modules/bulk-actions/index.ts";
import {
  categorizationSubscriptions,
  createCategorizationRecovery,
  createCategorizationWorkerQueue,
  createCategoryBulkActions,
} from "./modules/categorization/index.ts";
import { createCategoryDirectory } from "./modules/categories/index.ts";
import { checkFlagsReady, FLAGS_DB_TIMEOUTS, type FlagRuntime } from "./modules/feature-flags/index.ts";
import type { HouseholdSpaces, SpaceKeys } from "./modules/household/index.ts";
import { createIdentityMaintenance } from "./modules/identity/index.ts";
import {
  createLedger,
  createLedgerIntegrityCheck,
  type LedgerIntegrityAlerts,
} from "./modules/ledger/index.ts";
import {
  createGoalsHandOffRecovery,
  createGoalsWorkerQueue,
  goalsSubscriptions,
} from "./modules/goals/index.ts";
import { createDebtPayoffHandOffRecovery, createDebtPayoffWorkerQueue } from "./modules/debt-payoff/index.ts";
import { createMerchantsRecovery, createMerchantsWorkerQueue } from "./modules/merchants/index.ts";
import {
  createLiabilities,
  createLiabilitiesHandOffRecovery,
  createLiabilitiesWorkerQueue,
} from "./modules/liabilities/index.ts";
import {
  createTransactionLookup,
  createTransactionsHandOffRecovery,
  createTransactionsWorkerQueue,
} from "./modules/transactions/index.ts";
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
import { systemClock } from "./platform/adapters/index.ts";
import { randomUUID } from "node:crypto";

/**
 * The bulk actions of the selection panels (DAT-03@PoC FR 2), the same for the API (main.ts) and the worker: each
 * entity's target and each action come from the module that owns the fields, through its public interface.
 * «Змінити категорію» — categorization (BUD-01 b, wave 2 row 20; #272 item 1) on the target «transactions» (module
 * transactions' lookup). «Додати теги» (BUD-13 a, row 21) and «Підтвердити категорії» (BUD-12 a, row 24) come with
 * their fields; until then they are unknown actions.
 */
export function bulkActionsServicesFor(
  audit: Pick<AuditLog, "record">,
  databases: Pick<ModuleDatabases, "for">,
  clock: { now(): number } = systemClock,
): BulkActionsServices {
  const categories = createCategoryBulkActions({
    db: databases.for("categorization"),
    transactions: createTransactionLookup(databases.for("transactions")),
    categories: createCategoryDirectory({ db: databases.for("categories"), audit, newId: randomUUID }),
  });
  return createBulkActionsServices({
    targets: [...categories.targets],
    actions: [...categories.actions],
    audit,
    clock,
    newId: randomUUID,
  });
}

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
  readonly audit: Pick<AuditLog, "recordPlatform" | "record">;
  readonly spaces: Pick<HouseholdSpaces, "spaceIds" | "membershipOf">;
  readonly now?: () => number;
  readonly alertMail?: LedgerIntegrityAlerts["alertMail"];
  readonly spaceKeys?: Pick<SpaceKeys, "rewrapAll">;
}): DailyTask[] {
  const now = deps.now ?? Date.now;
  const maintenance = createIdentityMaintenance({
    db: deps.databases.for("identity"),
    audit: deps.audit,
    // ACC-04: a lapsed session the task ends is written to its space's sign-in journal.
    spaces: deps.spaces,
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
  const handOffRecovery = createAccountsHandOffRecovery(deps.databases.for("accounts"), () =>
    deps.spaces.spaceIds(),
  );
  const transactionsRecovery = createTransactionsHandOffRecovery(deps.databases.for("transactions"), () =>
    deps.spaces.spaceIds(),
  );
  const bulkActionsRecovery = createBulkActionsRecovery(deps.databases.for("bulk-actions"), () =>
    deps.spaces.spaceIds(),
  );
  const categorizationRecovery = createCategorizationRecovery(deps.databases.for("categorization"), () =>
    deps.spaces.spaceIds(),
  );
  const liabilitiesRecovery = createLiabilitiesHandOffRecovery(deps.databases.for("liabilities"), () =>
    deps.spaces.spaceIds(),
  );
  const goalsRecovery = createGoalsHandOffRecovery(deps.databases.for("goals"), () => deps.spaces.spaceIds());
  const debtPayoffRecovery = createDebtPayoffHandOffRecovery(deps.databases.for("debt-payoff"), () =>
    deps.spaces.spaceIds(),
  );
  const merchantsRecovery = createMerchantsRecovery(deps.databases.for("merchants"), () =>
    deps.spaces.spaceIds(),
  );
  const tasks: DailyTask[] = [
    { name: "identity.daily-cleanup", run: () => maintenance.dailyCleanup() },
    { name: "ledger.integrity-check", run: async () => void (await ledgerCheck.run()) },
    // ARC-04 FR 2–4 (ADR-0015): a hand-off the worker gave up on goes back to the accounts queue — before the
    // retention cleanup below, which would otherwise delete it after 30 days with the only copy of what it carries.
    {
      name: "accounts.hand-off-recovery",
      run: async () => {
        const requeued = await handOffRecovery.run();
        if (requeued > 0) logEvent("accounts.hand_off_requeued", "warn", { "ws.module": "accounts" });
      },
    },
    // The same for the transactions queue (ARC-04, ADR-0015): a transaction's journal event and audit entry.
    {
      name: "transactions.hand-off-recovery",
      run: async () => {
        const requeued = await transactionsRecovery.run();
        if (requeued > 0) logEvent("transactions.hand_off_requeued", "warn", { "ws.module": "transactions" });
      },
    },
    // The same for the bulk-actions queue (ARC-04 FR 4; DAT-03 FR 6, FR 9, FR 11): a part of a run, an undo, a group
    // audit entry. A part tried again from its first attempt goes on where the run stopped.
    {
      name: "bulk-actions.recovery",
      run: async () => {
        const requeued = await bulkActionsRecovery.run();
        if (requeued > 0) logEvent("bulk_actions.jobs_requeued", "warn", { "ws.module": "bulk-actions" });
      },
    },
    // The same for the categorization queue (ARC-04, ADR-0015; #249): the audit entry of a transaction's category and
    // «Категорію об'єднано» (BUD-01 FR 8).
    {
      name: "categorization.recovery",
      run: async () => {
        const requeued = await categorizationRecovery.run();
        if (requeued > 0) logEvent("categorization.jobs_requeued", "warn", { "ws.module": "categorization" });
      },
    },
    // The same for the liabilities queue (ARC-04, ADR-0015): a liability's audit entry.
    {
      name: "liabilities.hand-off-recovery",
      run: async () => {
        const requeued = await liabilitiesRecovery.run();
        if (requeued > 0) logEvent("liabilities.hand_off_requeued", "warn", { "ws.module": "liabilities" });
      },
    },
    // The same for the goals queue (ARC-04, ADR-0015, #249): a goal's or a contribution's audit entry.
    {
      name: "goals.hand-off-recovery",
      run: async () => {
        const requeued = await goalsRecovery.run();
        if (requeued > 0) logEvent("goals.hand_off_requeued", "warn", { "ws.module": "goals" });
      },
    },
    // The same for the debt-payoff queue (ARC-04, ADR-0015, #249): a saved or deleted plan's audit entry.
    {
      name: "debt-payoff.hand-off-recovery",
      run: async () => {
        const requeued = await debtPayoffRecovery.run();
        if (requeued > 0) logEvent("debt_payoff.hand_off_requeued", "warn", { "ws.module": "debt-payoff" });
      },
    },
    // The same for the merchants queue (ARC-04, ADR-0015, #249): the audit entry of a rename, a merge, «Роз'єднати».
    {
      name: "merchants.recovery",
      run: async () => {
        const requeued = await merchantsRecovery.run();
        if (requeued > 0) logEvent("merchants.jobs_requeued", "warn", { "ws.module": "merchants" });
      },
    },
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
 * The scheduler's retention cleanup goes over the same stores. `ledger` publishes «проводку записано» (ARC-11); goals
 * consumes it (BUD-05 AC5: a reversed transaction event cancels the spends made on it). `accounts`
 * runs its hand-off jobs (ARC-04 FR 2, #210): the ledger accounts and opening balances, the liability and the audit
 * entries of a create or a kind change, after the accounts transaction committed. `transactions` runs its hand-off jobs
 * the same way (ADR-0015): a transaction's journal event made to match its row, and its audit entry. `liabilities` runs
 * the audit entries of a registered liability and of a kind change, after the liabilities transaction committed.
 */
export function workerQueues(databases: Pick<ModuleDatabases, "for">): {
  readonly queues: readonly WorkerQueue[];
  readonly subscriptions: readonly EventSubscription[];
} {
  const audit = createAuditLog(databases.for("audit"));
  const ledger = createLedger(databases.for("ledger"));
  return {
    queues: [
      { store: postgresJobStore(databases.for("ledger")), handlers: [] },
      createAccountsWorkerQueue(databases.for("accounts"), {
        ledger,
        liabilities: createLiabilities(databases.for("liabilities"), audit),
        audit,
      }),
      // `categories` publishes «категорію об'єднано» (BUD-01 FR 8); categorization consumes it (below), budget and
      // recurring subscribe in the parts that bring them.
      { store: postgresJobStore(databases.for("categories")), handlers: [] },
      // BUD-01 b: the audit entries of a transaction's category and the merges of categories (ADR-0015).
      createCategorizationWorkerQueue(
        databases.for("categorization"),
        audit,
        createCategoryDirectory({ db: databases.for("categories"), audit, newId: randomUUID }),
      ),
      createTransactionsWorkerQueue(databases.for("transactions"), {
        accounts: createAccountDirectory(databases.for("accounts")),
        ledger,
        audit,
      }),
      // DAT-03: the parts of background bulk actions, undos and their group audit entries (ARC-04).
      createBulkActionsWorkerQueue(databases.for("bulk-actions"), bulkActionsServicesFor(audit, databases)),
      createLiabilitiesWorkerQueue(databases.for("liabilities"), audit),
      // BUD-05: the audit entries of goals, contributions and spends, after the goals transaction committed (ADR-0015),
      // and the ledger's reversals of spent transactions (AC5).
      createGoalsWorkerQueue(databases.for("goals"), audit),
      // BUD-19 a: the audit entries of saved and deleted debt payoff plans (ADR-0015).
      createDebtPayoffWorkerQueue(databases.for("debt-payoff"), audit),
      // BUD-14 a: the audit entries of merchants' renames, merges and «Роз'єднати» (ADR-0015).
      createMerchantsWorkerQueue(databases.for("merchants"), audit),
    ],
    subscriptions: [...categorizationSubscriptions, ...goalsSubscriptions],
  };
}
