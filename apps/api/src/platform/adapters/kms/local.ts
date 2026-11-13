import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { ProviderError } from "../errors.ts";
import { checkDataKey, KMS_PORT, type KeyManagement, type WrapContext, type WrappedKey } from "./port.ts";

/**
 * Local implementation of the KMS port (ARC-05 FR 2; `WS_PROVIDER_MODE=test`, local development and CI). AES-256-GCM
 * from node:crypto. The key of version `local-N` is derived with HKDF-SHA256 from a fixed label that is NOT a secret:
 * this implementation protects nothing and exists so that local data stays readable after a restart. Deployed
 * environments must run `live` (config.ts refuses another mode there). `rotate` and `retire` exist for the rotation
 * test (ARC-06 FR 3); they change only this instance.
 */
export interface LocalKeyManagement extends KeyManagement {
  /** Adds a master key version and makes it current; returns its name. */
  rotate(): string;
  /** Stops a version from unwrapping (as disabling it in the KMS would); the current version cannot be retired. */
  retire(version: string): void;
}

const LABEL = "willowsum local test KMS (not a secret)";
const VERSION_RE = /^local-([1-9][0-9]{0,5})$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function versionKey(version: string): Buffer {
  return Buffer.from(hkdfSync("sha256", LABEL, "", version, 32));
}

function aad(context: WrapContext): Buffer {
  return Buffer.from(`space:${context.space}`, "utf8");
}

export function localKeyManagement(): LocalKeyManagement {
  let current = 1;
  const retired = new Set<string>();
  const name = (n: number) => `local-${n}`;
  const refuse = (op: "wrap" | "unwrap") => new ProviderError("rejected", KMS_PORT.name, op);
  return {
    currentVersion: async () => name(current),
    async wrap(dataKey, context) {
      checkDataKey(dataKey);
      const version = name(current);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", versionKey(version), iv);
      cipher.setAAD(aad(context));
      const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return { masterKeyVersion: version, ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]) };
    },
    async unwrap(wrapped: WrappedKey, context) {
      const m = VERSION_RE.exec(wrapped.masterKeyVersion);
      if (!m || Number(m[1]) > current || retired.has(wrapped.masterKeyVersion)) throw refuse("unwrap");
      const bytes = Buffer.from(wrapped.ciphertext);
      if (bytes.length < IV_BYTES + TAG_BYTES + 1) throw refuse("unwrap");
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          versionKey(wrapped.masterKeyVersion),
          bytes.subarray(0, IV_BYTES),
        );
        decipher.setAAD(aad(context));
        decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        const key = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
        checkDataKey(key);
        return key;
      } catch {
        throw refuse("unwrap");
      }
    },
    rotate() {
      current += 1;
      return name(current);
    },
    retire(version) {
      if (version === name(current)) throw new Error("The current master key version cannot be retired");
      retired.add(version);
    },
  };
}
