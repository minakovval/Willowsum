import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../port.ts";
import { memoryObjectStorage } from "./memory.ts";
import type { ObjectStorage } from "./port.ts";
import { s3ObjectStorage, type S3Options } from "./s3.ts";

export { checkObjectKey, OBJECT_STORAGE_PORT } from "./port.ts";
export type { ObjectStorage } from "./port.ts";
export { memoryObjectStorage } from "./memory.ts";
export { directoryObjectStorage } from "./directory.ts";
export type { MemoryObjectStorage } from "./memory.ts";
export { ensureBucket, s3ObjectStorage } from "./s3.ts";
export type { S3Options } from "./s3.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const OBJECT_STORAGE_IMPLEMENTATIONS: ProviderImplementations<ObjectStorage, S3Options> =
  Object.freeze({
    test: memoryObjectStorage,
    live: s3ObjectStorage,
  });

/** The implementation `WS_PROVIDER_MODE` selects (`test` unless `live`). */
export function objectStorage(mode: ProviderMode, liveOptions: () => S3Options): ObjectStorage {
  return selectImplementation(mode, OBJECT_STORAGE_IMPLEMENTATIONS, liveOptions);
}
