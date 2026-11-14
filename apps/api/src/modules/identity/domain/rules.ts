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
  return session.endedAt === null && sessionLapse(session, now) === null;
}

/**
 * Why a session ended, as stored (ACC-04@PoC; ADR-0009 «Сесії», decision log 2026-11-13-acc04-session-refresh): `signed-out` (this browser — any tab — signed out),
 * `idle` (15 min without a user action), `expired` (12 h after sign-in), `password-reset` (a reset ended every
 * session of the account), `token-reuse` (a token replaced more than the grace period ago came back: it was copied,
 * so the whole session ends), `not-me` («Це був не я» ended every session of the account; ACC-04 FR 5),
 * `password-change` (a password change in the profile ended every other session; ACC-04 FR 6, ACC-05 FR 5),
 * `step-up-locked` (wrong step-up passwords reached the sign-in limit and ended this session; NFR-01 FR 13).
 */
export type SessionEndReason =
  | "signed-out"
  | "idle"
  | "expired"
  | "password-reset"
  | "token-reuse"
  | "not-me"
  | "password-change"
  | "step-up-locked";

/**
 * What the client is told (ACC-04 «Стани інтерфейсу»): `idle` → «Сесію завершено через бездіяльність»;
 * `ended-elsewhere` → «Сесію завершено з іншого пристрою» (a reset, a reused token); `expired` and `signed-out` →
 * the sign-in screen.
 */
export type SessionEndShown = "idle" | "expired" | "signed-out" | "ended-elsewhere";

export function shownEndReason(reason: SessionEndReason | null): SessionEndShown {
  switch (reason) {
    case "idle":
    case "expired":
      return reason;
    case "password-reset":
    case "token-reuse":
    case "not-me":
    case "password-change":
      return "ended-elsewhere";
    // A session ended before reasons were stored was ended by sign-out or by the failed first space. A session the
    // step-up lock ended was told so in the answer that ended it (429 SIGN_IN_LOCKED); its other tabs see the sign-in.
    case "step-up-locked":
    case "signed-out":
    case null:
      return "signed-out";
  }
}

/** Why a session not ended yet must end at `now`, or null while it is alive (absolute end first). */
export function sessionLapse(
  session: { readonly expiresAt: number; readonly lastSeenAt: number },
  now: number,
): "expired" | "idle" | null {
  if (now >= session.expiresAt) return "expired";
  if (now - session.lastSeenAt >= SESSION_IDLE_MS) return "idle";
  return null;
}

/**
 * Refresh token rotation (NFR-01 FR 12): every refresh replaces the session's token. The replaced token still
 * authenticates for this long, so requests already on their way from other tabs of the same browser (which share
 * the cookie) do not fail; it never refreshes again. After it, the token's return means it was copied.
 */
export const ROTATION_GRACE_MS = 30_000;

/** How a presented token stands: the session's current token, a replaced one within the grace, or a reuse. */
export function tokenStanding(retiredAt: number | null, now: number): "current" | "grace" | "reuse" {
  if (retiredAt === null) return "current";
  return now - retiredAt < ROTATION_GRACE_MS ? "grace" : "reuse";
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
