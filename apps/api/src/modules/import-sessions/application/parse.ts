import type {
  ReadOptions,
  StatementChecks,
  StatementOptions,
  StatementParse,
  StatementEvent,
} from "../../file-parsers/index.ts";
import {
  batchStateAfterParse,
  move,
  PARSE_FILES_PER_HOUR,
  PARSE_REFUSALS,
  takesParse,
  type BatchState,
  type ParseRefusalCode,
  type ParseState,
} from "../domain/index.ts";
import {
  BatchNotFoundError,
  BatchStateErrorFor,
  type Batch,
  type BatchesDeps,
  type BatchHandOff,
  type FileRejection,
  type Handed,
} from "./batches.ts";
import { recordChecks, type ReviewBatchesTx } from "./decisions.ts";
import type { FileReview } from "./review.ts";

/**
 * The parse step of a batch (IMP-01@PoC FR 5, FR 6, FR 9, FR 10, FR 13, FR 15, FR 19, FR 21; IMP-19@PoC FR 3–5;
 * IMP-05@PoC FR 3; wave 2, the gap row before rows 44–46). «Розібрати» moves the batch to «в обробці» and queues one
 * heavy job per accepted file (ARC-04 FR 5: the worker runs at most its heavy limit at a time); each job parses its file
 * in the isolated parse worker (file-parsers, ADR-0012) with the chosen recipe, or the space's recipe matched by the
 * file's format fingerprint, and the chosen account; it stores the parsed rows sealed with the space's key and records
 * the checks with the previous statement's history gap (`recordChecks`). The last file done moves the batch to
 * «розібрано», «потребує перегляду» or «не вдалося розібрати». Never logs or audits a value of the file (#624): audit
 * entries hold states, counts and codes.
 */
export interface FileParse {
  readonly batchFileId: string;
  readonly batchId: string;
  /** A new id per request: a job of an older request finds another and does nothing. */
  readonly parseId: string;
  readonly recipeId: string | null;
  readonly usedRecipeId: string | null;
  readonly recipeFormat: "match" | "changed" | "unknown" | null;
  readonly accountId: string | null;
  readonly state: ParseState;
  readonly refusalCode: string | null;
  readonly engineVersion: string;
  /** The parse (reading, analysis, rows) sealed with the space's key; null until parsed. */
  readonly rowsSealed: Uint8Array | null;
  readonly rowCount: number | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly parsedAt: Date | null;
}

/** The job of one file's parse: ids only (ADR-0015: nothing of the file in the queue). */
export interface ParseJob {
  readonly batchId: string;
  readonly batchFileId: string;
  readonly parseId: string;
}

export interface ParseTx {
  upsertParse(parse: FileParse): Promise<void>;
  parses(batchId: string): Promise<FileParse[]>;
  /** One file's parse, locked for the rest of the transaction. */
  lockParse(batchFileId: string): Promise<FileParse | null>;
  enqueueParse(job: ParseJob): Promise<void>;
  /** Parse jobs of the space queued in the last hour (the database's clock). */
  parsesInLastHour(): Promise<number>;
  /** A new parse makes the batch's review stale: its checks and decisions go. */
  dropReview(batchId: string): Promise<void>;
}

export type ParseBatchesTx = ReviewBatchesTx & ParseTx;

/** The person's choice for one file (FR 1: the account of each file; IMP-06 FR 1: the recipe). */
export interface ParseRequest {
  readonly fileId: string;
  readonly recipeId?: string | null;
  readonly accountId?: string | null;
}

export type ParseRequestIssue = "UNKNOWN_FILE" | "UNKNOWN_RECIPE" | "UNKNOWN_ACCOUNT";

/** A request names a file, recipe or account that is not the batch's or the space's; nothing was written. */
export class ParseRequestRefused extends Error {
  readonly issue: ParseRequestIssue;
  readonly index: number;
  readonly field: "fileId" | "recipeId" | "accountId";

  constructor(issue: ParseRequestIssue, index: number, field: "fileId" | "recipeId" | "accountId") {
    super(`Parse request ${index} refused: ${issue}`);
    this.name = "ParseRequestRefused";
    this.issue = issue;
    this.index = index;
    this.field = field;
  }
}

/** The space's parse requests of the last hour are at the ceiling (`PARSE_FILES_PER_HOUR`). */
export class ParseRateLimited extends Error {
  constructor() {
    super("Too many parse requests");
    this.name = "ParseRateLimited";
  }
}

async function handOff(
  tx: ParseBatchesTx,
  deps: BatchesDeps,
  h: Omit<BatchHandOff, "changeId">,
): Promise<BatchHandOff> {
  const full = { ...h, changeId: deps.newId() };
  await tx.enqueueHandOff(full);
  return full;
}

