import {
  CONFIRMATION_TTL_MS,
  afterFailure,
  confirmationLetter,
  confirmationLink,
  deviceKey,
  deviceName,
  legacyDeviceKey,
  maskedAddress,
  mailWaitS,
  newSignInLetter,
  NOT_ME_TTL_MS,
  notMeLink,
  MAIL_COOLDOWN_MS,
  MAIL_WINDOW_MS,
  normalizeEmail,
  normalizePassword,
  passwordResetLink,
  REGISTRATION_TTL_MS,
  secondsUntil,
  SESSION_ABSOLUTE_MS,
  sessionLapse,
  shownEndReason,
  SIGN_IN_FAILURE_WINDOW_MS,
  signInGate,
  signUpAttemptLetter,
  tokenStanding,
  type SessionEndShown,
  type SignInEvent,
} from "../domain/index.ts";
import type { MailMessage } from "../../../platform/adapters/mail/index.ts";
import type { AccountRow, IdentityDeps, IdentityTx, SessionRow, ThrottleScope } from "./ports.ts";

/**
 * The use cases of ACC-01@PoC part a (ADR-0009): sign-up, the «Перевірте пошту» screen's actions, email
 * confirmation, sign-in with lockout and CAPTCHA, the session. Every answer that could tell whether an address
 * has an account is the same for both (ACC-01 FR 8, 9, 13; NFR-15 FR 1, 2); letters go after the answer.
 */

/** «Надіслати ще раз» waits this long after a letter (ACC-01 FR 15); the screen counts it down. */
export const RESEND_AFTER_S = MAIL_COOLDOWN_MS / 1000;

export type SignUpResult =
  | { readonly kind: "check-email"; readonly registrationToken: string; readonly resendAfterS: number }
  | { readonly kind: "too-many"; readonly retryAfterS: number }
  | { readonly kind: "captcha" };

export type ResendResult =
  | { readonly kind: "sent"; readonly resendAfterS: number }
  | { readonly kind: "wait"; readonly retryAfterS: number }
  | { readonly kind: "not-found" };

export type ConfirmResult = "confirmed" | "expired" | "already-used" | "invalid";

export type SignInResult =
  | { readonly kind: "signed-in"; readonly sessionToken: string; readonly maxAgeS: number }
  | {
      readonly kind: "email-not-confirmed";
      readonly registrationToken: string;
      readonly resendAfterS: number;
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "locked"; readonly retryAfterS: number }
  | { readonly kind: "captcha" }
  /** The right password, but «Це був не я» requires a new one first (ACC-04 FR 5): no session. */
  | { readonly kind: "password-reset-required" };

export interface SessionAccount {
  readonly accountId: string;
  readonly name: string;
  readonly email: string;
}

const mailScope = (kind: "new" | "existing"): ThrottleScope =>
  kind === "new" ? "confirmation-mail" : "attempt-mail";

/**
 * Sends one letter of a registration if the address's mail limit allows (ACC-01 FR 15); records it. Returns
 * the seconds to wait when it does not. A `new` registration whose account was confirmed meanwhile gets no
 * letter, but the same answer.
 */
async function sendRegistrationLetter(
  deps: IdentityDeps,
  tx: IdentityTx,
  account: AccountRow,
  kind: "new" | "existing",
  now: number,
  send = true,
): Promise<number> {
  const normalizedEmail = normalizeEmail(account.email);
  const key = deps.secrets.digest(normalizedEmail);
  const scope = mailScope(kind);
  const wait = await mailLimit(tx, scope, key, now);
  // `send = false` (a superseded sign-up), or an address taken off the family's list since its sign-up (ACC-01
  // FR 16): the same lock and reads, then nothing.
  if (wait > 0 || !send || !deps.signUpAllowed(normalizedEmail)) return wait;
  await tx.addEvent(scope, key, now);
  if (kind === "existing") {
    const letter = signUpAttemptLetter(account.displayName, passwordResetLink(deps.webOrigin));
    deps.sendLater({ to: account.email, ...letter });
    return 0;
  }
  if (account.emailConfirmedAt !== null) return 0;
  const token = deps.secrets.token();
  await tx.revokeConfirmations(account.id, now);
  await tx.insertConfirmation(account.id, deps.secrets.digest(token), now, now + CONFIRMATION_TTL_MS);
  const letter = confirmationLetter(account.displayName, confirmationLink(deps.webOrigin, token));
  deps.sendLater({ to: account.email, ...letter });
  return 0;
}

