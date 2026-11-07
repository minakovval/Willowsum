import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

/** NFR-14 FR 8–10 and NFR-15 FR 5: the HTTP protections of the API are configuration, named in errors. */
const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: "synthetic-synthetic-synthetic",
  WS_DB_CONTEXT_PASSWORD: "synthetic-synthetic-synthetic",
  WS_DB_PASSWORD_LEDGER: "synthetic-synthetic-synthetic",
};
const deployed = (environment: string) => ({
  ...base,
  WS_TELEMETRY_ENVIRONMENT: environment,
  WS_TELEMETRY: "off",
});

function variablesOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.variables;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("NFR-14 FR 8: trusted proxy hops", () => {
  it("default 0 (forwarded headers ignored); 0–5 accepted; anything else refused by name", () => {
    expect(loadConfig(base, "api", ["ledger"]).http.trustedProxyHops).toBe(0);
    expect(loadConfig({ ...base, WS_TRUSTED_PROXY_HOPS: "2" }, "api", ["ledger"]).http.trustedProxyHops).toBe(
      2,
    );
    for (const bad of ["-1", "6", "one", "1.5"])
      expect(
        variablesOf(() => loadConfig({ ...base, WS_TRUSTED_PROXY_HOPS: bad }, "api", ["ledger"])),
      ).toEqual(["WS_TRUSTED_PROXY_HOPS"]);
  });
});

describe("NFR-14 FR 9: rate limits on by default; off only for a load test, never in production", () => {
  it("on by default everywhere, staging and production included", () => {
    expect(loadConfig(base, "api", ["ledger"]).http.rateLimits).toBe("on");
    for (const environment of ["staging", "production"])
      expect(loadConfig(deployed(environment), "api", ["ledger"]).http.rateLimits).toBe("on");
  });

  it("WS_RATE_LIMITS=off-load-test is accepted for a load test (staging, local), refused in production", () => {
    expect(
      loadConfig({ ...deployed("staging"), WS_RATE_LIMITS: "off-load-test" }, "api", ["ledger"]).http
        .rateLimits,
    ).toBe("off-load-test");
    expect(
      variablesOf(() =>
        loadConfig({ ...deployed("production"), WS_RATE_LIMITS: "off-load-test" }, "api", ["ledger"]),
      ),
    ).toEqual(["WS_RATE_LIMITS"]);
    // No other way to switch them off.
    for (const bad of ["off", "false", "0"])
      expect(variablesOf(() => loadConfig({ ...base, WS_RATE_LIMITS: bad }, "api", ["ledger"]))).toEqual([
        "WS_RATE_LIMITS",
      ]);
  });
});

describe("NFR-14 FR 10: with more than one API instance the counters must be shared", () => {
  it("the API refuses to start with in-process counters and WS_API_INSTANCES > 1", () => {
    expect(loadConfig(base, "api", ["ledger"])).toBeTruthy();
    expect(variablesOf(() => loadConfig({ ...base, WS_API_INSTANCES: "2" }, "api", ["ledger"]))).toEqual([
      "WS_API_INSTANCES",
    ]);
    // Without limits (load test) nothing is counted; worker and scheduler serve no API.
    expect(
      loadConfig({ ...base, WS_API_INSTANCES: "3", WS_RATE_LIMITS: "off-load-test" }, "api", ["ledger"]),
    ).toBeTruthy();
    expect(loadConfig({ ...base, WS_API_INSTANCES: "3" }, "worker", ["ledger"])).toBeTruthy();
  });
});

describe("NFR-15 FR 5 / NFR-14 table: allowed origins and the deployed (HTTPS) environments", () => {
  it("locally the Vite dev and preview servers; in staging and production none until configured (fail closed)", () => {
    const local = loadConfig(base, "api", ["ledger"]);
    expect([...local.http.allowedOrigins]).toEqual(["http://localhost:5173", "http://localhost:4173"]);
    expect(local.deployed).toBe(false);
    const staging = loadConfig(deployed("staging"), "api", ["ledger"]);
    expect(staging.http.allowedOrigins.size).toBe(0);
    expect(staging.deployed).toBe(true);
    const configured = loadConfig(
      { ...deployed("production"), WS_ALLOWED_ORIGINS: "https://app.willowsum.example" },
      "api",
      ["ledger"],
    );
    expect([...configured.http.allowedOrigins]).toEqual(["https://app.willowsum.example"]);
  });

  it("an invalid origin is refused by name, without its value; http origins are refused in staging and production", () => {
    const error = (() => {
      try {
        loadConfig({ ...base, WS_ALLOWED_ORIGINS: "https://*.evil-pattern.example" }, "api", ["ledger"]);
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected a ConfigError");
    })();
    expect(error.variables).toEqual(["WS_ALLOWED_ORIGINS"]);
    expect(error.message).not.toContain("evil-pattern");
    expect(
      loadConfig({ ...base, WS_ALLOWED_ORIGINS: "http://localhost:3000" }, "api", ["ledger"]),
    ).toBeTruthy();
    expect(
      variablesOf(() =>
        loadConfig({ ...deployed("staging"), WS_ALLOWED_ORIGINS: "http://localhost:3000" }, "api", [
          "ledger",
        ]),
      ),
    ).toEqual(["WS_ALLOWED_ORIGINS"]);
  });
});
