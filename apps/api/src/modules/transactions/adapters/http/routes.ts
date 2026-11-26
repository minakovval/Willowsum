import { Decimal, Money } from "@willowsum/domain-kernel";
import {
  CATEGORY_FILTER_MAX,
  categoryCondition,
  ownCategoryTransactions,
  takeCategoryFilters,
} from "./category-filter.ts";
import { z } from "zod";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { defineRoute, type ProtectedContext } from "../../../../platform/http/route.ts";
import { logEvent } from "../../../../platform/telemetry/signals.ts";
import type { AmountGroup } from "../../../../platform/lists/list-engine.ts";
import type { ListTotal } from "../../../../platform/lists/list-total.ts";
import {
  applyHandOff,
  createTransaction,
  createTransfer,
  deleteTransaction,
  dismissDuplicate,
  markTransfer,
  mergeDuplicate,
  removeSplit,
  setHidden,
  setSplit,
  splitCategoryKinds,
  unmarkTransfer,
  unmergeDuplicate,
  updateTransaction,
  type DuplicateResult,
  type HandOffDeps,
  type StoredTransaction,
  type TransactionHandOff,
  type TransactionResult,
  type NewTransferResult,
  type TransferResult,
} from "../../application/index.ts";
import {
  CATEGORY_PARTS_MAX,
  COUNTERPARTY_MAX,
  DESCRIPTION_MAX,
  REVIEW_STATES,
  SPLIT_MODES,
  SPLIT_MONTHS_MAX,
  SPLIT_MONTHS_MIN,
  TRANSACTION_SOURCES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  typeOf,
  type FieldIssue,
  type Split,
} from "../../domain/index.ts";
import {
  bankFieldsOf,
  type BankFields,
  listedSplit,
  mergedOf,
  partsOf,
  transactionsList,
  transactionsTx,
  transfersOf,
  type TransferView,
} from "../db/store.ts";
import { tagsTx } from "../db/tags.ts";
import { transactionRows } from "../queue/hand-off.ts";
import { DUPLICATES_FLAG, STATES_FLAG, TRANSFERS_FLAG, transactionsServices } from "./services.ts";

/**
 * Transactions entered by hand (FIN-03@PoC FR 1–3, FR 13, FR 16, FR 20, FR 22, FR 29, edge case 2; wave 2 row 15):
 * create, read, change and delete, each through the journal, and the list «Транзакції» on the universal list engine
 * (DAT-01). The space is the session's (П-5): a transaction or an account of another space is «not found». A scoped
 * member: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу») — not found on
 * reads, and changes need `household.data.write`, which a scoped member never has. Behind the release flag
 * `transactions.manual` (ships off) under the feature key of the same name; no plan limit.
 */
const MODULE = "transactions";
export const FEATURE = "transactions.manual";
/** BUD-13: «атрибути транзакцій» — here «Розділити» (FR 6–8); its own key and flag, which requires `transactions.manual`. */
export const ATTRIBUTES = "transactions.attributes";
/** BUD-06@PoC FR 8 «Одноразова витрата»: its switch (release flag and feature key). */
export const ONE_OFF = "transactions.one-off";

const moneySchema = z.object({ amount: z.string(), currency: z.string() });
const moneyInput = z
  .object({
    /** Signed: plus — «надходження», minus — «списання»; at most the currency's minor units; not 0. */
    amount: z.string().max(48).meta({ description: "A signed plain decimal, e.g. -45.50" }),
    currency: z
      .string()
      .max(10)
      .meta({ description: "ISO 4217 code; the account's (subaccount's) currency" }),
  })
  .strict();
const statusInput = z.enum(TRANSACTION_STATUSES).optional();
const isoDate = z.string().max(10).meta({ description: "YYYY-MM-DD; never after today" });
const optionalText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .optional();

const splitSchema = z.object({
  /** «За категоріями» or «На кілька місяців». */
  mode: z.enum(SPLIT_MODES),
  /** BUD-01 FR 6: the amount changed after the split — «потребує перегляду». */
  needsReview: z.boolean(),
  parts: z.array(
    z.object({
      categoryId: z.uuid(),
      /** «На кілька місяців»: the share's month (YYYY-MM); null for «За категоріями». */
      month: z.string().nullable(),
      /** Signed, in the transaction's currency; the parts summed to its amount when saved. */
      amount: moneySchema,
    }),
  ),
});

const transferSchema = z.object({
  id: z.uuid(),
  /** «списання» (outflow) or «зарахування» (inflow) of the pair. */
  side: z.enum(["outflow", "inflow"]),
  /** The other transaction of the pair, on another account of the space (FR 7: shown in the lists of both). */
  counterpartId: z.uuid(),
  /** Edge case 1: the earlier side's date. */
  date: z.string(),
  /** FR 8: in one currency the difference, an expense «Комісії банку» (negative); null — none or two currencies. */
  fee: moneySchema.nullable(),
  /**
   * FR 8 (owner, 2026-11-26, decision 11): two currencies — the credit actually received less the debit at the official
   * rate of the date, in the credit's currency, counted in the budget in «Комісії банку»: negative — a loss (an
   * expense), positive — a gain (an income); the journal keeps it on «Валютна різниця». Null — one currency (see `fee`)
   * or no difference.
   */
  currencyDifference: moneySchema.nullable(),
  /** FR 8: two currencies — 1 unit of the inflow's currency in the outflow's, the official rate of the date. */
  rate: z.object({ rate: z.string(), date: z.string(), source: z.string() }).nullable(),
});

