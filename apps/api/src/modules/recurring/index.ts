// Public interface of the recurring module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { EventSubscription, WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import { categoryMerged, type CategoryUsage } from "../categories/index.ts";
import type { Money } from "@willowsum/domain-kernel";
import {
  CATEGORY_MERGED_JOB,
  eraseHouseholdRecurring,
  HAND_OFF_JOB,
  recurringAudit,
  recurringRoutes,
  recurringTx,
  recurringWorkerQueue,
  requeueDeadRecurringJobs,
  type RecurringServices,
} from "./adapters/index.ts";
import { trackSpace } from "./application/index.ts";
import { chargesInMonth, type ChargeStatus } from "./domain/index.ts";

export const recurringModule = defineModule({
  name: "recurring",
  publishes: [],
  consumes: [categoryMerged],
  routes: recurringRoutes,
});

export { createRecurringServices, type RecurringServices } from "./adapters/index.ts";
export { HISTORY_DAYS } from "./application/index.ts";
export { detectSeries, FREQUENCIES, isFresh, nextDate, scheduleDate } from "./domain/index.ts";
export type { Charge, ChargeStatus, Frequency, Series } from "./domain/index.ts";

/**
 * The space's regular charges of one calendar month (YYYY-MM) as the budget reads them (BUD-03@PoC FR 3, FR 5;
 * BUD-02@PoC FR 3, FR 15, FR 16, FR 19): every charge of an active payment — not «Можливо, скасований», not after its end
 * date — with its status as «Регулярні платежі» shows it now (FR 8–10, FR 20, FR 21: «Сплачено», «Сплачено із
 * запізненням», «Пропущено», «Очікується», «Прострочено на N дн.»), the later dates of the month «Очікується». Amounts in
 * the payment's currency. Read only (the expected amount the charges changed is written by «Регулярні платежі» itself);
 * every call is bound to one space.
 */
export interface RecurringMonth {
  chargesIn(
    householdId: string,
    month: string,
  ): Promise<
    readonly {
      readonly paymentId: string;
      readonly type: "expense" | "income";
      readonly categoryId: string | null;
      readonly dueOn: string;
      readonly expected: Money;
      readonly status: ChargeStatus;
      readonly overdueDays: number | null;
    }[]
  >;
}

/** `db` is the recurring module's own database; `services` — the same `createRecurringServices` the routes use. */
export function createRecurringMonth(db: ModuleDatabase, services: RecurringServices): RecurringMonth {
  return {
    async chargesIn(householdId, month) {
      const { payments, marks } = await db.inHousehold(householdId, async (q) => ({
        payments: await recurringTx(q).payments(householdId),
        marks: await recurringTx(q).marks(householdId),
      }));
      if (payments.length === 0) return [];
      const tracked = await trackSpace(services.tracking, householdId, payments, marks);
      const today = services.tracking.today();
      return payments
        .flatMap((p) => {
          const t = tracked.byPayment.get(p.id);
          return t ? chargesInMonth(p, t, month, today) : [];
        })
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.paymentId.localeCompare(b.paymentId));
    },
  };
}

/** The recurring queue's jobs (ARC-04): the audit entry of a change, and «Категорію об'єднано» of module categories. */
export { CATEGORY_MERGED_JOB, HAND_OFF_JOB };

/** The worker's recurring queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-offs and the category merges. */
export function createRecurringWorkerQueue(db: ModuleDatabase, audit: Pick<AuditLog, "record">): WorkerQueue {
  return recurringWorkerQueue(db, recurringAudit(audit));
}

/** BUD-01 FR 8: module categories' «Категорію об'єднано» becomes a recurring job (src/wiring.ts). */
export const recurringSubscriptions: readonly EventSubscription[] = [
  { event: categoryMerged, consumer: "recurring", job: CATEGORY_MERGED_JOB },
];

/**
 * BUD-01@PoC FR 12: a custom category is deleted only while empty — which of these categories a regular payment of the
 * space has (module categories' `createCategoriesServices({ usage })`, src/main.ts). `db` is the recurring database.
 */
export function createRecurringCategoryUsage(db: ModuleDatabase): CategoryUsage {
  return {
    module: "recurring",
    used: (householdId, ids) =>
      db.inHousehold(householdId, (q) => recurringTx(q).categoriesInUse(householdId, ids)),
  };
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4, #249; src/wiring.ts): the recurring jobs the worker
 * gave up on go back in the queue, so no change stays without its audit entry for good. Returns how many.
 */
export function createRecurringRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households())
        requeued += await requeueDeadRecurringJobs(db, householdId);
      return requeued;
    },
  };
}

/** Erasure of a space's regular payments (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface RecurringErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly payments: number; readonly rejections: number; readonly jobs: number }>;
}

/** `db` is the recurring module's own database (`ModuleDatabases.for("recurring")`). */
export function createRecurringErasure(db: ModuleDatabase): RecurringErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdRecurring(db, householdId) };
}
