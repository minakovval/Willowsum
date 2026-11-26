import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../port.ts";
import { unavailableKeyManagement, type LiveKmsOptions } from "./live.ts";
import { fileKeyManagement } from "./key-file.ts";
import { localKeyManagement } from "./local.ts";
import type { KeyManagement } from "./port.ts";

export { checkDataKey, DATA_KEY_BYTES, KMS_PORT } from "./port.ts";
export type { KeyManagement, WrapContext, WrappedKey } from "./port.ts";
export { fixedLabelSource, isFixedLabelVersion, localKeyManagement } from "./local.ts";
export { fileKeyManagement, KmsKeyFileError } from "./key-file.ts";
export type { LocalKeyManagement } from "./local.ts";
export { unavailableKeyManagement } from "./live.ts";
export type { LiveKmsOptions } from "./live.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const KMS_IMPLEMENTATIONS: ProviderImplementations<KeyManagement, LiveKmsOptions> = Object.freeze({
  test: localKeyManagement,
  live: unavailableKeyManagement,
});

/** Where the process runs and what it holds (config.ts: `deployed`, `kms`). */
export interface KmsPlacement {
  /** Staging or production. */
  readonly deployed: boolean;
  /** The instance holds real data (`WS_REAL_DATA=true`): never the fixed-label test key. */
  readonly realData?: boolean;
  /** The installation's key file (`WS_KMS_KEY_FILE`), local only. */
  readonly keyFile?: string;
  /** Make the key file when it is missing (default true); the role processes pass false (main.ts). */
  readonly createKeyFile?: boolean;
}

/** A real-data instance without its installation's key file: it does not start (NFR-01@PoC FR 3). */
export class RealDataKmsError extends Error {
  constructor() {
    super("An instance with real data (WS_REAL_DATA=true) needs its key file (WS_KMS_KEY_FILE)");
    this.name = "RealDataKmsError";
  }
}

/**
 * The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). The fixed-label
 * test key comes from a public label, so a deployed process (staging, production) never gets it, whatever its role
 * or mode: it gets the fail-closed implementation instead (ARC-06 FR 1; security review of #141). Locally a key file
 * gives the installation's random master key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; security review of #722), and an
 * instance marked as holding real data never falls back to the fixed-label key: without its key file it does not
 * start. Throws `KmsKeyFileError` for a key file that may not be used.
 */
export function keyManagement(
  mode: ProviderMode,
  liveOptions: () => LiveKmsOptions,
  where: KmsPlacement,
): KeyManagement {
  if (where.deployed && mode !== "live") return unavailableKeyManagement({});
  if (mode === "live") return selectImplementation(mode, KMS_IMPLEMENTATIONS, liveOptions);
  if (where.keyFile !== undefined)
    return fileKeyManagement({ file: where.keyFile, create: where.createKeyFile !== false });
  if (where.realData) throw new RealDataKmsError();
  return selectImplementation(mode, KMS_IMPLEMENTATIONS, liveOptions);
}