/**
 * The mail limit of a subject, read under its lock: parallel requests for one address are checked one after
 * another, so the limit holds (ACC-01 FR 15). Returns the seconds to wait; records nothing.
 */
async function mailLimit(tx: IdentityTx, scope: ThrottleScope, key: Buffer, now: number): Promise<number> {
  await tx.lockSubject(scope, key);
  return mailWaitS(await tx.eventTimes(scope, key, now - MAIL_WINDOW_MS), now);
}

export async function signUp(
  deps: IdentityDeps,
  input: {
    name: string;
    email: string;
    password: string;
    captchaToken: string | undefined;
    clientAddress: string;
    /** The browser's format and time zone (ACC-05 FR 3), already validated; kept only on a new or replaced account. */
    locale?: string | undefined;
    timeZone?: string | undefined;
  },
): Promise<SignUpResult> {
  const locale = input.locale ?? null;
  const timeZone = input.timeZone ?? null;
  // NFR-14 FR 7: 5 sign-ups per hour per address, counted before anything else (also before the CAPTCHA).
  const limit = await deps.signUpLimiter.hit(
    `sign-up:${deps.secrets.digest(input.clientAddress).toString("hex")}`,
  );
  if (!limit.allowed) return { kind: "too-many", retryAfterS: limit.retryAfterS };
  if (input.captchaToken === undefined || !(await deps.captcha.verify(input.captchaToken)))
    return { kind: "captcha" };
  // Hashed for every sign-up, taken address or not: the work and its time are the same (NFR-15 FR 1).
  const passwordHash = await deps.hasher.hash(normalizePassword(input.password));
  const now = deps.now();
  const registrationToken = deps.secrets.token();
  const normalizedEmail = normalizeEmail(input.email);
  if (!deps.signUpAllowed(normalizedEmail)) {
    // ACC-01 FR 16, AC26: an address outside the family's list. No account, no letter, no audit entry; the answer
    // is the same (the password was hashed above, as for every address). The token's buttons must answer like any
    // other, so it is stored, tied to no account and to no address. The address's mail limit is read under its
    // lock as for a listed address's letter; nothing is recorded on it.
    await deps.store.transaction(async (tx) => {
      const tokenKey = deps.secrets.digest(registrationToken);
      await tx.insertRegistration(null, "outside", tokenKey, now, now + REGISTRATION_TTL_MS);
      await tx.addEvent("registration-resend", tokenKey, now);
      await mailLimit(tx, mailScope("new"), deps.secrets.digest(normalizedEmail), now);
    });
    return { kind: "check-email", registrationToken, resendAfterS: RESEND_AFTER_S };
  }
  const changed = await deps.store.transaction(async (tx) => {
    const insert = () =>
      tx.insertAccount({
        email: input.email.trim(),
        normalizedEmail,
        displayName: input.name,
        passwordHash,
        locale,
        timeZone,
        now,
      });
    let id = await insert();
    let account =
      id === null ? await tx.findAccountByEmail(normalizedEmail, "update") : await tx.findAccount(id);
    if (!account && id === null) {
      // The daily task deleted the unconfirmed account with this address in between (ACC-01 FR 6): a new one.
      id = await insert();
      account = id === null ? null : await tx.findAccount(id);
    }
    if (!account) throw new Error("identity: the account of a sign-up is missing");
    let kind: "new" | "existing" = id === null ? "existing" : "new";
    let replaced = false;
    if (
      id === null &&
      account.emailConfirmedAt === null &&
      (await tx.replaceUnconfirmedAccount(
        account.id,
        { displayName: input.name, passwordHash, locale, timeZone },
        now,
      ))
    ) {
      // Pre-account squatting (owner decision 2026-11-12): a new sign-up with the address of an unconfirmed
      // account replaces its password (the latest wins); every earlier link is revoked, so only the newest
      // letter's link can confirm, and it confirms the newest password. The earlier sign-ups' «Перевірте пошту»
      // tokens keep answering as before (closing them would tell their holder the address had no confirmed
      // account) but no longer send a letter or revoke a link.
      await tx.revokeConfirmations(account.id, now);
      await tx.supersedeRegistrations(account.id, now);
      account = { ...account, displayName: input.name, passwordHash };
      kind = "new";
      replaced = true;
    }
    await tx.insertRegistration(
      account.id,
      kind,
      deps.secrets.digest(registrationToken),
      now,
      now + REGISTRATION_TTL_MS,
    );
    // The token's own resend limit starts now, whether a letter went or not (NFR-15 FR 1).
    await tx.addEvent("registration-resend", deps.secrets.digest(registrationToken), now);
    // A confirmed address gets the attempt letter only within its limit; the answer is the same either way.
    await sendRegistrationLetter(deps, tx, account, kind, now);
    return id !== null ? { created: id } : replaced ? { replaced: account.id } : null;
  });
  // One audit entry for a new account and for a replaced password alike (the same work on the response path).
  if (changed && "created" in changed) await deps.audit.accountChanged(changed.created, null, "unconfirmed");
  if (changed && "replaced" in changed) await deps.audit.passwordChanged(changed.replaced);
  return { kind: "check-email", registrationToken, resendAfterS: RESEND_AFTER_S };
}

