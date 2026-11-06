import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiOptions, apiRoutes } from "../src/api.ts";
import { can } from "../src/modules/access-scope/index.ts";
import { FLAG_KEYS } from "../src/modules/feature-flags/index.ts";
import { FEATURE_KEYS } from "../src/modules/plan-catalog/index.ts";
import {
  MODULE_UNAVAILABLE_RETRY_AFTER_S,
  registerApi,
  type ApiOptions,
  type ErrorReport,
} from "../src/platform/http/api.ts";
import { defineRoute, fastifyPath, isPublic, routeFlag, type ApiRoute } from "../src/platform/http/route.ts";
import { fakeFlags, householdA, principalHeader, testApp, testAuthenticate, testWiring } from "./http.ts";

/**
 * CICD-06 and DAT-05 on the API pipeline: every protected route is behind its flag (off → the same 404 as a
 * path that does not exist) and its module's kill switch (on → 503 MODULE_UNAVAILABLE, the rest works).
 * Walks the routes the API really serves, so a new route is covered without writing a test.
 */

const protectedRoutes = apiRoutes.filter((r) => !isPublic(r.access));
const publicRoutes = apiRoutes.filter((r) => isPublic(r.access));
const modulesWithRoutes = [...new Set(protectedRoutes.map((r) => r.module as string))];

function concreteUrl(route: ApiRoute): string {
  return fastifyPath(route.path).replace(/:([A-Za-z]+)/g, "00000000-0000-4000-8000-000000000000");
}

async function serve(flags = fakeFlags(), overrides: Partial<ApiOptions> = {}) {
  const app = Fastify({ logger: false });
  registerApi(app, { ...apiOptions(testWiring(flags)), authenticate: testAuthenticate, ...overrides });
  await app.ready();
  return app;
}

describe("ARC-01 FR 7 / CICD-06 FR 1: every function has a feature key and a flag", () => {
  it("the flag catalogue and the feature catalogue hold the same keys", () => {
    expect([...FLAG_KEYS].sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("every protected route is behind a flag of feature-flags (its feature key unless it names one)", () => {
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) {
      if (isPublic(route.access)) continue;
      expect(FLAG_KEYS, route.operationId).toContain(routeFlag(route.access));
    }
  });

  it("a route naming a flag feature-flags does not know is refused at start", () => {
    const route = protectedRoutes[0]!;
    const rogue = {
      ...route,
      operationId: "rogue",
      path: "/v1/rogue",
      access: { permission: "household.data.read", feature: "household.core", flag: "nope.unknown" },
    } as ApiRoute;
    expect(() => registerApi(Fastify(), { ...apiOptions(testWiring()), routes: [rogue] })).toThrow(
      /unknown flag nope\.unknown \(feature-flags\)/,
    );
  });

  it("an empty explicit flag is refused when the route is declared", () => {
    expect(() =>
      defineRoute({
        module: "things",
        method: "GET",
        path: "/v1/things",
        operationId: "listThings",
        summary: "x",
        access: { permission: "p", feature: "f", flag: " " },
        response: { status: 200, description: "x", schema: z.object({}) },
        handler: async () => ({}),
      }),
    ).toThrow(/explicit flag/);
  });
});

describe("CICD-06 AC1 / DAT-05 AC6: a function whose flag is off is hidden — it answers as if it did not exist", () => {
  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: flag off for the space → 404 with the very body of an unknown path, for every role",
    async (_, route) => {
      if (isPublic(route.access)) return;
      const flags = fakeFlags({ off: [routeFlag(route.access)] });
      const app = await serve(flags);
      const unknown = await app.inject({
        method: "GET",
        url: "/v1/no-such-function",
        headers: principalHeader(),
      });
      for (const role of ["owner", "admin", "editor", "viewer", "advisor"]) {
        const res = await app.inject({
          method: route.method,
          url: concreteUrl(route),
          headers: principalHeader({ role }),
        });
        expect(res.statusCode, role).toBe(404);
        expect(res.body, role).toBe(unknown.body);
        expect(res.body.toLowerCase()).not.toMatch(/coming soon|скоро|disabled|flag/);
      }
      expect(flags.asked).toContain(`flag:${routeFlag(route.access)}@${householdA}`);
    },
  );

  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: flag on → the role check decides as before",
    async (_, route) => {
      if (isPublic(route.access)) return;
      const app = await serve();
      const res = await app.inject({
        method: route.method,
        url: concreteUrl(route),
        headers: principalHeader(),
      });
      expect(can({ role: "owner", scoped: false }, route.access.permission)).toBe(true);
      expect([401, 402, 403, 404, 503]).not.toContain(res.statusCode);
    },
  );

  it("the flag is checked for the session's own space, after the session and before role and plan", async () => {
    const route = protectedRoutes[0]!;
    if (isPublic(route.access)) return;
    const checkPermission = vi.fn(() => true);
    const checkFeature = vi.fn(async () => true);
    const app = await serve(fakeFlags({ off: [routeFlag(route.access)] }), { checkPermission, checkFeature });
    expect((await app.inject({ method: route.method, url: concreteUrl(route) })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: route.method, url: concreteUrl(route), headers: principalHeader() }))
        .statusCode,
    ).toBe(404);
    expect(checkPermission).not.toHaveBeenCalled();
    expect(checkFeature).not.toHaveBeenCalled();
  });
});

