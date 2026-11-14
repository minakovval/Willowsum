/**
 * The device of a sign-in (ACC-04@PoC FR 4; NFR-15@PoC FR 29; owner decision 2026-11-14): a device is its browser and
 * system without versions, from a fixed list («Chrome на Windows»), so a browser update is not a new device. The same
 * value is the device of the sign-in journal. The history keeps only the SHA-256 of the key; the user agent text is
 * never stored. Location is not shown until there is a GeoIP database (NFR-15 FR 29).
 */

const DAY = 24 * 60 * 60_000;

/** A «Це був не я» link is valid 7 days and works once (ACC-04 FR 5). */
export const NOT_ME_TTL_MS = 7 * DAY;

/** The longest user agent the server reads; the rest is ignored. */
export const USER_AGENT_MAX = 512;

export const DEVICE_BROWSERS = ["chrome", "edge", "firefox", "safari", "opera", "other"] as const;
export const DEVICE_SYSTEMS = ["windows", "macos", "ios", "android", "linux", "chromeos", "other"] as const;
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export type DeviceOs = (typeof DEVICE_SYSTEMS)[number];

export interface DeviceName {
  readonly browser: DeviceBrowser;
  readonly os: DeviceOs;
}

/** The key of a device in the sign-in history (scheme 2): `device:<browser>/<os>`. */
export function deviceKeyOf(device: DeviceName): string {
  return `device:${device.browser}/${device.os}`;
}

/** The key of the device of a user agent: its browser and system, without versions. */
export function deviceKey(userAgent: string): string {
  return deviceKeyOf(deviceName(userAgent));
}

/**
 * The key of the history kept before 2026-11-14 (scheme 1): the whole user agent, trimmed, at most 512 characters.
 * Only for recognising such rows at sign-in; nothing new is keyed by it.
 */
export function legacyDeviceKey(userAgent: string): string {
  return `device:${userAgent.trim().slice(0, USER_AGENT_MAX)}`;
}

/** As the journal and the history name a device: `<browser>/<os>` (e.g. `chrome/windows`). */
export function deviceLabel(device: DeviceName): string {
  return `${device.browser}/${device.os}`;
}

/** The browser and system of a user agent, without versions. */
export function deviceName(userAgent: string): DeviceName {
  const ua = userAgent.slice(0, USER_AGENT_MAX);
  const browser: DeviceBrowser = /\bEdg(?:e|A|iOS)?\//.test(ua)
    ? "edge"
    : /\b(?:OPR|Opera|OPT)\//.test(ua)
      ? "opera"
      : /\b(?:Firefox|FxiOS)\//.test(ua)
        ? "firefox"
        : /\b(?:Chrome|CriOS|Chromium)\//.test(ua)
          ? "chrome"
          : /\bVersion\/[\d.]+.*\bSafari\//.test(ua)
            ? "safari"
            : "other";
  const os: DeviceOs = /\b(?:iPhone|iPad|iPod)\b/.test(ua)
    ? "ios"
    : /\bAndroid\b/.test(ua)
      ? "android"
      : /\bWindows\b/.test(ua)
        ? "windows"
        : /\bCrOS\b/.test(ua)
          ? "chromeos"
          : /\bMac OS X\b|\bMacintosh\b/.test(ua)
            ? "macos"
            : /\bLinux\b/.test(ua)
              ? "linux"
              : "other";
  return { browser, os };
}

/**
 * The client address as the «Це був не я» page shows it (S-004b): an IPv4 address without its third byte
 * (`89.64.•••.12`), an IPv6 network by its first two groups (`2001:db8:•••`); anything else `•••`. The full address
 * is never stored.
 */
export function maskedAddress(clientAddress: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.(\d{1,3})$/.exec(clientAddress);
  if (v4) return `${v4[1]}.${v4[2]}.•••.${v4[3]}`;
  const v6 = /^([0-9a-f]{1,4}):([0-9a-f]{1,4}):[0-9a-f:]*::\/64$/.exec(clientAddress);
  if (v6) return `${v6[1]}:${v6[2]}:•••`;
  return "•••";
}

/** Can a «Це був не я» link still be used at `now`? Once, within 7 days. */
export function notMeLinkUsable(
  link: { readonly usedAt: number | null; readonly expiresAt: number },
  now: number,
): boolean {
  return link.usedAt === null && now < link.expiresAt;
}
