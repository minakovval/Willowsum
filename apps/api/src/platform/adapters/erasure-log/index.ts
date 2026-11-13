import type { ProviderMode } from "../port.ts";
import { unavailableErasureLog } from "./live.ts";
import { localErasureLog, type LocalErasureLogOptions } from "./local.ts";
import type { ErasureLog } from "./port.ts";

export { ERASURE_LOG_PORT, erasureLogRecord } from "./port.ts";
export type { ErasureLog, ErasureLogRecord } from "./port.ts";
export { localErasureLog } from "./local.ts";
export type { LocalErasureLogOptions } from "./local.ts";
export { unavailableErasureLog } from "./live.ts";
export type { LiveErasureLogOptions } from "./live.ts";

/**
 * Both implementations (ARC-05 FR 2). Unlike other ports the test implementation needs a setting (the folder), so
 * `test` takes it and `live` takes the live settings.
 */
export const ERASURE_LOG_IMPLEMENTATIONS = Object.freeze({
  test: localErasureLog,
  live: unavailableErasureLog,
});

/**
 * The implementation the configuration selects. A deployed process (staging, production) never gets the local file:
 * unless the mode is `live` it gets the fail-closed implementation (as for the KMS, ADR-0012).
 */
export function erasureLog(
  mode: ProviderMode,
  where: { readonly deployed: boolean },
  localOptions: () => LocalErasureLogOptions,
): ErasureLog {
  if (mode === "live" || where.deployed) return unavailableErasureLog({});
  return localErasureLog(localOptions());
}
