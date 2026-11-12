import { CAPTCHA_TOKEN_RE, type CaptchaVerifier } from "./port.ts";

/**
 * The token the synthetic verifier accepts (ARC-05 FR 2): local development and CI have no widget, so a test
 * or the web app's local mode sends this fixed value. Every other token fails. Not a secret: the synthetic
 * verifier never runs in staging or production (config.ts refuses it there).
 */
export const SYNTHETIC_CAPTCHA_PASS = "synthetic-captcha-pass";

export function syntheticCaptchaVerifier(): CaptchaVerifier & { readonly checked: number } {
  let checked = 0;
  return {
    get checked() {
      return checked;
    },
    async verify(token) {
      checked += 1;
      return CAPTCHA_TOKEN_RE.test(token) && token === SYNTHETIC_CAPTCHA_PASS;
    },
  };
}
