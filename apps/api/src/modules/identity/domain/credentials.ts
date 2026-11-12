import { z } from "zod";

/**
 * Sign-up and sign-in input (ACC-01 FR 1–3; NFR-01 FR 7; NIST SP 800-63B): a password of at least 12 characters,
 * counted as Unicode code points after NFKC normalisation, with no composition rules and no check against an
 * external service (the breached-password check is PoC v2). The upper bound keeps hashing cheap to refuse.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

/** The form the password is hashed and checked in: NFKC, so the same password typed on any keyboard matches. */
export function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export const passwordSchema = z
  .string()
  .refine((p) => passwordLength(p) >= PASSWORD_MIN_LENGTH, { error: "too_short" })
  .refine((p) => passwordLength(p) <= PASSWORD_MAX_LENGTH, { error: "too_long" });

/** The login key of an address: trimmed, lower case (one account per address, whatever the letter case). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email());

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX_LENGTH)
  // One line of text: no control characters (the name goes into letters).
  .refine((n) => ![...n].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f), {
    error: "invalid_characters",
  });

/**
 * Who may sign up (ACC-01 FR 16): the family's addresses from the server's configuration, compared as login keys
 * (`normalizeEmail`: trimmed, lower case). Without a list (locally and in CI; the api role refuses to start
 * without one in staging and production) every address may. The check is a set lookup: its cost does not depend
 * on whether the address is listed.
 */
export function signUpAllowlist(entries: Iterable<string> | undefined): (normalizedEmail: string) => boolean {
  if (entries === undefined) return () => true;
  const list = new Set([...entries].map(normalizeEmail));
  return (normalizedEmail) => list.has(normalizedEmail);
}
