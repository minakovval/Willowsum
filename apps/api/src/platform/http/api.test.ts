import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fakeDatabases,
  householdA,
  householdB,
  memoryIdempotency,
  principalHeader,
  testApp,
} from "../../../test/http.ts";
import { IDEMPOTENCY_REPLAYED_HEADER } from "./idempotency.ts";
import { decodeCursor, PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT, pageOf, pageQuery, toPage } from "./pagination.ts";
import { ApiProblem, PROBLEM_CONTENT_TYPE, problemType } from "./problem.ts";
import { defineRoute } from "./route.ts";

const access = { permission: "things.write", feature: "things" };

const created: Array<{ name: string; householdId: string }> = [];
const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThing",
  summary: "Create a thing",
  access,
  create: true,
  request: { body: z.strictObject({ name: z.string().min(1).max(20), note: z.string().optional() }) },
  response: {
    status: 201,
    description: "Created",
    schema: z.object({ id: z.number().int(), name: z.string() }),
  },
  handler: async ({ body }, ctx) => {
    if (body.name === "explode")
      throw new Error("SELECT password FROM users -- internal detail of user@example.com");
    if (body.name === "refuse") throw new ApiProblem("FORBIDDEN");
    created.push({ name: body.name, householdId: ctx.principal.householdId });
    // `secret` is not in the response schema: it must never reach the client.
    return { id: created.length, name: body.name, secret: "internal" } as { id: number; name: string };
  },
});

const items = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
const listThings = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things",
  operationId: "listThings",
  summary: "List things",
  access: { permission: "things.read", feature: "things" },
  list: true,
  request: { query: pageQuery },
  response: {
    status: 200,
    description: "A page",
    schema: pageOf(z.object({ id: z.number().int(), label: z.string() })),
  },
  handler: async ({ query }) => {
    const after = query.cursor ? decodeCursor(query.cursor, z.object({ id: z.number().int() })).id : 0;
    const rows = items.filter((i) => i.id > after).slice(0, query.limit + 1);
    return toPage(
      rows,
      query.limit,
      (r) => r,
      (r) => ({ id: r.id }),
    );
  },
});

const getThing = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/{thingId}",
  operationId: "getThing",
  summary: "One thing",
  access: { permission: "things.read", feature: "things" },
  request: { params: z.object({ thingId: z.coerce.number().int().min(1) }) },
  response: {
    status: 200,
    description: "The thing",
    schema: z.object({ id: z.number().int(), household: z.string() }),
  },
  handler: async ({ params }, ctx) => ({
    id: params.thingId,
    household: await ctx.inHousehold(async (q) => q.householdId),
  }),
});

const routes = [createThing, listThings, getThing];
const json = { "content-type": "application/json" };

describe("ARC-07 FR 4: errors are RFC 9457 problem details with a machine code", () => {
  it("an unknown route answers 404 application/problem+json with type, title, status and code", async () => {
    const app = await testApp(routes);
    const res = await app.inject({ method: "GET", url: "/v1/nothing-here" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(
      new RegExp(`^${PROBLEM_CONTENT_TYPE.replace("+", "\\+")}(;|$)`),
    );
    expect(res.json()).toEqual({
      type: problemType("NOT_FOUND"),
      title: "Not found",
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("invalid input is 400 VALIDATION_FAILED with field paths and issue codes, never the values sent", async () => {
    const app = await testApp(routes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...json, ...principalHeader() },
      payload: { name: "x".repeat(21) + "4111111111111111", extra: "jane@example.com" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors).toEqual(
      expect.arrayContaining([
        { in: "body", path: "name", issue: "too_big" },
        { in: "body", path: "", issue: "unrecognized_keys" },
      ]),
    );
    expect(res.body).not.toContain("4111111111111111");
    expect(res.body).not.toContain("jane@example.com");
  });

  it("path and query parameters are validated by the same schemas", async () => {
    const app = await testApp(routes);
    const res = await app.inject({ method: "GET", url: "/v1/things/zero", headers: principalHeader() });
    expect(res.json()).toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      errors: [{ in: "path", path: "thingId" }],
    });
  });

  it("malformed JSON is 400 MALFORMED_REQUEST; another media type is 415", async () => {
    const app = await testApp(routes);
    const bad = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...json, ...principalHeader() },
      payload: "{nope",
    });
    expect(bad.json()).toMatchObject({ status: 400, code: "MALFORMED_REQUEST" });
    const text = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { "content-type": "text/plain", ...principalHeader() },
      payload: "name",
    });
    expect(text.json()).toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("an internal failure is 500 INTERNAL without the message, SQL or personal data", async () => {
    const app = await testApp(routes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...json, ...principalHeader() },
      payload: { name: "explode" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      type: problemType("INTERNAL"),
      title: "Something went wrong on our side",
      status: 500,
      code: "INTERNAL",
    });
    expect(res.body).not.toMatch(/SELECT|password|example\.com|stack/i);
  });

  it("the support-id hook (ARC-09 traces) adds supportId to every problem; without it the field is absent", async () => {
    const app = await testApp(routes, { supportId: () => "trace-0af7651916cd43dd" });
    const res = await app.inject({ method: "GET", url: "/v1/things" });
    expect(res.json()).toMatchObject({ code: "UNAUTHENTICATED", supportId: "trace-0af7651916cd43dd" });
  });

  it("fields a handler returns beyond the response schema never leave the server", async () => {
    const app = await testApp(routes);
    const res = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...json, ...principalHeader() },
      payload: { name: "plain" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty("secret");
  });
});

