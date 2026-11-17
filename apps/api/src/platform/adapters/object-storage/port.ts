import { defineProviderPort } from "../port.ts";

/**
 * Port of the S3-compatible object storage (ARC-06@PoC FR 4, ARC-05; ARC-08: the S3 API only, no provider's own one).
 * The objects are files of spaces already encrypted with the space's key (file-storage), so the storage never holds
 * plaintext; the bucket is private and an object is reached only through the application (signed links). Keys name
 * only ids (`spaces/<space>/files/<file>`), never a file name or other data. Bodies are never logged.
 */
export const OBJECT_STORAGE_PORT = defineProviderPort("object-storage", {
  put: { idempotent: true, fields: ["key", "body"], path: "{key}" },
  get: { idempotent: true, fields: ["key"], path: "{key}" },
  delete: { idempotent: true, fields: ["key"], path: "{key}" },
  list: { idempotent: true, fields: ["prefix"] },
});

export interface ObjectStorage {
  /** Stores the bytes under the key, replacing any object there. */
  put(key: string, body: Uint8Array): Promise<void>;
  /** The object's bytes, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  /** Removes the object; nothing happens when there is none. */
  delete(key: string): Promise<void>;
  /** Keys under a prefix (at most 1 000; for checks and cleanup). */
  list(prefix: string): Promise<string[]>;
}

const KEY_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function checkObjectKey(key: string): void {
  if (!KEY_RE.test(key) || key.length > 200) throw new Error("An object key is lower-case ids joined by «/»");
}

export function checkPrefix(prefix: string): void {
  if (prefix !== "" && !/^[a-z0-9-]+(\/[a-z0-9-]+)*\/?$/.test(prefix)) throw new Error("Invalid key prefix");
}
