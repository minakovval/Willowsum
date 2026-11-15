import {
  buildSplit,
  partCategoryKind,
  splitAuditFields,
  splitCategoryIds,
  type FieldIssue,
  type SplitInput,
} from "../domain/index.ts";
import {
  changeRow,
  type Caller,
  type TransactionResult,
  type TransactionsDeps,
  type TransactionsTx,
} from "./transactions.ts";

/**
 * «Розділити» and «Об'єднати назад» (BUD-01@PoC FR 6, BUD-13@PoC FR 6–8; FIN-03@PoC FR 23). The split is the budget's
 * view of the amount only: no new transaction, no journal entry, the balance unchanged. Saving a split again replaces
 * it and clears «потребує перегляду»; an empty «За категоріями» or «Об'єднати назад» removes it. A transfer between own
 * accounts is not split (BUD-01 FR 6, FIN-03 FR 18): «in-transfer», nothing written.
 */

/** The space's category tree as the split needs it (the categories module's public `CategoryDirectory`). */
export interface SplitCategories {
  category(
    householdId: string,
    categoryId: string,
  ): Promise<{ readonly kind: "expense" | "income" | "service"; readonly state: string } | null>;
}

export interface SplitDeps extends TransactionsDeps {
  readonly categories: SplitCategories;
}

/**
 * Checks each category once, before the change (outside the transactions transaction: no transactions connection waits
 * for the categories pool): of this space (else `not_found`, like an unknown one), in use (not merged away), not a
 * service category («Переказ», «Коригування»). Their kind against the amount's sign is checked under the row's lock.
 */
export async function splitCategoryKinds(
  deps: SplitDeps,
  householdId: string,
  input: SplitInput,
): Promise<Map<string, "expense" | "income"> | FieldIssue[]> {
  const kinds = new Map<string, "expense" | "income">();
  const issues: FieldIssue[] = [];
  for (const id of splitCategoryIds(input)) {
    const category = await deps.categories.category(householdId, id);
    if (!category || category.state === "retired" || category.kind === "service")
      issues.push({ field: fieldOf(input, id), issue: "not_found" });
    else kinds.set(id, category.kind);
  }
  return issues.length > 0 ? issues : kinds;
}

function fieldOf(input: SplitInput, categoryId: string): string {
  if (input.mode === "months") return "categoryId";
  return `parts.${input.parts.findIndex((p) => p.categoryId === categoryId)}.categoryId`;
}

/** «Зберегти» of «Розділити транзакцію»: the parts against the transaction's amount as it is now (under its lock). */
export async function setSplit(
  deps: SplitDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
  input: SplitInput,
  kinds: ReadonlyMap<string, "expense" | "income">,
): Promise<TransactionResult> {
  return changeRow(deps, tx, caller, id, "split", (current) => {
    if (current.transfer) return "in-transfer";
    const built = buildSplit(current.amount, input);
    if ("problems" in built) return built.problems;
    if (built.split === null) return current.split === null ? null : { ...current, split: null };
    const kind = partCategoryKind(current.amount);
    const wrong = splitCategoryIds(input).filter((c) => kinds.get(c) !== kind);
    if (wrong.length > 0)
      return wrong.map((c) => ({ field: fieldOf(input, c), issue: "kind_mismatch" as const }));
    const split = { ...built.split, needsReview: false };
    // The same split saved again (and not waiting for review) changes nothing.
    const same = (a: Map<string, string>, b: Map<string, string>) =>
      a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
    if (same(splitAuditFields(current.split), splitAuditFields(split))) return null;
    return { ...current, split };
  });
}

/** «Об'єднати назад» (BUD-13 FR 8): the transaction is whole again; without a split nothing changes. */
export async function removeSplit(
  deps: TransactionsDeps,
  tx: TransactionsTx,
  caller: Caller,
  id: string,
): Promise<TransactionResult> {
  return changeRow(deps, tx, caller, id, "split", (current) =>
    current.split === null ? null : { ...current, split: null },
  );
}
