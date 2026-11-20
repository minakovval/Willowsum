// Public interface of the import-sessions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { FileStorage } from "../file-storage/index.ts";
import {
  applicationsTx,
  batchesAudit,
  batchesTx,
  batchesWorkerQueue,
  fileOriginals,
  importSessionsRoutes,
  requeueDeadHandOffs,
  spaceTx,
} from "./adapters/index.ts";
import {
  BatchNotFoundError,
  checkedResult,
  type ApplicationResult,
  type StoredApplication,
  applyHandOff,
  deleteStaleBatches,
  readinessOf,
  recordChecks,
  type BatchReadiness,
  type FileReview,
  type RecordInput,
} from "./application/index.ts";

export const importSessionsModule = defineModule({
  name: "import-sessions",
  publishes: [],
  consumes: [],
  routes: importSessionsRoutes,
});

export { createImportSessionsServices, HAND_OFF_JOB, type ImportSessionsServices } from "./adapters/index.ts";
export { BatchNotFoundError } from "./application/index.ts";
export { BATCH_LIMITS, BATCH_STATES, canMove, UNAPPLIED_RETENTION_DAYS } from "./domain/index.ts";
export type { BatchState } from "./domain/index.ts";
export {
  APPLICATION_COUNTS_MAX,
  ApplicationResultError,
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
 * IMP-04@PoC a) (wave 2 row 43) for the apply step, which is not a route yet. `sameFileApplied` is FR 3: the applied
 * batch with a file of the same content (SHA-256 of the bytes) as this batch file, or null. `find` and `recordOnce` are
 * FR 7: one stored result per batch; `recordOnce` locks the batch (a batch of another space or a deleted one —
 * `BatchNotFoundError`) and stores the result unless one is stored — `first` false: the stored one, create nothing.
 */
export function createImportSessionsApplications(options: {
  readonly db: ModuleDatabase;
  readonly now: () => number;
}): {
  sameFileApplied(householdId: string, batchFileId: string): Promise<string | null>;
  find(householdId: string, batchId: string): Promise<StoredApplication | null>;
  recordOnce(
    householdId: string,
    input: { readonly batchId: string; readonly actorId: string; readonly result: ApplicationResult },
  ): Promise<{ readonly application: StoredApplication; readonly first: boolean }>;
} {
  return {
    sameFileApplied: (householdId, batchFileId) =>
      options.db.inHousehold(householdId, (q) => applicationsTx(q).sameFileApplied(batchFileId)),
    find: (householdId, batchId) =>
      options.db.inHousehold(householdId, (q) => applicationsTx(q).find(batchId)),
    recordOnce: (householdId, input) =>
      options.db.inHousehold(householdId, async (q) => {
        const result = checkedResult(input.result);
        if (!(await batchesTx(q).lockBatch(input.batchId))) throw new BatchNotFoundError();
        const tx = applicationsTx(q);
        const earlier = await tx.find(input.batchId);
        if (earlier) return { application: earlier, first: false };
        const application: StoredApplication = {
          batchId: input.batchId,
          result,
          appliedBy: input.actorId,
          appliedAt: new Date(options.now()),
        };
        await tx.insert(application);
        return { application, first: true };
      }),
  };
}

/** The worker's import-sessions queue (ARC-04 FR 2, FR 3; src/wiring.ts): the audit hand-off jobs (FR 21). */
export function createImportSessionsWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return batchesWorkerQueue(db, batchesAudit(audit));
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