export const transactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  /** Signed, in the account's currency (FR 2). */
  amount: moneySchema,
  /** FR 3: «надходження» is income, «списання» an expense. */
  type: z.enum(TRANSACTION_TYPES),
  date: z.string(),
  counterparty: z.string().nullable(),
  description: z.string().nullable(),
  /** FR 24: «Проведена» or «Очікує» (no journal event, so no change of the balance, until posted — FR 4). */
  status: z.enum(TRANSACTION_STATUSES).meta({ "x-extensible-enum": true }),
  source: z.enum(TRANSACTION_SOURCES).meta({ "x-extensible-enum": true }),
  /** FR 16, FR 17: «Приховати транзакцію» — out of the list (unless filtered for), the budget and the reports. */
  hidden: z.boolean(),
  /** BUD-13 FR 6–8: the budget's view of the amount; «Категорія» of the list shows the first part (FIN-03 FR 23). */
  split: splitSchema.nullable(),
  /**
   * FR 7: a side of a transfer between own accounts — neither income nor expense, out of the budget and the reports,
   * whatever `type` (the direction) says; null — none. Never hidden or split (FR 18).
   */
  transfer: transferSchema.nullable(),
  /**
   * FR 11, FR 12: a duplicate merged («Об'єднати») into this transaction — hidden, without its own journal event;
   * «Роз'єднати» gives it back. Null — not merged.
   */
  mergedInto: z.uuid().nullable(),
  /** FR 11: the duplicates merged into this one — «Об'єднано» and «Роз'єднати» when there are any. */
  mergedDuplicates: z.array(z.uuid()),
  /** BUD-13 FR 1: «Нотатка» (up to 2 000 characters); null — none. The row shows its icon (FIN-03 FR 23). */
  note: z.string().nullable(),
  /** BUD-13 FR 2: «Теги» — the space's tags of the transaction, in the order given; the row's icon lists them. */
  tags: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /**
   * BUD-06@PoC FR 8: «Одноразова витрата» — stays in the fact of its period, but leaves the averages (the base
   * «Середнє за N міс.», «Створити за моїми витратами», «Подушка безпеки»); false — not marked.
   */
  oneOff: z.boolean(),
  /**
   * BUD-12 FR 4, FR 8: «До розбору» — `queued` (in the queue), `confirmed` (its category confirmed), null (never in
   * the queue: entered by hand).
   */
  review: z.enum(REVIEW_STATES).nullable().meta({ "x-extensible-enum": true }),
  /** One more with each change: the card's «Підтвердити» sends it back (BUD-12 FR 7). */
  version: z.number().int(),
  /** «Дата і час»: when it was recorded (ISO 8601 UTC); the form has a date only. */
  recordedAt: z.string(),
  /**
   * IMP-02@PoC FR 4 (S-047): the bank's description as the statement printed it (every description column joined,
   * numbers masked to their last 4) — kept apart from `description`, never changed by an edit; the merchant comes from
   * it. Null — entered by hand.
   */
  bankDescription: z.string().nullable(),
  /** IMP-02 FR 4: the balance after the operation as the statement printed it; null — none or entered by hand. */
  balanceAfter: moneySchema.nullable(),
  /** IMP-02 FR 4: the import batch, its file and the row of the file (from 1) it came from; null — entered by hand. */
  importedFrom: z.object({ batchId: z.uuid(), fileId: z.uuid(), row: z.number().int() }).nullable(),
  /**
   * IMP-02 FR 4: «початкова сума» — the amount and currency of the operation before the bank's rate, signed as `amount`;
   * null — the statement has none (or the transaction was imported before it was kept).
   */
  originalAmount: moneySchema.nullable(),
  /** IMP-02 FR 4: «курс» — the bank's rate as the statement printed it (decimal text); null — none. */
  exchangeRate: z.string().nullable(),
  /** IMP-02 FR 4: «дата валютування» (YYYY-MM-DD); null — none. */
  valueDate: z.string().nullable(),
  /** IMP-02 FR 4: the bank's reference of the operation (masked as the description); null — none. */
  bankReference: z.string().nullable(),
  /**
   * IMP-02 FR 5 (#698): the bank's fee included in `amount` — the fee charged, positive, in the amount's currency (the
   * journal keeps it as the operation's separate fee leg); null — none or entered by hand.
   */
  bankFee: moneySchema.nullable(),
});

type BankOut = Pick<
  z.input<typeof transactionSchema>,
  | "bankDescription"
  | "balanceAfter"
  | "importedFrom"
  | "originalAmount"
  | "exchangeRate"
  | "valueDate"
  | "bankReference"
  | "bankFee"
>;

const NO_BANK_FIELDS: BankOut = {
  bankDescription: null,
  balanceAfter: null,
  importedFrom: null,
  originalAmount: null,
  exchangeRate: null,
  valueDate: null,
  bankReference: null,
  bankFee: null,
};

