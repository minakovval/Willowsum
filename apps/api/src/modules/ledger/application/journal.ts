import { currencyCode, isId, Money } from "@willowsum/domain-kernel";
import {
  ACCOUNT_TYPES,
  assertBalanced,
  LedgerError,
  naturalBalance,
  postingsFor,
  refKey,
  RULES_VERSION,
  type AccountRef,
  type AccountType,
  type LedgerEvent,
  type Posting,
  type ServiceAccount,
} from "../domain/index.ts";

/** Ports and use cases of the journal (FIN-04@PoC, ARC-11; ADR-0011). Adapters are wired in ../index.ts. */

export interface LedgerAccount {
  readonly id: string;
  readonly type: AccountType;
  readonly currency: string;
}

/** The module (and its record) whose event made an entry; texts live there, not in the ledger. */
export interface EntrySource {
  readonly module: string;
  readonly id: string;
}

export interface StoredPosting {
  readonly debitAccountId: string;
  readonly creditAccountId: string;
  readonly amount: Money;
}

export interface Entry {
  readonly id: string;
  readonly source: EntrySource;
  /** The event type, or `reversal`. */
  readonly eventType: string;
  /** When it happened (YYYY-MM-DD). */
  readonly operationDate: string;
  /** When the system recorded it (set by the database; ISO 8601 UTC with microseconds). */
  readonly recordedAt: string;
  readonly rulesVersion: number;
  readonly reversesEntryId: string | null;
  readonly postings: readonly StoredPosting[];
}

export interface NewEntry {
  readonly id: string;
  readonly source: EntrySource;
  readonly eventType: string;
  readonly operationDate: string;
  readonly rulesVersion: number;
  readonly idempotencyKey: string;
  readonly reversesEntryId: string | null;
}

/** One transaction of the ledger schema, bound to one space. */
export interface LedgerTx {
  /** The space's accounts among `ids` (another space's accounts are not seen). */
  accounts(ids: readonly string[]): Promise<LedgerAccount[]>;
  ensureServiceAccount(kind: ServiceAccount, currency: string, newId: string): Promise<LedgerAccount>;
  ensureOwnedAccount(
    owner: EntrySource,
    account: { readonly type: AccountType; readonly currency: string },
    newId: string,
  ): Promise<LedgerAccount>;
  entry(id: string): Promise<Entry | null>;
  entryByKey(idempotencyKey: string): Promise<Entry | null>;
  /** False when an entry with this idempotency key already exists (nothing is written then). */
  insertEntry(entry: NewEntry): Promise<boolean>;
  insertPostings(entryId: string, postings: readonly StoredPosting[]): Promise<void>;
  /** Debit and credit totals of an account over entries dated up to `date`, recorded up to `asKnownAt`. */
  totals(
    accountId: string,
    date: string,
    asKnownAt: string | null,
  ): Promise<{ debits: string; credits: string }>;
}

