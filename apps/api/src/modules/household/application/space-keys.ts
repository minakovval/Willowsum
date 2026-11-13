import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { KeyManagement } from "../../../platform/adapters/kms/index.ts";
import { keyRef, SpaceKeyError, type StoredSpaceKey } from "../domain/index.ts";
import type { SpacesStore } from "./spaces.ts";

/**
 * Keys of spaces (ARC-06@PoC FR 1, FR 2, FR 3, FR 5; ADR-0012): envelope encryption. A space's 256-bit data key is
 * made when the space is, wrapped by the master key through the KMS port and stored only as that wrap. Sensitive
 * fields are sealed with it (AES-256-GCM, bound to their space and field). The daily task rewraps keys after a master
 * key rotation; destroying a key leaves the space's sealed values unreadable. Keys are never logged or cached.
 */

export interface SpaceKeyAudit {
  /** A space made before keys existed got its key (the space's own log). */
  keyProvisioned(householdId: string, keyId: string, before: string, after: string): Promise<void>;
  /** A space's key was destroyed (the platform log: the space's own log goes with the space). */
  keyDestroyed(keyId: string): Promise<void>;
}

export interface SpaceKeysDeps {
  readonly store: SpacesStore;
  readonly kms: KeyManagement;
  readonly audit: SpaceKeyAudit;
}

export interface RewrapResult {
  /** Keys moved to the current master key version. */
  readonly rewrapped: number;
  /** Spaces that had no key yet (`pending:`) and got one. */
  readonly provisioned: number;
  /** Spaces whose key could not be rewrapped or made this run (the next run tries again). */
  readonly failed: number;
}

const SEAL_PREFIX = "ws1.";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FIELD_RE = /^[a-z][A-Za-z0-9_.]{0,62}$/;
const SEALED_RE = /^ws1\.[A-Za-z0-9_-]{38,}$/;
/** The longest value one field may seal (characters). */
export const SEAL_MAX_LENGTH = 4096;

/** A new data key for a space, wrapped through the KMS; the key itself is wiped once wrapped. */
export async function newSpaceKey(kms: KeyManagement, householdId: string): Promise<StoredSpaceKey> {
  const dataKey = randomBytes(32);
  try {
    const wrapped = await kms.wrap(dataKey, { space: householdId });
    return {
      keyId: randomUUID(),
      masterKeyVersion: wrapped.masterKeyVersion,
      wrappedKey: Buffer.from(wrapped.ciphertext).toString("base64url"),
    };
  } finally {
    dataKey.fill(0);
  }
}

function aad(householdId: string, field: string): Buffer {
  return Buffer.from(`household:${householdId}|field:${field}`, "utf8");
}

function checkField(field: string): void {
  if (!FIELD_RE.test(field)) throw new Error("A sealed field is named like an audit field (camelCase, ≤ 63)");
}

async function withDataKey<T>(
  deps: SpaceKeysDeps,
  householdId: string,
  work: (key: Buffer) => T,
): Promise<T> {
  const { ref, key } = await deps.store.inSpace(householdId, async (tx) => ({
    ref: await tx.encryptionKeyRef(householdId),
    key: await tx.spaceKey(householdId),
  }));
  if (!key)
    throw new SpaceKeyError(
      ref?.startsWith(keyRef.destroyedPrefix) ? "SPACE_KEY_DESTROYED" : "SPACE_KEY_MISSING",
    );
  const dataKey = Buffer.from(
    await deps.kms.unwrap(
      { masterKeyVersion: key.masterKeyVersion, ciphertext: Buffer.from(key.wrappedKey, "base64url") },
      { space: householdId },
    ),
  );
  try {
    return work(dataKey);
  } finally {
    dataKey.fill(0);
  }
}

/** ARC-06 FR 2: a sensitive value sealed with its space's key, bound to the space and the field. */
export async function sealField(
  deps: SpaceKeysDeps,
  householdId: string,
  field: string,
  plaintext: string,
): Promise<string> {
  checkField(field);
  if (plaintext.length > SEAL_MAX_LENGTH)
    throw new Error(`A sealed value is at most ${SEAL_MAX_LENGTH} characters`);
  return withDataKey(deps, householdId, (key) => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(householdId, field));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  });
}

