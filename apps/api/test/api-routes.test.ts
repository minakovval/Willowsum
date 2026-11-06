import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { apiOptions, apiRoutes } from "../src/api.ts";
import { can, PERMISSION_KEYS, ROLES } from "../src/modules/access-scope/index.ts";
import { modules } from "../src/modules/index.ts";
import { FEATURE_KEYS } from "../src/modules/plan-catalog/index.ts";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { IDEMPOTENCY_TABLE_SQL } from "../src/platform/http/idempotency.ts";
import { fastifyPath, isPublic, type ApiRoute } from "../src/platform/http/route.ts";
import { fakeDatabases, principalHeader, testAuthenticate } from "./http.ts";

/**
 * ARC-07 criterion «маршрут без перевірки прав і плану — 0»: an automated permission test for every role on
 * every route. It walks the routes the API really serves (src/api.ts), so a new route is covered without
 * writing a test, and a route that skips a check fails here.
 */

/** Routes that may be called without a session; each serves no household data. Adding one is a reviewed change. */
const PUBLIC_ROUTES = ["getMeta"];

const members = [
  ...ROLES.map((role) => ({ role, scoped: false })),
  ...ROLES.map((role) => ({ role, scoped: true })),
];

function concreteUrl(route: ApiRoute): string {
  // Any value: validation runs after the checks, so a wrong one is 400, never 401/402/403.
  return fastifyPath(route.path).replace(/:([A-Za-z]+)/g, "00000000-0000-4000-8000-000000000000");
}

async function serve(overrides: Partial<ApiOptions>) {
  const app = Fastify({ logger: false });
  registerApi(app, {
    ...apiOptions({ databases: fakeDatabases().databases, entitlements: "all-enabled" }),
    authenticate: testAuthenticate,
    ...overrides,
  });
  await app.ready();
  return app;
}

const protectedRoutes = apiRoutes.filter((r) => !isPublic(r.access));

describe("ARC-07 criterion «маршрут без перевірки прав і плану — 0»", () => {
  it("the API serves routes, and only the listed ones are public", () => {
    expect(protectedRoutes.length).toBeGreaterThan(0);
    expect(apiRoutes.filter((r) => isPublic(r.access)).map((r) => r.operationId)).toEqual(PUBLIC_ROUTES);
  });

  it("every protected route names a permission of access-scope and a feature key of plan-catalog", () => {
    for (const route of protectedRoutes) {
      if (isPublic(route.access)) continue;
      expect(PERMISSION_KEYS, route.operationId).toContain(route.access.permission);
      expect(FEATURE_KEYS, route.operationId).toContain(route.access.feature);
    }
  });

  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: without a session → 401",
    async (_, route) => {
      const app = await serve({});
      const res = await app.inject({ method: route.method, url: concreteUrl(route) });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHENTICATED");
    },
  );

  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: every role, scoped or not, gets exactly what access-scope allows; the check is made with the route's permission",
    async (_, route) => {
      if (isPublic(route.access)) return;
      const permission = route.access.permission;
      const checkPermission = vi.fn(
        apiOptions({ databases: fakeDatabases().databases, entitlements: "all-enabled" }).checkPermission,
      );
      const app = await serve({ checkPermission });
      for (const member of members) {
        const res = await app.inject({
          method: route.method,
          url: concreteUrl(route),
          headers: principalHeader(member),
        });
        const label = `${member.role}${member.scoped ? " (scoped)" : ""}`;
        if (can(member, permission)) expect([401, 402, 403], label).not.toContain(res.statusCode);
        else {
          expect(res.statusCode, label).toBe(403);
          expect(res.json().code, label).toBe("FORBIDDEN");
        }
      }
      expect(checkPermission).toHaveBeenCalledTimes(members.length);
      for (const call of checkPermission.mock.calls) expect(call[1]).toBe(permission);
    },
  );

  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: when the plan does not include its feature → 402 PLAN_LIMIT_REACHED, checked with the route's feature key",
    async (_, route) => {
      if (isPublic(route.access)) return;
      const checkFeature = vi.fn(async () => false);
      const app = await serve({ checkFeature });
      const res = await app.inject({
        method: route.method,
        url: concreteUrl(route),
        headers: principalHeader({ role: "owner" }),
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().code).toBe("PLAN_LIMIT_REACHED");
      expect(checkFeature).toHaveBeenCalledWith(
        expect.objectContaining({ role: "owner" }),
        route.access.feature,
      );
    },
  );

  it("a route with a permission access-scope does not know is refused at start (the check cannot be skipped)", () => {
    const route = protectedRoutes[0]!;
    const rogue = {
      ...route,
      operationId: "rogue",
      path: "/v1/rogue",
      access: { permission: "anything.goes", feature: "household.core" },
    };
    expect(() =>
      registerApi(Fastify(), {
        ...apiOptions({ databases: fakeDatabases().databases, entitlements: "all-enabled" }),
        routes: [rogue],
      }),
    ).toThrow(/unknown permission anything\.goes/);
  });
});

describe("ARC-07 FR 4: every module with create routes stores idempotency keys in its own schema", () => {
  it("each such module ships the idempotency_keys migration verbatim", () => {
    for (const m of modules.filter((m) => (m.routes ?? []).some((r) => r.create))) {
      const dir = path.join(import.meta.dirname, "../src/modules", m.name, "adapters/db/migrations");
      const sql = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => readFileSync(path.join(dir, f), "utf8"));
      expect(
        sql.some((s) => s.includes(IDEMPOTENCY_TABLE_SQL.trim())),
        m.name,
      ).toBe(true);
    }
  });
});
