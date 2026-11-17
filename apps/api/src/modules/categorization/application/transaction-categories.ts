import {
  categoryAllowed,
  refusal,
  UNCATEGORIZED,
  type CategorizableFacts,
  type CategorizableIssue,
  type CategoryFacts,
  type CategorySource,
  type TransactionCategory,
} from "../domain/index.ts";
import type { CategoryHandOff } from "./hand-off.ts";

/**
 * The category of a transaction (BUD-01@PoC FR 1, FR 4, FR 5, FR 8, FR 9, FR 12; AC8; wave 2 row 20). The transaction
 * itself belongs to module transactions; this module keeps only its category and the category's source, by the
 * transaction's opaque id. A change by the user is «вручну» (FR 4) and changes only that transaction (AC8).
 */

/** A row of `transaction_categories`; a transaction without one is «Без категорії» at version 0. */
export interface StoredTransactionCategory extends TransactionCategory {
  readonly transactionId: string;
  readonly version: number;
  /** BUD-14 FR 13: the rule that set the category (the source «rule»); null otherwise. */
  readonly ruleId: string | null;
  /** BUD-14 FR 8, AC3: the rule that set the tags («Застосовано правила: №…»); null — none. */
  readonly tagRuleId?: string | null;
}

/** A category as written: with the source «rule», the rule that set it (BUD-14 FR 13). */
export type NextCategory = TransactionCategory & { readonly ruleId?: string | null };

