import { z } from "zod";
import { decodeCursor, encodeCursor, pageOf, pageQuery } from "../../../../platform/http/pagination.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { planImport } from "../../../duplicate-matching/index.ts";
import { SIGN_BASES } from "../../../file-parsers/index.ts";
import {
  BANK_STATUSES,
  duplicatePreviewOf,
  fileReviewOf,
  GROUP_ACTIONS,
  REVIEW_ROW_FILTERS,
  REVIEW_ROW_STATES,
  reviewRowsOf,
  ROW_ACTIONS,
  ROW_ISSUES,
  ROW_ISSUE_DETAILS,
  type DuplicatePreview,
  type ReviewRow,
} from "../../application/index.ts";
import { applyTx, batchesTx } from "../db/store.ts";
import { guarded, owner } from "./routes.ts";
import { importSessionsServices } from "./services.ts";

/**
 * The wizard's step «Перевірка розпізнавання» (IMP-08@PoC FR 5–7, FR 10, AC3–AC6, AC10; IMP-06@PoC FR 8, AC8; IMP-04@PoC
 * FR 1–6 before the apply; plan row 137, server part 1 of 2). Read only. The rows of a parsed file with their state, the
 * person's decision, the sign's basis and the readings a `reading` decision takes; the file's counts, its group «знак не
 * підтверджено» and the engine's decisions with alternatives and «чому так»; the rows the apply would not write as new
 * ones, with what they match. Paged by row (≤ 100 a page). The space is the session's: a batch or a file of another
 * space is «not found»; a scoped member sees no batch. An IBAN or a card number in a text of the file keeps its last 4
 * characters. Nothing of a row goes to a log or an error.
 */
const MODULE = "import-sessions";
const READ = { permission: "household.data.read", feature: "data.import" } as const;
const fileParams = z.object({ batchId: z.uuid(), fileId: z.uuid() });
const rowCursor = z.object({ r: z.number().int().min(0) });
const extensible = { "x-extensible-enum": true } as const;

const opener = (ctx: ProtectedContext) => {
  const { parse } = importSessionsServices(ctx);
  if (!parse) throw new ApiProblem("INTERNAL");
  const { householdId } = ctx.principal;
  return (purpose: string, sealed: Uint8Array) => parse.keys.openBytes(householdId, purpose, sealed);
};

const evidenceSchema = z.object({
  code: z.string().meta(extensible),
  column: z.number().int().optional(),
  row: z.number().int().optional(),
  count: z.number().int().optional(),
  of: z.number().int().optional(),
  word: z.string().optional(),
  example: z.string().optional(),
});

const reviewRowSchema = z.object({
  row: z.number().int(),
  state: z.enum(REVIEW_ROW_STATES).meta(extensible),
  decision: z
    .object({
      action: z
        .enum([...new Set([...ROW_ACTIONS, ...GROUP_ACTIONS])] as [string, ...string[]])
        .meta(extensible),
      from: z.enum(["row", "group"]),
    })
    .nullable(),
  /** FR 6, AC6: a value the person changed (the sign flipped, a reading chosen). */
  changed: z.boolean(),
  /** FR 6, AC5: in the group «знак не підтверджено». */
  signUnconfirmed: z.boolean(),
  sign: z
    .object({
      basis: z.enum(SIGN_BASES).meta(extensible),
      confidence: z.number(),
      confirmed: z.boolean(),
    })
    .nullable(),
  /** FR 7, AC4: the cell, the readings a `reading` decision takes (its `value`), the chosen one and «чому так». */
  reading: z
    .object({
      cell: z.string(),
      readings: z.array(z.object({ decimal: z.enum([",", "."]), value: z.string() })),
      chosen: z.string().nullable(),
      evidence: z.array(evidenceSchema),
    })
    .nullable(),
  /** «помилка»: why the apply cannot write the row as it is (the apply's `IMPORT_ROWS_REFUSED` issue). */
  issue: z.enum(ROW_ISSUES).nullable().meta(extensible),
  /** #703: what more the issue says — `fee-basis`: the balances do not tell whether the amount includes the fee. */
  issueDetail: z.enum(ROW_ISSUE_DETAILS).nullable().meta(extensible),
  /** FR 10, AC10: «В обробці» / «Невдала»; null until the parser reads the bank's status (IMP-01 FR 16). */
  bankStatus: z.enum(BANK_STATUSES).nullable(),
});