describe("CICD-06 AC3: a module's kill switch makes its routes «temporarily unavailable»; the rest works", () => {
  it.each(modulesWithRoutes)(
    "kill switch of %s → its routes answer 503 MODULE_UNAVAILABLE; others do not",
    async (module) => {
      const flags = fakeFlags({ killed: [module] });
      const app = await serve(flags);
      for (const route of protectedRoutes) {
        const res = await app.inject({
          method: route.method,
          url: concreteUrl(route),
          headers: principalHeader(),
        });
        if (route.module === module) {
          expect(res.statusCode, route.operationId).toBe(503);
          expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
          expect(res.json()).toMatchObject({ code: "MODULE_UNAVAILABLE", status: 503 });
          expect(res.headers["retry-after"]).toBe(String(MODULE_UNAVAILABLE_RETRY_AFTER_S));
        } else {
          expect(res.statusCode, route.operationId).not.toBe(503);
        }
      }
      for (const route of publicRoutes) {
        const res = await app.inject({ method: route.method, url: concreteUrl(route) });
        expect(res.statusCode, route.operationId).toBe(route.response.status);
      }
    },
  );

  it("the kill switch is checked first: without a session too, and nothing of the module runs", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const route = defineRoute({
      module: "things",
      method: "GET",
      path: "/v1/things",
      operationId: "listThingsKilled",
      summary: "x",
      access: { permission: "things.read", feature: "things" },
      response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
      handler,
    });
    const authenticate = vi.fn(testAuthenticate);
    const app = await testApp([route], { moduleAvailable: async (m) => m !== "things", authenticate });
    const res = await app.inject({ method: "GET", url: "/v1/things" });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("MODULE_UNAVAILABLE");
    expect(authenticate).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("the client contract documents 404 and 503 on every protected operation", async () => {
    const { buildOpenApi } = await import("../src/platform/http/openapi.ts");
    const doc = buildOpenApi(apiRoutes) as unknown as {
      paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
    };
    for (const route of protectedRoutes) {
      const op = doc.paths[route.path]![route.method.toLowerCase()]!;
      expect(Object.keys(op.responses), route.operationId).toEqual(expect.arrayContaining(["404", "503"]));
    }
  });
});

describe("DAT-05 AC7: a server error reaches telemetry without amounts, account names, names or emails", () => {
  const secrets = [
    "12 345,67",
    "UAH 98765.43",
    "Рахунок Приват Ольги",
    "Olha Kovalenko",
    "olha.k@example.com",
  ];

  class AccountSyncFailure extends Error {}

  const failing = defineRoute({
    module: "things",
    method: "POST",
    path: "/v1/things/{thingId}/sync",
    operationId: "syncThing",
    summary: "x",
    access: { permission: "things.write", feature: "things" },
    request: { params: z.object({ thingId: z.string() }), body: z.object({ note: z.string() }) },
    response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
    handler: async () => {
      throw new AccountSyncFailure(`sync of ${secrets.join(" / ")} failed`);
    },
  });

  it("the 500 problem and the error report hold only fixed, value-free fields", async () => {
    const reports: ErrorReport[] = [];
    const app = await testApp([failing], { reportError: (r) => reports.push(r) });
    const res = await app.inject({
      method: "POST",
      url: "/v1/things/olha.k@example.com/sync",
      headers: { ...principalHeader(), "content-type": "application/json" },
      payload: { note: secrets.join(" ") },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      type: "urn:willowsum:problem:internal",
      title: "Something went wrong on our side",
      status: 500,
      code: "INTERNAL",
    });
    expect(reports).toEqual([
      {
        method: "POST",
        route: "/v1/things/:thingId/sync",
        code: "INTERNAL",
        status: 500,
        errorClass: "AccountSyncFailure",
      },
    ]);
    const everything = res.body + JSON.stringify(reports);
    for (const secret of secrets) expect(everything).not.toContain(secret);
    expect(everything).not.toContain("@");
  });

  it("client errors and a switched-off module are not reported as server errors; a failing reporter changes nothing", async () => {
    const reports: ErrorReport[] = [];
    const app = await testApp([failing], { reportError: (r) => reports.push(r) });
    await app.inject({ method: "POST", url: "/v1/things/x/sync", headers: principalHeader(), payload: "{" });
    expect(reports).toEqual([]);
    const killed = await testApp([failing], {
      moduleAvailable: async () => false,
      reportError: (r) => reports.push(r),
    });
    expect((await killed.inject({ method: "POST", url: "/v1/things/x/sync" })).statusCode).toBe(503);
    expect(reports).toEqual([]);
    const throwing = await testApp([failing], {
      reportError: () => {
        throw new Error("telemetry down");
      },
    });
    const res = await throwing.inject({
      method: "POST",
      url: "/v1/things/x/sync",
      headers: { ...principalHeader(), "content-type": "application/json" },
      payload: { note: "n" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("INTERNAL");
  });
});

describe("CICD-06 / DAT-05: kill switch, session and flag answer before the body is read", () => {
  const createThing = defineRoute({
    module: "things",
    method: "POST",
    path: "/v1/things",
    operationId: "createThingEarly",
    summary: "x",
    access: { permission: "things.write", feature: "things" },
    request: { body: z.object({ name: z.string() }) },
    response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
    handler: async () => ({ ok: true }),
  });
  const bodies = [
    { "content-type": "text/plain", payload: "not json" },
    { "content-type": "application/json", payload: "{" },
    { "content-type": "application/xml", payload: "<a/>" },
    { "content-type": "application/json", payload: JSON.stringify({ name: "x".repeat(2_000_000) }) },
  ];

  it.each(bodies.map((b) => [b["content-type"], b] as const))(
    "%s body to a module that is switched off → 503 MODULE_UNAVAILABLE, not 415, 413 or 400",
    async (_, { payload, ...headers }) => {
      const app = await testApp([createThing], { moduleAvailable: async () => false });
      const res = await app.inject({
        method: "POST",
        url: "/v1/things",
        headers: { ...headers, ...principalHeader() },
        payload,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("MODULE_UNAVAILABLE");
    },
  );

  it.each(bodies.map((b) => [b["content-type"], b] as const))(
    "%s body to a function whose flag is off → the 404 of an unknown path, not 415, 413 or 400",
    async (_, { payload, ...headers }) => {
      const app = await testApp([createThing], { checkFlag: async () => false });
      const unknown = await app.inject({
        method: "POST",
        url: "/v1/no-such-function",
        headers: principalHeader(),
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/things",
        headers: { ...headers, ...principalHeader() },
        payload,
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(unknown.body);
    },
  );

  it("without a session the same body gets 401, not 415", async () => {
    const app = await testApp([createThing]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(res.statusCode).toBe(401);
  });

  it("when the function is on and the module available, the body is checked as before (415)", async () => {
    const app = await testApp([createThing]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/things",
      headers: { "content-type": "text/plain", ...principalHeader() },
      payload: "x",
    });
    expect(res.statusCode).toBe(415);
  });
});

describe("CICD-06: a route with its own flag is behind its feature's flag too", () => {
  const sub = defineRoute({
    module: "things",
    method: "GET",
    path: "/v1/things/export",
    operationId: "exportThings",
    summary: "x",
    access: { permission: "things.read", feature: "things", flag: "things.export" },
    response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
    handler: async () => ({ ok: true }),
  });

  it.each([
    [["things"], 404],
    [["things.export"], 404],
    [["things", "things.export"], 404],
    [[], 200],
  ] as const)("flags off %j → %i", async (off, status) => {
    const app = await testApp([sub], {
      flags: new Set(["things", "things.export"]),
      checkFlag: async (_p, flag) => !(off as readonly string[]).includes(flag),
    });
    expect(
      (await app.inject({ method: "GET", url: "/v1/things/export", headers: principalHeader() })).statusCode,
    ).toBe(status);
  });

  it("both flags must exist, or the API does not start", () => {
    expect(() =>
      registerApi(Fastify(), {
        ...apiOptions(testWiring()),
        routes: [
          {
            ...sub,
            access: { permission: "household.data.read", feature: "nope.feature", flag: "household.core" },
          } as ApiRoute,
        ],
      }),
    ).toThrow(/unknown (feature key|flag) nope\.feature/);
  });
});