/** The transactions of the space as this module reads them (module transactions' `TransactionLookup`). */
export interface TransactionFactsPort {
  facts(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, CategorizableFacts>>;
}

/** The space's category tree (module categories' `CategoryDirectory`, FR 9). */
export interface CategoryFactsPort {
  category(householdId: string, categoryId: string): Promise<CategoryFacts | null>;
}

/** The categorization schema in one transaction of the module, bound to one space (adapters/db/store.ts). */
export interface CategorizationTx {
  /** The row of the transaction, locked for this transaction; null — none yet. */
  lock(householdId: string, transactionId: string): Promise<StoredTransactionCategory | null>;
  read(householdId: string, ids: readonly string[]): Promise<ReadonlyMap<string, StoredTransactionCategory>>;
  /** A new row at version 1; false if another writer inserted it first. */
  insert(householdId: string, transactionId: string, next: NextCategory): Promise<boolean>;
  /** The locked row's next version. */
  update(householdId: string, transactionId: string, next: NextCategory, version: number): Promise<void>;
  /** The rows that have any of `categoryIds`: transaction id → category id. */
  withCategories(householdId: string, categoryIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** FR 8: every row of `sourceId` takes `targetId`; returns how many. */
  move(householdId: string, sourceId: string, targetId: string): Promise<number>;
  enqueueHandOff(householdId: string, handOff: CategoryHandOff): Promise<void>;
  /** BUD-14 FR 8: the rule that set the transaction's tags (a row is made if none), without a new version. */
  setTagRule(householdId: string, transactionId: string, ruleId: string | null): Promise<void>;
}

export type WriteOutcome =
  | {
      readonly kind: "changed";
      readonly row: StoredTransactionCategory;
      readonly before: TransactionCategory;
    }
  | { readonly kind: "unchanged"; readonly row: StoredTransactionCategory }
  | { readonly kind: "conflict" };

const same = (a: TransactionCategory, b: TransactionCategory) =>
  a.categoryId === b.categoryId && a.source === b.source;

/**
 * Writes `next` as the transaction's category under the row's lock. With `expectedVersion` (a bulk action, DAT-03
 * FR 5) only if the row is still at that version (0 — no row); otherwise a `conflict`.
 */
export async function writeCategory(
  tx: CategorizationTx,
  householdId: string,
  transactionId: string,
  next: NextCategory,
  expectedVersion?: number,
): Promise<WriteOutcome> {
  const current = await tx.lock(householdId, transactionId);
  const version = current?.version ?? 0;
  if (expectedVersion !== undefined && expectedVersion !== version) return { kind: "conflict" };
  const before: TransactionCategory = current ?? UNCATEGORIZED;
  const unchangedRow = current ?? { transactionId, ...UNCATEGORIZED, version: 0, ruleId: null };
  if (same(before, next)) return { kind: "unchanged", row: unchangedRow };
  if (current === null) {
    if (!(await tx.insert(householdId, transactionId, next))) return { kind: "conflict" };
  } else await tx.update(householdId, transactionId, next, version + 1);
  const row = {
    transactionId,
    categoryId: next.categoryId,
    source: next.source,
    version: version + 1,
    ruleId: next.ruleId ?? null,
  };
  return { kind: "changed", row, before };
}

export type SetResult =
  | { readonly kind: "ok"; readonly row: StoredTransactionCategory; readonly handOff: CategoryHandOff | null }
  | { readonly kind: "not-found" }
  | { readonly kind: "refused"; readonly issue: CategorizableIssue }
  | { readonly kind: "invalid"; readonly field: "categoryId"; readonly issue: "not_found" }
  | { readonly kind: "conflict" };

export interface SetDeps {
  readonly transactions: TransactionFactsPort;
  readonly categories: CategoryFactsPort;
}

/** The checks of a user's change that read other modules — before the categorization transaction (ARC-04). */
export async function checkChange(
  deps: SetDeps,
  householdId: string,
  transactionId: string,
  categoryId: string | null,
): Promise<Exclude<SetResult, { kind: "ok" } | { kind: "conflict" }> | null> {
  const facts = (await deps.transactions.facts(householdId, [transactionId])).get(transactionId);
  if (!facts) return { kind: "not-found" };
  const issue = refusal(facts);
  if (issue !== null) return { kind: "refused", issue };
  if (categoryId !== null && !categoryAllowed(await deps.categories.category(householdId, categoryId)))
    return { kind: "invalid", field: "categoryId", issue: "not_found" };
  return null;
}

/**
 * FR 5, AC8: the user's change of one transaction's category in «Деталі транзакції» — «вручну»; null — «Без категорії»
 * (the source «немає»). Only this transaction changes. Writes the row and its hand-off (the audit entry, ADR-0015) in
 * the caller's categorization transaction; `checkChange` ran before it.
 */
export async function setCategory(
  tx: CategorizationTx,
  input: {
    readonly householdId: string;
    readonly actorAccountId: string;
    readonly transactionId: string;
    readonly categoryId: string | null;
  },
): Promise<SetResult> {
  const next: TransactionCategory =
    input.categoryId === null ? UNCATEGORIZED : { categoryId: input.categoryId, source: "manual" };
  const outcome = await writeCategory(tx, input.householdId, input.transactionId, next);
  if (outcome.kind === "conflict") return outcome;
  if (outcome.kind === "unchanged") return { kind: "ok", row: outcome.row, handOff: null };
  const handOff: CategoryHandOff = {
    transactionId: input.transactionId,
    actorAccountId: input.actorAccountId,
    version: outcome.row.version,
    before: { categoryId: outcome.before.categoryId, source: outcome.before.source },
    after: { categoryId: next.categoryId, source: next.source },
  };
  await tx.enqueueHandOff(input.householdId, handOff);
  return { kind: "ok", row: outcome.row, handOff };
}

/** The category of a transaction as shown: «Без категорії» without a row. */
export async function categoryOf(
  tx: CategorizationTx,
  householdId: string,
  transactionId: string,
): Promise<StoredTransactionCategory> {
  return (
    (await tx.read(householdId, [transactionId])).get(transactionId) ?? {
      transactionId,
      ...UNCATEGORIZED,
      version: 0,
      ruleId: null,
    }
  );
}

/**
 * FR 8 («Категорію об'єднано»): the transactions of the merged category take the target, keeping their source. Run by
 * the job of the event; running it again moves nothing more. The target is where the source points now: a later merge
 * of the target re-points the source (module categories), and this job may run after that merge's own job (a retry,
 * a dead job put back by the daily recovery), which then moved nothing of the source.
 */
export async function applyMerge(
  tx: CategorizationTx,
  categories: CategoryFactsPort,
  householdId: string,
  event: { readonly sourceId: string; readonly targetId: string },
  rules?: { moveRules(householdId: string, sourceId: string, targetId: string): Promise<number> },
): Promise<number> {
  const source = await categories.category(householdId, event.sourceId);
  const target = source?.mergedInto ?? event.targetId;
  // BUD-14 FR 10: the rules of the merged category are rewritten to the target too
  // (`moveRulesToCategory`: under the rules lock, with an audit entry per rule).
  await rules?.moveRules(householdId, event.sourceId, target);
  return tx.move(householdId, event.sourceId, target);
}

/**
 * FR 12 («порожня» категорія): which of `ids` an existing transaction of the space has. A row of a transaction deleted
 * since (module transactions keeps no category) is not a use.
 */
export async function categoriesInUse(
  tx: CategorizationTx,
  transactions: TransactionFactsPort,
  householdId: string,
  ids: readonly string[],
): Promise<ReadonlySet<string>> {
  const rows = await tx.withCategories(householdId, ids);
  if (rows.size === 0) return new Set();
  const existing = await transactions.facts(householdId, [...rows.keys()]);
  const used = new Set<string>();
  for (const [transactionId, categoryId] of rows) if (existing.has(transactionId)) used.add(categoryId);
  return used;
}

export type { CategorySource };
