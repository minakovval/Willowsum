import { hkdfSync, randomBytes, createDecipheriv } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ConfigError } from "../../config/config.ts";
import { loadConfig } from "../../config/config.ts";
import {
  fileKeyManagement,
  fixedLabelSource,
  isFixedLabelVersion,
  keyManagement,
  KmsKeyFileError,
  localKeyManagement,
  RealDataKmsError,
} from "./index.ts";

/**
 * NFR-01@PoC FR 3, NFR-15@PoC FR 26 (the text of PR #722; security review of #722): the master key of an instance with
 * real data is a random 256-bit key of its installation, kept in a file outside the repository, the database and the
 * environment; the fixed-label test key is for tests and CI only, and an instance with real data does not start with
 * it. Paths are throwaway directories; keys are random.
 */
const SPACE = "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10";
const root = mkdtempSync(path.join(os.tmpdir(), "ws-kms-"));
let n = 0;
const fresh = () => path.join(root, `inst-${++n}`, "local-kms-key.json");
const REPO = fileURLToPath(new URL("../../../../../../", import.meta.url));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: ["synthetic", "synthetic", "synthetic"].join("-"),
  WS_DB_CONTEXT_PASSWORD: ["synthetic", "synthetic", "synthetic"].join("-"),
  WS_DB_PASSWORD_IDENTITY: ["synthetic", "synthetic", "synthetic"].join("-"),
};
const configError = (env: Record<string, string>, role = "worker") => {
  try {
    loadConfig({ ...base, ...env }, role, ["identity"]);
  } catch (error) {
    return error as ConfigError;
  }
  return undefined;
};

/** Every key the public repository gives: the fixed label with any version name. */
function unwrapWithFixedLabel(version: string, ciphertext: Uint8Array, space: string): boolean {
  const b = Buffer.from(ciphertext);
  try {
    const key = Buffer.from(hkdfSync("sha256", "willowsum local test KMS (not a secret)", "", version, 32));
    const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAAD(Buffer.from(`space:${space}`));
    d.setAuthTag(b.subarray(12, 28));
    Buffer.concat([d.update(b.subarray(28)), d.final()]);
    return true;
  } catch {
    return false;
  }
}

