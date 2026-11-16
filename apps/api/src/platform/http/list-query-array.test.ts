import { describe, expect, it } from "vitest";
import { defineListQuery, filterValue } from "./list-query.ts";

/** BUD-13@PoC FR 2 (the filter «Теги»): a whitelisted filter over an array column, by containment only. */
describe("list query: a filter over an array column", () => {
  const spec = (operators: ("eq" | "in" | "gte" | "empty")[]) => ({
    filters: {
      tag: {
        column: "tag_ids",
        cast: "uuid" as const,
        value: filterValue.uuid(),
        operators,
        array: true as const,
      },
    },
    sorts: { date: "occurred_on" },
    defaultSort: { field: "date", direction: "desc" as const },
  });
  const id = "11111111-1111-4111-8111-111111111111";

  it("BUD-13@PoC FR 2: `eq` is containment, `in` an overlap, `empty` no element — the value a parameter", () => {
    const list = defineListQuery(spec(["eq", "in", "empty"]));
    expect(list.compile({ filter: `tag.eq:${id}` }, 1)).toMatchObject({
      where: `"tag_ids" @> ARRAY[$1::uuid]`,
      params: [id],
    });
    expect(list.compile({ filter: `tag.in:${id},${id}` }, 3).where).toBe(`"tag_ids" && $3::uuid[]`);
    expect(list.compile({ filter: "tag.empty:" }, 1).where).toBe(`coalesce(cardinality("tag_ids"), 0) = 0`);
    expect(() => list.compile({ filter: "tag.eq:x" }, 1)).toThrow();
  });

  it("BUD-13@PoC FR 2: an array filter takes no comparison", () => {
    expect(() => defineListQuery(spec(["gte"]))).toThrow(/array/);
  });
});
