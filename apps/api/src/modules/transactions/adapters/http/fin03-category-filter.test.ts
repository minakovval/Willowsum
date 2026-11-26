import { describe, expect, it } from "vitest";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import {
  CATEGORY_FILTER_MAX,
  categoryCondition,
  ownCategoryTransactions,
  takeCategoryFilters,
} from "./category-filter.ts";

const A = "6f1c1c2e-8b0a-4c47-9a4e-0f6a1d2b3c4d";
const B = "0b7e5a3c-1d2f-4e6a-8b9c-7d8e9f0a1b2c";

function problem(fn: () => unknown): ApiProblem {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiProblem) return error;
    throw error;
  }
  throw new Error("no problem thrown");
}

describe("FIN-03@PoC FR 22 «Категорії»: the category filters of the list «Транзакції»", () => {
  it("FIN-03@PoC FR 22: `category.eq` and `category.in` are taken out of the whitelisted filters, each as its own set", () => {
    const taken = takeCategoryFilters([
      `accountId.eq:${A}`,
      `category.eq:${A}`,
      `category.in:${A},${B},${A.toUpperCase()}`,
      "hidden.eq:false",
    ]);
    expect(taken.rest).toEqual([`accountId.eq:${A}`, "hidden.eq:false"]);
    // Each set in id order (B sorts before A), so the same set written another way is the same set.
    expect(taken.categories).toEqual([[A], [B, A]]);
  });

  it("FIN-03@PoC FR 22 (security review of #714): a category filter repeated, or the same set in another order or case, is read once; repeated ids in one filter count once", () => {
    const taken = takeCategoryFilters([
      ...Array.from({ length: 30 }, () => `category.eq:${A}`),
      `category.in:${A},${B}`,
      `category.in:${B},${A.toUpperCase()},${B}`,
      `category.in:${A},${A}`,
    ]);
    expect(taken.rest).toEqual([]);
    expect(taken.categories).toEqual([[A], [B, A]]);
  });

  it("FIN-03@PoC FR 22 (security review of #714): only the same set is read once — two different sets that share an id stay two filters, in any order", () => {
    // B sorts before A, so both sets below start with B: the dedupe must compare the whole set.
    expect(takeCategoryFilters([`category.in:${A},${B}`, `category.eq:${B}`]).categories).toEqual([
      [B, A],
      [B],
    ]);
    expect(takeCategoryFilters([`category.eq:${B}`, `category.in:${A},${B}`]).categories).toEqual([
      [B],
      [B, A],
    ]);
    expect(takeCategoryFilters([`category.eq:${A}`, `category.eq:${B}`]).categories).toEqual([[A], [B]]);
  });

  it("FIN-03@PoC FR 22 (security review of #714): the bound is the request's — two filters of 15 000 each are 422, each source is asked only for what is left", async () => {
    const asked: number[] = [];
    const port = {
      withCategories: async (_h: string, _ids: readonly string[], limit: number) => {
        asked.push(limit);
        return Array.from({ length: Math.min(15_000, limit) }, () => A);
      },
    };
    const refused = await ownCategoryTransactions(port, A, [[A], [B]]).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: "LIMIT_REACHED" });
    expect(asked).toEqual([CATEGORY_FILTER_MAX + 1, CATEGORY_FILTER_MAX + 1 - 15_000]);
    const sent: unknown[] = [];
    const q = {
      query: async (_text: string, values: readonly unknown[]) => {
        sent.push(values[2]);
        return { rows: Array.from({ length: Math.min(15_000, Number(values[2])) }, () => ({ id: B })) };
      },
    } as never;
    const parts = await categoryCondition(q, A, [[A], [B]], [[], []]).catch((e: unknown) => e);
    expect(parts).toMatchObject({ code: "LIMIT_REACHED" });
    expect(sent).toEqual([CATEGORY_FILTER_MAX + 1, CATEGORY_FILTER_MAX + 1 - 15_000]);
  });

  it("FIN-03@PoC FR 22: a value that is not an id is invalid_value; another operator is unknown_filter; more than 50 values is 422", () => {
    expect(problem(() => takeCategoryFilters(["category.eq:Кава"])).code).toBe("VALIDATION_FAILED");
    expect(problem(() => takeCategoryFilters([`category.ne:${A}`])).code).toBe("VALIDATION_FAILED");
    expect(problem(() => takeCategoryFilters([`category.in:${A},`])).code).toBe("VALIDATION_FAILED");
    const many = Array.from({ length: 51 }, () => A).join(",");
    expect(problem(() => takeCategoryFilters([`category.in:${many}`])).code).toBe("LIMIT_REACHED");
  });

  it("FIN-03@PoC FR 22: without category filters nothing is read and no condition is added; unwired, the filter is 500", async () => {
    expect(await ownCategoryTransactions(null, A, [])).toEqual([]);
    const q = { query: () => Promise.reject(new Error("no query expected")) } as never;
    expect(await categoryCondition(q, A, [], [])).toBeNull();
    await expect(ownCategoryTransactions(null, A, [[B]])).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("FIN-03@PoC FR 22: the condition numbers its placeholders from the list's next one — own ids unsplit, part ids split", async () => {
    const q = { query: async () => ({ rows: [{ id: B }] }) } as never;
    const condition = await categoryCondition(q, A, [[A]], [[A]]);
    const built = condition!(4);
    expect(built.sql).toBe(
      `(("id" = ANY($4::uuid[]) AND NOT "is_split") OR ("id" = ANY($5::uuid[]) AND "is_split"))`,
    );
    expect(built.params).toEqual([[A], [B]]);
  });
});
