import { describe, expect, it } from "vitest";
import { ConfigError, LOCAL_WEB_ORIGIN, loadConfig } from "./config.ts";

/** ACC-01 FR 12 (ADR-0009): no API server without CAPTCHA in staging and production; mail and links configured. */
const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: "synthetic-synthetic-synthetic",
  WS_DB_CONTEXT_PASSWORD: "synthetic-synthetic-synthetic",
  WS_DB_PASSWORD_IDENTITY: "synthetic-synthetic-synthetic",
};
const live = {
  WS_PROVIDER_MODE: "live",
  WS_WEB_ORIGIN: "https://app.example.org",
  WS_CAPTCHA_SECRET: "synthetic-synthetic-synthetic",
  WS_MAIL_API_KEY: "synthetic-synthetic-synthetic",
  WS_MAIL_FROM: "Willowsum <no-reply@example.org>",
};

/** `live` without the named variables. */
const liveWithout = (...names: string[]) =>
  Object.fromEntries(Object.entries(live).filter(([name]) => !names.includes(name)));

function variablesOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.variables;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("ACC-01 FR 12: CAPTCHA is mandatory on public environments", () => {
  for (const environment of ["staging", "production"]) {
    const deployed = { ...base, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off" };

    it(`${environment}: the api role does not start with the synthetic adapters or without the CAPTCHA secret`, () => {
      expect(
        variablesOf(() =>
          loadConfig({ ...deployed, ...live, WS_PROVIDER_MODE: "test" }, "api", ["identity"]),
        ),
      ).toEqual(["WS_PROVIDER_MODE"]);
      expect(
        variablesOf(() =>
          loadConfig({ ...deployed, ...liveWithout("WS_CAPTCHA_SECRET") }, "api", ["identity"]),
        ),
      ).toEqual(["WS_CAPTCHA_SECRET"]);
      expect(
        variablesOf(() =>
          loadConfig({ ...deployed, ...liveWithout("WS_MAIL_API_KEY", "WS_MAIL_FROM") }, "api", ["identity"]),
        ),
      ).toEqual(["WS_MAIL_API_KEY", "WS_MAIL_FROM"]);
      expect(
        variablesOf(() => loadConfig({ ...deployed, ...liveWithout("WS_WEB_ORIGIN") }, "api", ["identity"])),
      ).toEqual(["WS_WEB_ORIGIN"]);
      expect(
        variablesOf(() =>
          loadConfig({ ...deployed, ...live, WS_WEB_ORIGIN: "http://localhost:5173" }, "api", ["identity"]),
        ),
      ).toEqual(["WS_WEB_ORIGIN"]);
    });

    it(`${environment}: with the live adapters configured it starts; the secrets are named, never echoed`, () => {
      const config = loadConfig({ ...deployed, ...live }, "api", ["identity"]);
      expect(config.identity).toEqual({
        webOrigin: "https://app.example.org",
        captchaSecret: live.WS_CAPTCHA_SECRET,
        mail: { apiKey: live.WS_MAIL_API_KEY, from: live.WS_MAIL_FROM },
      });
      let message = "";
      try {
        loadConfig({ ...deployed, ...live, WS_CAPTCHA_SECRET: "short" }, "api", ["identity"]);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("WS_CAPTCHA_SECRET");
      expect(message).not.toContain("short");
    });

    it(`${environment}: the worker and scheduler roles do not need them`, () => {
      expect(() => loadConfig(deployed, "worker", ["identity"])).not.toThrow();
    });
  }

  it("locally and in CI: the synthetic CAPTCHA and outbox, links to the Vite dev server", () => {
    const config = loadConfig(base, "api", ["identity"]);
    expect(config.providerMode).toBe("test");
    expect(config.identity).toEqual({ webOrigin: LOCAL_WEB_ORIGIN });
  });

  it("a sender with a line break or two addresses is refused", () => {
    for (const from of ["a@example.org\nBcc: b@example.org", "x <a@example.org>, y <b@example.org>"])
      expect(
        variablesOf(() => loadConfig({ ...base, ...live, WS_MAIL_FROM: from }, "api", ["identity"])),
      ).toEqual(["WS_MAIL_FROM"]);
  });
});
