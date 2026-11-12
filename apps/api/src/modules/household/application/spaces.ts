import { firstSpaceName, type SpaceRole } from "../domain/index.ts";

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
}

export interface SpacesStore {
  /** A transaction bound to `householdId`, the id of a space that may be created in it. */
  inSpace<T>(householdId: string, work: (tx: SpacesTx) => Promise<T>): Promise<T>;
  /** The space an account works in: in PoC its one space (the earliest, should there be more). */
  membershipOf(accountId: string): Promise<SpaceMembership | null>;
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
  /** The data region of new spaces (ARC-03 FR 3: only the EU). */
  readonly dataRegion: string;
}

/**
 * The first space of an account (ACC-01 FR 7, ACC-08 FR 1): «Родина <Прізвище>» with the account as its Owner,
 * created only when the account belongs to no space. Idempotent under concurrent first sign-ins: the check and
 * the creation run under a lock per account, so at most one space is made.
 */
export async function ensureFirstSpace(
  deps: SpacesDeps,
  owner: { readonly accountId: string; readonly displayName: string },
): Promise<SpaceMembership & { readonly created: boolean }> {
  const existing = await deps.store.membershipOf(owner.accountId);
  if (existing) return { ...existing, created: false };
  const householdId = deps.newId();
  const space = { name: firstSpaceName(owner.displayName), dataRegion: deps.dataRegion };
  const result = await deps.store.inSpace(householdId, async (tx) => {
    await tx.lockAccount(owner.accountId);
    const found = await tx.membershipOf(owner.accountId);
    if (found) return { ...found, created: false };
    await tx.insertSpace({
      householdId,
      ...space,
      // No key exists before ARC-06 (keys of spaces in KMS); the reference then names the space's key.
      encryptionKeyRef: `pending:${householdId}`,
    });
    await tx.addMember(owner.accountId, householdId, "owner");
    return { householdId, role: "owner" as const, created: true };
  });
  if (result.created) await deps.audit.spaceCreated(householdId, owner.accountId, space);
  return result;
}
