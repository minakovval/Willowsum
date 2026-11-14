import { describe, expect, it } from "vitest";
import {
  canonicalLocale,
  localeSchema,
  passwordChangedInProfileLetter,
  passwordSchema,
  STEP_UP_TTL_MS,
  stepUpLockedLetter,
  stepUpUsable,
  timeZoneSchema,
  type StepUpAction,
} from "./index.ts";

const SESSION = "0b8f3c1e-2f7a-4c1d-9e0a-5b6c7d8e9f01";
const OTHER_SESSION = "7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
const T0 = Date.UTC(2026, 10, 14, 10, 0, 0);
const confirmation = {
  sessionId: SESSION,
  action: "password-change" as StepUpAction,
  expiresAt: T0 + STEP_UP_TTL_MS,
  usedAt: null,
};
const use = { sessionId: SESSION, action: "password-change" as StepUpAction, now: T0 + 1000 };

describe("NFR-15@PoC AC5, NFR-01@PoC AC8: a step-up confirmation is refused a second time, for another action, from another session or after 6 min", () => {
  it("usable once, for its session and action, until 5 min after it was given", () => {
    expect(STEP_UP_TTL_MS).toBe(5 * 60_000);
    expect(stepUpUsable(confirmation, use)).toBe(true);
    expect(stepUpUsable({ ...confirmation, usedAt: T0 + 500 }, use)).toBe(false);
    expect(stepUpUsable(confirmation, { ...use, sessionId: OTHER_SESSION })).toBe(false);
    // Only one action needs step-up in this release; a confirmation never stands for another one.
    expect(stepUpUsable(confirmation, { ...use, action: "email-change" as StepUpAction })).toBe(false);
    expect(stepUpUsable(confirmation, { ...use, now: T0 + STEP_UP_TTL_MS - 1 })).toBe(true);
    expect(stepUpUsable(confirmation, { ...use, now: T0 + STEP_UP_TTL_MS })).toBe(false);
    expect(stepUpUsable(confirmation, { ...use, now: T0 + 6 * 60_000 })).toBe(false);
  });
});

describe("ACC-05@PoC AC3: the format and the time zone come from the browser at sign-up", () => {
  it("a BCP 47 locale is kept in its canonical form; anything else is refused", () => {
    expect(canonicalLocale("uk-ua")).toBe("uk-UA");
    expect(canonicalLocale("en-GB")).toBe("en-GB");
    expect(localeSchema.safeParse("de-DE").success).toBe(true);
    for (const bad of ["", "not a locale", "uk_UA", "x".repeat(40), "uk-UA\n"])
      expect(localeSchema.safeParse(bad).success).toBe(false);
  });

  it("an IANA time zone the runtime knows is kept as sent; anything else is refused", () => {
    for (const zone of ["Europe/Kyiv", "America/New_York", "UTC"])
      expect(timeZoneSchema.safeParse(zone).data).toBe(zone);
    for (const bad of ["", "Mars/Olympus_Mons", "Europe/Kyiv\u0000", "x".repeat(65)])
      expect(timeZoneSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ACC-05@PoC FR 5: the new password has at least 12 characters; a security letter about the change", () => {
  it("under 12 characters is refused with the reason too_small (code points after NFKC)", () => {
    const short = passwordSchema.safeParse("eleven char");
    expect(short.success).toBe(false);
    expect(short.error!.issues.map((i) => i.code)).toEqual(["too_small"]);
    expect(passwordSchema.safeParse("twelve chars").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(257)).error!.issues.map((i) => i.code)).toEqual(["too_big"]);
  });

  it("the letters about a change in the profile and about the step-up lock are complete in uk and en, with no token", () => {
    const link = "http://localhost:5173/#/password/reset";
    for (const locale of ["uk", "en"] as const) {
      for (const letter of [
        passwordChangedInProfileLetter("Олена", link, locale),
        stepUpLockedLetter("Олена", link, locale),
      ]) {
        expect(letter.subject.length).toBeGreaterThan(0);
        expect(letter.text).toContain("Олена");
        expect(letter.text).toContain(link);
        expect(letter.text).not.toContain("token=");
      }
    }
    expect(passwordChangedInProfileLetter("Олена", link).subject).toBe("Пароль у Willowsum змінено");
    expect(passwordChangedInProfileLetter("Олена", link, "en").text).toContain("in your profile");
    expect(stepUpLockedLetter("Олена", link).subject).toBe("Вхід у Willowsum тимчасово заблоковано");
  });
});
