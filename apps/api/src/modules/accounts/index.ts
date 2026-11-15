// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { Money } from "@willowsum/domain-kernel";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  accountAudit,
  accountKinds,
  accountsRoutes,
  accountsTx,
  accountsWorkerQueue,
  eraseHouseholdAccounts,
  HAND_OFF_JOB,
  requeueDeadHandOffs,
  type AccountsServices,
} from "./adapters/index.ts";
import { logEvent } from "../../platform/telemetry/signals.ts";
import {
  applyHandOff,
  reconcileStatement,
  type HandOffDeps,
  type StatementResult,
} from "./application/index.ts";

export const accountsModule = defineModule({
  name: "accounts",
  publishes: [],
  consumes: [],
  routes: accountsRoutes,
});

export { createAccountsServices, type AccountsServices } from "./adapters/index.ts";

/** The accounts queue's job (ARC-04): the hand-off of a create or a kind change to ledger, liabilities and audit. */
export { HAND_OFF_JOB };

/**
 * The worker's accounts queue (ARC-04 FR 2, FR 3; src/wiring.ts): the hand-off jobs in the accounts schema, run with
 * the same ports as the routes' — `db` the accounts database, the journal, the liabilities and the audit log.
 */
export function createAccountsWorkerQueue(
  db: ModuleDatabase,
  ports: {
    readonly ledger: HandOffDeps["ledger"];
    readonly liabilities: HandOffDeps["liabilities"];
    readonly audit: Pick<AuditLog, "record">;
  },
): WorkerQueue {
  return accountsWorkerQueue(db, {
    ledger: ports.ledger,
    liabilities: ports.liabilities,
    audit: accountAudit(ports.audit),
  });
}

/**
 * The scheduler's daily recovery of the hand-off (ARC-04 FR 2–4; src/wiring.ts): puts the hand-off jobs the worker gave
 * up on back in the accounts queue, so no account stays without its ledger entries, liability and audit entry for good.
 * Returns how many jobs went back. Idempotent.
 */
export function createAccountsHandOffRecovery(
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
export { NUMBER_FIELD } from "./application/index.ts";
export type { AccountView, NumberSeal, StatementResult } from "./application/index.ts";
export { ACCOUNT_KINDS, depositAccrual, groupOf, maskedNumber, parseAccountNumber } from "./domain/index.ts";
export type { AccountGroup, AccountKind, DepositAccrual } from "./domain/index.ts";

/** Erasure of a space's accounts (NFR-12@PoC FR 3): the owner's erasure script only (module data-erasure). */
export interface AccountsErasure {
  /**
   * Deletes every account of the space with its subaccounts, owners, stored create responses and queue rows (hand-off
   * jobs, ARC-04). Idempotent.
   */
  eraseHousehold(
    householdId: string,
  ): Promise<{ readonly accounts: number; readonly idempotencyKeys: number; readonly jobs: number }>;
}

/** `db` is the accounts module's own database (`ModuleDatabases.for("accounts")`). */
export function createAccountsErasure(db: ModuleDatabase): AccountsErasure {
  return { eraseHousehold: (householdId) => eraseHouseholdAccounts(db, householdId) };
}

/**
 * The recount of a temporary adjustment by an imported statement with a closing balance (FIN-12@PoC FR 15), for the
 * import of statements: `reconcile` in the accounts transaction with the account locked. A manual account's adjustment
 * is permanent and never recounted; without an adjustment nothing is created (FIN-04 FR 11).
 */
export interface AccountStatements {
  reconcile(
    householdId: string,
    statement: { readonly accountId: string; readonly statementEnd: string; readonly closingBalance: Money },
  ): Promise<StatementResult>;
}

/** `db` is the accounts module's own database; `services` the same as the routes'. */
export function createAccountStatements(db: ModuleDatabase, services: AccountsServices): AccountStatements {
  return {
    async reconcile(householdId, statement) {
      const { result, handOff } = await db.inHousehold(householdId, (q) =>
        reconcileStatement(services.deps, accountsTx(q), householdId, statement),
      );
      // The adjustment and its audit entry, after the commit (ARC-04 FR 2); the worker finishes them if this fails.
      if (handOff)
        await applyHandOff(
          services.deps,
          accountKinds((work) => db.inHousehold(householdId, work)),
          householdId,
          handOff,
        ).catch((error: unknown) =>
          logEvent("accounts.hand_off_deferred", "warn", {
            "ws.module": "accounts",
            "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
          }),
        );
      return result;
    },
  };
}

/**
 * An account as another module posts money to it (FIN-03@PoC FR 2, edge case 2; module transactions): its state and
 * each currency (subaccount) with its journal account. Read only; another space's account is null, like an unknown one.
 */
export interface PostingAccount {
  readonly accountId: string;
  readonly status: "active" | "closed";
  readonly subaccounts: readonly {
    readonly subaccountId: string;
    readonly currency: string;
    readonly ledgerAccountId: string;
  }[];
}

export interface AccountDirectory {
  postingAccount(householdId: string, accountId: string): Promise<PostingAccount | null>;
}

/** `db` is the accounts module's own database (`ModuleDatabases.for("accounts")`). */
export function createAccountDirectory(db: ModuleDatabase): AccountDirectory {
  return {
    postingAccount: (householdId, accountId) =>
      db.inHousehold(householdId, async (q) => {
        const tx = accountsTx(q);
        const account = await tx.account(householdId, accountId);
        if (!account) return null;
        const subaccounts = await tx.subaccounts(householdId, accountId);
        return {
          accountId: account.id,
          status: account.status,
          subaccounts: subaccounts.map((s) => ({
            subaccountId: s.id,
            currency: s.currency,
            ledgerAccountId: s.ledgerAccountId,
          })),
        };
      }),
  };
}
