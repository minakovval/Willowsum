import { createHash, randomBytes } from "node:crypto";
import type * as Argon2 from "@node-rs/argon2";
import type { PasswordHasher, Secrets } from "../application/index.ts";

/**
 * Password hashing (NFR-01, ADR-0009): argon2id through @node-rs/argon2 (a maintained binding of the reference
 * implementation; no own cryptography, AGENTS.md). Parameters of OWASP's Password Storage Cheat Sheet: 19 MiB,
 * 2 passes, 1 lane — about 20 ms on one core. The PHC string stores them, so raising them later keeps old
 * hashes verifiable; re-hashing them at sign-in is not built yet.
 */
/** `Algorithm.Argon2id` of @node-rs/argon2 (a const enum, which type stripping cannot inline). */
const ARGON2ID = 2;

export const ARGON2_PARAMETERS = Object.freeze({
  algorithm: ARGON2ID as 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

/**
 * The native binding is loaded on first use, not when the module is imported: a process that never hashes
 * (worker, scheduler, a start refused by the configuration) does not load it. main.ts hashes once at start of
 * the api role, so a missing binding stops the start instead of the first sign-up.
 */
let binding: Promise<typeof Argon2> | undefined;
const argon2 = () => (binding ??= import("@node-rs/argon2"));

export function argon2Hasher(parameters: Partial<typeof ARGON2_PARAMETERS> = {}): PasswordHasher {
  const options = { ...ARGON2_PARAMETERS, ...parameters };
  return {
    hash: async (password) => (await argon2()).hash(password, options),
    verify: async (phc, password) => {
      const { verify } = await argon2();
      try {
        return await verify(phc, password);
      } catch {
        return false;
      }
    },
  };
}

/** Tokens and digests (ADR-0009): 256 random bits from the OS, stored only as SHA-256. */
export const nodeSecrets: Secrets = Object.freeze({
  token: () => randomBytes(32).toString("base64url"),
  digest: (text: string) => createHash("sha256").update(text, "utf8").digest(),
});