/**
 * «Надіслати ще раз» of the «Перевірте пошту» screen (ACC-01 FR 13, 15): the same for a new and a taken address.
 * The answer (sent or wait) is counted on this token alone; the address's own letter limits then decide silently
 * whether a letter goes. Counting the answer on the address would tell a taken address from a new one: a taken
 * address's sign-ups all share the attempt-letter limit, a new one's first sign-up has the confirmation limit.
 */
export async function resendForRegistration(
  deps: IdentityDeps,
  registrationToken: string,
): Promise<ResendResult> {
  const now = deps.now();
  const tokenKey = deps.secrets.digest(registrationToken);
  return deps.store.transaction(async (tx) => {
    const registration = await tx.findRegistration(tokenKey);
    if (!registration || registration.closedAt !== null || registration.expiresAt <= now)
      return { kind: "not-found" } as const;
    const account = registration.accountId === null ? null : await tx.findAccount(registration.accountId);
    if (!account && registration.kind !== "outside") return { kind: "not-found" } as const;
    const wait = mailWaitS(await tx.eventTimes("registration-resend", tokenKey, now - MAIL_WINDOW_MS), now);
    if (wait > 0) return { kind: "wait", retryAfterS: wait } as const;
    await tx.addEvent("registration-resend", tokenKey, now);
    if (!account || registration.kind === "outside") {
      // ACC-01 AC26: an address outside the family's list — the same answer and the same lock and reads as a
      // letter's, then nothing. No address is stored with the token, so the token's own key stands in.
      await mailLimit(tx, mailScope("new"), tokenKey, now);
      return { kind: "sent", resendAfterS: RESEND_AFTER_S } as const;
    }
    // A superseded sign-up answers the same but sends nothing: a newer sign-up owns the address's links.
    await sendRegistrationLetter(
      deps,
      tx,
      account,
      registration.kind,
      now,
      registration.supersededAt === null,
    );
    return { kind: "sent", resendAfterS: RESEND_AFTER_S } as const;
  });
}

