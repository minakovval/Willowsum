/**
 * The numbers of ACC-01@PoC, NFR-01@PoC and NFR-14@PoC that identity enforces (ADR-0009). Time in milliseconds.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** An email confirmation link is valid 24 h (ACC-01 FR 4). */
export const CONFIRMATION_TTL_MS = 24 * HOUR;
/** The «Перевірте пошту» screen's token lives as long as the link it stands for. */
export const REGISTRATION_TTL_MS = 24 * HOUR;
/** A password reset link is valid 60 min and works once; a newer one revokes the older (ACC-01 FR 10, NFR-15 FR 3). */
export const PASSWORD_RESET_TTL_MS = 60 * MINUTE;
/** «Надіслати ще раз»: at most once per 60 s … (ACC-01 FR 15) */
export const MAIL_COOLDOWN_MS = MINUTE;
/**
 * … and at most 5 letters per hour per address, for confirmations and for sign-up attempt letters alike. Password
 * reset letters keep the same limit per account (ADR-0009, part b): a request over it changes nothing.
 */
export const MAIL_PER_HOUR = 5;
export const MAIL_WINDOW_MS = HOUR;
/** Sign-ups per client address per hour (ACC-01, NFR-14 FR 7). */
export const SIGN_UPS_PER_ADDRESS_PER_HOUR = 5;
export const SIGN_UP_WINDOW_MS = HOUR;
/** 5 failed sign-ins in 15 min for one email → locked 15 min → a CAPTCHA at every attempt after it. */
export const SIGN_IN_FAILURES_LIMIT = 5;
export const SIGN_IN_FAILURE_WINDOW_MS = 15 * MINUTE;
export const SIGN_IN_LOCK_MS = 15 * MINUTE;
/** A web session ends after 12 h at most and after 15 min without use (NFR-01 FR 10). */
export const SESSION_ABSOLUTE_MS = 12 * HOUR;
export const SESSION_IDLE_MS = 15 * MINUTE;

/** Whole seconds until `until` (at least 1): the `Retry-After` of a refusal. */
export function secondsUntil(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

/**
 * The sliding mail limit of one address (ACC-01 FR 15): `sent` are the times of its letters in the last hour,
 * oldest first. Returns the seconds to wait, or 0 when a letter may go now.
 */
export function mailWaitS(sent: readonly number[], now: number): number {
  const recent = sent.filter((t) => t > now - MAIL_WINDOW_MS).sort((a, b) => a - b);
  let until = 0;
  const last = recent.at(-1);
  if (last !== undefined && last > now - MAIL_COOLDOWN_MS) until = last + MAIL_COOLDOWN_MS;
  if (recent.length >= MAIL_PER_HOUR)
    until = Math.max(until, recent[recent.length - MAIL_PER_HOUR]! + MAIL_WINDOW_MS);
  return until > now ? secondsUntil(until, now) : 0;
}

/** What a sign-in attempt meets before the password is checked (ACC-01, NFR-01 FR 9). */
export type SignInGate =
  | { readonly kind: "locked"; readonly retryAfterS: number }
  | { readonly kind: "captcha" }
  | { readonly kind: "open" };

export interface SignInGuard {
  /** Epoch ms; the lock is over when it is not ahead. */
  readonly lockedUntil: number | null;
  readonly captchaRequired: boolean;
}

export function signInGate(guard: SignInGuard | null, now: number): SignInGate {
  if (guard?.lockedUntil != null && guard.lockedUntil > now)
    return { kind: "locked", retryAfterS: secondsUntil(guard.lockedUntil, now) };
  if (guard?.captchaRequired) return { kind: "captcha" };
  return { kind: "open" };
}

/**
 * After a failed attempt: `failures` is the number of failed attempts in the last 15 min, this one included.
 * The 5th locks the email for 15 min, and from then on every attempt needs a CAPTCHA.
 */
export function afterFailure(failures: number, now: number): SignInGuard | null {
  return failures >= SIGN_IN_FAILURES_LIMIT
    ? { lockedUntil: now + SIGN_IN_LOCK_MS, captchaRequired: true }
    : null;
}

/** Can a password reset link still change the password at `now`? Used, revoked (a newer one) or 60 min old → no. */
export function resetLinkUsable(
  link: { readonly expiresAt: number; readonly usedAt: number | null; readonly revokedAt: number | null },
  now: number,
): boolean {
  return link.usedAt === null && link.revokedAt === null && now < link.expiresAt;
}

/** Is a session still valid at `now`? Its absolute end and its idleness both end it. */
export function sessionAlive(
  session: { readonly expiresAt: number; readonly lastSeenAt: number; readonly endedAt: number | null },
  now: number,
): boolean {
  return session.endedAt === null && now < session.expiresAt && now - session.lastSeenAt < SESSION_IDLE_MS;
}

const DAY = 24 * HOUR;

/**
 * An unconfirmed account is deleted with its data by the daily task 30 days after its sign-up (ACC-01 FR 6, AC9;
 * NFR-12). The latest sign-up counts: a new sign-up with the address of an unconfirmed account replaces its
 * password and is its registration now (owner decision 2026-11-12, ADR-0009 part b).
 */
export const UNCONFIRMED_ACCOUNT_TTL_MS = 30 * DAY;
/**
 * What the daily task keeps of the growing identity tables (ADR-0010; lead decision). A row goes once it can no
 * longer change any answer or any limit:
 * - limit events after the longest window (1 h);
 * - password reset links after their 60 min and the hour of the letter limit;
 * - sessions once ended, past their 12 h or 15 min idle;
 * - «Перевірте пошту» tokens once closed or expired (a superseded open one keeps answering as before until then);
 * - revoked confirmation links at once (they answer like unknown ones); used and expired ones are never swept, so
 *   «вже використано» (AC24) and «Посилання недійсне» with «Надіслати ще раз» (AC6) keep answering; they go with
 *   their account (cascade);
 * - sign-in guards once unlocked and without the CAPTCHA mark; a marked guard stays until a successful sign-in or a
 *   reset clears the mark, so every later attempt still needs the CAPTCHA (AC14).
 */
export const THROTTLE_RETENTION_MS = Math.max(MAIL_WINDOW_MS, SIGN_UP_WINDOW_MS, SIGN_IN_FAILURE_WINDOW_MS);
export const PASSWORD_RESET_RETENTION_MS = Math.max(PASSWORD_RESET_TTL_MS, MAIL_WINDOW_MS);