describe("NFR-01@PoC FR 3: the installation's random master key in a file", () => {
  it("NFR-01@PoC FR 3: the first start makes a random 256-bit key in a file only its user may read (0600, folder 0700)", async () => {
    const file = fresh();
    const kms = fileKeyManagement({ file });
    expect(await kms.currentVersion()).toBe("inst-1");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const stored = JSON.parse(readFileSync(file, "utf8")) as { versions: Record<string, string> };
    expect(Buffer.from(stored.versions["inst-1"]!, "base64")).toHaveLength(32);
  });

  it("NFR-01@PoC FR 3: two installations get different keys; a restart of one keeps its key", async () => {
    const a = fresh();
    const b = fresh();
    const key = randomBytes(32);
    const wrapped = await fileKeyManagement({ file: a }).wrap(key, { space: SPACE });
    // Same version name, another installation: its key is another random key.
    await expect(fileKeyManagement({ file: b }).unwrap(wrapped, { space: SPACE })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(Buffer.from(await fileKeyManagement({ file: a }).unwrap(wrapped, { space: SPACE }))).toEqual(key);
    expect(readFileSync(a, "utf8")).not.toBe(readFileSync(b, "utf8"));
  });

  it("NFR-01@PoC FR 3: a database copy together with the repository unwraps no space key", async () => {
    const kms = fileKeyManagement({ file: fresh() });
    const wrapped = await kms.wrap(randomBytes(32), { space: SPACE });
    // What a copy of the database holds: the version name and the wrap. The repository adds the fixed label.
    for (const version of [wrapped.masterKeyVersion, "local-1", "local-2", "inst-1", ""])
      expect(unwrapWithFixedLabel(version, wrapped.ciphertext, SPACE)).toBe(false);
    await expect(localKeyManagement().unwrap(wrapped, { space: SPACE })).rejects.toMatchObject({
      kind: "rejected",
    });
    await expect(fixedLabelSource().unwrap(wrapped, { space: SPACE })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(isFixedLabelVersion(wrapped.masterKeyVersion)).toBe(false);
  });

  it("NFR-01@PoC FR 3: the key is not read from an environment variable: only the file's path is configured", async () => {
    const file = fresh();
    const kms = fileKeyManagement({ file });
    const wrapped = await kms.wrap(Buffer.alloc(32, 9), { space: SPACE });
    const keyB64 = (JSON.parse(readFileSync(file, "utf8")) as { versions: Record<string, string> }).versions[
      "inst-1"
    ]!;
    // A key put in the environment under any name is ignored: the configuration keeps no such value.
    const env = {
      ...base,
      WS_KMS_KEY: keyB64,
      WS_KMS_MASTER_KEY: keyB64,
      WS_REAL_DATA: "true",
      WS_KMS_KEY_FILE: file,
    };
    const config = loadConfig(env, "worker", ["identity"]);
    expect(config.kms).toEqual({ realData: true, keyFile: file });
    expect(JSON.stringify(config)).not.toContain(keyB64);
    // The variable itself never takes a key: it is an absolute path, and a key in its place is refused.
    expect(configError({ WS_KMS_KEY_FILE: keyB64 })?.variables).toEqual(["WS_KMS_KEY_FILE"]);
    // Deterministic: a key-shaped value that starts with «/» (1 random key in 64) is refused too.
    const slashKey = `/${"A".repeat(42)}=`;
    expect(configError({ WS_KMS_KEY_FILE: slashKey })?.variables).toEqual(["WS_KMS_KEY_FILE"]);
    expect(configError({ WS_KMS_KEY_FILE: `${"B".repeat(43)}=` })?.variables).toEqual(["WS_KMS_KEY_FILE"]);
    // Another installation's file with the same environment does not open this wrap.
    const other = keyManagement("test", () => ({}), {
      deployed: false,
      ...loadConfig({ ...env, WS_KMS_KEY_FILE: fresh() }, "worker", ["identity"]).kms,
    });
    await expect(other.unwrap(wrapped, { space: SPACE })).rejects.toMatchObject({ kind: "rejected" });
  });

  it("NFR-01@PoC FR 3: a key file other users may read or write stops the start (chmod 600)", () => {
    const file = fresh();
    fileKeyManagement({ file });
    for (const mode of [0o644, 0o640, 0o604, 0o620, 0o602]) {
      chmodSync(file, mode);
      expect(() => fileKeyManagement({ file })).toThrow(/other users; run `chmod 600`/);
    }
    chmodSync(file, 0o600);
    expect(() => fileKeyManagement({ file })).not.toThrow();
  });

  it("NFR-01@PoC FR 3: a key file made group or world readable while running is refused at its next use", async () => {
    const file = fresh();
    const kms = fileKeyManagement({ file });
    chmodSync(file, 0o644);
    await expect(kms.wrap(randomBytes(32), { space: SPACE })).rejects.toMatchObject({ kind: "unavailable" });
    chmodSync(file, 0o600);
    await expect(kms.currentVersion()).resolves.toBe("inst-1");
  });

  it("NFR-01@PoC FR 3: a key file inside the repository or any git working tree stops the start", () => {
    expect(() => fileKeyManagement({ file: path.join(REPO, "infra/local/.state/kms.json") })).toThrow(
      /inside the repository/,
    );
    const tree = path.join(root, "some-checkout");
    mkdirSync(path.join(tree, ".git"), { recursive: true });
    expect(() => fileKeyManagement({ file: path.join(tree, "deep/kms.json") })).toThrow(/git working tree/);
    // A worktree (`.git` is a file there).
    const wt = path.join(root, "some-worktree");
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, ".git"), "gitdir: /elsewhere\n");
    expect(() => fileKeyManagement({ file: path.join(wt, "kms.json") })).toThrow(/git working tree/);
    expect(() => fileKeyManagement({ file: "relative/kms.json" })).toThrow(/absolute path/);
  });

  it("NFR-01@PoC FR 3: a symbolic link, a folder others may write and a file that is not a key file are refused", () => {
    const file = fresh();
    fileKeyManagement({ file });
    const link = path.join(path.dirname(file), "link.json");
    symlinkSync(file, link);
    expect(() => fileKeyManagement({ file: link })).toThrow(/symbolic link/);
    const open = path.join(root, "open-folder");
    mkdirSync(open, { mode: 0o700 });
    chmodSync(open, 0o777);
    expect(() => fileKeyManagement({ file: path.join(open, "k.json") })).toThrow(/directory can be written/);
    const junk = path.join(root, `junk-${++n}`, "k.json");
    mkdirSync(path.dirname(junk), { mode: 0o700 });
    writeFileSync(junk, "SECRET-LOOKING-CONTENT-0123456789", { mode: 0o600 });
    expect(() => fileKeyManagement({ file: junk })).toThrow(/not a Willowsum local KMS key file/);
  });

  it("NFR-01@PoC FR 3: no error names a key byte or the file's content", async () => {
    const file = fresh();
    const kms = fileKeyManagement({ file });
    const content = readFileSync(file, "utf8");
    const keyB64 = (JSON.parse(content) as { versions: Record<string, string> }).versions["inst-1"]!;
    const messages: string[] = [];
    const catchMessage = async (f: () => unknown) => {
      try {
        await f();
      } catch (error) {
        messages.push(
          String((error as Error).message),
          String((error as Error).stack),
          JSON.stringify(error),
        );
      }
    };
    chmodSync(file, 0o644);
    await catchMessage(() => fileKeyManagement({ file }));
    await catchMessage(() => kms.wrap(randomBytes(32), { space: SPACE }));
    chmodSync(file, 0o600);
    writeFileSync(file, content.replace('"current":"inst-1"', '"current":"inst-9"'));
    await catchMessage(() => fileKeyManagement({ file }));
    await catchMessage(() =>
      kms.unwrap({ masterKeyVersion: "inst-1", ciphertext: randomBytes(60) }, { space: SPACE }),
    );
    expect(messages.length).toBeGreaterThanOrEqual(8);
    for (const m of messages) {
      expect(m).not.toContain(keyB64);
      expect(m).not.toContain(Buffer.from(keyB64, "base64").toString("hex"));
    }
  });

  it("NFR-01@PoC FR 3: ARC-06 rotation adds a random version to the file; every process sees it; retire is kept", async () => {
    const file = fresh();
    const api = fileKeyManagement({ file });
    const worker = fileKeyManagement({ file });
    const old = await api.wrap(Buffer.alloc(32, 3), { space: SPACE });
    const next = api.rotate();
    expect(next).toBe("inst-2");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // The other process reads the changed file: it wraps with the new version and still opens the old one.
    expect(await worker.currentVersion()).toBe("inst-2");
    const newer = await worker.wrap(Buffer.alloc(32, 3), { space: SPACE });
    expect(newer.masterKeyVersion).toBe("inst-2");
    expect(Buffer.from(await api.unwrap(newer, { space: SPACE }))).toEqual(Buffer.alloc(32, 3));
    expect(Buffer.from(await worker.unwrap(old, { space: SPACE }))).toEqual(Buffer.alloc(32, 3));
    worker.retire("inst-1");
    await expect(api.unwrap(old, { space: SPACE })).rejects.toMatchObject({ kind: "rejected" });
    await expect(fileKeyManagement({ file }).unwrap(old, { space: SPACE })).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(() => api.retire("inst-2")).toThrow(/current/);
  });
});

