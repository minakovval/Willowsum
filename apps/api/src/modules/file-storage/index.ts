// Public interface of the file-storage module (ARC-01 FR 2). Other modules import only this file.
import { randomUUID } from "node:crypto";
import type { ObjectStorage } from "../../platform/adapters/object-storage/index.ts";
import type { ModuleDatabase } from "../../platform/db/module-db.ts";
import { defineModule } from "../../platform/modules/define.ts";
import type { AuditLog } from "../audit/index.ts";
import type { SpaceKeys } from "../household/index.ts";
import { databaseFilesStore, isolatedInspector, type IsolationOptions } from "./adapters/index.ts";
import {
  linkFile,
  openLink,
  removeFile,
  spaceUsage,
  storeFile,
  findFile,
  type Download,
  type FilesDeps,
  type LinkKey,
  type StoredFile,
  type StoreRequest,
} from "./application/index.ts";

export const fileStorageModule = defineModule({
  name: "file-storage",
  publishes: [],
  consumes: [],
});

export {
  FILE_LIMITS,
  FileRejectedError,
  PARSE_CEILINGS,
  REJECTION_CODES,
  rejection,
  SIGNED_LINK_MAX_TTL_MS,
} from "./domain/index.ts";
export type { Rejection, RejectionCode } from "./domain/index.ts";
export { CONTENT_TYPES, FILE_FORMATS, SPACE_LIMITS_LOCK } from "./adapters/index.ts";
export type { FileFormat } from "./adapters/index.ts";
export { FILE_KINDS, FileNotFoundError, linkKey, uploadBudget } from "./application/index.ts";
export type {
  Download,
  FileKind,
  LinkKey,
  StoredFile,
  StoreRequest,
  UploadBudget,
} from "./application/index.ts";

/**
 * Stored files of spaces (ARC-06@PoC FR 4, NFR-01@PoC FR 4, NFR-15@PoC FR 18, FR 31): the type by content (CSV, TSV,
 * XLSX and XLS without macros only), the ZIP limits and the ceilings checked in a separate worker before anything is
 * stored, sizes on the request stream, encryption with the space's key, the 100 GiB limit of a space, and downloads
 * only through signed links of at most 15 minutes.
 */
export interface FileStorage {
  /** Reads, checks and stores one file of the space; `FileRejectedError` leaves nothing stored. */
  store(request: StoreRequest): Promise<StoredFile>;
  /** A file of the space, or `FileNotFoundError`. */
  find(householdId: string, fileId: string): Promise<StoredFile>;
  /** A signed link to a file of the space (`ttlMs` ≤ 15 minutes, the default). */
  link(householdId: string, fileId: string, ttlMs?: number): Promise<{ token: string; expiresAt: Date }>;
  /** Opens a signed link for a caller of the space: the original bytes, as a download only. */
  open(householdId: string, token: string): Promise<Download>;
  /** Removes a file and its object. */
  remove(householdId: string, fileId: string, actorId: string): Promise<void>;
  /** Bytes of every file of the space. */
  usage(householdId: string): Promise<number>;
}

export interface FileStorageDeps {
  /** The module's own database (`ModuleDatabases.for("file-storage")`). */
  readonly db: ModuleDatabase;
  readonly audit: Pick<AuditLog, "record">;
  /** The space's key (household): files are sealed with it. */
  readonly keys: Pick<SpaceKeys, "sealBytes" | "openBytes">;
  /** The object storage port (`platform/adapters/object-storage`). */
  readonly objects: ObjectStorage;
  /** The key of signed links (≥ 32 bytes from the deployment's secrets). */
  readonly linkKey: LinkKey;
  readonly now?: () => Date;
  readonly isolation?: IsolationOptions;
  /** Tests only: a smaller space limit. */
  readonly spaceBytes?: number;
}

export function createFileStorage(deps: FileStorageDeps): FileStorage {
  const files: FilesDeps = {
    store: databaseFilesStore(deps.db),
    objects: deps.objects,
    crypto: deps.keys,
    inspector: isolatedInspector(deps.isolation),
    linkKey: deps.linkKey,
    newId: randomUUID,
    now: deps.now ?? (() => new Date()),
    ...(deps.spaceBytes === undefined ? {} : { spaceBytes: deps.spaceBytes }),
    audit: {
      stored: (file, actorId) => record(deps.audit, file, actorId, "create"),
      removed: (file, actorId) => record(deps.audit, file, actorId, "delete"),
    },
  };
  return {
    store: (request) => storeFile(files, request),
    find: (householdId, fileId) => findFile(files, householdId, fileId),
    link: (householdId, fileId, ttlMs) => linkFile(files, householdId, fileId, ttlMs),
    open: (householdId, token) => openLink(files, householdId, token),
    remove: (householdId, fileId, actorId) => removeFile(files, householdId, fileId, actorId),
    usage: (householdId) => spaceUsage(files, householdId),
  };
}

/** The audit entry of a stored or removed file: kind, format and size only — never its name or content (IMP-01 FR 19). */
async function record(
  audit: Pick<AuditLog, "record">,
  file: StoredFile,
  actorId: string,
  action: "create" | "delete",
): Promise<void> {
  const value = (v: string | number) =>
    action === "create" ? { before: null, after: String(v) } : { before: String(v), after: null };
  await audit.record(file.householdId, {
    actor: { kind: "user", id: actorId },
    channel: "web",
    entity: { type: "file-storage.file", id: file.id },
    action,
    changes: [
      { field: "kind", ...value(file.kind), sensitive: false },
      { field: "format", ...value(file.format), sensitive: false },
      { field: "sizeBytes", ...value(file.sizeBytes), sensitive: false },
    ],
  });
}
