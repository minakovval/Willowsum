import { firstSpaceName, keyRef, type SpaceRole, type StoredSpaceKey } from "../domain/index.ts";

/** Ports and use cases of spaces (ACC-01@PoC part c; ADR-0010). Adapters are wired in ../index.ts. */

export interface SpaceMembership {
  readonly householdId: string;
  readonly role: SpaceRole;
}

/** One transaction of the household schema, bound to the space it may create. */
export interface SpacesTx {
  /** Serialises this transaction with every other one for the same account until it ends. */
  lockAccount(accountId: string): Promise<void>;
  membershipOf(accountId: string): Promise<SpaceMembership | null>;
  insertSpace(space: {
    householdId: string;
    name: string;
    dataRegion: string;
    encryptionKeyRef: string;
  }): Promise<void>;
  addMember(accountId: string, householdId: string, role: SpaceRole): Promise<void>;
  /** The space's `encryption_key_ref`, or null when the bound space has no record. */
  encryptionKeyRef(householdId: string): Promise<string | null>;
  /** The space's wrapped data key (ARC-06), or null when it has none. */
  spaceKey(householdId: string): Promise<StoredSpaceKey | null>;
  insertSpaceKey(householdId: string, key: StoredSpaceKey): Promise<void>;
  /** Sets the key reference only if it still is `expected`; true if it changed. */
  replaceKeyRef(householdId: string, expected: string, ref: string): Promise<boolean>;
  /** Replaces the wrap only if it is still of `fromVersion`; true if it changed. */
  rewrapSpaceKey(
    householdId: string,
    keyId: string,
    fromVersion: string,
    to: Pick<StoredSpaceKey, "masterKeyVersion" | "wrappedKey">,
  ): Promise<boolean>;
  deleteSpaceKey(householdId: string, keyId: string): Promise<void>;
  /** Locks the space's record until the transaction ends (a destroy against a provisioning, ADR-0012). */
  lockSpace(householdId: string): Promise<void>;
  /** Deletes the space's record and its login → space rows (the erasure, ADR-0013); returns the member accounts. */
  deleteSpace(householdId: string): Promise<string[]>;
}

export interface SpacesStore {
  /** A transaction bound to `householdId`, the id of a space that may be created in it. */
  inSpace<T>(householdId: string, work: (tx: SpacesTx) => Promise<T>): Promise<T>;
  /** The space an account works in: in PoC its one space (the earliest, should there be more). */
  membershipOf(accountId: string): Promise<SpaceMembership | null>;
  /** The ids of every space with a member (read outside any space, like the membership). */
  spaceIds(): Promise<string[]>;
}

/** Writes the space's audit entries (the household's own log, П-10). */
export interface SpaceAudit {
  spaceCreated(
    householdId: string,
    ownerAccountId: string,
    space: { name: string; dataRegion: string },
  ): Promise<void>;
}

export interface SpacesDeps {
  readonly store: SpacesStore;
  readonly audit: SpaceAudit;
  readonly newId: () => string;
  /** A new data key for the space, wrapped through the KMS (ARC-06 FR 1; `newSpaceKey`). */
  readonly newKey: (householdId: string) => Promise<StoredSpaceKey>;
  /** The data region of new spaces (ARC-03 FR 3: only the EU). */
  readonly dataRegion: string;
}

/**
 * The first space of an account (ACC-01 FR 7, ACC-08 FR 1): «Родина <Прізвище>» with the account as its Owner,
 * created only when the account belongs to no space. Idempotent under concurrent first sign-ins: the check and
 * the creation run under a lock per account, so at most one space is made. The space's data key is wrapped through
 * the KMS before the transaction and stored with the space (ARC-06 FR 1); without the KMS no space is made.
 */
export async function ensureFirstSpace(
  deps: SpacesDeps,
  owner: { readonly accountId: string; readonly displayName: string },
): Promise<SpaceMembership & { readonly created: boolean }> {
  const existing = await deps.store.membershipOf(owner.accountId);
  if (existing) return { ...existing, created: false };
  const householdId = deps.newId();
  const space = { name: firstSpaceName(owner.displayName), dataRegion: deps.dataRegion };
  const key = await deps.newKey(householdId);
  const result = await deps.store.inSpace(householdId, async (tx) => {
    await tx.lockAccount(owner.accountId);
    const found = await tx.membershipOf(owner.accountId);
    if (found) return { ...found, created: false };
    await tx.insertSpace({
      householdId,
      ...space,
      encryptionKeyRef: keyRef.live(key.keyId),
    });
    await tx.insertSpaceKey(householdId, key);
    await tx.addMember(owner.accountId, householdId, "owner");
    return { householdId, role: "owner" as const, created: true };
  });
  if (result.created) await deps.audit.spaceCreated(householdId, owner.accountId, space);
  return result;
}
