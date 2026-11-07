import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineListQuery, filterValue, type FilterCast } from "../src/platform/http/list-query.ts";
import { ApiProblem, problemBody } from "../src/platform/http/problem.ts";
import { createTestDatabase } from "./db.ts";

/**
 * Security review of PR #86, round 2 (NFR-15 FR 15): every value a strict `filterValue` helper accepts is one
 * its PostgreSQL column type can hold (so a filter never turns into a 500), and every value it refuses is
 * 400 VALIDATION_FAILED before any SQL, without the value in the answer.
 */
let db: { url: string; drop: () => Promise<void> };
let client: pg.Client;

const list = defineListQuery({
  filters: {
    small: { column: "c_int4", cast: "integer", value: filterValue.int4(), operators: ["eq"] },
    // Bounds wider than int4 must still be clamped to the column's range.
    wide: {
      column: "c_int4",
      cast: "integer",
      value: filterValue.int4({ min: -1e12, max: 1e12 }),
      operators: ["eq"],
    },
    big: { column: "c_int8", cast: "bigint", value: filterValue.int8(), operators: ["eq"] },
    amount: { column: "c_num", cast: "numeric", value: filterValue.decimal(), operators: ["eq"] },
    day: { column: "c_date", cast: "date", value: filterValue.isoDate(), operators: ["eq"] },
    at: { column: "c_ts", cast: "timestamptz", value: filterValue.timestamp(), operators: ["eq"] },
    ref: { column: "c_uuid", cast: "uuid", value: filterValue.uuid(), operators: ["eq"] },
    flag: { column: "c_bool", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
  },
  sorts: { small: "c_int4" },
  defaultSort: { field: "small", direction: "asc" },
});

const ACCEPTED: Record<string, string[]> = {
  small: ["0", "-0", "2147483647", "-2147483648"],
  wide: ["2147483647", "-2147483648"],
  big: ["0", "9223372036854775807", "-9223372036854775808"],
  amount: ["0", "-0", "99999999999999999999.999999999999999999", "-1.5"],
  day: ["0001-01-01", "2024-02-29", "9999-12-31"],
  at: ["0001-01-01T00:00:00Z", "2026-11-07T10:00:00.123456789+14:59", "9999-12-31T23:59:59-12:00"],
  ref: ["00000000-0000-0000-0000-000000000000", "5D2F3C1A-8B7E-4C6D-9A0B-1E2F3A4B5C6D"],
  flag: ["true", "false"],
};

const REFUSED: Record<string, string[]> = {
  small: ["", " 1", "+1", "007", "0x10", "1e3", "1.0", "2147483648", "-2147483649", "NaN", "Infinity"],
  wide: ["2147483648", "-2147483649", "9999999999"],
  big: ["01", "9223372036854775808", "-9223372036854775809", "+1", " 1", "0x10"],
  amount: ["", "1e5", ".5", "1.", "00.1", "123456789012345678901", "1.1234567890123456789", "NaN", "0x1"],
  day: ["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", "20260101", "-0001-01-01", "10000-01-01"],
  at: [
    "2026-01-01",
    "2026-01-01T00:00:00",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+1400",
    "now",
    "epoch",
    // Offsets PostgreSQL refuses (SQLSTATE 22009): must be a 400 before any SQL, never a 500.
    "2026-01-01T00:00:00+23:59",
    "2026-01-01T00:00:00-16:00",
  ],
  ref: ["", "{5d2f3c1a-8b7e-4c6d-9a0b-1e2f3a4b5c6d}", "5d2f3c1a8b7e4c6d9a0b1e2f3a4b5c6d", "zq-not-a-uuid"],
  flag: ["", "1", "0", "yes", "TRUE", "t", "on"],
};

/** Year 0 has no PostgreSQL date: `0000-01-01` is out of range there. */
const YEAR_ZERO: Record<string, string[]> = {
  day: ["0000-01-01", "0000-02-29"],
  at: ["0000-01-01T00:00:00Z", "0000-06-01T00:00:00+02:00"],
};

const run = async (field: string, value: string) => {
  const compiled = list.compile({ filter: [`${field}.eq:${value}`] }, 1);
  await client.query(`SELECT 1 FROM sec86r2_types WHERE ${compiled.where}`, [...compiled.params]);
};

const refusal = (field: string, value: string): ApiProblem => {
  try {
    list.compile({ filter: [`${field}.eq:${value}`] }, 1);
  } catch (error) {
    return error as ApiProblem;
  }
  throw new Error(`${field}=${JSON.stringify(value)} was accepted`);
};

beforeAll(async () => {
  db = await createTestDatabase();
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
  await client.query(`CREATE TABLE sec86r2_types (
    c_int4 integer, c_int8 bigint, c_num numeric(38, 18), c_date date, c_ts timestamptz, c_uuid uuid, c_bool boolean)`);
});

afterAll(async () => {
  await client?.end();
  await db?.drop();
});

describe("NFR-15 FR 15 (round 2): strict filter values against the real column types", () => {
  it("every accepted value runs on PostgreSQL without a database error", async () => {
    for (const [field, values] of Object.entries(ACCEPTED))
      for (const value of values)
        await expect(run(field, value), `${field}=${value}`).resolves.toBeUndefined();
  });

  it("a boolean filter is a real boolean parameter", () => {
    expect(list.compile({ filter: ["flag.eq:false"] }, 1).params).toEqual([false]);
  });

  it("every refused value is VALIDATION_FAILED before SQL, and the answer never repeats it", () => {
    for (const [field, values] of Object.entries(REFUSED))
      for (const value of values) {
        const problem = refusal(field, value);
        expect(problem, `${field}=${JSON.stringify(value)}`).toBeInstanceOf(ApiProblem);
        expect(problem.code).toBe("VALIDATION_FAILED");
        if (value.length > 4)
          expect(JSON.stringify(problemBody(problem.code, { errors: problem.errors }))).not.toContain(value);
      }
  });

  it("the declared casts include bigint (int8 columns)", () => {
    const cast: FilterCast = "bigint";
    expect(() =>
      defineListQuery({
        filters: { n: { column: "c_int8", cast, value: filterValue.int8(), operators: ["eq"] } },
        sorts: { n: "c_int8" },
        defaultSort: { field: "n", direction: "asc" },
      }),
    ).not.toThrow();
  });

  // Defect (round 2): z.iso.date() / z.iso.datetime() accept year 0000, which PostgreSQL's date and
  // timestamptz cannot hold (22008 «date/time field value out of range») — a 500 instead of a 400.
  it("a year-0000 date or timestamp is VALIDATION_FAILED, not a database error", async () => {
    for (const [field, values] of Object.entries(YEAR_ZERO))
      for (const value of values) {
        let problem: unknown;
        try {
          await run(field, value);
        } catch (error) {
          problem = error;
        }
        expect(problem, `${field}=${value}`).toBeInstanceOf(ApiProblem);
        expect((problem as ApiProblem).code).toBe("VALIDATION_FAILED");
      }
  });
});
