import { describe, expect, it } from "vitest";
import {
  CATEGORY_FILTER_MAX,
  categoryCondition,
  ownCategoryTransactions,
  takeCategoryFilters,
} from "./category-filter.ts";

/** Security review of PR #714: what the category filter asks of its two sources and what it lets into SQL. */
const SPACE = "6f1c1c2e-8b0a-4c47-9a4e-0f6a1d2b3c4d";
const A = "0b7e5a3c-1d2f-4e6a-8b9c-7d8e9f0a1b2c";
const B = "3c9d2e1f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("FIN-03@PoC FR 22 (security, PR 714): the category filter's sources and SQL", () => {
  it("FIN-03@PoC FR 22: both sources are asked for the caller's space only, with what is left of the request's bound + 1 as the limit, and the ids go as parameters", async () => {
    const asked: unknown[][] = [];
    const port = {
      withCategories: async (...args: unknown[]) => {
        asked.push(args);
        return [A];
      },
    };
    const own = await ownCategoryTransactions(port as never, SPACE, [[A], [A, B]]);
    // The bound is the request's: the second set is asked for what the first one left.
    expect(asked).toEqual([
      [SPACE, [A], CATEGORY_FILTER_MAX + 1],
      [SPACE, [A, B], CATEGORY_FILTER_MAX],
    ]);
    const sent: { text: string; values: readonly unknown[] }[] = [];
    const q = {
      query: async (text: string, values: readonly unknown[]) => {
        sent.push({ text: text.replace(/\s+/g, " ").trim(), values });
        return { rows: [{ id: B }] };
      },
    };
    const condition = await categoryCondition(q as never, SPACE, [[A], [A, B]], own);
    expect(sent.map((s) => s.values)).toEqual([
      [SPACE, [A], CATEGORY_FILTER_MAX + 1],
      [SPACE, [A, B], CATEGORY_FILTER_MAX],
    ]);
    for (const s of sent) {
      expect(s.text).toContain("WHERE household_id = $1 AND category_id = ANY($2::uuid[]) LIMIT $3::int");
      expect(s.text).not.toContain(A);
    }
    const built = condition!(7);
    expect(built.sql).toBe(
      `(("id" = ANY($7::uuid[]) AND NOT "is_split") OR ("id" = ANY($8::uuid[]) AND "is_split"))` +
        ` AND (("id" = ANY($9::uuid[]) AND NOT "is_split") OR ("id" = ANY($10::uuid[]) AND "is_split"))`,
    );
    expect(built.params).toEqual([[A], [B], [A], [B]]);
    // Only placeholders, column names and keywords: no value of the request or of a source.
    expect(built.sql.replace(/\$\d+::uuid\[\]/g, "")).toMatch(/^[ ()="A-Za-z_]+$/);
  });

  it.each([
    ["a quote", `category.eq:${A}' OR '1'='1`],
    ["a second statement", `category.eq:${A}; SELECT 1`],
    ["a line break", `category.eq:${A}\n`],
    ["a bracketed id", `category.in:{${A}}`],
    ["an empty item", `category.in:${A},,${B}`],
    ["a space", `category.eq: ${A}`],
    ["an array literal", `category.in:${A}}','{${B}`],
  ])(
    "FIN-03@PoC FR 22: %s in a category filter is refused before any query, without the value in the problem",
    (_name, filter) => {
      let thrown: unknown;
      try {
        takeCategoryFilters([filter]);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(JSON.stringify(thrown)).not.toContain(A);
    },
  );

  it.each([`Category.eq:${A}`, `category .eq:${A}`, `categoryId.eq:${A}`, `category.EQ:${A}`, `category.eq`])(
    "FIN-03@PoC FR 22: %s is not a category filter — it stays with the whitelisted filters, which refuse it",
    (filter) => {
      expect(takeCategoryFilters([filter])).toEqual({ rest: [filter], categories: [] });
    },
  );
});
