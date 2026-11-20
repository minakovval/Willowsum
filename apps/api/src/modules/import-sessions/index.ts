// Public interface of the import-sessions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { FileStorage } from "../file-storage/index.ts";
import type { ImportedTransactions } from "../transactions/index.ts";
import {
  applyTx,
  applicationsTx,
  batchesAudit,
  batchesTx,
  batchesWorkerQueue,
  fileOriginals,
  importSessionsRoutes,
  parsePorts,
  requeueDeadHandOffs,
  type ParseModules,
  spaceTx,
} from "./adapters/index.ts";
import {
  type StoredApplication,
  applyHandOff,
  deleteStaleBatches,
  readinessOf,
  recordChecks,
  recoverStuckApplications,
  recoverStuckRollbacks,
  type BatchReadiness,
  type RollbackPorts,
  type FileReview,
  type RecordInput,
} from "./application/index.ts";

export const importSessionsModule = defineModule({
  name: "import-sessions",
  publishes: [],
  consumes: [],
  routes: importSessionsRoutes,
});

export {
  createImportSessionsServices,
  HAND_OFF_JOB,
  PARSE_FILE_JOB,
  type ApplyServices,
  type ImportSessionsServices,
  type ParseModules,
  type ParseServices,
} from "./adapters/index.ts";
export { BatchNotFoundError } from "./application/index.ts";
export {
  BATCH_LIMITS,
  BATCH_STATES,
  canMove,
  PARSE_FILES_PER_HOUR,
  UNAPPLIED_RETENTION_DAYS,
} from "./domain/index.ts";
export type { BatchState } from "./domain/index.ts";
export {
  APPLICATION_COUNTS_MAX,
  APPLY_ROWS_MAX,
  APPLY_UNSUPPORTED,
  STUCK_AFTER_MS,
  ApplicationResultError,
  ROW_ISSUES,
  READINESS_CODES,
  READINESS_MESSAGES,
} from "./application/index.ts";
export type {
  ApplicationResult,
  StoredApplication,
  BalanceChoice,
  BatchReadiness,
  DecisionInput,
  FilePlan,
  FileReview,
  Readiness,
  ReadinessCode,
  RecordInput,
  Refusal,
} from "./application/index.ts";

/**
 * IMP-05@PoC part 2 (wave 2 row 42): the batch's review for the steps that are not routes yet. `record` keeps one
 * accepted file's checks from the parse (file-parsers `StatementChecks`) with the history gap against the last applied
 * statement of the same account in the space (FR 3); the batch must be «в обробці» (the parse step calls it).
 * `readiness` is FR 11: the refusals and each file's plan (balance choice, excluded, flipped and forced rows, readings,
 * the date order) — the apply step refuses unless `ready`.
 */
export function createImportSessionsReview(options: {
  readonly db: ModuleDatabase;
  readonly audit: Pick<AuditLog, "record">;
  readonly now: () => number;
  readonly newId: () => string;
}): {
  record(householdId: string, input: RecordInput): Promise<FileReview>;
  readiness(householdId: string, batchId: string): Promise<BatchReadiness>;
} {
  const audit = batchesAudit(options.audit);
  const deps = { newId: options.newId, now: () => new Date(options.now()) };
  return {
    async record(householdId, input) {
      const { result, handOffs } = await options.db.inHousehold(householdId, (q) =>
        recordChecks(deps, batchesTx(q), input),
      );
      // The entries right away; a failure leaves them to the worker (the jobs are queued, ARC-04 FR 2).
      for (const h of handOffs) await applyHandOff(audit, householdId, h).catch(() => undefined);
      return result;
    },
    readiness: (householdId, batchId) =>
      options.db.inHousehold(householdId, (q) => readinessOf(batchesTx(q), batchId)),
  };
}

/**
 * IMP-04@PoC a) (wave 2 row 43). `sameFileApplied` is FR 3: the applied batch with a file of the same content (SHA-256
 * of the bytes) as this batch file for the same account, or null. `find` is FR 7: the stored result of the batch's
 * apply (`POST /v1/import/batches/{batchId}/apply`).
 */
export function createImportSessionsApplications(options: { readonly db: ModuleDatabase }): {
  sameFileApplied(householdId: string, batchFileId: string, accountId: string): Promise<string | null>;
  find(householdId: string, batchId: string): Promise<StoredApplication | null>;
} {
  return {
    sameFileApplied: (householdId, batchFileId, accountId) =>
      options.db.inHousehold(householdId, (q) => applicationsTx(q).sameFileApplied(batchFileId, accountId)),
    find: (householdId, batchId) =>
      options.db.inHousehold(householdId, (q) => applicationsTx(q).find(batchId)),
  };
}

