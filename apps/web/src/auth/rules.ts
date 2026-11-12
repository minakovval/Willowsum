import type { MessageKey } from "@willowsum/i18n";

/**
 * Client-side checks of the sign-up form (ACC-01@PoC FR 3, AC2, AC3). They mirror the server's rules
 * (`apps/api/src/modules/identity/domain/credentials.ts`): a password of 12–256 characters counted as Unicode code
 * points after NFKC, with no composition rules and nothing sent anywhere to be checked; the server checks again.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

export const passwordLength = (password: string): number => [...password.normalize("NFKC")].length;

/** One reason per field; `null` when the field is fine. */
export type FieldError = { readonly key: MessageKey; readonly params?: Record<string, number> } | null;

export function nameError(name: string): FieldError {
  const trimmed = name.trim();
  if (trimmed === "") return { key: "auth.error.nameRequired" };
  if ([...trimmed].length > NAME_MAX_LENGTH)
    return { key: "auth.error.nameTooLong", params: { max: NAME_MAX_LENGTH } };
  return null;
}

// One @, no spaces, a dot in the domain: the server's check is the authority; this only catches typos early.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function emailError(email: string): FieldError {
  const trimmed = email.trim();
  if (trimmed === "") return { key: "auth.error.emailRequired" };
  if (trimmed.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE.test(trimmed))
    return { key: "auth.error.emailInvalid" };
  return null;
}

export function newPasswordError(password: string): FieldError {
  if (password === "") return { key: "auth.error.passwordRequired" };
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH)
    return { key: "auth.error.passwordShort", params: { min: PASSWORD_MIN_LENGTH } };
  if (length > PASSWORD_MAX_LENGTH)
    return { key: "auth.error.passwordLong", params: { max: PASSWORD_MAX_LENGTH } };
  return null;
}

/**
 * The strength indicator of FR 3. Length is what makes a password strong (NIST SP 800-63B), so the level depends
 * on length only: no character-class rules are suggested or required (AC3).
 */
export type Strength = "short" | "fair" | "strong";
export const STRONG_LENGTH = 16;

export function passwordStrength(password: string): Strength {
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) return "short";
  return length >= STRONG_LENGTH ? "strong" : "fair";
}

/** `m:ss` for a countdown (S-002 «Надіслати ще раз · 0:42», S-004 «Увійти · 14:32»). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