/** IMP-02 FR 4: the bank's fields of a transaction as read (`BANK_FIELDS`, by row or by `bankFieldsOf`). */
function bankOut(f: BankFields | undefined): BankOut {
  if (!f) return NO_BANK_FIELDS;
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const balance = text(f.balanceAfter);
  const original = text(f.originalAmount);
  const rate = text(f.exchangeRate);
  const batchId = text(f.importBatchId);
  const fileId = text(f.importFileId);
  return {
    bankDescription: text(f.bankDescription),
    balanceAfter: balance === null ? null : Money.of(balance, String(f.currency)).toJSON(),
    importedFrom:
      batchId !== null && fileId !== null && f.importRow !== null && f.importRow !== undefined
        ? { batchId, fileId, row: Number(f.importRow) }
        : null,
    originalAmount:
      original === null || f.originalCurrency === null
        ? null
        : Money.of(original, String(f.originalCurrency)).toJSON(),
    exchangeRate: rate === null ? null : new Decimal(rate).toFixed(),
    valueDate: f.valueDate === null || f.valueDate === undefined ? null : dateText(f.valueDate),
    bankReference: text(f.bankReference),
    bankFee:
      text(f.bankFee) === null || text(f.bankFeeCurrency) === null
        ? null
        : Money.of(String(f.bankFee), String(f.bankFeeCurrency)).toJSON(),
  };
}

function splitOut(split: Split | null): z.input<typeof splitSchema> | null {
  if (split === null) return null;
  return {
    mode: split.mode,
    needsReview: split.needsReview,
    parts: split.parts.map((p) => ({
      categoryId: p.categoryId,
      month: p.month?.slice(0, 7) ?? null,
      amount: p.amount.toJSON(),
    })),
  };
}

function transferOut(id: string, view: TransferView | undefined): z.input<typeof transferSchema> | null {
  if (!view) return null;
  const { link } = view;
  const outflow = link.outflowId === id;
  return {
    id: link.id,
    side: outflow ? "outflow" : "inflow",
    counterpartId: outflow ? link.inflowId : link.outflowId,
    date: view.date,
    fee: view.fee?.toJSON() ?? null,
    currencyDifference: view.currencyDifference?.toJSON() ?? null,
    rate:
      link.rate === null
        ? null
        : { rate: link.rate.rate.toString(), date: link.rate.date, source: link.rate.source },
  };
}

/** BUD-13 FR 2: the tags by name; an id that is no tag of the space any more is left out. */
const tagsOut = (ids: readonly string[], names: ReadonlyMap<string, string>) =>
  ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));

function present(
  t: StoredTransaction,
  view: TransferView | undefined,
  duplicates: readonly string[],
  names: ReadonlyMap<string, string>,
  oneOffOn: boolean,
  bank: BankFields | undefined,
): z.input<typeof transactionSchema> {
  return {
    id: t.id,
    accountId: t.accountId,
    amount: t.amount.toJSON(),
    type: typeOf(t.amount),
    date: t.date,
    counterparty: t.counterparty,
    description: t.description,
    status: t.status,
    source: t.source,
    hidden: t.hidden,
    split: splitOut(t.split),
    transfer: t.transfer ? transferOut(t.id, view) : null,
    mergedInto: t.mergedInto,
    mergedDuplicates: [...duplicates],
    note: t.note,
    tags: tagsOut(t.tagIds, names),
    // BUD-06 FR 8 (#685): with `transactions.one-off` off the stored mark is shown nowhere, as it acts nowhere.
    oneOff: oneOffOn && t.oneOff,
    review: t.review,
    version: t.version,
    recordedAt: t.createdAt,
    ...bankOut(bank),
  };
}

/**
 * The transaction as the API shows it: with its transfer (FR 7) and the duplicates merged into it (FR 11) read in the
 * space's transactions.
 */
export async function shown(
  ctx: ProtectedContext,
  t: StoredTransaction,
): Promise<z.input<typeof transactionSchema>> {
  const householdId = ctx.principal.householdId;
  const transferId = t.transfer?.id;
  const { views, merged, names, bank } = await ctx.inHousehold(async (q) => ({
    views: transferId ? await transfersOf(q, householdId, [transferId]) : new Map<string, TransferView>(),
    merged: t.mergedInto === null ? await mergedOf(q, householdId, [t.id]) : new Map<string, string[]>(),
    names: await tagsTx(q).names(householdId, t.tagIds),
    // IMP-02 FR 4: only an imported one has them (one read by the key, in the space).
    bank:
      t.source === "imported" ? await bankFieldsOf(q, householdId, [t.id]) : new Map<string, BankFields>(),
  }));
  const oneOffOn = await transactionsServices(ctx).oneOffEnabled(householdId);
  return present(
    t,
    transferId ? views.get(transferId) : undefined,
    merged.get(t.id) ?? [],
    names,
    oneOffOn,
    bank.get(t.id),
  );
}

/** Where the form is wrong: the field and an issue code, never the value sent. */
export function invalid(issues: readonly FieldIssue[]): ApiProblem {
  return new ApiProblem("VALIDATION_FAILED", {
    errors: issues.map((i) => ({ in: "body" as const, path: i.field, issue: i.issue })),
  });
}

