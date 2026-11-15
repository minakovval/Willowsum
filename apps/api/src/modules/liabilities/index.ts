// Public interface of the liabilities module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { AuditLog } from "../audit/index.ts";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import { logEvent } from "../../platform/telemetry/signals.ts";
import {
  eraseHouseholdLiabilities,
  HAND_OFF_JOB,
  liabilitiesTx,
  liabilitiesWorkerQueue,
  requeueDeadHandOffs,
} from "./adapters/index.ts";
import {
  applyHandOff,
  changeLiabilityKind,
  registerLiability,
  type ChangeKindResult,
  type Handed,
  type LiabilitiesTx,
  type Liability,
  type LiabilityAudit,
  type LiabilityHandOff,
  type RegisterResult,
} from "./application/index.ts";
import type { LiabilityKind, LiabilityTermsInput } from "./domain/index.ts";

export const liabilitiesModule = defineModule({
  name: "liabilities",
  publishes: [],
  consumes: [],
});

export {
  availableCredit,
  checkTerms,
  GRACE_PERIOD_MAX_DAYS,
  LIABILITY_KINDS,
  parseAnnualRate,
  parseTypedAmount,
  termsMissing,
} from "./domain/index.ts";
export type { LiabilityKind, LiabilityTerms, LiabilityTermsInput, TermsIssue } from "./domain/index.ts";
export type { ChangeKindResult, Liability, RegisterResult } from "./application/index.ts";

/** Liabilities of a space (FIN-01@PoC FR 2, FR 16): every call is bound to one space. */
export interface Liabilities {
  /**
   * The liability of an account (a loan or a credit card of `accounts`) with its terms, audited as created by
   * `actorAccountId`. Idempotent per account: a second call returns the liability there and writes nothing. The audit
   * entry follows the commit (ARC-04 FR 2): right away, or from the liabilities queue if that fails.
   */
  register(
    householdId: string,
    input: {
      readonly actorAccountId: string;
      readonly accountId: string;
      readonly terms: LiabilityTermsInput;
    },
  ): Promise<RegisterResult>;
  /** The liability of an account, or null. */
  forAccount(householdId: string, accountId: string): Promise<Liability | null>;
  /**
   * «Кредит» ↔ «Кредитна картка» (FIN-12@PoC FR 5): the account's liability takes the new kind, keeping the terms that
   * kind may have; audited as changed by `actorAccountId` after the commit (as `register`). The same kind again writes
   * nothing.
   */
  changeKind(
    householdId: string,
    input: { readonly actorAccountId: string; readonly accountId: string; readonly kind: LiabilityKind },
  ): Promise<ChangeKindResult>;
}

/** The hand-off's entry in the space's own log (П-10): amounts and rates are not personal data, nothing is masked. */
function liabilityAudit(audit: Pick<AuditLog, "record">): LiabilityAudit {
  return {
    async record(householdId, handOff, key) {
      await audit.record(householdId, {
        actor: { kind: "user", id: handOff.actorAccountId },
        channel: "web",
        entity: { type: "liabilities.liability", id: handOff.liabilityId },
        action: handOff.action,
        changes: handOff.changes.map((c) => ({ ...c, sensitive: false })),
        key,
      });
    },
  };
}

/**
 * ARC-04 FR 2: the audit entry of a committed change, right away — after the liabilities transaction. A failure is no
 * failure of the call: the change is made and its job is in the liabilities queue, so the worker writes the entry.
 * Logged as `liabilities.hand_off_deferred` (WARN, the error class only).
 */
async function handOffNow(
  audit: LiabilityAudit,
  householdId: string,
  handOff: LiabilityHandOff | null,
): Promise<void> {
  if (handOff === null) return;
  try {
    await applyHandOff(audit, householdId, handOff);
  } catch (error) {
    logEvent("liabilities.hand_off_deferred", "warn", {
      "ws.module": "liabilities",
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}

/** `db` is the liabilities module's own database (`ModuleDatabases.for("liabilities")`). */
export function createLiabilities(db: ModuleDatabase, audit: Pick<AuditLog, "record">): Liabilities {
  const deps = { newId: randomUUID };
  const log = liabilityAudit(audit);
  const handed = async <R>(householdId: string, work: (tx: LiabilitiesTx) => Promise<Handed<R>>) => {
    const { result, handOff } = await db.inHousehold(householdId, (q) => work(liabilitiesTx(q)));
    await handOffNow(log, householdId, handOff);
    return result;
  };
  return {
    register: (householdId, input) =>
      handed(householdId, (tx) => registerLiability(deps, tx, householdId, input)),
    forAccount: (householdId, accountId) =>
      db.inHousehold(householdId, (q) => liabilitiesTx(q).byAccount(householdId, accountId)),
    changeKind: (householdId, input) =>
      handed(householdId, (tx) => changeLiabilityKind(deps, tx, householdId, input)),
  };
}

/** The liabilities queue's job (ARC-04): the audit entry of a registered liability or a kind change. */
export { HAND_OFF_JOB };

/**
 * The worker's liabilities queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs in the liabilities schema,
 * written with the same audit log as the calls' — `db` the liabilities database.
 */
export function createLiabilitiesWorkerQueue(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
): WorkerQueue {
  return liabilitiesWorkerQueue(db, liabilityAudit(audit));
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4; src/wiring.ts): puts the hand-off jobs the worker gave
 * up on back in the liabilities queue, so no liability stays without its audit entry for good. Returns how many jobs
 * went back. Idempotent.
 */
export function createLiabilitiesHandOffRecovery(
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

/** Erasure of a space's liabilities (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface LiabilitiesErasure {
  /** Deletes every liability of the space and the queue rows (ARC-04). Idempotent. */
  eraseHousehold(householdId: string): Promise<{ readonly liabilities: number; readonly jobs: number }>;
}

/** `db` is the liabilities module's own database (`ModuleDatabases.for("liabilities")`). */
export function createLiabilitiesErasure(db: ModuleDatabase): LiabilitiesErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdLiabilities(db, householdId) };
}
