import {
  notMeLinkUsable,
  PASSWORD_RESET_TTL_MS,
  passwordResetLetter,
  passwordResetTokenLink,
  type DeviceName,
} from "../domain/index.ts";
import type { IdentityDeps } from "./ports.ts";

/**
 * «Це був не я» (ACC-04@PoC FR 5, AC7; NFR-01@PoC FR 12; NFR-15@PoC FR 7). The new-device letter carries a one-time
 * link valid 7 days. Opening it shows a confirmation page (S-004b) that first asks the server about the link; only the
 * page's confirmation acts: every session of the account ends, every sign-in is refused until the password changes,
 * and a password reset link goes to the account's email. The device of that sign-in leaves the sign-in history.
 * NFR-15 FR 7's factors, trusted devices and bank connections have no data in this release; the time of the
 * suspicious sign-in stays with the link for them.
 *
 * Lock order as in every identity transaction: a sign-in guard (none here), the account row, then a link row.
 */

export type NotMeLinkState =
  | {
      readonly kind: "valid";
      readonly email: string;
      readonly signedInAt: number;
      readonly device: DeviceName;
      readonly addressMasked: string;
    }
  | { readonly kind: "invalid" };

/** What the S-004b page shows before the confirmation; changes nothing. Used, expired or unknown → invalid. */
export async function notMeLinkState(deps: IdentityDeps, token: string): Promise<NotMeLinkState> {
  const now = deps.now();
  return deps.store.transaction(async (tx): Promise<NotMeLinkState> => {
    const link = await tx.findNotMeLink(deps.secrets.digest(token));
    if (!link || !notMeLinkUsable(link, now)) return { kind: "invalid" };
    const account = await tx.findAccount(link.accountId);
    if (!account) return { kind: "invalid" };
    return {
      kind: "valid",
      email: account.email,
      signedInAt: link.signedInAt,
      device: link.device,
      addressMasked: link.addressMasked,
    };
  });
}

export type ConfirmNotMeResult = { readonly kind: "secured" } | { readonly kind: "invalid" };

/** «Захистити акаунт» on S-004b (AC7). Single use under concurrency: the link row is locked and re-checked. */
export async function confirmNotMe(deps: IdentityDeps, token: string): Promise<ConfirmNotMeResult> {
  const digest = deps.secrets.digest(token);
  const seen = await deps.store.transaction((tx) => tx.findNotMeLink(digest));
  if (!seen) return { kind: "invalid" };
  const resetToken = deps.secrets.token();
  const done = await deps.store.transaction(async (tx) => {
    const account = await tx.findAccount(seen.accountId, "update");
    const link = await tx.findNotMeLink(digest, true);
    const now = deps.now();
    if (!account || !link || link.accountId !== account.id || !notMeLinkUsable(link, now)) return null;
    await tx.useNotMeLink(link.id, now);
    // ACC-04 FR 5; NFR-01 FR 12: every session of the account ends, whichever device holds it.
    await tx.endSessions(account.id, now, "not-me");
    await tx.requirePasswordReset(account.id, now);
    await tx.forgetDevice(account.id, link.deviceDigest);
    // A fresh reset link replaces the earlier ones. It is sent whatever the reset letter limit says: one per link.
    await tx.revokePasswordResets(account.id, now);
    await tx.insertPasswordReset(
      account.id,
      deps.secrets.digest(resetToken),
      now,
      now + PASSWORD_RESET_TTL_MS,
    );
    return { account, wasRequired: account.passwordResetRequiredAt !== null };
  });
  if (!done) return { kind: "invalid" };
  if (!done.wasRequired)
    await deps.audit.signInChanged(done.account.id, "allowed", "password-reset-required");
  deps.sendLater({
    to: done.account.email,
    ...passwordResetLetter(done.account.displayName, passwordResetTokenLink(deps.webOrigin, resetToken)),
  });
  return { kind: "secured" };
}
