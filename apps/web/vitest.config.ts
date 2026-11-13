import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // The browser end-to-end tests (e2e/*.spec.ts) run in Playwright, not here (NFR-07@PoC).
    exclude: [...configDefaults.exclude, "e2e/**"],
    // ARC-05: tests never reach the network (only this machine and the test database).
    setupFiles: [
      fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url)),
      // jsdom's own user agent is no browser we support (NFR-07@PoC EC1): tests run as a supported desktop Chrome.
      fileURLToPath(new URL("./src/browser/test-user-agent.ts", import.meta.url)),
    ],
  },
});
