import { currencyCode, isId, Money } from "@willowsum/domain-kernel";
import {
  ACCOUNT_TYPES,
  assertBalanced,
  balanceMovements,
  conversionsFor,
  LedgerError,
  naturalBalance,
  postingsFor,
  refKey,
  reversalOf,
  RULES_VERSION,
  type AccountRef,
  type AccountType,
  type EntryConversion,
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
  /**
   * The rates of a cross-currency entry (FIN-04 EC1, ARC-11 «Запис проводок»): for the account in another currency than
   * the entry's, its actual amount, the entry's actual amount, the converted amount and the explicit dated rate. Empty
   * for an entry in one currency; a reversal keeps the rates of the entry it reverses.
   */
  readonly conversions: readonly EntryConversion[];
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

/** The checks of the daily integrity check (FIN-04 FR 9, AC7; ARC-11 «Перевірки цілісності»). */
export const INTEGRITY_CHECKS = [
  "unbalanced-entry",
  "empty-entry",
  "reversal-mismatch",
  "balance-cache",
] as const;
export type IntegrityCheck = (typeof INTEGRITY_CHECKS)[number];
/** How many entries fail each check; for `balance-cache`, how many accounts' cached balances differ from postings. */
export type IntegrityFindings = Record<IntegrityCheck, number>;

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
  /** The id of the entry that reverses `entryId`, if any. */
  reversalOf(entryId: string): Promise<string | null>;
  /** False when an entry with this idempotency key already exists (nothing is written then). */
  insertEntry(entry: NewEntry): Promise<boolean>;
  insertPostings(entryId: string, postings: readonly StoredPosting[]): Promise<void>;
  /** The rates of a cross-currency entry, with the entry and its postings in this transaction. */
  insertConversions(entryId: string, conversions: readonly EntryConversion[]): Promise<void>;
  /**
   * The event «проводку записано» of a new entry, in this transaction (ARC-11, ARC-04 FR 2): it is published only if
   * the entry commits. Never called for an idempotent repeat, which writes nothing.
   */
  recorded(entry: Entry): Promise<void>;
  /** Debit and credit totals of an account over entries dated up to `date`, recorded up to `asKnownAt`. */
  totals(
    accountId: string,
    date: string,
    asKnownAt: string | null,
  ): Promise<{ debits: string; credits: string }>;
  /**
   * The daily balance cache (ARC-11 «Баланси і продуктивність»): debit and credit totals of an account from its cached
   * row of the latest day up to `date`, or null when the cache cannot serve them — the account has no cache yet, or
   * `asKnownAt` is earlier than an entry the cache holds (then only the postings tell what was known).
   */
  cachedTotals(
    accountId: string,
    date: string,
    asKnownAt: string | null,
  ): Promise<{ debits: string; credits: string } | null>;
  /** The version of an account's balance cache, or null when the account has no cache yet. */
  balanceVersion(accountId: string): Promise<number | null>;
  /**
   * Adds an entry's movement on `day` to the account's cache, if its version is still `expected` (version check):
   * false when another transaction changed it first (a conflict; nothing is written). With `expected` null the
   * account has no cache yet: it is made from the account's postings, this transaction's included.
   */
  moveBalance(
    accountId: string,
    expected: number | null,
    day: string,
    debits: Money,
    credits: Money,
  ): Promise<boolean>;
  /** The space's accounts, all of them (`accountId` null) or the one given; ids in ascending order. */
  accountIds(accountId: string | null): Promise<string[]>;
  /** Rebuilds an account's cache from its postings under a new version; the number of days it holds. */
  rebuildBalance(accountId: string): Promise<number>;
  integrity(): Promise<IntegrityFindings>;
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

/** A code, not text (ARC-11: no free text in the journal): the source's event id, 1–200 characters. */
const KEY_RE = /^[A-Za-z0-9:._-]{1,200}$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key))
    throw new LedgerError(
      "INVALID_IDEMPOTENCY_KEY",
      "An idempotency key has 1–200 characters: letters, digits and : . _ -",
    );
}

/**
 * The key of a posting's side: an owner module's account by its id, a service account by its kind and the posting's
 * currency (one per currency: a cross-currency entry has «Валютна різниця» in each of its currencies).
 */
