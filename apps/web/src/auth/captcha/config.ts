/**
 * Which CAPTCHA widget the web app shows (ACC-01@PoC FR 12; ADR-0009). The Cloudflare Turnstile site key comes from
 * the build's `VITE_CAPTCHA_SITE_KEY` (public by design: it names the site to the widget; the secret lives only in
 * the API as `WS_CAPTCHA_SECRET`). Without a key — local development and CI — the synthetic widget runs instead: no
 * network, and its fixed token passes only the API's synthetic verifier, which staging and production never use.
 */
export type CaptchaConfig =
  { readonly mode: "turnstile"; readonly siteKey: string } | { readonly mode: "synthetic" };

// Turnstile site keys are public identifiers of letters, digits, `_` and `-`; anything else is a misconfiguration.
const SITE_KEY_SHAPE = /^[0-9A-Za-z_-]{8,128}$/;

export function captchaConfig(env: Record<string, unknown> = import.meta.env): CaptchaConfig {
  const key = env["VITE_CAPTCHA_SITE_KEY"];
  if (typeof key === "string" && SITE_KEY_SHAPE.test(key.trim()))
    return { mode: "turnstile", siteKey: key.trim() };
  return { mode: "synthetic" };
}

/** The token the API's synthetic verifier accepts (apps/api/src/platform/adapters/captcha/synthetic.ts). */
export const SYNTHETIC_CAPTCHA_TOKEN = "synthetic-captcha-pass";
