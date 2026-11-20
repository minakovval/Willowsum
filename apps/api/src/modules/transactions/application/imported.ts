import { currencyInfo, type Money } from "@willowsum/domain-kernel";
import {
  counterpartyText,
  descriptionText,
  isCalendarDay,
  reviewOnCreate,
  subaccountFor,
  type PostingAccount,
} from "../domain/index.ts";
import { transactionAuditValues, type HandOffDeps, type TransactionHandOff } from "./hand-off.ts";
import type { NewStoredTransaction, StoredTransaction } from "./stored.ts";

/**
 * The write of an import batch's rows (IMP-01@PoC FR 11, IMP-04@PoC FR 7, AC9; the apply step of module import-sessions,
 * parts a and b; #637, #654). One transaction of this module for the whole batch, in this order:
 *
 * 0. a waiter's place of the space (`IMPORT_WAITERS_MAX` at a time): none free — `ImportBusy`, nothing written;
 * 1. the import lock of each of the batch's accounts (in the order of their ids): two applies on one account — the same
 *    batch twice, or two batches — run one after the other, and the second plans with what the first wrote;
 * 2. the batch's write record (`import_writes`): found — this batch was written already (a retry after a crash, or a
 *    request at the same time): nothing is written, its counts come back; the attempt given up (`import_voids`, see
 *    `settleImport`) — `ImportWriteVoided`, nothing written;
 * 3. the accounts' state: unknown or closed — refused, nothing written;
 * 4. the caller's plan, file by file, reading the accounts' transactions in this same transaction (so a file of the
 *    batch is planned after the one before it is written: two copies of one file, or overlapping files, in one batch
 *    are duplicates), each row written once by its key (batch, file, row);
 * 5. only then the accounts' money lock (accounts `lockAccounts`, which their closing, «Оновити залишок» and wallet
 *    removal take; #654: other writers of the account never wait for the plan) and their state again: closed meanwhile,
 *    or a wallet the rows went to removed — refused, everything rolled back. The rows are invisible to every other
 *    transaction until the commit, so a closing or a balance update that ran during the plan simply comes first;
 * 6. the write record with the plan's counts, the hand-off jobs (journal and audit, ARC-04 FR 2) and «Нова транзакція»
 *    (`transactions.created`, category rules), then commit.
 *
 * The journal follows each transaction's hand-off after the commit (right away for the first `HAND_OFF_NOW`, the
 * worker for the rest), as for every other change of this module.
 */

/** #654: at most this many applies of one space are in the write (one writing, the rest waiting for its locks). */
export const IMPORT_WAITERS_MAX = 4;

/** One row of a statement file to create as a transaction. */
export interface ImportedRowInput {
  /** The batch file of module import-sessions. */
  readonly fileId: string;
  /** The row of the file, from 1. */
  readonly row: number;
  readonly accountId: string;
  /** Signed, in a currency of the account. */
  readonly amount: Money;
  readonly date: string;
  /** The bank's description as printed (masked by the caller); kept apart from the user's edits too. */
  readonly description: string | null;
  readonly counterparty: string | null;
  /** The balance after the operation as printed; null — none. */
  readonly balanceAfter: Money | null;
}

export type ImportWriteIssue =
  | "account-not-found"
  | "account-closed"
  | "account-changed"
  | "currency"
  | "amount"
  | "date"
  | "text"
  | "file-not-in-batch";

/** A row or account the write cannot take; the whole write is rolled back, nothing written. */
export class ImportWriteRefused extends Error {
  readonly issue: ImportWriteIssue;
  readonly accountId: string;
  readonly fileId: string | null;
  readonly row: number | null;

  constructor(issue: ImportWriteIssue, at: { accountId: string; fileId?: string; row?: number }) {
    super(`Import write refused: ${issue}`);
    this.name = "ImportWriteRefused";
    this.issue = issue;
    this.accountId = at.accountId;
    this.fileId = at.fileId ?? null;
    this.row = at.row ?? null;
  }
}

/** The attempt was given up (`settleImport`) before it wrote: nothing written; the caller's batch is not «applying». */
export class ImportWriteVoided extends Error {
  constructor() {
    super("The attempt to write the import batch was given up");
    this.name = "ImportWriteVoided";
  }
}

/** #654: `IMPORT_WAITERS_MAX` applies of the space are in the write already; nothing written, try again. */
export class ImportBusy extends Error {
  constructor() {
    super("Too many imports of the space at once");
    this.name = "ImportBusy";
  }
}

/** The plan of the batch as the caller runs it inside the write's transaction. */
export interface ImportPlanContext {
  /** The accounts' transactions as module duplicate-matching reads them (`ImportCandidates`), in this transaction. */
  readonly candidates: {
    page(
      householdId: string,
      query: {
        readonly accountId: string;
        readonly from: string;
        readonly to: string;
        readonly limit: number;
        readonly after?: { readonly date: string; readonly id: string };
      },
    ): Promise<readonly ImportCandidateRow[]>;
  };
  /** Writes these rows now (each once by its key); the next file's plan sees them. */
  create(rows: readonly ImportedRowInput[]): Promise<void>;
}

