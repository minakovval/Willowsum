import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, modulePasswordVariable } from "./config.ts";

const secretA = "s3cr3t-value-for-ledger-0001";
const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: "probe-secret-value-0001",
  WS_DB_CONTEXT_PASSWORD: "context-secret-value-01",
  WS_DB_PASSWORD_LEDGER: secretA,
  WS_DB_PASSWORD_BANK_MONOBANK: "another-secret-value-02",
};

function errorOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("ARC-02 FR 3 / CICD-12 FR 3: configuration checked by a schema at start", () => {
  it("reads a complete configuration with defaults", () => {
    const config = loadConfig(base, "api", ["ledger", "bank-monobank"]);
    expect(config).toMatchObject({ role: "api", port: 8080, shutdownTimeoutMs: 30_000 });
    expect(config.database).toMatchObject({ host: "localhost", port: 5432, name: "willowsum", ssl: true });
    expect(config.database.modulePasswords.get("bank-monobank")).toBe("another-secret-value-02");
    expect(modulePasswordVariable("bank-monobank")).toBe("WS_DB_PASSWORD_BANK_MONOBANK");
  });

  it("ARC-07 / П-24: the plan matrix source defaults to every feature enabled; another value is refused by name", () => {
    expect(loadConfig(base, "api", ["ledger", "bank-monobank"]).planEntitlements).toBe("all-enabled");
    const error = errorOf(() =>
      loadConfig({ ...base, WS_PLAN_ENTITLEMENTS: "premium" }, "api", ["ledger", "bank-monobank"]),
    );
    expect(error.variables).toEqual(["WS_PLAN_ENTITLEMENTS"]);
  });

  it("ARC-05 FR 2: provider ports run their test implementation unless WS_PROVIDER_MODE=live; another value is refused by name", () => {
    expect(loadConfig(base, "api", ["ledger"]).providerMode).toBe("test");
    expect(loadConfig({ ...base, WS_PROVIDER_MODE: "live" }, "api", ["ledger"]).providerMode).toBe("live");
    const error = errorOf(() => loadConfig({ ...base, WS_PROVIDER_MODE: "sandbox-xyz" }, "api", ["ledger"]));
    expect(error.variables).toEqual(["WS_PROVIDER_MODE"]);
    expect(error.message).not.toContain("sandbox-xyz");
  });

  it("ARC-09 FR 1: telemetry is kept in memory unless WS_TELEMETRY says otherwise; otlp needs the endpoint and its secret header", () => {
    expect(loadConfig(base, "api", ["ledger"]).telemetry).toEqual({ mode: "test", environment: "local" });
    expect(loadConfig({ ...base, WS_TELEMETRY: "off" }, "worker", ["ledger"]).telemetry.mode).toBe("off");
    const authorization = "Basic c3ludGhldGljOnRva2VuLXZhbHVl";
    const otlp = loadConfig(
      {
        ...base,
        WS_TELEMETRY: "otlp",
        WS_TELEMETRY_ENVIRONMENT: "production",
        WS_OTLP_ENDPOINT: "https://otlp-gateway.example.eu/otlp",
        WS_OTLP_AUTHORIZATION: authorization,
      },
      "scheduler",
      ["ledger"],
    ).telemetry;
    expect(otlp).toEqual({
      mode: "otlp",
      environment: "production",
      otlp: { endpoint: "https://otlp-gateway.example.eu/otlp", authorization },
    });
    const missing = errorOf(() => loadConfig({ ...base, WS_TELEMETRY: "otlp" }, "api", ["ledger"]));
    expect(missing.variables).toEqual(["WS_OTLP_AUTHORIZATION", "WS_OTLP_ENDPOINT"]);
    // Plain http only for a collector on this machine; a URL with credentials or a query is refused — by name.
    for (const endpoint of [
      "http://collector.example.eu/otlp",
      "https://user:pass@collector.example.eu",
      "https://collector.example.eu/otlp?token=abc",
      "not a url",
    ]) {
      const error = errorOf(() =>
        loadConfig(
          { ...base, WS_TELEMETRY: "otlp", WS_OTLP_ENDPOINT: endpoint, WS_OTLP_AUTHORIZATION: authorization },
          "api",
          ["ledger"],
        ),
      );
      expect(error.variables).toEqual(["WS_OTLP_ENDPOINT"]);
      expect(error.message).not.toContain(endpoint);
    }
    const weak = errorOf(() =>
      loadConfig(
        {
          ...base,
          WS_TELEMETRY: "otlp",
          WS_OTLP_ENDPOINT: "http://localhost:4318",
          WS_OTLP_AUTHORIZATION: "short",
        },
        "api",
        ["ledger"],
      ),
    );
    expect(weak.variables).toEqual(["WS_OTLP_AUTHORIZATION"]);
    expect(weak.message).not.toContain("short");
    expect(
      errorOf(() => loadConfig({ ...base, WS_TELEMETRY: "grafana" }, "api", ["ledger"])).variables,
    ).toEqual(["WS_TELEMETRY"]);
  });

  it("review of PR #85: staging and production must choose telemetry explicitly and never keep it in memory", () => {
    const otlpVars = {
      WS_OTLP_ENDPOINT: "https://otlp-gateway.example.eu/otlp",
      WS_OTLP_AUTHORIZATION: "Basic c3ludGhldGljOnRva2VuLXZhbHVl",
    };
    for (const environment of ["staging", "production"]) {
      for (const mode of [undefined, "test"]) {
        const env = {
          ...base,
          WS_TELEMETRY_ENVIRONMENT: environment,
          ...(mode ? { WS_TELEMETRY: mode } : {}),
        };
        expect(errorOf(() => loadConfig(env, "api", ["ledger"])).variables).toEqual(["WS_TELEMETRY"]);
      }
      const env = { ...base, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "otlp", ...otlpVars };
      expect(loadConfig(env, "worker", ["ledger"]).telemetry.mode).toBe("otlp");
      const off = { ...base, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off" };
      expect(loadConfig(off, "api", ["ledger"]).telemetry.mode).toBe("off");
    }
    // Elsewhere the default stays `test`.
    for (const environment of ["local", "ci", "preview-85"])
      expect(
        loadConfig({ ...base, WS_TELEMETRY_ENVIRONMENT: environment }, "api", ["ledger"]).telemetry.mode,
      ).toBe("test");
  });

  it("review of PR #85: an endpoint with a bare «?» or «#» is refused (the signal paths would land after it)", () => {
    for (const endpoint of [
      "https://otlp-gateway.example.eu/otlp?",
      "https://otlp-gateway.example.eu/otlp#",
    ]) {
      const env = {
        ...base,
        WS_TELEMETRY: "otlp",
        WS_OTLP_ENDPOINT: endpoint,
        WS_OTLP_AUTHORIZATION: "Basic c3ludGhldGljOnRva2VuLXZhbHVl",
      };
      expect(errorOf(() => loadConfig(env, "api", ["ledger"])).variables).toEqual(["WS_OTLP_ENDPOINT"]);
    }
  });

  it("criterion «старт із пропущеним обов'язковим секретом»: refuses to start, names the variable, not the value", () => {
    const env: Record<string, string> = { ...base };
    delete env["WS_DB_PASSWORD_LEDGER"];
    const error = errorOf(() => loadConfig(env, "worker", ["ledger", "bank-monobank"]));
    expect(error.variables).toEqual(["WS_DB_PASSWORD_LEDGER"]);
    expect(error.message).toBe("Configuration error: missing or invalid WS_DB_PASSWORD_LEDGER");
  });

  it("an invalid value is reported by name only: the value never appears in the error", () => {
    const weak = "short1";
    const error = errorOf(() =>
      loadConfig({ ...base, WS_DB_PASSWORD_LEDGER: weak, WS_PORT: "99999", WS_DB_SSL: "maybe" }, "api", [
        "ledger",
        "bank-monobank",
      ]),
    );
    expect(error.variables).toEqual(["WS_DB_PASSWORD_LEDGER", "WS_DB_SSL", "WS_PORT"]);
    const text = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
    for (const value of [weak, "99999", "maybe", secretA, "probe-secret-value-0001"])
      expect(text).not.toContain(value);
  });

  it("refuses an unknown role", () => {
    expect(errorOf(() => loadConfig(base, "cron", ["ledger", "bank-monobank"])).variables).toEqual([
      "--role (api | worker | scheduler)",
    ]);
  });

  it("ARC-03: the household-binding role ws_context needs its own password", () => {
    expect(loadConfig(base, "api", ["ledger", "bank-monobank"]).database.contextPassword).toBe(
      "context-secret-value-01",
    );
    const env: Record<string, string> = { ...base };
    delete env["WS_DB_CONTEXT_PASSWORD"];
    expect(errorOf(() => loadConfig(env, "api", ["ledger", "bank-monobank"])).variables).toEqual([
      "WS_DB_CONTEXT_PASSWORD",
    ]);
  });
});
