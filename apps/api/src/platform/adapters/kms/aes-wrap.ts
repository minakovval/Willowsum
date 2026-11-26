import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ProviderError } from "../errors.ts";
import { checkDataKey, KMS_PORT, type WrapContext, type WrappedKey } from "./port.ts";

/**
 * The wrap both local adapters share (ARC-06 FR 1): AES-256-GCM from node:crypto, a 12-byte IV, a 16-byte tag, the
 * space bound as associated data. Layout of a wrap: IV, tag, ciphertext. Any failure to unwrap — an unknown or
 * retired version, a wrong space, a changed byte — is the same `ProviderError` «rejected», with nothing about the key.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function aad(context: WrapContext): Buffer {
  return Buffer.from(`space:${context.space}`, "utf8");
}

export function refused(op: "wrap" | "unwrap"): ProviderError {
  return new ProviderError("rejected", KMS_PORT.name, op);
}

export function wrapWith(
  masterKey: Buffer,
  version: string,
  dataKey: Uint8Array,
  context: WrapContext,
): WrappedKey {
  checkDataKey(dataKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(aad(context));
  const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return { masterKeyVersion: version, ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]) };
}

/** `masterKey` is the key of `wrapped.masterKeyVersion`, or undefined when that version may not unwrap. */
export function unwrapWith(
  masterKey: Buffer | undefined,
  wrapped: WrappedKey,
  context: WrapContext,
): Uint8Array {
  if (!masterKey) throw refused("unwrap");
  const bytes = Buffer.from(wrapped.ciphertext);
  if (bytes.length < IV_BYTES + TAG_BYTES + 1) throw refused("unwrap");
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, bytes.subarray(0, IV_BYTES));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const key = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
    checkDataKey(key);
    return key;
  } catch {
    throw refused("unwrap");
  }
}
