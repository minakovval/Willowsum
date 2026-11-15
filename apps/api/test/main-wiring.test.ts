import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFlagRuntime,
  KILL_SWITCH_MAX_DELAY_MS,
} from "../src/modules/feature-flags/application/index.ts";
import { memoryFlagStore } from "../src/modules/feature-flags/application/memory-store.test-helper.ts";
import { FLAGS_DB_TIMEOUTS } from "../src/modules/feature-flags/index.ts";
import { realModules } from "./real-modules.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DEFAULT_CONCURRENCY } from "../src/platform/queue/index.ts";
import { contextPoolOptions, modulePoolOptions, modulePoolSize, readinessCheck } from "../src/wiring.ts";

/**
 * CICD-06 / ADR-0004: the wiring main.ts uses (src/wiring.ts), checked by its behaviour: the readiness probe
 * and the pool limits of the flag check. The api process end to end: security-cicd06.it.test.ts.
 */
describe("CICD-06: the readiness probe main.ts serves", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("api role: schema behind → schema-behind; never loaded → flags-not-loaded; fresh → ready; 60 s stale → flags-stale", async () => {
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const flags = createFlagRuntime(store);
    let pending = 1;
    const check = readinessCheck({ role: "api", pendingMigrations: async () => pending, flags });
    expect(await check()).toEqual({ ready: false, reason: "schema-behind" });
    pending = 0;
    store.fail = true;
    expect(await check()).toEqual({ ready: false, reason: "flags-not-loaded" });
    store.fail = false;
    expect(await check()).toEqual({ ready: true });
    store.fail = true;
    vi.setSystemTime(KILL_SWITCH_MAX_DELAY_MS);
    expect(await check()).toEqual({ ready: false, reason: "flags-stale" });
    store.fail = false;
    expect(await check()).toEqual({ ready: true });
  });

  it("worker and scheduler do not depend on the flags", async () => {
    const store = memoryFlagStore();
    store.fail = true;
    const flags = createFlagRuntime(store);
    for (const role of ["worker", "scheduler"] as const)
      expect(await readinessCheck({ role, pendingMigrations: async () => 0, flags })()).toEqual({
        ready: true,
      });
    expect(store.calls.snapshot).toBe(0);
  });

  it("a database error while counting migrations propagates (the probe answers database-unreachable)", async () => {
    const flags = createFlagRuntime(memoryFlagStore());
    const check = readinessCheck({
      role: "api",
      pendingMigrations: async () => {
        throw new Error("down");
      },
      flags,
    });
    await expect(check()).rejects.toThrow("down");
  });
});

describe("CICD-06: the flag check never hangs on the database", () => {
  const limits = { statement_timeout: 5_000, connectionTimeoutMillis: 5_000, query_timeout: 6_000 };

  it("the feature-flags pool and the binding pool get the 5 s statement and connection limits and a 6 s client limit", () => {
    expect(modulePoolOptions("feature-flags")).toEqual(limits);
    expect(contextPoolOptions()).toEqual(limits);
  });

  it("the client-side query_timeout is at most 6 s and above the server's statement_timeout (FLAGS_DB_TIMEOUTS)", () => {
    for (const options of [modulePoolOptions("feature-flags"), contextPoolOptions(), FLAGS_DB_TIMEOUTS]) {
      expect(options.query_timeout).toBeLessThanOrEqual(6_000);
      expect(options.statement_timeout).toBeLessThanOrEqual(5_000);
      expect(options.connectionTimeoutMillis).toBeLessThanOrEqual(5_000);
      expect(Number(options.query_timeout)).toBeGreaterThan(Number(options.statement_timeout));
    }
  });

  it("other module pools keep their defaults", () => {
    for (const m of realModules.filter((m) => m !== "feature-flags"))
      expect(modulePoolOptions(m), m).toEqual({});
  });
});

describe("ARC-04: the worker's module pools hold a connection for every job it runs, and one more (review of #174, N1)", () => {
  it("the worker role's pools get DEFAULT_CONCURRENCY + 1 connections; the api and the scheduler keep the default", () => {
    expect(modulePoolSize("worker")).toBe(DEFAULT_CONCURRENCY + 1);
    expect(modulePoolSize("api")).toBeUndefined();
    expect(modulePoolSize("scheduler")).toBeUndefined();
  });

  it("main.ts passes the role's pool size to ModuleDatabases", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/poolSize: modulePoolSize\(config\.role\)/);
  });
});

/**
 * BUD-01@PoC FR 12 (#277 item 2): a custom category is deleted only while empty, which the categories route asks of
 * every module that keeps category ids (`usage`). `usage: []` type-checks, so the wiring in main.ts is checked here:
 * every module with a `category_id` column in its migrations (other than categories) must be in the list.
 */
function modulesKeepingCategoryIds(): string[] {
  const root = new URL("../src/modules/", import.meta.url);
  return readdirSync(root)
    .filter((name) => name !== "categories")
    .filter((name) => {
      const dir = new URL(`${name}/adapters/db/migrations/`, root);
      return (
        existsSync(dir) &&
        readdirSync(dir).some(
          (f) => f.endsWith(".sql") && /\bcategory_id\b/.test(readFileSync(new URL(f, dir), "utf8")),
        )
      );
    });
}

/** The modules that keep category ids and are missing from the `usage` list of the source given. */
function categoryUsageGaps(mainSource: string, modules: readonly string[]): string[] {
  const list = /usage:\s*\[([^\]]*)\]/.exec(mainSource)?.[1] ?? "";
  return modules.filter((m) => !list.includes(`databases.for("${m}")`));
}

describe("BUD-01@PoC FR 12 (#277 item 2): main.ts wires the category usage of every module that keeps category ids", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

  it("BUD-01@PoC FR 12: the guard sees transactions as a module with category ids", () => {
    expect(modulesKeepingCategoryIds()).toContain("transactions");
  });

  it("BUD-01@PoC FR 12: an empty `usage: []` or a list without such a module is a gap", () => {
    expect(
      categoryUsageGaps("categories: createCategoriesServices({ usage: [] })", ["transactions"]),
    ).toEqual(["transactions"]);
    expect(categoryUsageGaps('usage: [createOtherUsage(databases.for("budget"))]', ["transactions"])).toEqual(
      ["transactions"],
    );
  });

  it("BUD-01@PoC FR 12: the `usage` list in main.ts holds every module with a category_id column", () => {
    expect(/usage:\s*\[\s*\S/.test(main)).toBe(true);
    expect(categoryUsageGaps(main, modulesKeepingCategoryIds())).toEqual([]);
  });
});
