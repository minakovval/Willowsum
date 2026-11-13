import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { KeyManagement } from "../../../platform/adapters/kms/index.ts";
import { keyRef, SpaceKeyError, type StoredSpaceKey } from "../domain/index.ts";
import type { SpacesStore, SpacesTx } from "./spaces.ts";

/**
 * Keys of spaces (ARC-06@PoC FR 1, FR 2, FR 3, FR 5; ADR-0012): envelope encryption. A space's 256-bit data key is
 * made when the space is, wrapped by the master key through the KMS port and stored only as that wrap. Sensitive
 * fields are sealed with it (AES-256-GCM, bound to their space and field). The daily task rewraps keys after a master
 * key rotation; destroying a key leaves the space's sealed values unreadable. Keys are never logged or cached.
 */

export interface SpaceKeyAudit {
  /** A space made before keys existed got its key (the space's own log). */
  keyProvisioned(householdId: string, keyId: string, before: string, after: string): Promise<void>;
  /** A space's key was rewrapped by a newer master key version (the space's own log; the data key is unchanged). */
  keyRewrapped(householdId: string, keyId: string, before: string, after: string): Promise<void>;
  /**
   * A space's key was destroyed (the platform log: the space's own log goes with the space). `id` is the key's id,
   * or the space's id for a space destroyed before it ever had a key.
   */
  keyDestroyed(id: string): Promise<void>;
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

/**
 * The data key of a stored wrap, as a Buffer over the very bytes the KMS returned (no copy), so the caller's
 * `fill(0)` wipes them.
 */
async function unwrapStored(kms: KeyManagement, householdId: string, key: StoredSpaceKey): Promise<Buffer> {
  const bytes = await kms.unwrap(
    { masterKeyVersion: key.masterKeyVersion, ciphertext: Buffer.from(key.wrappedKey, "base64url") },
    { space: householdId },
  );
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
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
  const dataKey = await unwrapStored(deps.kms, householdId, key);
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
 * downtime). The new wrap is unwrapped and compared before it is stored, each rewrap is recorded in the space's
 * log before the row changes, and the row changes only if no one rewrapped it meanwhile. A space still `pending:`
 * gets its key; a
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
        const dataKey = await unwrapStored(deps.kms, householdId, key);
        let next: StoredSpaceKey;
        try {
          const wrapped = await deps.kms.wrap(dataKey, { space: householdId });
          next = {
            keyId: key.keyId,
            masterKeyVersion: wrapped.masterKeyVersion,
            wrappedKey: Buffer.from(wrapped.ciphertext).toString("base64url"),
          };
          // The new wrap is checked before it replaces the old one: a faulty KMS answer must not lose the key once
          // the old master key version is retired.
          const check = await unwrapStored(deps.kms, householdId, next);
          try {
            if (check.length !== dataKey.length || !timingSafeEqual(check, dataKey))
              throw new Error("The new wrap does not unwrap to the same data key");
          } finally {
            check.fill(0);
          }
        } finally {
          dataKey.fill(0);
        }
        // The entry is written first, as for destroy: a failed write leaves the old wrap for the next run, and a
        // rewrap that loses the race below leaves at most an entry without a change — never a change without one.
        await deps.audit.keyRewrapped(householdId, key.keyId, key.masterKeyVersion, next.masterKeyVersion);
        const changed = await deps.store.inSpace(householdId, (tx) =>
          tx.rewrapSpaceKey(householdId, key.keyId, key.masterKeyVersion, next),
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

/** Destroy attempts when the key changes under the call (a provisioning or another destroy in between). */
export const DESTROY_ATTEMPTS = 3;

/**
 * ARC-06 FR 5, NFR-12 FR 3: destroys a space's key. The wrap is deleted and the reference becomes `destroyed:<id>`;
 * the space's sealed values can no longer be opened. Copies keep the wrap until they rotate out (≤ 35 days).
 * Recorded in the platform log before anything changes. A space still `pending:` is marked `destroyed:<its id>`, so
 * it never gets a key. The change runs under the lock of the space's record and re-checks what it read: a key
 * provisioned or rewrapped in between is caught and the destruction starts again (with its own entry), so a
 * destroyed space never keeps a key. `finish` runs in the same locked transaction after the key is gone (the
 * erasure deletes the space's record there, ADR-0013). Repeating it does nothing.
 */
export async function destroySpaceKey(
  deps: SpaceKeysDeps,
  householdId: string,
  finish?: (tx: SpacesTx) => Promise<void>,
): Promise<{ readonly destroyed: boolean }> {
  const read = (tx: SpacesTx) =>
    Promise.all([tx.encryptionKeyRef(householdId), tx.spaceKey(householdId)]).then(([ref, key]) => ({
      ref,
      key,
    }));
  for (let attempt = 0; attempt < DESTROY_ATTEMPTS; attempt++) {
    const seen = await deps.store.inSpace(householdId, read);
    const pending = !seen.key && seen.ref?.startsWith(keyRef.pendingPrefix) === true;
    if (!seen.key && !pending && !finish) return { destroyed: false };
    // The entry is written first: if it fails, nothing changed and a repeat tries again. A failure after it leaves
    // at most a second entry on the repeat — never a destroyed key without one. A space that never had a key is
    // recorded under its own id.
    if (seen.key) await deps.audit.keyDestroyed(seen.key.keyId);
    else if (pending) await deps.audit.keyDestroyed(householdId);
    // A repeat (or a re-application after a restore) on a space whose key is already destroyed still records the
    // step that deletes its record.
    else if (finish && seen.ref?.startsWith(keyRef.destroyedPrefix))
      await deps.audit.keyDestroyed(seen.ref.slice(keyRef.destroyedPrefix.length));
    const done = await deps.store.inSpace(householdId, async (tx) => {
      await tx.lockSpace(householdId);
      const now = await read(tx);
      if (now.ref !== seen.ref || now.key?.keyId !== seen.key?.keyId) return false;
      if (seen.key) {
        await tx.deleteSpaceKey(householdId, seen.key.keyId);
        if (
          !(await tx.replaceKeyRef(
            householdId,
            keyRef.live(seen.key.keyId),
            keyRef.destroyed(seen.key.keyId),
          ))
        )
          throw new Error("The key reference of the space changed under its lock");
      } else if (pending && seen.ref) {
        if (!(await tx.replaceKeyRef(householdId, seen.ref, keyRef.destroyed(householdId))))
          throw new Error("The key reference of the space changed under its lock");
      }
      if (finish) await finish(tx);
      return true;
    });
    if (done) return { destroyed: seen.key !== null };
  }
  throw new Error("The space's key kept changing while it was being destroyed");
}
