import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerApi } from "../src/platform/http/api.ts";
import { defineListQuery, filterValue } from "../src/platform/http/list-query.ts";
import { defineRoute } from "../src/platform/http/route.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { principalHeader, testApiOptions } from "./http.ts";

/**
 * Security review of PR #86, round 2 (NFR-15 FR 15) through a real route: a value a strict helper refuses is
 * 400 VALIDATION_FAILED with nothing of the value in the answer — never a 500 from the parser itself.
 */
const list = defineListQuery({
  filters: {
    big: { column: "c_int8", cast: "bigint", value: filterValue.int8(), operators: ["eq", "in"] },
    small: { column: "c_int4", cast: "integer", value: filterValue.int4(), operators: ["eq", "in"] },
    ref: { column: "c_uuid", cast: "uuid", value: filterValue.uuid(), operators: ["eq"] },
    flag: { column: "c_bool", cast: "boolean", value: filterValue.boolean(), operators: ["eq"] },
  },
  sorts: { big: "c_int8" },
  defaultSort: { field: "big", direction: "asc" },
});

const listThings = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things",
  operationId: "listThingsSec86r2",
  summary: "x",
  access: { permission: "things.read", feature: "things" },
  request: { query: z.object(list.query) },
  response: { status: 200, description: "x", schema: z.object({ params: z.array(z.unknown()) }) },
  handler: async ({ query }) => ({ params: [...list.compile(query, 0).params] }),
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function get(filter: string) {
  app ??= buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => registerApi(a, testApiOptions([listThings], { rateLimits: "off" })),
  });
  await app.ready();
  return app.inject({
    method: "GET",
    url: `/v1/things?filter=${encodeURIComponent(filter)}`,
    headers: principalHeader(),
  });
}

describe("NFR-15 FR 15 (round 2): strict filter values through a route", () => {
  it("int4, uuid and boolean refusals are 400 without the value", async () => {
    for (const filter of ["small.eq:zqx1", "small.in:1,zqx2", "ref.eq:zqx3", "flag.eq:zqx4"]) {
      const res = await get(filter);
      expect(res.statusCode, filter).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(res.body).not.toMatch(/zqx/);
    }
  });

  it("int8 accepts its full range and keeps the digits", async () => {
    const res = await get("big.in:9223372036854775807,-9223372036854775808");
    expect(res.statusCode).toBe(200);
    expect(res.json().params).toEqual([["9223372036854775807", "-9223372036854775808"]]);
  });

  // Defect (round 2): in zod 4 a failed .regex() does not stop the .refine() after it, so filterValue.int8()
  // calls BigInt() on text such as "1.5", "zqx" or "1e3" and throws a SyntaxError — the route answers 500
  // INTERNAL instead of 400 VALIDATION_FAILED.
  it("int8: a non-integer text is 400 VALIDATION_FAILED, not a 500 from BigInt()", async () => {
    for (const filter of ["big.eq:1.5", "big.eq:zqx5", "big.eq:1e3", "big.in:1,zqx6"]) {
      const res = await get(filter);
      expect(res.statusCode, filter).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(res.body).not.toMatch(/zqx/);
    }
  });
});