/**
 * «Змінити email» (ACC-01 FR 13, edge case): the screen's token is closed and, for a sign-up that created an
 * unconfirmed account, its links stop working. A taken address's account is never touched. The client returns
 * to the sign-up form with the fields filled in.
 */
export async function changeEmail(deps: IdentityDeps, registrationToken: string): Promise<boolean> {
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const registration = await tx.findRegistration(deps.secrets.digest(registrationToken));
    if (!registration || registration.closedAt !== null || registration.expiresAt <= now) return false;
    await tx.closeRegistration(registration.id, now);
    // A superseded sign-up never revokes the links of the newer one.
    if (
      registration.kind === "new" &&
      registration.accountId !== null &&
      registration.supersededAt === null
    ) {
      const account = await tx.findAccount(registration.accountId);
      if (account && account.emailConfirmedAt === null) await tx.revokeConfirmations(account.id, now);
    }
    return true;
  });
}

/** Opens a confirmation link (ACC-01 FR 4, 14; AC5, AC6, AC24). Never creates a session. */
export async function confirmEmail(deps: IdentityDeps, token: string): Promise<ConfirmResult> {
  const now = deps.now();
  const result = await deps.store.transaction(async (tx) => {
    const link = await tx.findConfirmation(deps.secrets.digest(token));
    if (!link || link.revokedAt !== null) return { result: "invalid" as const };
    if (link.usedAt !== null) return { result: "already-used" as const };
    if (link.expiresAt <= now) return { result: "expired" as const };
    await tx.useConfirmation(link.id, now);
    const changed = await tx.confirmAccount(link.accountId, now);
    return {
      result: changed ? ("confirmed" as const) : ("already-used" as const),
      accountId: link.accountId,
    };
  });
  if (result.result === "confirmed" && result.accountId)
    await deps.audit.accountChanged(result.accountId, "unconfirmed", "confirmed");
  return result.result;
}

/**
 * «Надіслати ще раз» of the «Посилання недійсне» screen (AC6): a new link for the account of an expired one.
 * A link of a confirmed account, a revoked or unknown one gets nothing.
 */
export async function resendForLink(deps: IdentityDeps, token: string): Promise<ResendResult> {
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const link = await tx.findConfirmation(deps.secrets.digest(token));
    // Only a link that expired: a revoked one (a newer link, «Змінити email») never asks for a new letter.
    if (!link || link.revokedAt !== null) return { kind: "not-found" } as const;
    const account = await tx.findAccount(link.accountId);
    if (!account || account.emailConfirmedAt !== null) return { kind: "not-found" } as const;
    const wait = await sendRegistrationLetter(deps, tx, account, "new", now);
    return wait > 0
      ? ({ kind: "wait", retryAfterS: wait } as const)
      : ({ kind: "sent", resendAfterS: RESEND_AFTER_S } as const);
  });
}

/** A hash of a password nobody has: an unknown address costs the same verification as a known one. */
function decoyHash(deps: IdentityDeps): Promise<string> {
  const cache = decoys.get(deps.hasher);
  if (cache) return cache;
  const made = deps.hasher.hash(deps.secrets.token());
  decoys.set(deps.hasher, made);
  return made;
}
const decoys = new WeakMap<object, Promise<string>>();

/**
 * Sign-in (ACC-01 FR 2, 5, 9, 12; NFR-14 FR 7; NFR-01 FR 9). The email's guard first: locked → wait; after a
 * lockout → CAPTCHA. Then the password, verified against the account's hash or a decoy, so an unknown address
 * takes the same time and gets the same answer. The 5th failure in 15 min locks the email for 15 min.
 *
 * The sign-in journal (ACC-04 business rules; NFR-15 FR 29): a sign-in, and a failed one whose password was checked
 * for a confirmed account, are written to the space's audit log with the request's address and device. A failure is
 * written after the answer (an address without an account writes nothing, so the work on the response path is the
 * same for both; NFR-15 FR 1); an address without an account, an unconfirmed account and an account without a space
 * write nothing (owner decision 2026-11-14). Attempts refused before the password is checked (locked, CAPTCHA) are
 * not written: the lock bounds the entries anyone can add to a space's log to 5 a quarter-hour.
 */
