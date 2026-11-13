import { ProviderError } from "../errors.ts";
import { ERASURE_LOG_PORT, type ErasureLog } from "./port.ts";

/** Settings of the live log (bucket in another EU region with a retention lock), once it is built. */
export type LiveErasureLogOptions = Readonly<Record<string, never>>;

/**
 * The live implementation (object storage in another EU region, ADR-0013) is not built yet: it fails closed, so a
 * deployed process records no erasure and therefore runs none — an erasure that a restore could undo is never made.
 */
export function unavailableErasureLog(options: LiveErasureLogOptions): ErasureLog {
  void options;
  const fail = (op: keyof typeof ERASURE_LOG_PORT.operations) => () =>
    Promise.reject(new ProviderError("unavailable", ERASURE_LOG_PORT.name, op));
  return { append: fail("append"), records: fail("records") };
}
