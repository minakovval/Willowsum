import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import type { ApiProblem } from "../http/problem.ts";
import { defineListQuery, filterValue } from "../http/list-query.ts";
import { LIST_PAGE_QUERY, LIST_PAGE_SIZES, defineList, type ListSpec } from "./list-engine.ts";

/** DAT-01@PoC: the list engine without a database — the SQL it sends and what it refuses. */
const HOUSEHOLD = "6a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

const spec: ListSpec = {
  table: "entries",
  select: { id: "entry_id", bookedOn: "booked_on", amount: "amount", currency: "currency" },
  tieBreaker: "entry_id",
  filters: {
    bookedOn: { column: "booked_on", cast: "date", value: filterValue.isoDate(), operators: ["gte", "lte"] },
    description: {
      column: "description",
      cast: "text",
      value: z.string().max(200),
      operators: ["has", "empty"],
    },
    vintage: {
      column: "attributes",
      attribute: "vintage",
      cast: "text",
      value: z.string().max(20),
      operators: ["eq", "empty", "nempty"],
    },
  },
  sorts: { bookedOn: "booked_on", amount: "amount" },
  defaultSort: { field: "bookedOn", direction: "desc" },
  amounts: { amountColumn: "amount", currencyColumn: "currency", rateDate: { column: "booked_on" } },
};

const SCHEMA_OK = { found: true, unique_tie: true, date_type: "date not null" };

/** Records the list's queries; the one-time schema check is answered with `schema` and kept apart in `checks`. */
function recorder(rows: { groups?: unknown[]; items?: unknown[]; schema?: object } = {}) {
  const sent: { text: string; values: readonly unknown[] }[] = [];
  const checks: { text: string; values: readonly unknown[] }[] = [];
  const q: HouseholdQueryRunner = {
    householdId: HOUSEHOLD,
    query: (async (text: string, values: readonly unknown[] = []) => {
      if (text.includes("pg_catalog.pg_index")) {
        checks.push({ text, values });
        return { rows: [rows.schema ?? SCHEMA_OK] };
      }
      sent.push({ text: text.replace(/\s+/g, " ").trim(), values });
      return { rows: text.includes("GROUP BY") ? (rows.groups ?? []) : (rows.items ?? []) };
    }) as HouseholdQueryRunner["query"],
  };
  return { q, sent, checks };
}

function problemOf(promise: Promise<unknown>): Promise<ApiProblem> {
  return promise.then(
    () => {
      throw new Error("expected a problem");
    },
    (e: unknown) => e as ApiProblem,
  );
}

describe("DAT-01@PoC FR 6: server-side pages of 25, 50 or 100 records", () => {
  it("DAT-01@PoC FR 6: offers exactly 25, 50 and 100; 25 by default; page N is OFFSET (N−1)·size", async () => {
    expect(LIST_PAGE_SIZES).toEqual([25, 50, 100]);
    const { q, sent } = recorder();
    const first = await defineList(spec).run(q, {});
    expect(first).toMatchObject({ page: 1, pageSize: 25, count: 0, from: 0, to: 0, items: [] });
    expect(sent.at(-1)!.values.slice(-2)).toEqual([25, 0]);
    await defineList(spec).run(q, { page: 4, pageSize: 50 });
    expect(sent.at(-1)!.values.slice(-2)).toEqual([50, 150]);
  });

  it.each([10, 30, 101, 0, 1000])("DAT-01@PoC FR 6: page size %d is 400 VALIDATION_FAILED", async (size) => {
    const problem = await problemOf(defineList(spec).run(recorder().q, { pageSize: size }));
    expect(problem.code).toBe("VALIDATION_FAILED");
  });

  it.each([0, -1, 1.5, 100_001, Number.NaN])(
    "DAT-01@PoC FR 6: page %d is 400 VALIDATION_FAILED",
    async (page) => {
      const problem = await problemOf(defineList(spec).run(recorder().q, { page }));
      expect(problem.code).toBe("VALIDATION_FAILED");
    },
  );

  it("DAT-01@PoC FR 6: the query fields accept only the page sizes of the list", () => {
    const query = z.object(LIST_PAGE_QUERY);
    expect(query.parse({ page: "4", pageSize: "100" })).toEqual({ page: 4, pageSize: 100 });
    for (const bad of [
      { pageSize: "20" },
      { pageSize: "25.0" },
      { page: "0" },
      { page: "1e3" },
      { page: "-1" },
    ])
      expect(query.safeParse(bad).success).toBe(false);
  });
});

