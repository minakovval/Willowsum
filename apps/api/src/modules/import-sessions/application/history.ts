import type { HistoryParse, HistoryReadOptions } from "../../file-parsers/index.ts";
import {
  classifyRows,
  labelCounts,
  maskNumbers,
  splitTags,
  move,
  PARSE_FILES_PER_HOUR,
  rowCategories,
  type LabelAction,
  type ParseState,
  type ResolvedLabelAnswer,
} from "../domain/index.ts";
import {
  BatchNotFoundError,
  BatchStateErrorFor,
  RejectedFile,
  type Batch,
  type BatchesDeps,
  type BatchesTx,
  type BatchFile,
  type BatchHandOff,
  type Handed,
  type Originals,
  type UploadedFile,
} from "./batches.ts";
import {
  ParseRateLimited,
  ParseRefused,
  SEALED_ROWS_MAX_BYTES,
  type ParseJob,
  type ParsePorts,
} from "./parse.ts";

/**
 * A history file with the user's categorisation (BUD-21@PoC FR 1, FR 3–6, FR 24, FR 26; wave 2 row 233). Uploaded from
 * «Правила категорій», it is a batch of kind «файл історії» with one file: its original is stored by file-storage under
 * the same checks and ceilings as a statement's (kind «файл історії»), the same file again (SHA-256) opens the batch
 * already stored, and its one parse job reads the file in the isolated parse worker with the user's roles. The review
 * step shows how it was read; the user corrects a role or a format (the file is read again) and confirms. Nothing is
 * applied: the statement routes do not find such a batch, so no transaction, balance or budget changes (FR 1). Audit
 * entries hold states, counts and codes, never a value of the file.
 */
export interface HistoryFileParse {
  readonly batchId: string;
  readonly batchFileId: string;
  readonly parseId: string;
  readonly state: ParseState;
  readonly refusalCode: string | null;
  readonly engineVersion: string;
  readonly options: HistoryReadOptions;
  /** The parse (`HistoryParse`) sealed with the space's key; null until parsed. */
  readonly parseSealed: Uint8Array | null;
  readonly rowCount: number | null;
  readonly missing: readonly string[];
  /** The confirmation's answers (`HistoryAnswers`) sealed with the space's key; null — not confirmed. */
  readonly answersSealed: Uint8Array | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly parsedAt: Date | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
}

export interface HistoryTx extends BatchesTx {
  /** The batch's history parse, locked for the rest of the transaction when `lock`. */
  historyParse(batchId: string, lock?: boolean): Promise<HistoryFileParse | null>;
  upsertHistoryParse(parse: HistoryFileParse): Promise<void>;
  enqueueHistoryParse(job: ParseJob): Promise<void>;
  /** Holds the space's uploads of the same content apart to the end of the transaction (FR 3: one batch per file). */
  lockContent(sha256: string): Promise<void>;
  /** The history batch still stored whose file has this content, or null. */
  historyByContent(sha256: string): Promise<string | null>;
  /** Parse jobs of the space queued in the last hour, statements' and history files' (the database's clock). */
  parsesInLastHour(): Promise<number>;
  /** BUD-21 FR 24 (row 235): which of `ids` are history batches the space still stores. */
  historyBatches(ids: readonly string[]): Promise<ReadonlySet<string>>;
}

export type HistorySpaceTx = <T>(work: (tx: HistoryTx) => Promise<T>) => Promise<T>;

/**
 * The user's answers at the confirmation (FR 5, FR 6): the values that mark a transfer, the account of each value and
 * (BUD-21 b, FR 7) what each label became — its category of the space, a transfer or a row skipped; absent — confirmed
 * before the matching of labels.
 */
export interface HistoryAnswers {
  readonly v: 1;
  readonly transferValues: readonly string[];
  readonly accounts: readonly { readonly value: string; readonly accountId: string | null }[];
  readonly labels?: readonly ResolvedLabelAnswer[];
}

/** BUD-21 FR 6, FR 8 (row 234): the user's answer for one label, as printed (module categories' `LabelChoice`). */
export type HistoryLabelChoice = {
  readonly category: string | null;
  readonly subcategory: string | null;
} & (
  | { readonly action: "category"; readonly categoryId: string; readonly show?: boolean }
  | { readonly action: "create" }
  | { readonly action: "transfer" }
);

