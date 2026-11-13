import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { erasureLog, localErasureLog, type ErasureLogRecord } from "./index.ts";

/** Security review of PR #143 (NFR-16@PoC FR 9): the local erasure log. Synthetic ids only. */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function freshDir(): string {
  const parent = mkdtempSync(path.join(tmpdir(), "ws-sec143-log-"));
  dirs.push(parent);
  return path.join(parent, "log");
}
const requested = (): ErasureLogRecord => ({
  kind: "requested",
  requestId: randomUUID(),
  accountId: randomUUID(),
  householdIds: [randomUUID()],
  at: "2026-11-13T10:00:00.000Z",
  dueAt: "2026-12-13T10:00:00.000Z",
});

describe("sec143: the local erasure log", () => {
  it("is created owner-only: folder 0700, file 0600", async () => {
    const dir = freshDir();
    await localErasureLog({ dir }).append(requested());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, "erasure-log.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("refuses a record with an address or any other field than ids and times", async () => {
    const dir = freshDir();
    const withEmail = {
      ...requested(),
      email: "olena.synthetic@example.test",
    } as unknown as ErasureLogRecord;
    await expect(localErasureLog({ dir }).append(withEmail)).rejects.toThrow();
    expect(() => readFileSync(path.join(dir, "erasure-log.jsonl"))).toThrow();
  });

  it("detects a changed or reordered line", async () => {
    const dir = freshDir();
    const log = localErasureLog({ dir });
    const a = requested();
    await log.append(a);
    await log.append(requested());
    const file = path.join(dir, "erasure-log.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, `${lines[1]}\n${lines[0]}\n`);
    await expect(log.records()).rejects.toThrow(/chain is broken/);
    writeFileSync(file, `${lines[0]!.replace(a.accountId, randomUUID())}\n${lines[1]}\n`);
    await expect(log.records()).rejects.toThrow(/chain is broken/);
  });

  // Non-blocking: the chain has no anchor, so dropping the newest lines (e.g. a `completed` record, which `reapply`
  // needs after a restore) is not detected, though local.ts says «removed» lines are. Local implementation only; the
  // live log needs an anchor (retention lock / object versioning) or a count kept elsewhere.
  it.fails("detects that the newest line was removed", async () => {
    const dir = freshDir();
    const log = localErasureLog({ dir });
    await log.append(requested());
    await log.append(requested());
    const file = path.join(dir, "erasure-log.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    writeFileSync(file, `${lines[0]}\n`);
    await expect(log.records()).rejects.toThrow();
  });

  it("a deployed process never gets the local file, whatever the mode", async () => {
    for (const mode of ["test", "live"] as const) {
      const log = erasureLog(mode, { deployed: true }, () => ({ dir: freshDir() }));
      await expect(log.records()).rejects.toMatchObject({ kind: "unavailable" });
      await expect(log.append(requested())).rejects.toMatchObject({ kind: "unavailable" });
    }
    await expect(
      erasureLog("live", { deployed: false }, () => ({ dir: freshDir() })).records(),
    ).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