const sideKey = (ref: AccountRef, posting: Posting): string =>
  "account" in ref ? refKey(ref) : `${refKey(ref)}:${posting.amount.currency}`;

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
      if ("service" in ref && !resolved.has(sideKey(ref, p)))
        resolved.set(
          sideKey(ref, p),
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
  conversions: readonly EntryConversion[],
): Promise<Entry> {
  assertKey(header.idempotencyKey);
  assertDate(header.operationDate);
  assertSource(header.source);
  const existing = await tx.entryByKey(header.idempotencyKey);
  if (existing) return existing;
  const accounts = await resolve(tx, deps, postings);
  const account = (ref: AccountRef, p: Posting) => accounts.get(sideKey(ref, p))!;
  assertBalanced(postings, (ref, p) => account(ref, p).currency);
  const id = deps.newId();
  if (!(await tx.insertEntry({ ...header, id, rulesVersion: RULES_VERSION })))
    return (await tx.entryByKey(header.idempotencyKey))!;
  const stored = postings.map((p) => ({
    debitAccountId: account(p.debit, p).id,
    creditAccountId: account(p.credit, p).id,
    amount: p.amount,
  }));
  await tx.insertPostings(id, stored);
  if (conversions.length > 0) await tx.insertConversions(id, conversions);
  await moveBalances(tx, header.operationDate, stored);
  const entry = (await tx.entry(id))!;
  await tx.recorded(entry);
  return entry;
}

/** At most this many tries of one account's cache update before the entry is refused (and rolled back). */
export const BALANCE_ATTEMPTS = 5;

/**
 * Adds an entry's postings to the daily balance cache in the entry's transaction (ARC-11 «Баланси і продуктивність»):
 * per account, in the order of the ids, with a version check; a conflict — another entry on the same account changed
 * the cache first — is retried on the fresh version, so concurrent entries never lose each other's amounts.
 */
async function moveBalances(tx: LedgerTx, day: string, postings: readonly StoredPosting[]): Promise<void> {
  for (const m of balanceMovements(postings)) {
    let moved = false;
    for (let attempt = 0; attempt < BALANCE_ATTEMPTS && !moved; attempt++)
      moved = await tx.moveBalance(
        m.accountId,
        await tx.balanceVersion(m.accountId),
        day,
        m.debits,
        m.credits,
      );
    if (!moved)
      throw new LedgerError("BALANCE_CONFLICT", "The balance of an account kept changing; try again");
  }
}

async function postIn(tx: LedgerTx, deps: JournalDeps, input: PostInput): Promise<Entry> {
  // An event without a rule is refused before anything is read or written (ARC-11).
  const postings = postingsFor(input.event);
  assertKey(input.idempotencyKey);
  assertDate(input.operationDate);
  // A cross-currency event keeps its explicit dated rate on the entry (FIN-04 EC1, ARC-11).
  const conversions = conversionsFor(input.event, input.operationDate);
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
    conversions,
  );
}

async function reverseIn(
  tx: LedgerTx,
  deps: JournalDeps,
  entryId: string,
  idempotencyKey: string,
): Promise<Entry> {
  assertKey(idempotencyKey);
  assertId(entryId, "ENTRY_NOT_FOUND");
  const repeated = await tx.entryByKey(idempotencyKey);
  if (repeated) {
    // A repeat returns only the reversal this key made for this entry; another entry's key is never "the reversal".
    if (repeated.reversesEntryId !== entryId)
      throw new LedgerError("IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another entry");
    return repeated;
  }
  const original = await tx.entry(entryId);
  if (!original) throw new LedgerError("ENTRY_NOT_FOUND", "No such entry in this space");
  if (original.reversesEntryId !== null)
    throw new LedgerError("REVERSAL_OF_REVERSAL", "A reversal is not reversed; post a new entry instead");
  if ((await tx.reversalOf(entryId)) !== null)
    throw new LedgerError("ALREADY_REVERSED", "This entry has already been reversed");
  const postings = original.postings.map((p): Posting => ({
    debit: { account: p.debitAccountId },
    credit: { account: p.creditAccountId },
    amount: p.amount,
  }));
  // Dated as the original, so balances on every later date are as if the original had not been posted.
  return write(
    tx,
    deps,
    {
      source: original.source,
      eventType: "reversal",
      operationDate: original.operationDate,
      idempotencyKey,
      reversesEntryId: entryId,
    },
    reversalOf(postings),
    // The same rates: a reversal offsets the entry exactly, in every currency.
    original.conversions,
  );
}

/** Posts an event (FIN-04 FR 2, AC1, AC2): its balanced posting set in one database transaction. Idempotent. */
export async function post(deps: JournalDeps, householdId: string, input: PostInput): Promise<Entry> {
  return deps.store.inHousehold(householdId, (tx) => postIn(tx, deps, input));
}

