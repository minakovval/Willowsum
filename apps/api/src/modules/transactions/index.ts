// Public interface of the transactions module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  eraseHouseholdTransactions,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
  transactionAudit,
  transactionsRoutes,
  transactionsWorkerQueue,
} from "./adapters/index.ts";
import type { HandOffDeps } from "./application/index.ts";

export const transactionsModule = defineModule({
  name: "transactions",
  publishes: [],
  consumes: [],
  routes: transactionsRoutes,
});

export { createTransactionsServices, type TransactionsServices } from "./adapters/index.ts";
export { TRANSACTION_TYPES, typeOf } from "./domain/index.ts";

/** The transactions queue's job (ARC-04): the hand-off of a create, an edit or a delete to the journal and audit. */
export { HAND_OFF_JOB };

/**
 * The worker's transactions queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs in the transactions schema,
 * run with the same ports as the routes' — `db` the transactions database, the accounts directory, the journal and
 * the audit log.
 */
export function createTransactionsWorkerQueue(
  db: ModuleDatabase,
  ports: {
    readonly accounts: HandOffDeps["accounts"];
    readonly ledger: HandOffDeps["ledger"];
    readonly audit: Pick<AuditLog, "record">;
  },
): WorkerQueue {
  return transactionsWorkerQueue(db, {
    accounts: ports.accounts,
    ledger: ports.ledger,
    audit: transactionAudit(ports.audit),
  });
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4; src/wiring.ts): puts the hand-off jobs the worker gave
 * up on back in the transactions queue, so no transaction stays without its journal event and audit entry for good.
 * Returns how many jobs went back. Idempotent.
 */
export function createTransactionsHandOffRecovery(
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
export type { TransactionType } from "./domain/index.ts";

/** Erasure of a space's transactions (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface TransactionsErasure {
  /** Deletes every transaction of the space, the stored create responses and the queue rows (ARC-04). Idempotent. */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly transactions: number; readonly idempotencyKeys: number; readonly jobs: number }>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransactionsErasure(db: ModuleDatabase): TransactionsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdTransactions(db, householdId) };
}
