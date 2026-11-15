import { Money } from "@willowsum/domain-kernel";
import type { Ledger } from "../../ledger/index.ts";
import type { Liabilities, LiabilityTermsInput } from "../../liabilities/index.ts";
import type { AccountKind } from "../domain/index.ts";

/**
 * The hand-off of an accounts change to the modules it calls (ARC-04 FR 2, FR 3; issue #210, #238 item 1). Each
 * module has its own database role, so no transaction spans them (ADR-0002); instead the accounts transaction writes
 * its rows and the hand-off job together (`AccountsTx.enqueueHandOff`), and the other modules' writes follow only once
 * it has committed:
 *
 * - right away, by the request that made the change, outside its accounts transaction (so a create holds no accounts
 *   connection while their pools are waited on — #210 item 3; a kind change holds one, with the account's row locked,
 *   only while the liability takes the kind);
 * - and by the worker from the accounts queue (job `accounts.hand-off`), so a failure right away, or a process that
 *   ended, is finished later. Until then the account exists without its ledger entries, liability or audit entry —
 *   never the other way round.
 *
 * Every step is idempotent, so running the hand-off twice writes everything once: the ledger account by its owner and
 * the id stored in the subaccount, «Початковий залишок» by its idempotency key, the liability per account, the audit
 * entry by its key. A rolled-back change enqueued nothing, so it leaves nothing in another module.
 */
export type HandOff =
  | {
      /** «Новий рахунок» (FIN-01 FR 7, FR 2, FR 17): ledger accounts, opening balances, liability, audit entry. */
      readonly kind: "account-created";
      readonly accountId: string;
      readonly actorAccountId: string;
      readonly subaccounts: readonly HandOffSubaccount[];
      /** A loan's or a credit card's terms (checked before the account was written), or null. */
      readonly liability: LiabilityTermsInput | null;
      /** The audit entry's fields with their values; every sensitive value is already masked. */
      readonly audit: readonly AuditValue[];
    }
  | {
      /**
       * «Кредит» ↔ «Кредитна картка» (FIN-12 FR 5): the liability takes the account's kind as it is when the hand-off
       * runs, so a late hand-off of an earlier change never undoes a later one.
       */
      readonly kind: "credit-kind";
      readonly accountId: string;
      readonly actorAccountId: string;
    };

export interface HandOffSubaccount {
  readonly subaccountId: string;
  /** The id the ledger account gets (stored in the subaccount first). */
  readonly ledgerAccountId: string;
  readonly ledgerType: "asset" | "liability";
  readonly currency: string;
  /** «Початковий залишок»: the ledger event's amount, a decimal string; null for a zero balance (no event). */
  readonly opening: string | null;
  readonly date: string;
}

export interface AuditValue {
  readonly field: string;
  readonly after: string | null;
  readonly sensitive: boolean;
}

/** What the hand-off needs of the accounts module itself. */
export interface AccountKinds {
  /**
   * Runs `work` with the account's kind (null if there is no such account) while the account's row is locked in an
   * accounts transaction, so no change of its kind commits in between.
   */
  whileLocked<T>(
    householdId: string,
    accountId: string,
    work: (kind: AccountKind | null) => Promise<T>,
  ): Promise<T>;
}

/** The other modules' ports the hand-off calls (the routes' and the worker's, src/wiring.ts). */
export interface HandOffDeps {
  readonly ledger: Pick<Ledger, "openAccount" | "post">;
  readonly liabilities: Pick<Liabilities, "register" | "changeKind">;
  readonly audit: HandOffAudit;
}

/** The space's audit log as the hand-off writes it (`AccountAudit` in accounts.ts). */
export interface HandOffAudit {
  /** «Новий рахунок» (FIN-01 FR 17): written once per `key` (ARC-04 FR 3). */
  accountCreated(
    householdId: string,
    actorAccountId: string,
    accountId: string,
    values: readonly AuditValue[],
    key: string,
  ): Promise<void>;
}

/** The job's key: one hand-off per account created; one per kind change (`changeId` new for each). */
export function handOffKey(handOff: HandOff, changeId: string): string {
  return handOff.kind === "account-created"
    ? `account-created:${handOff.accountId}`
    : `credit-kind:${handOff.accountId}:${changeId}`;
}

/** Runs a hand-off; every step can run again (see above). Throws if a step fails, so the job is retried. */
export async function applyHandOff(
  deps: HandOffDeps,
  accounts: AccountKinds,
  householdId: string,
  handOff: HandOff,
): Promise<void> {
  if (handOff.kind === "credit-kind") {
    // The account's row stays locked until the liability has its kind: two kind changes and their hand-offs cannot
    // interleave (the later change waits, and its own hand-off runs after this one).
    await accounts.whileLocked(householdId, handOff.accountId, async (kind) => {
      // Only a credit account has a liability; within the credit group its kind is a loan or a credit card.
      if (kind !== "loan" && kind !== "credit-card") return;
      const changed = await deps.liabilities.changeKind(householdId, {
        actorAccountId: handOff.actorAccountId,
        accountId: handOff.accountId,
        kind,
      });
      // The account's own create has not handed its liability over yet: retried after it.
      if (changed.kind === "not-found")
        throw new Error("the credit account's liability is not registered yet");
    });
    return;
  }
  for (const s of handOff.subaccounts) {
    const source = { module: "accounts", id: s.subaccountId };
    await deps.ledger.openAccount(householdId, source, {
      type: s.ledgerType,
      currency: s.currency,
      id: s.ledgerAccountId,
    });
    if (s.opening !== null)
      await deps.ledger.post(householdId, {
        source,
        idempotencyKey: `accounts.opening:${s.subaccountId}`,
        operationDate: s.date,
        event: {
          type: "opening-balance",
          account: s.ledgerAccountId,
          amount: Money.of(s.opening, s.currency),
        },
      });
  }
  if (handOff.liability) {
    const registered = await deps.liabilities.register(householdId, {
      actorAccountId: handOff.actorAccountId,
      accountId: handOff.accountId,
      terms: handOff.liability,
    });
    if (registered.kind !== "registered") throw new Error("liability terms refused after they were checked");
  }
  await deps.audit.accountCreated(
    householdId,
    handOff.actorAccountId,
    handOff.accountId,
    handOff.audit,
    `accounts.account-created:${handOff.accountId}`,
  );
}
