import { spaceName } from "../domain/index.ts";

/**
 * The space's settings (ACC-08@PoC FR 2, FR 5): its name for the profile, and renaming by its Owner. The caller's
 * space comes from the session (П-5); the transaction is bound to it, so another space is never read or changed.
 */

export interface SpaceSettings {
  readonly name: string;
  readonly dataRegion: string;
}

/** One transaction of the household schema, bound to the caller's space. */
export interface SpaceSettingsTx {
  /** The bound space's settings, locked until the transaction ends; null when the space has no record. */
  lockSettings(householdId: string): Promise<SpaceSettings | null>;
  settings(householdId: string): Promise<SpaceSettings | null>;
  setName(householdId: string, name: string): Promise<void>;
}

/** The household's own audit log (П-10): who renamed the space, from what to what. */
export interface SpaceRenameAudit {
  spaceRenamed(householdId: string, accountId: string, before: string, after: string): Promise<void>;
}

export type RenameResult =
  | { readonly kind: "renamed"; readonly settings: SpaceSettings }
  | { readonly kind: "invalid" }
  | { readonly kind: "not-found" };

/**
 * Renames the caller's space (ACC-08@PoC FR 5, AC5): 1–60 characters, uniqueness not required; an invalid name
 * changes nothing. The audit entry with the old and the new name is written inside the transaction, before the
 * change commits: a failed audit write rolls the rename back, so no rename is ever left without its entry. The same
 * name again changes nothing and writes no entry.
 */
export async function renameSpace(
  tx: SpaceSettingsTx,
  audit: SpaceRenameAudit,
  caller: { readonly householdId: string; readonly accountId: string },
  requested: string,
): Promise<RenameResult> {
  const name = spaceName(requested);
  if (name === null) return { kind: "invalid" };
  const current = await tx.lockSettings(caller.householdId);
  if (!current) return { kind: "not-found" };
  if (current.name === name) return { kind: "renamed", settings: current };
  await tx.setName(caller.householdId, name);
  await audit.spaceRenamed(caller.householdId, caller.accountId, current.name, name);
  return { kind: "renamed", settings: { ...current, name } };
}
