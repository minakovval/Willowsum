import { Money } from "@willowsum/domain-kernel";
import type { Entry, Ledger } from "../../ledger/index.ts";
import type { Liabilities, LiabilityTermsInput } from "../../liabilities/index.ts";
import type { AccountKind, LiveAdjustment } from "../domain/index.ts";
import { ADJUSTMENT, adjustmentOf } from "./adjustments.ts";

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
 *
 * Managing an account (`managed`: closing, «Відкрити знову», «Оновити залишок», deleting its adjustment, a statement's
 * recount; #252 item 3) carries the journal moves its accounts transaction planned under the account's row lock — the
 * amounts as decimal strings, each move with a key of the change — and the audit entries follow them. A later change
 * of the account's money first finishes these moves of every earlier one not done yet (`AccountsTx.pendingManaged`,
 * `applyMoves`), under the same lock, so it is never planned on a journal that lacks them. «Основне» and «Реквізити»
 * (`settings-changed`) carry only their audit entry, the sensitive values masked already.
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
    }
  | ManagedHandOff
  | {
      /** «Основне» or «Реквізити» (FIN-12 FR 4, FR 6): the audit entry of the fields changed. */
      readonly kind: "settings-changed";
      readonly accountId: string;
      readonly actorAccountId: string;
      readonly changeId: string;
      /** Before and after; every sensitive value (the sealed flag, the note) is already masked. */
      readonly changes: readonly AuditChange[];
    };

/** Who an audit entry of managing names: the user, or the system for a statement's recount (FIN-12 FR 15). */
export type ManageActor = { readonly kind: "user"; readonly id: string } | { readonly kind: "system" };

/**
 * Closing, «Відкрити знову», «Оновити залишок», deleting the adjustment or a statement's recount (FIN-12 FR 7–9, FR 14,
 * FR 15; FIN-04 FR 10, FR 11): the journal moves in their order, then the audit entries of each move and of the
 * account's status.
 */
export interface ManagedHandOff {
  readonly kind: "managed";
  readonly accountId: string;
  /** New for each change: the keys of its journal entries and audit entries. */
  readonly changeId: string;
  readonly actor: ManageActor;
  readonly channel: "web" | "import";
  readonly moves: readonly HandOffMove[];
  /** Closed or active again, with how a balance was settled; null when the status did not change. */
  readonly status: HandOffStatus | null;
}

export type HandOffMove =
  | {
      /** «Перенести на інший рахунок» (FIN-12 FR 7): one currency's balance to the other account. */
      readonly op: "transfer";
      readonly subaccountId: string;
      readonly currency: string;
      readonly toAccountId: string;
      /** The ledger accounts the transfer goes from and to (a debt is paid from the other account). */
      readonly from: string;
      readonly to: string;
      /** The balance moved, from the holder's side (a debt negative); a decimal string. */
      readonly balance: string;
      readonly date: string;
    }
  | {
      /** The adjustment of «Оновити залишок» posted, corrected or reversed (FIN-12 FR 14, FIN-04 FR 11). */
      readonly op: "adjust";
      readonly subaccountId: string;
      readonly currency: string;
      readonly ledgerAccountId: string;
      readonly date: string;
      readonly plan:
        | { readonly kind: "post"; readonly amount: string }
        | { readonly kind: "correct"; readonly entryId: string; readonly amount: string }
        | { readonly kind: "reverse"; readonly entryId: string };
      /** The adjustment in effect before (amount a decimal string), for the audit entry. */
      readonly before: { readonly entryId: string; readonly amount: string; readonly date: string } | null;
    };

export interface HandOffStatus {
  readonly before: { readonly status: "active" | "closed"; readonly closedOn: string | null };
  readonly after: { readonly status: "active" | "closed"; readonly closedOn: string | null };
  readonly settlement:
    | (({ readonly kind: "transfer"; readonly toAccountId: string } | { readonly kind: "adjustment" }) & {
        /** Per currency, the balance settled (decimal strings). */
        readonly amounts: readonly { readonly currency: string; readonly balance: string }[];
      })
    | null;
}

export interface AuditChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly sensitive: boolean;
}

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
  readonly ledger: Pick<Ledger, "openAccount" | "post" | "correct" | "reverse">;
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
  /** Closed or reopened (FIN-12 FR 7–9): the status and date before and after, and how a balance was settled. */
  statusChanged(
    householdId: string,
    actorAccountId: string,
    accountId: string,
    status: HandOffStatus,
    key: string,
  ): Promise<void>;
  /**
   * «Основне» or «Реквізити» changed (FIN-12 FR 4, FR 6): every changed field with its value before and after; a
   * `sensitive` one (the sealed number, the note) is masked by the log itself too (NFR-01 FR 6).
   */
  settingsChanged(
    householdId: string,
    actorAccountId: string,
    accountId: string,
    changes: readonly AuditChange[],
    key: string,
  ): Promise<void>;
  /** One currency's balance moved by «Перенести на інший рахунок» (FIN-12 FR 7), with its journal entry. */
  transferred(
    householdId: string,
    actorAccountId: string,
    accountId: string,
    transfer: {
      readonly toAccountId: string;
      readonly currency: string;
      readonly amount: Money;
      readonly entryId: string;
    },
    key: string,
  ): Promise<void>;
  /**
   * The adjustment of «Оновити залишок» on a subaccount created, changed or deleted (FIN-12 FR 15, FIN-04 FR 11, AC7):
   * amount and date before and after; by the user, or by the system for a statement's recount.
   */
  adjustmentChanged(
    householdId: string,
    actor: ManageActor,
    channel: "web" | "import",
    subaccount: { readonly id: string; readonly accountId: string; readonly currency: string },
    before: LiveAdjustment | null,
    after: LiveAdjustment | null,
    key: string,
  ): Promise<void>;
}