describe("ARC-07 criterion «маршрут без перевірки прав і плану — 0»: checks before the handler", () => {
  it("not signed in → 401, role → 403, plan → 402; the handler does not run", async () => {
    const handler = vi.fn();
    const route = defineRoute({
      ...getThing,
      operationId: "probeThing",
      path: "/v1/probe/{thingId}",
      handler,
    });
    const deny = await testApp([route], { checkPermission: () => false });
    const noPlan = await testApp([route], { checkFeature: async () => false });
    const open = await testApp([route]);
    expect((await open.inject({ method: "GET", url: "/v1/probe/1" })).json().code).toBe("UNAUTHENTICATED");
    expect(
      (await deny.inject({ method: "GET", url: "/v1/probe/1", headers: principalHeader() })).json().code,
    ).toBe("FORBIDDEN");
    const plan = await noPlan.inject({ method: "GET", url: "/v1/probe/1", headers: principalHeader() });
    expect(plan.statusCode).toBe(402);
    expect(plan.json().code).toBe("PLAN_LIMIT_REACHED");
    expect(handler).not.toHaveBeenCalled();
  });

  it("П-5: route code works in the caller's household only (ctx.inHousehold binds the session's household)", async () => {
    const { databases, bound } = fakeDatabases();
    const app = await testApp(routes, { databases });
    const res = await app.inject({
      method: "GET",
      url: "/v1/things/7",
      headers: principalHeader({ householdId: householdB }),
    });
    expect(res.json()).toEqual({ id: 7, household: householdB });
    expect(bound).toEqual([householdB]);
  });
});

