import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ProtectedContext } from "../../../../platform/http/route.ts";
import { kyivToday, type ListTotals } from "../../../../platform/lists/list-total.ts";
import type { AccountDirectory } from "../../../accounts/index.ts";
import type { CategoryDirectory } from "../../../categories/index.ts";
import type { AuditLog } from "../../../audit/index.ts";
import { REPORTING_CURRENCY } from "../../../fx-rates/index.ts";
import type {
  DuplicateCheck,
  FeeCategoryCheck,
  SplitDeps,
  TransactionAudit,
  TransactionsDeps,
  TransferDeps,
} from "../../application/index.ts";

/** The release flag of «Очікує» and hiding (FIN-03 b, wave 2 row 16a); the routes of hiding are behind it too. */
export const STATES_FLAG = "transactions.states";
/** BUD-06@PoC FR 8: «Одноразова витрата» (adapters/http/routes.ts `ONE_OFF`). */
const ONE_OFF_FLAG = "transactions.one-off";
/** The release flag and feature key of transfers between own accounts (FIN-03 b, wave 2 row 16b). */
export const TRANSFERS_FLAG = "transactions.transfers";
/** The release flag and feature key of «Об'єднати», «Роз'єднати» and «Не дубль» (FIN-03 b, wave 2 row 16c). */
export const DUPLICATES_FLAG = "transactions.duplicates";

/** The release flag and feature key of «До розбору» (BUD-12 a, wave 2 row 24); requires `transactions.manual`. */
export const REVIEW_FLAG = "transactions.review";

/** The release flag and feature key of «Історія змін» (FIN-03 FR 27, #439); requires `transactions.manual`. */
export const HISTORY_FLAG = "transactions.history";