export function outcome(
  result:
    | TransactionResult
    | TransferResult
    | NewTransferResult
    | DuplicateResult
    | { readonly kind: "ok" | "closed" | "in-transfer" | "merged" | "not-found" },
): void {
  switch (result.kind) {
    case "invalid":
      throw invalid(result.issues);
    case "closed":
      throw new ApiProblem("ACCOUNT_CLOSED");
    case "in-transfer":
      throw new ApiProblem("TRANSACTION_IN_TRANSFER");
    case "merged":
      throw new ApiProblem("TRANSACTION_MERGED");
    case "not-hideable":
      throw new ApiProblem("TRANSACTION_NOT_HIDEABLE");
    case "has-duplicates":
      throw new ApiProblem("TRANSACTION_HAS_DUPLICATES");
    case "conflict":
      throw new ApiProblem("VERSION_CONFLICT");
    case "not-found":
      throw new ApiProblem("NOT_FOUND");
  }
}

/**
 * ARC-04 FR 2: the hand-off of a committed change, right away — after the transactions transaction (the journal under
 * the row's lock in a new one, the audit entry outside it). A failure is no failure of the request: the change is made
 * and its job is in the transactions queue, so the worker finishes the hand-off (a create's Idempotency-Key must not be
 * released, or a retry would create a second transaction). Logged as `transactions.hand_off_deferred` (WARN, the error
 * class only).
 */
export async function handOffNow(
  ctx: ProtectedContext,
  deps: HandOffDeps,
  handOff: TransactionHandOff | readonly TransactionHandOff[] | null,
): Promise<void> {
  if (handOff === null) return;
  try {
    // A transfer's two hand-offs in their order (application/transfers.ts); the worker finishes the rest on a failure.
    for (const h of Array.isArray(handOff) ? handOff : [handOff as TransactionHandOff])
      await applyHandOff(
        deps,
        transactionRows((work) => ctx.inHousehold(work)),
        ctx.principal.householdId,
        h,
      );
  } catch (error) {
    logEvent("transactions.hand_off_deferred", "warn", {
      "ws.module": MODULE,
      "error.type": error instanceof Error ? error.constructor.name || error.name : typeof error,
    });
  }
}

/** Scoped members: «Транзакції» are closed by the visibility policy's default (00-general «Область доступу»). */
export function refuseScoped(ctx: { principal: { scoped: boolean } }): void {
  if (ctx.principal.scoped) throw new ApiProblem("NOT_FOUND");
}

export const caller = (ctx: { principal: { householdId: string; userId: string } }) => ({
  householdId: ctx.principal.householdId,
  accountId: ctx.principal.userId,
});

export const params = z.object({ transactionId: z.uuid() });

export const createTransactionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions",
  operationId: "createTransaction",
  summary:
    "«Нова транзакція»: a transaction entered by hand, one journal event; the balance is recounted at once",
  access: { permission: "household.data.write", feature: FEATURE },
  create: true,
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    body: z
      .object({
        /** «Рахунок*» (FR 32). */
        accountId: z.uuid(),
        /** «Сума*» with the currency of the account (FR 2; edge case 2: another currency is refused). */
        amount: moneyInput,
        /** «Дата*» (FR 29). */
        date: isoDate,
        /** «Контрагент»: one line, up to 200 characters. */
        counterparty: optionalText(COUNTERPARTY_MAX),
        /** «Опис»: up to 1 000 characters. */
        description: optionalText(DESCRIPTION_MAX),
        /** «Статус» (FR 28): «Проведена» by default; «Очікує» behind the flag `transactions.states`. */
        status: statusInput,
      })
      .strict(),
  },
  response: { status: 201, description: "The new transaction", schema: transactionSchema },
  handler: async ({ body }, ctx) => {
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      createTransaction(deps, transactionsTx(q), caller(ctx), body),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff);
    return shown(ctx, result.transaction);
  },
});

export const getTransactionRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions/{transactionId}",
  operationId: "getTransaction",
  summary: "One transaction; another space's transaction is not found",
  access: { permission: "household.data.read", feature: FEATURE },
  request: { params },
  response: { status: 200, description: "The transaction", schema: transactionSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    // Wired like every route of the module (src/api.ts): without the module's services it answers 500.
    transactionsServices(ctx);
    const row = await ctx.inHousehold((q) =>
      transactionsTx(q).find(ctx.principal.householdId, params.transactionId),
    );
    if (!row) throw new ApiProblem("NOT_FOUND");
    return shown(ctx, row);
  },
});

export const updateTransactionRoute = defineRoute({
  module: MODULE,
  method: "PATCH",
  path: "/v1/transactions/{transactionId}",
  operationId: "updateTransaction",
  summary:
    "«Зберегти» of the edit form: the fields sent change; the account, amount or date correct the journal event; a hidden copy whose pair this ends is shown again (FIN-03 FR 35)",
  access: { permission: "household.data.write", feature: FEATURE },
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_IN_TRANSFER", "TRANSACTION_MERGED", "TRANSACTION_HAS_DUPLICATES"],
  request: {
    params,
    body: z
      .object({
        accountId: z.uuid().optional(),
        amount: moneyInput.optional(),
        date: isoDate.optional(),
        /** null or "" removes it. */
        counterparty: optionalText(COUNTERPARTY_MAX),
        description: optionalText(DESCRIPTION_MAX),
        /** «Проведена» posts it to the journal, «Очікує» takes it out (FR 4). */
        status: statusInput,
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction after the change", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      updateTransaction(deps, transactionsTx(q), caller(ctx), params.transactionId, body),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff ? [result.handOff, ...(result.shown ?? [])] : null);
    return shown(ctx, result.transaction);
  },
});

export const deleteTransactionRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transactions/{transactionId}",
  operationId: "deleteTransaction",
  summary:
    "«Видалити» a transaction entered by hand: its postings are reversed, the balance is as before (FR 16); a hidden copy whose pair it was is shown again (FR 35). An imported one is hidden instead, its journal entry kept (FR 16, AC9; IMP-04 FR 9)",
  access: { permission: "household.data.write", feature: FEATURE },
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_IN_TRANSFER", "TRANSACTION_MERGED"],
  request: { params },
  response: {
    status: 200,
    description: "Deleted",
    schema: z.object({ deleted: z.literal(true) }),
  },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await ctx.inHousehold((q) =>
      deleteTransaction(deps, transactionsTx(q), caller(ctx), params.transactionId),
    );
    outcome(result);
    if (result.kind === "ok")
      await handOffNow(
        ctx,
        deps,
        [result.handOff, ...result.shown].filter((h) => h !== null),
      );
    return { deleted: true as const };
  },
});

