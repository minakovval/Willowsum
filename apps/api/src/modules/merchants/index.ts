// Public interface of the merchants module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  eraseHouseholdMerchants,
  HAND_OFF_JOB,
  merchantsAudit,
  merchantsRoutes,
  merchantsTx,
  merchantsWorkerQueue,
  requeueDeadJobsOf,
} from "./adapters/index.ts";
import { knownMerchants, shownMerchants } from "./application/index.ts";

export const merchantsModule = defineModule({
  name: "merchants",
  publishes: [],
  consumes: [],
  routes: merchantsRoutes,
});

export { createMerchantsServices, type MerchantsServices } from "./adapters/index.ts";

/**
 * The merchants as another module reads them (BUD-07@PoC FR 1: module recurring groups transactions by merchant): the
 * merchant each counterparty shows — the one a merge joined it into, else its own (`id`, `name`); a counterparty with no
 * merchant (no letters or digits left) is absent. A description seen for the first time has its merchant born, as on
 * any read of merchants. Bound to one space.
 */
export interface MerchantDirectory {
  shownMerchants(
    householdId: string,
    counterparties: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly id: string; readonly name: string }>>;
  /**
   * As `shownMerchants`, read only: no merchant is born; a description seen for the first time shows the name its
   * merchant would be born with, `id` null.
   */
  knownMerchants(
    householdId: string,
    counterparties: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly id: string | null; readonly name: string }>>;
}

/** `db` is the merchants database. */
export function createMerchantDirectory(db: ModuleDatabase): MerchantDirectory {
  return {
    shownMerchants: (householdId, counterparties) =>
      db.inHousehold(householdId, async (q) => {
        const shown = await shownMerchants(merchantsTx(q), householdId, counterparties);
        return new Map([...shown].map(([c, m]) => [c, { id: m.id, name: m.name }]));
      }),
    knownMerchants: (householdId, counterparties) =>
      db.inHousehold(householdId, (q) => knownMerchants(merchantsTx(q), householdId, counterparties)),
  };
}
export { merchantInitials, merchantKey, normalizeDescription } from "./domain/index.ts";
export type { Merchant, NormalizedMerchant } from "./domain/index.ts";

/** The merchants queue's job (ARC-04): the audit hand-off of a rename, a merge or «Роз'єднати». */
export { HAND_OFF_JOB };

/**
 * The worker's merchants queue (ARC-04; src/wiring.ts): the hand-off jobs, with the same audit log as the routes'.
 * `db` is the merchants database.
 */
export function createMerchantsWorkerQueue(db: ModuleDatabase, audit: Pick<AuditLog, "record">): WorkerQueue {
  return merchantsWorkerQueue(db, merchantsAudit(audit));
}

/**
 * The scheduler's daily recovery (ARC-04 FR 2–4, #249; src/wiring.ts): puts the merchants jobs the worker gave up on
 * (`dead`) back in the queue. Returns how many went back. Idempotent.
 */
export function createMerchantsRecovery(
  db: ModuleDatabase,
  households: () => Promise<readonly string[]>,
): { run(): Promise<number> } {
  return {
    async run() {
      let requeued = 0;
      for (const householdId of await households()) requeued += await requeueDeadJobsOf(db, householdId);
      return requeued;
    },
  };
}

/** Erasure of a space's merchants (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface MerchantsErasure {
  eraseHousehold(householdId: string): Promise<{ readonly merchants: number; readonly jobs: number }>;
}

export function createMerchantsErasure(db: ModuleDatabase): MerchantsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdMerchants(db, householdId) };
}
