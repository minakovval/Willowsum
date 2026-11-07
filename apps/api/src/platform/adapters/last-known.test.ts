import { describe, expect, it } from "vitest";
import type { AdapterClock } from "./clock.ts";
import { ProviderError } from "./errors.ts";
import { createLastKnown, memoryLastKnownStore } from "./last-known.ts";

function clockAt(iso: string): AdapterClock & { set(iso: string): void } {
  let now = Date.parse(iso);
  return {
    now: () => now,
    setTimeout: () => undefined,
    clearTimeout: () => undefined,
    set: (next) => (now = Date.parse(next)),
  };
}

const down = (
  kind: "unavailable" | "timeout" | "circuit-open" | "invalid-response" | "rejected" = "unavailable",
) => Promise.reject(new ProviderError(kind, "probe", "probe.read"));

describe("ARC-05 FR 4: a provider failure does not block viewing — last known value with its date", () => {
  it("ARC-05 FR 4: a fresh value is returned and remembered with the moment it was obtained", async () => {
    const clock = clockAt("2026-11-06T09:00:00.000Z");
    const lastKnown = createLastKnown<string>({ clock });
    expect(await lastKnown.read("k", async () => "v1")).toEqual({
      value: "v1",
      asOf: "2026-11-06T09:00:00.000Z",
      stale: false,
    });
  });

  it("ARC-05 FR 4: when the provider fails, the last known value comes back marked stale with its date", async () => {
    const clock = clockAt("2026-11-06T09:00:00.000Z");
    const lastKnown = createLastKnown<string>({ clock });
    await lastKnown.read("k", async () => "v1");
    clock.set("2026-11-07T12:00:00.000Z");
    for (const kind of ["unavailable", "timeout", "circuit-open", "invalid-response"] as const) {
      expect(await lastKnown.read("k", () => down(kind))).toEqual({
        value: "v1",
        asOf: "2026-11-06T09:00:00.000Z",
        stale: true,
      });
    }
    // The next success replaces it.
    expect(await lastKnown.read("k", async () => "v2")).toEqual({
      value: "v2",
      asOf: "2026-11-07T12:00:00.000Z",
      stale: false,
    });
  });

  it("ARC-05 FR 4: with nothing remembered for the key, the provider error is passed on (the screen shows its error state)", async () => {
    const lastKnown = createLastKnown<string>();
    await lastKnown.read("other", async () => "v1");
    await expect(lastKnown.read("k", () => down())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("a refused request or a programming error is not hidden behind an old value", async () => {
    const lastKnown = createLastKnown<string>();
    await lastKnown.read("k", async () => "v1");
    await expect(lastKnown.read("k", () => down("rejected"))).rejects.toMatchObject({ kind: "rejected" });
    await expect(lastKnown.read("k", async () => Promise.reject(new TypeError("bug")))).rejects.toThrow(
      "bug",
    );
  });

  it("the in-memory store is bounded", async () => {
    const store = memoryLastKnownStore<number>(2);
    await store.set("a", { value: 1, asOf: "x" });
    await store.set("b", { value: 2, asOf: "x" });
    await store.set("c", { value: 3, asOf: "x" });
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("c")).toEqual({ value: 3, asOf: "x" });
  });
});
