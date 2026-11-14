import {
  afterFailure,
  normalizeEmail,
  normalizePassword,
  passwordChangedInProfileLetter,
  passwordResetLink,
  secondsUntil,
  SIGN_IN_FAILURE_WINDOW_MS,
  signInGate,
  STEP_UP_TTL_MS,
  stepUpLockedLetter,
  stepUpUsable,
  type SessionEndShown,
  type StepUpAction,
} from "../domain/index.ts";
import type { MailMessage } from "../../../platform/adapters/mail/index.ts";
import { checkSession } from "./accounts.ts";
import type { IdentityDeps } from "./ports.ts";

/**
 * The profile and the password change of ACC-05@PoC part a (FR 1, 3, 4, 5; NFR-01@PoC FR 12, 13; NFR-15@PoC FR 4).
 * Every use case acts on the account of the session cookie only: no route takes an account id, so another person's
 * profile can be neither read nor changed. There is no email change: no use case writes the address.
 *
 * Step-up is the current password typed right before the action: a one-time confirmation for the session and the
 * action, valid 5 min (STEP_UP_TTL_MS). A wrong password counts with the failed sign-ins of the account's address
 * (5 in 15 min); the one that reaches the limit locks sign-in as a failed sign-in would, ends this session and
 * sends a security letter. Lock order as in sign-in, reset and «Це був не я»: the sign-in guard, then the account,
 * then its sessions, then a link or a confirmation.
 */

/** A session that is not alive: the routes answer 401 SESSION_ENDED (with the reason) or UNAUTHENTICATED. */
export type NoSession =
  { readonly kind: "ended"; readonly reason: SessionEndShown } | { readonly kind: "none" };

export interface Profile {
  readonly name: string;
  readonly email: string;
  readonly locale: string | null;
  readonly timeZone: string | null;
}

/** «Профіль» (ACC-05 FR 1): name and email (read only), the format and time zone taken at sign-up. */
export async function profileOf(
  deps: IdentityDeps,
  token: string,
): Promise<{ readonly kind: "profile"; readonly profile: Profile } | NoSession> {
  const now = deps.now();
  return deps.store.transaction(async (tx) => {
    const check = await checkSession(deps, tx, token, now);
    if (check.kind !== "alive") return check;
    const account = await tx.findAccount(check.account.accountId);
    if (!account) return { kind: "none" } as const;
    return {
      kind: "profile",
      profile: {
        name: account.displayName,
        email: account.email,
        locale: account.locale,
        timeZone: account.timeZone,
      },
    } as const;
  });
}

/**
 * «Зберегти» on «Профіль» (ACC-05 FR 1, AC1): the new name of the session's account. Other tabs and devices read it
 * at their next load (FR 2). One audit entry per change, with the values masked.
 */
export async function updateProfile(
  deps: IdentityDeps,
  token: string,
  change: { readonly name: string },
): Promise<{ readonly kind: "profile"; readonly profile: Profile } | NoSession> {
  const now = deps.now();
  const result = await deps.store.transaction(async (tx) => {
    const check = await checkSession(deps, tx, token, now);
    if (check.kind !== "alive") return check;
    const account = await tx.findAccount(check.account.accountId, "update");
    if (!account) return { kind: "none" } as const;
    const changed = account.displayName !== change.name;
    if (changed) await tx.setDisplayName(account.id, change.name, now);
    return {
      kind: "profile",
      changed,
      accountId: account.id,
      profile: {
        name: change.name,
        email: account.email,
        locale: account.locale,
        timeZone: account.timeZone,
      },
    } as const;
  });
  if (result.kind !== "profile") return result;
  if (result.changed) await deps.audit.displayNameChanged(result.accountId);
  return { kind: "profile", profile: result.profile };
}

export type StepUpResult =
  | { readonly kind: "confirmed"; readonly stepUpToken: string; readonly expiresInS: number }
  /** The general «Пароль неправильний»: no hint, no count of attempts left. */
  | { readonly kind: "wrong-password" }
  /** Sign-in is locked: by this attempt (`sessionEnded`: this session ended, a letter went) or already before it. */
  | { readonly kind: "locked"; readonly retryAfterS: number; readonly sessionEnded: boolean }
  | NoSession;

/**
 * Step-up by the current password (NFR-01 FR 13, NFR-15 FR 4, AC2): a confirmation for `action` in this session.
 * While sign-in of the address is locked the password is not checked and the session stays: the lock was reached
 * elsewhere. The CAPTCHA mark of a lockout is not asked here (the session already passed sign-in).
 */
