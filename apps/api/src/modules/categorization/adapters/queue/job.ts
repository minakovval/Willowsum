import { z } from "zod";
import type { HouseholdQueryRunner } from "../../../../platform/db/module-db.ts";
import { defineJob, enqueueJob } from "../../../../platform/queue/index.ts";
import { categoryMerged } from "../../../categories/index.ts";
import { transactionCreated, transactionImportMerged } from "../../../transactions/index.ts";
import { handOffKey, type AuditHandOff, type CategoryHandOff } from "../../application/index.ts";
import { CATEGORY_SOURCES } from "../../domain/index.ts";

const side = z.strictObject({ categoryId: z.uuid().nullable(), source: z.enum(CATEGORY_SOURCES) });

/** The payload of `categorization.hand-off` (application/hand-off.ts), checked when enqueued and run. */
const handOffSchema = z.strictObject({
  transactionId: z.uuid(),
  actorAccountId: z.uuid(),
  version: z.number().int().min(1),
  before: side,
  after: side,
}) satisfies z.ZodType<CategoryHandOff>;

/**
 * ARC-04 FR 2, FR 3: the hand-off of a change of a transaction's category to the audit log, in the categorization
 * queue (migrations/0002_queue.sql). Light; retried up to 8 times, then dead-lettered (ADR-0014) and put back daily
 * (`categorization.recovery`).
 */
export const HAND_OFF_JOB = defineJob({ name: "categorization.hand-off", schema: handOffSchema });

/**
 * BUD-01 FR 8: «Категорію об'єднано» of module categories (`categories.merged` v1), one job per event (its id is the
 * key): the transactions of the merged category take the target.
 */
export const CATEGORY_MERGED_JOB = defineJob({
  name: "categorization.category-merged",
  schema: categoryMerged.schema,
});

/** Enqueues the hand-off in the caller's categorization transaction; the same change twice is one job. */
export async function enqueueHandOff(q: HouseholdQueryRunner, handOff: CategoryHandOff): Promise<void> {
  await enqueueJob(q, HAND_OFF_JOB, handOffKey(handOff), handOff as z.infer<typeof handOffSchema>);
}

/**
 * BUD-14 FR 8: «Нова транзакція» of module transactions (`transactions.created` v1), one job per event: the space's
 * category rules set its category (application/rules.ts `applyRulesToNew`).
 */
export const TRANSACTION_CREATED_JOB = defineJob({
  name: "categorization.transaction-created",
  schema: transactionCreated.schema,
});

/**
 * IMP-04 FR 5 (#658): «Злито з імпортом» of module transactions (`transactions.import-merged` v1), one job per event:
 * the bank's row takes the category of the manual one merged into it (`carryImportMerged`).
 */
export const IMPORT_MERGED_JOB = defineJob({
  name: "categorization.import-merged",
  schema: transactionImportMerged.schema,
});

/**
 * BUD-14 «Обов'язково пишуться в журнал аудиту: зміни правил … застосування»: the audit entry of a change of a rule or
 * of a rule's category on a new transaction (ADR-0015), keyed by the entry's own key. Ids, codes and positions only:
 * the conditions are a masked marker.
 */
const auditSchema = z.strictObject({
  key: z.string().regex(/^categorization\.[A-Za-z0-9:._-]{1,180}$/),
  actorAccountId: z.uuid().nullable(),
  entity: z.enum([
    "categorization.rule",
    "categorization.transaction-category",
    "categorization.rule-run",
    "categorization.history-derivation",
  ]),
  entityId: z.uuid(),
  action: z.enum(["create", "update", "delete"]),
  changes: z
    .array(
      z.strictObject({
        field: z.enum([
          "conditions",
          "tags",
          "position",
          "categoryId",
          "accountIds",
          "enabled",
          "source",
          "ruleId",
          // BUD-14 FR 7: a run of «Застосувати до N наявних…» and its «Відмінити» (counts and states only).
          "count",
          "changed",
          "skippedManual",
          "status",
          "restored",
          "notRestored",
          // BUD-21 FR 26: the start of a derivation — its history batch (an id), how many rows.
          "batchId",
          // BUD-21 FR 22, FR 23, FR 26 (row 237): a rule «з історії», an acceptance (how many, the tags created, the run)
          // and a rejection.
          "origin",
          "derivationId",
          "accepted",
          "tagsCreated",
          "runId",
          "rejected",
        ]),
        before: z.string().max(1000).nullable(),
        after: z.string().max(1000).nullable(),
        sensitive: z.boolean(),
      }),
    )
    .max(10),
}) satisfies z.ZodType<AuditHandOff>;

export const AUDIT_JOB = defineJob({ name: "categorization.audit", schema: auditSchema });

/**
 * BUD-14 FR 7, EC1: the next part of a run of «Застосувати до N наявних транзакцій» or of its «Відмінити» (100 records,
 * application/runs.ts). Keyed by the run, its state and how far it got; idempotent: a part takes only the records
 * still pending under the run's lock. Dead ones go back with the daily recovery.
 */
export const RULE_RUN_PART_JOB = defineJob({
  name: "categorization.rule-run-part",
  schema: z.strictObject({ runId: z.uuid() }),
});

/**
 * BUD-21 FR 10: a derivation of rules from a history file in the background (application/derivations.ts) — the
 * fallback of the request's own run and the run of more than 2 000 rows. Keyed by the run; idempotent: a run no longer
 * running is left as it is. Heavy (up to 20 000 rows); dead ones go back with the daily recovery.
 */
export const HISTORY_DERIVATION_JOB = defineJob({
  name: "categorization.history-derivation",
  schema: z.strictObject({ derivationId: z.uuid() }),
  heavy: true,
});