/** One label of the plan (module categories' `PlannedLabel`): what happens to it and the questions to the user. */
export interface HistoryPlannedLabel {
  readonly category: string;
  readonly subcategory: string | null;
  readonly variants: readonly { readonly category: string | null; readonly subcategory: string | null }[];
  readonly rows: number;
  readonly outcome:
    | {
        readonly action: "category";
        readonly categoryId: string;
        readonly name: string;
        readonly hidden: boolean;
        readonly show: boolean;
        readonly source: string;
      }
    | {
        readonly action: "create";
        readonly name: string | null;
        readonly kind: "expense" | "income";
        readonly group:
          | { readonly kind: "group"; readonly groupId: string; readonly name: string }
          | { readonly kind: "new"; readonly name: string | null }
          | { readonly kind: "history"; readonly groupId: string | null; readonly name: string };
        readonly source: string;
      }
    | { readonly action: "transfer"; readonly source: string }
    | { readonly action: "skip"; readonly reason: string };
  readonly questions: readonly string[];
}

export interface HistoryLabelPlan {
  readonly labels: readonly HistoryPlannedLabel[];
  readonly groups: readonly {
    readonly category: string;
    readonly rows: number;
    readonly kind: "expense" | "income";
    readonly target:
      | { readonly kind: "group"; readonly groupId: string; readonly name: string }
      | { readonly kind: "new"; readonly name: string | null };
    readonly questions: readonly string[];
  }[];
  readonly historyGroups: readonly { readonly kind: "expense" | "income"; readonly name: string }[];
}

export type HistoryLabelsResult<T = object> =
  | ({ readonly ok: true; readonly plan: HistoryLabelPlan } & T)
  | {
      readonly ok: false;
      readonly refusal:
        | { readonly kind: "choice"; readonly index: number; readonly issue: string }
        | { readonly kind: "name-invalid"; readonly labels: number };
    };

type LabelCounts = ReturnType<typeof labelCounts>;

/**
 * BUD-21 FR 7, FR 25 (row 234): module categories' matching of labels, bound to the space, the user and the batch —
 * `plan` writes nothing; `confirm` creates the categories the plan creates, in that module's own transaction.
 */
export interface HistoryLabelsPort {
  plan(counts: LabelCounts, choices: readonly HistoryLabelChoice[]): Promise<HistoryLabelsResult>;
  confirm(
    counts: LabelCounts,
    choices: readonly HistoryLabelChoice[],
  ): Promise<HistoryLabelsResult<{ readonly resolved: readonly ResolvedLabelAnswer[] }>>;
}

/** The rows' label actions of a plan (FR 8, EC12): the labels that are transfers or skipped. */
export function labelActions(plan: HistoryLabelPlan): LabelAction {
  const resolved = plan.labels.map((l) => ({
    variants: l.variants,
    action:
      l.outcome.action === "transfer" || l.outcome.action === "skip"
        ? l.outcome.action
        : ("category" as const),
    categoryId: null,
  }));
  const of = rowCategories(resolved);
  return (category, subcategory) => {
    const action = of({ category, subcategory })?.action;
    return action === "transfer" || action === "skip" ? action : undefined;
  };
}

/** A label's choice or a category to be created is refused (FR 6, FR 7); nothing was written. */
export class HistoryLabelRefused extends Error {
  readonly index: number | null;
  readonly issue: string;
  constructor(index: number | null, issue: string) {
    super(`History label refused: ${issue}`);
    this.name = "HistoryLabelRefused";
    this.index = index;
    this.issue = issue;
  }
}

const refused = (refusal: Extract<HistoryLabelsResult, { ok: false }>["refusal"]): HistoryLabelRefused =>
  refusal.kind === "choice"
    ? new HistoryLabelRefused(refusal.index, refusal.issue)
    : new HistoryLabelRefused(null, "name-invalid");

export const historyPurpose = (batchFileId: string, parseId: string): string =>
  `history:${batchFileId.replaceAll("-", "")}${parseId.replaceAll("-", "")}`;
