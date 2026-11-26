import { describe, expect, it } from "vitest";
import { ApiProblem } from "../../../../platform/http/problem.ts";
import { categoryCondition, ownCategoryTransactions, takeCategoryFilters } from "./category-filter.ts";

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
    expect(taken.categories).toEqual([[A], [A, B]]);
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
