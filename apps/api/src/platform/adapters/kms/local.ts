import { hkdfSync } from "node:crypto";
import { refused, unwrapWith, wrapWith } from "./aes-wrap.ts";
import type { KeyManagement, WrappedKey } from "./port.ts";

/**
 * The fixed-label test implementation of the KMS port (ARC-05 FR 2; `WS_PROVIDER_MODE=test`): tests and CI only.
 * The key of version `local-N` is derived with HKDF-SHA256 from a fixed label that is NOT a secret: it protects
 * nothing, so an instance marked as holding real data (`WS_REAL_DATA=true`) never runs with it (NFR-01@PoC FR 3,
 * NFR-15@PoC FR 26): it takes its installation's random key from a file instead (key-file.ts). Deployed environments
 * run `live` (index.ts gives them the fail-closed implementation otherwise). `rotate` and `retire` exist for the
 * rotation test (ARC-06 FR 3); they change only this instance.
 */
export interface LocalKeyManagement extends KeyManagement {
  /** Adds a master key version and makes it current; returns its name. */
  rotate(): string;
  /** Stops a version from unwrapping (as disabling it in the KMS would); the current version cannot be retired. */
  retire(version: string): void;
}

const LABEL = "willowsum local test KMS (not a secret)";
const VERSION_RE = /^local-([1-9][0-9]{0,5})$/;

/** A master key version of the fixed-label test key (`local-N`): the re-wrap command moves such wraps away. */
export function isFixedLabelVersion(version: string): boolean {
  return VERSION_RE.test(version);
}

function versionKey(version: string): Buffer {
  return Buffer.from(hkdfSync("sha256", LABEL, "", version, 32));
}

export function localKeyManagement(): LocalKeyManagement {
  let current = 1;
  const retired = new Set<string>();
  const name = (n: number) => `local-${n}`;
  return {
    currentVersion: async () => name(current),
    async wrap(dataKey, context) {
      const version = name(current);
      return wrapWith(versionKey(version), version, dataKey, context);
    },
    async unwrap(wrapped: WrappedKey, context) {
      const m = VERSION_RE.exec(wrapped.masterKeyVersion);
      const usable = m !== null && Number(m[1]) <= current && !retired.has(wrapped.masterKeyVersion);
      return unwrapWith(usable ? versionKey(wrapped.masterKeyVersion) : undefined, wrapped, context);
    },
    rotate() {
      current += 1;
      return name(current);
    },
    retire(version) {
      if (version === name(current)) throw new Error("The current master key version cannot be retired");
      retired.add(version);
    },
  };
}

/**
 * The fixed-label key as the source of the one-time re-wrap (scripts/kms-rewrap.ts): it unwraps a wrap of any
 * `local-N` version and never wraps, so nothing new is ever made with it.
 */
export function fixedLabelSource(): KeyManagement {
  return {
    currentVersion: async () => {
      throw refused("wrap");
    },
    wrap: async () => {
      throw refused("wrap");
    },
    async unwrap(wrapped, context) {
      const usable = VERSION_RE.test(wrapped.masterKeyVersion);
      return unwrapWith(usable ? versionKey(wrapped.masterKeyVersion) : undefined, wrapped, context);
    },
  };
}