/** A transaction of the account as the plan reads it (the same as the public `ImportCandidate`). */
export interface ImportCandidateRow {
  readonly transactionId: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly date: string;
  readonly description: string | null;
  readonly balanceAfter: Money | null;
  readonly status: "posted" | "pending";
  readonly source: "manual" | "imported";
  readonly importBatchId: string | null;
  readonly hidden: boolean;
  readonly transfer: boolean;
  readonly matched: boolean;
}

export interface ImportWriteInput {
  readonly batchId: string;
  /** The caller's attempt of applying the batch (one id for every request that joins it). */
  readonly attemptId: string;
  readonly actorId: string;
  /** Every account the batch's files write to. */
  readonly accountIds: readonly string[];
  /** The batch's files, in their order; a row of another file is refused. */
  readonly fileIds: readonly string[];
}

/** The counts the plan returns (names `[a-z-]`, whole numbers ≥ 0; the caller checks them). */
export type ImportCounts = Readonly<Record<string, number>>;

export interface ImportWriteResult {
  /** False — the batch was written before (by an earlier or a concurrent request): nothing was written now. */
  readonly first: boolean;
  readonly counts: ImportCounts;
  /** The transactions created now (0 when not `first`). */
  readonly created: number;
}

export interface ImportedRow extends NewStoredTransaction {
  readonly importBatchId: string;
  readonly importFileId: string;
  readonly importRow: number;
  readonly bankDescription: string | null;
  readonly balanceAfter: Money | null;
}

export interface ImportWriteTx {
  /** Step 0: a waiter's place of the space until the transaction ends; false — none free. */
  enterImport(householdId: string): Promise<boolean>;
  /** Step 1: the import lock of each account until the transaction ends. */
  lockImport(householdId: string, accountIds: readonly string[]): Promise<void>;
  /** Step 2: the counts of the batch's earlier write; null — not written. */
  written(householdId: string, batchId: string): Promise<ImportCounts | null>;
  /** Step 2: the attempt was given up. */
  voided(householdId: string, batchId: string, attemptId: string): Promise<boolean>;
  /** `settleImport`: the attempt given up (once). */
  voidAttempt(householdId: string, batchId: string, attemptId: string, at: Date): Promise<void>;
  lockAccounts(householdId: string, accountIds: readonly string[]): Promise<void>;
  /** The row unless the batch's file row is written already (then null). */
  insertImported(householdId: string, row: ImportedRow): Promise<StoredTransaction | null>;
  recordWrite(
    householdId: string,
    batchId: string,
    counts: ImportCounts,
    actorId: string,
    at: Date,
  ): Promise<void>;
  enqueueHandOff(householdId: string, handOff: TransactionHandOff): Promise<void>;
  publishCreated(householdId: string, transactionId: string): Promise<void>;
  candidates: ImportPlanContext["candidates"];
}

export interface ImportWriteDeps {
  readonly accounts: HandOffDeps["accounts"];
  readonly newId: () => string;
  readonly now: () => Date;
}

/**
 * The bank's text as an imported transaction keeps it: NFC, the column's length (1 000 code points for the description,
 * 200 for the counterparty) and then the form's rule; null — none; undefined — a text the rule refuses (a control or a
 * direction mark). Pure: the caller's plan compares the same text the row stores (#654: a long description is clipped
 * the same way in both, so an overlapping statement finds its rows).
 */
export function importedText(value: string | null, field: "description" | "counterparty") {
  if (value === null) return null;
  const max = field === "description" ? 1000 : 200;
  const clipped = [...value.normalize("NFC")].slice(0, max).join("");
  return field === "description" ? descriptionText(clipped) : counterpartyText(clipped);
}

