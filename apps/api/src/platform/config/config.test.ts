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
