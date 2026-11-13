import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // The browser end-to-end tests (e2e/*.spec.ts) run in Playwright, not here (NFR-07@PoC).
    exclude: [...configDefaults.exclude, "e2e/**"],
    // ARC-05: tests never reach the network (only this machine and the test database).
    setupFiles: [fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url))],
  },
});
