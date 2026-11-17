// Public interface of the accounts module (ARC-01 FR 2). Other modules import only this file.
import type { AccountKind } from "./domain/index.ts";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { Money } from "@willowsum/domain-kernel";
import type { WorkerQueue } from "../../platform/queue/index.ts";
import type { AuditLog } from "../audit/index.ts";
import {
  accountAudit,
  accountKinds,
  accountsListTx,
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
  settlePending,
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
export type {
  AccountView,
  NumberSeal,
  PendingPostings,
  StatementResult,
  WalletUsage,
} from "./application/index.ts";
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
      // Row 198 (#409 item 4): the other modules' postings of the account first (outside this module's transaction),
      // then the recount under the account's lock, which refuses one saved since (`postings-pending`).
      const settled = await settlePending(services.deps, householdId, statement.accountId);
      if (settled.kind !== "settled") return { kind: "postings-pending" };
      const { result, handOff } = await db.inHousehold(householdId, (q) =>
        reconcileStatement(services.deps, accountsTx(q), householdId, statement, settled),
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
 * FIN-01@PoC EC4, FIN-12@PoC FR 7, FR 8, FR 14 (wave 2 row 198): the one lock of an account's money, for every module
 * that changes it, taken in that module's own transaction (adapters/db/account-lock.ts: the order that keeps it free of
 * deadlocks). Module transactions takes it before it reads an account's state through `AccountDirectory` and holds it
 * until its change has committed, so a closing, «Оновити залишок» or a wallet's removal runs before or after the change,
 * never across it.
 */
export { lockAccounts } from "./adapters/index.ts";

/**
 * An account as another module posts money to it (FIN-03@PoC FR 2, edge case 2; module transactions): its state and
 * each currency (subaccount) with its journal account. Read only; another space's account is null, like an unknown one.
 */
export interface PostingAccount {
  readonly accountId: string;
  /** Its kind: a cash account («Готівкові») or a credit one (FIN-01 FR 14) — e.g. a goal's account is a cash one. */
  readonly kind: AccountKind;
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
          kind: account.kind,
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

/**
 * The space's accounts as the budget's «Рахунки бюджету» lists them (BUD-02@PoC FR 10): each account, closed ones too,
 * with its kind and state, in the order of «Рахунки». Read only; every call is bound to one space.
 */
export interface AccountList {
  accounts(householdId: string): Promise<
    readonly {
      readonly accountId: string;
      readonly kind: AccountKind;
      readonly status: "active" | "closed";
    }[]
  >;
}

/** `db` is the accounts module's own database (`ModuleDatabases.for("accounts")`). */
export function createAccountList(db: ModuleDatabase): AccountList {
  return {
    accounts: (householdId) =>
      db.inHousehold(householdId, async (q) =>
        (
          await accountsListTx(q).listAccounts(householdId, {
            includeClosed: true,
            kinds: null,
            after: null,
            limit: null,
          })
        ).map((a) => ({ accountId: a.id, kind: a.kind, status: a.status })),
      ),
  };
}

/**
 * A debt as «Борги» reads it (BUD-19@PoC FR 11; module debt-payoff): an active credit card or loan of the space with
 * its name and each wallet with its journal account and the date of its opening balance. Read only; the debt itself is
 * the journal's balance, the rate and the payment are module liabilities'.
 */
export interface CreditAccount {
  readonly accountId: string;
  readonly kind: "credit-card" | "loan";
  readonly name: string;
  readonly subaccounts: readonly {
    readonly currency: string;
    readonly ledgerAccountId: string;
    readonly balanceDate: string;
  }[];
}

export interface CreditAccounts {
  /** The space's active credit cards and loans, in the order they were added. */
  list(householdId: string): Promise<readonly CreditAccount[]>;
}

/** `db` is the accounts module's own database (`ModuleDatabases.for("accounts")`). */
export function createCreditAccounts(db: ModuleDatabase): CreditAccounts {
  return {
    list: (householdId) =>
      db.inHousehold(householdId, async (q) => {
        const tx = accountsListTx(q);
        const accounts = await tx.listAccounts(householdId, {
          includeClosed: false,
          kinds: ["credit-card", "loan"],
          after: null,
          limit: null,
        });
        const subaccounts = await tx.subaccountsOf(
          householdId,
          accounts.map((a) => a.id),
        );
        return accounts.map((a) => ({
          accountId: a.id,
          kind: a.kind === "loan" ? "loan" : "credit-card",
          name: a.name,
          subaccounts: subaccounts
            .filter((s) => s.accountId === a.id)
            .map((s) => ({
              currency: s.currency,
              ledgerAccountId: s.ledgerAccountId,
              balanceDate: s.balanceDate,
            })),
        }));
      }),
  };
}
