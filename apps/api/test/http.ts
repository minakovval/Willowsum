import Fastify, { type FastifyInstance } from "fastify";
import type { HouseholdQueryRunner, ModuleDatabase } from "../src/platform/db/module-db.ts";
import { registerApi, type ApiOptions } from "../src/platform/http/api.ts";
import type { IdempotencyBegin, IdempotencyStore } from "../src/platform/http/idempotency.ts";
import { routeFlags, type ApiRoute, type Principal } from "../src/platform/http/route.ts";

export const householdA = "3b9d7f0e-2c4a-4e8b-9a1d-6f5e4c3b2a01";
export const householdB = "9e8d7c6b-5a49-4382-8170-6f5e4d3c2b02";
export const userA = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c22";

export const PRINCIPAL_HEADER = "x-test-principal";

/** Test-only authentication: the principal travels in a header (identity, ACC-01, replaces this). */
export function principalHeader(principal: Partial<Principal> = {}): Record<string, string> {
  const full: Principal = {
    userId: userA,
    householdId: householdA,
    role: "owner",
    scoped: false,
    ...principal,
  };
  return { [PRINCIPAL_HEADER]: JSON.stringify(full) };
}

export const testAuthenticate: ApiOptions["authenticate"] = async (request) => {
  const raw = request.headers[PRINCIPAL_HEADER];
  return typeof raw === "string" ? (JSON.parse(raw) as Principal) : null;
};

/** A module database that records which household each transaction was bound to (no PostgreSQL). */
export function fakeDatabases(): { databases: ApiOptions["databases"]; bound: string[] } {
  const bound: string[] = [];
  const db = {
    inHousehold: async <T>(householdId: string, work: (q: HouseholdQueryRunner) => Promise<T>) => {
      bound.push(householdId);
      return work({ householdId, query: async () => ({ rows: [], rowCount: 0 }) as never });
    },
    transaction: async () => {
      throw new Error("not in unit tests");
    },
  } as unknown as ModuleDatabase;
  return { databases: { for: () => db }, bound };
}

/**
 * Flags and kill switches for unit tests: every flag on for every space, no module switched off, unless the
 * test turns some off. Records what was asked.
 */
export function fakeFlags(options: { off?: readonly string[]; killed?: readonly string[] } = {}): {
  isModuleAvailable(m: string): Promise<boolean>;
  isEnabled(h: string, f: string): Promise<boolean>;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    isModuleAvailable: async (module) => {
      asked.push(`module:${module}`);
      return !(options.killed ?? []).includes(module);
    },
    isEnabled: async (householdId, flag) => {
      asked.push(`flag:${flag}@${householdId}`);
      return !(options.off ?? []).includes(flag);
    },
  };
}

/** The wiring of src/api.ts for unit tests: fake databases, all plans enabled, all flags on. */
export function testWiring(flags = fakeFlags()) {
  return { databases: fakeDatabases().databases, entitlements: "all-enabled" as const, flags };
}

/** In-memory idempotency store with the same semantics as the table one (moduleIdempotencyStore). */
export function memoryIdempotency(): IdempotencyStore & { size(): number } {
  const rows = new Map<string, { hash: string; status?: number; body?: string }>();
  const id = (h: string, k: string) => `${h}\u0000${k}`;
  return {
    size: () => rows.size,
    begin: async (householdId, key, hash): Promise<IdempotencyBegin> => {
      const row = rows.get(id(householdId, key));
      if (!row) {
        rows.set(id(householdId, key), { hash });
        return { kind: "new" };
      }
      if (row.hash !== hash) return { kind: "mismatch" };
      if (row.status === undefined || row.body === undefined) return { kind: "in-progress" };
      return { kind: "replay", status: row.status, body: row.body };
    },
    complete: async (householdId, key, status, body) => {
      const row = rows.get(id(householdId, key));
      if (row) Object.assign(row, { status, body });
    },
    abandon: async (householdId, key) => {
      const row = rows.get(id(householdId, key));
      if (row && row.status === undefined) rows.delete(id(householdId, key));
    },
  };
}

/** The API options of unit tests: every check passes unless overridden; fake databases, memory idempotency. */
export function testApiOptions(routes: readonly ApiRoute[], overrides: Partial<ApiOptions> = {}): ApiOptions {
  const store = memoryIdempotency();
  return {
    routes,
    authenticate: testAuthenticate,
    checkPermission: () => true,
    checkFeature: async () => true,
    moduleAvailable: async () => true,
    checkFlag: async () => true,
    flags: new Set(routes.flatMap((r) => ("feature" in r.access ? routeFlags(r.access) : []))),
    // Test routes' own flags require their feature, as the catalogue would declare.
    flagRequires: (flag) => {
      for (const r of routes)
        if ("feature" in r.access && r.access.flag === flag && flag !== r.access.feature)
          return r.access.feature;
      return undefined;
    },
    permissions: new Set(routes.flatMap((r) => ("permission" in r.access ? [r.access.permission] : []))),
    features: new Set(routes.flatMap((r) => ("feature" in r.access ? [r.access.feature] : []))),
    databases: fakeDatabases().databases,
    idempotency: () => store,
    ...overrides,
  };
}

export async function testApp(
  routes: readonly ApiRoute[],
  overrides: Partial<ApiOptions> = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerApi(app, testApiOptions(routes, overrides));
  await app.ready();
  return app;
}