/** One total of the list in the profile currency (DAT-01 FR 12): unrounded; null only when no record has a rate. */
const totalSchema = z.object({
  total: moneySchema.nullable(),
  /** «конвертовано»: some amount was in another currency. */
  converted: z.boolean(),
  /** «приблизно»: some transaction was converted at the nearest earlier rate. */
  approximate: z.boolean(),
  nearestRateCount: z.number().int(),
  /** «без N записів: немає курсу». */
  partial: z.boolean(),
  noRateCount: z.number().int(),
});

const totalOut = (t: ListTotal): z.input<typeof totalSchema> => ({
  total: t.total === null ? null : t.total.toJSON(),
  converted: t.converted,
  approximate: t.approximate,
  nearestRateCount: t.nearestRateCount,
  partial: t.partial,
  noRateCount: t.noRateCount,
});

/** The driver gives a `date` as local midnight and a `timestamptz` as an instant. */
function dateText(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value);
}

function listItem(
  row: Record<string, unknown>,
  parts: Awaited<ReturnType<typeof partsOf>>,
  transfers: ReadonlyMap<string, TransferView>,
  merged: ReadonlyMap<string, string[]>,
  names: ReadonlyMap<string, string>,
  oneOffOn: boolean,
): z.input<typeof transactionSchema> {
  const amount = Money.of(String(row["amount"]), String(row["currency"]));
  const recorded = row["createdAt"];
  return {
    id: String(row["id"]),
    accountId: String(row["accountId"]),
    amount: amount.toJSON(),
    type: typeOf(amount),
    date: dateText(row["date"]),
    counterparty: (row["counterparty"] as string | null) ?? null,
    description: (row["description"] as string | null) ?? null,
    status: row["status"] as StoredTransaction["status"],
    source: row["source"] as StoredTransaction["source"],
    hidden: row["hidden"] === true,
    split: splitOut(listedSplit(row, parts)),
    transfer:
      row["transferId"] === null || row["transferId"] === undefined
        ? null
        : transferOut(String(row["id"]), transfers.get(String(row["transferId"]))),
    mergedInto: (row["mergedInto"] as string | null) ?? null,
    mergedDuplicates: merged.get(String(row["id"])) ?? [],
    note: (row["note"] as string | null) ?? null,
    tags: tagsOut(rowTags(row), names),
    oneOff: oneOffOn && row["oneOff"] === true,
    review: (row["review"] as StoredTransaction["review"]) ?? null,
    version: Number(row["version"]),
    recordedAt: recorded instanceof Date ? recorded.toISOString() : String(recorded),
    ...bankOut(row as BankFields),
  };
}

const rowTags = (row: Record<string, unknown>): string[] =>
  Array.isArray(row["tagIds"]) ? (row["tagIds"] as unknown[]).map(String) : [];

/**
 * «Дата і час» (FR 13, AC13) is the date and, under it, the time: within one date the newer record comes first, so
 * the date sort (and the default, no sort) carries the record time as its second key in the same direction.
 */
function dateAndTime(sort: string | undefined): string {
  if (sort === undefined || sort === "" || sort === "-date") return "-date,-recordedAt";
  if (sort === "date") return "date,recordedAt";
  return sort;
}

/**
 * FR 16, FR 17: a hidden transaction is out of the list — its rows, count and totals — unless the filter asks for
 * hidden ones («Стан: приховані», `hidden.eq:true`).
 */
function shownUnlessAsked(filter: string | readonly string[] | undefined): string[] {
  const filters = filter === undefined ? [] : typeof filter === "string" ? [filter] : [...filter];
  return filters.some((f) => f.startsWith("hidden.")) ? filters : [...filters, "hidden.eq:false"];
}

