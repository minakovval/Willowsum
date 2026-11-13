import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors.ts";
import { KMS_IMPLEMENTATIONS, KMS_PORT, keyManagement, localKeyManagement } from "./index.ts";

/** ARC-06@PoC FR 1: the master key only through the KMS port; a local implementation for development and CI. */
const SPACE = "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10";
const OTHER = "0b7e0a1e-2f43-4d0a-8f43-7a2e4c1b0d22";

describe("ARC-06@PoC FR 1: the KMS port", () => {
  it("ARC-06@PoC FR 1: ships both implementations; WS_PROVIDER_MODE picks the local one unless live", () => {
    expect(typeof KMS_IMPLEMENTATIONS.test).toBe("function");
    expect(typeof KMS_IMPLEMENTATIONS.live).toBe("function");
    expect(KMS_PORT.name).toBe("key-management");
    expect(Object.keys(KMS_PORT.operations).sort()).toEqual(["currentVersion", "unwrap", "wrap"]);
  });

  it("ARC-06@PoC FR 1: a data key wraps and unwraps; the wrap is not the key and differs each time", async () => {
    const kms = localKeyManagement();
    const key = randomBytes(32);
    const a = await kms.wrap(key, { space: SPACE });
    const b = await kms.wrap(key, { space: SPACE });
    expect(a.masterKeyVersion).toBe(await kms.currentVersion());
    expect(Buffer.from(a.ciphertext).includes(key)).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(Buffer.from(await kms.unwrap(a, { space: SPACE })).equals(key)).toBe(true);
  });

  it("ARC-06@PoC FR 1: a wrap is bound to its space: another space's context does not unwrap it", async () => {
    const kms = localKeyManagement();
    const wrapped = await kms.wrap(randomBytes(32), { space: SPACE });
    await expect(kms.unwrap(wrapped, { space: OTHER })).rejects.toThrow(ProviderError);
  });

  it("ARC-06@PoC FR 1: a tampered wrap is refused", async () => {
    const kms = localKeyManagement();
    const wrapped = await kms.wrap(randomBytes(32), { space: SPACE });
    const bytes = Buffer.from(wrapped.ciphertext);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await expect(kms.unwrap({ ...wrapped, ciphertext: bytes }, { space: SPACE })).rejects.toMatchObject({
      kind: "rejected",
    });
  });

  it("ARC-06@PoC FR 1: the local master key survives a restart (a new instance unwraps an old wrap)", async () => {
    const wrapped = await localKeyManagement().wrap(Buffer.alloc(32, 7), { space: SPACE });
    expect(Buffer.from(await localKeyManagement().unwrap(wrapped, { space: SPACE }))).toEqual(
      Buffer.alloc(32, 7),
    );
  });

  it("ARC-06@PoC FR 3: rotation adds a version; old wraps still unwrap until that version is retired", async () => {
    const kms = localKeyManagement();
    const old = await kms.wrap(Buffer.alloc(32, 1), { space: SPACE });
    const next = kms.rotate();
    expect(next).not.toBe(old.masterKeyVersion);
    expect(await kms.currentVersion()).toBe(next);
    expect((await kms.wrap(Buffer.alloc(32, 1), { space: SPACE })).masterKeyVersion).toBe(next);
    expect(Buffer.from(await kms.unwrap(old, { space: SPACE }))).toEqual(Buffer.alloc(32, 1));
    kms.retire(old.masterKeyVersion);
    await expect(kms.unwrap(old, { space: SPACE })).rejects.toMatchObject({ kind: "rejected" });
    expect(() => kms.retire(next)).toThrow();
  });

  it("ARC-06@PoC FR 1: only 32-byte data keys are wrapped", async () => {
    await expect(localKeyManagement().wrap(randomBytes(16), { space: SPACE })).rejects.toThrow();
  });

  it("ARC-06@PoC FR 1: the live implementation is not built yet and fails closed on every call", async () => {
    const kms = keyManagement("live", () => ({}), { deployed: false });
    await expect(kms.currentVersion()).rejects.toMatchObject({ kind: "unavailable" });
    await expect(kms.wrap(randomBytes(32), { space: SPACE })).rejects.toMatchObject({ kind: "unavailable" });
    const local = keyManagement("test", () => ({}), { deployed: false });
    expect(await local.currentVersion()).toMatch(/^local-\d+$/);
  });
});
