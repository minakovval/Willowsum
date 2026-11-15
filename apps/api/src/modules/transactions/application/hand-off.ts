import { Money } from "@willowsum/domain-kernel";
import { AUDIT_MASK } from "../../audit/index.ts";
import type { Entry, Ledger } from "../../ledger/index.ts";
import type { PostingAccount } from "../domain/index.ts";
import type { StoredTransaction } from "./transactions.ts";

/**
 * The hand-off of a transactions change to the journal and the audit log (ARC-04 FR 2, FR 3; ADR-0015; issue #240
 * item 4, #252 item 1). Each module has its own database role, so no transaction spans them (ADR-0002); instead the
 * transactions transaction writes the row and the hand-off job together (`TransactionsTx.enqueueHandOff`), and the
 * journal and the audit entry follow only once it has committed — right away, by the request that made the change, and
 * by the worker from the transactions queue (job `transactions.hand-off`) if that failed or the process ended. Until
 * then the transaction exists without its journal event (the balance does not show it yet) or its audit entry — never
 * the other way round.
 *
 * The job carries no amount to post: the journal is made to match the row as it is when the hand-off runs, with the
 * row locked (`TransactionRows.whileLocked`) so no change commits in between and two hand-offs of one transaction never
 * interleave. So a late hand-off of an earlier change never undoes a later one, and a deleted row's hand-off reverses
 * what is left. Every step is idempotent: the first event by the key `transactions.create:<id>`, a correction by
 * `transactions.edit:<entry in effect>`, a reversal by `transactions.delete:<entry>`, and the audit entry by its key.
 */
export interface TransactionHandOff {
  readonly transactionId: string;
  readonly actorAccountId: string;
  readonly action: "create" | "update" | "delete";
  /** The row's version after the change (a delete: the version deleted); makes each change its own job and entry. */
  readonly version: number;
  /** The audit entry's fields before and after; the counterparty and the description are masked already. */
  readonly audit: readonly TransactionAuditValue[];
}

export interface TransactionAuditValue {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly sensitive: boolean;
}

/** The job's key (the queue's `dedupe_key`): one hand-off per change of a transaction. */
export function handOffKey(handOff: TransactionHandOff): string {
  return `${handOff.action}:${handOff.transactionId}:${handOff.version}`;
}

/** The audit entry's key (ARC-04 FR 3): written once per change. */
export function auditKey(handOff: TransactionHandOff): string {
  return `transactions.${handOff.action}:${handOff.transactionId}:${handOff.version}`;
}

/** The space's audit log as the hand-off writes it (FR 20, П-10). */
export interface TransactionAudit {
  changed(
    householdId: string,
    actorAccountId: string,
    transactionId: string,
    action: TransactionHandOff["action"],
    values: readonly TransactionAuditValue[],
    key: string,
  ): Promise<void>;
}

/** What the hand-off needs of the transactions module itself. */
export interface TransactionRows {
  /** Runs `work` with the row (null when there is none) while it is locked in a transactions transaction. */
  whileLocked<T>(
    householdId: string,
    transactionId: string,
    work: (row: StoredTransaction | null) => Promise<T>,
  ): Promise<T>;
}

/** The other modules' ports the hand-off calls (the routes' and the worker's, src/wiring.ts). */
export interface HandOffDeps {
  readonly accounts: {
    postingAccount(householdId: string, accountId: string): Promise<PostingAccount | null>;
  };
  readonly ledger: Pick<Ledger, "post" | "correct" | "reverse" | "liveEntries">;
  readonly audit: TransactionAudit;
}

export const SOURCE_MODULE = "transactions";
export const EVENT = "transaction";

const FIELDS = ["accountId", "amount", "currency", "date", "counterparty", "description", "status"] as const;
const SENSITIVE: ReadonlySet<string> = new Set(["counterparty", "description"]);

function valueOf(t: StoredTransaction | null, field: (typeof FIELDS)[number]): string | null {
  if (t === null) return null;
  switch (field) {
    case "amount":
      return t.amount.toDecimalString();
    case "currency":
      return t.amount.currency;
    default:
      return t[field];
  }
}

