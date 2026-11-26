import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { kmsRewrapReport } from "../../../../scripts/lib/kms-rewrap.ts";
import { roleEnv } from "../../../../scripts/lib/local-dev.ts";
import { fileKeyManagement, fixedLabelSource, keyManagement } from "./index.ts";

/**
 * Security review of #726 (NFR-01@PoC FR 3, NFR-15@PoC FR 26): guards of the installation's key file and of the
 * real-data gate that no test of the PR failed for when they were weakened (mutants M2, M11, M14, M15, M17, M19, M21,
 * M23, M26 of the review). Paths are throwaway directories; keys are random and never printed.
 */
const SPACE = "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10";
const root = mkdtempSync(path.join(os.tmpdir(), "ws-sec726-"));
let n = 0;
const fresh = () => path.join(root, `inst-${++n}`, "local-kms-key.json");
const versionsOf = (file: string) =>
  (JSON.parse(readFileSync(file, "utf8")) as { versions: Record<string, string> }).versions;
afterEach(() => vi.restoreAllMocks());
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("NFR-01@PoC FR 3: guards of the installation's key file (security review of #726)", () => {
  it("NFR-01@PoC FR 3: a key file that belongs to another OS user stops the start", () => {
    const file = fresh();
    fileKeyManagement({ file });
    const uid = process.getuid!();
    vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
    expect(() => fileKeyManagement({ file })).toThrow(/belongs to another OS user/);
  });

  it("NFR-01@PoC FR 3: a folder that is a symbolic link into a git working tree is refused (the real place counts)", () => {
    const tree = path.join(root, "checkout");
    mkdirSync(path.join(tree, ".git"), { recursive: true });
    mkdirSync(path.join(tree, "keys"));
    const link = path.join(root, "looks-outside");
    symlinkSync(path.join(tree, "keys"), link);
    expect(() => fileKeyManagement({ file: path.join(link, "k.json") })).toThrow(/git working tree/);
    expect(existsSync(path.join(tree, "keys", "k.json"))).toBe(false);
  });

  it("NFR-01@PoC FR 3: every version is its own random 256-bit key: the first, a rotated one, another installation's", async () => {
    const a = fresh();
    const b = fresh();
    const ka = fileKeyManagement({ file: a });
    const kb = fileKeyManagement({ file: b });
    ka.rotate();
    kb.rotate();
    const [va, vb] = [versionsOf(a), versionsOf(b)];
    const all = [va["inst-1"]!, va["inst-2"]!, vb["inst-1"]!, vb["inst-2"]!];
    expect(new Set(all).size).toBe(4);
    for (const k of all) expect(Buffer.from(k, "base64")).toHaveLength(32);
    // A wrap of the rotated version opens with neither the earlier version's key nor the other installation's.
    const wrapped = await ka.wrap(randomBytes(32), { space: SPACE });
    expect(wrapped.masterKeyVersion).toBe("inst-2");
    await expect(kb.unwrap(wrapped, { space: SPACE })).rejects.toMatchObject({ kind: "rejected" });
    // All 32 bytes are drawn: over 24 installations no byte position keeps one value.
    const keys = Array.from({ length: 24 }, () => {
      const f = fresh();
      fileKeyManagement({ file: f });
      return Buffer.from(versionsOf(f)["inst-1"]!, "base64");
    });
    for (let i = 0; i < 32; i++) expect(new Set(keys.map((k) => k[i])).size).toBeGreaterThan(1);
  });

  it("NFR-01@PoC FR 3: a key file whose current version is retired is not a key file", () => {
    const file = fresh();
    fileKeyManagement({ file });
    const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...stored, retired: ["inst-1"] }), { mode: 0o600 });
    expect(() => fileKeyManagement({ file })).toThrow(/not a Willowsum local KMS key file/);
  });

  it("NFR-01@PoC FR 3: the fixed-label key of the re-wrap never wraps and names no current version", async () => {
    const source = fixedLabelSource();
    await expect(source.wrap(randomBytes(32), { space: SPACE })).rejects.toMatchObject({ kind: "rejected" });
    await expect(source.currentVersion()).rejects.toMatchObject({ kind: "rejected" });
  });
});

