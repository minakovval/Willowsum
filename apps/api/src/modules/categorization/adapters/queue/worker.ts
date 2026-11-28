import type { HouseholdQueryRunner, ModuleDatabase } from "../../../../platform/db/module-db.ts";
import {
  defineJobHandler,
  postgresJobStore,
  requeueDeadJobs,
  type WorkerQueue,
} from "../../../../platform/queue/index.ts";
import {
  applyAudit,
  applyHandOff,
  applyMerge,
  applyRulesToNew,
  carryImportMerged,
  executeDerivation,
  moveRulesToCategory,
  runPart,
  RUN_PART_SIZE,
  type CategoryAudit,
  type CategoryFactsPort,
  type DerivationDeps,
  type RuleDeps,
  type RulesAuditLog,
} from "../../application/index.ts";
import { derivationsRun } from "../db/derivations.ts";
import { rulesTx } from "../db/rules.ts";
import { runsTx } from "../db/runs.ts";
import { categorizationTx } from "../db/store.ts";
import {
  AUDIT_JOB,
  CATEGORY_MERGED_JOB,
  HAND_OFF_JOB,
  HISTORY_DERIVATION_JOB,
  IMPORT_MERGED_JOB,
  RULE_RUN_PART_JOB,
  TRANSACTION_CREATED_JOB,
} from "./job.ts";

/** The jobs whose dead rows the daily recovery puts back; each one is idempotent. */
const JOBS = [
  HAND_OFF_JOB,
  CATEGORY_MERGED_JOB,
  TRANSACTION_CREATED_JOB,
  IMPORT_MERGED_JOB,
  AUDIT_JOB,
  RULE_RUN_PART_JOB,
  HISTORY_DERIVATION_JOB,
];

/** As liabilities' (#270 item 2): the space's erasure, which deletes the queue rows, waits for this lock. */
async function holdsJob(q: HouseholdQueryRunner, householdId: string, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`SELECT 1 FROM jobs WHERE household_id = $1 AND id = $2 FOR UPDATE`, [
    householdId,
    id,
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * The worker's categorization queue (src/wiring.ts): the store in the categorization schema, the hand-off's handler
 * (the audit entry through the audit log's public interface, ADR-0015, holding the job's row lock), the merge's (the
 * transactions and the rules of the merged category, BUD-01 FR 8, BUD-14 FR 10), the rules of a new transaction
 * (BUD-14 FR 8), the category of a merge on import (IMP-04 FR 5) and the audit entries of the rules.
 */
export function categorizationWorkerQueue(
  db: ModuleDatabase,
  audit: CategoryAudit,
  categories: CategoryFactsPort,
  rules: {
    readonly deps: RuleDeps;
    readonly audit: RulesAuditLog;
    /** The release flag of the rules (CICD-06): off — a new transaction takes nothing from a rule. */
    readonly enabled: (householdId: string) => Promise<boolean>;
    /** BUD-14 FR 7: the time a run ends (the start of its 7 days of «Відмінити»). */
    readonly clock: { now(): number };
  },
  /** BUD-21 FR 10: the derivation's ports; without them a derivation job fails and stays for the recovery. */
  derivations?: DerivationDeps,
): WorkerQueue {
  return {
    store: postgresJobStore(db),
    handlers: [
      defineJobHandler({
        job: HAND_OFF_JOB,
        run: async (job, q) => {
          if (await holdsJob(q, job.householdId, job.id))
            await applyHandOff(audit, job.householdId, job.payload);
        },
      }),
      defineJobHandler({
        job: CATEGORY_MERGED_JOB,
        run: async (job, q) => {
          await applyMerge(categorizationTx(q), categories, job.householdId, job.payload, {
            moveRules: (householdId, sourceId, targetId) =>
              moveRulesToCategory(rulesTx(q), householdId, sourceId, targetId),
          });
        },
      }),
      defineJobHandler({
        job: TRANSACTION_CREATED_JOB,
        run: async (job, q) => {
          // The routes answer 404 with the flag off, so nobody could switch a rule off: no rule applies either.
          if (!(await rules.enabled(job.householdId))) return;
          const outcome = await applyRulesToNew(
            categorizationTx(q),
            rulesTx(q),
            rules.deps,
            job.householdId,
            job.payload.transactionId,
          );
          // Another writer inserted the row first (a change by hand): run again, which then sees it.
          if (outcome === "conflict") throw new Error("categorization.transaction-created: version conflict");
        },
      }),
      defineJobHandler({
        job: IMPORT_MERGED_JOB,
        run: async (job, q) => {
          await carryImportMerged(categorizationTx(q), job.householdId, job.payload);
        },
      }),
      defineJobHandler({
        job: RULE_RUN_PART_JOB,
        run: async (job, q) => {
          // A run already begun goes on with the flag off: it was the user's choice and «Відмінити» needs its records.
          await runPart(categorizationTx(q), rulesTx(q), runsTx(q), rules.deps, {
            householdId: job.householdId,
            runId: job.payload.runId,
            limit: RUN_PART_SIZE,
            now: rules.clock.now(),
            chain: true,
          });
        },
      }),
      defineJobHandler({
        job: HISTORY_DERIVATION_JOB,
        // BUD-21 FR 10: the run in units of work of its own (the progress commits as it moves; the suggestions and
        // the end under the run's lock), so a run the request already finished is left as it is.
        run: async (job) => {
          if (!derivations) throw new Error("categorization: no history derivation ports wired");
          await executeDerivation(derivations, derivationsRun(db), job.householdId, job.payload.derivationId);
        },
      }),
      defineJobHandler({
        job: AUDIT_JOB,
        run: async (job, q) => {
          if (await holdsJob(q, job.householdId, job.id))
            await applyAudit(rules.audit, job.householdId, job.payload);
        },
      }),
    ],
  };
}

/**
 * The scheduler's daily recovery (src/wiring.ts, `categorization.recovery`; ADR-0015, #249): the space's dead jobs go
 * back in the queue before the retention cleanup. All are idempotent (a keyed entry; a merge moves only what still has
 * the merged category; the rules of a new transaction change nothing a second time).
 */
export async function requeueDeadJobsOf(db: ModuleDatabase, householdId: string): Promise<number> {
  let requeued = 0;
  for (const job of JOBS) requeued += await requeueDeadJobs(db, householdId, job.name);
  return requeued;
}
