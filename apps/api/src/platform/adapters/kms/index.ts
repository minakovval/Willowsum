import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../port.ts";
import { unavailableKeyManagement, type LiveKmsOptions } from "./live.ts";
import { localKeyManagement } from "./local.ts";
import type { KeyManagement } from "./port.ts";

export { checkDataKey, DATA_KEY_BYTES, KMS_PORT } from "./port.ts";
export type { KeyManagement, WrapContext, WrappedKey } from "./port.ts";
export { localKeyManagement } from "./local.ts";
export type { LocalKeyManagement } from "./local.ts";
export { unavailableKeyManagement } from "./live.ts";
export type { LiveKmsOptions } from "./live.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const KMS_IMPLEMENTATIONS: ProviderImplementations<KeyManagement, LiveKmsOptions> = Object.freeze({
  test: localKeyManagement,
  live: unavailableKeyManagement,
});

/** The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). */
export function keyManagement(mode: ProviderMode, liveOptions: () => LiveKmsOptions): KeyManagement {
  return selectImplementation(mode, KMS_IMPLEMENTATIONS, liveOptions);
}