describe("NFR-01@PoC criterion «Шифрування при зберіганні»: a real-data instance never runs with the fixed-label key", () => {
  it("NFR-01@PoC criterion «Шифрування при зберіганні»: WS_REAL_DATA=true without a key file does not start (every role)", () => {
    for (const role of ["api", "worker", "scheduler"])
      expect(configError({ WS_REAL_DATA: "true" }, role)?.variables).toContain("WS_KMS_KEY_FILE");
    expect(() => keyManagement("test", () => ({}), { deployed: false, realData: true })).toThrow(
      RealDataKmsError,
    );
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: with its key file it runs on the installation's key, not `local-N`", async () => {
    const file = fresh();
    const config = loadConfig({ ...base, WS_REAL_DATA: "true", WS_KMS_KEY_FILE: file }, "worker", [
      "identity",
    ]);
    const kms = keyManagement(config.providerMode, () => ({}), { deployed: config.deployed, ...config.kms });
    expect(await kms.currentVersion()).toBe("inst-1");
    expect(isFixedLabelVersion((await kms.wrap(randomBytes(32), { space: SPACE })).masterKeyVersion)).toBe(
      false,
    );
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: the fixed-label key stays for tests and CI (no real-data mark)", async () => {
    const config = loadConfig(base, "worker", ["identity"]);
    expect(config.kms).toEqual({ realData: false });
    const kms = keyManagement(config.providerMode, () => ({}), { deployed: false, ...config.kms });
    expect(await kms.currentVersion()).toBe("local-1");
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: a key file of this machine is never a deployed master key", () => {
    for (const environment of ["staging", "production"])
      expect(
        configError({ WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off", WS_KMS_KEY_FILE: fresh() })
          ?.variables,
      ).toContain("WS_KMS_KEY_FILE");
  });

  it("NFR-01@PoC criterion «Шифрування при зберіганні»: a key file that may not be used stops the start with KmsKeyFileError", () => {
    const file = fresh();
    fileKeyManagement({ file });
    chmodSync(file, 0o666);
    expect(() =>
      keyManagement("test", () => ({}), { deployed: false, realData: true, keyFile: file }),
    ).toThrow(KmsKeyFileError);
  });
});

describe("NFR-01@PoC FR 3: only the checked re-wrap step makes a key file (review of #726)", () => {
  it("NFR-01@PoC FR 3: a process (createKeyFile: false) with a missing key file does not start and makes no file", () => {
    const file = fresh();
    expect(() =>
      keyManagement("test", () => ({}), {
        deployed: false,
        realData: true,
        keyFile: file,
        createKeyFile: false,
      }),
    ).toThrow(/does not exist; put your saved copy/);
    expect(() => statSync(file)).toThrow();
    // The re-wrap step (create allowed) makes it; then the process opens it.
    fileKeyManagement({ file });
    expect(() =>
      keyManagement("test", () => ({}), {
        deployed: false,
        realData: true,
        keyFile: file,
        createKeyFile: false,
      }),
    ).not.toThrow();
  });
});

describe("NFR-15@PoC FR 26: the master key only through the KMS port, from the local adapter", () => {
  it("NFR-15@PoC FR 26: real data — the installation's random key outside the repository, database and environment", async () => {
    const file = fresh();
    expect(path.relative(REPO, file).startsWith("..")).toBe(true);
    const kms = keyManagement("test", () => ({}), { deployed: false, realData: true, keyFile: file });
    const wrapped = await kms.wrap(randomBytes(32), { space: SPACE });
    expect(unwrapWithFixedLabel(wrapped.masterKeyVersion, wrapped.ciphertext, SPACE)).toBe(false);
  });

  it("NFR-15@PoC FR 26: the fixed-label key only for tests and CI: refused for real data", () => {
    expect(() => keyManagement("test", () => ({}), { deployed: false, realData: true })).toThrow(
      /WS_KMS_KEY_FILE/,
    );
  });
});
