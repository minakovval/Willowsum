// Security review of #619: a worker's message that is not an object is a crash of that worker, never an exception in
// the API's own thread (ARC-06@PoC FR 4).
import { afterEach, describe, expect, it, vi } from "vitest";
import { runIsolated } from "./isolated.ts";

describe("ARC-06@PoC FR 4: the runner survives any message of a worker", () => {
  it("ARC-06@PoC FR 4: a worker that posts a string is «crashed», with no uncaught exception in the API thread", async () => {
    const uncaught: unknown[] = [];
    const listener = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", listener);
    try {
      const outcome = await runIsolated(
        new URL("../../../test/fixtures/file-storage/string-worker.ts", import.meta.url),
        {},
        [],
        { memoryMb: 64, timeoutMs: 10_000 },
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(outcome).toEqual({ ok: false, failure: "crashed" });
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", listener);
    }
  }, 30_000);

  const probe = new URL("../../../test/fixtures/file-storage/probe-worker.ts", import.meta.url);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("ARC-06@PoC FR 4: the heap limit given is the worker's limit (200 MiB of heap under a 64 MiB limit is «memory»)", async () => {
    expect(await runIsolated(probe, { mode: "heap" }, [], { memoryMb: 64, timeoutMs: 60_000 })).toEqual({
      ok: false,
      failure: "memory",
    });
    expect(await runIsolated(probe, { mode: "heap" }, [], { memoryMb: 1024, timeoutMs: 60_000 })).toEqual({
      ok: true,
      value: 250,
    });
  }, 120_000);

  it("ARC-06@PoC FR 4: the worker gets no environment of the API process", async () => {
    vi.stubEnv("SEC619_PROBE", "x");
    expect(await runIsolated(probe, { mode: "env" }, [], { memoryMb: 64, timeoutMs: 10_000 })).toEqual({
      ok: true,
      value: [],
    });
  }, 30_000);

  it("ARC-06@PoC FR 4: what the worker prints never reaches the API's stdout or stderr", async () => {
    const written: string[] = [];
    const keep = (chunk: unknown) => (written.push(String(chunk)), true);
    vi.spyOn(process.stdout, "write").mockImplementation(keep);
    vi.spyOn(process.stderr, "write").mockImplementation(keep);
    const outcome = await runIsolated(probe, { mode: "print" }, [], { memoryMb: 64, timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 200));
    vi.restoreAllMocks();
    expect(outcome).toEqual({ ok: true, value: "printed" });
    expect(written.join("")).not.toContain("sec619-marker");
  }, 30_000);
});
