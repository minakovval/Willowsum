/**
 * NFR-07@PoC FR 1, EC1: the browsers the PoC supports — versions of Chrome, Safari and Edge released within the last
 * 3 months, on a desktop (owner decision 2026-11-13; it replaced «the last two versions»). Chrome and Edge are told by
 * their Chromium version, so any Chromium-based browser at that version counts; Safari by its `Version/`. Firefox is
 * supported from PoC v2 (owner decision 2026-11-12). Anything else, or a user agent we cannot read, is unsupported:
 * the app then shows a notice and keeps working (sign-in is never blocked).
 *
 * The minimum is computed from today's date (lead decision 2026-11-13): the oldest version in `BROWSER_RELEASES`
 * released on or after the cutoff, 3 calendar months back. So old versions drop out on time by themselves; the
 * tables only need new releases added. A unit test fails when a table's newest release is older than
 * `RELEASE_TABLE_STALE_AFTER_DAYS` — the sign that newer releases are missing. Sources (checked 2026-11-13):
 * - Chromium: Google's version history, Windows stable, first stable date of each major. Edge ships the same majors
 *   within days and is detected by the major, so Chrome's dates stand for it (lead decision 2026-11-13).
 * - Safari: Apple's Safari release notes, release date of each version.
 */
export interface Release {
  /** `153` (Chromium major) or `27.1` (Safari major.minor). */
  readonly version: string;
  /** First stable release, UTC calendar date. */
  readonly released: string;
}

const table = (rows: readonly (readonly [string, string])[]): readonly Release[] =>
  Object.freeze(rows.map(([version, released]) => Object.freeze({ version, released })));

export const BROWSER_RELEASES = Object.freeze({
  chromium: table([
    ["150", "2026-06-17"],
    ["151", "2026-07-15"],
    ["152", "2026-08-12"],
    ["153", "2026-08-26"],
    ["154", "2026-09-09"],
    ["155", "2026-09-23"],
    ["156", "2026-10-07"],
    ["157", "2026-10-22"],
    ["158", "2026-11-04"],
  ]),
  safari: table([
    ["26.3", "2026-02-11"],
    ["26.4", "2026-03-24"],
    ["26.5", "2026-05-11"],
    ["26.6", "2026-07-27"],
    ["27.0", "2026-09-14"],
    ["27.1", "2026-10-23"],
    ["27.2", "2026-10-26"],
  ]),
});

export const SUPPORT_WINDOW_MONTHS = 3;

/**
 * How old a table's newest release may get before a test asks for the newer ones. Chrome ships a major every two to
 * four weeks, so six weeks without one means the table is behind; Safari's releases are 5 to 11 weeks apart, so 12
 * weeks. Both stay well inside the window, where a missing release would start to matter.
 */
export const RELEASE_TABLE_STALE_AFTER_DAYS = Object.freeze({ chromium: 42, safari: 84 });

/** The first day of the window: `today` 3 calendar months back, as a UTC date (`YYYY-MM-DD`). */
export function supportCutoff(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - SUPPORT_WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}

/** The oldest version of each browser released on or after the cutoff (the newest known one if none is). */
export function supportedMinimums(today: Date): { readonly chromium: string; readonly safari: string } {
  const cutoff = supportCutoff(today);
  const oldestInWindow = (rows: readonly Release[]) =>
    (rows.find((r) => r.released >= cutoff) ?? rows.at(-1)!).version;
  return {
    chromium: oldestInWindow(BROWSER_RELEASES.chromium),
    safari: oldestInWindow(BROWSER_RELEASES.safari),
  };
}

export type BrowserSupport = "supported" | "unsupported";

/** `27.1` → [27, 1]; `153` → [153, 0]. */
const parts = (version: string): [number, number] => {
  const [major = "0", minor = "0"] = version.split(".");
  return [Number(major), Number(minor)];
};
const atLeast = (version: string, minimum: string) => {
  const [a, b] = [parts(version), parts(minimum)];
  return a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1];
};

export function browserSupport(userAgent: string, today: Date = new Date()): BrowserSupport {
  const minimum = supportedMinimums(today);
  // Firefox (also Firefox on iOS, which is WebKit underneath but not Safari).
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return "unsupported";
  const chromium = /\b(?:Chrome|Chromium)\/(\d+)\./.exec(userAgent);
  if (chromium) return atLeast(chromium[1]!, minimum.chromium) ? "supported" : "unsupported";
  // Safari: WebKit with `Version/N.M … Safari/`, and not another browser's shell on iOS.
  if (/\bSafari\//.test(userAgent) && !/\b(CriOS|EdgiOS|OPiOS)\//.test(userAgent)) {
    const safari = /\bVersion\/(\d+)(?:\.(\d+))?/.exec(userAgent);
    if (safari)
      return atLeast(`${safari[1]}.${safari[2] ?? "0"}`, minimum.safari) ? "supported" : "unsupported";
  }
  return "unsupported";
}

/** The browser this page runs in (read once; the user agent does not change during a page view). */
export function currentBrowserSupport(): BrowserSupport {
  return typeof navigator === "undefined" ? "supported" : browserSupport(navigator.userAgent);
}