describe("ARC-07 FR 4: create requests accept an idempotency key", () => {
  const post = (
    app: Awaited<ReturnType<typeof testApp>>,
    payload: object,
    key?: string,
    householdId = householdA,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { ...json, ...principalHeader({ householdId }), ...(key ? { "idempotency-key": key } : {}) },
      payload,
    });

  it("the same key and the same body return the stored response; the create runs once", async () => {
    created.length = 0;
    const app = await testApp(routes);
    const first = await post(app, { name: "Rent", note: "a" }, "key-1");
    // Same request in another key order: the hash is over canonical JSON.
    const second = await post(app, { note: "a", name: "Rent" }, "key-1");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(second.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
    expect(first.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
    expect(created).toHaveLength(1);
  });

  it("the same key with a different body is 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const app = await testApp(routes);
    await post(app, { name: "Rent" }, "key-2");
    const res = await post(app, { name: "Food" }, "key-2");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("keys are per household: another household's identical key is a new request", async () => {
    created.length = 0;
    const app = await testApp(routes);
    await post(app, { name: "Rent" }, "key-3", householdA);
    const other = await post(app, { name: "Rent" }, "key-3", householdB);
    expect(other.headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBeUndefined();
    expect(created.map((c) => c.householdId)).toEqual([householdA, householdB]);
  });

  it("a request still running answers 409 IDEMPOTENCY_REQUEST_IN_PROGRESS", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = defineRoute({
      ...createThing,
      operationId: "createSlowThing",
      path: "/v1/slow-things",
      handler: async ({ body }) => {
        await gate;
        return { id: 1, name: (body as { name: string }).name };
      },
    });
    const app = await testApp([slow]);
    const send = () =>
      app.inject({
        method: "POST",
        url: "/v1/slow-things",
        headers: { ...json, ...principalHeader(), "idempotency-key": "key-4" },
        payload: { name: "Rent" },
      });
    const first = send();
    await new Promise((r) => setTimeout(r, 20));
    const second = await send();
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
    release();
    expect((await first).statusCode).toBe(201);
    expect((await send()).headers[IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()]).toBe("true");
  });

  it("a failed create releases the key, so a retry runs again; an error is not stored as the response", async () => {
    const store = memoryIdempotency();
    const app = await testApp(routes, { idempotency: () => store });
    expect((await post(app, { name: "refuse" }, "key-5")).statusCode).toBe(403);
    expect(store.size()).toBe(0);
  });

  it("without a key every request creates; a malformed key is 400", async () => {
    created.length = 0;
    const app = await testApp(routes);
    await post(app, { name: "Rent" });
    await post(app, { name: "Rent" });
    expect(created).toHaveLength(2);
    const bad = await post(app, { name: "Rent" }, "has space");
    expect(bad.json()).toMatchObject({ status: 400, errors: [{ in: "header", path: "Idempotency-Key" }] });
  });
});

describe("ARC-07 FR 4: lists use server-side pagination", () => {
  const get = (app: Awaited<ReturnType<typeof testApp>>, query: string) =>
    app.inject({ method: "GET", url: `/v1/things${query}`, headers: principalHeader() });

  it(`returns ${PAGE_DEFAULT_LIMIT} items by default with a cursor to the next page`, async () => {
    const page = (await get(await testApp(routes), "")).json();
    expect(page.items).toHaveLength(PAGE_DEFAULT_LIMIT);
    expect(typeof page.nextCursor).toBe("string");
  });

  it("walking the cursors returns every item once and ends with nextCursor null", async () => {
    const app = await testApp(routes);
    const seen: number[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const page: { items: { id: number }[]; nextCursor: string | null } = (
        await get(app, `?limit=25${cursor ? `&cursor=${cursor}` : ""}`)
      ).json();
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(items.map((i) => i.id));
  });

  it(`refuses more than ${PAGE_MAX_LIMIT} items per page and a forged cursor`, async () => {
    const app = await testApp(routes);
    expect((await get(app, `?limit=${PAGE_MAX_LIMIT + 1}`)).json()).toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ in: "query", path: "limit" }],
    });
    expect((await get(app, `?limit=${PAGE_MAX_LIMIT}`)).json().items).toHaveLength(
      PAGE_MAX_LIMIT > 60 ? 60 : PAGE_MAX_LIMIT,
    );
    expect((await get(app, "?cursor=bm90LWpzb24")).json()).toMatchObject({
      status: 400,
      code: "INVALID_CURSOR",
    });
  });
});

describe("ARC-07: route declarations", () => {
  it("a route without a permission and a feature key is refused when it is declared", () => {
    expect(() => defineRoute({ ...getThing, access: undefined as never })).toThrow(/declares no access/);
    expect(() => defineRoute({ ...getThing, access: { permission: "things.read" } as never })).toThrow(
      /feature key/,
    );
    expect(() => defineRoute({ ...getThing, access: { permission: "", feature: "things" } })).toThrow(
      /permission/,
    );
  });

  it("a public route must say why and belongs to the platform", () => {
    expect(() => defineRoute({ ...getThing, access: { public: " " } })).toThrow(/why/);
    expect(() => defineRoute({ ...getThing, access: { public: "status" } })).toThrow(/platform/);
  });

  it("FR 3: every route is under /v1; path parameters match the schema; create is POST; a list is paginated", () => {
    expect(() => defineRoute({ ...getThing, path: "/v2/things/{thingId}" })).toThrow(/under \/v1/);
    expect(() => defineRoute({ ...getThing, path: "/v1/things/{id}" })).toThrow(/path parameters/);
    expect(() => defineRoute({ ...getThing, create: true })).toThrow(/only POST/);
    expect(() => defineRoute({ ...listThings, request: {} })).toThrow(/pageQuery/);
  });

  it("the API refuses to start with a permission or feature key that does not exist", async () => {
    await expect(testApp(routes, { permissions: new Set(["things.read"]) })).rejects.toThrow(
      /unknown permission things\.write/,
    );
    await expect(testApp(routes, { features: new Set() })).rejects.toThrow(/unknown feature key things/);
    await expect(testApp([getThing, getThing])).rejects.toThrow(/declared twice/);
  });
});