/** Deleting an event (FIN-04 FR 5, AC3): a reversal entry that exactly offsets the original. Idempotent by key. */
export async function reverse(
  deps: JournalDeps,
  householdId: string,
  entryId: string,
  idempotencyKey: string,
): Promise<Entry> {
  return deps.store.inHousehold(householdId, (tx) => reverseIn(tx, deps, entryId, idempotencyKey));
}

/**
 * Changing an event (FIN-04 FR 5, AC3): the reversal of the old entry and the new entry, in one transaction.
 * Nothing is changed in place. Idempotent by the replacement's key.
 */
export async function correct(
  deps: JournalDeps,
  householdId: string,
  entryId: string,
  replacement: PostInput,
): Promise<{ readonly reversal: Entry; readonly entry: Entry }> {
  assertKey(replacement.idempotencyKey);
  const reversalKey = await correctionReversalKey(replacement.idempotencyKey);
  return deps.store.inHousehold(householdId, async (tx) => {
    // A repeat has both halves; a replacement key already used by another entry (the original's own, say) would
    // otherwise reverse the original and return an old entry as the replacement, losing the change.
    const madeReversal = await tx.entryByKey(reversalKey);
    const madeEntry = await tx.entryByKey(replacement.idempotencyKey);
    if ((madeReversal === null) !== (madeEntry === null) || madeEntry?.id === entryId)
      throw new LedgerError("IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another entry");
    const reversal = await reverseIn(tx, deps, entryId, reversalKey);
    return { reversal, entry: await postIn(tx, deps, replacement) };
  });
}

/**
 * The key of a correction's reversal, derived from the replacement's key with a fixed length (73 characters), so
 * every valid replacement key (1–200 characters) also gives a valid reversal key.
 */
async function correctionReversalKey(replacementKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(replacementKey));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `reversal:${hex}`;
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
    const asKnownAt = options.asKnownAt ?? null;
    // The cache when it can serve the question, else the postings themselves: both give the same numbers.
    const totals =
      (await tx.cachedTotals(account.id, date, asKnownAt)) ?? (await tx.totals(account.id, date, asKnownAt));
    return naturalBalance(
      account.type,
      Money.of(totals.debits, account.currency),
      Money.of(totals.credits, account.currency),
    );
  });
}

/**
 * The rebuild command of the daily balance cache (ARC-11 «Баланси і продуктивність»): every account of the space, or
 * one, rebuilt from its postings in one transaction, each under a new version (so an update that read the old
 * version retries on the rebuilt cache). A rebuild gives the same numbers as the cache it replaces.
 */
export async function rebuildBalances(
  deps: JournalDeps,
  householdId: string,
  accountId?: string,
): Promise<{ readonly accounts: number; readonly days: number }> {
  if (accountId !== undefined) assertId(accountId, "UNKNOWN_ACCOUNT");
  return deps.store.inHousehold(householdId, async (tx) => {
    const ids = await tx.accountIds(accountId ?? null);
    if (accountId !== undefined && ids.length === 0)
      throw new LedgerError("UNKNOWN_ACCOUNT", "No such account in this space");
    let days = 0;
    for (const id of ids) days += await tx.rebuildBalance(id);
    return { accounts: ids.length, days };
  });
}

/**
 * The daily integrity check (FIN-04 FR 9, FR 10, AC7; ARC-11): every space's entries are balanced, not empty,
 * every reversal exactly offsets its entry, and every account's cached daily balances equal the sum of its postings. Each failing check is reported once with the number of entries only —
 * no amounts, accounts or spaces; the user is shown nothing.
 */
export async function dailyIntegrityCheck(deps: {
  readonly store: LedgerStore;
  readonly spaces: () => Promise<readonly string[]>;
  readonly report: (check: IntegrityCheck, entries: number) => void;
  /** Spaces whose check could not run (an error in their query); reported with the count only, the rest go on. */
  readonly failed?: (spaces: number) => void;
}): Promise<IntegrityFindings> {
  const total = Object.fromEntries(INTEGRITY_CHECKS.map((c) => [c, 0])) as IntegrityFindings;
  let failed = 0;
  for (const householdId of await deps.spaces()) {
    let found: IntegrityFindings;
    try {
      found = await deps.store.inHousehold(householdId, (tx) => tx.integrity());
    } catch {
      // One space's failure does not hide the findings of the others.
      failed++;
      continue;
    }
    for (const check of INTEGRITY_CHECKS) total[check] += found[check];
  }
  for (const check of INTEGRITY_CHECKS) if (total[check] > 0) deps.report(check, total[check]);
  if (failed > 0) deps.failed?.(failed);
  return total;
}