export const listTransactionsRoute = defineRoute({
  module: MODULE,
  method: "GET",
  path: "/v1/transactions",
  operationId: "listTransactions",
  summary:
    "«Транзакції»: one numbered page, the count, and the totals of income, expenses and their difference in the profile currency",
  access: { permission: "household.data.read", feature: FEATURE },
  request: {
    query: z.object({
      ...transactionsList.query,
      filter: transactionsList.query.filter.meta({
        description:
          "Filter `<field>.<operator>:<value>` (repeatable; all must hold): `accountId` eq/in, `date` gte/lte, `type` eq " +
          "(in/out), `amount` gte/lte (without sign), `counterparty` eq/has, `search` has, `status` eq/in, `split` eq, " +
          "`hidden` eq, `transfer` eq, `tag` eq/in, `review` eq/in, `category` eq/in — FIN-03 FR 22 «Категорії»: the " +
          "exact categories (no others); an unsplit transaction by its own category, a split one by its parts; " +
          `more than ${CATEGORY_FILTER_MAX} transactions in all category filters of a request is 422 LIMIT_REACHED`,
      }),
    }),
  },
  response: {
    status: 200,
    description:
      "«Рядків на сторінці N · from–to з count»; totals at the official rate of each transaction's date (DAT-01 FR 12)",
    schema: z.object({
      items: z.array(transactionSchema),
      page: z.number().int(),
      pageSize: z.number().int(),
      /** Matching transactions (M of «1–N з M»). */
      count: z.number().int(),
      from: z.number().int(),
      to: z.number().int(),
      /** The totals row (FR 13): the key is not `totals`, whose numbers the money lint rule (NFR-06) would read as amounts. */
      summary: z.object({
        /** The profile currency. */
        currency: z.string(),
        income: totalSchema,
        expense: totalSchema,
        /** Income plus expenses (the expenses are negative). */
        difference: totalSchema,
      }),
    }),
  },
  handler: async ({ query }, ctx) => {
    refuseScoped(ctx);
    const { totals, reportingCurrency, oneOffEnabled, categoryTransactions } = transactionsServices(ctx);
    const oneOffOn = await oneOffEnabled(ctx.principal.householdId);
    // FIN-03 FR 22 «Категорії»: the own categories are module categorization's, read before this module's transaction.
    const { rest, categories } = takeCategoryFilters(shownUnlessAsked(query.filter));
    const own = await ownCategoryTransactions(categoryTransactions, ctx.principal.householdId, categories);
    const { page, parts, transfers, merged, names } = await ctx.inHousehold(async (q) => {
      const condition = await categoryCondition(q, ctx.principal.householdId, categories, own);
      const page = await transactionsList.run(q, {
        ...query,
        filter: rest,
        sort: dateAndTime(query.sort),
        condition: condition ?? undefined,
      });
      const split = page.items.filter((r) => r["splitMode"] !== null).map((r) => String(r["id"]));
      const transferIds = page.items
        .filter((r) => r["transferId"] !== null)
        .map((r) => String(r["transferId"]));
      return {
        page,
        parts: await partsOf(q, ctx.principal.householdId, split),
        transfers: await transfersOf(q, ctx.principal.householdId, transferIds),
        merged: await mergedOf(
          q,
          ctx.principal.householdId,
          page.items.map((r) => String(r["id"])),
        ),
        names: await tagsTx(q).names(ctx.principal.householdId, [...new Set(page.items.flatMap(rowTags))]),
      };
    });
    const of = (sign: AmountGroup["sign"]) => page.groups.filter((g) => g.sign === sign);
    const [income, expense, difference] = await Promise.all([
      totals.total(of("in"), reportingCurrency),
      totals.total(of("out"), reportingCurrency),
      totals.total(page.groups, reportingCurrency),
    ]);
    return {
      items: page.items.map((row) => listItem(row, parts, transfers, merged, names, oneOffOn)),
      page: page.page,
      pageSize: page.pageSize,
      count: page.count,
      from: page.from,
      to: page.to,
      summary: {
        currency: reportingCurrency,
        income: totalOut(income),
        expense: totalOut(expense),
        difference: totalOut(difference),
      },
    };
  },
});

const partInput = z
  .object({
    categoryId: z.uuid(),
    /** Signed like the transaction, at most the currency's minor units. */
    amount: z.string().max(48).meta({ description: "A signed plain decimal, e.g. -85.00" }),
  })
  .strict();

const splitInput = z.discriminatedUnion("mode", [
  z
    .object({
      /** «За категоріями»: 2–20 parts that sum to the amount exactly; no parts — the split is cancelled. */
      mode: z.literal("categories"),
      parts: z.array(partInput).max(CATEGORY_PARTS_MAX),
    })
    .strict(),
  z
    .object({
      /** «На кілька місяців»: equal shares, the rounding remainder in the last. */
      mode: z.literal("months"),
      /** «Починаючи з»: YYYY-MM. */
      startMonth: z.string().max(7),
      /** «Місяців»: 2–60. */
      months: z.number().int().min(SPLIT_MONTHS_MIN).max(SPLIT_MONTHS_MAX),
      categoryId: z.uuid(),
    })
    .strict(),
]);

const splitWiring = (ctx: ProtectedContext) => {
  const { splits } = transactionsServices(ctx);
  if (splits === null) throw new ApiProblem("INTERNAL");
  return splits;
};

export const splitTransactionRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/{transactionId}/split",
  operationId: "splitTransaction",
  summary:
    "«Розділити»: the budget's view of the amount by categories or by months; no new transaction, the journal and the balance unchanged",
  access: { permission: "household.data.write", feature: ATTRIBUTES },
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_IN_TRANSFER", "TRANSACTION_MERGED"],
  request: { params, body: splitInput },
  response: { status: 200, description: "The transaction with its split", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const deps = splitWiring(ctx);
    const kinds = await splitCategoryKinds(deps, ctx.principal.householdId, body);
    if (Array.isArray(kinds)) throw invalid(kinds);
    const result = await ctx.inHousehold((q) =>
      setSplit(deps, transactionsTx(q), caller(ctx), params.transactionId, body, kinds),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff);
    return shown(ctx, result.transaction);
  },
});

