import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // jsdom's own user agent is no browser we support (NFR-07@PoC EC1): the tests run as a supported desktop Chrome,
    // so the unsupported-browser notice appears only where a test asks for it (src/browser/).
    environmentOptions: {
      jsdom: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
      },
    },
    globals: true,
    // The browser end-to-end tests (e2e/*.spec.ts) run in Playwright, not here (NFR-07@PoC).
    exclude: [...configDefaults.exclude, "e2e/**"],
    // ARC-05: tests never reach the network (only this machine and the test database).
    setupFiles: [fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url))],
  },
});