/**
 * «Розібрати» (FR 5, FR 21): every accepted file of the batch is queued, with the request's recipe and account where
 * it names the file. The recipes and accounts are checked by the caller first (`ParseRequestRefused`). A batch parsed
 * before is parsed again from the start: its checks and decisions go.
 */
export async function requestParse(
  deps: BatchesDeps & { readonly engineVersion: string },
  tx: ParseBatchesTx,
  actorId: string,
  batchId: string,
  requests: readonly ParseRequest[],
): Promise<Handed<Batch>> {
  const batch = await tx.lockBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  if (!takesParse(batch.state)) throw new BatchStateErrorFor(batch.state);
  const accepted = (await tx.files(batchId)).filter((f) => f.fileId !== null);
  if (accepted.length === 0) throw new BatchStateErrorFor(batch.state);
  const chosen = new Map<string, ParseRequest>();
  requests.forEach((r, i) => {
    if (!accepted.some((f) => f.id === r.fileId) || chosen.has(r.fileId))
      throw new ParseRequestRefused("UNKNOWN_FILE", i, "fileId");
    chosen.set(r.fileId, r);
  });
  if ((await tx.parsesInLastHour()) + accepted.length > PARSE_FILES_PER_HOUR) throw new ParseRateLimited();
  const at = deps.now();
  await tx.dropReview(batchId);
  for (const f of accepted) {
    const r = chosen.get(f.id);
    const parse: FileParse = {
      batchFileId: f.id,
      batchId,
      parseId: deps.newId(),
      recipeId: r?.recipeId ?? null,
      usedRecipeId: null,
      recipeFormat: null,
      accountId: r?.accountId ?? null,
      state: "pending",
      refusalCode: null,
      engineVersion: deps.engineVersion,
      rowsSealed: null,
      rowCount: null,
      requestedBy: actorId,
      requestedAt: at,
      parsedAt: null,
    };
    await tx.upsertParse(parse);
    await tx.enqueueParse({ batchId, batchFileId: f.id, parseId: parse.parseId });
  }
  const processing = await tx.updateBatch(batchId, move(batch.state, "processing"), at);
  const h = await handOff(tx, deps, {
    entityId: batchId,
    actorAccountId: actorId,
    action: "update",
    changes: [
      { field: "state", before: batch.state, after: processing.state },
      { field: "files.parse", before: null, after: String(accepted.length) },
      {
        field: "files.recipes",
        before: null,
        after: String([...chosen.values()].filter((r) => r.recipeId).length),
      },
    ],
  });
  return { result: processing, handOffs: [h] };
}

/** A recipe as the parse step uses it (import-recipes' `RecipeForParse`, read through the adapter). */
export interface ParseRecipe {
  readonly id: string;
  readonly fingerprint: string | null;
  readonly options: ReadOptions;
  readonly currencySymbols?: Readonly<Record<string, string>>;
  /** The recipe's account binding still sealed (IMP-06 FR 1); null without one the worker checks. */
  readonly binding: { readonly by: "iban" | "account-number" | "mask"; readonly sealedValue: string } | null;
}

export interface ParseAccount {
  readonly currencies: readonly string[];
  readonly kind: string;
}

/** The other modules as the parse job uses them (adapters/queue wires file-storage, import-recipes, accounts, household). */
export interface ParsePorts {
  /** The original's bytes; null — it is gone. */
  original(householdId: string, fileId: string): Promise<Uint8Array | null>;
  recipe(householdId: string, recipeId: string): Promise<ParseRecipe | null>;
  recipeForFormat(householdId: string, fingerprint: string): Promise<ParseRecipe | null>;
  /** An active account of the space, or null. */
  account(householdId: string, accountId: string): Promise<ParseAccount | null>;
  /**
   * The parse in the isolated worker; the binding's opener is taken only once the worker's turn has come (#624). A
   * refusal is a `ParseRefused` with the file's rejection code.
   */
  parse(
    householdId: string,
    bytes: Uint8Array,
    options: ReadOptions,
    statement: StatementOptions,
    binding: ParseRecipe["binding"],
  ): Promise<StatementParse>;
  seal(householdId: string, purpose: string, plaintext: Uint8Array): Promise<Uint8Array>;
}