export const answersPurpose = (batchFileId: string, parseId: string): string =>
  `history-answers:${batchFileId.replaceAll("-", "")}${parseId.replaceAll("-", "")}`;

/** The rules cannot be derived from the file as read (FR 4, AC3, AC4): `codes` — what is missing. */
export class HistoryNotReady extends Error {
  readonly codes: readonly string[];
  constructor(codes: readonly string[]) {
    super(`History file not ready: ${codes.join(", ")}`);
    this.name = "HistoryNotReady";
    this.codes = codes;
  }
}

/** An answer names a value the file's reading does not have; nothing was written. */
export class HistoryAnswerRefused extends Error {
  readonly field: "transferValues" | "accounts";
  readonly index: number;
  constructor(field: "transferValues" | "accounts", index: number) {
    super(`History answer refused: ${field}[${index}]`);
    this.name = "HistoryAnswerRefused";
    this.field = field;
    this.index = index;
  }
}

async function handOff(
  tx: BatchesTx,
  deps: BatchesDeps,
  h: Omit<BatchHandOff, "changeId">,
): Promise<BatchHandOff> {
  const full = { ...h, changeId: deps.newId() };
  await tx.enqueueHandOff(full);
  return full;
}

/** FR 3: one file of up to 25 MiB (file-storage's ceiling of a file) per upload. */
export const HISTORY_FILE_BYTES = 25 * 1024 * 1024;

/**
 * «Завантажити файл історії» (FR 3, AC5): the original is stored by file-storage (its checks run before anything is
 * kept: a book with macros is refused and nothing of it is stored); then, under the content's lock, the same file of a
 * history batch still stored opens that batch (the new copy goes), else a new history batch with its parse queued.
 */
export async function uploadHistoryFile(
  deps: BatchesDeps & { readonly engineVersion: string },
  run: HistorySpaceTx,
  originals: Originals,
  caller: { readonly actorId: string; readonly householdId: string },
  upload: { readonly declaredBytes: number | undefined; readonly files: AsyncIterable<UploadedFile> },
): Promise<Handed<{ readonly batch: Batch; readonly file: BatchFile | null; readonly existing: boolean }>> {
  const budget = originals.budget(upload.declaredBytes, HISTORY_FILE_BYTES);
  let stored: Awaited<ReturnType<Originals["store"]>> | null = null;
  for await (const part of upload.files) {
    // The platform takes one file part; anything after it is never read.
    if (stored) {
      part.stream.destroy();
      continue;
    }
    try {
      stored = await originals.store({
        householdId: caller.householdId,
        actorId: caller.actorId,
        fileName: part.fileName,
        kind: "history-file",
        ...(upload.declaredBytes !== undefined ? { declaredBytes: upload.declaredBytes } : {}),
        budget,
        body: part.stream,
      });
    } catch (error) {
      part.stream.destroy();
      throw error;
    }
  }
  if (!stored) throw new RejectedFile({ code: "NO_FILE", status: 422, message: NO_FILE });
  const kept = stored;
  const handOffs: BatchHandOff[] = [];
  let outcome: { readonly batch: Batch; readonly file: BatchFile | null; readonly existing: boolean };
  try {
    outcome = await run(async (tx) => {
      await tx.lockContent(kept.sha256);
      const at = deps.now();
      const existingId = await tx.historyByContent(kept.sha256);
      const existing = existingId ? await tx.lockBatch(existingId) : null;
      if (existing) {
        const batch = await tx.updateBatch(existing.id, existing.state, at);
        handOffs.push(
          await handOff(tx, deps, {
            entityId: existing.id,
            actorAccountId: caller.actorId,
            action: "update",
            changes: [{ field: "history.reopened", before: null, after: "true" }],
          }),
        );
        return { batch, file: null, existing: true };
      }
      if ((await tx.parsesInLastHour()) + 1 > PARSE_FILES_PER_HOUR) throw new ParseRateLimited();
      const batch: Batch = {
        id: deps.newId(),
        householdId: caller.householdId,
        kind: "history",
        name: null,
        state: move("uploaded", "processing"),
        createdBy: caller.actorId,
        version: 1,
        createdAt: at,
        lastActionAt: at,
      };
      const file: BatchFile = {
        id: deps.newId(),
        batchId: batch.id,
        position: 1,
        fileName: kept.fileName,
        fileId: kept.id,
        format: kept.format,
        sizeBytes: kept.sizeBytes,
        rejectionCode: null,
        contentSha256: kept.sha256,
        createdAt: at,
      };
      await tx.insertBatch(batch);
      await tx.insertFile(file);
      const parse = pendingParse(deps, batch.id, file.id, caller.actorId, {}, at);
      await tx.upsertHistoryParse(parse);
      await tx.enqueueHistoryParse({ batchId: batch.id, batchFileId: file.id, parseId: parse.parseId });
      handOffs.push(
        await handOff(tx, deps, {
          entityId: batch.id,
          actorAccountId: caller.actorId,
          action: "create",
          // FR 26: «завантаження файлу історії» — the kind, the state and the format; never the name or the content.
          changes: [
            { field: "kind", before: null, after: "history" },
            { field: "state", before: null, after: batch.state },
            { field: "files.accepted", before: null, after: kept.format },
          ],
        }),
      );
      return { batch, file, existing: false };
    });
  } catch (error) {
    await originals.remove(caller.householdId, kept.id, caller.actorId);
    throw error;
  }
  // FR 3: the same file opens the batch already stored; this copy is not kept.
  if (outcome.existing) await originals.remove(caller.householdId, kept.id, caller.actorId);
  return { result: outcome, handOffs };
}

