import { isFixedLabelVersion } from "../../../platform/adapters/kms/index.ts";
import type { Resealer, ResealPart } from "../../../platform/modules/reseal.ts";
import { keyRef, type StoredKeyRotation, type StoredSpaceKey } from "../domain/index.ts";
import {
  checkField,
  checkPurpose,
  decryptBytes,
  decryptField,
  encryptBytes,
  encryptField,
  newSpaceKey,
  sealedBytes,
  unwrapStored,
  type RewrapSource,
  type SpaceKeysDeps,
} from "./space-keys.ts";

/**
 * Replacing the data keys of spaces made under the fixed-label test key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; the
 * security review of #726). The re-wrap moved such keys to the installation's key file, but a copy of the database
 * made before it holds the old wrap, which the repository's key opens, and that data key opened every later value.
 * Here each such space (`exposed`) gets a new data key, wrapped by the installation's key; every sealed value of the
 * space is sealed again with it, part by part (the modules that keep sealed values) in batches; then the new key takes
 * the old one's place and the old wrap is deleted (retired). A copy made before then opens none of the new values.
 *
 * Resumable: the new key's wrap and the finished parts are kept in `space_key_rotations`, so a stopped run carries on
 * with the same key, and a value already sealed with it is left as it is (never sealed twice). While the row exists
 * the space's values are neither sealed nor opened (`SPACE_KEY_ROTATING`). Counts only leave this file: never a key,
 * a wrap, a value or a space id.
 */

export interface DataKeyRotationOptions {
  /** The KMS of the fixed-label test key: it opens old keys still wrapped by it (the re-wrap not run yet). */
  readonly source: RewrapSource;
  /** Every module's sealed values of a space. */
  readonly parts: readonly ResealPart[];
  readonly dryRun: boolean;
  readonly batchSize: number;
}

export interface DataKeyRotationResult {
  /** Spaces whose data key is to be replaced (exposed, or a replacement not finished) when the run started. */
  readonly found: number;
  /** Of them, spaces whose key was replaced in this run. */
  readonly rotated: number;
  /** Spaces not finished this run (their replacement stays and a repeat carries on). */
  readonly failed: number;
  /** Sealed values of those spaces: a dry run counts them, a run counts those it sealed again. */
  readonly values: number;
}

/** The installation's KMS must not be the fixed-label key: a new key wrapped by it would be exposed again. */
export class RotationTargetError extends Error {
  constructor() {
    super("The new data keys must be wrapped by the installation's key file, not the fixed-label test key");
    this.name = "RotationTargetError";
  }
}

interface Pending {
  readonly key: StoredSpaceKey;
  readonly rotation: StoredKeyRotation | null;
}

async function pendingOf(deps: SpaceKeysDeps, householdId: string): Promise<Pending | null> {
  const { key, rotation } = await deps.store.inSpace(householdId, async (tx) => ({
    key: await tx.spaceKey(householdId),
    rotation: await tx.keyRotation(householdId),
  }));
  if (!key) return null;
  if (rotation) return { key, rotation };
  return key.exposed === false ? null : { key, rotation: null };
}

/** The space's replacement: the one in progress, or a new key wrapped by the installation's KMS and checked. */
async function begin(deps: SpaceKeysDeps, householdId: string, pending: Pending): Promise<StoredKeyRotation> {
  if (pending.rotation) return pending.rotation;
  const fresh = await newSpaceKey(deps.kms, householdId);
  if (fresh.exposed !== false) throw new RotationTargetError();
  // The new wrap must open before anything is sealed with it.
  (await unwrapStored(deps.kms, householdId, fresh)).fill(0);
  const rotation: StoredKeyRotation = { oldKeyId: pending.key.keyId, newKey: fresh, doneParts: [] };
  return deps.store.inSpace(householdId, async (tx) => {
    await tx.lockSpace(householdId);
    const now = await tx.keyRotation(householdId);
    if (now) return now;
    if ((await tx.spaceKey(householdId))?.keyId !== pending.key.keyId)
      throw new Error("The space's key changed before its replacement began");
    await tx.insertKeyRotation(householdId, rotation);
    return rotation;
  });
}