/** The parse was refused (a ceiling, a damaged file, the account binding): the file's rejection code. */
export class ParseRefused extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Parse refused: ${code}`);
    this.name = "ParseRefused";
    this.code = code;
  }
}

/** What is sealed per file: the reading, the analysis and the rows (never the checks: they are in `file_checks`). */
export interface SealedParse {
  readonly v: 1;
  readonly reading: StatementParse["reading"];
  readonly analysis: StatementParse["analysis"];
  readonly events: StatementParse["events"];
}

export const parsePurpose = (parseId: string): string => `parse:${parseId}`;

/** FR 10: a parsed file goes to «потребує перегляду» when anything in it waits for the person (IMP-05 FR 2–9). */
function needsReview(checks: StatementChecks, accountId: string | null): boolean {
  return (
    accountId === null ||
    checks.account.status === "mismatch" ||
    checks.flags.length > 0 ||
    checks.clarifications.length > 0 ||
    checks.signs.unconfirmed.length > 0
  );
}

const DELIMITED: ReadonlySet<string> = new Set(["csv", "tsv"]);

/**
 * The job of one file (ARC-04 FR 3: it can run again — a parse not pending, or of an older request, or a batch no longer
 * «в обробці» is left as it is). A refusal marks the file failed with its code; any other failure throws, so the job is
 * retried. Returns the audit hand-offs it enqueued.
 */
export async function runParse(
  deps: BatchesDeps,
  tx: ParseBatchesTx,
  ports: ParsePorts,
  householdId: string,
  job: ParseJob,
): Promise<readonly BatchHandOff[]> {
  const parse = await tx.lockParse(job.batchFileId);
  if (!parse || parse.parseId !== job.parseId || parse.state !== "pending") return [];
  const batch = await tx.findBatch(job.batchId);
  if (!batch || batch.state !== "processing") return [];
  const file = (await tx.files(job.batchId)).find((f) => f.id === job.batchFileId);
  const handOffs: BatchHandOff[] = [];
  const done = async (state: ParseState, extra: Partial<FileParse>): Promise<readonly BatchHandOff[]> => {
    await tx.upsertParse({ ...parse, ...extra, state, parsedAt: deps.now() });
    handOffs.push(...(await finishBatch(deps, tx, job.batchId, parse.requestedBy)));
    return handOffs;
  };
  const refuse = (code: string) => done("failed", { refusalCode: code, rowsSealed: null, rowCount: null });
  if (!file?.fileId) return refuse("FILE_MISSING");
  // IMP-01 FR 4: the Excel reader is a later part; an accepted book is refused with its own reason, never guessed.
  if (!file.format || !DELIMITED.has(file.format)) return refuse("FORMAT_NOT_PARSED");
  const bytes = await ports.original(householdId, file.fileId);
  if (!bytes) return refuse("FILE_MISSING");

  const account = parse.accountId ? await ports.account(householdId, parse.accountId) : null;
  const accountId = account ? parse.accountId : null;
  const statement: StatementOptions = account
    ? {
        account: {
          currencies: account.currencies,
          multiCurrency: account.currencies.length > 1,
          kind: account.kind,
        },
      }
    : {};
  let parsed: StatementParse;
  let recipe: ParseRecipe | null;
  let recipeFormat: FileParse["recipeFormat"] = null;
  try {
    recipe = parse.recipeId ? await ports.recipe(householdId, parse.recipeId) : null;
    if (recipe) {
      parsed = await withRecipe(ports, householdId, bytes, statement, recipe);
      const fp = parsed.reading.format?.fingerprint ?? null;
      recipeFormat =
        recipe.fingerprint === null || fp === null
          ? "unknown"
          : fp === recipe.fingerprint
            ? "match"
            : "changed";
    } else {
      // IMP-06 FR 7: the space's recipe made for this format, matched by the file's fingerprint.
      parsed = await ports.parse(householdId, bytes, {}, statement, null);
      const fp = parsed.reading.format?.fingerprint;
      recipe = fp ? await ports.recipeForFormat(householdId, fp) : null;
      if (recipe) {
        parsed = await withRecipe(ports, householdId, bytes, statement, recipe);
        recipeFormat = "match";
      }
    }
  } catch (error) {
    if (error instanceof ParseRefused) return refuse(error.code);
    throw error;
  }
  if (parsed.events.events.length === 0) return refuse("NO_TRANSACTIONS");

  const sealed: SealedParse = {
    v: 1,
    reading: parsed.reading,
    analysis: parsed.analysis,
    events: parsed.events,
  };
  const rowsSealed = await ports.seal(
    householdId,
    parsePurpose(parse.parseId),
    new TextEncoder().encode(JSON.stringify(sealed)),
  );
  await tx.upsertParse({
    ...parse,
    usedRecipeId: recipe?.id ?? null,
    recipeFormat,
    accountId,
    state: "parsed",
    rowsSealed,
    rowCount: parsed.events.events.length,
    parsedAt: deps.now(),
  });
  const recorded = await recordChecks(deps, tx, {
    actorId: parse.requestedBy,
    batchId: job.batchId,
    batchFileId: job.batchFileId,
    account: {
      id: accountId,
      currency: account && account.currencies.length === 1 ? account.currencies[0]! : null,
    },
    checks: parsed.checks,
  });
  handOffs.push(...recorded.handOffs);
  handOffs.push(...(await finishBatch(deps, tx, job.batchId, parse.requestedBy)));
  return handOffs;
}

function withRecipe(
  ports: ParsePorts,
  householdId: string,
  bytes: Uint8Array,
  statement: StatementOptions,
  recipe: ParseRecipe,
): Promise<StatementParse> {
  return ports.parse(
    householdId,
    bytes,
    recipe.options,
    { ...statement, ...(recipe.currencySymbols ? { currencySymbols: recipe.currencySymbols } : {}) },
    recipe.binding,
  );
}

/** The last file done moves the batch out of «в обробці» (FR 6, FR 10, IMP-19 FR 5). */
async function finishBatch(
  deps: BatchesDeps,
  tx: ParseBatchesTx,
  batchId: string,
  actorId: string,
): Promise<readonly BatchHandOff[]> {
  const batch = await tx.lockBatch(batchId);
  if (!batch || batch.state !== "processing") return [];
  const parses = await tx.parses(batchId);
  const reviews = new Map((await tx.reviews(batchId)).map((r) => [r.batchFileId, r]));
  const state = batchStateAfterParse(
    parses.map((p) => {
      const review = reviews.get(p.batchFileId);
      return { state: p.state, needsReview: review ? needsReview(review.checks, review.accountId) : false };
    }),
  );
  if (state === null) return [];
  const moved = await tx.updateBatch(batchId, move(batch.state, state), deps.now());
  return [
    await handOff(tx, deps, {
      entityId: batchId,
      actorAccountId: actorId,
      action: "update",
      changes: [
        { field: "state", before: batch.state, after: moved.state },
        {
          field: "files.parsed",
          before: null,
          after: String(parses.filter((p) => p.state === "parsed").length),
        },
        {
          field: "files.failed",
          before: null,
          after: String(parses.filter((p) => p.state === "failed").length),
        },
      ],
    }),
  ];
}

/** The text of a refusal (FR 15): file-storage's texts for its codes, the parse step's own for the rest. */
export function parseRefusal(
  code: string,
  fileStorage: (code: string) => FileRejection | null,
): FileRejection {
  if (Object.hasOwn(PARSE_REFUSALS, code)) return { code, ...PARSE_REFUSALS[code as ParseRefusalCode] };
  return fileStorage(code) ?? fileStorage("CORRUPTED")!;
}

// ——— The read side (the UI's review of the parse) ———

export interface ParseView {
  readonly batch: Batch;
  readonly files: readonly {
    readonly fileId: string;
    readonly position: number;
    readonly parse: FileParse | null;
    readonly review: FileReview | null;
  }[];
}

/** The batch's files with their parse and checks (masked values only). */
export async function parseViewOf(tx: ParseBatchesTx, batchId: string): Promise<ParseView> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  const parses = new Map((await tx.parses(batchId)).map((p) => [p.batchFileId, p]));
  const reviews = new Map((await tx.reviews(batchId)).map((r) => [r.batchFileId, r]));
  return {
    batch,
    files: (await tx.files(batchId))
      .filter((f) => f.fileId !== null)
      .map((f) => ({
        fileId: f.id,
        position: f.position,
        parse: parses.get(f.id) ?? null,
        review: reviews.get(f.id) ?? null,
      })),
  };
}

/** A page of one parsed file's rows, in the order of the file, after the row `after`. */
export async function rowsOf(
  tx: ParseBatchesTx,
  open: (purpose: string, sealed: Uint8Array) => Promise<Uint8Array>,
  batchId: string,
  batchFileId: string,
  page: { readonly limit: number; readonly after: number },
): Promise<{ readonly rows: readonly StatementEvent[]; readonly more: boolean; readonly state: BatchState }> {
  const batch = await tx.findBatch(batchId);
  if (!batch) throw new BatchNotFoundError();
  const parse = (await tx.parses(batchId)).find((p) => p.batchFileId === batchFileId);
  if (!parse) throw new BatchNotFoundError();
  if (parse.state !== "parsed" || !parse.rowsSealed) throw new BatchStateErrorFor(batch.state);
  const plain = await open(parsePurpose(parse.parseId), parse.rowsSealed);
  const { events } = JSON.parse(new TextDecoder().decode(plain)) as SealedParse;
  const after = events.events.filter((e) => e.row > page.after);
  return { rows: after.slice(0, page.limit), more: after.length > page.limit, state: batch.state };
}