const NO_FILE = { uk: "Додайте файл історії.", en: "Add a history file." } as const;

function pendingParse(
  deps: BatchesDeps & { readonly engineVersion: string },
  batchId: string,
  batchFileId: string,
  actorId: string,
  options: HistoryReadOptions,
  at: Date,
): HistoryFileParse {
  return {
    batchId,
    batchFileId,
    parseId: deps.newId(),
    state: "pending",
    refusalCode: null,
    engineVersion: deps.engineVersion,
    options,
    parseSealed: null,
    rowCount: null,
    missing: [],
    answersSealed: null,
    requestedBy: actorId,
    requestedAt: at,
    parsedAt: null,
    confirmedBy: null,
    confirmedAt: null,
  };
}

/** Steps of a history batch that are taken only before its confirmation (FR 6: corrections, then «Підтвердити»). */
export class HistoryConfirmed extends Error {
  constructor() {
    super("History file already confirmed");
    this.name = "HistoryConfirmed";
  }
}

/**
 * FR 6, AC9: the user's corrections — a column's role, the date order, the decimal separator, the sign — and the file
 * is read again with them from its original (a heavy job). Only a read or failed file not confirmed yet.
 */
export async function rereadHistoryFile(
  deps: BatchesDeps & { readonly engineVersion: string },
  tx: HistoryTx,
  actorId: string,
  batchId: string,
  options: HistoryReadOptions,
): Promise<Handed<Batch>> {
  const batch = await tx.lockBatch(batchId);
  const parse = batch ? await tx.historyParse(batchId, true) : null;
  if (!batch || !parse) throw new BatchNotFoundError();
  if (parse.confirmedAt) throw new HistoryConfirmed();
  if (batch.state !== "parsed" && batch.state !== "failed") throw new BatchStateErrorFor(batch.state);
  if ((await tx.parsesInLastHour()) + 1 > PARSE_FILES_PER_HOUR) throw new ParseRateLimited();
  const at = deps.now();
  const next = pendingParse(deps, batchId, parse.batchFileId, actorId, options, at);
  await tx.upsertHistoryParse(next);
  await tx.enqueueHistoryParse({ batchId, batchFileId: parse.batchFileId, parseId: next.parseId });
  const processing = await tx.updateBatch(batchId, move(batch.state, "processing"), at);
  const h = await handOff(tx, deps, {
    entityId: batchId,
    actorAccountId: actorId,
    action: "update",
    changes: [
      { field: "state", before: batch.state, after: processing.state },
      { field: "history.corrections", before: null, after: String(correctionCount(options)) },
    ],
  });
  return { result: processing, handOffs: [h] };
}

