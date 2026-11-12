import { describe, expect, it } from "vitest";
import {
  afterFailure,
  confirmationLetter,
  confirmationLink,
  emailSchema,
  mailWaitS,
  nameSchema,
  normalizeEmail,
  passwordLength,
  passwordResetLink,
  passwordSchema,
  sessionAlive,
  SESSION_IDLE_MS,
  signInGate,
  signUpAttemptLetter,
} from "./index.ts";

const MIN = 60_000;
const T = Date.UTC(2026, 10, 12, 9, 0, 0);

describe("ACC-01 AC2, AC3 / NFR-01 FR 7: a password of at least 12 characters, no composition rules", () => {
  it("11 characters are refused, 12 lower-case letters are accepted; length counts characters, not bytes", () => {
    expect(passwordSchema.safeParse("abcdefghijk").success).toBe(false);
    expect(passwordSchema.safeParse("abcdefghijkl").success).toBe(true);
    // 12 Cyrillic letters (24 bytes in UTF-8) and 11 + one emoji are 12 characters.
    expect(passwordSchema.safeParse("абвгґдеєжзиі").success).toBe(true);
    expect(passwordLength("abcdefghijk😀")).toBe(12);
    // NFKC: the ligature «ﬁ» is «fi», so the same password typed on another keyboard matches.
    expect(passwordLength("ﬁ")).toBe(2);
  });

  it("name and email are required; the email is one address; the login key is lower case and trimmed", () => {
    expect(nameSchema.safeParse("  ").success).toBe(false);
    expect(nameSchema.safeParse("Олена\nСинтетична").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("not an address").success).toBe(false);
    expect(emailSchema.safeParse(" olena@example.test ").data).toBe("olena@example.test");
    expect(normalizeEmail("  Olena.Synthetic@Example.TEST ")).toBe("olena.synthetic@example.test");
  });
});

describe("ACC-01 FR 15: letters to one address — once per 60 s, at most 5 per hour", () => {
  it("no letters → now; within 60 s of the last → the seconds left", () => {
    expect(mailWaitS([], T)).toBe(0);
    expect(mailWaitS([T - 20_000], T)).toBe(40);
    expect(mailWaitS([T - MIN], T)).toBe(0);
  });

  it("5 in the hour → until the oldest of them is an hour old", () => {
    const sent = [T - 50 * MIN, T - 40 * MIN, T - 30 * MIN, T - 20 * MIN, T - 10 * MIN];
    expect(mailWaitS(sent, T)).toBe(10 * 60);
    expect(mailWaitS(sent, T + 10 * MIN)).toBe(0);
  });
});

describe("ACC-01 AC14 / NFR-01 FR 9: 5 failures in 15 min → locked 15 min → CAPTCHA", () => {
  it("4 failures leave the email open; the 5th locks it for 15 min and marks the CAPTCHA", () => {
    expect(afterFailure(4, T)).toBeNull();
    expect(afterFailure(5, T)).toEqual({ lockedUntil: T + 15 * MIN, captchaRequired: true });
  });

  it("locked while the lock is ahead (with the seconds left); then the CAPTCHA; a fresh email is open", () => {
    const guard = { lockedUntil: T + 15 * MIN, captchaRequired: true };
    expect(signInGate(guard, T)).toEqual({ kind: "locked", retryAfterS: 900 });
    expect(signInGate(guard, T + 15 * MIN - 500)).toEqual({ kind: "locked", retryAfterS: 1 });
    expect(signInGate(guard, T + 15 * MIN)).toEqual({ kind: "captcha" });
    expect(signInGate(null, T)).toEqual({ kind: "open" });
  });
});

describe("NFR-01 FR 10: a session ends after 15 min idle or 12 h in all", () => {
  it("alive within both bounds; ended by idleness, the absolute end, or sign-out", () => {
    const s = { expiresAt: T + 12 * 60 * MIN, lastSeenAt: T, endedAt: null };
    expect(sessionAlive(s, T + SESSION_IDLE_MS - 1)).toBe(true);
    expect(sessionAlive(s, T + SESSION_IDLE_MS)).toBe(false);
    expect(sessionAlive({ ...s, lastSeenAt: T + 12 * 60 * MIN - MIN }, T + 12 * 60 * MIN)).toBe(false);
    expect(sessionAlive({ ...s, endedAt: T }, T + MIN)).toBe(false);
  });
});

describe("ACC-01 FR 4, FR 8: the letters", () => {
  it("confirmation: the link to /verify, valid 24 h; Ukrainian first, English complete", () => {
    const link = confirmationLink("https://app.example.org", "A".repeat(43));
    expect(link).toBe(`https://app.example.org/verify?token=${"A".repeat(43)}`);
    const uk = confirmationLetter("Олена", link);
    expect(uk.text).toContain(link);
    expect(uk.text).toContain("24 години");
    expect(confirmationLetter("Olena", link, "en").text).toContain("24 hours");
  });

  it("sign-up attempt with a taken address: only the password-reset link, never a confirmation link", () => {
    for (const locale of ["uk", "en"] as const) {
      const letter = signUpAttemptLetter("Олена", passwordResetLink("https://app.example.org"), locale);
      expect(letter.text).toContain("https://app.example.org/password/reset");
      expect(letter.text).not.toContain("/verify");
      expect(letter.text.match(/https?:\/\//g)).toHaveLength(1);
    }
  });
});