export async function signIn(
  deps: IdentityDeps,
  input: {
    email: string;
    password: string;
    captchaToken: string | undefined;
    /** The request's user agent: the device of the sign-in (NFR-15 FR 29). */
    userAgent: string;
    /** The rate-limit form of the client address; only its mask is kept, in a «Це був не я» link. */
    clientAddress: string;
  },
): Promise<SignInResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const key = deps.secrets.digest(normalizedEmail);
  const gate = signInGate(await deps.store.transaction((tx) => tx.readGuard(key)), deps.now());
  if (gate.kind === "locked") return { kind: "locked", retryAfterS: gate.retryAfterS };
  let captchaPassed = false;
  if (gate.kind === "captcha") {
    if (input.captchaToken === undefined || !(await deps.captcha.verify(input.captchaToken)))
      return { kind: "captcha" };
    captchaPassed = true;
  }
  const decoy = await decoyHash(deps);
  let failures: SignInEvent[] = [];
  type Signed =
    | Exclude<SignInResult, { kind: "signed-in" }>
    | {
        kind: "signed-in";
        sessionToken: string;
        maxAgeS: number;
        account: { accountId: string; displayName: string };
        sessionId: string;
        letter: MailMessage | null;
      };
  const result = await deps.store.transaction(async (tx): Promise<Signed> => {
    failures = [];
    // Under the guard's row lock: parallel attempts for one email are counted one after another.
    const guard = await tx.lockGuard(key);
    const now = deps.now();
    const recheck = signInGate(guard, now);
    if (recheck.kind === "locked") return { kind: "locked", retryAfterS: recheck.retryAfterS };
    if (recheck.kind === "captcha" && !captchaPassed) return { kind: "captcha" };
    // Shared lock: a password reset of this account waits for this sign-in, or this sign-in sees the new hash.
    const account = await tx.findAccountByEmail(normalizedEmail, "share");
    const ok = await deps.hasher.verify(account?.passwordHash ?? decoy, normalizePassword(input.password));
    if (!account || !ok) {
      // Only a confirmed account has a journal (its space); nothing about an unknown or unconfirmed address is kept.
      const journaled = account !== null && account.emailConfirmedAt !== null;
      if (journaled)
        failures.push({ kind: "sign-in-failed", accountId: account.id, reason: "invalid-password" });
      await tx.addEvent("sign-in-failure", key, now);
      const count = (await tx.eventTimes("sign-in-failure", key, now - SIGN_IN_FAILURE_WINDOW_MS)).length;
      const lock = afterFailure(count, now);
      if (!lock) return { kind: "invalid" };
      if (journaled) failures.push({ kind: "sign-in-locked", accountId: account.id, reason: "sign-in" });
      await tx.setGuard(key, lock, now);
      await tx.clearEvents("sign-in-failure", key);
      return { kind: "locked", retryAfterS: secondsUntil(lock.lockedUntil!, now) };
    }
    // The right password, but «Це був не я» was confirmed: no sign-in until a new password (ACC-04 FR 5). Asked only
    // after the right password, so the answer tells nothing to someone without it (NFR-15 FR 1, 2).
    if (account.passwordResetRequiredAt !== null) {
      if (account.emailConfirmedAt !== null)
        failures.push({ kind: "sign-in-failed", accountId: account.id, reason: "password-reset-required" });
      return { kind: "password-reset-required" };
    }
    // The right password: the counter and the CAPTCHA mark of the email are cleared.
    await tx.clearEvents("sign-in-failure", key);
    if (guard.captchaRequired || guard.lockedUntil !== null)
      await tx.setGuard(key, { lockedUntil: null, captchaRequired: false }, now);
    if (account.emailConfirmedAt === null) {
      // No session (ACC-01 FR 5): the page offers «Надіслати лист ще раз» through a fresh sign-up token.
      const registrationToken = deps.secrets.token();
      await tx.insertRegistration(
        account.id,
        "new",
        deps.secrets.digest(registrationToken),
        now,
        now + REGISTRATION_TTL_MS,
      );
      return { kind: "email-not-confirmed", registrationToken, resendAfterS: 0 };
    }
    const sessionToken = deps.secrets.token();
    const sessionId = await tx.insertSession(
      account.id,
      deps.secrets.digest(sessionToken),
      now,
      now + SESSION_ABSOLUTE_MS,
    );
    // NFR-15 FR 6, 29; ACC-04 FR 4: a device (browser and system, without versions) not in the account's sign-in
    // history gets the security letter with «Це був не я». The first sign-in of an account starts the history and
    // sends nothing. A row of the previous release's history (the whole user agent) still counts as known.
    const deviceDigest = deps.secrets.digest(deviceKey(input.userAgent));
    const legacyDigest = deps.secrets.digest(legacyDeviceKey(input.userAgent));
    let letter: MailMessage | null = null;
    if ((await tx.rememberDevice(account.id, { digest: deviceDigest, legacyDigest }, now)) === "new") {
      const device = deviceName(input.userAgent);
      const notMeToken = deps.secrets.token();
      await tx.insertNotMeLink({
        accountId: account.id,
        tokenDigest: deps.secrets.digest(notMeToken),
        deviceDigest,
        signedInAt: now,
        device,
        addressMasked: maskedAddress(input.clientAddress),
        expiresAt: now + NOT_ME_TTL_MS,
      });
      letter = {
        to: account.email,
        ...newSignInLetter(account.displayName, { at: now, device }, notMeLink(deps.webOrigin, notMeToken)),
      };
    }
    return {
      kind: "signed-in",
      sessionToken,
      maxAgeS: SESSION_ABSOLUTE_MS / 1000,
      account: { accountId: account.id, displayName: account.displayName },
      sessionId,
      letter,
    };
  });
  if (failures.length > 0) {
    const events = failures;
    deps.afterResponse(async () => {
      for (const event of events) await deps.journal.record(event);
    });
  }
  if (result.kind !== "signed-in") return result;
  // The first sign-in creates the first space (ACC-01 FR 7); every later one finds it. A session is handed out only
  // with a space and with its entry in the space's journal: when either fails, the new session ends and the sign-in
  // fails.
  try {
    await deps.spaces.ensureFirstSpace(result.account);
    await deps.journal.record({
      kind: "signed-in",
      accountId: result.account.accountId,
      sessionId: result.sessionId,
    });
  } catch (error) {
    // The device is in the history already: its letter goes now, or the next sign-in from it would be «known» and
    // send nothing (NFR-15 FR 6, FR 29). The right password was given from that device.
    if (result.letter) deps.sendLater(result.letter);
    await signOut(deps, result.sessionToken);
    throw error;
  }
  // After the commit and the space: a letter only for a sign-in that happened.
  if (result.letter) deps.sendLater(result.letter);
  return { kind: "signed-in", sessionToken: result.sessionToken, maxAgeS: result.maxAgeS };
}

