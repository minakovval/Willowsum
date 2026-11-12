import {
  MAIL_WINDOW_MS,
  mailWaitS,
  normalizeEmail,
  normalizePassword,
  passwordChangedLetter,
  passwordResetLetter,
  passwordResetLink,
  passwordResetTokenLink,
  PASSWORD_RESET_TTL_MS,
  resetLinkUsable,
} from "../domain/index.ts";
import type { IdentityDeps } from "./ports.ts";

/**
 * Password reset of ACC-01@PoC part b (FR 10, AC16, AC17; NFR-15 FR 1, 3; ADR-0009).
 *
 * The request answers before anything about the address is looked up: whether the address has an account, whether
 * its letter limit allows a letter, the new link — all of it runs after the answer (`afterResponse`), so the answer
 * and its time are the same for every address. A link is valid 60 min and works once; a new link revokes the
 * older ones. Completing a reset changes the password, ends every session of the account (also the one of the
 * browser that completed it; no new session is created), revokes the other reset links, confirms the address and
 * sends a security notice.
 *
 * Lock order in every identity transaction: a sign-in guard, then the account row, then a reset link row.
 */

export type ResetLinkState = "valid" | "invalid";

export type CompleteResetResult = { readonly kind: "changed" } | { readonly kind: "invalid" };

/** «Відновлення пароля» → «Надіслати» (AC16): nothing to return; the caller answers the same for every address. */
export function requestPasswordReset(deps: IdentityDeps, email: string): void {
  const normalizedEmail = normalizeEmail(email);
  deps.afterResponse(async () => {
    const now = deps.now();
    const token = deps.secrets.token();
    const letter = await deps.store.transaction(async (tx) => {
      // The account row lock serialises parallel requests for one address: the letter limit holds.
      const account = await tx.findAccountByEmail(normalizedEmail, "update");
      if (!account) return null;
      // One reset letter per 60 s and 5 per hour per account (the mail limit of ACC-01 FR 15). A request over the
      // limit changes nothing: the earlier links stay valid, and the answer was the same anyway.
      if (mailWaitS(await tx.passwordResetTimes(account.id, now - MAIL_WINDOW_MS), now) > 0) return null;
      await tx.revokePasswordResets(account.id, now);
      await tx.insertPasswordReset(account.id, deps.secrets.digest(token), now, now + PASSWORD_RESET_TTL_MS);
      return {
        to: account.email,
        ...passwordResetLetter(account.displayName, passwordResetTokenLink(deps.webOrigin, token)),
      };
    });
    // After the commit: a letter never carries a link that a rolled-back transaction did not store.
    if (letter) deps.sendLater(letter);
  });
}

/** Can the link still change the password? The S-007 page asks before showing the form (UC: «Посилання недійсне»). */
export async function passwordResetState(deps: IdentityDeps, token: string): Promise<ResetLinkState> {
  const now = deps.now();
  const link = await deps.store.transaction((tx) => tx.findPasswordReset(deps.secrets.digest(token)));
  return link && resetLinkUsable(link, now) ? "valid" : "invalid";
}

/**
 * Sets the new password with a reset link (AC17; NFR-15 FR 3). Single use under concurrency: the link row is
 * locked and re-checked in the transaction that uses it. The password is hashed only for a link that looked
 * usable, so a wrong token costs no hashing.
 */
export async function completePasswordReset(
  deps: IdentityDeps,
  input: { token: string; password: string },
): Promise<CompleteResetResult> {
  const digest = deps.secrets.digest(input.token);
  const seen = await deps.store.transaction(async (tx) => {
    const link = await tx.findPasswordReset(digest);
    if (!link || !resetLinkUsable(link, deps.now())) return null;
    const account = await tx.findAccount(link.accountId);
    return account
      ? { accountId: account.id, emailKey: deps.secrets.digest(normalizeEmail(account.email)) }
      : null;
  });
  if (!seen) return { kind: "invalid" };
  const passwordHash = await deps.hasher.hash(normalizePassword(input.password));
  const done = await deps.store.transaction(async (tx) => {
    // The guard first, then the account, then the link: the order of sign-in and of a reset request.
    const guard = await tx.lockGuard(seen.emailKey);
    const account = await tx.findAccount(seen.accountId, "update");
    const link = await tx.findPasswordReset(digest, true);
    const now = deps.now();
    if (!account || !link || link.accountId !== account.id || !resetLinkUsable(link, now)) return null;
    await tx.usePasswordReset(link.id, now);
    await tx.revokePasswordResets(account.id, now);
    await tx.setPassword(account.id, passwordHash, now);
    // NFR-15 FR 3, AC17: every session of the account ends, whichever device or browser holds it.
    await tx.endSessions(account.id, now);
    // FR 10: the link proved control of the address. Its pending confirmation links have nothing left to do.
    const confirmed = await tx.confirmAccount(account.id, now);
    if (confirmed) await tx.revokeConfirmations(account.id, now);
    // The reset proved control of the address: its sign-in lockout and CAPTCHA mark are cleared, as a sign-in
    // with the right password clears them (ADR-0009, part b).
    await tx.clearEvents("sign-in-failure", seen.emailKey);
    if (guard.captchaRequired || guard.lockedUntil !== null)
      await tx.setGuard(seen.emailKey, { lockedUntil: null, captchaRequired: false }, now);
    return { account, confirmed };
  });
  if (!done) return { kind: "invalid" };
  await deps.audit.passwordChanged(done.account.id);
  if (done.confirmed) await deps.audit.accountChanged(done.account.id, "unconfirmed", "confirmed");
  // AC17: the security notice; it links only to the reset page, never with a token.
  deps.sendLater({
    to: done.account.email,
    ...passwordChangedLetter(done.account.displayName, passwordResetLink(deps.webOrigin)),
  });
  return { kind: "changed" };
}