export const unsplitTransactionRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transactions/{transactionId}/split",
  operationId: "unsplitTransaction",
  summary: "«Об'єднати назад»: the transaction is whole again (BUD-13 FR 8)",
  access: { permission: "household.data.write", feature: ATTRIBUTES },
  problems: ["ACCOUNT_CLOSED", "TRANSACTION_MERGED"],
  request: { params },
  response: { status: 200, description: "The transaction without a split", schema: transactionSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const deps = splitWiring(ctx);
    const result = await ctx.inHousehold((q) =>
      removeSplit(deps, transactionsTx(q), caller(ctx), params.transactionId),
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOff);
    return shown(ctx, result.transaction);
  },
});

const visibilityRoute = (hidden: boolean) =>
  defineRoute({
    module: MODULE,
    method: "POST",
    path: `/v1/transactions/{transactionId}/${hidden ? "hide" : "show"}`,
    operationId: hidden ? "hideTransaction" : "showTransaction",
    summary: hidden
      ? "«Приховати транзакцію»: out of the list, the budget and the reports; a manual copy leaves the balance (its journal entry is reversed), «Показати» posts it again (FIN-03 FR 16, FR 17); only a «Можливий дубль», never a transfer (FR 18)"
      : "A hidden transaction is shown again (FIN-03 FR 16); a merged duplicate only by «Роз'єднати»",
    access: { permission: "household.data.write", feature: STATES_FLAG },
    problems: hidden
      ? ["ACCOUNT_CLOSED", "TRANSACTION_IN_TRANSFER", "TRANSACTION_MERGED", "TRANSACTION_NOT_HIDEABLE"]
      : ["ACCOUNT_CLOSED", "TRANSACTION_MERGED"],
    request: { params },
    response: { status: 200, description: "The transaction", schema: transactionSchema },
    handler: async ({ params }, ctx) => {
      refuseScoped(ctx);
      const { deps } = transactionsServices(ctx);
      if (hidden && deps.duplicates === null) throw new ApiProblem("INTERNAL");
      const result = await ctx.inHousehold((q) =>
        setHidden(deps, transactionsTx(q), caller(ctx), params.transactionId, hidden),
      );
      outcome(result);
      if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
      await handOffNow(ctx, deps, result.handOff);
      return shown(ctx, result.transaction);
    },
  });

export const hideTransactionRoute = visibilityRoute(true);
export const showTransactionRoute = visibilityRoute(false);

const transfersWiring = (ctx: ProtectedContext) => {
  const { transfers } = transactionsServices(ctx);
  if (transfers === null) throw new ApiProblem("INTERNAL");
  return transfers;
};

export const markTransferRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/{transactionId}/transfer",
  operationId: "markTransfer",
  summary:
    "«Позначити як переказ» / «Підтвердити» a pair: two transactions on two accounts as one transfer — neither income nor expense (FIN-03 FR 6, FR 7, FR 27)",
  access: { permission: "household.data.write", feature: TRANSFERS_FLAG },
  bodyLimitBytes: 1024,
  problems: ["ACCOUNT_CLOSED", "VERSION_CONFLICT"],
  request: {
    params,
    body: z
      .object({
        /** The other side: a credit for a debit and the other way round, on another account of the space. */
        counterpartId: z.uuid(),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "The transaction, a side of the transfer",
    schema: transactionSchema,
  },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const deps = transfersWiring(ctx);
    const result = await markTransfer(
      deps,
      (work) => ctx.inHousehold((q) => work(transactionsTx(q))),
      caller(ctx),
      params.transactionId,
      body.counterpartId,
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return shown(ctx, result.transaction);
  },
});

const positiveMoneyInput = moneyInput.extend({
  amount: z.string().max(48).meta({ description: "A positive plain decimal, e.g. 120.50" }),
});

/**
 * «Переказ між рахунками» of «Нова транзакція» (FIN-03@PoC FR 1, FR 28; issue #437): a transfer between two accounts of
 * the space in one request — both legs, their pair and the journal's one transfer event, or nothing (application
 * createTransfer). A create route: `Idempotency-Key` (ARC-07 FR 4), so a double submit makes one transfer.
 */
export const createTransferRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/transfers",
  operationId: "createTransfer",
  summary:
    "«Переказ між рахунками»: a transfer between two own accounts in one action — the debit, the credit and one journal event (FIN-03 FR 1, FR 28)",
  access: { permission: "household.data.write", feature: TRANSFERS_FLAG },
  create: true,
  bodyLimitBytes: 16 * 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    body: z
      .object({
        /** «Рахунок*»: the account the money leaves. */
        fromAccountId: z.uuid(),
        /** The account it reaches: another account of the space. */
        toAccountId: z.uuid(),
        /** «Сума*»: positive, in the currency of `fromAccountId` (its subaccount's on a multi-currency account). */
        amount: positiveMoneyInput,
        /**
         * What reaches `toAccountId`, positive, in its currency. Optional: in one currency the amount itself (at most it:
         * the difference is the fee, FR 8); in two currencies the amount at the official rate of the date, rounded half
         * to even to the currency's minor units.
         */
        received: positiveMoneyInput.optional(),
        /** «Дата*» (FR 29), of both legs. */
        date: isoDate,
        /** «Контрагент»: one line, up to 200 characters; on both legs. */
        counterparty: optionalText(COUNTERPARTY_MAX),
        /** «Опис»: up to 1 000 characters; on both legs. */
        description: optionalText(DESCRIPTION_MAX),
      })
      .strict(),
  },
  response: {
    status: 201,
    description: "The transfer's two transactions: the debit and the credit",
    schema: z.object({ outflow: transactionSchema, inflow: transactionSchema }),
  },
  handler: async ({ body }, ctx) => {
    refuseScoped(ctx);
    const deps = transfersWiring(ctx);
    const result = await createTransfer(
      deps,
      (work) => ctx.inHousehold((q) => work(transactionsTx(q))),
      caller(ctx),
      body,
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return { outflow: await shown(ctx, result.outflow), inflow: await shown(ctx, result.inflow) };
  },
});

