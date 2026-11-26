import { describe, expect, it } from "vitest";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import { filterValue } from "../http/list-query.ts";
import { defineList, type ListSpec } from "./list-engine.ts";

/** Security review of PR #714: the list engine's extra `condition` never widens the household-scoped WHERE. */
const HOUSEHOLD = "6a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const ID = "0b7e5a3c-1d2f-4e6a-8b9c-7d8e9f0a1b2c";

const spec: ListSpec = {
  table: "entries",
  select: { id: "entry_id", bookedOn: "booked_on", amount: "amount", currency: "currency" },
  tieBreaker: "entry_id",
  filters: {
    bookedOn: { column: "booked_on", cast: "date", value: filterValue.isoDate(), operators: ["gte", "lte"] },
  },
  sorts: { bookedOn: "booked_on" },
  defaultSort: { field: "bookedOn", direction: "desc" },
  amounts: { amountColumn: "amount", currencyColumn: "currency", rateDate: { column: "booked_on" } },
};

function recorder() {
  const sent: { text: string; values: readonly unknown[] }[] = [];
  const q: HouseholdQueryRunner = {
    householdId: HOUSEHOLD,
    query: (async (text: string, values: readonly unknown[] = []) => {
      if (text.includes("pg_catalog.pg_index"))
        return { rows: [{ found: true, unique_tie: true, date_type: "date not null" }] };
      sent.push({ text: text.replace(/\s+/g, " ").trim(), values });
      return { rows: [] };
    }) as HouseholdQueryRunner["query"],
  };
  return { q, sent };
}

describe("FIN-03@PoC FR 22 «Права доступу» (security, PR 714): the list's extra condition", () => {
  it("FIN-03@PoC FR 22: the condition is ANDed, in brackets, after the household and the filters, in the totals and in the page; its placeholders follow the filters' and precede LIMIT/OFFSET", async () => {
    const { q, sent } = recorder();
    const seen: number[] = [];
    await defineList(spec).run(q, {
      filter: ["bookedOn.gte:2026-10-01"],
      condition: (first) => {
        seen.push(first);
        return {
          sql: `"entry_id" = ANY($${first}::uuid[]) OR "entry_id" = ANY($${first + 1}::uuid[])`,
          params: [[ID], []],
        };
      },
    });
    expect(seen).toEqual([3]);
    const where =
      `WHERE "household_id" = $1::uuid AND ("booked_on" >= $2::date)` +
      ` AND ("entry_id" = ANY($3::uuid[]) OR "entry_id" = ANY($4::uuid[]))`;
    const [totals, page] = sent as [(typeof sent)[0], (typeof sent)[0]];
    expect(sent).toHaveLength(2);
    expect(totals.text).toContain(`${where} GROUP BY`);
    expect(page.text).toContain(`${where} ORDER BY`);
    expect(page.text).toContain(`LIMIT $5::int OFFSET $6::int`);
    expect(totals.values).toEqual([HOUSEHOLD, "2026-10-01", [ID], []]);
    expect(page.values).toEqual([HOUSEHOLD, "2026-10-01", [ID], [], 25, 0]);
  });

  it("FIN-03@PoC FR 22: without filters the condition starts at $2 and the household stays the first conjunct", async () => {
    const { q, sent } = recorder();
    await defineList(spec).run(q, {
      condition: (first) => ({ sql: `"entry_id" = ANY($${first}::uuid[])`, params: [[ID]] }),
    });
    expect(sent).toHaveLength(2);
    for (const s of sent) {
      expect(s.text).toMatch(
        /WHERE "household_id" = \$1::uuid AND \(.*\) AND \("entry_id" = ANY\(\$2::uuid\[\]\)\)/,
      );
      expect(s.values.slice(0, 2)).toEqual([HOUSEHOLD, [ID]]);
    }
  });
});
