/**
 * NFR-07@PoC FR 1, EC1: the browsers the PoC supports — versions of Chrome, Safari and Edge released within the last
 * 3 months, on a desktop (owner decision 2026-11-13; it replaced «the last two versions»). Chrome and Edge are told by
 * their Chromium version, so any Chromium-based browser at that version counts; Safari by its `Version/`. Firefox is
 * supported from PoC v2 (owner decision 2026-11-12). Anything else, or a user agent we cannot read, is unsupported:
 * the app then shows a notice and keeps working (sign-in is never blocked).
 *
 * Each minimum is the oldest version whose first stable release falls within 3 months of `checkedOn`, stored with
 * that date and the version before it, so the unit tests can prove the choice. Sources, checked on 2026-11-13:
 * - Chrome: Google's version history (Windows stable): 152 on 2026-08-12, 153 on 2026-08-26 (window from 2026-08-13).
 *   Edge ships the same Chromium majors a few days after Chrome and is detected by that major; its own dates could not
 *   be read from the agent's network (Microsoft hosts blocked), so Chrome's dates stand for both.
 * - Safari: Apple's Safari release notes: 26.6 on 2026-07-27, 27.0 on 2026-09-14 (27.1 and 27.2 in October).
 * A unit test fails once `checkedOn` is older than MAX_CHECK_AGE_DAYS: refresh the minimums then. Between checks an
 * older browser at worst misses the notice for a few weeks; it is never blocked.
 */
export const SUPPORT_WINDOW_MONTHS = 3;
export const MAX_CHECK_AGE_DAYS = 45;

export const SUPPORTED_BROWSERS = Object.freeze({
  checkedOn: "2026-11-13",
  /** Chrome, Edge and other Chromium-based browsers, by the Chromium major. */
  chromium: Object.freeze({
    version: 153,
    released: "2026-08-26",
    previous: Object.freeze({ version: "152", released: "2026-08-12" }),
  }),
  /** Safari, by the major of `Version/`. */
  safari: Object.freeze({
    version: 27,
    released: "2026-09-14",
    previous: Object.freeze({ version: "26.6", released: "2026-07-27" }),
  }),
});

export type BrowserSupport = "supported" | "unsupported";

const major = (ua: string, re: RegExp): number | null => {
  const m = re.exec(ua);
  return m ? Number(m[1]) : null;
};

export function browserSupport(userAgent: string): BrowserSupport {
  // Firefox (also Firefox on iOS, which is WebKit underneath but not Safari).
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return "unsupported";
  const chromium = major(userAgent, /\b(?:Chrome|Chromium)\/(\d+)\./);
  if (chromium !== null) return chromium >= SUPPORTED_BROWSERS.chromium.version ? "supported" : "unsupported";
  // Safari: WebKit with `Version/N … Safari/`, and not another browser's shell on iOS.
  if (/\bSafari\//.test(userAgent) && !/\b(CriOS|EdgiOS|OPiOS)\//.test(userAgent)) {
    const safari = major(userAgent, /\bVersion\/(\d+)[.\s]/);
    if (safari !== null) return safari >= SUPPORTED_BROWSERS.safari.version ? "supported" : "unsupported";
  }
  return "unsupported";
}

/** The browser this page runs in (read once; the user agent does not change during a page view). */
export function currentBrowserSupport(): BrowserSupport {
  return typeof navigator === "undefined" ? "supported" : browserSupport(navigator.userAgent);
}
