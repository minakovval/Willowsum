/**
 * The device of a sign-in (ACC-04@PoC FR 4; NFR-15@PoC FR 29): a device is its user agent. The history keeps only
 * the SHA-256 of the user agent; letters and the «Це був не я» page name the browser and system from a fixed list,
 * never the user agent text. Location is not shown until there is a GeoIP database (NFR-15 FR 29).
 */

const DAY = 24 * 60 * 60_000;

/** A «Це був не я» link is valid 7 days and works once (ACC-04 FR 5). */
export const NOT_ME_TTL_MS = 7 * DAY;

/** The longest user agent the server reads; the rest is ignored (the digest is of these characters). */
export const USER_AGENT_MAX = 512;

export const DEVICE_BROWSERS = ["chrome", "edge", "firefox", "safari", "opera", "other"] as const;
export const DEVICE_SYSTEMS = ["windows", "macos", "ios", "android", "linux", "chromeos", "other"] as const;
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export type DeviceOs = (typeof DEVICE_SYSTEMS)[number];

export interface DeviceName {
  readonly browser: DeviceBrowser;
  readonly os: DeviceOs;
}

/** The user agent as the server keys a device by it: trimmed, at most 512 characters. */
export function deviceKey(userAgent: string): string {
  return `device:${userAgent.trim().slice(0, USER_AGENT_MAX)}`;
}

/** The browser and system of a user agent, for people (not for matching: that is the whole user agent). */
export function deviceName(userAgent: string): DeviceName {
  const ua = userAgent;
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
