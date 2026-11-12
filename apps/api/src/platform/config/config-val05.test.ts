import { describe, expect, it } from "vitest";
import type { ConfigError } from "./config.ts";
import { loadConfig } from "./config.ts";

const BASE = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: "probe-secret-value-0001",
  WS_DB_CONTEXT_PASSWORD: "context-secret-value-01",
};
const DEPLOYED = { ...BASE, WS_TELEMETRY_ENVIRONMENT: "production", WS_TELEMETRY: "off" };
const LIVE_MAIL = {
  WS_MAIL_API_KEY: "re_synthetic_key_value_01",
  WS_MAIL_FROM: "Willowsum <no-reply@example.test>",
};

const problems = (env: Record<string, string>, role = "scheduler"): string[] => {
  try {
    loadConfig(env, role, []);
    return [];
  } catch (error) {
    return (error as ConfigError).message.match(/WS_[A-Z_]+/g) ?? [];
  }
};

describe("VAL-05@PoC FR4: the recipient of the app's alert letters (WS_ALERT_EMAIL)", () => {
  it("VAL-05 FR4: a deployed live scheduler starts with the owner's alert address and the mail adapter", () => {
    expect(
      problems({ ...DEPLOYED, WS_PROVIDER_MODE: "live", ...LIVE_MAIL, WS_ALERT_EMAIL: "owner@example.test" }),
    ).toEqual([]);
  });

  it("VAL-05 FR4: a live scheduler with an alert address needs the mail adapter's key and sender", () => {
    const p = problems({ ...BASE, WS_PROVIDER_MODE: "live", WS_ALERT_EMAIL: "owner@example.test" });
    expect(p).toEqual(expect.arrayContaining(["WS_MAIL_API_KEY", "WS_MAIL_FROM"]));
  });

  it("VAL-05 FR4: the address is one plain address; locally it is optional", () => {
    expect(problems({ ...BASE, WS_ALERT_EMAIL: "a@b.test, c@d.test" })).toContain("WS_ALERT_EMAIL");
    expect(loadConfig({ ...BASE, WS_ALERT_EMAIL: "owner@example.test" }, "scheduler", []).alerts).toEqual({
      email: "owner@example.test",
    });
    expect(loadConfig(BASE, "scheduler", []).alerts).toEqual({});
  });

  it("VAL-05 FR3, FR4: a deployed scheduler is refused unless WS_PROVIDER_MODE=live (no synthetic rates or mail)", () => {
    for (const environment of ["staging", "production"]) {
      const env = { ...DEPLOYED, WS_TELEMETRY_ENVIRONMENT: environment, ...LIVE_MAIL };
      expect(problems(env), environment).toContain("WS_PROVIDER_MODE");
      expect(problems({ ...env, WS_PROVIDER_MODE: "test" }), environment).toContain("WS_PROVIDER_MODE");
      expect(problems({ ...env, WS_PROVIDER_MODE: "live" }), environment).not.toContain("WS_PROVIDER_MODE");
    }
    // Locally and in CI the synthetic implementations stay the default.
    expect(loadConfig(BASE, "scheduler", []).providerMode).toBe("test");
  });
});