export interface LedgerStore {
  /** One database transaction bound to the space: everything inside is written together or not at all. */
  inHousehold<T>(householdId: string, work: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

export interface JournalDeps {
  readonly store: LedgerStore;
  readonly newId: () => string;
}

/** An event to post: the source record, the source's event id as the idempotency key, the operation date. */
export interface PostInput {
  readonly source: EntrySource;
  readonly idempotencyKey: string;
  readonly operationDate: string;
  readonly event: LedgerEvent;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date YYYY-MM-DD (FIN-04 FR 6: balances are «on a date»). */
export function assertDate(value: string): void {
  const m = DATE_RE.exec(value);
  const valid =
    m !== null &&
    new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) === value &&
    +m[1]! >= 1900;
  if (!valid) throw new LedgerError("INVALID_DATE", "A date must be a calendar date YYYY-MM-DD");
}

/** A moment in strict ISO 8601, as `recordedAt` is written: date, `T`, time, up to 6 fraction digits, `Z` or ±hh:mm. */
const MOMENT_RE =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

/** Checks a moment before it reaches the database, so a bad one is INVALID_DATE and never a raw 22007. */
export function assertMoment(value: string): void {
  const m = MOMENT_RE.exec(value);
  if (m !== null) {
    try {
      assertDate(m[1]!);
      return;
    } catch {
      // falls through to the moment's own error
    }
  }
  throw new LedgerError(
    "INVALID_DATE",
    "asKnownAt must be an ISO 8601 time, e.g. 2026-06-30T10:00:00.000000Z",
  );
}

function assertId(id: string, code: string): void {
  if (!isId(id)) throw new LedgerError(code, "An identifier must be a UUID");
}

function assertSource(source: EntrySource): void {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(source.module))
    throw new LedgerError("INVALID_SOURCE", "Unknown source module");
  assertId(source.id, "INVALID_SOURCE");
}

function assertKey(key: string): void {
  if (key.length < 1 || key.length > 200)
    throw new LedgerError("INVALID_IDEMPOTENCY_KEY", "An idempotency key has 1–200 characters");
}

/** Resolves every side of the postings to an account of the space; service accounts are made on first use. */
async function resolve(
  tx: LedgerTx,
  deps: JournalDeps,
  postings: readonly Posting[],
): Promise<Map<string, LedgerAccount>> {
  const resolved = new Map<string, LedgerAccount>();
  const ids = [
    ...new Set(
      postings.flatMap((p) => [p.debit, p.credit]).flatMap((r) => ("account" in r ? [r.account] : [])),
    ),
  ];
  for (const id of ids) assertId(id, "UNKNOWN_ACCOUNT");
  const found = await tx.accounts(ids);
  for (const a of found) resolved.set(refKey({ account: a.id }), a);
  if (found.length !== ids.length)
    throw new LedgerError("UNKNOWN_ACCOUNT", "An account of the event does not exist in this space");
  for (const p of postings)
    for (const ref of [p.debit, p.credit])
      if ("service" in ref && !resolved.has(refKey(ref)))
        resolved.set(
          refKey(ref),
          await tx.ensureServiceAccount(ref.service, p.amount.currency, deps.newId()),
        );
  return resolved;
}

/** Writes one entry with its postings, or returns the entry already made with the same idempotency key. */
async function write(
  tx: LedgerTx,
  deps: JournalDeps,
  header: Omit<NewEntry, "id" | "rulesVersion">,
  postings: readonly Posting[],
): Promise<Entry> {
  assertKey(header.idempotencyKey);
  assertDate(header.operationDate);
  assertSource(header.source);
  const existing = await tx.entryByKey(header.idempotencyKey);
  if (existing) return existing;
  const accounts = await resolve(tx, deps, postings);
  const account = (ref: AccountRef) => accounts.get(refKey(ref))!;
  assertBalanced(postings, (ref) => account(ref).currency);
  const id = deps.newId();
  if (!(await tx.insertEntry({ ...header, id, rulesVersion: RULES_VERSION })))
    return (await tx.entryByKey(header.idempotencyKey))!;
  await tx.insertPostings(
    id,
    postings.map((p) => ({
      debitAccountId: account(p.debit).id,
      creditAccountId: account(p.credit).id,
      amount: p.amount,
    })),
  );
  return (await tx.entry(id))!;
}

async function postIn(tx: LedgerTx, deps: JournalDeps, input: PostInput): Promise<Entry> {
  // An event without a rule is refused before anything is read or written (ARC-11).
  const postings = postingsFor(input.event);
  return write(
    tx,
    deps,
    {
      source: input.source,
      eventType: input.event.type,
      operationDate: input.operationDate,
      idempotencyKey: input.idempotencyKey,
      reversesEntryId: null,
    },
    postings,
  );
}

/** Posts an event (FIN-04 FR 2, AC1, AC2): its balanced posting set in one database transaction. Idempotent. */
export async function post(deps: JournalDeps, householdId: string, input: PostInput): Promise<Entry> {
  return deps.store.inHousehold(householdId, (tx) => postIn(tx, deps, input));
}

/** A ledger account for an owner module's record (ARC-11: made by the owner's event). Idempotent per owner. */
export async function openAccount(
  deps: JournalDeps,
  householdId: string,
  owner: EntrySource,
  account: { readonly type: AccountType; readonly currency: string },
): Promise<LedgerAccount> {
  if (!ACCOUNT_TYPES.includes(account.type)) throw new LedgerError("INVALID_ACCOUNT", "Unknown account type");
  assertSource(owner);
  const currency = currencyCode(account.currency);
  return deps.store.inHousehold(householdId, async (tx) => {
    const opened = await tx.ensureOwnedAccount(owner, { type: account.type, currency }, deps.newId());
    if (opened.type !== account.type || opened.currency !== currency)
      throw new LedgerError("ACCOUNT_CONFLICT", "The owner's ledger account has another type or currency");
    return opened;
  });
}

/**
 * The balance of an account on a date (FIN-04 FR 6, AC4): the postings of entries dated up to that date inclusive,
 * reversals included, with the sign of the account's type. With `asKnownAt`, only entries recorded by then (ARC-11).
 */
export async function balanceAt(
  deps: JournalDeps,
  householdId: string,
  accountId: string,
  date: string,
  options: { readonly asKnownAt?: string } = {},
): Promise<Money> {
  assertDate(date);
  assertId(accountId, "UNKNOWN_ACCOUNT");
  if (options.asKnownAt !== undefined) assertMoment(options.asKnownAt);
  return deps.store.inHousehold(householdId, async (tx) => {
    const [account] = await tx.accounts([accountId]);
    if (!account) throw new LedgerError("UNKNOWN_ACCOUNT", "No such account in this space");
    const totals = await tx.totals(account.id, date, options.asKnownAt ?? null);
    return naturalBalance(
      account.type,
      Money.of(totals.debits, account.currency),
      Money.of(totals.credits, account.currency),
    );
  });
}