export async function writeImport(
  deps: ImportWriteDeps,
  tx: ImportWriteTx,
  householdId: string,
  input: ImportWriteInput,
  plan: (context: ImportPlanContext) => Promise<ImportCounts>,
): Promise<ImportWriteResult & { readonly handOffs: readonly TransactionHandOff[] }> {
  const accountIds = [...new Set(input.accountIds.map((id) => id.toLowerCase()))].sort();
  if (!(await tx.enterImport(householdId))) throw new ImportBusy();
  await tx.lockImport(householdId, accountIds);
  const earlier = await tx.written(householdId, input.batchId);
  if (earlier) return { first: false, counts: earlier, created: 0, handOffs: [] };
  if (await tx.voided(householdId, input.batchId, input.attemptId)) throw new ImportWriteVoided();
  const readAccounts = async () => {
    const found = new Map<string, PostingAccount>();
    for (const accountId of accountIds) {
      const account = await deps.accounts.postingAccount(householdId, accountId);
      // Another space's account and an unknown one answer the same (П-5).
      if (!account) throw new ImportWriteRefused("account-not-found", { accountId });
      if (account.status === "closed") throw new ImportWriteRefused("account-closed", { accountId });
      found.set(accountId, account);
    }
    return found;
  };
  const accounts = await readAccounts();
  const files = new Set(input.fileIds);
  const handOffs: TransactionHandOff[] = [];
  // The wallet each (account, currency) of the rows went to: checked again under the money lock (step 5).
  const wallets = new Map<string, { accountId: string; currency: string; subaccountId: string }>();
  const create = async (rows: readonly ImportedRowInput[]) => {
    for (const r of rows) {
      const at = { accountId: r.accountId, fileId: r.fileId, row: r.row };
      if (!files.has(r.fileId)) throw new ImportWriteRefused("file-not-in-batch", at);
      const account = accounts.get(r.accountId.toLowerCase());
      if (!account) throw new ImportWriteRefused("account-not-found", at);
      const subaccount = subaccountFor(account, r.amount.currency);
      if (subaccount === "currency_mismatch") throw new ImportWriteRefused("currency", at);
      // Money is exact: no more decimals than the currency has, never zero (nothing moved).
      if (r.amount.isZero() || r.amount.amount.decimalPlaces() > currencyInfo(r.amount.currency).minorUnits)
        throw new ImportWriteRefused("amount", at);
      if (r.balanceAfter && r.balanceAfter.currency !== r.amount.currency)
        throw new ImportWriteRefused("amount", at);
      if (!isCalendarDay(r.date)) throw new ImportWriteRefused("date", at);
      wallets.set(`${account.accountId}/${r.amount.currency}`, {
        accountId: account.accountId.toLowerCase(),
        currency: r.amount.currency,
        subaccountId: subaccount.subaccountId,
      });
      const description = importedText(r.description, "description");
      const counterparty = importedText(r.counterparty, "counterparty");
      if (description === undefined || counterparty === undefined) throw new ImportWriteRefused("text", at);
      const row = await tx.insertImported(householdId, {
        id: deps.newId(),
        accountId: account.accountId,
        subaccountId: subaccount.subaccountId,
        amount: r.amount,
        date: r.date,
        counterparty,
        description,
        status: "posted",
        source: "imported",
        hidden: false,
        split: null,
        transfer: null,
        mergedInto: null,
        note: null,
        tagIds: [],
        // BUD-12 FR 8: an imported transaction goes into «До розбору».
        review: reviewOnCreate({ importedFromStatement: true }),
        version: 1,
        importBatchId: input.batchId,
        importFileId: r.fileId,
        importRow: r.row,
        bankDescription: description,
        balanceAfter: r.balanceAfter,
      });
      // Written already by this batch (the unique key): never twice.
      if (!row) continue;
      await tx.publishCreated(householdId, row.id);
      const h: TransactionHandOff = {
        transactionId: row.id,
        actorAccountId: input.actorId,
        action: "create",
        version: row.version,
        audit: transactionAuditValues("create", null, row),
      };
      await tx.enqueueHandOff(householdId, h);
      handOffs.push(h);
    }
  };
  const counts = await plan({ candidates: tx.candidates, create });
  // Step 5: the money lock only now; the accounts as they are under it.
  await tx.lockAccounts(householdId, accountIds);
  const locked = await readAccounts();
  for (const w of wallets.values()) {
    const subaccount = subaccountFor(locked.get(w.accountId)!, w.currency);
    if (subaccount === "currency_mismatch" || subaccount.subaccountId !== w.subaccountId)
      throw new ImportWriteRefused("account-changed", { accountId: w.accountId });
  }
  await tx.recordWrite(householdId, input.batchId, counts, input.actorId, deps.now());
  return { first: true, counts, created: handOffs.length, handOffs };
}

/**
 * #654: gives up an attempt of applying a batch unless the batch is written (module import-sessions: a refused apply,
 * and the daily recovery of one stuck «in progress»). Under the import lock of the batch's accounts — so a write of the
 * batch in progress finishes first — the counts of the batch's write when there is one (the attempt is not given up:
 * the caller finishes it), else the attempt is recorded as given up and null comes back: no write of it can follow.
 */
export async function settleImport(
  deps: Pick<ImportWriteDeps, "now">,
  tx: Pick<ImportWriteTx, "lockImport" | "written" | "voidAttempt">,
  householdId: string,
  input: Pick<ImportWriteInput, "batchId" | "attemptId" | "accountIds">,
): Promise<ImportCounts | null> {
  const accountIds = [...new Set(input.accountIds.map((id) => id.toLowerCase()))].sort();
  await tx.lockImport(householdId, accountIds);
  const written = await tx.written(householdId, input.batchId);
  if (written) return written;
  await tx.voidAttempt(householdId, input.batchId, input.attemptId, deps.now());
  return null;
}