export const unmarkTransferRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transactions/{transactionId}/transfer",
  operationId: "unmarkTransfer",
  summary: "The transfer mark removed: both transactions are income and expense again (FIN-03 FR 9)",
  access: { permission: "household.data.write", feature: TRANSFERS_FLAG },
  problems: ["ACCOUNT_CLOSED", "VERSION_CONFLICT"],
  request: { params },
  response: { status: 200, description: "The transaction, no longer a transfer", schema: transactionSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const deps = transfersWiring(ctx);
    const result = await unmarkTransfer(
      deps,
      (work) => ctx.inHousehold((q) => work(transactionsTx(q))),
      caller(ctx),
      params.transactionId,
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return shown(ctx, result.transaction);
  },
});

const inTransactions =
  (ctx: ProtectedContext) =>
  <T>(work: (tx: ReturnType<typeof transactionsTx>) => Promise<T>) =>
    ctx.inHousehold((q) => work(transactionsTx(q)));

export const mergeDuplicateRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/{transactionId}/merge",
  operationId: "mergeDuplicate",
  summary:
    "«Об'єднати» a «Можливий дубль» / «Об'єднати з іншою»: the duplicate is merged into this transaction, which keeps its fields; the operation counts once (FIN-03 FR 11, FR 12, FR 27)",
  access: { permission: "household.data.write", feature: DUPLICATES_FLAG },
  bodyLimitBytes: 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    params,
    body: z
      .object({
        /** The duplicate: on the same account, with the same amount and currency; hidden once merged. */
        duplicateId: z.uuid(),
      })
      .strict(),
  },
  response: {
    status: 200,
    description: "The transaction that stays, «Об'єднано»",
    schema: transactionSchema,
  },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await mergeDuplicate(
      deps,
      inTransactions(ctx),
      caller(ctx),
      params.transactionId,
      body.duplicateId,
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return shown(ctx, result.transaction);
  },
});

export const unmergeDuplicateRoute = defineRoute({
  module: MODULE,
  method: "DELETE",
  path: "/v1/transactions/{transactionId}/merge",
  operationId: "unmergeDuplicate",
  summary:
    "«Роз'єднати»: a merged duplicate comes back with its own fields (on the transaction that stays: every one merged into it; FIN-03 edge case 4)",
  access: { permission: "household.data.write", feature: DUPLICATES_FLAG },
  problems: ["ACCOUNT_CLOSED"],
  request: { params },
  response: { status: 200, description: "The transaction, unmerged", schema: transactionSchema },
  handler: async ({ params }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await unmergeDuplicate(deps, inTransactions(ctx), caller(ctx), params.transactionId);
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return shown(ctx, result.transaction);
  },
});

export const dismissDuplicateRoute = defineRoute({
  module: MODULE,
  method: "POST",
  path: "/v1/transactions/{transactionId}/not-duplicate",
  operationId: "dismissDuplicate",
  summary:
    "«Не дубль»: the «Можливий дубль» mark is taken off the pair and never put on it again (FIN-03 FR 12); a side hidden as a duplicate with no other pair left is shown again (FR 35)",
  access: { permission: "household.data.write", feature: DUPLICATES_FLAG },
  bodyLimitBytes: 1024,
  problems: ["ACCOUNT_CLOSED"],
  request: {
    params,
    body: z
      .object({
        /** The other transaction of the pair: on the same account, with the same amount and currency. */
        counterpartId: z.uuid(),
      })
      .strict(),
  },
  response: { status: 200, description: "The transaction", schema: transactionSchema },
  handler: async ({ params, body }, ctx) => {
    refuseScoped(ctx);
    const { deps } = transactionsServices(ctx);
    const result = await dismissDuplicate(
      deps,
      inTransactions(ctx),
      caller(ctx),
      params.transactionId,
      body.counterpartId,
    );
    outcome(result);
    if (result.kind !== "ok") throw new ApiProblem("INTERNAL");
    await handOffNow(ctx, deps, result.handOffs);
    return shown(ctx, result.transaction);
  },
});

export const transactionsRoutes = [
  createTransactionRoute,
  listTransactionsRoute,
  getTransactionRoute,
  updateTransactionRoute,
  deleteTransactionRoute,
  splitTransactionRoute,
  unsplitTransactionRoute,
  hideTransactionRoute,
  showTransactionRoute,
  markTransferRoute,
  createTransferRoute,
  unmarkTransferRoute,
  mergeDuplicateRoute,
  unmergeDuplicateRoute,
  dismissDuplicateRoute,
];
