import { defineProviderPort } from "../port.ts";

/**
 * Port of the key management service (ARC-06@PoC FR 1, ARC-05; ADR-0012). The master key lives only in the KMS
 * (OCI Vault in the deployed profile «Старт», infra/start/kms.tf) and never leaves it: the application sends a
 * space's 256-bit data key to be wrapped or unwrapped and keeps only the wrap. Each wrap is bound to its space by
 * `associatedData`, so the wrap of one space cannot be used for another. Outgoing fields are the minimum (FR 5 of
 * ARC-05): the master key's id, the data key or its wrap, and the space binding. Paths are the KMS's crypto and
 * management endpoints. Data keys and wraps are never logged.
 */
export const KMS_PORT = defineProviderPort("key-management", {
  // Safe to repeat: wrapping has no side effect in the KMS (a repeat only gives another wrap of the same key).
  wrap: {
    idempotent: true,
    fields: ["keyId", "plaintext", "associatedData.space"],
    path: "20180608/encrypt",
  },
  unwrap: {
    idempotent: true,
    fields: ["keyId", "ciphertext", "associatedData.space"],
    path: "20180608/decrypt",
  },
  currentVersion: { idempotent: true, fields: ["keyId"], path: "20180608/keys/{keyId}" },
});

/** A data key wrapped by one version of the master key. */
export interface WrappedKey {
  readonly masterKeyVersion: string;
  readonly ciphertext: Uint8Array;
}

/** What a wrap is bound to: the id of its space. */
export interface WrapContext {
  readonly space: string;
}

export interface KeyManagement {
  /** The master key version new wraps use; rewrapping moves older wraps to it (ARC-06 FR 3). */
  currentVersion(): Promise<string>;
  /** Wraps a 32-byte data key with the current master key version. */
  wrap(dataKey: Uint8Array, context: WrapContext): Promise<WrappedKey>;
  /** The data key of a wrap; refused (`ProviderError` «rejected») for a wrong space, a tampered wrap or a retired version. */
  unwrap(wrapped: WrappedKey, context: WrapContext): Promise<Uint8Array>;
}

/** AES-256 data keys only. */
export const DATA_KEY_BYTES = 32;

export function checkDataKey(dataKey: Uint8Array): void {
  if (dataKey.length !== DATA_KEY_BYTES) throw new Error(`A data key is ${DATA_KEY_BYTES} bytes`);
}
