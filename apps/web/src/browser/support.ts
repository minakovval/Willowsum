/**
 * NFR-07@PoC FR 1, EC1: the browsers the PoC supports — the last two versions of Chrome, Safari and Edge on a desktop.
 * Chrome and Edge are told by their Chromium version, so any Chromium-based browser at that version counts; Safari
 * by its `Version/`. Firefox is supported from PoC v2 (owner decision 2026-11-12). Anything else, or a user agent we
 * cannot read, is unsupported: the app then shows a notice and keeps working (sign-in is never blocked).
 *
 * The oldest supported versions (lead decision 2026-11-13, «last two» on that date): Chromium 156 (stable 157, 158 rolling out) and
 * Safari 26 (26.x and 27.x). Raise them with the browsers' releases; an older browser just sees the notice.
 */
export const SUPPORTED_BROWSERS = Object.freeze({ chromium: 156, safari: 26 });

export type BrowserSupport = "supported" | "unsupported";

const major = (ua: string, re: RegExp): number | null => {
  const m = re.exec(ua);
  return m ? Number(m[1]) : null;
};

export function browserSupport(userAgent: string): BrowserSupport {
  // Firefox (also Firefox on iOS, which is WebKit underneath but not Safari).
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return "unsupported";
  const chromium = major(userAgent, /\b(?:Chrome|Chromium)\/(\d+)\./);
  if (chromium !== null) return chromium >= SUPPORTED_BROWSERS.chromium ? "supported" : "unsupported";
  // Safari: WebKit with `Version/N … Safari/`, and not another browser's shell on iOS.
  if (/\bSafari\//.test(userAgent) && !/\b(CriOS|EdgiOS|OPiOS)\//.test(userAgent)) {
    const safari = major(userAgent, /\bVersion\/(\d+)[.\s]/);
    if (safari !== null) return safari >= SUPPORTED_BROWSERS.safari ? "supported" : "unsupported";
  }
  return "unsupported";
}

/** The browser this page runs in (read once; the user agent does not change during a page view). */
export function currentBrowserSupport(): BrowserSupport {
  return typeof navigator === "undefined" ? "supported" : browserSupport(navigator.userAgent);
}
