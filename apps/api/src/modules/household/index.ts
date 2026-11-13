// Public interface of the household module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { DATA_REGIONS } from "../../platform/db/isolation.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { KeyManagement } from "../../platform/adapters/kms/index.ts";
import type { AuditLog } from "../audit/index.ts";
import { databaseSpacesStore } from "./adapters/index.ts";
import {
  destroySpaceKey,
  ensureFirstSpace,
  newSpaceKey,
  openField,
  rewrapSpaceKeys,
  sealField,
  type RewrapResult,
  type SpaceKeysDeps,
  type SpaceMembership,
} from "./application/index.ts";

export const householdModule = defineModule({
  name: "household",
  publishes: [],
  consumes: [],
});

export {
  firstSpaceName,
  SPACE_KEY_ERROR_CODES,
  SPACE_NAME_MAX,
  SPACE_ROLES,
  SpaceKeyError,
} from "./domain/index.ts";
export type { SpaceKeyErrorCode, SpaceRole } from "./domain/index.ts";
export { SEAL_MAX_LENGTH } from "./application/index.ts";
export type { RewrapResult, SpaceMembership } from "./application/index.ts";

/**
 * Keys of spaces (ARC-06@PoC; ADR-0012): sensitive fields sealed with the space's own key, the daily rewrap after a
 * master key rotation, and the destruction of a space's key.
 */
export interface SpaceKeys {
  /** A sensitive value (IBAN, policy number; ≤ 4096 characters) sealed for this space and field: `ws1.…`. */
  seal(householdId: string, field: string, plaintext: string): Promise<string>;
  /** The value sealed for this space and field; `SpaceKeyError` for anything else or without a key. */
  open(householdId: string, field: string, sealed: string): Promise<string>;
  /** Rewraps every key of an older master key version; gives `pending:` spaces their key. The scheduler's task. */
  rewrapAll(): Promise<RewrapResult>;
  /** Destroys the space's key (ARC-06 FR 5, NFR-12 FR 3): its sealed values can no longer be opened. */
  destroy(householdId: string): Promise<{ readonly destroyed: boolean }>;
}

/** Spaces of accounts (ACC-01@PoC part c; ADR-0010). */
export interface HouseholdSpaces {
  /**
   * The account's first space «Родина <Прізвище>» with it as Owner, when it belongs to no space yet (ACC-01 FR 7).
   * Idempotent, also under concurrent calls for one account.
   */
  ensureFirstSpace(owner: {
    readonly accountId: string;
    readonly displayName: string;
  }): Promise<SpaceMembership & { readonly created: boolean }>;
  /** The space and role an account works in (PoC: its one space), or null. */
  membershipOf(accountId: string): Promise<SpaceMembership | null>;
  /** The ids of every space with a member, for the scheduler's daily checks over all spaces (FIN-04 FR 9). */
  spaceIds(): Promise<string[]>;
}

/**
 * `db` is the household module's own database (`ModuleDatabases.for("household")`); `kms` the KMS port chosen by
 * `WS_PROVIDER_MODE` (`keyManagement` in platform/adapters/kms; tests pass `localKeyManagement()`).
 */
export function createHouseholdSpaces(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record">,
  kms: KeyManagement,
): HouseholdSpaces {
  const store = databaseSpacesStore(db);
  const deps = {
    store,
    newId: randomUUID,
    newKey: (householdId: string) => newSpaceKey(kms, householdId),
    dataRegion: DATA_REGIONS[0],
    audit: {
      spaceCreated: async (
        householdId: string,
        ownerAccountId: string,
        space: { name: string; dataRegion: string },
      ) => {
        await audit.record(householdId, {
          actor: { kind: "user", id: ownerAccountId },
          channel: "web",
          entity: { type: "household.space", id: householdId },
          action: "create",
          changes: [
            { field: "name", before: null, after: space.name, sensitive: false },
            { field: "dataRegion", before: null, after: space.dataRegion, sensitive: false },
          ],
        });
        await audit.record(householdId, {
          actor: { kind: "user", id: ownerAccountId },
          channel: "web",
          entity: { type: "household.member", id: ownerAccountId },
          action: "create",
          changes: [{ field: "role", before: null, after: "owner", sensitive: false }],
        });
      },
    },
  };
  return {
    ensureFirstSpace: (owner) => ensureFirstSpace(deps, owner),
    membershipOf: (accountId) => store.membershipOf(accountId),
    spaceIds: () => store.spaceIds(),
  };
}

/** Keys of spaces over the household module's own database and the KMS port (ARC-06@PoC; ADR-0012). */
export function createSpaceKeys(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record" | "recordPlatform">,
  kms: KeyManagement,
): SpaceKeys {
  const store = databaseSpacesStore(db);
  const keyDeps: SpaceKeysDeps = {
    store,
    kms,
    audit: {
      keyProvisioned: async (householdId, keyId, before, after) => {
        await audit.record(householdId, {
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id: keyId },
          action: "create",
          changes: [{ field: "encryptionKeyRef", before, after, sensitive: false }],
        });
      },
      keyRewrapped: async (householdId, keyId, before, after) => {
        await audit.record(householdId, {
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id: keyId },
          action: "update",
          changes: [{ field: "masterKeyVersion", before, after, sensitive: false }],
        });
      },
      keyDestroyed: async (id) => {
        await audit.recordPlatform({
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id },
          action: "delete",
          changes: [],
        });
      },
    },
  };
  return {
    seal: (householdId, field, plaintext) => sealField(keyDeps, householdId, field, plaintext),
    open: (householdId, field, sealed) => openField(keyDeps, householdId, field, sealed),
    rewrapAll: () => rewrapSpaceKeys(keyDeps),
    destroy: (householdId) => destroySpaceKey(keyDeps, householdId),
  };
}
