/**
 * Vitest setup (vitest.config.ts): the tests run as a supported desktop Chrome, so the unsupported-browser notice of
 * NFR-07@PoC EC1 appears only where a test asks for it (src/browser/). jsdom's own user agent is no browser we support.
 * Set on `navigator`, not through jsdom's options: a custom jsdom user agent turns on its resource loader, which then
 * tries to fetch scripts.
 */
import { SUPPORTED_BROWSERS } from "./support.ts";

Object.defineProperty(navigator, "userAgent", {
  value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${SUPPORTED_BROWSERS.chromium}.0.0.0 Safari/537.36`,
  configurable: true,
});