/**
 * The transaction's entry in the space's own log (FIN-03 FR 20, П-10): every field before and after (an edit: only
 * those that changed). The counterparty and the description are free text that may name a person: masked here, so the
 * job's payload carries neither, and marked sensitive so the log masks them too.
 */
export function transactionAuditValues(
  action: TransactionHandOff["action"],
  before: StoredTransaction | null,
  after: StoredTransaction | null,
): TransactionAuditValue[] {
  const masked = (field: string, v: string | null) => (SENSITIVE.has(field) && v !== null ? AUDIT_MASK : v);
  return FIELDS.filter((f) => action !== "update" || valueOf(before, f) !== valueOf(after, f)).map(
    (field) => ({
      field,
      before: masked(field, valueOf(before, field)),
      after: masked(field, valueOf(after, field)),
      sensitive: SENSITIVE.has(field),
    }),
  );
}

const source = (id: string) => ({ module: SOURCE_MODULE, id });

/** The entry's signed amount on one journal account (zero when it has no posting there). */
function signedOn(entry: Entry, ledgerAccountId: string, currency: string): Money {
  let sum = Money.zero(currency);
  for (const p of entry.postings) {
    if (p.debitAccountId === ledgerAccountId) sum = sum.plus(p.amount);
    if (p.creditAccountId === ledgerAccountId) sum = sum.minus(p.amount);
  }
  return sum;
}

/** The journal account of the row's subaccount (the accounts module's directory). */
async function ledgerAccountOf(
  deps: HandOffDeps,
  householdId: string,
  row: StoredTransaction,
): Promise<string> {
  const account = await deps.accounts.postingAccount(householdId, row.accountId);
  const subaccount = account?.subaccounts.find((s) => s.subaccountId === row.subaccountId);
  // The account's own hand-off has not opened it yet, or it is being erased: retried later.
  if (!subaccount) throw new Error("the transaction's subaccount is not in the accounts directory");
  return subaccount.ledgerAccountId;
}

/**
 * Makes the journal match the row (called with the row locked): no row — every entry in effect reversed; a row — one
 * entry in effect on its subaccount's journal account with its signed amount and date, posted or corrected as needed.
 */
async function matchJournal(
  deps: HandOffDeps,
  householdId: string,
  transactionId: string,
  row: StoredTransaction | null,
): Promise<void> {
  const live = await deps.ledger.liveEntries(householdId, source(transactionId), EVENT);
  if (row === null) {
    for (const entry of live)
      await deps.ledger.reverse(householdId, entry.id, `transactions.delete:${entry.id}`);
    return;
  }
  // More than one entry in effect is never written; should one appear, only the latest stays.
  for (const extra of live.slice(0, -1))
    await deps.ledger.reverse(householdId, extra.id, `transactions.delete:${extra.id}`);
  const inEffect = live.at(-1);
  const ledgerAccountId = await ledgerAccountOf(deps, householdId, row);
  const replacement = {
    source: source(transactionId),
    operationDate: row.date,
    event: { type: EVENT, account: ledgerAccountId, amount: row.amount },
  } as const;
  if (!inEffect) {
    await deps.ledger.post(householdId, {
      ...replacement,
      idempotencyKey: `transactions.create:${transactionId}`,
    });
    return;
  }
  const matches =
    inEffect.operationDate === row.date &&
    signedOn(inEffect, ledgerAccountId, row.amount.currency).equals(row.amount);
  // Each entry in effect is corrected at most once, so its id makes the key.
  if (!matches)
    await deps.ledger.correct(householdId, inEffect.id, {
      ...replacement,
      idempotencyKey: `transactions.edit:${inEffect.id}`,
    });
}

/** Runs a hand-off; every step can run again (see above). Throws if a step fails, so the job is retried. */
export async function applyHandOff(
  deps: HandOffDeps,
  rows: TransactionRows,
  householdId: string,
  handOff: TransactionHandOff,
): Promise<void> {
  await rows.whileLocked(householdId, handOff.transactionId, (row) =>
    matchJournal(deps, householdId, handOff.transactionId, row),
  );
  await deps.audit.changed(
    householdId,
    handOff.actorAccountId,
    handOff.transactionId,
    handOff.action,
    handOff.audit,
    auditKey(handOff),
  );
}
