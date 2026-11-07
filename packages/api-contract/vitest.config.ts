import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // ARC-05: tests never reach the network (only this machine and the test database).
    setupFiles: [fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url))],
  },
});