/**
 * What a session token stands for at `now` (ACC-04@PoC FR 1, 3; NFR-01 FR 10–12). A session that has lapsed (12 h
 * since sign-in, or 15 min since the last user action) is ended here by the server, with its reason; so is one whose
 * replaced token comes back after the grace period (it was copied). Reading never moves the idle deadline: only a
 * refresh, which the client sends for user actions, does.
 */
export type SessionCheck =
  | { readonly kind: "alive"; readonly session: SessionRow; readonly account: SessionAccount }
  | { readonly kind: "ended"; readonly reason: SessionEndShown }
  | { readonly kind: "none" };

/** Also used by the profile's routes (profile.ts): every request of a session runs this check first. */
export async function checkSession(
  deps: IdentityDeps,
  tx: IdentityTx,
  token: string,
  now: number,
  lock = false,
): Promise<SessionCheck> {
  const session = await tx.findSession(deps.secrets.digest(token), lock);
  if (!session) return { kind: "none" };
  if (session.endedAt !== null) return { kind: "ended", reason: shownEndReason(session.endReason) };
  const lapse = sessionLapse(session, now);
  if (lapse !== null) {
    await tx.endSession(session.id, now, lapse);
    return { kind: "ended", reason: shownEndReason(lapse) };
  }
  if (tokenStanding(session.retiredAt, now) === "reuse") {
    await tx.endSession(session.id, now, "token-reuse");
    return { kind: "ended", reason: shownEndReason("token-reuse") };
  }
  const account = await tx.findAccount(session.accountId);
  if (!account || account.emailConfirmedAt === null) return { kind: "none" };
  return {
    kind: "alive",
    session,
    account: { accountId: account.id, name: account.displayName, email: account.email },
  };
}

