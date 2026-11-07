import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFlagRuntime,
  KILL_SWITCH_MAX_DELAY_MS,
} from "../src/modules/feature-flags/application/index.ts";
import { memoryFlagStore } from "../src/modules/feature-flags/application/memory-store.test-helper.ts";
import { FLAGS_DB_TIMEOUTS } from "../src/modules/feature-flags/index.ts";
import { realModules } from "./real-modules.ts";
import { contextPoolOptions, modulePoolOptions, readinessCheck } from "../src/wiring.ts";

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
