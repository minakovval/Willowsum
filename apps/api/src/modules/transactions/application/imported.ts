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
 *    are duplicates), each row written once by its key (batch, file, row) and its link made with the other
 *    transaction locked in the order of ids (IMP-04 FR 5: a manual one merged into it; FR 6: a pending one merged
 *    into it);
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
  /**
   * IMP-04 FR 5 (#637 item 6, #658): this manual transaction is merged into the row. The row is the record that stays
   * (the bank's identifier, text, posting date and its journal event) and takes the manual one's note, tags and
   * «До розбору» state; the manual one is hidden with `mergedInto`, its event reversed («Роз'єднати» gives it back).
   * Its category is carried by module categorization (`transactions.import-merged`).
   */
  readonly mergeInto?: string;
  /**
   * IMP-04 FR 6: the row, posted, replaces this pending one of a previous import («замінено») — with the amount the
   * plan compared: the pending one is hidden, merged into the row (no journal event: it had none).
   */
  readonly replaces?: { readonly transactionId: string; readonly amount: Money };
  /**
   * What happens when the link (`mergeInto` or `replaces`) cannot be made now — the other transaction changed since
   * the plan read it: `write` (the default) writes the row on its own, `skip` writes nothing. Either way the row is in
   * `ImportCreated.unlinked`.
   */
  readonly ifUnlinked?: "write" | "skip";
}