/**
 * The job's key: one hand-off per account created; one per kind change and per managing or settings change
 * (`changeId` new for each).
 */
export function handOffKey(handOff: HandOff, changeId: string): string {
  switch (handOff.kind) {
    case "account-created":
      return `account-created:${handOff.accountId}`;
    case "credit-kind":
      return `credit-kind:${handOff.accountId}:${changeId}`;
    default:
      return `${handOff.kind}:${handOff.accountId}:${handOff.changeId}`;
  }
}

/** The journal keys of a managing change: one entry per subaccount and change. */
const adjustKey = (h: ManagedHandOff, subaccountId: string) =>
  `accounts.adjust:${h.changeId}:${subaccountId}`;
const transferKey = (h: ManagedHandOff, subaccountId: string) =>
  `accounts.close:${h.changeId}:${subaccountId}`;

/**
 * The journal moves of a managing hand-off, in order; each is idempotent by its key, so running them again — the
 * worker after the route, or a later change of the account before it plans — writes nothing twice. The entry each move
 * made (null for a reversal).
 */
export async function applyMoves(
  ledger: Pick<Ledger, "post" | "correct" | "reverse">,
  householdId: string,
  handOff: ManagedHandOff,
): Promise<(Entry | null)[]> {
  const made: (Entry | null)[] = [];
  for (const move of handOff.moves) {
    const source = { module: "accounts", id: move.subaccountId };
    if (move.op === "transfer") {
      const balance = Money.of(move.balance, move.currency);
      made.push(
        await ledger.post(householdId, {
          source,
          idempotencyKey: transferKey(handOff, move.subaccountId),
          operationDate: move.date,
          event: {
            type: "transfer",
            from: move.from,
            to: move.to,
            amount: balance.isNegative() ? balance.negated() : balance,
          },
        }),
      );
      continue;
    }
    const plan = move.plan;
    if (plan.kind === "reverse") {
      await ledger.reverse(householdId, plan.entryId, `accounts.adjust-delete:${plan.entryId}`);
      made.push(null);
      continue;
    }
    const replacement = {
      source,
      idempotencyKey: adjustKey(handOff, move.subaccountId),
      operationDate: move.date,
      event: {
        type: ADJUSTMENT,
        account: move.ledgerAccountId,
        amount: Money.of(plan.amount, move.currency),
      },
    } as const;
    made.push(
      plan.kind === "post"
        ? await ledger.post(householdId, replacement)
        : (await ledger.correct(householdId, plan.entryId, replacement)).entry,
    );
  }
  return made;
}

/** The managing hand-off: the moves under the account's row lock, then each audit entry by its key. */
async function applyManaged(
  deps: HandOffDeps,
  accounts: AccountKinds,
  householdId: string,
  handOff: ManagedHandOff,
): Promise<void> {
  // Under the row lock, as the change that planned them: the route's and the worker's runs never interleave.
  const made = await accounts.whileLocked(householdId, handOff.accountId, () =>
    applyMoves(deps.ledger, householdId, handOff),
  );
  const actorAccountId = handOff.actor.kind === "user" ? handOff.actor.id : null;
  for (const [i, move] of handOff.moves.entries()) {
    const entry = made[i] ?? null;
    if (move.op === "transfer") {
      if (actorAccountId === null || entry === null)
        throw new Error("a transfer is the user's, with its entry");
      await deps.audit.transferred(
        householdId,
        actorAccountId,
        handOff.accountId,
        {
          toAccountId: move.toAccountId,
          currency: move.currency,
          amount: Money.of(move.balance, move.currency),
          entryId: entry.id,
        },
        `accounts.transferred:${handOff.changeId}:${move.subaccountId}`,
      );
      continue;
    }
    const subaccount = { id: move.subaccountId, accountId: handOff.accountId, currency: move.currency };
    const before = move.before && {
      entryId: move.before.entryId,
      amount: Money.of(move.before.amount, move.currency),
      date: move.before.date,
    };
    const after = entry && adjustmentOf(entry, { ...subaccount, ledgerAccountId: move.ledgerAccountId });
    await deps.audit.adjustmentChanged(
      householdId,
      handOff.actor,
      handOff.channel,
      subaccount,
      before,
      after,
      `accounts.adjustment:${handOff.changeId}:${move.subaccountId}`,
    );
  }
  if (handOff.status) {
    if (actorAccountId === null) throw new Error("a status change is the user's");
    await deps.audit.statusChanged(
      householdId,
      actorAccountId,
      handOff.accountId,
      handOff.status,
      `accounts.status:${handOff.changeId}`,
    );
  }
}

/** Runs a hand-off; every step can run again (see above). Throws if a step fails, so the job is retried. */
export async function applyHandOff(
  deps: HandOffDeps,
  accounts: AccountKinds,
  householdId: string,
  handOff: HandOff,
): Promise<void> {
  if (handOff.kind === "managed") return applyManaged(deps, accounts, householdId, handOff);
  if (handOff.kind === "settings-changed")
    return deps.audit.settingsChanged(
      householdId,
      handOff.actorAccountId,
      handOff.accountId,
      handOff.changes,
      `accounts.settings:${handOff.changeId}`,
    );
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
