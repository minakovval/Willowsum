import { describe, expect, it } from "vitest";
import { ConfigError, isTelemetryEndpoint, loadConfig } from "./config.ts";

/** Security review of PR #85 (ARC-09 FR 1, CICD-12): the OTLP endpoint and its secret. */
const secret = (tag: string) => ["synthetic", tag, "0123456789abcdef"].join("-");
const base = {
  WS_DB_HOST: "localhost",
  WS_DB_NAME: "willowsum",
  WS_DB_PROBE_PASSWORD: secret("probe"),
  WS_DB_CONTEXT_PASSWORD: secret("context"),
  WS_DB_PASSWORD_LEDGER: secret("ledger"),
};

describe("sec85: the OTLP endpoint", () => {
  it.each([
    "http://localhost.attacker.example/otlp",
    "http://127.0.0.1.nip.io/otlp",
    "http://0.0.0.0:4318",
    "http://[::ffff:7f00:1]:4318",
    "http://otlp-gateway.example.eu",
    "https://otlp-gateway.example.eu/otlp#token",
    "ftp://otlp-gateway.example.eu",
  ])("refuses %s", (endpoint) => expect(isTelemetryEndpoint(endpoint)).toBe(false));

  it.each([
    "https://otlp-gateway.example.eu/otlp",
    "http://localhost:4318",
    "http://127.0.0.1:4318",
    "http://[::1]:4318",
  ])("accepts %s", (endpoint) => expect(isTelemetryEndpoint(endpoint)).toBe(true));

  it("the authorization secret is never part of a configuration error, whatever else is wrong", () => {
    const authorization = `Basic ${Buffer.from(secret("otlp")).toString("base64")}`;
    for (const endpoint of ["http://collector.example.eu", "not a url", undefined]) {
      let error: unknown;
      try {
        loadConfig(
          {
            ...base,
            WS_TELEMETRY: "otlp",
            WS_OTLP_AUTHORIZATION: authorization,
            ...(endpoint ? { WS_OTLP_ENDPOINT: endpoint } : {}),
          },
          "api",
          ["ledger"],
        );
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigError);
      const shown = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
      expect(shown).not.toContain(authorization);
      expect(shown).not.toContain(secret("otlp"));
    }
  });

  it("without WS_TELEMETRY nothing is exported: the default is the in-memory test mode, even with OTLP variables set", () => {
    const config = loadConfig(
      { ...base, WS_OTLP_ENDPOINT: "https://otlp-gateway.example.eu", WS_OTLP_AUTHORIZATION: secret("otlp") },
      "api",
      ["ledger"],
    );
    expect(config.telemetry).toEqual({ mode: "test", environment: "local" });
  });
});