/** The state of a session token for `GET /v1/session`: alive, ended with its reason, or unknown. */
export function sessionStatus(deps: IdentityDeps, token: string): Promise<SessionCheck> {
  const now = deps.now();
  return deps.store.transaction((tx) => checkSession(deps, tx, token, now));
}

/**
 * The account of a session token, if the session is alive (every protected route). A request does not move the
 * idle deadline: background requests never extend a session (ACC-04 business rules, NFR-01 FR 11).
 */
export async function sessionAccount(deps: IdentityDeps, token: string): Promise<SessionAccount | null> {
  const result = await sessionStatus(deps, token);
  return result.kind === "alive" ? result.account : null;
}

export type RefreshResult =
  | {
      readonly kind: "refreshed";
      /** The rotated token, or null when the request carried a token replaced within the grace period. */
      readonly sessionToken: string | null;
      readonly maxAgeS: number;
    }
  | { readonly kind: "ended"; readonly reason: SessionEndShown }
  | { readonly kind: "none" };

/**
 * A user action (click, input, navigation) in any tab of the browser (ACC-04 FR 1, 3; NFR-01 FR 10–12): the idle
 * deadline moves for the session, which every tab shares through its cookie, and the token rotates. A token a
 * refresh replaced less than 30 s ago (another tab's request on its way) moves the deadline but rotates nothing.
 * The absolute end (12 h after sign-in) never moves.
 */
export async function refreshSession(deps: IdentityDeps, token: string): Promise<RefreshResult> {
  const now = deps.now();
  return deps.store.transaction(async (tx): Promise<RefreshResult> => {
    const check = await checkSession(deps, tx, token, now, true);
    if (check.kind !== "alive") return check;
    const { session } = check;
    await tx.touchSession(session.id, now);
    const maxAgeS = Math.max(1, Math.floor((session.expiresAt - now) / 1000));
    if (session.retiredAt !== null) return { kind: "refreshed", sessionToken: null, maxAgeS };
    const sessionToken = deps.secrets.token();
    await tx.rotateSession(session.id, deps.secrets.digest(sessionToken), now);
    return { kind: "refreshed", sessionToken, maxAgeS };
  });
}

/**
 * Sign-out: ends the session of the token (nothing when there is none). Every tab of the browser shares the
 * session, so every tab is signed out (ACC-04 FR 3).
 */
export async function signOut(deps: IdentityDeps, token: string): Promise<void> {
  const now = deps.now();
  await deps.store.transaction(async (tx) => {
    const session = await tx.findSession(deps.secrets.digest(token), true);
    if (session && session.endedAt === null) await tx.endSession(session.id, now, "signed-out");
  });
}
