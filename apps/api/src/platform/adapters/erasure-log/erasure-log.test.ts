import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ERASURE_LOG_IMPLEMENTATIONS,
  ERASURE_LOG_PORT,
  erasureLog,
  localErasureLog,
  type ErasureLogRecord,
} from "./index.ts";

/**
 * NFR-16@PoC FR 9 (ADR-0013): the log of erasure requests lives outside the main database, append-only, so that a
 * restore from a copy can re-apply every erasure made after the copy. The local implementation is a hash-chained
 * JSON-lines file; the live one (object storage in another EU region) is not built and fails closed.
 */
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-erasure-log-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const requested: ErasureLogRecord = {
  kind: "requested",
  requestId: "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10",
  accountId: "0b7e0a1e-2f43-4d0a-8f43-7a2e4c1b0d22",
  householdIds: ["5d2f3c1a-8b7e-4c6d-9a0b-1e2f3a4b5c6d"],
  at: "2026-11-13T10:00:00.000Z",
  dueAt: "2026-12-13T10:00:00.000Z",
};
const completed: ErasureLogRecord = {
  kind: "completed",
  requestId: requested.requestId,
  accountId: requested.accountId,
  householdIds: requested.householdIds,
  at: "2026-11-14T10:00:00.000Z",
};

describe("NFR-16@PoC FR 9: the erasure-request log outside the main database", () => {
  it("NFR-12@PoC FR 3: ships both implementations; the port is named for the kind of service", () => {
    expect(ERASURE_LOG_PORT.name).toBe("erasure-log");
    expect(typeof ERASURE_LOG_IMPLEMENTATIONS.test).toBe("function");
    expect(typeof ERASURE_LOG_IMPLEMENTATIONS.live).toBe("function");
  });

  it("NFR-12@PoC FR 3: records are appended and read back in order; a new instance reads the same file", async () => {
    const dir = tempDir();
    const log = localErasureLog({ dir });
    await log.append(requested);
    await log.append(completed);
    expect(await log.records()).toEqual([requested, completed]);
    expect(await localErasureLog({ dir }).records()).toEqual([requested, completed]);
    // Only the owner of the process may read it (ids only, but it outlives the erased data).
    expect(statSync(path.join(dir, "erasure-log.jsonl")).mode & 0o077).toBe(0);
  });

  it("NFR-12@PoC FR 3: an empty or missing log has no records", async () => {
    expect(await localErasureLog({ dir: tempDir() }).records()).toEqual([]);
  });

  it("NFR-12@PoC FR 3: a changed, removed or reordered line breaks the chain and the log refuses to be read", async () => {
    const dir = tempDir();
    const log = localErasureLog({ dir });
    await log.append(requested);
    await log.append(completed);
    const file = path.join(dir, "erasure-log.jsonl");
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    writeFileSync(file, `${lines[0]!.replace("2026-12-13", "2027-12-13")}\n${lines[1]}\n`);
    await expect(log.records()).rejects.toThrow(/chain/);
    writeFileSync(file, `${lines[1]}\n`);
    await expect(log.records()).rejects.toThrow(/chain/);
    await expect(log.append(requested)).rejects.toThrow(/chain/);
  });

  it("NFR-12@PoC FR 3: records hold only ids and times; anything else is refused before it is written", async () => {
    const log = localErasureLog({ dir: tempDir() });
    await expect(
      log.append({ ...requested, accountId: "olena@example.test" } as ErasureLogRecord),
    ).rejects.toThrow();
    await expect(
      log.append({ ...requested, email: "x@example.test" } as unknown as ErasureLogRecord),
    ).rejects.toThrow();
    expect(await log.records()).toEqual([]);
  });

  it("NFR-12@PoC FR 3: live is not built and fails closed; a deployed process never gets the local file", async () => {
    const live = erasureLog("live", { deployed: true }, () => ({ dir: tempDir() }));
    await expect(live.records()).rejects.toMatchObject({ kind: "unavailable" });
    await expect(live.append(requested)).rejects.toMatchObject({ kind: "unavailable" });
    const deployedTest = erasureLog("test", { deployed: true }, () => ({ dir: tempDir() }));
    await expect(deployedTest.records()).rejects.toMatchObject({ kind: "unavailable" });
    const local = erasureLog("test", { deployed: false }, () => ({ dir: tempDir() }));
    expect(await local.records()).toEqual([]);
  });
});
