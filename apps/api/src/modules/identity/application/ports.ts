import type { CaptchaVerifier } from "../../../platform/adapters/captcha/index.ts";
import type { MailMessage } from "../../../platform/adapters/mail/index.ts";
import type { FixedWindowLimiter } from "../../../platform/http/rate-limit.ts";
import type { SignInGuard } from "../domain/index.ts";

/** Ports of the identity use cases (ARC-01 FR 5); adapters are wired in ../index.ts. Times are epoch ms. */

export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly emailConfirmedAt: number | null;
}

export interface ConfirmationRow {
  readonly id: string;
  readonly accountId: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly revokedAt: number | null;
}

export interface RegistrationRow {
  readonly id: string;
  readonly accountId: string;
  readonly kind: "new" | "existing";
  readonly expiresAt: number;
  readonly closedAt: number | null;
}

export interface SessionRow {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly endedAt: number | null;
}

export type ThrottleScope = "sign-in-failure" | "confirmation-mail" | "attempt-mail";

/** One transaction of the identity schema. Digests and keys are SHA-256 (32 bytes); never a token or an address. */
export interface IdentityTx {
  findAccountByEmail(normalizedEmail: string): Promise<AccountRow | null>;
  findAccount(id: string): Promise<AccountRow | null>;
  /** Null when an account with the address already exists (a concurrent sign-up won). */
  insertAccount(account: {
    email: string;
    normalizedEmail: string;
    displayName: string;
    passwordHash: string;
    now: number;
  }): Promise<string | null>;
  /** Marks the address confirmed; false when it already was. */
  confirmAccount(accountId: string, now: number): Promise<boolean>;

  insertConfirmation(accountId: string, digest: Buffer, now: number, expiresAt: number): Promise<void>;
  /** Revokes every unused link of the account (a newer one replaces them). */
  revokeConfirmations(accountId: string, now: number): Promise<void>;
  findConfirmation(digest: Buffer): Promise<ConfirmationRow | null>;
  useConfirmation(id: string, now: number): Promise<void>;

  insertRegistration(
    accountId: string,
    kind: "new" | "existing",
    digest: Buffer,
    now: number,
    expiresAt: number,
  ): Promise<void>;
  findRegistration(digest: Buffer): Promise<RegistrationRow | null>;
  closeRegistration(id: string, now: number): Promise<void>;

  /** Times of the scope's events for the key since `since`, oldest first. */
  eventTimes(scope: ThrottleScope, key: Buffer, since: number): Promise<number[]>;
  addEvent(scope: ThrottleScope, key: Buffer, at: number): Promise<void>;
  clearEvents(scope: ThrottleScope, key: Buffer): Promise<void>;
  /** The guard of the key, locked for this transaction (created empty when missing). */
  lockGuard(key: Buffer): Promise<SignInGuard>;
  readGuard(key: Buffer): Promise<SignInGuard | null>;
  setGuard(key: Buffer, guard: SignInGuard, now: number): Promise<void>;

  insertSession(accountId: string, digest: Buffer, now: number, expiresAt: number): Promise<void>;
  findSession(digest: Buffer): Promise<SessionRow | null>;
  touchSession(id: string, now: number): Promise<void>;
  endSession(id: string, now: number): Promise<void>;
}

export interface IdentityStore {
  transaction<T>(work: (tx: IdentityTx) => Promise<T>): Promise<T>;
}

/** argon2id (ADR-0009). `verify` never throws for a malformed hash: it is false. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface Secrets {
  /** A fresh opaque token: 32 random bytes, base64url (43 characters). */
  token(): string;
  /** SHA-256 of text (a token, a normalised address). */
  digest(text: string): Buffer;
}

/** The changes identity writes to the platform audit log (no space exists yet): ids and states only. */
export interface AccountAudit {
  accountChanged(accountId: string, before: string | null, after: string): Promise<void>;
}

export interface IdentityDeps {
  readonly store: IdentityStore;
  readonly now: () => number;
  readonly hasher: PasswordHasher;
  readonly secrets: Secrets;
  readonly captcha: CaptchaVerifier;
  /** Sends a letter after the answer (never awaited by a request: same time for every outcome). */
  readonly sendLater: (message: MailMessage) => void;
  readonly audit: AccountAudit;
  /** NFR-14 fixed-window limiter of sign-ups per client address (5 per hour), over a store that survives restarts. */
  readonly signUpLimiter: FixedWindowLimiter;
  /** The web app's origin for links in letters, e.g. `https://app.example.org`. */
  readonly webOrigin: string;
}
