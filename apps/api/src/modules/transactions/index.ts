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
  transferCandidates,
  duplicateCandidates,
  duplicateCandidatesOf,
  type CandidateSide,
  type DuplicateSide,
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

/**
 * The candidate pairs of transfers between own accounts (FIN-03@PoC FR 5) for module transfer-matching, which decides
 * by its rule which are proposals: a debit and a credit on two accounts of the space within `windowDays`, both posted,
 * shown, not split and in no transfer; in one currency the credit at most the debit and at least `sameCurrencyMinShare`
 * of it. Newest first, at most `limit`. Read only.
 */
export interface TransferCandidates {
  candidatePairs(
    householdId: string,
    query: { readonly windowDays: number; readonly sameCurrencyMinShare: string; readonly limit: number },
  ): Promise<{ readonly outflow: CandidateSide; readonly inflow: CandidateSide }[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createTransferCandidates(db: ModuleDatabase): TransferCandidates {
  return {
    candidatePairs: (householdId, query) =>
      db.inHousehold(householdId, (q) => transferCandidates(q, householdId, query)),
  };
}
export type { CandidateSide };

/**
 * The possible duplicates (FIN-03@PoC FR 12) for module duplicate-matching, which decides by its rule: two shown
 * transactions on one account with the same amount and currency within `windowDays`, neither a side of a transfer nor
 * merged, the pair not «Не дубль». `first` is the earlier. Newest first, at most `limit`; `candidatesOf` — those one
 * transaction is a side of. Read only.
 */
export interface DuplicateCandidates {
  candidatePairs(
    householdId: string,
    query: { readonly windowDays: number; readonly limit: number },
  ): Promise<{ readonly first: DuplicateSide; readonly second: DuplicateSide }[]>;
  candidatesOf(
    householdId: string,
    transactionId: string,
    query: { readonly windowDays: number },
  ): Promise<{ readonly first: DuplicateSide; readonly second: DuplicateSide }[]>;
}

/** `db` is the transactions module's own database (`ModuleDatabases.for("transactions")`). */
export function createDuplicateCandidates(db: ModuleDatabase): DuplicateCandidates {
  return {
    candidatePairs: (householdId, query) =>
      db.inHousehold(householdId, (q) => duplicateCandidates(q, householdId, query)),
    candidatesOf: (householdId, transactionId, query) =>
      db.inHousehold(householdId, (q) => duplicateCandidatesOf(q, householdId, transactionId, query)),
  };
}
export type { DuplicateSide };
export type { DuplicateCheck } from "./application/index.ts";
