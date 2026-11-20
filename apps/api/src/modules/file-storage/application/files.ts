import { createHash } from "node:crypto";
import { FILE_LIMITS, reject } from "../domain/index.ts";
import { signLink, verifyLink, type LinkKey } from "./signed-link.ts";
import type { UploadBudget } from "./upload-budget.ts";

/**
 * Stored files (ARC-06@PoC FR 4, NFR-01@PoC FR 4, NFR-15@PoC FR 18, FR 31). A file is read under the request's
 * budget, inspected in the parsing worker, sealed with its space's key and only then stored: the object first, its row
 * in the same transaction, under the space's limits lock with the 100 GiB check. A rejected file leaves nothing in the
 * object storage or the database. It is served only through a signed link (≤ 15 minutes) of its own space, only as a
 * download with the type of its content and `nosniff`.
 */
export const FILE_KINDS = ["statement"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface StoredFile {
  readonly id: string;
  readonly householdId: string;
  readonly kind: FileKind;
  readonly format: string;
  readonly contentType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** SHA-256 of the original bytes, hex (duplicates of a file, IMP-01 «Бізнес-правила»). */
  readonly sha256: string;
  readonly objectKey: string;
  readonly createdAt: Date;
}

export interface FilesTx {
  /** The space-level lock of limits (NFR-15 FR 31: the same lock as plan limits), held to the end of the transaction. */
  lockSpaceLimits(): Promise<void>;
  /** Bytes of every file of the space. */
  usedBytes(): Promise<number>;
  insert(file: StoredFile): Promise<void>;
  find(fileId: string): Promise<StoredFile | null>;
  remove(fileId: string): Promise<boolean>;
}

export interface FilesStore {
  inSpace<T>(householdId: string, work: (tx: FilesTx) => Promise<T>): Promise<T>;
}

export interface FileObjects {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface FileCrypto {
  sealBytes(householdId: string, purpose: string, plaintext: Uint8Array): Promise<Buffer>;
  openBytes(householdId: string, purpose: string, sealed: Uint8Array): Promise<Buffer>;
}

export interface FileInspection {
  readonly format: string;
  readonly contentType: string;
}

export interface FilesAudit {
  stored(file: StoredFile, actorId: string): Promise<void>;
  /** `actorId` null: a system task (the daily cleanup of import batches, IMP-01 FR 20). */
  removed(file: StoredFile, actorId: string | null): Promise<void>;
}

export interface FilesDeps {
  readonly store: FilesStore;
  readonly objects: FileObjects;
  readonly crypto: FileCrypto;
  readonly inspector: { inspect(bytes: Uint8Array): Promise<FileInspection> };
  readonly audit: FilesAudit;
  readonly linkKey: LinkKey;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly spaceBytes?: number;
}

/** The file is not in the caller's space (or the link is not valid): one answer, like any record of another space. */
export class FileNotFoundError extends Error {
  constructor() {
    super("File not found");
    this.name = "FileNotFoundError";
  }
}

export interface StoreRequest {
  readonly householdId: string;
  readonly actorId: string;
  readonly kind: FileKind;
  /** The name the user's file had; kept for the download only (never logged or audited). */
  readonly fileName: string;
  /** The request's declared length, when known: the 100 GiB check runs on it before the stream is read. */
  readonly declaredBytes?: number;
  readonly budget: UploadBudget;
  readonly body: AsyncIterable<Uint8Array> & { destroy?(): void };
}

const FILE_NAME_MAX = 255;

/** A file name safe to keep: one line, no path, at most 255 characters; «file» when nothing is left. */
export function cleanFileName(name: string): string {
  const base = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const clean = [
    // eslint-disable-next-line no-control-regex -- control characters are what this removes
    ...base.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069"]/g, "").trim(),
  ];
  return clean.length === 0 ? "file" : clean.slice(0, FILE_NAME_MAX).join("");
}

function objectKey(householdId: string, fileId: string): string {
  return `spaces/${householdId}/files/${fileId}`;
}

function purpose(fileId: string): string {
  return `file:${fileId}`;
}

export async function storeFile(deps: FilesDeps, request: StoreRequest): Promise<StoredFile> {
  const limit = deps.spaceBytes ?? FILE_LIMITS.spaceBytes;
  const { householdId } = request;
  if (request.declaredBytes !== undefined) {
    const used = await deps.store.inSpace(householdId, (tx) => tx.usedBytes());
    if (used + request.declaredBytes > limit) reject("SPACE_STORAGE_LIMIT");
  }
  const bytes = await request.budget.read(request.body);
  const inspection = await deps.inspector.inspect(bytes);
  const id = deps.newId();
  const file: StoredFile = {
    id,
    householdId,
    kind: request.kind,
    format: inspection.format,
    contentType: inspection.contentType,
    fileName: cleanFileName(request.fileName),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    objectKey: objectKey(householdId, id),
    createdAt: deps.now(),
  };
  const sealed = await deps.crypto.sealBytes(householdId, purpose(id), bytes);
  let put = false;
  try {
    await deps.store.inSpace(householdId, async (tx) => {
      await tx.lockSpaceLimits();
      if ((await tx.usedBytes()) + file.sizeBytes > limit) reject("SPACE_STORAGE_LIMIT");
      await tx.insert(file);
      await deps.objects.put(file.objectKey, sealed);
      put = true;
      await deps.audit.stored(file, request.actorId);
    });
  } catch (error) {
    if (put) await deps.objects.delete(file.objectKey).catch(() => undefined);
    throw error;
  }
  return file;
}

export async function findFile(deps: FilesDeps, householdId: string, fileId: string): Promise<StoredFile> {
  const file = await deps.store.inSpace(householdId, (tx) => tx.find(fileId));
  if (!file) throw new FileNotFoundError();
  return file;
}

/** A signed link to a file of the caller's space, valid for at most 15 minutes. */
export async function linkFile(
  deps: FilesDeps,
  householdId: string,
  fileId: string,
  ttlMs?: number,
): Promise<{ readonly token: string; readonly expiresAt: Date }> {
  const file = await findFile(deps, householdId, fileId);
  return signLink(deps.linkKey, { householdId, fileId: file.id }, deps.now(), ttlMs);
}

export interface Download {
  readonly status: 200;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\\;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * The answer to a signed link opened by a caller of `householdId`: the original bytes as a download only. A link of
 * another space, a tampered or expired one, or a removed file is FileNotFoundError.
 */
export async function openLink(deps: FilesDeps, householdId: string, token: string): Promise<Download> {
  const fileId = verifyLink(deps.linkKey, householdId, token, deps.now());
  if (!fileId) throw new FileNotFoundError();
  const file = await findFile(deps, householdId, fileId);
  const sealed = await deps.objects.get(file.objectKey);
  if (!sealed) throw new FileNotFoundError();
  const body = await deps.crypto.openBytes(householdId, purpose(file.id), sealed);
  return {
    status: 200,
    headers: {
      "content-type": file.contentType,
      "content-disposition": disposition(file.fileName),
      "x-content-type-options": "nosniff",
      "content-length": String(body.length),
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    },
    body,
  };
}

/**
 * A file's original bytes for a step of the server in the same space (IMP-01 FR 5: the parse step reads the statement
 * it parses), never an answer to a client — those go through signed links only. Another space's file, an unknown one
 * or one whose object is gone is FileNotFoundError.
 */
export async function readFile(deps: FilesDeps, householdId: string, fileId: string): Promise<Buffer> {
  const file = await findFile(deps, householdId, fileId);
  const sealed = await deps.objects.get(file.objectKey);
  if (!sealed) throw new FileNotFoundError();
  return deps.crypto.openBytes(householdId, purpose(file.id), sealed);
}

/** Removes a file and its object (the batch it belongs to is deleted, IMP-01 FR 12, FR 20). */
export async function removeFile(
  deps: FilesDeps,
  householdId: string,
  fileId: string,
  actorId: string | null,
): Promise<void> {
  // The object goes only after the row and its audit entry are committed: a failed commit keeps both, never a row
  // whose object is gone.
  const file = await deps.store.inSpace(householdId, async (tx) => {
    const found = await tx.find(fileId);
    if (!found) throw new FileNotFoundError();
    await tx.remove(fileId);
    await deps.audit.removed(found, actorId);
    return found;
  });
  await deps.objects.delete(file.objectKey);
}

export async function spaceUsage(deps: FilesDeps, householdId: string): Promise<number> {
  return deps.store.inSpace(householdId, (tx) => tx.usedBytes());
}
