import { Money } from "@willowsum/domain-kernel";
import { AUDIT_MASK } from "../../audit/index.ts";
import type { Entry, Ledger, PostInput } from "../../ledger/index.ts";
import {
  splitAuditFields,
  transferDate,
  transferFee,
  type PostingAccount,
  type TransferLink,
} from "../domain/index.ts";
import type { StoredTransaction } from "./stored.ts";

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
  /**
   * `split` — «Розділити» or «Об'єднати назад» (BUD-13 FR 6, FR 8); `hide` / `show` — «Приховати транзакцію» and
   * showing it again (FIN-03 FR 16, FR 17): a hidden manual transaction (a duplicate) leaves the journal, shown again it
   * is posted; a split does not change the journal.
   */
  readonly action: (typeof HAND_OFF_ACTIONS)[number];
  /** The row's version after the change (a delete: the version deleted); makes each change its own job and entry. */
  readonly version: number;
  /**
   * `transfer` / `untransfer` (FIN-03 FR 7, FR 9): the transfer marked or removed, so a late hand-off still finds the
   * journal event of a transfer the row no longer points at and reverses it.
   */
  readonly transferId?: string | undefined;
  /** The audit entry's fields before and after; the counterparty and the description are masked already. */
  readonly audit: readonly TransactionAuditValue[];
}

export interface TransactionAuditValue {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly sensitive: boolean;
}

