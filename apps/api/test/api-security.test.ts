/**
 * Security coverage for ARC-07 (review of PR #80). Lives at apps/api/test/api-security.test.ts
 * (unit) — tests that kill mutants the existing suite let survive.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fakeDatabases,
  householdA,
  householdB,
  memoryIdempotency,
  principalHeader,
  testApp,
} from "./http.ts";
import { IDEMPOTENCY_REPLAYED_HEADER } from "../src/platform/http/idempotency.ts";
import { mountApi, apiRoutes } from "../src/api.ts";
import { decodeCursor, encodeCursor, pageQuery } from "../src/platform/http/pagination.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { ApiProblem, problemType } from "../src/platform/http/problem.ts";
import { defineRoute, fastifyPath } from "../src/platform/http/route.ts";

const json = { "content-type": "application/json" };

const seenHouseholds: string[] = [];
const echo = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/households/{householdId}/things",
  operationId: "createHouseholdThing",
  summary: "Create, with a household id in every part of the request",
  access: { permission: "things.write", feature: "things" },
  create: true,
  request: {
    params: z.object({ householdId: z.string() }),
    query: z.object({ householdId: z.string().optional() }),
    body: z.object({ householdId: z.string(), name: z.string() }),
  },
  response: { status: 201, description: "Created", schema: z.object({ household: z.string() }) },
  handler: async (_input, ctx) => {
    const household = await ctx.inHousehold(async (q) => q.householdId);
    seenHouseholds.push(household);
    return { household };
  },
});

const listed = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/listed",
  operationId: "listListed",
  summary: "List",
  access: { permission: "things.read", feature: "things" },
  list: true,
  request: { query: pageQuery },
  response: {
    status: 200,
    description: "A page",
    schema: z.object({ items: z.array(z.number()), nextCursor: z.string().nullable() }),
  },
  handler: async ({ query }) => ({
    items: Array.from({ length: query.limit }, (_, i) => i),
    nextCursor: null,
  }),
});

const strictBody = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/strict",
  operationId: "createStrict",
  summary: "Strict body",
  access: { permission: "things.write", feature: "things" },
  request: { body: z.strictObject({ name: z.string().max(3) }) },
  response: { status: 201, description: "Created", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

describe("ARC-07 security: order of checks (401 → 403 → 402 → 400)", () => {
  it("a caller who lacks both the permission and the plan gets 403, not 402 (role before plan)", async () => {
    const checkFeature = vi.fn(async () => false);
    const app = await testApp([listed], { checkPermission: () => false, checkFeature });
    const res = await app.inject({ method: "GET", url: "/v1/listed", headers: principalHeader() });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(checkFeature).not.toHaveBeenCalled();
  });

  it("invalid input without a session is 401 with no field errors (the schema is not revealed before sign-in)", async () => {
    const app = await testApp([strictBody]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/strict",
      headers: json,
      payload: { name: "too long", extra: 1 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty("errors");
  });

  it("invalid input from a member without the permission is 403, and from one without the plan is 402", async () => {
    const bad = { method: "POST" as const, url: "/v1/strict", headers: { ...json, ...principalHeader() } };
    const deny = await testApp([strictBody], { checkPermission: () => false });
    expect((await deny.inject({ ...bad, payload: { name: "too long" } })).statusCode).toBe(403);
    const noPlan = await testApp([strictBody], { checkFeature: async () => false });
    expect((await noPlan.inject({ ...bad, payload: { name: "too long" } })).statusCode).toBe(402);
  });
});

describe("П-5 security: the household comes only from the session, never from the request", () => {
  it("a household id in the path, query, body and headers is ignored by ctx.inHousehold and the idempotency store", async () => {
    seenHouseholds.length = 0;
    const { databases, bound } = fakeDatabases();
    const store = memoryIdempotency();
    const begin = vi.spyOn(store, "begin");
    const app = await testApp([echo], { databases, idempotency: () => store });
    const res = await app.inject({
      method: "POST",
      url: `/v1/households/${householdA}/things?householdId=${householdA}`,
      headers: {
        ...json,
        ...principalHeader({ householdId: householdB }),
        "x-household-id": householdA,
        "x-willowsum-household": householdA,
        "household-id": householdA,
        "idempotency-key": "hh-1",
      },
      payload: { householdId: householdA, name: "x" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ household: householdB });
    expect(bound).toEqual([householdB]);
    expect(begin).toHaveBeenCalledWith(householdB, "hh-1", expect.any(String));
  });

  it("route code has no way to bind another household: ctx.db offers no inHousehold", async () => {
    let exposed: unknown;
    const probe = defineRoute({
      ...listed,
      operationId: "probeDb",
      path: "/v1/probe-db",
      handler: async (_input, ctx) => {
        exposed = (ctx as unknown as { db: { inHousehold?: unknown } }).db.inHousehold;
        return { items: [], nextCursor: null };
      },
    });
    const app = await testApp([probe]);
    await app.inject({ method: "GET", url: "/v1/probe-db", headers: principalHeader() });
    expect(exposed).toBeUndefined();
  });
});

describe("ARC-07 security: problem details never echo what was sent", () => {
  it("malformed JSON is MALFORMED_REQUEST with the fixed body only: no parser message, no fragment of the body", async () => {
    const app = await testApp([strictBody]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/strict",
      headers: { ...json, ...principalHeader() },
      payload: '{"name": jane@example.com',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      type: problemType("MALFORMED_REQUEST"),
      title: "The request body could not be read",
      status: 400,
      code: "MALFORMED_REQUEST",
    });
    expect(res.body).not.toMatch(/jane|example|JSON|position|token/i);
  });

  it("an exception in authentication or in the plan check is 500 INTERNAL without its message", async () => {
    const boom = async () => {
      throw new Error("connection to db://secret@host failed for jane@example.com");
    };
    for (const overrides of [{ authenticate: boom }, { checkFeature: boom }]) {
      const app = await testApp([listed], overrides);
      const res = await app.inject({ method: "GET", url: "/v1/listed", headers: principalHeader() });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        type: problemType("INTERNAL"),
        title: "Something went wrong on our side",
        status: 500,
        code: "INTERNAL",
      });
    }
  });

  it("a response that does not fit its schema is 500 INTERNAL without zod's message or the value", async () => {
    const wrong = defineRoute({
      ...strictBody,
      operationId: "createWrong",
      path: "/v1/wrong",
      handler: async () => ({ ok: "jane@example.com" }) as unknown as { ok: boolean },
    });
    const app = await testApp([wrong]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/wrong",
      headers: { ...json, ...principalHeader() },
      payload: { name: "a" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/jane|expected|boolean/i);
  });
});

describe("ARC-07 security: idempotency", () => {
  it("one key on two create operations is two different requests (the hash covers the operation)", async () => {
    const store = memoryIdempotency();
    const other = defineRoute({
      ...echo,
      operationId: "createOtherThing",
      path: "/v1/other/{householdId}/things",
    });
    const app = await testApp([echo, other], { idempotency: () => store });
    const send = (url: string) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...json, ...principalHeader(), "idempotency-key": "same" },
        payload: { householdId: "x", name: "a" },
      });
    expect((await send("/v1/households/x/things")).statusCode).toBe(201);
    const res = await send("/v1/other/x/things");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(res.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
  });
});

describe("ARC-07 security: page size", () => {
  it("never more than 100 items per page (ARC-07 / ADR-0003 bound, not the constant under test)", async () => {
    const app = await testApp([listed]);
    const get = (q: string) =>
      app.inject({ method: "GET", url: `/v1/listed${q}`, headers: principalHeader() });
    expect((await get("?limit=100")).json().items).toHaveLength(100);
    expect((await get("?limit=101")).statusCode).toBe(400);
    expect((await get("")).json().items).toHaveLength(25);
  });
});

describe("ARC-07 security: cursors", () => {
  it("a well-formed cursor of another shape (e.g. carrying a household id) is INVALID_CURSOR, not used", async () => {
    const position = z.object({ id: z.number().int() });
    const forged = encodeCursor({ householdId: householdB, id: "1 OR 1=1" });
    expect(() => decodeCursor(forged, position)).toThrow(ApiProblem);
    expect(() => decodeCursor(encodeCursor({ id: "7" }), position)).toThrow(/INVALID_CURSOR/);
    expect(decodeCursor(encodeCursor({ id: 7 }), position)).toEqual({ id: 7 });
  });
});

describe("ARC-07 criterion «маршрут без перевірки прав і плану — 0»: what the server really serves", () => {
  it("every /v1 route the api server serves is a declared, checked API route (no raw Fastify route under /v1)", async () => {
    const app = buildServer({
      readiness: async () => ({ ready: true }),
      api: (a) => mountApi(a, { databases: fakeDatabases().databases, entitlements: "all-enabled" }),
    });
    await app.ready();
    const served = new Set<string>();
    // printRoutes in common-prefix-free form: one line per route with its methods.
    for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
      const m = line.match(/(\/v1\S*) \(([^)]+)\)/);
      if (!m) continue;
      for (const method of m[2]!.split(", ")) if (method !== "HEAD") served.add(`${method} ${m[1]}`);
    }
    const declared = new Set(apiRoutes.map((r) => `${r.method} ${fastifyPath(r.path)}`));
    expect([...served].sort()).toEqual([...declared].sort());
    await app.close();
  });
});
