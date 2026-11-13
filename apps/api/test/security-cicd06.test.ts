import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { apiOptions, apiRoutes } from "../src/api.ts";
import { bucketOf } from "../src/modules/feature-flags/index.ts";
import { createFlagAdmin, createFlagRuntime } from "../src/modules/feature-flags/application/index.ts";
import { memoryFlagStore } from "../src/modules/feature-flags/application/memory-store.test-helper.ts";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import { fastifyPath, isPublic, routeFlag, routeFlags, type ApiRoute } from "../src/platform/http/route.ts";
import { fakeFlags, householdA, householdB, principalHeader, testAuthenticate, testWiring } from "./http.ts";

/**
 * Security review of CICD-06 / DAT-05 (PR #82): properties the PR's own tests did not pin — each test here
 * kills a mutant that survived them (named in the test).
 */

const protectedRoutes = apiRoutes.filter((r) => !isPublic(r.access));
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

/** Everything a client sees of a response except the clock. */
function visible(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
  const headers = { ...res.headers };
  delete headers["date"];
  return { status: res.statusCode, headers, body: res.body };
}

describe("DAT-05 FR 7: a function whose flag is off is indistinguishable from a path that does not exist", () => {
  // Mutant: an extra response header on the flag 404 (e.g. `x-feature: off`) — the PR's test compares the body only.
  it.each(protectedRoutes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: status, every header and the body equal those of an unknown path",
    async (_, route) => {
      if (isPublic(route.access)) return;
      const app = await serve(fakeFlags({ off: [routeFlag(route.access)] }));
      const unknown = await app.inject({
        method: route.method,
        url: "/v1/no-such-function",
        headers: principalHeader(),
      });
      const hidden = await app.inject({
        method: route.method,
        url: concreteUrl(route),
        headers: principalHeader(),
      });
      expect(visible(hidden)).toEqual(visible(unknown));
    },
  );
});

describe("CICD-06 FR 3: the kill-switch 503 says nothing but «temporarily unavailable»", () => {
  // Mutant: a detail naming the module (`module access-scope is switched off`) — the PR's test uses toMatchObject.
  it.each(modulesWithRoutes)(
    "kill switch of %s: a fixed body and headers that name no module",
    async (module) => {
      const app = await serve(fakeFlags({ killed: [module] }));
      for (const route of protectedRoutes.filter((r) => r.module === module)) {
        for (const headers of [{}, principalHeader()]) {
          const res = await app.inject({ method: route.method, url: concreteUrl(route), headers });
          expect(res.statusCode).toBe(503);
          expect(res.json()).toEqual({
            type: "urn:willowsum:problem:module-unavailable",
            title: "This function is temporarily unavailable",
            status: 503,
            code: "MODULE_UNAVAILABLE",
          });
          expect(Object.keys(res.headers).sort()).toEqual(
            ["connection", "content-length", "content-type", "date", "retry-after"].sort(),
          );
          expect(JSON.stringify(res.headers) + res.body).not.toContain(module);
        }
      }
    },
  );
});

describe("CICD-06 FR 3: a kill switch reaches every process within the documented 15 s", () => {
  // Mutant: REFRESH_MS = 60_000 — the PR's tests only check ≤ 60 s and advance by REFRESH_MS itself.
  it("with the default runtime options a kill switch is in force 15 s after it is stored, not later", async () => {
    const store = memoryFlagStore();
    let t = 1_000_000;
    const runtime = createFlagRuntime(store, { now: () => t });
    expect(await runtime.isModuleAvailable("access-scope")).toBe(true);
    await store.setKillSwitch("access-scope", true);
    t += 15_000;
    expect(await runtime.isModuleAvailable("access-scope")).toBe(false);
  });
});

describe("CICD-06 FR 1: the flag decision depends on the session's own space only", () => {
  // Mutant: the test-space cache keyed by anything but the space id — one space's mark leaks to another.
  it("one space's test mark never answers for another space", async () => {
    const store = memoryFlagStore();
    const runtime = createFlagRuntime(store, { now: () => 1_000_000 });
    await store.setRollout("household.core", { stage: "test" });
    store.testHouseholds.add(householdA);
    expect(await runtime.isEnabled(householdA, "household.core")).toBe(true);
    expect(await runtime.isEnabled(householdB, "household.core")).toBe(false);
    expect(await runtime.enabledFlags(householdB)).toEqual([]);
  });

  // Mutant: a bucket of part of the id (e.g. its first 8 characters) — the PR's distribution tests still pass.
  it("the rollout bucket is FNV-1a of «<flag>:<the whole space id>» (known answers)", () => {
    expect(bucketOf("household.core", "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01")).toBe(21);
    expect(bucketOf("household.core", "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a02")).toBe(64);
    expect(bucketOf("household.core", "9e8d7c6b-5a49-4382-8170-6f5e4d3c2b02")).toBe(97);
    expect(bucketOf("x.new", "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01")).toBe(93);
  });

  it("the API asks the flag for the session's space, whatever the request carries", async () => {
    const flags = fakeFlags();
    const app = await serve(flags);
    for (const route of protectedRoutes) {
      await app.inject({
        method: route.method,
        url: `${concreteUrl(route)}?householdId=${householdB}`,
        headers: { ...principalHeader(), "x-household-id": householdB },
      });
    }
    const asked = flags.asked.filter((a) => a.startsWith("flag:"));
    // One check per flag a route is behind: its feature's flag, and a sub-function's own flag (routeFlags).
    expect(asked.length).toBe(
      protectedRoutes.reduce((n, r) => n + ("feature" in r.access ? routeFlags(r.access).length : 0), 0),
    );
    expect(asked.every((a) => a.endsWith(`@${householdA}`))).toBe(true);
  });
});

describe("П-10 / CICD-06: the platform log never holds a space", () => {
  // Mutant: setTestHousehold also writes to the platform log (a household id outside the household policy).
  it("marking a test space writes only that space's own log, nothing to the platform log", async () => {
    const store = memoryFlagStore();
    const audit = {
      record: vi.fn(async () => ({}) as never),
      recordPlatform: vi.fn(async () => ({}) as never),
    };
    const admin = createFlagAdmin({ store, audit, modules: ["access-scope"] });
    const staff = { kind: "staff" as const, id: "1e2d3c4b-5a69-4788-9a6b-5c4d3e2f1a07" };
    await admin.setTestHousehold(staff, householdA, true);
    await admin.setTestHousehold(staff, householdA, false);
    await admin.setRollout(staff, "household.core", { stage: "test" });
    await admin.setKillSwitch(staff, "access-scope", true);
    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.recordPlatform).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.recordPlatform.mock.calls)).not.toContain(householdA);
  });
});
