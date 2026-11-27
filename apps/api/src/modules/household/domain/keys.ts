/**
 * Keys of spaces (ARC-06@PoC; ADR-0012): what is stored of a space's data key, the references in
 * `households.encryption_key_ref`, and the errors of sealing and opening. Pure: the cryptography is in the application.
 */
/** A space's data key as stored: its id, the master key version that wrapped it and the wrap (base64url). */
export interface StoredSpaceKey {
  readonly keyId: string;
  readonly masterKeyVersion: string;
  readonly wrappedKey: string;
  /**
   * The key may have been wrapped by the fixed-label test key at some time (NFR-01@PoC FR 3): it is replaced by the
   * data-key rotation (`space_keys.exposed`; absent is true). Never exposed: first wrapped by another master key.
   */
  readonly exposed?: boolean;
}

/** A replacement of a space's data key in progress (`space_key_rotations`): the new key's wrap, never the key. */
export interface StoredKeyRotation {
  readonly oldKeyId: string;
  readonly newKey: StoredSpaceKey;
  /** The parts of the space's data (modules with sealed values) already sealed with the new key. */
  readonly doneParts: readonly string[];
}

export const SPACE_KEY_ERROR_CODES = [
  "SPACE_KEY_MISSING",
  "SPACE_KEY_DESTROYED",
  "SEALED_VALUE_INVALID",
  // The space's data key is being replaced (kms:rotate-data-keys): nothing is sealed or opened until it is done.
  "SPACE_KEY_ROTATING",
] as const;
export type SpaceKeyErrorCode = (typeof SPACE_KEY_ERROR_CODES)[number];

/** A seal or open that cannot be done. The message names the code only, never the value or the key. */
export class SpaceKeyError extends Error {
  readonly code: SpaceKeyErrorCode;
  constructor(code: SpaceKeyErrorCode) {
    super(`Space key: ${code}`);
    this.name = "SpaceKeyError";
    this.code = code;
  }
}

/** `households.encryption_key_ref` of a space with a key, after its destruction, and before it has one. */
export const keyRef = {
  live: (keyId: string) => `dek:${keyId}`,
  destroyed: (keyId: string) => `destroyed:${keyId}`,
  pendingPrefix: "pending:",
  destroyedPrefix: "destroyed:",
} as const;
