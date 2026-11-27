import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { roleEnv } from "../../../../scripts/lib/local-dev.ts";
import { topologicalOrder, type ModuleRules } from "../../modules/rules.ts";

/**
 * Security review of #726, confirmation round (mutant M8: main.ts `createKeyFile: false` → true survived every test):
 * a role process started with a missing key file stops before it opens anything and makes no key file, so only the
 * checked re-wrap step can make one. The process exits at the KMS step, before any database connection.
 */
const apiDir = fileURLToPath(new URL("../../../../", import.meta.url));
const rules = JSON.parse(readFileSync(path.join(apiDir, "module-rules.json"), "utf8")) as ModuleRules;
const root = mkdtempSync(path.join(os.tmpdir(), "ws-sec726-main-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("NFR-01@PoC FR 3, NFR-15@PoC FR 26: a role process never makes the key file (security review of #726)", () => {
  it("NFR-01@PoC FR 3, NFR-15@PoC FR 26: `main.ts --role api` with a missing key file exits 1, names the file only and makes no file", () => {
    const kmsKeyFile = path.join(root, "inst", "local-kms-key.json");
    const env = roleEnv({
      port: 8081,
      databaseUrl: "postgres://ws_owner@127.0.0.1:9/ws_none",
      password: ["synthetic", "synthetic"].join("-"),
      modules: topologicalOrder(rules),
      path: process.env["PATH"] ?? "/usr/bin",
      files: { kind: "directory", dir: path.join(root, "files") },
      fileLinkKey: randomBytes(32).toString("base64"),
      kmsKeyFile,
    });
    const res = spawnSync(process.execPath, [path.join(apiDir, "src/main.ts"), "--role", "api"], {
      cwd: apiDir,
      env: { ...env, HOME: root },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("does not exist; put your saved copy");
    expect(existsSync(kmsKeyFile)).toBe(false);
    expect(existsSync(path.dirname(kmsKeyFile))).toBe(false);
  });
});