function presentRow(r: ReviewRow): z.input<typeof reviewRowSchema> {
  return {
    row: r.row,
    state: r.state,
    decision: r.decision ? { ...r.decision } : null,
    changed: r.changed,
    signUnconfirmed: r.signUnconfirmed,
    sign: r.sign ? { ...r.sign } : null,
    reading: r.reading
      ? {
          cell: r.reading.cell,
          readings: r.reading.readings.map((x) => ({ decimal: x.decimal, value: x.value })),
          chosen: r.reading.chosen,
          evidence: r.reading.evidence.map((e) => ({ ...e })),
        }
      : null,
    issue: r.issue,
    issueDetail: r.issueDetail,
    bankStatus: r.bankStatus,
  };
}

export const listImportReviewRowsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/files/{fileId}/review/rows",
  operationId: "listImportReviewRows",
  summary:
    "The review of a parsed file's rows (IMP-08 FR 6, FR 7, FR 10): each row's state, the person's decision, whether its value was changed, its sign's basis and group, and the readings of an ambiguous amount with «чому так»; a page at a time in the order of the file",
  access: READ,
  list: true,
  request: {
    params: fileParams,
    query: pageQuery.extend({ filter: z.enum(REVIEW_ROW_FILTERS).optional() }),
  },
  problems: ["BATCH_STATE_CONFLICT"],
  response: { status: 200, description: "A page of the file's review rows", schema: pageOf(reviewRowSchema) },
  handler: async ({ params, query }, ctx) => {
    owner(ctx);
    const open = opener(ctx);
    const after = query.cursor ? decodeCursor(query.cursor, rowCursor).r : 0;
    const page = await guarded(() =>
      ctx.inHousehold((q) =>
        reviewRowsOf(batchesTx(q), open, params.batchId, params.fileId, {
          limit: query.limit,
          after,
          ...(query.filter ? { filter: query.filter } : {}),
        }),
      ),
    );
    return {
      items: page.rows.map(presentRow),
      nextCursor: page.more ? encodeCursor({ r: page.rows.at(-1)!.row }) : null,
    };
  },
});

const hypothesisSchema = z.object({
  /** A role, a sign mode — or a date format `{ order, format }`, a number format `{ decimalSeparator, thousandsSeparator }`. */
  value: z.union([z.string(), z.record(z.string(), z.string())]),
  label: z.string(),
  score: z.number(),
  examples: z.array(z.object({ cell: z.string(), reads: z.string().nullable() })),
});
const decisionSchema = z.object({
  chosen: hypothesisSchema,
  alternatives: z.array(hypothesisSchema),
  evidence: z.array(evidenceSchema),
  flags: z.array(z.string().meta(extensible)),
});
const guessSchema = z.object({ value: z.string(), score: z.number(), reason: z.string().optional() });
const guessesSchema = z.object({ chosen: guessSchema, alternatives: z.array(guessSchema) }).nullable();
const stateCounts = Object.fromEntries(REVIEW_ROW_STATES.map((s) => [s, z.number().int()])) as Record<
  (typeof REVIEW_ROW_STATES)[number],
  z.ZodNumber
>;

const fileReviewSchema = z.object({
  counts: z.object({
    rows: z.number().int(),
    states: z.object(stateCounts),
    changed: z.number().int(),
    signUnconfirmed: z.number().int(),
  }),
  signGroup: z.object({
    rows: z.number().int(),
    action: z.enum(GROUP_ACTIONS).nullable().meta(extensible),
  }),
  analysis: z.object({
    table: z.object({
      headerRow: z.number().int().nullable(),
      dataRows: z.number().int(),
      evidence: z.array(evidenceSchema),
    }),
    columns: z.array(
      z.object({ column: z.number().int(), header: z.string().nullable(), role: decisionSchema }),
    ),
    dates: decisionSchema.nullable(),
    numbers: decisionSchema.nullable(),
    sign: decisionSchema.nullable(),
    currency: z.object({
      mode: z.enum(["column", "file", "unknown"]).meta(extensible),
      code: z.string().nullable(),
      evidence: z.array(evidenceSchema),
    }),
  }),
  encoding: guessesSchema,
  delimiter: guessesSchema,
});

