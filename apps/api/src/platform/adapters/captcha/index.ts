import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../port.ts";
import { httpCaptchaVerifier, type HttpCaptchaOptions } from "./http.ts";
import type { CaptchaVerifier } from "./port.ts";
import { syntheticCaptchaVerifier } from "./synthetic.ts";

export { CAPTCHA_PORT, CAPTCHA_TOKEN_RE } from "./port.ts";
export type { CaptchaVerifier } from "./port.ts";
export { DEFAULT_CAPTCHA_BASE_URL, httpCaptchaVerifier } from "./http.ts";
export type { HttpCaptchaOptions } from "./http.ts";
export { SYNTHETIC_CAPTCHA_PASS, syntheticCaptchaVerifier } from "./synthetic.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const CAPTCHA_IMPLEMENTATIONS: ProviderImplementations<CaptchaVerifier, HttpCaptchaOptions> =
  Object.freeze({ test: syntheticCaptchaVerifier, live: httpCaptchaVerifier });

/** The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). */
export function captchaVerifier(mode: ProviderMode, liveOptions: () => HttpCaptchaOptions): CaptchaVerifier {
  return selectImplementation(mode, CAPTCHA_IMPLEMENTATIONS, liveOptions);
}