/** What `ImportPlanContext.create` did beyond writing each row once. */
export interface ImportCreated {
  /** The rows (file, row) whose `mergeInto` or `replaces` was not made. */
  readonly unlinked: readonly { readonly fileId: string; readonly row: number }[];
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
  /** FR 4 (#655): the batch's account is a credit card (accounts' kind «credit-card», as read in step 3). */
  creditCard(accountId: string): boolean;
  /** Writes these rows now (each once by its key) and their links; the next file's plan sees them. */
  create(rows: readonly ImportedRowInput[]): Promise<ImportCreated>;
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
  /** Merged into another transaction (an imported one: a replaced pending one). */
  readonly merged: boolean;
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

/** FR 5 (#658): a manual transaction (`duplicateId`) merged into the bank's (`transactionId`) by this write. */
export interface ImportMerge {
  readonly transactionId: string;
  readonly duplicateId: string;
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
  /** IMP-04 FR 5, FR 6: the other transaction of a link, locked until the transaction ends (as a merge locks it). */
  lock(householdId: string, id: string): Promise<StoredTransaction | null>;
  /** The transaction as it is now (read after its lock, in this transaction). */
  find(householdId: string, id: string): Promise<StoredTransaction | null>;
  update(householdId: string, row: NewStoredTransaction): Promise<StoredTransaction>;
  /** The transactions merged into `id`. */
  duplicatesOf(householdId: string, id: string): Promise<string[]>;
  recordWrite(
    householdId: string,
    batchId: string,
    counts: ImportCounts,
    actorId: string,
    at: Date,
  ): Promise<void>;
  enqueueHandOff(householdId: string, handOff: TransactionHandOff): Promise<void>;
  publishCreated(householdId: string, transactionId: string): Promise<void>;
  /** FR 5 (#658): «Злито з імпортом» (`transactions.import-merged`) in the outbox, in this transaction. */
  publishImportMerged(
    householdId: string,
    merge: ImportMerge & { readonly actorAccountId: string },
  ): Promise<void>;
  /**
   * #658: the row locked without waiting: «busy» — another transaction holds it (no link is made, so a lock is never
   * waited for out of the order of ids); null — no such row.
   */
  tryLock(householdId: string, id: string): Promise<StoredTransaction | null | "busy">;
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
): Promise<
  ImportWriteResult & {
    readonly handOffs: readonly TransactionHandOff[];
    readonly merges: readonly ImportMerge[];
  }
> {
  const accountIds = [...new Set(input.accountIds.map((id) => id.toLowerCase()))].sort();
  if (!(await tx.enterImport(householdId))) throw new ImportBusy();
  await tx.lockImport(householdId, accountIds);
  const earlier = await tx.written(householdId, input.batchId);
  if (earlier) return { first: false, counts: earlier, created: 0, handOffs: [], merges: [] };
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
  let created = 0;
  const merges: ImportMerge[] = [];
  // #658: the link rows are locked in the order of their ids (as «Об'єднати» locks its two), each until the commit. One
  // whose id is below a row held already is never waited for: taken only if free, else no link.
  let highest = "";
  const held = new Set<string>();
  const busy = new Set<string>();
  const lockLinks = async (ids: readonly string[]) => {
    for (const id of [...new Set(ids.map((i) => i.toLowerCase()))].sort()) {
      if (held.has(id) || busy.has(id)) continue;
      if (id > highest) {
        await tx.lock(householdId, id);
        highest = id;
        held.add(id);
      } else if ((await tx.tryLock(householdId, id)) === "busy") busy.add(id);
      else held.add(id);
    }
  };
  const handOff = async (
    action: "create" | "merge",
    before: StoredTransaction | null,
    after: StoredTransaction,
  ) => {
    const h: TransactionHandOff = {
      transactionId: after.id,
      actorAccountId: input.actorId,
      action,
      version: after.version,
      audit: transactionAuditValues(action, before, after),
    };
    await tx.enqueueHandOff(householdId, h);
    handOffs.push(h);
  };
  const create = async (rows: readonly ImportedRowInput[]): Promise<ImportCreated> => {
    const unlinked: { fileId: string; row: number }[] = [];
    await lockLinks(
      rows.flatMap((r) => {
        const id = r.mergeInto ?? r.replaces?.transactionId;
        return id === undefined ? [] : [id];
      }),
    );
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
      // IMP-04 FR 5, FR 6: the other side of the link, locked above and checked as it is now (a change since the plan
      // read it, or a row another transaction holds out of order — no link: the row is written on its own, or not at
      // all, as the caller asked).
      const linkId = (r.mergeInto ?? r.replaces?.transactionId)?.toLowerCase();
      let other: StoredTransaction | null = null;
      if (linkId !== undefined) {
        const found = held.has(linkId) ? await tx.find(householdId, linkId) : null;
        const fits =
          found !== null &&
          found.accountId.toLowerCase() === account.accountId.toLowerCase() &&
          found.subaccountId === subaccount.subaccountId &&
          found.mergedInto === null &&
          found.transfer === null &&
          (r.mergeInto !== undefined
            ? found.source === "manual" &&
              found.status === "posted" &&
              !found.hidden &&
              found.split === null &&
              found.amount.equals(r.amount)
            : found.source === "imported" &&
              found.status === "pending" &&
              found.amount.equals(r.replaces!.amount)) &&
          (await tx.duplicatesOf(householdId, found.id)).length === 0;
        if (fits) other = found;
        else {
          unlinked.push({ fileId: r.fileId, row: r.row });
          if (r.ifUnlinked === "skip") continue;
        }
      }
      // FR 5: the manual one merged into this row, which takes its note, tags and «До розбору» state.
      const manual = other !== null && r.mergeInto !== undefined ? other : null;
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
        note: manual?.note ?? null,
        tagIds: manual?.tagIds ?? [],
        // BUD-12 FR 8: an imported transaction goes into «До розбору»; one a manual one is merged into keeps that one's
        // state (its category is the user's).
        review: manual ? manual.review : reviewOnCreate({ importedFromStatement: true }),
        version: 1,
        importBatchId: input.batchId,
        importFileId: r.fileId,
        importRow: r.row,
        bankDescription: description,
        balanceAfter: r.balanceAfter,
      });
      // Written already by this batch (the unique key): never twice.
      if (!row) continue;
      created += 1;
      if (manual) {
        // FR 5: «Злиття» — the manual one hidden, merged into the bank's row; its own event reversed first, so the
        // operation never counts twice (the hand-offs run in order). «Роз'єднати» gives it back.
        const after = await tx.update(householdId, {
          ...manual,
          hidden: true,
          mergedInto: row.id,
          version: manual.version + 1,
        });
        await handOff("merge", manual, after);
        await tx.publishImportMerged(householdId, {
          transactionId: row.id,
          duplicateId: manual.id,
          actorAccountId: input.actorId,
        });
        merges.push({ transactionId: row.id, duplicateId: manual.id });
      }
      await tx.publishCreated(householdId, row.id);
      await handOff("create", null, row);
      if (other && !manual) {
        // FR 6: «замінено» — the pending one merged into the posted row (hidden, kept for the batch's rollback).
        const after = await tx.update(householdId, {
          ...other,
          hidden: true,
          mergedInto: row.id,
          version: other.version + 1,
        });
        await handOff("merge", other, after);
      }
    }
    return { unlinked };
  };
  const counts = await plan({
    candidates: tx.candidates,
    create,
    creditCard: (accountId) => accounts.get(accountId.toLowerCase())?.kind === "credit-card",
  });
  // Step 5: the money lock only now; the accounts as they are under it.
  await tx.lockAccounts(householdId, accountIds);
  const locked = await readAccounts();
  for (const w of wallets.values()) {
    const subaccount = subaccountFor(locked.get(w.accountId)!, w.currency);
    if (subaccount === "currency_mismatch" || subaccount.subaccountId !== w.subaccountId)
      throw new ImportWriteRefused("account-changed", { accountId: w.accountId });
  }
  await tx.recordWrite(householdId, input.batchId, counts, input.actorId, deps.now());
  return { first: true, counts, created, handOffs, merges };
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
