import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests on a real PostgreSQL (DATABASE_URL, superuser of a throw-away database).
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // ARC-05: tests never reach the network (only this machine and the test database).
    setupFiles: [fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url))],
    include: ["src/**/*.it.test.ts", "test/**/*.it.test.ts"],
    exclude: ["**/node_modules/**", "test/fixtures/**"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
