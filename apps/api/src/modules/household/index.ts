// Public interface of the household module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { DATA_REGIONS } from "../../platform/db/isolation.ts";
import { defineModule } from "../../platform/modules/define.ts";
import { unavailableKeyManagement, type KeyManagement } from "../../platform/adapters/kms/index.ts";
import type { AuditLog } from "../audit/index.ts";
import { databaseSpacesStore, householdRoutes, spacesOfAccount } from "./adapters/index.ts";
import { keyRef } from "./domain/index.ts";
import {
  destroySpaceKey,
  ensureFirstSpace,
  fieldOpener,
  newSpaceKey,
  openBytes,
  openField,
  rewrapFromSource,
  rewrapSpaceKeys,
  abortDataKeyRotations,
  rotateDataKeys,
  unopenableSpaceKeys,
  sealBytes,
  sealField,
  type DataKeyAbortResult,
  type DataKeyRotationOptions,
  type DataKeyRotationResult,
  type FieldOpener,
  type RewrapFromResult,
  type RewrapResult,
  type RewrapSource,
  type SpaceKeysDeps,
  type SpaceMembership,
} from "./application/index.ts";

export const householdModule = defineModule({
  name: "household",
  publishes: [],
  consumes: [],
  routes: householdRoutes,
});

export { createHouseholdServices, type HouseholdServices } from "./adapters/index.ts";
export {
  firstSpaceName,
  SPACE_KEY_ERROR_CODES,
  SPACE_NAME_MAX,
  SPACE_REPORTING_CURRENCY,
  SPACE_ROLES,
  SpaceKeyError,
  spaceName,
} from "./domain/index.ts";
export type { SpaceKeyErrorCode, SpaceRole } from "./domain/index.ts";
export {
  openWithFieldOpener,
  RotationTargetError,
  SEAL_BYTES_MAX,
  SEAL_MAX_LENGTH,
  wipeFieldOpener,
} from "./application/index.ts";
export type {
  DataKeyAbortResult,
  DataKeyRotationOptions,
  DataKeyRotationResult,
  FieldOpener,
  RewrapFromResult,
  RewrapResult,
  RewrapSource,
  SpaceMembership,
} from "./application/index.ts";

/**
 * Keys of spaces (ARC-06@PoC; ADR-0012): sensitive fields sealed with the space's own key, the daily rewrap after a
 * master key rotation, and the destruction of a space's key.
 */
