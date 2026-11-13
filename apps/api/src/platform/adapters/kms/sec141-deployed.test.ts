import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config/config.ts";
import { keyManagement } from "./index.ts";

/**
 * Security review of PR #141 (ARC-06@PoC FR 1): the local KMS, whose master key comes from a fixed public label,
 * must never run in a deployed process. config.ts refuses WS_PROVIDER_MODE=test only for the api and scheduler
 * roles; a deployed worker still loads with the default `test`, and main.ts builds `keyManagement(config.providerMode)`
 * for every role — so a deployed worker holds the fixed-label master key.
 */
const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: ["synthetic", "synthetic", "synthetic"].join("-"),
  WS_DB_CONTEXT_PASSWORD: ["synthetic", "synthetic", "synthetic"].join("-"),
  WS_DB_PASSWORD_IDENTITY: ["synthetic", "synthetic", "synthetic"].join("-"),
};

describe("sec141: the fixed-label local KMS never runs in a deployed process", () => {
  for (const environment of ["staging", "production"]) {
    // A deployed process of any role (here the worker, which config.ts lets keep `test`) gets the fail-closed KMS.
    it(`${environment}: a deployed worker's KMS fails closed instead of using the local master key`, async () => {
      const config = loadConfig(
        { ...base, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off" },
        "worker",
        ["identity"],
      );
      expect(config.deployed).toBe(true);
      // The same call main.ts makes, plus the deployment flag the patch adds.
      const kms = keyManagement(config.providerMode, () => ({}), { deployed: config.deployed });
      await expect(kms.currentVersion()).rejects.toMatchObject({ kind: "unavailable" });
      await expect(
        kms.wrap(randomBytes(32), { space: "6f1c2a52-6d0e-4c43-9a43-1f0f5d2b9a10" }),
      ).rejects.toMatchObject({
        kind: "unavailable",
      });
    });
  }

  it("locally the test mode still gets the local KMS", async () => {
    const config = loadConfig(base, "worker", ["identity"]);
    const kms = keyManagement(config.providerMode, () => ({}), { deployed: config.deployed });
    expect(await kms.currentVersion()).toMatch(/^local-\d+$/);
  });
});
