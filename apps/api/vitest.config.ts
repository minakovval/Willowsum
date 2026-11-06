import { defineConfig } from "vitest/config";

// Unit tests: no database, no network (ARC-05). Integration tests (*.it.test.ts) need PostgreSQL and run
// with vitest.integration.config.ts in the CI job `api`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/*.it.test.ts", "**/node_modules/**", "test/fixtures/**", "test/.tmp/**"],
  },
});
