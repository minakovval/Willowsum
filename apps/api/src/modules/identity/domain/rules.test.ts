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
  passwordChangedLetter,
  passwordResetLetter,
  passwordResetLink,
  passwordResetTokenLink,
  PASSWORD_RESET_TTL_MS,
  passwordSchema,
  resetLinkUsable,
  ROTATION_GRACE_MS,
  sessionAlive,
  SESSION_IDLE_MS,
  sessionLapse,
  shownEndReason,
  tokenStanding,
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

describe("ACC-04@PoC FR 1: fixed 15 min idle timeout and 12 h absolute end, the reason told to the browser", () => {
  it("lapse: none within both bounds; idle at exactly 15 min; expired at 12 h (it wins over idle)", () => {
    const s = { expiresAt: T + 12 * 60 * MIN, lastSeenAt: T };
    expect(sessionLapse(s, T + SESSION_IDLE_MS - 1)).toBeNull();
    expect(sessionLapse(s, T + SESSION_IDLE_MS)).toBe("idle");
    expect(sessionLapse({ ...s, lastSeenAt: T + 12 * 60 * MIN - 20 * MIN }, T + 12 * 60 * MIN)).toBe(
      "expired",
    );
    expect(sessionLapse({ ...s, lastSeenAt: T + 12 * 60 * MIN - MIN }, T + 12 * 60 * MIN - 1)).toBeNull();
  });

  it("idle → «через бездіяльність»; a reset or a reused token → «з іншого пристрою»; the rest → plain sign-in", () => {
    expect(shownEndReason("idle")).toBe("idle");
    expect(shownEndReason("expired")).toBe("expired");
    expect(shownEndReason("password-reset")).toBe("ended-elsewhere");
    expect(shownEndReason("token-reuse")).toBe("ended-elsewhere");
    expect(shownEndReason("signed-out")).toBe("signed-out");
    expect(shownEndReason(null)).toBe("signed-out");
  });
});

describe("NFR-01@PoC FR 12: a replaced refresh token works for 30 s, then its return is a reuse", () => {
  it("current, grace below 30 s, reuse from 30 s", () => {
    expect(ROTATION_GRACE_MS).toBe(30_000);
    expect(tokenStanding(null, T)).toBe("current");
    expect(tokenStanding(T, T + ROTATION_GRACE_MS - 1)).toBe("grace");
    expect(tokenStanding(T, T + ROTATION_GRACE_MS)).toBe("reuse");
  });
});

describe("ACC-01 FR 4, FR 8: the letters", () => {
  it("confirmation: the link to the web app's #/verify (token in the fragment), valid 24 h; Ukrainian first, English complete", () => {
    const link = confirmationLink("https://app.example.org", "A".repeat(43));
    expect(link).toBe(`https://app.example.org/#/verify?token=${"A".repeat(43)}`);
    const uk = confirmationLetter("Олена", link);
    expect(uk.text).toContain(link);
    expect(uk.text).toContain("24 години");
    expect(confirmationLetter("Olena", link, "en").text).toContain("24 hours");
  });

  it("sign-up attempt with a taken address: only the password-reset link, never a confirmation link", () => {
    for (const locale of ["uk", "en"] as const) {
      const letter = signUpAttemptLetter("Олена", passwordResetLink("https://app.example.org"), locale);
      expect(letter.text).toContain("https://app.example.org/#/password/reset");
      expect(letter.text).not.toContain("/verify");
      expect(letter.text.match(/https?:\/\//g)).toHaveLength(1);
    }
  });
});

describe("ACC-01 FR 10, AC16 / NFR-15 FR 3: a reset link is valid 60 min and works once", () => {
  it("usable before 60 min; not at 60 min, not after use, not after a newer link revoked it", () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(60 * MIN);
    const link = { expiresAt: T + PASSWORD_RESET_TTL_MS, usedAt: null, revokedAt: null };
    expect(resetLinkUsable(link, T)).toBe(true);
    expect(resetLinkUsable(link, T + 60 * MIN - 1)).toBe(true);
    expect(resetLinkUsable(link, T + 60 * MIN)).toBe(false);
    expect(resetLinkUsable({ ...link, usedAt: T }, T + MIN)).toBe(false);
    expect(resetLinkUsable({ ...link, revokedAt: T }, T + MIN)).toBe(false);
  });
});

describe("ACC-01 FR 10, AC16, AC17: the reset letters", () => {
  const origin = "https://app.example.org";
  const token = "B".repeat(43);

  it("the reset link carries the token in the fragment only (never sent to a server or in Referer)", () => {
    expect(passwordResetTokenLink(origin, token)).toBe(`${origin}/#/password/reset?token=${token}`);
  });

  it("the reset letter: the link, 60 minutes, once, earlier links revoked; uk first, en complete", () => {
    const link = passwordResetTokenLink(origin, token);
    const uk = passwordResetLetter("Олена", link);
    expect(uk.text).toContain(link);
    expect(uk.text).toContain("60 хвилин");
    expect(uk.text).toContain("один раз");
    const en = passwordResetLetter("Olena", link, "en");
    expect(en.text).toContain(link);
    expect(en.text).toContain("60 minutes");
  });

  it("the security notice after a reset: no token, only the reset page", () => {
    for (const locale of ["uk", "en"] as const) {
      const letter = passwordChangedLetter("Олена", passwordResetLink(origin), locale);
      expect(letter.text).toContain(`${origin}/#/password/reset`);
      expect(letter.text).not.toContain("#token=");
      expect(letter.text.match(/https?:\/\//g)).toHaveLength(1);
    }
    expect(passwordChangedLetter("Олена", passwordResetLink(origin)).subject).toBe(
      "Пароль у Willowsum змінено",
    );
  });

  it("owner decision 2026-11-12: the confirmation letter says «якщо ви не реєструвалися — нічого не робіть»", () => {
    const uk = confirmationLetter("Олена", confirmationLink(origin, token));
    expect(uk.text.toLowerCase()).toContain("якщо ви не реєструвалися — нічого не робіть");
    expect(confirmationLetter("Olena", confirmationLink(origin, token), "en").text).toContain(
      "If you did not sign up, do nothing",
    );
  });
});
