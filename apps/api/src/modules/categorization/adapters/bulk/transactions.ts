import { z } from "zod";
import type { ModuleDatabase } from "../../../../platform/db/module-db.ts";
import type {
  BulkActionHandler,
  BulkRecord,
  BulkTarget,
  BulkValues,
  PlannedChange,
} from "../../../bulk-actions/index.ts";
import type { TransactionLookup } from "../../../transactions/index.ts";
import {
  writeCategory,
  type CategoryFactsPort,
  type StoredTransactionCategory,
} from "../../application/index.ts";
import {
  CATEGORY_SOURCES,
  categoryAllowed,
  refusal,
  UNCATEGORIZED,
  type CategorySource,
  type TransactionCategory,
} from "../../domain/index.ts";
import { categorizationTx } from "../db/store.ts";

/**
 * DAT-03@PoC FR 2, AC1 (#272 item 1): «Змінити категорію» of the selection panel of «Транзакції». The target is the
 * entity «transactions» — the records of module transactions, read through its public `TransactionLookup` (the list's
 * filter and which transactions exist) — with this module's fields: the category and its source (BUD-01 FR 4). A record
 * of another space, or any record for a scoped member («Транзакції» are closed to them, 00-general «Область
 * доступу»), is absent. A write follows the rules of one change (FR 5): a transfer side, a split transaction or a merged
 * duplicate is refused, the category must be of the space's tree (BUD-01 FR 9); it writes no audit entry of its own
 * (the action's group entry holds the change, DAT-03 FR 11).
 */
export const TRANSACTIONS_ENTITY = "transactions";
export const SET_CATEGORY_ACTION = "transactions.set-category";

const FIELD_CATEGORY = "category";
const FIELD_SOURCE = "source";

const valuesOf = (row: TransactionCategory): BulkValues => ({
  [FIELD_CATEGORY]: row.categoryId,
  [FIELD_SOURCE]: row.source,
});

/** Values a write may take: a category and its source, or none and «немає» (an undo restores either). */
function parseValues(values: BulkValues): TransactionCategory | null {
  const categoryId = values[FIELD_CATEGORY] ?? null;
  const source = values[FIELD_SOURCE] ?? (categoryId === null ? "none" : "manual");
  if (!(CATEGORY_SOURCES as readonly string[]).includes(source)) return null;
  if ((categoryId === null) !== (source === "none")) return null;
  if (categoryId !== null && !z.uuid().safeParse(categoryId).success) return null;
  return { categoryId, source: source as CategorySource };
}

export function transactionsCategoryTarget(deps: {
  readonly db: ModuleDatabase;
  readonly transactions: TransactionLookup;
  readonly categories: CategoryFactsPort;
}): BulkTarget {
  return {
    entity: TRANSACTIONS_ENTITY,
    async select(caller, filter, excluded, limit) {
      if (caller.scoped) return { ids: [], count: 0 };
      return deps.transactions.select(caller.householdId, filter, excluded, limit);
    },
    async read(caller, ids) {
      const out = new Map<string, BulkRecord>();
      if (caller.scoped || ids.length === 0) return out;
      const existing = await deps.transactions.facts(caller.householdId, ids);
      const visible = ids.filter((id) => existing.has(id));
      const rows = await deps.db.inHousehold(caller.householdId, (q) =>
        categorizationTx(q).read(caller.householdId, visible),
      );
      for (const id of visible) {
        const row: StoredTransactionCategory = rows.get(id) ?? {
          transactionId: id,
          ...UNCATEGORIZED,
          version: 0,
          ruleId: null,
        };
        out.set(id, { id, version: row.version, values: valuesOf(row) });
      }
      return out;
    },
    async write(caller, id, expectedVersion, values) {
      if (caller.scoped) return { kind: "unavailable" };
      const next = parseValues(values);
      if (next === null) return { kind: "invalid", issue: "category.invalid" };
      const facts = (await deps.transactions.facts(caller.householdId, [id])).get(id);
      if (!facts) return { kind: "unavailable" };
      const issue = refusal(facts);
      if (issue !== null) return { kind: "invalid", issue: `transaction.${issue}` };
      if (
        next.categoryId !== null &&
        !categoryAllowed(await deps.categories.category(caller.householdId, next.categoryId))
      )
        return { kind: "invalid", issue: "category.not_found" };
      const outcome = await deps.db.inHousehold(caller.householdId, (q) =>
        writeCategory(categorizationTx(q), caller.householdId, id, next, expectedVersion),
      );
      if (outcome.kind === "conflict") return { kind: "conflict" };
      return { kind: "changed", version: outcome.row.version };
    },
  };
}

/**
 * «Змінити категорію» (DAT-03 FR 2, AC1): the chosen category «вручну» for every selected transaction; one that already
 * has it «вручну» is «без змін» (the same category from a rule, a merchant or the bank becomes «вручну», as in a single change); a transfer side, a split transaction or a merged duplicate is «невалідний». A category outside
 * the space's tree (BUD-01 FR 9) makes every record «невалідний».
 */
export function setCategoryAction(deps: {
  readonly transactions: Pick<TransactionLookup, "facts">;
  readonly categories: CategoryFactsPort;
}): BulkActionHandler {
  return {
    name: SET_CATEGORY_ACTION,
    entity: TRANSACTIONS_ENTITY,
    params: z.strictObject({ categoryId: z.uuid() }),
    async plan(caller, records, params) {
      const { categoryId } = params as { categoryId: string };
      const plans = new Map<string, PlannedChange>();
      if (!categoryAllowed(await deps.categories.category(caller.householdId, categoryId))) {
        for (const r of records) plans.set(r.id, { kind: "invalid", issue: "category.not_found" });
        return plans;
      }
      const facts = await deps.transactions.facts(
        caller.householdId,
        records.map((r) => r.id),
      );
      for (const r of records) {
        const f = facts.get(r.id);
        const issue = f ? refusal(f) : null;
        if (issue !== null) plans.set(r.id, { kind: "invalid", issue: `transaction.${issue}` });
        // As a single change (FR 5): the same category from a rule, a merchant or the bank still becomes «вручну».
        else if (r.values[FIELD_CATEGORY] === categoryId && r.values[FIELD_SOURCE] === "manual")
          plans.set(r.id, { kind: "unchanged" });
        else plans.set(r.id, { kind: "change", after: valuesOf({ categoryId, source: "manual" }) });
      }
      return plans;
    },
  };
}