const correctionCount = (o: HistoryReadOptions): number =>
  (o.columns?.length ?? 0) +
  [o.encoding, o.delimiter, o.headerRow, o.dateOrder, o.decimalSeparator, o.sign].filter(
    (x) => x !== undefined,
  ).length;

export type HistoryPorts = Pick<ParsePorts, "original" | "seal"> & {
  parseHistory(householdId: string, bytes: Uint8Array, options: HistoryReadOptions): Promise<HistoryParse>;
};

const DELIMITED: ReadonlySet<string> = new Set(["csv", "tsv"]);

/**
 * The job of a history file's read (ARC-04 FR 3: it can run again — a read not pending, of an older request, or a batch
 * no longer «в обробці» is left as it is). A refusal marks the read failed with its code (FR 3: the statement's
 * ceilings and codes); any other failure throws, so the job is retried and, dead, goes back with the daily recovery.
 */
export async function runHistoryParse(
  deps: BatchesDeps,
  tx: HistoryTx,
  ports: HistoryPorts,
  householdId: string,
  job: ParseJob,
): Promise<readonly BatchHandOff[]> {
  const parse = await tx.historyParse(job.batchId, true);
  if (!parse || parse.parseId !== job.parseId || parse.state !== "pending") return [];
  const batch = await tx.lockBatch(job.batchId);
  if (!batch || batch.state !== "processing") return [];
  const file = (await tx.files(job.batchId)).find((f) => f.id === parse.batchFileId);
  const finish = async (next: HistoryFileParse): Promise<readonly BatchHandOff[]> => {
    await tx.upsertHistoryParse(next);
    const moved = await tx.updateBatch(
      job.batchId,
      move(batch.state, next.state === "parsed" ? "parsed" : "failed"),
      deps.now(),
    );
    return [
      await handOff(tx, deps, {
        entityId: job.batchId,
        actorAccountId: parse.requestedBy,
        action: "update",
        changes: [
          { field: "state", before: batch.state, after: moved.state },
          next.state === "parsed"
            ? { field: "history.rows", before: null, after: String(next.rowCount) }
            : { field: "history.refusal", before: null, after: next.refusalCode },
          { field: "history.missing", before: null, after: String(next.missing.length) },
        ],
      }),
    ];
  };
  const refuse = (code: string) =>
    finish({
      ...parse,
      state: "failed",
      refusalCode: code,
      parseSealed: null,
      rowCount: null,
      parsedAt: deps.now(),
    });
  if (!file?.fileId) return refuse("FILE_MISSING");
  // IMP-01 FR 4: the Excel reader is a later part, for a history file as for a statement.
  if (!file.format || !DELIMITED.has(file.format)) return refuse("FORMAT_NOT_PARSED");
  const bytes = await ports.original(householdId, file.fileId);
  if (!bytes) return refuse("FILE_MISSING");
  let parsed: HistoryParse;
  try {
    parsed = await ports.parseHistory(householdId, bytes, parse.options);
  } catch (error) {
    if (error instanceof ParseRefused) return refuse(error.code);
    throw error;
  }
  if (parsed.rows.length === 0) return refuse("NO_TRANSACTIONS");
  const plain = new TextEncoder().encode(JSON.stringify(parsed));
  if (plain.length > SEALED_ROWS_MAX_BYTES) return refuse("CORRUPTED");
  return finish({
    ...parse,
    state: "parsed",
    refusalCode: null,
    parseSealed: await ports.seal(householdId, historyPurpose(parse.batchFileId, parse.parseId), plain),
    rowCount: parsed.rows.length,
    missing: parsed.missing,
    parsedAt: deps.now(),
  });
}

export interface HistoryView {
  readonly batch: Batch;
  readonly parse: HistoryFileParse;
  /** null until read (or refused). */
  readonly parsed: HistoryParse | null;
  /** The confirmation's answers; null — not confirmed. */
  readonly answers: HistoryAnswers | null;
}

