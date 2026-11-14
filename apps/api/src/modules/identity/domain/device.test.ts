import { describe, expect, it } from "vitest";
import {
  deviceKey,
  deviceKeyOf,
  deviceName,
  legacyDeviceKey,
  maskedAddress,
  NOT_ME_TTL_MS,
  notMeLinkUsable,
} from "./device.ts";
import { letterTime, newSignInLetter, notMeLink } from "./mail.ts";

describe("NFR-15@PoC FR 29: a device is its browser and system without versions", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      { browser: "chrome", os: "windows" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      { browser: "edge", os: "windows" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      { browser: "firefox", os: "linux" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      { browser: "safari", os: "macos" },
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
      { browser: "chrome", os: "ios" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 OPR/85.0",
      { browser: "opera", os: "android" },
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      { browser: "chrome", os: "chromeos" },
    ],
    ["curl/8.5.0", { browser: "other", os: "other" }],
    ["", { browser: "other", os: "other" }],
  ])("%s", (ua, name) => {
    expect(deviceName(ua)).toEqual(name);
  });

  it("the key is the browser and the system without versions: a browser update is the same device", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
    expect(deviceKey(ua)).toBe("device:firefox/linux");
    expect(deviceKey(ua.replaceAll("133", "134"))).toBe(deviceKey(ua));
    expect(deviceKey(ua)).toBe(deviceKeyOf({ browser: "firefox", os: "linux" }));
    expect(deviceKey(ua)).not.toBe(deviceKey(ua.replace("X11; Linux x86_64", "Windows NT 10.0; Win64; x64")));
    expect(deviceKey("curl/8.5.0")).toBe("device:other/other");
  });

  it("the key of the history before 2026-11-14 (the whole user agent, trimmed, at most 512 characters) is still known", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
    expect(legacyDeviceKey(` ${ua} `)).toBe(`device:${ua}`);
    expect(legacyDeviceKey("x".repeat(600))).toBe(legacyDeviceKey("x".repeat(512)));
  });
});

describe("ACC-04@PoC FR 5: the «Це був не я» link is one-time and valid 7 days", () => {
  it("usable until a second before 7 days, not at 7 days, never once used", () => {
    const expiresAt = 1_000 + NOT_ME_TTL_MS;
    expect(NOT_ME_TTL_MS).toBe(7 * 24 * 60 * 60_000);
    expect(notMeLinkUsable({ usedAt: null, expiresAt }, expiresAt - 1)).toBe(true);
    expect(notMeLinkUsable({ usedAt: null, expiresAt }, expiresAt)).toBe(false);
    expect(notMeLinkUsable({ usedAt: 2_000, expiresAt }, 3_000)).toBe(false);
  });

  it("the page shows the client address masked; the full address is never kept", () => {
    expect(maskedAddress("89.64.201.12")).toBe("89.64.•••.12");
    expect(maskedAddress("2001:db8:0:0::/64")).toBe("2001:db8:•••");
    expect(maskedAddress("unknown")).toBe("•••");
  });
});

describe("ACC-04@PoC FR 4: the new-device letter names the device and the time and carries «Це був не я»", () => {
  it("uk and en, the time in UTC, the link with the token in the fragment", () => {
    const at = Date.UTC(2026, 10, 5, 23, 14, 30);
    const link = notMeLink("https://app.example.test", "T".repeat(43));
    expect(link).toBe(`https://app.example.test/#/not-me?token=${"T".repeat(43)}`);
    expect(letterTime(at)).toBe("05.11.2026, 23:14 UTC");
    const uk = newSignInLetter("Олена", { at, device: { browser: "chrome", os: "windows" } }, link);
    expect(uk.subject).toBe("Новий вхід у ваш акаунт Willowsum");
    expect(uk.text).toContain("Chrome на Windows, 05.11.2026, 23:14 UTC");
    expect(uk.text).toContain(`Це був не я: ${link}`);
    const en = newSignInLetter("Olena", { at, device: { browser: "other", os: "other" } }, link, "en");
    expect(en.text).toContain("an unknown browser on an unknown system, 2026-11-05, 23:14 UTC");
    expect(en.text).toContain(`It was not me: ${link}`);
  });
});
