// Public interface of the budget module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import type { CategoryUsage } from "../categories/index.ts";
import type { BudgetServices } from "./adapters/index.ts";
import {
  budgetAudit,
  budgetCategoryUsage,
  budgetRoutes,
  budgetWorkerQueue,
  eraseHouseholdBudget,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
} from "./adapters/index.ts";

export const budgetModule = defineModule({
  name: "budget",
  publishes: [],
  consumes: [],
  routes: budgetRoutes,
});

export {
  createBudgetObligations,
  createBudgetPlanSources,
  createBudgetServices,
  OBLIGATION_MAX_INTEGER_DIGITS,
  type BudgetServices,
} from "./adapters/index.ts";
export { DEFAULT_BUDGET_KINDS } from "./domain/index.ts";
export type { BudgetObligations, BudgetPlanSources } from "./application/index.ts";
export type { PeriodObligations } from "./domain/index.ts";

/** The budget queue's job (ARC-04): the audit entry of a change of the budget, a limit or a budget account. */
export { HAND_OFF_JOB };

/** The worker's budget queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs, written with the audit log. */
export function createBudgetWorkerQueue(db: ModuleDatabase, audit: Pick<AuditLog, "record">): WorkerQueue {
  return budgetWorkerQueue(db, budgetAudit(audit));
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4, #249; src/wiring.ts): the hand-off jobs the worker
 * gave up on go back in the budget queue, so no change stays without its audit entry for good. Returns how many.
 */
export function createBudgetHandOffRecovery(
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
 * BUD-01@PoC FR 12, AC22 (owner decision 2026-11-26): the budget's entries of a category (limit, income plan, «План»
 * cells) for module categories — they do not hold a category; a confirmed delete removes them with their audit
 * entries. `db` is the budget module's own database (`ModuleDatabases.for("budget")`), `services` the API's budget
 * services (`createBudgetServices`).
 */
export function createBudgetCategoryUsage(
  db: ModuleDatabase,
  services: BudgetServices | (() => BudgetServices),
): CategoryUsage {
  return budgetCategoryUsage(db, services);
}

/** Erasure of a space's budget (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface BudgetErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly budgets: number; readonly snapshots: number; readonly jobs: number }>;
}

/** `db` is the budget module's own database (`ModuleDatabases.for("budget")`). */
export function createBudgetErasure(db: ModuleDatabase): BudgetErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdBudget(db, householdId) };
}
