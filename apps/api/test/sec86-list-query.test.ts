import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi } from "../src/platform/http/api.ts";
import { defineListQuery } from "../src/platform/http/list-query.ts";
import type { ApiProblem } from "../src/platform/http/problem.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * Security review of PR #86 (NFR-15 FR 15, FR 17): the whitelist through a real route — values that are not
 * numbers (NaN, Infinity, huge), every `in` value parsed, inherited object keys as sort names, at most three
 * sort keys, the length bound of one filter, and an error that never repeats what was sent.
 */
const list = defineListQuery({
  filters: {
    status: { column: "status", cast: "text", value: z.enum(["active", "sold"]), operators: ["eq", "in"] },
    count: {
      column: "item_count",
      cast: "integer",
      value: z.coerce.number().int(),
      operators: ["eq", "gt", "in"],
    },
  },
  sorts: { name: "name", count: "item_count", status: "status", createdAt: "created_at" },
  defaultSort: { field: "name", direction: "asc" },
});

const listThings = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things",
  operationId: "listThingsSec86",
  summary: "x",
  access: { permission: "things.read", feature: "things" },
  request: { query: z.object(list.query) },
  response: {
    status: 200,
    description: "x",
    schema: z.object({ where: z.string(), orderBy: z.string(), params: z.array(z.unknown()) }),
  },
  handler: async ({ query }) => {
    const compiled = list.compile(query, 2);
    return { where: compiled.where, orderBy: compiled.orderBy, params: [...compiled.params] };
  },
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function get(qs: string) {
  app ??= buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => registerApi(a, testApiOptions([listThings], { rateLimits: "off" })),
  });
  await app.ready();
  return app.inject({ method: "GET", url: `/v1/things?${qs}`, headers: principalHeader() });
}

const problemOf = (fn: () => unknown): ApiProblem => {
  try {
    fn();
  } catch (e) {
    return e as ApiProblem;
  }
  throw new Error("expected a problem");
};

describe("NFR-15 FR 15: numbers are numbers", () => {
  it.each(["NaN", "Infinity", "-Infinity", "1e400", "99999999999999999999", "1.5", "1,5", "--1"])(
    "count.eq:%s → invalid_value",
    (text) => {
      expect(problemOf(() => list.compile({ filter: `count.eq:${text}` }, 1)).errors).toEqual([
        { in: "query", path: "filter", issue: "invalid_value" },
      ]);
    },
  );

  it("every value of an `in` list is parsed by the field's schema", () => {
    for (const filter of [
      "count.in:1,abc",
      "count.in:1,NaN",
      "status.in:active,x' OR '1'='1",
      "status.in:active,",
    ])
      expect(problemOf(() => list.compile({ filter }, 1)).errors?.[0]?.issue, filter).toBe("invalid_value");
    expect(list.compile({ filter: "count.in:1,2" }, 1).params).toEqual([[1, 2]]);
  });
});

describe("NFR-15 FR 15: sort names come only from the declaration", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "-constructor", "name ", "NAME"])(
    "sort=%s → unknown_sort",
    (sort) => {
      expect(problemOf(() => list.compile({ sort }, 1)).errors).toEqual([
        { in: "query", path: "sort", issue: "unknown_sort" },
      ]);
    },
  );

  it("at most three sort keys", () => {
    expect(list.compile({ sort: "name,-count,status" }, 1).orderBy).toBe(
      `"name" ASC, "item_count" DESC, "status" ASC`,
    );
    expect(
      problemOf(() => list.compile({ sort: "name,-count,status,createdAt" }, 1)).errors?.[0]?.issue,
    ).toBe("too_many_keys");
  });
});

describe("NFR-15 FR 15, FR 17 through a route: limits, bounded input, nothing echoed", () => {
  const HOSTILE = "zz9Injected";
  it.each([
    ["an unknown field", `filter=${HOSTILE}.eq:1`],
    ["a SQL-looking field", `filter=${encodeURIComponent(`status";drop table x;--.eq:${HOSTILE}`)}`],
    ["a cast in the operator", `filter=${encodeURIComponent(`status.eq::text:${HOSTILE}`)}`],
    ["a bad value", `filter=${encodeURIComponent(`count.eq:${HOSTILE}`)}`],
    ["an unknown sort", `sort=${HOSTILE}`],
    ["a filter over 1024 characters", `filter=status.eq:${HOSTILE}${"a".repeat(1100)}`],
  ])("%s → 400 that does not repeat the input", async (_where, qs) => {
    const response = await get(qs);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
    expect(response.body).not.toContain(HOSTILE);
    expect(response.body).not.toMatch(/drop table/i);
  });

  it("one filter over 1024 characters is refused as too long before it is parsed", async () => {
    const response = await get(`filter=count.in:${Array.from({ length: 550 }, () => "1").join(",")}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().errors).toEqual([{ in: "query", path: "filter", issue: "too_big" }]);
  });

  it("51 repeated filters → 422 LIMIT_REACHED with limit 50; 50 pass", async () => {
    const qs = (n: number) => Array.from({ length: n }, () => "filter=status.eq:active").join("&");
    expect((await get(qs(50))).statusCode).toBe(200);
    const over = await get(qs(51));
    expect(over.statusCode).toBe(422);
    expect(over.json()).toMatchObject({ code: "LIMIT_REACHED", limit: 50 });
  });

  it("bracket and nested query syntax is not a way in: it is ignored or refused, never compiled", async () => {
    for (const qs of [
      "filter[status]=active",
      "filter[0]=count.gt:1",
      "filter.status=active",
      "sort[]=name",
    ]) {
      const response = await get(qs);
      expect([200, 400], qs).toContain(response.statusCode);
      if (response.statusCode === 200)
        expect(response.json(), qs).toMatchObject({ where: "TRUE", params: [] });
    }
  });

  it("values only ever reach the SQL as typed parameters", async () => {
    const response = await get(`filter=${encodeURIComponent("count.gt:5")}&filter=status.in:active,sold`);
    expect(response.json()).toEqual({
      where: `"item_count" > $2::integer AND "status" = ANY($3::text[])`,
      orderBy: `"name" ASC`,
      params: [5, ["active", "sold"]],
    });
  });
});