export interface SpaceKeys {
  /** A sensitive value (IBAN, policy number; ≤ 4096 characters) sealed for this space and field: `ws1.…`. */
  seal(householdId: string, field: string, plaintext: string): Promise<string>;
  /** The value sealed for this space and field; `SpaceKeyError` for anything else or without a key. */
  open(householdId: string, field: string, sealed: string): Promise<string>;
  /** A file's bytes (≤ 32 MiB) sealed for this space and purpose (`<kind>:<id>`, e.g. `file:<uuid>`; ARC-06 FR 4). */
  sealBytes(householdId: string, purpose: string, plaintext: Uint8Array): Promise<Buffer>;
  /** The bytes sealed for this space and purpose; `SpaceKeyError` for anything else or without a key. */
  openBytes(householdId: string, purpose: string, sealed: Uint8Array): Promise<Buffer>;
  /**
   * The opener of one sealed field for an isolated worker, so the value is opened there and never in this thread
   * (`openWithFieldOpener` in the worker; move `key` with the worker's `transferList`, else `wipeFieldOpener`).
   */
  fieldOpener(householdId: string, field: string): Promise<FieldOpener>;
  /** Rewraps every key of an older master key version; gives `pending:` spaces their key. The scheduler's task. */
  rewrapAll(): Promise<RewrapResult>;
  /**
   * The one-time move off another KMS (NFR-01@PoC FR 3): every key wrapped by a version `source` owns is rewrapped by
   * this KMS's current version; `dryRun` only counts. Idempotent. The re-wrap command's work (scripts/kms-rewrap.ts).
   */
  rewrapFrom(source: RewrapSource, options: { readonly dryRun: boolean }): Promise<RewrapFromResult>;
  /** Space keys not wrapped by `source` that this KMS cannot unwrap: a lost or wrong key file (NFR-01@PoC FR 3). */
  unopenable(source: RewrapSource): Promise<number>;
  /**
   * NFR-01@PoC FR 3: replaces the data key of every space whose key may have been wrapped by the fixed-label test key
   * (or whose replacement did not finish) and seals its values again with the new key, through `options.parts` (every
   * module's sealed values); `dryRun` only counts. Resumable and idempotent. The command `kms:rotate-data-keys`.
   */
  rotateDataKeys(options: DataKeyRotationOptions): Promise<DataKeyRotationResult>;
  /**
   * NFR-01@PoC FR 3: undoes every unfinished replacement — the space's values sealed back with its old key, the new key
   * discarded; the old key stays (still exposed). `kms:rotate-data-keys --abort`.
   */
  abortDataKeyRotations(
    options: Pick<DataKeyRotationOptions, "source" | "parts" | "batchSize">,
  ): Promise<DataKeyAbortResult>;
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
        space: { name: string; dataRegion: string; reportingCurrency: string },
      ) => {
        await audit.record(householdId, {
          actor: { kind: "user", id: ownerAccountId },
          channel: "web",
          entity: { type: "household.space", id: householdId },
          action: "create",
          changes: [
            { field: "name", before: null, after: space.name, sensitive: false },
            { field: "dataRegion", before: null, after: space.dataRegion, sensitive: false },
            { field: "reportingCurrency", before: null, after: space.reportingCurrency, sensitive: false },
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

function spaceKeyDeps(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record" | "recordPlatform">,
  kms: KeyManagement,
): SpaceKeysDeps {
  const store = databaseSpacesStore(db);
  return {
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
      keyReplaced: async (householdId, oldKeyId, newKeyId) => {
        await audit.record(householdId, {
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id: newKeyId },
          action: "create",
          changes: [
            {
              field: "encryptionKeyRef",
              before: keyRef.live(oldKeyId),
              after: keyRef.live(newKeyId),
              sensitive: false,
            },
          ],
        });
        await audit.record(householdId, {
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id: oldKeyId },
          action: "delete",
          changes: [],
        });
      },
      keyRotationAborted: async (householdId, newKeyId) => {
        await audit.record(householdId, {
          actor: { kind: "system" },
          channel: "system",
          entity: { type: "household.space-key", id: newKeyId },
          action: "delete",
          changes: [],
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
}

/** Keys of spaces over the household module's own database and the KMS port (ARC-06@PoC; ADR-0012). */
export function createSpaceKeys(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record" | "recordPlatform">,
  kms: KeyManagement,
): SpaceKeys {
  const keyDeps = spaceKeyDeps(db, audit, kms);
  return {
    seal: (householdId, field, plaintext) => sealField(keyDeps, householdId, field, plaintext),
    open: (householdId, field, sealed) => openField(keyDeps, householdId, field, sealed),
    sealBytes: (householdId, purpose, plaintext) => sealBytes(keyDeps, householdId, purpose, plaintext),
    openBytes: (householdId, purpose, sealed) => openBytes(keyDeps, householdId, purpose, sealed),
    fieldOpener: (householdId, field) => fieldOpener(keyDeps, householdId, field),
    rewrapAll: () => rewrapSpaceKeys(keyDeps),
    rewrapFrom: (source, options) => rewrapFromSource(keyDeps, source, options),
    unopenable: (source) => unopenableSpaceKeys(keyDeps, source),
    rotateDataKeys: (options) => rotateDataKeys(keyDeps, options),
    abortDataKeyRotations: (options) => abortDataKeyRotations(keyDeps, options),
    destroy: (householdId) => destroySpaceKey(keyDeps, householdId),
  };
}

/** Erasure of spaces on a person's request (NFR-12@PoC FR 3; ADR-0013): the owner's erasure script only. */
export interface SpaceErasure {
  /** The spaces of an account and how many members each has. */
  spacesOf(accountId: string): Promise<{ readonly householdId: string; readonly members: number }[]>;
  /**
   * The last step of erasing a space: its key is destroyed (platform log first) and, in the same transaction under the
   * lock of the space's record, the record and its login → space rows are deleted. A provisioning or rewrap in between
   * is caught and the step starts again. Repeating it does nothing.
   */
  eraseSpace(householdId: string): Promise<{ readonly keyDestroyed: boolean }>;
}

/** `db` is the household module's own database; `audit` writes the platform entries of the key. */
export function createSpaceErasure(
  db: ModuleDatabase,
  audit: Pick<AuditLog, "record" | "recordPlatform">,
): SpaceErasure {
  // Destroying a key needs no KMS: the erasure never wraps or unwraps.
  const keys = spaceKeyDeps(db, audit, unavailableKeyManagement({}));
  return {
    spacesOf: (accountId) => spacesOfAccount(db, accountId),
    async eraseSpace(householdId) {
      const { destroyed } = await destroySpaceKey(keys, householdId, async (tx) => {
        await tx.deleteSpace(householdId);
      });
      return { keyDestroyed: destroyed };
    },
  };
}