type Open = (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>;

const decode = <T>(plain: Uint8Array): T => JSON.parse(new TextDecoder().decode(plain)) as T;

/** The review step's data (FR 5): the batch, its read and, once confirmed, the answers. EC9: open for 30 days. */
export async function historyViewOf(tx: HistoryTx, open: Open, batchId: string): Promise<HistoryView> {
  const batch = await tx.findBatch(batchId);
  const parse = batch ? await tx.historyParse(batchId) : null;
  if (!batch || !parse) throw new BatchNotFoundError();
  const parsed =
    parse.parseSealed !== null
      ? decode<HistoryParse>(await open(historyPurpose(parse.batchFileId, parse.parseId), parse.parseSealed))
      : null;
  const answers =
    parse.answersSealed !== null
      ? decode<HistoryAnswers>(
          await open(answersPurpose(parse.batchFileId, parse.parseId), parse.answersSealed),
        )
      : null;
  return { batch, parse, parsed, answers };
}

/** The engine's suggestion of the values that mark a transfer (FR 5), until the user answers. */
export const suggestedTransfers = (parsed: HistoryParse): string[] =>
  parsed.transfers.values.filter((v) => v.transfer).map((v) => v.value);

/**
 * «Підтвердити» (FR 6): the read the user saw (`parseId`; a read since — 409) with the answers — the values that mark a
 * transfer (default: the engine's suggestion) and the account of each value (the accounts are checked by the caller).
 * Refused while the file lacks what rules need (FR 4) or no row is read. Without it nothing is created (EC9); the next
 * parts create the missing categories and start the derivation here (BUD-21 b, c).
 */
export async function confirmHistoryFile(
  deps: BatchesDeps,
  tx: HistoryTx,
  ports: {
    readonly open: Open;
    readonly seal: (purpose: string, plain: Uint8Array) => Promise<Uint8Array>;
    /** BUD-21 b: the matching of labels; absent — no category is created (the routes without it). */
    readonly labels?: HistoryLabelsPort;
  },
  actorId: string,
  batchId: string,
  input: {
    readonly parseId: string;
    readonly transferValues?: readonly string[];
    readonly accounts?: readonly { readonly value: string; readonly accountId: string | null }[];
    readonly labels?: readonly HistoryLabelChoice[];
  },
): Promise<Handed<HistoryView>> {
  const locked = await tx.lockBatch(batchId);
  if (!locked) throw new BatchNotFoundError();
  const view = await historyViewOf(tx, ports.open, batchId);
  const { parse, parsed } = view;
  if (parse.confirmedAt) throw new HistoryConfirmed();
  if (parse.parseId !== input.parseId || locked.state !== "parsed" || !parsed)
    throw new BatchStateErrorFor(locked.state);
  if (parsed.missing.length > 0) throw new HistoryNotReady(parsed.missing);
  const known = new Set(parsed.transfers.values.map((v) => v.value));
  const transferValues = input.transferValues ?? suggestedTransfers(parsed);
  transferValues.forEach((v, i) => {
    if (!known.has(v)) throw new HistoryAnswerRefused("transferValues", i);
  });
  const marked = classifyRows(parsed.rows, new Set(transferValues));
  const counts = labelCounts(marked.read);
  const choices = input.labels ?? [];
  let action: LabelAction | undefined;
  if (ports.labels) {
    const planned = await ports.labels.plan(counts, choices);
    if (!planned.ok) throw refused(planned.refusal);
    action = labelActions(planned.plan);
  }
  const { read, summary } = action ? classifyRows(parsed.rows, new Set(transferValues), action) : marked;
  const accountsInFile = new Set(read.flatMap((r) => (r.account === null ? [] : [r.account])));
  const accounts = input.accounts ?? [];
  accounts.forEach((a, i) => {
    if (!accountsInFile.has(a.value) || accounts.findIndex((b) => b.value === a.value) !== i)
      throw new HistoryAnswerRefused("accounts", i);
  });
  if (summary.read === 0) throw new HistoryNotReady(["rows"]);
  // FR 7: the categories are created now (module categories, its own transaction and one audit entry); a confirmation
  // that fails after it finds them by name the next time, so nothing is created twice.
  let labels: readonly ResolvedLabelAnswer[] | undefined;
  if (ports.labels) {
    const confirmed = await ports.labels.confirm(counts, choices);
    if (!confirmed.ok) throw refused(confirmed.refusal);
    labels = confirmed.resolved;
  }
  const answers: HistoryAnswers = {
    v: 1,
    transferValues: [...transferValues],
    accounts: [...accounts],
    ...(labels ? { labels: labels.map((l) => ({ ...l, variants: l.variants.map((v) => ({ ...v })) })) } : {}),
  };
  const at = deps.now();
  const confirmed: HistoryFileParse = {
    ...parse,
    answersSealed: await ports.seal(
      answersPurpose(parse.batchFileId, parse.parseId),
      new TextEncoder().encode(JSON.stringify(answers)),
    ),
    confirmedBy: actorId,
    confirmedAt: at,
  };
  await tx.upsertHistoryParse(confirmed);
  const batch = await tx.updateBatch(batchId, locked.state, at);
  const h = await handOff(tx, deps, {
    entityId: batchId,
    actorAccountId: actorId,
    action: "update",
    // FR 26: «підтвердження розпізнавання» — counts only.
    changes: [
      { field: "history.confirmed", before: null, after: "true" },
      { field: "history.read", before: null, after: String(summary.read) },
      { field: "history.transfers", before: null, after: String(summary.transfers) },
      {
        field: "history.skipped",
        before: null,
        after: String(summary.skipped.reduce((n, s) => n + s.count, 0)),
      },
    ],
  });
  return { result: { batch, parse: confirmed, parsed, answers }, handOffs: [h] };
}

/** BUD-21 c (row 235): a categorised row of a confirmed history file, as module categorization derives rules from it. */
export interface DerivationSourceRow {
  readonly row: number;
  readonly date: string;
  readonly amount: string;
  readonly currency: string | null;
  readonly counterparty: string | null;
  readonly description: string | null;
  /** The description shown to the user: an IBAN or a card number masked to its last 4 characters. */
  readonly shown: string | null;
  readonly accountId: string | null;
  readonly categoryId: string;
  readonly tags: readonly string[];
}

/**
 * BUD-21 FR 7–11, FR 17 (row 235): the rows the derivation works on — those of the confirmed read that are neither a
 * transfer nor skipped (FR 8, EC5, EC12), each with the space's category its label became (FR 7, AC8), the account of
 * the space its account value was matched with (FR 11), its currency (the file's, else the matched account's when that
 * has one currency) and its tags (FR 17). Null — no history batch, or not confirmed.
 */
export async function derivationRows(
  tx: HistoryTx,
  open: Open,
  batchId: string,
  accountCurrency: (accountId: string) => Promise<string | null>,
): Promise<DerivationSourceRow[] | null> {
  let view: HistoryView;
  try {
    view = await historyViewOf(tx, open, batchId);
  } catch (error) {
    if (error instanceof BatchNotFoundError) return null;
    throw error;
  }
  const { parsed, answers } = view;
  if (!parsed || !answers || !view.parse.confirmedAt) return null;
  const resolved = rowCategories(answers.labels ?? []);
  const { read } = classifyRows(parsed.rows, new Set(answers.transferValues), (category, subcategory) => {
    const action = resolved({ category, subcategory })?.action;
    return action === "transfer" || action === "skip" ? action : undefined;
  });
  const accounts = new Map(answers.accounts.map((a) => [a.value, a.accountId]));
  const currencies = new Map<string, string | null>();
  const out: DerivationSourceRow[] = [];
  for (const r of read) {
    const label = r.transfer ? null : resolved(r);
    if (label?.action !== "category" || label.categoryId === null) continue;
    const accountId = r.account === null ? null : (accounts.get(r.account) ?? null);
    let currency = r.currency;
    if (currency === null && accountId !== null) {
      if (!currencies.has(accountId)) currencies.set(accountId, await accountCurrency(accountId));
      currency = currencies.get(accountId) ?? null;
    }
    out.push({
      row: r.row,
      date: r.date!,
      amount: r.amount!,
      currency,
      counterparty: r.counterparty,
      description: r.description,
      shown: maskNumbers(r.description ?? r.counterparty),
      accountId,
      categoryId: label.categoryId,
      tags: splitTags(r.tags).tags,
    });
  }
  return out;
}