export const getImportFileReviewRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/files/{fileId}/review",
  operationId: "getImportFileReview",
  summary:
    "The review of a parsed file (IMP-08 FR 5–7, AC3, AC5; IMP-06 FR 8, AC8): the counts of its rows by state, its group «знак не підтверджено» with the group's decision, and the engine's decisions (table, columns, dates, numbers, sign, currency, encoding, delimiter) with their alternatives, scores, examples and «чому так»",
  access: READ,
  request: { params: fileParams },
  problems: ["BATCH_STATE_CONFLICT"],
  response: {
    status: 200,
    description: "The file's review",
    schema: fileReviewSchema,
  },
  handler: async ({ params }, ctx) => {
    owner(ctx);
    const open = opener(ctx);
    const review = await guarded(() =>
      ctx.inHousehold((q) => fileReviewOf(batchesTx(q), open, params.batchId, params.fileId)),
    );
    // Plain data of the analysis (readonly arrays), checked against the schema on the way out.
    return structuredClone(review) as unknown as z.input<typeof fileReviewSchema>;
  },
});

const duplicateSchema = z.object({
  row: z.number().int(),
  /** FR 2: the row's occurrence among the file's rows with the same key. */
  occurrence: z.number().int(),
  /** IMP-04: «повтор у файлі», «дубль», «дубль — уже імпортовано», злиття з ручною, «Можливий дубль», «замінено». */
  kind: z
    .enum(["repeat", "duplicate", "already-imported", "merge", "possible-duplicate", "replace"])
    .meta(extensible),
  /** «з чим збіг»: the transactions it matches (none for «повтор у файлі»). */
  transactionIds: z.array(z.uuid()),
  /** `already-imported`: the applied batch of the same file. */
  batchId: z.uuid().nullable(),
  /** `duplicate`: the row is written and the manual transaction is merged into it (FR 5). */
  merge: z.boolean(),
});

function presentDuplicate(o: DuplicatePreview): z.input<typeof duplicateSchema> {
  const base = { row: o.row, occurrence: o.occurrence, kind: o.kind, batchId: null, merge: false };
  switch (o.kind) {
    case "repeat":
      return { ...base, transactionIds: [] };
    case "duplicate":
      return { ...base, transactionIds: [o.of], merge: o.merge === true };
    case "already-imported":
      return { ...base, transactionIds: [], batchId: o.batchId };
    case "merge":
      return { ...base, transactionIds: [o.with] };
    case "possible-duplicate":
      return { ...base, transactionIds: [...o.candidates] };
    case "replace":
      return { ...base, transactionIds: [o.replaces] };
  }
}

export const listImportDuplicatePreviewRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/import/batches/{batchId}/files/{fileId}/duplicates",
  operationId: "listImportDuplicatePreview",
  summary:
    "Before «Застосувати» (IMP-04 FR 1–6, IMP-08 FR 6): the rows of a parsed file the apply would not write as new ones — «дубль», «уже імпортовано», «повтор у файлі», «Можливий дубль», «замінено», злиття — with what each matches, by the apply's own plan against the account's transactions as they are now; read only, a page at a time by row",
  access: READ,
  list: true,
  request: { params: fileParams, query: pageQuery },
  problems: ["BATCH_STATE_CONFLICT", "IMPORT_PLAN_TOO_LARGE"],
  response: {
    status: 200,
    description: "A page of the file's duplicate preview",
    schema: pageOf(duplicateSchema).extend({
      /** The file's account; null — none chosen yet: nothing is planned. */
      accountId: z.uuid().nullable(),
      /**
       * An earlier file of the batch has the same account: the apply plans this file after that one is written, so
       * its rows (not seen here) may match this file's rows too.
       */
      afterEarlierFile: z.boolean(),
    }),
  },
  handler: async ({ params, query }, ctx) => {
    owner(ctx);
    const open = opener(ctx);
    const { parse, preview } = importSessionsServices(ctx);
    if (!parse || !preview) throw new ApiProblem("INTERNAL");
    const { householdId } = ctx.principal;
    const after = query.cursor ? decodeCursor(query.cursor, rowCursor).r : 0;
    const out = await guarded(() =>
      duplicatePreviewOf(
        (work) => ctx.inHousehold((q) => work(applyTx(q))),
        open,
        {
          plan: (deps, request) => planImport(deps, householdId, request),
          candidates: preview.candidates,
          creditCard: async (accountId) =>
            (await parse.accounts.postingAccount(householdId, accountId))?.kind === "credit-card",
        },
        params.batchId,
        params.fileId,
      ),
    );
    const rest = out.rows.filter((r) => r.row > after);
    const page = rest.slice(0, query.limit);
    return {
      accountId: out.accountId,
      afterEarlierFile: out.afterEarlierFile,
      items: page.map(presentDuplicate),
      nextCursor: rest.length > query.limit ? encodeCursor({ r: page.at(-1)!.row }) : null,
    };
  },
});

export const importReviewRoutes = [
  getImportFileReviewRoute,
  listImportReviewRowsRoute,
  listImportDuplicatePreviewRoute,
];
