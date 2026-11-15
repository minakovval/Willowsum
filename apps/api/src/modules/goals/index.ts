// Public interface of the goals module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  eraseHouseholdGoals,
  goalsAudit,
  goalsRoutes,
  goalsWorkerQueue,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
} from "./adapters/index.ts";

export const goalsModule = defineModule({
  name: "goals",
  publishes: [],
  consumes: [],
  routes: goalsRoutes,
});

export { createGoalsServices, type GoalsServices } from "./adapters/index.ts";
export { EMERGENCY_MONTHS_DEFAULT, GOAL_TEMPLATES, PART_KINDS } from "./domain/index.ts";
export type { GoalTemplate, PartKind } from "./domain/index.ts";

/** The goals queue's job (ARC-04): the audit entry of a goal's change or a contribution. */
export { HAND_OFF_JOB };

/** The worker's goals queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs, written with the routes' audit log. */
export function createGoalsWorkerQueue(db: ModuleDatabase, audit: Pick<AuditLog, "record">): WorkerQueue {
  return goalsWorkerQueue(db, goalsAudit(audit));
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4, #249; src/wiring.ts): the hand-off jobs the worker
 * gave up on go back in the goals queue, so no change stays without its audit entry for good. Returns how many.
 */
export function createGoalsHandOffRecovery(
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

/** Erasure of a space's goals (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface GoalsErasure {
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly goals: number; readonly contributions: number; readonly jobs: number }>;
}

/** `db` is the goals module's own database (`ModuleDatabases.for("goals")`). */
export function createGoalsErasure(db: ModuleDatabase): GoalsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdGoals(db, householdId) };
}
