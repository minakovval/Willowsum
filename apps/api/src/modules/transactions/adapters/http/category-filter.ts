import { z } from "zod";
import type { ModuleQueryRunner } from "../../../../platform/db/module-db.ts";
import { TECHNICAL_LIMITS, requireWithinLimit } from "../../../../platform/http/limits.ts";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import type { ListCondition } from "../../../../platform/lists/list-engine.ts";
import { splitTransactionsIn } from "../db/store.ts";
import type { CategoryTransactions } from "./services.ts";

/**
 * FIN-03@PoC FR 22 «Категорії» of the list «Транзакції» (BUD-01@PoC AC 20, BUD-02@PoC AC 19: «Показати транзакції»
 * opens the list with «Категорія: <назва>»). On the wire like the other filters: `filter=category.eq:<id>` — the
 * category, `filter=category.in:<id>,<id>` — any of them (several «Категорії» ticked). The exact categories: a
 * category of another space or an unknown id matches nothing (200 and an empty page, as `accountId` of another space).
 *
 * A transaction is in a category the way the dialog «Видалити категорію…» counts it (BUD-02 FR 23): a transaction that
 * is not split by its own category (module categorization, through its port — no SQL across modules), a split one by
 * its parts (this module's `transaction_parts`), whatever its own category was before the split.
 *
 * Bounded (NFR-15 FR 17; security review of #714): at most `CATEGORY_FILTER_MAX` ids per request from each of the two
 * sources, all category filters of the request together (a filter repeated is read once); more is 422 LIMIT_REACHED,
 * never a partial list.
 */
export const CATEGORY_FILTER_MAX = 20_000;

const CATEGORY_RE = /^category\.([a-z]{2,6}):([\s\S]*)$/;
const categoryId = z.uuid();

function invalid(issue: string): never {
  // Like the list's own filters: where and what kind of problem, never the value sent.
  throw new ApiProblem("VALIDATION_FAILED", { errors: [{ in: "query", path: "filter", issue }] });
}

/** The request's filters without the category ones, and the categories of each category filter (ANDed). */
export function takeCategoryFilters(filter: readonly string[]): {
  readonly rest: string[];
  readonly categories: (readonly string[])[];
} {
  requireWithinLimit(filter.length, TECHNICAL_LIMITS.filtersPerRequest);
  const rest: string[] = [];
  const categories: string[][] = [];
  for (const item of filter) {
    const match = CATEGORY_RE.exec(item);
    if (!match) {
      rest.push(item);
      continue;
    }
    const [, op, text] = match as unknown as [string, string, string];
    if (op !== "eq" && op !== "in") invalid("unknown_filter");
    const values = op === "in" ? text.split(",") : [text];
    requireWithinLimit(values.length, TECHNICAL_LIMITS.filtersPerRequest);
    if (!values.every((v) => categoryId.safeParse(v).success)) invalid("invalid_value");
    // The same set twice adds nothing to an AND: read it once.
    const set = [...new Set(values.map((v) => v.toLowerCase()))].sort();
    if (!categories.some((c) => c.join() === set.join())) categories.push(set);
  }
  return { rest, categories };
}

/**
 * Step 1, before the list's own transaction: each category filter's transactions by their own category, from module
 * categorization's port. Empty without category filters.
 */
export async function ownCategoryTransactions(
  port: CategoryTransactions | null,
  householdId: string,
  categories: readonly (readonly string[])[],
): Promise<(readonly string[])[]> {
  if (categories.length === 0) return [];
  if (port === null) throw new ApiProblem("INTERNAL");
  const own: (readonly string[])[] = [];
  // The bound is the request's, not each filter's: all category filters together carry at most that many ids.
  let total = 0;
  for (const ids of categories) {
    const found = await port.withCategories(householdId, ids, CATEGORY_FILTER_MAX + 1 - total);
    total += found.length;
    requireWithinLimit(total, CATEGORY_FILTER_MAX);
    own.push(found);
  }
  return own;
}

/**
 * Step 2, in the list's transaction: per category filter, the unsplit transactions with the own category (`own`, step
 * 1) or the split ones with a part in it, both by primary key. Null without category filters.
 */
export async function categoryCondition(
  q: ModuleQueryRunner,
  householdId: string,
  categories: readonly (readonly string[])[],
  own: readonly (readonly string[])[],
): Promise<ListCondition | null> {
  if (categories.length === 0) return null;
  const sets: { own: readonly string[]; split: readonly string[] }[] = [];
  let total = 0;
  for (const [i, ids] of categories.entries()) {
    const split = await splitTransactionsIn(q, householdId, ids, CATEGORY_FILTER_MAX + 1 - total);
    total += split.length;
    requireWithinLimit(total, CATEGORY_FILTER_MAX);
    sets.push({ own: own[i] ?? [], split });
  }
  return (firstParam) => ({
    sql: sets
      .map(
        (_, i) =>
          `(("id" = ANY($${firstParam + 2 * i}::uuid[]) AND NOT "is_split")` +
          ` OR ("id" = ANY($${firstParam + 2 * i + 1}::uuid[]) AND "is_split"))`,
      )
      .join(" AND "),
    params: sets.flatMap((s) => [[...s.own], [...s.split]]),
  });
}
