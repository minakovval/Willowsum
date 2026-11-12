import {
  CONFIRMATION_TTL_MS,
  afterFailure,
  confirmationLetter,
  confirmationLink,
  mailWaitS,
  MAIL_COOLDOWN_MS,
  MAIL_WINDOW_MS,
  normalizeEmail,
  normalizePassword,
  passwordResetLink,
  REGISTRATION_TTL_MS,
  secondsUntil,
  sessionAlive,
  SESSION_ABSOLUTE_MS,
  SIGN_IN_FAILURE_WINDOW_MS,
  signInGate,
  signUpAttemptLetter,
} from "../domain/index.ts";
import type { AccountRow, IdentityDeps, IdentityTx, ThrottleScope } from "./ports.ts";

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
  | { readonly kind: "captcha" };

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
  const key = deps.secrets.digest(normalizeEmail(account.email));
  const scope = mailScope(kind);
  // Parallel requests for one address are checked one after another, so the limit holds (ACC-01 FR 15).
  await tx.lockSubject(scope, key);
  const wait = mailWaitS(await tx.eventTimes(scope, key, now - MAIL_WINDOW_MS), now);
  // `send = false` (a superseded sign-up): the same lock and reads, then nothing.
  if (wait > 0 || !send) return wait;
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

export async function signUp(
  deps: IdentityDeps,
  input: {
    name: string;
    email: string;
    password: string;
    captchaToken: string | undefined;
    clientAddress: string;
  },
): Promise<SignUpResult> {
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
  const changed = await deps.store.transaction(async (tx) => {
    const insert = () =>
      tx.insertAccount({
        email: input.email.trim(),
        normalizedEmail,
        displayName: input.name,
        passwordHash,
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
      (await tx.replaceUnconfirmedAccount(account.id, { displayName: input.name, passwordHash }, now))
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
    const account = await tx.findAccount(registration.accountId);
    if (!account) return { kind: "not-found" } as const;
    const wait = mailWaitS(await tx.eventTimes("registration-resend", tokenKey, now - MAIL_WINDOW_MS), now);
    if (wait > 0) return { kind: "wait", retryAfterS: wait } as const;
    await tx.addEvent("registration-resend", tokenKey, now);
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
    if (registration.kind === "new" && registration.supersededAt === null) {
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
 */
export async function signIn(
  deps: IdentityDeps,
  input: { email: string; password: string; captchaToken: string | undefined },
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
  type Signed =
    | Exclude<SignInResult, { kind: "signed-in" }>
    | {
        kind: "signed-in";
        sessionToken: string;
        maxAgeS: number;
        account: { accountId: string; displayName: string };
      };
  const result = await deps.store.transaction(async (tx): Promise<Signed> => {
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
      await tx.addEvent("sign-in-failure", key, now);
      const failures = (await tx.eventTimes("sign-in-failure", key, now - SIGN_IN_FAILURE_WINDOW_MS)).length;
      const lock = afterFailure(failures, now);
      if (!lock) return { kind: "invalid" };
      await tx.setGuard(key, lock, now);
      await tx.clearEvents("sign-in-failure", key);
      return { kind: "locked", retryAfterS: secondsUntil(lock.lockedUntil!, now) };
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
    await tx.insertSession(account.id, deps.secrets.digest(sessionToken), now, now + SESSION_ABSOLUTE_MS);
    return {
      kind: "signed-in",
      sessionToken,
      maxAgeS: SESSION_ABSOLUTE_MS / 1000,
      account: { accountId: account.id, displayName: account.displayName },
    };
  });
  if (result.kind !== "signed-in") return result;
  // The first sign-in creates the first space (ACC-01 FR 7); every later one finds it. A session is handed out only
  // with a space: when the space cannot be made, the new session ends and the sign-in fails.
  try {
    await deps.spaces.ensureFirstSpace(result.account);
  } catch (error) {
    await signOut(deps, result.sessionToken);
    throw error;
  }
  return { kind: "signed-in", sessionToken: result.sessionToken, maxAgeS: result.maxAgeS };
}

/** The account of a session token, if the session is alive; its use moves its idle deadline. */
export async function sessionAccount(deps: IdentityDeps, token: string): Promise<SessionAccount | null> {
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const session = await tx.findSession(deps.secrets.digest(token));
    if (!session || !sessionAlive(session, now)) return null;
    const account = await tx.findAccount(session.accountId);
    if (!account || account.emailConfirmedAt === null) return null;
    await tx.touchSession(session.id, now);
    return { accountId: account.id, name: account.displayName, email: account.email };
  });
}

/** Sign-out: ends the session of the token (nothing when there is none). */
export async function signOut(deps: IdentityDeps, token: string): Promise<void> {
  const now = deps.now();
  await deps.store.transaction(async (tx) => {
    const session = await tx.findSession(deps.secrets.digest(token));
    if (session && session.endedAt === null) await tx.endSession(session.id, now);
  });
}
