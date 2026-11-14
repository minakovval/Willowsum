import type { CaptchaVerifier } from "../../../platform/adapters/captcha/index.ts";
import type { MailMessage } from "../../../platform/adapters/mail/index.ts";
import type { FixedWindowLimiter } from "../../../platform/http/rate-limit.ts";
import type {
  DeviceName,
  SessionEndReason,
  SignInGuard,
  StepUpAction,
  StepUpConfirmation,
} from "../domain/index.ts";

/** Ports of the identity use cases (ARC-01 FR 5); adapters are wired in ../index.ts. Times are epoch ms. */

export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly emailConfirmedAt: number | null;
  /** Set by «Це був не я»: every sign-in is refused until the password changes (ACC-04 FR 5). */
  readonly passwordResetRequiredAt: number | null;
  /** The format of dates and numbers from the browser at sign-up (BCP 47, canonical; ACC-05 FR 3), or null. */
  readonly locale: string | null;
  /** The IANA time zone from the browser at sign-up (ACC-05 FR 3), or null. */
  readonly timeZone: string | null;
}

/** A step-up confirmation (NFR-01 FR 13, NFR-15 FR 4) as stored. */
export interface StepUpRow extends StepUpConfirmation {
  readonly id: string;
}

/** A «Це був не я» link of a new-device letter (ACC-04 FR 5) and the sign-in it is about. */
export interface NotMeLinkRow {
  readonly id: string;
  readonly accountId: string;
  readonly deviceDigest: Buffer;
  readonly signedInAt: number;
  readonly device: DeviceName;
  /** Already masked (`89.64.•••.12`); the full address is never stored. */
  readonly addressMasked: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
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

/**
 * What a sign-up found (ACC-01 FR 8, 16): it created the account (`new`), found one with the address (`existing`,
 * never changed), or the address is outside the family's list (`outside`: no account, no letter; the token answers
 * like any other). Clients cannot tell them apart.
 */
export type RegistrationKind = "new" | "existing" | "outside";

export interface RegistrationRow {
  readonly id: string;
  /** Null exactly for `outside`. */
  readonly accountId: string | null;
  readonly kind: RegistrationKind;
  readonly expiresAt: number;
  readonly closedAt: number | null;
  /** A later sign-up replaced the unconfirmed account's password: the token answers as before but acts on nothing. */
  readonly supersededAt: number | null;
}

export interface SessionRow {
  readonly id: string;
  readonly accountId: string;
  readonly createdAt: number;
  /** The last refresh (a user action, ACC-04 business rules), or the sign-in. */
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly endedAt: number | null;
  /** Null while open, and on sessions ended before reasons were stored. */
  readonly endReason: SessionEndReason | null;
  /** When a refresh replaced the token that found this row; null for the session's current token. */
  readonly retiredAt: number | null;
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
    locale: string | null;
    timeZone: string | null;
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
    account: { displayName: string; passwordHash: string; locale: string | null; timeZone: string | null },
    now: number,
  ): Promise<boolean>;
  /** The profile's name (ACC-05 FR 1); false when the account is gone. */
  setDisplayName(accountId: string, displayName: string, now: number): Promise<boolean>;
  /** A new password; it also lifts «Це був не я»'s requirement to change it (ACC-04 FR 5). */
  setPassword(accountId: string, passwordHash: string, now: number): Promise<void>;
  /** «Це був не я»: every sign-in is refused until the password changes. */
  requirePasswordReset(accountId: string, now: number): Promise<void>;

  /**
   * Adds the device to the account's sign-in history (NFR-15 FR 29). `first`: the account had no history yet (its
   * first sign-in starts it, no letter); `known`: the device is in it; `new`: a device the history did not have.
   * Serialised per account, so two first sign-ins at once cannot both count as the first.
   */
  rememberDevice(accountId: string, deviceDigest: Buffer, now: number): Promise<"first" | "known" | "new">;
  /** «Це був не я»: the device of the suspicious sign-in leaves the history, so its next sign-in is reported again. */
  forgetDevice(accountId: string, deviceDigest: Buffer): Promise<void>;
  insertNotMeLink(link: {
    accountId: string;
    tokenDigest: Buffer;
    deviceDigest: Buffer;
    signedInAt: number;
    device: DeviceName;
    addressMasked: string;
    expiresAt: number;
  }): Promise<void>;
  /** The link of the digest; `lock` holds its row until the transaction ends (single use). */
  findNotMeLink(digest: Buffer, lock?: boolean): Promise<NotMeLinkRow | null>;
  useNotMeLink(id: string, now: number): Promise<void>;