function resealer(householdId: string, oldKey: Uint8Array, newKey: Uint8Array): Resealer {
  const opensWith = (open: () => unknown): boolean => {
    try {
      open();
      return true;
    } catch {
      return false;
    }
  };
  return {
    field(field, sealed) {
      checkField(field);
      const bytes = sealedBytes(sealed);
      if (opensWith(() => decryptField(newKey, householdId, field, bytes))) return null;
      return encryptField(newKey, householdId, field, decryptField(oldKey, householdId, field, bytes));
    },
    bytes(purpose, sealed) {
      checkPurpose(purpose);
      if (opensWith(() => decryptBytes(newKey, householdId, purpose, sealed).fill(0))) return null;
      const plain = decryptBytes(oldKey, householdId, purpose, sealed);
      try {
        return encryptBytes(newKey, householdId, purpose, plain);
      } finally {
        plain.fill(0);
      }
    },
  };
}

/** One space: begin or resume, seal every part again, then put the new key in the old one's place. */
async function rotateSpace(
  deps: SpaceKeysDeps,
  householdId: string,
  pending: Pending,
  options: DataKeyRotationOptions,
): Promise<number> {
  const rotation = await begin(deps, householdId, pending);
  const oldWith = options.source.owns(pending.key.masterKeyVersion) ? options.source.kms : deps.kms;
  const oldKey = await unwrapStored(oldWith, householdId, pending.key);
  let resealed = 0;
  try {
    const newKey = await unwrapStored(deps.kms, householdId, rotation.newKey);
    try {
      const values = resealer(householdId, oldKey, newKey);
      for (const part of options.parts) {
        if (rotation.doneParts.includes(part.name)) continue;
        resealed += await part.reseal(householdId, values, options.batchSize);
        const marked = await deps.store.inSpace(householdId, (tx) =>
          tx.markRotationPart(householdId, rotation.newKey.keyId, part.name),
        );
        if (!marked) throw new Error("The space's key replacement is gone");
      }
    } finally {
      newKey.fill(0);
    }
  } finally {
    oldKey.fill(0);
  }
  // The entries first, as for a rewrap: a failed write leaves the replacement for the next run.
  await deps.audit.keyReplaced(householdId, rotation.oldKeyId, rotation.newKey.keyId);
  const replaced = await deps.store.inSpace(householdId, async (tx) => {
    await tx.lockSpace(householdId);
    const now = await tx.keyRotation(householdId);
    if (now?.newKey.keyId !== rotation.newKey.keyId) return false;
    if ((await tx.encryptionKeyRef(householdId)) !== keyRef.live(rotation.oldKeyId)) return false;
    if (!(await tx.replaceSpaceKey(householdId, rotation.oldKeyId, rotation.newKey))) return false;
    if (
      !(await tx.replaceKeyRef(
        householdId,
        keyRef.live(rotation.oldKeyId),
        keyRef.live(rotation.newKey.keyId),
      ))
    )
      throw new Error("The key reference of the space changed under its lock");
    await tx.deleteKeyRotation(householdId);
    return true;
  });
  if (!replaced) throw new Error("The space's key changed during its replacement");
  return resealed;
}

/**
 * NFR-01@PoC FR 3: every space whose data key is exposed (or whose replacement did not finish) gets a new data key
 * and its values sealed again with it. `dryRun` only counts spaces and values. One space's failure does not stop the
 * others; its replacement stays and a repeat carries on.
 */
export async function rotateDataKeys(
  deps: SpaceKeysDeps,
  options: DataKeyRotationOptions,
): Promise<DataKeyRotationResult> {
  if (isFixedLabelVersion(await deps.kms.currentVersion())) throw new RotationTargetError();
  let found = 0;
  let rotated = 0;
  let failed = 0;
  let values = 0;
  for (const householdId of await deps.store.spaceIds()) {
    try {
      const pending = await pendingOf(deps, householdId);
      if (!pending) continue;
      found += 1;
      if (options.dryRun) {
        for (const part of options.parts) values += await part.count(householdId);
        continue;
      }
      values += await rotateSpace(deps, householdId, pending, options);
      rotated += 1;
    } catch {
      // A space that could not be finished is counted, never named; nothing of it is logged.
      failed += 1;
    }
  }
  return { found, rotated, failed, values };
}
