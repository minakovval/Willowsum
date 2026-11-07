import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { HouseholdQueryRunner } from "../db/module-db.ts";
import {
  clearedSessionCookie,
  cookieContext,
  readSessionCookie,
  sessionCookie,
  SECURE_COOKIE_PREFIX,
} from "./cookies.ts";
import { API_BODY_LIMIT_BYTES, requireWithinLimit, TECHNICAL_LIMITS } from "./limits.ts";
import { defineListQuery, filterValue } from "./list-query.ts";
import { PAGE_MAX_LIMIT } from "./pagination.ts";
import { ApiProblem, problemBody, ProblemSchema } from "./problem.ts";
import { defineRoute } from "./route.ts";
import { defineVersionedTable, updateVersioned } from "./versioned.ts";

function problemOf(fn: () => unknown): ApiProblem {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiProblem) return error;
    throw error;
  }
  throw new Error("expected an ApiProblem");
}

async function asyncProblemOf(fn: () => Promise<unknown>): Promise<ApiProblem> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiProblem) return error;
    throw error;
  }
  throw new Error("expected an ApiProblem");
}

// Low-entropy synthetic value (no real session id in the repository).
const VALUE = "synthetic-synthetic-synthetic";

describe("NFR-15 FR 5: session cookies — httpOnly, Secure, __Secure- on HTTPS, SameSite=Lax", () => {
  it("on HTTPS the name has the __Secure- prefix and every attribute is set", () => {
    const cookie = sessionCookie("ws_session", VALUE, { https: true }, { maxAgeS: 3600 });
    expect(cookie).toBe(
      `${SECURE_COOKIE_PREFIX}ws_session=${VALUE}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("on plain HTTP (local development) no prefix, still HttpOnly, Secure and SameSite=Lax", () => {
    expect(sessionCookie("ws_session", VALUE, { https: false })).toBe(
      `ws_session=${VALUE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("staging and production always count as HTTPS; elsewhere the request's protocol decides", () => {
    const request = (protocol: "http" | "https") => ({ protocol }) as never;
    expect(cookieContext(request("http"), true).https).toBe(true);
    expect(cookieContext(request("http"), false).https).toBe(false);
    expect(cookieContext(request("https"), false).https).toBe(true);
  });

  it("the cleared cookie has the same attributes and Max-Age=0", () => {
    expect(clearedSessionCookie("ws_session", { https: true })).toBe(
      `${SECURE_COOKIE_PREFIX}ws_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("refuses names and values that could inject attributes or headers", () => {
    expect(() => sessionCookie("a;b", VALUE, { https: true })).toThrow();
    expect(() => sessionCookie(`${SECURE_COOKIE_PREFIX}x`, VALUE, { https: true })).toThrow();
    expect(() => sessionCookie("ws_session", "a; Domain=evil.example", { https: true })).toThrow();
    expect(() => sessionCookie("ws_session", "a\r\nSet-Cookie: x=y", { https: true })).toThrow();
    expect(() => sessionCookie("ws_session", VALUE, { https: true }, { maxAgeS: -1 })).toThrow();
  });

  it("reading on HTTPS accepts only the prefixed name; a duplicate is not trusted", () => {
    const headers = (cookie: string) => ({ headers: { cookie } });
    const https = { https: true };
    expect(
      readSessionCookie(headers(`${SECURE_COOKIE_PREFIX}ws_session=${VALUE}; other=1`), "ws_session", https),
    ).toBe(VALUE);
    // A cookie planted without the prefix (over HTTP or by a script) does not pass for the session.
    expect(readSessionCookie(headers(`ws_session=${VALUE}`), "ws_session", https)).toBeUndefined();
    expect(
      readSessionCookie(
        headers(`${SECURE_COOKIE_PREFIX}ws_session=${VALUE}; ${SECURE_COOKIE_PREFIX}ws_session=other-value`),
        "ws_session",
        https,
      ),
    ).toBeUndefined();
    expect(readSessionCookie({ headers: {} }, "ws_session", https)).toBeUndefined();
    expect(readSessionCookie(headers(`ws_session=${VALUE}`), "ws_session", { https: false })).toBe(VALUE);
  });
});

/** A query runner that answers like PostgreSQL would, recording the SQL and its parameters. */
function fakeRunner(state: { version: number; values: Record<string, unknown> } | null) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const runner: HouseholdQueryRunner = {
    householdId: "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01",
    query: (async (text: string, values: readonly unknown[] = []) => {
      calls.push({ text, values });
      if (text.trimStart().startsWith("UPDATE")) {
        if (state && state.version === values[2]) {
          state.version += 1;
          for (const m of text.matchAll(/"([a-z_]+)" = \$(\d+)/g))
            if (m[1] !== "version") state.values[m[1]!] = values[Number(m[2]) - 1];
          return { rows: [{ version: state.version }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (!state) return { rows: [], rowCount: 0 };
      const row: Record<string, unknown> = { version: state.version };
      // `"col" IS DISTINCT FROM $n AS d<i>`: the stored value against the n-th parameter.
      for (const m of text.matchAll(/"([a-z_]+)" IS DISTINCT FROM \$(\d+) AS (d\d+)/g))
        row[m[3]!] = state.values[m[1]!] !== values[Number(m[2]) - 1];
      return { rows: [row], rowCount: 1 };
    }) as HouseholdQueryRunner["query"],
  };
  return { runner, calls };
}

const assets = defineVersionedTable({
  table: "assets",
  fields: { name: "name", purchaseDate: "purchase_date", secret: "secret_code" },
  // `secret` may be written but not read back: never compared.
  readable: ["name", "purchaseDate"],
});

describe("NFR-15 FR 13: two parallel changes of one record → 409 VERSION_CONFLICT with the current version and changed fields", () => {
  it("the change with the current version applies and raises the version", async () => {
    const { runner, calls } = fakeRunner({ version: 3, values: { name: "a", purchase_date: "2026-01-01" } });
    expect(await updateVersioned(runner, assets, "id-1", 3, { name: "b" }, { name: "a" })).toEqual({
      version: 4,
    });
    expect(calls[0]!.text).toMatch(/UPDATE "assets" SET "name" = \$4, "version" = "version" \+ 1/);
    expect(calls[0]!.text).toMatch(/WHERE household_id = \$1 AND "id" = \$2 AND "version" = \$3/);
    expect(calls[0]!.values).toEqual([runner.householdId, "id-1", 3, "b"]);
  });

  it("changedFields are the fields another writer changed since the base the client read — not the ones it sends", async () => {
    const state = { version: 3, values: { name: "a", purchase_date: "2026-01-01", secret_code: "s" } };
    const base = { name: "a", purchaseDate: "2026-01-01" };
    await updateVersioned(fakeRunner(state).runner, assets, "id-1", 3, { name: "from-first" }, base);
    // The second user, still on version 3, edits only the date.
    const problem = await asyncProblemOf(() =>
      updateVersioned(fakeRunner(state).runner, assets, "id-1", 3, { purchaseDate: "2026-02-02" }, base),
    );
    expect(problemBody(problem.code, { extensions: problem.extensions })).toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      currentVersion: 4,
      changedFields: ["name"],
    });
    expect(state.values).toMatchObject({ name: "from-first", purchase_date: "2026-01-01" });
  });

  it("fields outside `readable`, not declared, or left out of base are never compared or reported", async () => {
    const state = { version: 5, values: { name: "x", purchase_date: "2026-03-03", secret_code: "real" } };
    const { runner, calls } = fakeRunner(state);
    const problem = await asyncProblemOf(() =>
      updateVersioned(
        runner,
        assets,
        "id-1",
        4,
        { name: "y" },
        {
          secret: "guess",
          ["household_id"]: "x",
          ["__proto__"]: "x",
          purchaseDate: "2026-03-03",
        },
      ),
    );
    expect(problem.extensions).toEqual({ currentVersion: 5, changedFields: [] });
    const select = calls.at(-1)!;
    expect(select.text).not.toContain("secret_code");
    expect(select.values).not.toContain("guess");
    // `name` changed too, but the client did not send its base value: not reported (documented).
    expect(problem.extensions?.changedFields).not.toContain("name");
  });

  it("a record the caller cannot see is 404, never a conflict (DAT-05)", async () => {
    const { runner } = fakeRunner(null);
    expect(
      (await asyncProblemOf(() => updateVersioned(runner, assets, "id-x", 1, { name: "b" }, {}))).code,
    ).toBe("NOT_FOUND");
  });

  it("only declared fields; identifiers checked at declaration; values only as parameters", async () => {
    const { runner } = fakeRunner({ version: 1, values: { name: "a" } });
    await expect(
      updateVersioned(runner, assets, "id-1", 1, { ["name\" = 'x'; --"]: "b" }, {}),
    ).rejects.toThrow(/not a field/);
    await expect(updateVersioned(runner, assets, "id-1", 1, {}, {})).rejects.toThrow(/nothing to change/);
    const fields = { name: "name" };
    expect(() => defineVersionedTable({ table: "assets; drop", fields, readable: [] })).toThrow();
    expect(() => defineVersionedTable({ table: "assets", fields: { name: "Name" }, readable: [] })).toThrow();
    expect(() =>
      defineVersionedTable({ table: "assets", fields: { owner: "household_id" }, readable: [] }),
    ).toThrow();
    expect(() => defineVersionedTable({ table: "assets", fields: { v: "version" }, readable: [] })).toThrow();
    expect(() => defineVersionedTable({ table: "assets", fields, readable: ["other"] })).toThrow(/readable/);
    for (const version of [-1, 2 ** 31])
      expect(
        (await asyncProblemOf(() => updateVersioned(runner, assets, "id-1", version, { name: "b" }, {})))
          .code,
      ).toBe("VALIDATION_FAILED");
  });

  it("the problem schema of the contract carries currentVersion and changedFields", () => {
    const body = problemBody("VERSION_CONFLICT", {
      extensions: { currentVersion: 7, changedFields: ["name"] },
    });
    expect(ProblemSchema.parse(body)).toEqual(body);
  });
});

const list = defineListQuery({
  filters: {
    status: { column: "status", cast: "text", value: z.enum(["active", "sold"]), operators: ["eq", "in"] },
    purchasedOn: { column: "purchased_on", cast: "date", value: z.iso.date(), operators: ["gte", "lte"] },
    count: { column: "item_count", cast: "integer", value: filterValue.int4(), operators: ["eq", "gt"] },
  },
  sorts: { name: "name", purchasedOn: "purchased_on" },
  defaultSort: { field: "name", direction: "asc" },
});

describe("NFR-15 FR 15: filter and sort fields only from a whitelist; values as typed parameters", () => {
  it("compiles declared fields to parameterised conditions with explicit casts", () => {
    const compiled = list.compile(
      {
        filter: ["status.in:active,sold", "purchasedOn.gte:2026-01-01", "count.gt:3"],
        sort: "-purchasedOn,name",
      },
      2,
    );
    expect(compiled.where).toBe(
      `"status" = ANY($2::text[]) AND "purchased_on" >= $3::date AND "item_count" > $4::integer`,
    );
    expect(compiled.params).toEqual([["active", "sold"], "2026-01-01", 3]);
    expect(compiled.orderBy).toBe(`"purchased_on" DESC, "name" ASC`);
    expect(list.compile({}, 1)).toEqual({ where: "TRUE", params: [], orderBy: `"name" ASC` });
    expect(list.compile({ filter: "status.eq:active" }, 1).params).toEqual(["active"]);
  });

  it.each([
    ["an undeclared field", { filter: "householdId.eq:x" }, "unknown_filter"],
    ["a column name instead of a field", { filter: "household_id.eq:x" }, "invalid_format"],
    ["an operator the field does not allow", { filter: "status.gt:active" }, "unknown_filter"],
    ["an injection in the field name", { filter: "status;drop.eq:x" }, "invalid_format"],
    ["a value of the wrong type", { filter: "count.eq:3 OR 1=1" }, "invalid_value"],
    ["a value outside the enum", { filter: "status.eq:active' OR '1'='1" }, "invalid_value"],
    ["an undeclared sort", { sort: "household_id" }, "unknown_sort"],
    ["an injection in the sort", { sort: "name; DROP TABLE assets" }, "unknown_sort"],
    ["inherited object keys", { filter: "constructor.eq:x" }, "unknown_filter"],
  ])("%s → 400 VALIDATION_FAILED without echoing the input", (_where, input, issue) => {
    const problem = problemOf(() => list.compile(input, 1));
    expect(problem.code).toBe("VALIDATION_FAILED");
    expect(problem.errors).toEqual([{ in: "query", path: expect.stringMatching(/^(filter|sort)$/), issue }]);
  });

  it("refuses a declaration with an unsafe column or cast", () => {
    const value = z.string();
    expect(() =>
      defineListQuery({
        filters: { x: { column: "x; drop", cast: "text", value, operators: ["eq"] } },
        sorts: { x: "x" },
        defaultSort: { field: "x", direction: "asc" },
      }),
    ).toThrow();
    expect(() =>
      defineListQuery({
        filters: { x: { column: "x", cast: "text); drop" as never, value, operators: ["eq"] } },
        sorts: { x: "x" },
        defaultSort: { field: "x", direction: "asc" },
      }),
    ).toThrow();
  });
});

describe("NFR-15 FR 15 (review of PR #86): strict value parsers — a bad value is 400, never a database error", () => {
  it.each([
    [
      "int4",
      filterValue.int4(),
      ["0", "-7", "2147483647", "-2147483648"],
      ["", " ", "0x10", "01", "+1", "1e3", "1.0", "2147483648", "-2147483649", " 1"],
    ],
    ["int4 with bounds", filterValue.int4({ min: 0, max: 10 }), ["0", "10"], ["-1", "11"]],
    [
      "int8",
      filterValue.int8(),
      ["9223372036854775807", "-9223372036854775808"],
      ["9223372036854775808", "", "0x1", "01"],
    ],
    [
      "decimal",
      filterValue.decimal(),
      ["0", "-12.5", "12345678901234567890.123456789012345678"],
      [
        "",
        "1.",
        ".5",
        "1e3",
        "0x10",
        "123456789012345678901",
        "1.1234567890123456789",
        "NaN",
        "Infinity",
        " 1",
      ],
    ],
    [
      "isoDate",
      filterValue.isoDate(),
      ["2024-02-29", "2026-11-07"],
      ["2026-02-30", "2025-02-29", "2026-13-01", "26-11-07", ""],
    ],
    [
      "timestamp",
      filterValue.timestamp(),
      ["2026-11-07T10:00:00Z", "2026-11-07T10:00:00+02:00"],
      ["2026-11-07", "2026-11-07T10:00:00", ""],
    ],
    ["boolean", filterValue.boolean(), ["true", "false"], ["1", "TRUE", "yes", ""]],
  ] as const)("%s", (_name, schema, good, bad) => {
    for (const v of good) expect(schema.safeParse(v).success, v).toBe(true);
    for (const v of bad) expect(schema.safeParse(v).success, JSON.stringify(v)).toBe(false);
  });

  it("int4 gives a number, int8 keeps its digits as text, boolean gives a boolean", () => {
    expect(filterValue.int4().parse("42")).toBe(42);
    expect(filterValue.int8().parse("9223372036854775807")).toBe("9223372036854775807");
    expect(filterValue.boolean().parse("false")).toBe(false);
  });

  it("an out-of-range value in a filter is 400 VALIDATION_FAILED before any SQL", () => {
    for (const value of ["2147483648", "0x10", "", " "]) {
      const problem = problemOf(() => list.compile({ filter: `count.eq:${value}` }, 1));
      expect(problemBody(problem.code, { errors: problem.errors }).status).toBe(400);
    }
  });
});

describe("NFR-15 FR 17: generic limits — filters ≤ 50, body ≤ 1 MiB; LIMIT_REACHED", () => {
  it("50 filters pass, the 51st is 422 LIMIT_REACHED with the limit; so is an `in` list of 51 values", () => {
    const filters = (n: number) => Array.from({ length: n }, () => "status.eq:active");
    expect(list.compile({ filter: filters(50) }, 1).params).toHaveLength(50);
    const problem = problemOf(() => list.compile({ filter: filters(51) }, 1));
    expect(problemBody(problem.code, { extensions: problem.extensions })).toMatchObject({
      status: 422,
      code: "LIMIT_REACHED",
      limit: 50,
    });
    const values = Array.from({ length: 51 }, () => "active").join(",");
    expect(problemOf(() => list.compile({ filter: `status.in:${values}` }, 1)).code).toBe("LIMIT_REACHED");
  });

  it("the technical limits of the requirement, and requireWithinLimit for the modules that own them", () => {
    expect(TECHNICAL_LIMITS).toEqual({
      filtersPerRequest: 50,
      bulkItems: 500,
      draftBytes: 102_400,
      draftsPerUser: 20,
      savedViewsPerList: 50,
    });
    expect(() => requireWithinLimit(500, TECHNICAL_LIMITS.bulkItems)).not.toThrow();
    expect(problemOf(() => requireWithinLimit(501, TECHNICAL_LIMITS.bulkItems)).extensions).toEqual({
      limit: 500,
    });
  });

  it("page size stays bounded by the pagination (≤ 100) — the allowed sizes are an open question", () => {
    expect(PAGE_MAX_LIMIT).toBe(100);
  });

  it("a route may set a body limit below 1 MiB, never above", () => {
    const base = {
      module: "things",
      method: "POST" as const,
      path: "/v1/things-z",
      operationId: "thingsZ",
      summary: "x",
      access: { permission: "p", feature: "f" },
      request: { body: z.object({ text: z.string() }) },
      response: { status: 200 as const, description: "x", schema: z.object({ ok: z.boolean() }) },
      handler: async () => ({ ok: true }),
    };
    expect(API_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(() => defineRoute({ ...base, bodyLimitBytes: TECHNICAL_LIMITS.draftBytes })).not.toThrow();
    expect(() => defineRoute({ ...base, bodyLimitBytes: API_BODY_LIMIT_BYTES + 1 })).toThrow(
      /bodyLimitBytes/,
    );
    expect(() => defineRoute({ ...base, bodyLimitBytes: 0 })).toThrow(/bodyLimitBytes/);
  });
});