/**
 * The worker's import-sessions queue (ARC-04 FR 2, FR 3; src/wiring.ts): the audit hand-off jobs (FR 21) and, with
 * `parse`, the parse of each accepted file (FR 5; a heavy job: at most the worker's heavy limit at a time).
 */
export function createImportSessionsWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
  parse?: { readonly modules: ParseModules; readonly now: () => number; readonly newId: () => string },
): WorkerQueue {
  return batchesWorkerQueue(
    db,
    batchesAudit(audit),
    parse
      ? {
          ports: parsePorts(parse.modules),
          deps: { newId: parse.newId, now: () => new Date(parse.now()) },
        }
      : undefined,
  );
}

/** The scheduler's daily recovery of the hand-off (ARC-04 FR 4, #249): dead hand-off jobs go back to the queue. */
export function createImportSessionsHandOffRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadHandOffs(db, householdId);
      return requeued;
    },
  };
}

/**
 * The scheduler's daily recovery of applies stuck «in progress» (IMP-01@PoC FR 11, IMP-04@PoC FR 7; #654): in every
 * space, an apply whose request ended after it stored its result «in progress» and that nobody retried for
 * `STUCK_AFTER_MS` is settled with module transactions — its rows written: finished with their counts and its audit
 * entry; not written: given up, the batch back in its state. Also a rollback whose request ended after module
 * transactions rolled the batch back (IMP-16@PoC FR 3, FR 9): the batch «відкочено» with the recorded mode, actor and
 * count, and its audit entry. Returns how many were settled or finished.
 */
export function createImportSessionsApplyRecovery(options: {
  readonly db: ModuleDatabase;
  readonly transactions: Pick<ImportedTransactions, "settle" | "rolledBackSince">;
  readonly audit: Pick<AuditLog, "record">;
  readonly households: () => Promise<readonly string[]>;
  readonly now: () => number;
  readonly newId: () => string;
}): { run(): Promise<number> } {
  const audit = batchesAudit(options.audit);
  const deps = { newId: options.newId, now: () => new Date(options.now()) };
  return {
    async run() {
      let settled = 0;
      let failed = 0;
      for (const householdId of await options.households()) {
        try {
          const run: RollbackPorts["run"] = (work) =>
            options.db.inHousehold(householdId, (q) => work(applyTx(q)));
          const applies = await recoverStuckApplications(deps, {
            run,
            settle: (input) => options.transactions.settle(householdId, input),
          });
          // The entries right away; a failure leaves them to the worker (the jobs are queued, ARC-04 FR 2).
          for (const h of applies.handOffs) await applyHandOff(audit, householdId, h).catch(() => undefined);
          const rollbacks = await recoverStuckRollbacks(deps, run, (since, before) =>
            options.transactions.rolledBackSince(householdId, since, before),
          );
          for (const h of rollbacks.handOffs)
            await applyHandOff(audit, householdId, h).catch(() => undefined);
          settled += applies.result.settled + rollbacks.result.finished;
          // An apply or a rollback that could not be finished stays for the next run: the task fails (a count only).
          if (applies.result.failed > 0 || rollbacks.result.failed > 0) failed += 1;
        } catch {
          // One space's failure does not keep the others'; the task still fails (a count, never the space).
          failed += 1;
        }
      }
      if (failed > 0) throw new Error(`import-sessions.apply-recovery failed in ${failed} space(s)`);
      return settled;
    },
  };
}

/**
 * The scheduler's daily cleanup (IMP-01@PoC FR 20, AC9; IMP-19@PoC FR 6, AC2): in every space, unapplied batches 30
 * days after their last action go with their originals; applied and rolled-back ones stay. Returns how many went.
 */
export function createImportSessionsCleanup(options: {
  readonly db: ModuleDatabase;
  readonly files: Pick<FileStorage, "store" | "remove" | "link" | "open">;
  readonly audit: Pick<AuditLog, "record">;
  readonly households: () => Promise<readonly string[]>;
  readonly now: () => number;
  readonly newId: () => string;
}): { run(): Promise<number> } {
  const originals = fileOriginals(options.files);
  const audit = batchesAudit(options.audit);
  const deps = { newId: options.newId, now: () => new Date(options.now()) };
  return {
    async run() {
      let deleted = 0;
      let failed = 0;
      for (const householdId of await options.households()) {
        try {
          const { result, handOffs } = await deleteStaleBatches(
            deps,
            spaceTx(options.db, householdId),
            originals,
            householdId,
          );
          deleted += result;
          // The entries right away; a failure leaves them to the worker (the jobs are queued, ARC-04 FR 2).
          for (const h of handOffs) await applyHandOff(audit, householdId, h).catch(() => undefined);
        } catch {
          // One space's failure does not keep the others' batches; the task still fails (a count, never the space).
          failed += 1;
        }
      }
      if (failed > 0) throw new Error(`import-sessions.cleanup failed in ${failed} space(s)`);
      return deleted;
    },
  };
}