/** The categories of transactions (categorization's `TransactionCategories`, by shape: no import of that module). */
export interface ReviewCategories {
  categoriesOf(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * FIN-03@PoC FR 22 «Категорії» (BUD-01@PoC AC 20, BUD-02@PoC AC 19 «Показати транзакції»): module categorization's
 * index of the transactions' own categories (wired in src/main.ts). `withCategories` gives the ids of the space's
 * transactions whose own category is one of `categoryIds` — the exact categories, no others — at most `limit` ids
 * (more rows than that: `limit` of them, so the caller sees the bound was reached). A row of a deleted or split
 * transaction may be among them: the list's query decides what it shows.
 */
export interface CategoryTransactions {
  withCategories(
    householdId: string,
    categoryIds: readonly string[],
    limit: number,
  ): Promise<readonly string[]>;
}

/** Module transfer-matching's `CardPaymentTransfers` by shape (BUD-01 FR 7): how many pairs it marked. */
export interface CardPayments {
  markFor(
    householdId: string,
    actorAccountId: string,
    fresh: { readonly transactionIds: readonly string[] },
  ): Promise<number>;
}

const BRAND = Symbol("willowsum-transactions-services");

/**
 * What the API process wires for the transactions routes (src/api.ts → `ctx.services`): the accounts module's
 * directory, the journal (ledger), the totals of the list at the official dated rates (DAT-01, fx-rates), the audit
 * log and the clock. Every port takes the caller's space from `ctx.principal`.
 */
export interface TransactionsServices {
  readonly [BRAND]: true;
  readonly deps: TransactionsDeps;
  /** «Розділити» (BUD-13 FR 6–8): the same ports and the space's category tree; null when it is not wired. */
  readonly splits: SplitDeps | null;
  /** Transfers (FIN-03 FR 7, FR 27): the same ports and the official rates; null when the rates are not wired. */
  readonly transfers: TransferDeps | null;
  /** IMP-03 FR 21: whether a category may take a pair's fee (the categories directory); null when it is not wired. */
  readonly feeCategory: FeeCategoryCheck | null;
  readonly totals: ListTotals;
  /**
   * BUD-12 FR 7: module categorization's category of each transaction (wired in src/main.ts), so «Підтвердити» on a
   * card whose category was changed in another window is refused; null when it is not wired.
   */
  readonly categoryOf: ReviewCategories | null;
  /** FIN-03 FR 22 «Категорії»: the transactions of a category (module categorization); null when it is not wired. */
  readonly categoryTransactions: CategoryTransactions | null;
  /**
   * BUD-01@PoC FR 7, AC4 (#722 D): module transfer-matching's `CardPaymentTransfers` (by shape: no import of that
   * module), run after «Нова транзакція» — a payment to a credit card from an own account becomes a transfer at once;
   * null when it is not wired.
   */
  readonly cardPayments: CardPayments | null;
  /** The profile currency of the totals (EUR for every space in this release, ACC-06). */
  readonly reportingCurrency: string;
  /** «Історія змін» (FIN-03 FR 27): the audit log's entries of one entity; null when the log given cannot read. */
  readonly history: Pick<AuditLog, "entriesFor"> | null;
  /**
   * BUD-06@PoC FR 8 (#685): whether «Одноразова витрата» (`transactions.one-off`) is on for the space; off — every
   * transaction shows `oneOff: false`, as the budget's and the goals' reads see it. Without the flag runtime — on.
   */
  readonly oneOffEnabled: (householdId: string) => Promise<boolean>;
}

export function createTransactionsServices(options: {
  readonly accounts: AccountDirectory;
  readonly ledger: TransactionsDeps["ledger"];
  /** `createListTotals` of platform/lists with fx-rates' `officialDatedRates`, on the same clock. */
  readonly totals: ListTotals;
  /** The audit log; with `entriesFor` (the API process's) it is also the source of «Історія змін» (FIN-03 FR 27). */
  readonly audit: Pick<AuditLog, "record"> & Partial<Pick<AuditLog, "entriesFor">>;
  readonly clock: { now(): number };
  readonly newId: () => string;
  /** The categories module's directory, for the categories of split parts; without it «Розділити» answers 500. */
  readonly categories?: Pick<CategoryDirectory, "category">;
  /** The flag runtime (feature-flags), for `transactions.states` on the create and edit form; without it — off. */
  readonly flags?: { isEnabled(householdId: string, flag: string): Promise<boolean> };
  /** fx-rates' `rates`, for the rate a transfer in two currencies keeps (FR 8); without it transfers answer 500. */
  readonly rates?: TransferDeps["rates"];
  /**
   * Module duplicate-matching's check whether a transaction is a «Можливий дубль» (FR 18: only duplicates are hidden);
   * without it «Приховати транзакцію» answers 500.
   */
  readonly duplicates?: DuplicateCheck;
  /** BUD-12 FR 7: the category each transaction has (module categorization), for the card's version check. */
  readonly categoryOf?: ReviewCategories;
  /** FIN-03 FR 22: the transactions of a category (module categorization); without it the filter answers 500. */
  readonly categoryTransactions?: CategoryTransactions;
  /** BUD-01 FR 7: module transfer-matching's card payments, run after «Нова транзакція»; without it — none. */
  readonly cardPayments?: CardPayments;
}): TransactionsServices {
  const deps: TransactionsDeps = {
    accounts: options.accounts,
    ledger: options.ledger,
    audit: transactionAudit(options.audit),
    newId: options.newId,
    // «Сьогодні» of the form (FR 29): the Kyiv date, the day of the official rates; never earlier than the UTC
    // date, so a transaction of the user's today is never refused as a future one (the profile's time zone,
    // ACC-05, is not known to this module yet).
    today: () => kyivToday(options.clock.now()),
    statesEnabled: (householdId) =>
      options.flags ? options.flags.isEnabled(householdId, STATES_FLAG) : Promise.resolve(false),
    duplicates: options.duplicates ?? null,
  };
  return {
    [BRAND]: true,
    deps,
    splits: options.categories ? { ...deps, categories: options.categories } : null,
    transfers: options.rates ? { ...deps, rates: options.rates } : null,
    feeCategory: options.categories ? feeCategoryCheck(options.categories) : null,
    totals: options.totals,
    categoryOf: options.categoryOf ?? null,
    categoryTransactions: options.categoryTransactions ?? null,
    cardPayments: options.cardPayments ?? null,
    reportingCurrency: REPORTING_CURRENCY,
    history: options.audit.entriesFor ? { entriesFor: options.audit.entriesFor.bind(options.audit) } : null,
    oneOffEnabled: (householdId) =>
      options.flags ? options.flags.isEnabled(householdId, ONE_OFF_FLAG) : Promise.resolve(true),
  };
}

/** The services of a transactions route; without them (never in the API process) the route answers 500. */
export function transactionsServices(ctx: ProtectedContext): TransactionsServices {
  const services = ctx.services as Partial<TransactionsServices> | undefined;
  if (!services || services[BRAND] !== true) throw new ApiProblem("INTERNAL");
  return services as TransactionsServices;
}

/**
 * The transaction's entries in the space's own log (FIN-03 FR 20, П-10), written by the hand-off (ARC-04) with its key:
 * the values come from the hand-off with the counterparty and the description masked already (application/hand-off.ts
 * `transactionAuditValues`); the log masks them again (`sensitive`). Also the worker's (src/wiring.ts).
 */
export function transactionAudit(audit: Pick<AuditLog, "record">): TransactionAudit {
  return {
    async changed(householdId, actorAccountId, transactionId, action, values, key) {
      await audit.record(householdId, {
        actor: actorAccountId === null ? { kind: "system" } : { kind: "user", id: actorAccountId },
        channel: actorAccountId === null ? "system" : "web",
        entity: { type: "transactions.transaction", id: transactionId },
        // The log knows create, update and delete: a split, hiding and showing are updates of the transaction, told
        // apart by their fields (`split.*`, `hidden`) and the key (`transactions.split:…`, `transactions.hide:…`).
        action: action === "create" || action === "delete" ? action : "update",
        changes: values.map((v) => ({
          field: v.field,
          before: v.before,
          after: v.after,
          sensitive: v.sensitive,
        })),
        key,
      });
    },
    async tagChanged(householdId, entry) {
      await audit.record(householdId, {
        actor: { kind: "user", id: entry.actorAccountId },
        channel: "web",
        entity: { type: "transactions.tag", id: entry.tagId },
        action: entry.action,
        changes: entry.changes.map((c) => ({ ...c })),
        key: entry.key,
      });
    },
  };
}

/**
 * IMP-03@PoC FR 21: a category that may take a pair's fee or currency difference — of the space (another space's and an
 * unknown one read null), not merged away, not a service one («Переказ», «Коригування»); hidden is allowed.
 */
export function feeCategoryCheck(categories: Pick<CategoryDirectory, "category">): FeeCategoryCheck {
  return async (householdId, categoryId) => {
    const category = await categories.category(householdId, categoryId);
    return category !== null && category.state !== "retired" && category.kind !== "service";
  };
}
