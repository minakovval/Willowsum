import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { directoryObjectStorage } from "./directory.ts";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "ws-objects-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("CICD-04: the local directory object storage of pnpm local:dev without S3", () => {
  it("an object put by one process is read by another one on the same directory (the api stores, the worker parses)", async () => {
    const root = tempDir();
    const api = directoryObjectStorage(root);
    const worker = directoryObjectStorage(root);
    await api.put("spaces/s1/files/f1", Buffer.from("sealed bytes"));
    expect((await worker.get("spaces/s1/files/f1"))?.toString()).toBe("sealed bytes");
    await api.put("spaces/s1/files/f1", Buffer.from("replaced"));
    expect((await worker.get("spaces/s1/files/f1"))?.toString()).toBe("replaced");
    expect(await worker.get("spaces/s1/files/f2")).toBeNull();
  });

  it("lists keys under a prefix and deletes; deleting a missing object is no error", async () => {
    const root = tempDir();
    const s = directoryObjectStorage(root);
    await s.put("spaces/s1/files/b", Buffer.from("1"));
    await s.put("spaces/s1/files/a", Buffer.from("2"));
    await s.put("spaces/s2/files/c", Buffer.from("3"));
    expect(await s.list("spaces/s1/")).toEqual(["spaces/s1/files/a", "spaces/s1/files/b"]);
    expect(await s.list("")).toHaveLength(3);
    await s.delete("spaces/s1/files/a");
    await s.delete("spaces/s1/files/a");
    expect(await s.list("spaces/s1/")).toEqual(["spaces/s1/files/b"]);
    expect(await directoryObjectStorage(path.join(root, "none")).list("")).toEqual([]);
  });

  it("security: a key never leaves the directory and files are readable only by their owner", async () => {
    const root = tempDir();
    const s = directoryObjectStorage(root);
    for (const key of ["../x", "spaces/../../etc/passwd", "/abs", "Spaces/A", "a//b", "a/./b"]) {
      await expect(s.put(key, Buffer.from("x"))).rejects.toThrow();
      await expect(s.get(key)).rejects.toThrow();
      await expect(s.delete(key)).rejects.toThrow();
    }
    await expect(s.list("../")).rejects.toThrow();
    await s.put("spaces/s1/files/f1", Buffer.from("x"));
    expect(statSync(path.join(root, "spaces/s1/files/f1")).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(root, "spaces/s1/files")).mode & 0o777).toBe(0o700);
    // No temporary file is left behind.
    expect(readdirSync(path.join(root, "spaces/s1/files"))).toEqual(["f1"]);
    expect(() => directoryObjectStorage("relative/dir")).toThrow(/absolute/);
  });
});