describe("DAT-01@PoC FR 4, FR 9: whitelisted conditions, the same for the page, the count and the totals", () => {
  it("DAT-01@PoC FR 9: rows, count and sums share one WHERE with the household and the filters as parameters", async () => {
    const { q, sent } = recorder({
      groups: [{ currency: "EUR", date: "2026-11-03", sum: "-100.000000000000000000", count: 1 }],
    });
    const result = await defineList(spec).run(q, {
      filter: ["bookedOn.gte:2026-10-01", "description.has:50%_off"],
      sort: "-amount",
    });
    expect(result.count).toBe(1);
    expect(result.groups[0]!.sum.toDecimalString()).toBe("-100");
    const [totals, page] = sent as [(typeof sent)[0], (typeof sent)[0]];
    const where = `"household_id" = $1::uuid AND ("booked_on" >= $2::date AND "description" ILIKE $3::text ESCAPE '\\')`;
    expect(totals.text).toContain(`WHERE ${where} GROUP BY 1, 2`);
    expect(page.text).toContain(
      `WHERE ${where} ORDER BY "amount" DESC, "entry_id" ASC LIMIT $4::int OFFSET $5::int`,
    );
    expect(totals.values).toEqual([HOUSEHOLD, "2026-10-01", "%50\\%\\_off%"]);
    expect(page.values).toEqual([HOUSEHOLD, "2026-10-01", "%50\\%\\_off%", 25, 0]);
  });

  it("DAT-01@PoC EC1: a type attribute is a key of the JSONB column, passed as a parameter; «порожнє» covers records without it", async () => {
    const { q, sent } = recorder();
    await defineList(spec).run(q, { filter: ["vintage.empty:"] });
    expect(sent[0]!.text).toContain(
      `("attributes" ->> $2::text) IS NULL OR ("attributes" ->> $2::text) = ''`,
    );
    expect(sent[0]!.values).toEqual([HOUSEHOLD, "vintage"]);
    await defineList(spec).run(q, { filter: ["vintage.nempty:", "vintage.eq:2015"] });
    expect(sent.at(-1)!.values).toEqual([HOUSEHOLD, "vintage", "vintage", "2015", 25, 0]);
  });

  it.each([
    ["an undeclared filter", { filter: "household.eq:x" }],
    ["an operator the field does not allow", { filter: "bookedOn.has:2026" }],
    ["a value for «порожнє»", { filter: "vintage.empty:1999" }],
    ["an empty «містить»", { filter: "description.has:" }],
    ["an undeclared sort", { sort: "household_id" }],
    ["an injection in the sort", { sort: "amount; DROP TABLE entries" }],
  ])("DAT-01@PoC FR 4: %s is 400 VALIDATION_FAILED and sends no SQL", async (_what, request) => {
    const { q, sent } = recorder();
    expect((await problemOf(defineList(spec).run(q, request))).code).toBe("VALIDATION_FAILED");
    expect(sent).toEqual([]);
  });

  it("DAT-01@PoC FR 4: a declaration with an unsafe table, column, attribute or text operator is refused", () => {
    expect(() => defineList({ ...spec, table: "entries; drop" })).toThrow();
    expect(() => defineList({ ...spec, tieBreaker: 'id"' })).toThrow();
    expect(() => defineList({ ...spec, select: { id: "entry_id) --" } })).toThrow();
    expect(() =>
      defineList({ ...spec, amounts: { ...spec.amounts!, rateDate: { column: "x y" } } }),
    ).toThrow();
    const field = {
      column: "attributes",
      cast: "text" as const,
      value: z.string(),
      operators: ["eq" as const],
    };
    const sorts = { a: "a" };
    const defaultSort = { field: "a", direction: "asc" as const };
    expect(() =>
      defineListQuery({ filters: { x: { ...field, attribute: "a'b" } }, sorts, defaultSort }),
    ).toThrow();
    expect(() =>
      defineListQuery({ filters: { x: { ...field, attribute: "a", cast: "date" } }, sorts, defaultSort }),
    ).toThrow();
    expect(() =>
      defineListQuery({
        filters: { x: { ...field, column: "n", cast: "integer", operators: ["has"] } },
        sorts,
        defaultSort,
      }),
    ).toThrow();
  });

  it("DAT-01@PoC FR 12: balances (no date column) group by currency only, at today's rate", async () => {
    const { q, sent } = recorder();
    await defineList({ ...spec, amounts: { ...spec.amounts!, rateDate: "today" } }).run(q, {});
    expect(sent[0]!.text).toContain(`"currency"::text AS currency, NULL::text AS date`);
  });

  it("DAT-01@PoC FR 4: a list without amounts counts without grouping", async () => {
    const plain = Object.fromEntries(
      Object.entries(spec).filter(([k]) => k !== "amounts"),
    ) as unknown as ListSpec;
    const { q, sent } = recorder({ items: [{ count: 7 }] });
    await defineList(plain).run(q, {});
    expect(sent[0]!.text).toMatch(/^SELECT count\(\*\)::int AS count FROM "entries" WHERE/);
  });
});

describe("DAT-01@PoC FR 6, FR 12: the declaration is checked against the table (security review of #129)", () => {
  it("DAT-01@PoC FR 6: checks the table once, with the tie-breaker and the rate-date column as parameters", async () => {
    const { q, checks } = recorder();
    const list = defineList(spec);
    await list.run(q, {});
    await list.run(q, { page: 2 });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.values).toEqual(["entries", "entry_id", "booked_on"]);
  });

  it.each([
    ["a tie-breaker without a unique key", { unique_tie: false }, /tie-breaker entry_id/],
    ["a timestamptz rate-date column", { date_type: "timestamp with time zone not null" }, /rate-date/],
    ["a nullable rate-date column", { date_type: "date" }, /rate-date/],
    ["a missing rate-date column", { date_type: null }, /rate-date/],
    ["a missing table", { found: false }, /not found/],
  ])("DAT-01@PoC FR 6, FR 12: %s is refused before any list query", async (_what, schema, message) => {
    const { q, sent } = recorder({ schema: { ...SCHEMA_OK, ...schema } });
    await expect(defineList(spec).run(q, {})).rejects.toThrow(message);
    expect(sent).toEqual([]);
  });

  it("DAT-01@PoC FR 12: balances at today's rate need no rate-date column", async () => {
    const { q, checks } = recorder({ schema: { ...SCHEMA_OK, date_type: null } });
    await defineList({ ...spec, amounts: { ...spec.amounts!, rateDate: "today" } }).run(q, {});
    expect(checks[0]!.values).toEqual(["entries", "entry_id", ""]);
  });

  it("DAT-01@PoC FR 12: a group without a rate date is refused, never converted at today's rate", async () => {
    const { q } = recorder({ groups: [{ currency: "UAH", date: null, sum: "-1.00", count: 1 }] });
    await expect(defineList(spec).run(q, {})).rejects.toThrow("no rate date");
  });
});