export async function confirmStepUp(
  deps: IdentityDeps,
  token: string,
  input: { readonly action: StepUpAction; readonly password: string },
): Promise<StepUpResult> {
  // The guard and the account are locked before the session, as a reset and «Це був не я» lock them: first find them.
  const first = await deps.store.transaction((tx) => checkSession(deps, tx, token, deps.now()));
  if (first.kind !== "alive") return first;
  const key = deps.secrets.digest(normalizeEmail(first.account.email));
  type Outcome = StepUpResult | { kind: "locked-now"; retryAfterS: number; letter: MailMessage };
  const outcome = await deps.store.transaction(async (tx): Promise<Outcome> => {
    const guard = await tx.lockGuard(key);
    const account = await tx.findAccount(first.account.accountId, "share");
    const now = deps.now();
    const check = await checkSession(deps, tx, token, now, true);
    if (check.kind !== "alive") return check;
    if (!account || check.account.accountId !== account.id) return { kind: "none" };
    const gate = signInGate(guard, now);
    if (gate.kind === "locked") return { kind: "locked", retryAfterS: gate.retryAfterS, sessionEnded: false };
    if (!(await deps.hasher.verify(account.passwordHash, normalizePassword(input.password)))) {
      await tx.addEvent("sign-in-failure", key, now);
      const failures = (await tx.eventTimes("sign-in-failure", key, now - SIGN_IN_FAILURE_WINDOW_MS)).length;
      const lock = afterFailure(failures, now);
      if (!lock) return { kind: "wrong-password" };
      // The limit is reached during step-up: sign-in locks as after failed sign-ins, this session ends.
      await tx.setGuard(key, lock, now);
      await tx.clearEvents("sign-in-failure", key);
      await tx.endSession(check.session.id, now, "step-up-locked");
      return {
        kind: "locked-now",
        retryAfterS: secondsUntil(lock.lockedUntil!, now),
        letter: {
          to: account.email,
          ...stepUpLockedLetter(account.displayName, passwordResetLink(deps.webOrigin)),
        },
      };
    }
    // The right password clears the counter and the CAPTCHA mark, as a sign-in with it does.
    await tx.clearEvents("sign-in-failure", key);
    if (guard.captchaRequired) await tx.setGuard(key, { lockedUntil: null, captchaRequired: false }, now);
    const stepUpToken = deps.secrets.token();
    await tx.insertStepUp({
      sessionId: check.session.id,
      action: input.action,
      tokenDigest: deps.secrets.digest(stepUpToken),
      now,
      expiresAt: now + STEP_UP_TTL_MS,
    });
    return { kind: "confirmed", stepUpToken, expiresInS: STEP_UP_TTL_MS / 1000 };
  });
  if (outcome.kind !== "locked-now") return outcome;
  // After the commit: the letter and the journal's entry only for a lock that happened (#209).
  await deps.journal.record({
    kind: "sign-in-locked",
    accountId: first.account.accountId,
    reason: "step-up",
  });
  deps.sendLater(outcome.letter);
  return { kind: "locked", retryAfterS: outcome.retryAfterS, sessionEnded: true };
}

export type ChangePasswordResult =
  | { readonly kind: "changed" }
  /** No usable confirmation of this session for the password change: the dialog asks for the password again. */
  | { readonly kind: "step-up-required" }
  | NoSession;

/**
 * The password change in the profile (ACC-05 FR 5, AC5; ACC-04 FR 6; NFR-01 FR 12): with a step-up confirmation of
 * this session, the new password replaces the old one, every other session of the account ends at once (this one
 * goes on), the account's reset links stop working and a security letter goes to its address. The new password is
 * hashed only after the confirmation looked usable, so a request without one costs no hashing.
 */
export async function changePassword(
  deps: IdentityDeps,
  token: string,
  input: { readonly stepUpToken: string; readonly password: string },
): Promise<ChangePasswordResult> {
  const digest = deps.secrets.digest(input.stepUpToken);
  const use = (sessionId: string, now: number) => ({ sessionId, action: "password-change" as const, now });
  const seen = await deps.store.transaction(async (tx) => {
    const now = deps.now();
    const check = await checkSession(deps, tx, token, now);
    if (check.kind !== "alive") return check;
    const confirmation = await tx.findStepUp(digest);
    if (!confirmation || !stepUpUsable(confirmation, use(check.session.id, now)))
      return { kind: "step-up-required" } as const;
    return { kind: "usable", accountId: check.account.accountId } as const;
  });
  if (seen.kind !== "usable") return seen;
  const passwordHash = await deps.hasher.hash(normalizePassword(input.password));
  const done = await deps.store.transaction(async (tx) => {
    // The account before its session, as a reset and «Це був не я» lock them.
    const account = await tx.findAccount(seen.accountId, "update");
    const now = deps.now();
    const check = await checkSession(deps, tx, token, now, true);
    if (check.kind !== "alive") return check;
    if (!account || check.account.accountId !== account.id) return { kind: "none" } as const;
    // Re-checked under the row lock: two changes with one confirmation → one of them.
    const confirmation = await tx.findStepUp(digest, true);
    if (!confirmation || !stepUpUsable(confirmation, use(check.session.id, now)))
      return { kind: "step-up-required" } as const;
    await tx.useStepUp(confirmation.id, now);
    await tx.setPassword(account.id, passwordHash, now);
    await tx.revokePasswordResets(account.id, now);
    // ACC-04 FR 6, NFR-01 FR 12: every other session of the account ends now; this one goes on.
    await tx.endOtherSessions(account.id, check.session.id, now, "password-change");
    return { kind: "changed", account } as const;
  });
  if (done.kind !== "changed") return done;
  await deps.audit.passwordChanged(done.account.id);
  // ACC-05 FR 5: the security letter; it links only to the reset page, never with a token.
  deps.sendLater({
    to: done.account.email,
    ...passwordChangedInProfileLetter(done.account.displayName, passwordResetLink(deps.webOrigin)),
  });
  return { kind: "changed" };
}