export const HAND_OFF_ACTIONS = [
  "create",
  "update",
  "delete",
  "split",
  "hide",
  "show",
  "transfer",
  "untransfer",
  // FIN-03 FR 11, FR 12, edge case 4 (application/duplicates.ts): «Об'єднати», «Роз'єднати» and «Не дубль».
  "merge",
  "unmerge",
  "not-duplicate",
] as const;

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
  /**
   * Runs `work` with the row (null when there is none) while it is locked in a transactions transaction; `find` reads
   * another row of the space in the same transaction (the other side of a transfer).
   */
  whileLocked<T>(
    householdId: string,
    transactionId: string,
    work: (
      row: StoredTransaction | null,
      find: (id: string) => Promise<StoredTransaction | null>,
    ) => Promise<T>,
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

/** The row's audited fields: the form's, then «прихована» once it was hidden, then the split's (domain/splits.ts). */
function fieldsOf(t: StoredTransaction | null): Map<string, string | null> {
  const fields = new Map<string, string | null>();
  for (const field of FIELDS) {
    if (t === null) fields.set(field, null);
    else if (field === "amount") fields.set(field, t.amount.toDecimalString());
    else if (field === "currency") fields.set(field, t.amount.currency);
    else fields.set(field, t[field]);
  }
  if (t?.hidden) fields.set("hidden", "true");
  // FIN-03 FR 11: the transaction a duplicate was merged into.
  if (t?.mergedInto) fields.set("mergedInto", t.mergedInto);
  // FIN-03 FR 7: the side and the other transaction of its transfer, and the rate kept in two currencies.
  if (t?.transfer) {
    const outflow = t.transfer.outflowId === t.id;
    fields.set("transfer.side", outflow ? "outflow" : "inflow");
    fields.set("transfer.with", outflow ? t.transfer.inflowId : t.transfer.outflowId);
    const r = t.transfer.rate;
    if (r) fields.set("transfer.rate", `${r.rate.toString()} ${r.base}/${r.quote} ${r.date} ${r.source}`);
  }
  for (const [field, value] of splitAuditFields(t?.split ?? null)) fields.set(field, value);
  return fields;
}

/**
 * The transaction's entry in the space's own log (FIN-03 FR 20, П-10): every field before and after (any change but a
 * create or a delete: only those that changed). The counterparty and the description are free text that may name a
 * person: masked here, so the job's payload carries neither, and marked sensitive so the log masks them too.
 */
export function transactionAuditValues(
  action: TransactionHandOff["action"],
  before: StoredTransaction | null,
  after: StoredTransaction | null,
): TransactionAuditValue[] {
  const masked = (field: string, v: string | null) => (SENSITIVE.has(field) && v !== null ? AUDIT_MASK : v);
  const was = fieldsOf(before);
  const is = fieldsOf(after);
  const all = action === "create" || action === "delete";
  return [...new Set([...was.keys(), ...is.keys()])]
    .filter((f) => all || (was.get(f) ?? null) !== (is.get(f) ?? null))
    .map((field) => ({
      field,
      before: masked(field, was.get(field) ?? null),
      after: masked(field, is.get(field) ?? null),
      sensitive: SENSITIVE.has(field),
    }));
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

/** The row's own `transaction` event as the journal should have it: its amount and date, or none. */
interface OwnEvent {
  readonly amount: Money;
  readonly date: string;
}

/**
 * What the journal should hold for the row (FIN-03 FR 4, FR 7, FR 8, FR 11, edge case 1): no row, «Очікує», a duplicate
 * merged into another (the operation counts once) or the inflow of a transfer — no own event; the outflow of a transfer — its fee in one currency (else none) and the transfer event, both
 * dated by the transfer's earlier side; any other posted row — its amount on its date.
 */
async function desiredJournal(
  deps: HandOffDeps,
  householdId: string,
  row: StoredTransaction | null,
  find: (id: string) => Promise<StoredTransaction | null>,
): Promise<{
  readonly own: OwnEvent | null;
  readonly transfer: {
    readonly link: TransferLink;
    readonly input: PostInput["event"];
    readonly date: string;
  } | null;
}> {
  // FIN-03 FR 17 (owner, 2026-11-15, #281 item 1): a manual transaction hidden as a duplicate leaves the balance as a
  // merged one does, and comes back when shown; an imported one (bank data) keeps its event so the balance matches the bank.
  if (
    row === null ||
    row.status === "pending" ||
    row.mergedInto !== null ||
    (row.hidden && row.source === "manual")
  )
    return { own: null, transfer: null };
  if (row.transfer === null) return { own: { amount: row.amount, date: row.date }, transfer: null };
  if (row.transfer.inflowId === row.id) return { own: null, transfer: null };
  const inflow = await find(row.transfer.inflowId);
  // The pair is written in one transaction with both rows, so the other side is there; should it not be, retried.
  if (!inflow || inflow.transfer?.id !== row.transfer.id)
    throw new Error("the transfer's inflow is not in its pair");
  const date = transferDate(row, inflow);
  const fee = transferFee(row, inflow);
  const from = await ledgerAccountOf(deps, householdId, row);
  const to = await ledgerAccountOf(deps, householdId, inflow);
  const rate = row.transfer.rate;
  const input: PostInput["event"] =
    rate === null
      ? { type: "transfer", from, to, amount: inflow.amount }
      : { type: "fx-transfer", from, to, sent: row.amount.negated(), received: inflow.amount, rate };
  return { own: fee === null ? null : { amount: fee, date }, transfer: { link: row.transfer, input, date } };
}

const TRANSFER_EVENTS = ["transfer", "fx-transfer"] as const;

/**
 * The events of the transfers the hand-off names or the row points at (source `transactions` / the transfer's id):
 * the one wanted is posted once (key `transactions.transfer:<transfer>`), every other is reversed. A transfer's amounts
 * and rate never change while it is marked, so an event once posted stays as it is.
 */
async function matchTransfers(
  deps: HandOffDeps,
  householdId: string,
  transferIds: readonly string[],
  wanted: Awaited<ReturnType<typeof desiredJournal>>["transfer"],
): Promise<void> {
  for (const transferId of new Set(transferIds)) {
    const live: Entry[] = [];
    for (const type of TRANSFER_EVENTS)
      live.push(...(await deps.ledger.liveEntries(householdId, source(transferId), type)));
    const keep = wanted?.link.id === transferId ? live.at(-1) : undefined;
    for (const entry of live)
      if (entry !== keep) await deps.ledger.reverse(householdId, entry.id, `transactions.delete:${entry.id}`);
    if (wanted?.link.id === transferId && !keep)
      await deps.ledger.post(householdId, {
        source: source(transferId),
        idempotencyKey: `transactions.transfer:${transferId}`,
        operationDate: wanted.date,
        event: wanted.input,
      });
  }
}

/** The row's own `transaction` event made to match `own`: posted, corrected or reversed as needed. */
async function matchOwnEvent(
  deps: HandOffDeps,
  householdId: string,
  row: StoredTransaction | null,
  transactionId: string,
  own: OwnEvent | null,
): Promise<void> {
  const live = await deps.ledger.liveEntries(householdId, source(transactionId), EVENT);
  if (row === null || own === null) {
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
    operationDate: own.date,
    event: { type: EVENT, account: ledgerAccountId, amount: own.amount },
  } as const;
  if (!inEffect) {
    // The first event of a transaction posted from the start keeps the key of its create; a later one (posted after
    // «Очікує», or again after going back to it, or after a transfer's mark is removed) the key of the row's version,
    // so a reversed event is never reused.
    await deps.ledger.post(householdId, {
      ...replacement,
      idempotencyKey:
        row.version === 1
          ? `transactions.create:${transactionId}`
          : `transactions.post:${transactionId}:${row.version}`,
    });
    return;
  }
  const matches =
    inEffect.operationDate === own.date &&
    signedOn(inEffect, ledgerAccountId, own.amount.currency).equals(own.amount);
  // Each entry in effect is corrected at most once, so its id makes the key.
  if (!matches)
    await deps.ledger.correct(householdId, inEffect.id, {
      ...replacement,
      idempotencyKey: `transactions.edit:${inEffect.id}`,
    });
}

/**
 * Makes the journal match the row (called with the row locked). A transfer's outflow turns its own event into the fee
 * before the transfer event is posted; with the mark removed, the transfer event is reversed before its own event comes
 * back — so between the steps the balances never count the pair twice.
 */
async function matchJournal(
  deps: HandOffDeps,
  householdId: string,
  handOff: TransactionHandOff,
  row: StoredTransaction | null,
  find: (id: string) => Promise<StoredTransaction | null>,
): Promise<void> {
  const wanted = await desiredJournal(deps, householdId, row, find);
  // The outflow's hand-off owns the event of a transfer in effect; the inflow's leaves it alone (they may run at once),
  // and either reverses the event of a transfer the row is no longer in.
  const active = row?.transfer ?? null;
  const transferIds = [handOff.transferId, active?.id].filter(
    (t): t is string => t !== undefined && !(active?.id === t && active.inflowId === row?.id),
  );
  if (wanted.transfer === null) await matchTransfers(deps, householdId, transferIds, null);
  await matchOwnEvent(deps, householdId, row, handOff.transactionId, wanted.own);
  if (wanted.transfer !== null) await matchTransfers(deps, householdId, transferIds, wanted.transfer);
}

/** Runs a hand-off; every step can run again (see above). Throws if a step fails, so the job is retried. */
export async function applyHandOff(
  deps: HandOffDeps,
  rows: TransactionRows,
  householdId: string,
  handOff: TransactionHandOff,
): Promise<void> {
  await rows.whileLocked(householdId, handOff.transactionId, (row, find) =>
    matchJournal(deps, householdId, handOff, row, find),
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