describe("NFR-01@PoC criterion «Шифрування при зберіганні»: the gate (security review of #726)", () => {
  it("NFR-01@PoC criterion «Шифрування при зберіганні»: a deployed process never opens or makes a key file, whatever it is given", async () => {
    const file = fresh();
    for (const mode of ["test", "live"] as const) {
      const kms = keyManagement(mode, () => ({}), { deployed: true, realData: true, keyFile: file });
      await expect(kms.wrap(randomBytes(32), { space: SPACE })).rejects.toMatchObject({
        kind: "unavailable",
      });
    }
    expect(existsSync(file)).toBe(false);
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: every process of `pnpm local:dev` is marked as real data and gets only the key file's path", () => {
    const kmsKeyFile = "/home/owner/.config/willowsum/local-kms-key.json";
    const env = roleEnv({
      port: 8083,
      databaseUrl: "postgres://ws_owner@127.0.0.1:5432/ws_dev",
      password: ["synthetic", "synthetic"].join("-"),
      modules: ["identity"],
      path: "/usr/bin",
      files: { kind: "directory", dir: "/home/owner/files" },
      fileLinkKey: randomBytes(32).toString("base64"),
      kmsKeyFile,
    });
    expect(env["WS_REAL_DATA"]).toBe("true");
    expect(env["WS_KMS_KEY_FILE"]).toBe(kmsKeyFile);
    expect(env["WS_PROVIDER_MODE"] ?? "test").toBe("test");
  });
});

describe("NFR-01@PoC criterion «Шифрування при зберіганні»: copies made before the re-wrap (security review of #726)", () => {
  it("NFR-01@PoC criterion «Шифрування при зберіганні»: when keys moved, the report tells the owner that earlier copies of the database stay open to the fixed-label key", () => {
    const moved = kmsRewrapReport({ dryRun: false }, { found: 2, rewrapped: 2, failed: 0 });
    expect(moved).toContain("Re-wrapped 2 of 2 space key(s)");
    expect(moved).toMatch(/made BEFORE this move/);
    expect(moved).toMatch(/delete those copies/);
    // Nothing moved, or a dry run: nothing to warn about.
    expect(kmsRewrapReport({ dryRun: false }, { found: 0, rewrapped: 0, failed: 0 })).not.toMatch(/BEFORE/);
    expect(kmsRewrapReport({ dryRun: true }, { found: 2, rewrapped: 0, failed: 0 })).not.toMatch(/BEFORE/);
  });
});

describe("NFR-01@PoC FR 3: the first start of several processes at once (security review of #726)", () => {
  it("NFR-01@PoC FR 3: processes that start together end with one key file; none overwrites another's key", async () => {
    const child = `
      import { fileKeyManagement } from ${JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url)))};
      const kms = fileKeyManagement({ file: process.argv.at(-1) });
      const w = await kms.wrap(Buffer.alloc(32, 4), { space: "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10" });
      process.stdout.write(Buffer.from(w.ciphertext).toString("base64"));`;
    for (let round = 0; round < 6; round++) {
      const file = path.join(root, `race-${round}`, "k.json");
      const outs = await Promise.all(
        Array.from({ length: 6 }, () => {
          const c = spawn(process.execPath, ["--input-type=module", "-e", child, "--", file], {
            stdio: ["ignore", "pipe", "ignore"],
          });
          let out = "";
          c.stdout!.on("data", (d) => (out += d));
          return new Promise<string>((resolve) => c.on("exit", () => resolve(out)));
        }),
      );
      const kms = fileKeyManagement({ file });
      for (const out of outs) {
        expect(out.length).toBeGreaterThan(0);
        const opened = await kms.unwrap(
          { masterKeyVersion: "inst-1", ciphertext: Buffer.from(out, "base64") },
          { space: "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10" },
        );
        expect(Buffer.from(opened)).toEqual(Buffer.alloc(32, 4));
      }
    }
  }, 120_000);
});
