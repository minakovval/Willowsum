import { ProviderError } from "../errors.ts";
import { KMS_PORT, type KeyManagement } from "./port.ts";

/** Settings of the live KMS adapter (the master key's id and the vault's endpoints), once it is built. */
export type LiveKmsOptions = Readonly<Record<string, never>>;

/**
 * The live implementation (OCI Vault) is not built yet (ADR-0012): request signing with the instance's principal and
 * its tests come in their own PR, before the first deploy. Until then it fails closed — every call is «unavailable»,
 * so a deployed process creates no space without a key and opens no sealed value.
 */
export function unavailableKeyManagement(options: LiveKmsOptions): KeyManagement {
  void options;
  const fail = (op: keyof typeof KMS_PORT.operations) => () =>
    Promise.reject(new ProviderError("unavailable", KMS_PORT.name, op));
  return { currentVersion: fail("currentVersion"), wrap: fail("wrap"), unwrap: fail("unwrap") };
}
