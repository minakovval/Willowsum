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

export interface PasswordResetRow {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly revokedAt: number | null;
}

/**
 * A row lock on the account for the rest of the transaction: `update` for a change of its password or state,
 * `share` for a sign-in, so a sign-in with the old password and a password reset never overlap (NFR-15 FR 3).
 * Lock order: a sign-in guard first, then the account.
 */
export type AccountLock = "share" | "update";

export interface RegistrationRow {
  readonly id: string;
  readonly accountId: string;
  readonly kind: "new" | "existing";
  readonly expiresAt: number;
  readonly closedAt: number | null;
  /** A later sign-up replaced the unconfirmed account's password: the token answers as before but acts on nothing. */
  readonly supersededAt: number | null;
}

export interface SessionRow {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly endedAt: number | null;
}

/**
 * `confirmation-mail` and `attempt-mail` limit the letters an address gets (ACC-01 FR 15); `registration-resend`
 * limits one sign-up token's «Надіслати ще раз», whose answer depends on nothing but that token (NFR-15 FR 1).
 */
export type ThrottleScope = "sign-in-failure" | "confirmation-mail" | "attempt-mail" | "registration-resend";

/** One transaction of the identity schema. Digests and keys are SHA-256 (32 bytes); never a token or an address. */
export interface IdentityTx {
  findAccountByEmail(normalizedEmail: string, lock?: AccountLock): Promise<AccountRow | null>;
  findAccount(id: string, lock?: AccountLock): Promise<AccountRow | null>;
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
  /**
   * A new sign-up with the address of an unconfirmed account: its name and password are replaced (the latest
   * sign-up wins; owner decision 2026-11-12). False, and nothing changed, when the account is confirmed.
   */
  replaceUnconfirmedAccount(
    accountId: string,
    account: { displayName: string; passwordHash: string },
    now: number,
  ): Promise<boolean>;
  setPassword(accountId: string, passwordHash: string, now: number): Promise<void>;

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
  /** Marks every open «Перевірте пошту» token of the account superseded (a later sign-up replaced the password). */
  supersedeRegistrations(accountId: string, now: number): Promise<void>;

  insertPasswordReset(accountId: string, digest: Buffer, now: number, expiresAt: number): Promise<void>;
  /** Revokes every unused reset link of the account (a newer one replaces them, or the password changed). */
  revokePasswordResets(accountId: string, now: number): Promise<void>;
  /** The link of the digest; `lock` holds its row until the transaction ends (single use). */
  findPasswordReset(digest: Buffer, lock?: boolean): Promise<PasswordResetRow | null>;
  usePasswordReset(id: string, now: number): Promise<void>;
  /** Creation times of the account's reset links since `since`, oldest first: its reset letters. */
  passwordResetTimes(accountId: string, since: number): Promise<number[]>;

  /** Times of the scope's events for the key since `since`, oldest first. */
  eventTimes(scope: ThrottleScope, key: Buffer, since: number): Promise<number[]>;
  addEvent(scope: ThrottleScope, key: Buffer, at: number): Promise<void>;
  /** Serialises this transaction with every other one on the same scope and key until it ends. */
  lockSubject(scope: ThrottleScope, key: Buffer): Promise<void>;
  clearEvents(scope: ThrottleScope, key: Buffer): Promise<void>;
  /** The guard of the key, locked for this transaction (created empty when missing). */
  lockGuard(key: Buffer): Promise<SignInGuard>;
  readGuard(key: Buffer): Promise<SignInGuard | null>;
  setGuard(key: Buffer, guard: SignInGuard, now: number): Promise<void>;

  insertSession(accountId: string, digest: Buffer, now: number, expiresAt: number): Promise<void>;
  findSession(digest: Buffer): Promise<SessionRow | null>;
  touchSession(id: string, now: number): Promise<void>;
  endSession(id: string, now: number): Promise<void>;
  /** Ends every session of the account; returns how many were still open. */
  endSessions(accountId: string, now: number): Promise<number>;
}

/**
 * Creates the first space of an account on its first sign-in (ACC-01 FR 7): the household module's
 * `ensureFirstSpace`, wired by main.ts. Idempotent, also under concurrent sign-ins.
 */
export interface FirstSpace {
  ensureFirstSpace(owner: { readonly accountId: string; readonly displayName: string }): Promise<unknown>;
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
  /** The password was replaced (a reset, or a new sign-up of an unconfirmed address); the value is masked. */
  passwordChanged(accountId: string): Promise<void>;
}

export interface IdentityDeps {
  readonly store: IdentityStore;
  readonly now: () => number;
  readonly hasher: PasswordHasher;
  readonly secrets: Secrets;
  readonly captcha: CaptchaVerifier;
  /** Sends a letter after the answer (never awaited by a request: same time for every outcome). */
  readonly sendLater: (message: MailMessage) => void;
  /**
   * Runs work after the answer has gone (never awaited by a request): what depends on whether an address has an
   * account stays off the response path, so the answer and its time are the same (NFR-15 FR 1). A failure is
   * logged by its error class only.
   */
  readonly afterResponse: (task: () => Promise<void>) => void;
  readonly audit: AccountAudit;
  /** Sign-ups per client address: 5 in any hour (sliding window in the identity schema; NFR-14 limiter interface). */
  readonly signUpLimiter: FixedWindowLimiter;
  /** The web app's origin for links in letters, e.g. `https://app.example.org`. */
  readonly webOrigin: string;
  /** The first space on the first sign-in (household module). */
  readonly spaces: FirstSpace;
}
