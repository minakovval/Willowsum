// Public interface of the goals module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { Money } from "@willowsum/domain-kernel";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { EventSubscription, WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import { entryRecorded, type Ledger } from "../ledger/index.ts";
import {
  ENTRY_RECORDED_JOB,
  eraseHouseholdGoals,
  goalsAudit,
  goalsRoutes,
  goalsTx,
  goalsWorkerQueue,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
  SPEND_CHECK_JOB,
} from "./adapters/index.ts";

export const goalsModule = defineModule({
  name: "goals",
  publishes: [],
  consumes: [entryRecorded],
  routes: goalsRoutes,
});

export { createGoalsServices, type GoalsServices } from "./adapters/index.ts";
export { EMERGENCY_MONTHS_DEFAULT, GOAL_TEMPLATES, PART_KINDS } from "./domain/index.ts";
export type { GoalTemplate, PartKind } from "./domain/index.ts";

/**
 * The goals queue's jobs (ARC-04): the audit entry of a goal's change, a contribution or a spend; and «Проводку
 * записано» of the ledger, whose reversal of a transaction's event cancels the spends made on it (AC5).
 */
export { ENTRY_RECORDED_JOB, HAND_OFF_JOB, SPEND_CHECK_JOB };

/**
 * The worker's goals queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs, written with the routes' audit log,
 * and the ledger's events (`goalsSubscriptions`).
 */
export function createGoalsWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
  ledger: Pick<Ledger, "liveEntries">,
): WorkerQueue {
  return goalsWorkerQueue(db, goalsAudit(audit), randomUUID, ledger);
}

/** AC5, edge case 5: module ledger's «Проводку записано» becomes a goals job (src/wiring.ts). */
export const goalsSubscriptions: readonly EventSubscription[] = [
  { event: entryRecorded, consumer: "goals", job: ENTRY_RECORDED_JOB },
];

/**
 * «Витратити» (BUD-05@PoC FR 8) as the budget («Можна витратити», BUD-03) and the comparison of expenses («з цілі»,
 * BUD-06) read it: which of these transactions are written off from a goal (a closed one's too), with the goal and the
 * amount. Read only; every call is bound to one space.
 */
export interface GoalSpends {
  spent(
    householdId: string,
    transactionIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly goalId: string; readonly amount: Money }>>;
}

/** `db` is the goals module's own database (`ModuleDatabases.for("goals")`). */
export function createGoalSpends(db: ModuleDatabase): GoalSpends {
  return {
    spent: (householdId, transactionIds) =>
      db.inHousehold(householdId, async (q) => {
        const spends = await goalsTx(q).spendsOfTransactions(householdId, transactionIds);
        return new Map(spends.map((s) => [s.transactionId, { goalId: s.goalId, amount: s.amount }]));
      }),
  };
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
  eraseHousehold(householdId: string): Promise<{
    readonly goals: number;
    readonly contributions: number;
    readonly spends: number;
    readonly jobs: number;
  }>;
}

/** `db` is the goals module's own database (`ModuleDatabases.for("goals")`). */
export function createGoalsErasure(db: ModuleDatabase): GoalsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdGoals(db, householdId) };
}