/** The value `sealField` sealed for this space and field; anything else is `SEALED_VALUE_INVALID`. */
export async function openField(
  deps: SpaceKeysDeps,
  householdId: string,
  field: string,
  sealed: string,
): Promise<string> {
  checkField(field);
  if (!SEALED_RE.test(sealed)) throw new SpaceKeyError("SEALED_VALUE_INVALID");
  const bytes = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64url");
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new SpaceKeyError("SEALED_VALUE_INVALID");
  return withDataKey(deps, householdId, (key) => {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
      decipher.setAAD(aad(householdId, field));
      decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SpaceKeyError("SEALED_VALUE_INVALID");
    }
  });
}

/**
 * ARC-06 FR 3: the daily task. Every space's key wrapped by an older master key version is unwrapped and wrapped
 * again with the current one; the data key stays the same, so sealed values open before, during and after (no
 * downtime). The row changes only if no one rewrapped it meanwhile. A space still `pending:` gets its key; a
 * destroyed key is never replaced. One space's failure does not stop the others.
 */
export async function rewrapSpaceKeys(deps: SpaceKeysDeps): Promise<RewrapResult> {
  const current = await deps.kms.currentVersion();
  let rewrapped = 0;
  let provisioned = 0;
  let failed = 0;
  for (const householdId of await deps.store.spaceIds()) {
    try {
      const { ref, key } = await deps.store.inSpace(householdId, async (tx) => ({
        ref: await tx.encryptionKeyRef(householdId),
        key: await tx.spaceKey(householdId),
      }));
      if (key) {
        if (key.masterKeyVersion === current) continue;
        const dataKey = Buffer.from(
          await deps.kms.unwrap(
            { masterKeyVersion: key.masterKeyVersion, ciphertext: Buffer.from(key.wrappedKey, "base64url") },
            { space: householdId },
          ),
        );
        let wrapped;
        try {
          wrapped = await deps.kms.wrap(dataKey, { space: householdId });
        } finally {
          dataKey.fill(0);
        }
        const changed = await deps.store.inSpace(householdId, (tx) =>
          tx.rewrapSpaceKey(householdId, key.keyId, key.masterKeyVersion, {
            masterKeyVersion: wrapped.masterKeyVersion,
            wrappedKey: Buffer.from(wrapped.ciphertext).toString("base64url"),
          }),
        );
        if (changed) rewrapped += 1;
      } else if (ref?.startsWith(keyRef.pendingPrefix)) {
        const fresh = await newSpaceKey(deps.kms, householdId);
        const after = keyRef.live(fresh.keyId);
        const made = await deps.store.inSpace(householdId, async (tx) => {
          if (!(await tx.replaceKeyRef(householdId, ref, after))) return false;
          await tx.insertSpaceKey(householdId, fresh);
          return true;
        });
        if (made) {
          provisioned += 1;
          await deps.audit.keyProvisioned(householdId, fresh.keyId, ref, after);
        }
      }
    } catch {
      failed += 1;
    }
  }
  return { rewrapped, provisioned, failed };
}

/**
 * ARC-06 FR 5, NFR-12 FR 3: destroys a space's key. The wrap is deleted and the reference becomes `destroyed:<id>`;
 * the space's sealed values can no longer be opened. Copies keep the wrap until they rotate out (≤ 35 days).
 * Recorded in the platform log. Repeating it does nothing.
 */
export async function destroySpaceKey(
  deps: SpaceKeysDeps,
  householdId: string,
): Promise<{ readonly destroyed: boolean }> {
  const keyId = await deps.store.inSpace(householdId, async (tx) => {
    const key = await tx.spaceKey(householdId);
    if (!key) return null;
    await tx.deleteSpaceKey(householdId, key.keyId);
    await tx.replaceKeyRef(householdId, keyRef.live(key.keyId), keyRef.destroyed(key.keyId));
    return key.keyId;
  });
  if (keyId === null) return { destroyed: false };
  await deps.audit.keyDestroyed(keyId);
  return { destroyed: true };
}