  insertConfirmation(accountId: string, digest: Buffer, now: number, expiresAt: number): Promise<void>;
  /** Revokes every unused link of the account (a newer one replaces them). */
  revokeConfirmations(accountId: string, now: number): Promise<void>;
  findConfirmation(digest: Buffer): Promise<ConfirmationRow | null>;
  useConfirmation(id: string, now: number): Promise<void>;

  /** `accountId` is null exactly for an `outside` sign-up. */
  insertRegistration(
    accountId: string | null,
    kind: RegistrationKind,
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
  /**
   * The session of a token: its current one or one a refresh replaced (`retiredAt`). `lock` holds the session row
   * until the transaction ends, so two refreshes of one session run one after another.
   */
  findSession(digest: Buffer, lock?: boolean): Promise<SessionRow | null>;
  /** A user action: the idle deadline moves (ACC-04 FR 1, business rules). */
  touchSession(id: string, now: number): Promise<void>;
  /** Refresh token rotation (NFR-01 FR 12): `next` becomes the session's token, its current one is retired. */
  rotateSession(id: string, next: Buffer, now: number): Promise<void>;
  endSession(id: string, now: number, reason: SessionEndReason): Promise<void>;
  /** Ends every session of the account; returns how many were still open. */
  endSessions(accountId: string, now: number, reason: SessionEndReason): Promise<number>;
  /** Ends every session of the account but `keep` (a password change in the profile; ACC-04 FR 6). */
  endOtherSessions(accountId: string, keep: string, now: number, reason: SessionEndReason): Promise<number>;

  /** A new step-up confirmation; it replaces the session's earlier ones for the same action. */
  insertStepUp(confirmation: {
    sessionId: string;
    action: StepUpAction;
    tokenDigest: Buffer;
    now: number;
    expiresAt: number;
  }): Promise<void>;
  /** The confirmation of the digest; `lock` holds its row until the transaction ends (single use). */
  findStepUp(digest: Buffer, lock?: boolean): Promise<StepUpRow | null>;
  useStepUp(id: string, now: number): Promise<void>;

  /**
   * Deletes up to `limit` unconfirmed accounts whose latest sign-up is at or before `signedUpBy`, with all their
   * rows (ACC-01 FR 6); an account confirmed or held by another transaction meanwhile stays. Returns their ids.
   */
  deleteUnconfirmedAccounts(signedUpBy: number, limit: number): Promise<string[]>;
  /** Deletes what no longer changes an answer or a limit at `now` (ADR-0010); returns the rows per table. */
  sweep(now: number): Promise<SweepCounts>;
}

/** Rows deleted per table by the daily task. */
export interface SweepCounts {
  readonly throttleEvents: number;
  readonly signInGuards: number;
  readonly registrations: number;
  readonly emailConfirmations: number;
  readonly passwordResets: number;
  readonly sessions: number;
  readonly notMeLinks: number;
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

/** Whether an account may sign in (ACC-04 FR 5): the audited state of «Це був не я». */
export type SignInState = "allowed" | "password-reset-required";

/** The changes identity writes to the platform audit log (no space exists yet): ids and states only. */
export interface AccountAudit {
  accountChanged(accountId: string, before: string | null, after: string): Promise<void>;
  /** The password was replaced (a reset, a change in the profile, or a new sign-up of an unconfirmed address); masked. */
  passwordChanged(accountId: string): Promise<void>;
  /** The profile's name changed (ACC-05 FR 1); the values are masked (no personal data in the platform log). */
  displayNameChanged(accountId: string): Promise<void>;
  /** «Це був не я» (ACC-04 FR 5): sign-in refused until a new password (`password-reset-required`), or allowed again. */
  signInChanged(accountId: string, before: SignInState, after: SignInState): Promise<void>;
  /** The daily task deleted an unconfirmed account (ACC-01 FR 6). */
  accountDeleted(accountId: string): Promise<void>;
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
  /**
   * May this login key (`normalizeEmail`) sign up (ACC-01 FR 16)? The family's list from the server's configuration;
   * without one (local development and CI) every address may.
   */
  readonly signUpAllowed: (normalizedEmail: string) => boolean;
}

/** What the daily task needs (ACC-01 FR 6; ADR-0010). */
export interface MaintenanceDeps {
  readonly store: IdentityStore;
  readonly now: () => number;
  readonly audit: Pick<AccountAudit, "accountDeleted">;
}
