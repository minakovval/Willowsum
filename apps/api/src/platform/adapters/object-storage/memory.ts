import { checkObjectKey, checkPrefix, type ObjectStorage } from "./port.ts";

/**
 * Test implementation of the object storage port (ARC-05 FR 2; `WS_PROVIDER_MODE=test`, unit and integration tests):
 * objects in this process's memory. The S3 adapter itself is tested against a local S3-compatible storage
 * (`*.s3.test.ts`, CI part `checks`).
 */
export interface MemoryObjectStorage extends ObjectStorage {
  /** Every stored object (copies), for tests. */
  readonly objects: ReadonlyMap<string, Buffer>;
}

export function memoryObjectStorage(): MemoryObjectStorage {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(key, body) {
      checkObjectKey(key);
      objects.set(key, Buffer.from(body));
    },
    async get(key) {
      checkObjectKey(key);
      const found = objects.get(key);
      return found ? Buffer.from(found) : null;
    },
    async delete(key) {
      checkObjectKey(key);
      objects.delete(key);
    },
    async list(prefix) {
      checkPrefix(prefix);
      return [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .slice(0, 1000);
    },
  };
}
