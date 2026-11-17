import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests of the S3 adapter against a local S3-compatible storage (ARC-06@PoC FR 4 criteria; *.s3.test.ts): need
// PostgreSQL (DATABASE_URL) and the storage (WS_TEST_S3_ENDPOINT, WS_TEST_S3_ACCESS_KEY, WS_TEST_S3_SECRET_KEY). CI part
// `checks` of the job `api` starts SeaweedFS (the image of infra/local/compose.yaml) for them; locally `pnpm local:up`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // ARC-05: only this machine — the storage listens on 127.0.0.1.
    globalSetup: [fileURLToPath(new URL("./test/cluster-lock.ts", import.meta.url))],
    setupFiles: [fileURLToPath(new URL("../../tools/test-guards/no-network.mjs", import.meta.url))],
    include: ["src/**/*.s3.test.ts"],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
