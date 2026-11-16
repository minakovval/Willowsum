// Public interface of the debt-payoff module (ARC-01 FR 2). Other modules import only this file.
import type { Money } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  debtPayoffRoutes,
  eraseHouseholdPlans,
  HAND_OFF_JOB,
  plansAudit,
  plansTx,
  plansWorkerQueue,
  requeueDeadHandOffs,
} from "./adapters/index.ts";
import { plannedExpensesIn } from "./application/index.ts";

export const debtPayoffModule = defineModule({
  name: "debt-payoff",
  publishes: [],
  consumes: [],
  routes: debtPayoffRoutes,
});

export { createDebtPayoffServices, type DebtPayoffServices } from "./adapters/index.ts";
export { MONTHS_MAX, STRATEGIES } from "./domain/index.ts";
export type { Strategy } from "./domain/index.ts";

/** The debt-payoff queue's job (ARC-04): the audit entry of a saved or deleted plan. */
export { HAND_OFF_JOB };

/** The worker's debt-payoff queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs. */
export function createDebtPayoffWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return plansWorkerQueue(db, plansAudit(audit));
}

/**
 * «Додати до запланованих витрат» (BUD-19@PoC FR 5) as the budget reads it — «Можна витратити» (BUD-03) and «План»
 * (BUD-17): the extra payments of the saved plans that are planned expenses in a month (YYYY-MM), by debt. Read only;
 * every call is bound to one space. Without a category of the budget (BUD-19 «Припущення»).
 */
export interface DebtPlannedExpenses {
  inMonth(
    householdId: string,
    month: string,
  ): Promise<readonly { readonly accountId: string; readonly amount: Money }[]>;
}

/** `db` is the debt-payoff module's own database (`ModuleDatabases.for("debt-payoff")`). */
export function createDebtPlannedExpenses(db: ModuleDatabase): DebtPlannedExpenses {
  return {
    inMonth: (householdId, month) =>
      db.inHousehold(householdId, async (q) => plannedExpensesIn(await plansTx(q).plans(householdId), month)),
  };
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4, #249; src/wiring.ts): the hand-off jobs the worker
 * gave up on go back in the debt-payoff queue, so no plan stays without its audit entry for good. Returns how many.
 */
export function createDebtPayoffHandOffRecovery(
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

/** Erasure of a space's plans (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface DebtPayoffErasure {
  eraseHousehold(householdId: string): Promise<{ readonly plans: number; readonly jobs: number }>;
}

/** `db` is the debt-payoff module's own database (`ModuleDatabases.for("debt-payoff")`). */
export function createDebtPayoffErasure(db: ModuleDatabase): DebtPayoffErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdPlans(db, householdId) };
}
