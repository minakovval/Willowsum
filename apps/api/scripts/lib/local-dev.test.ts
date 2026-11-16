import { describe, expect, it } from "vitest";
import { FLAGS } from "../../src/modules/feature-flags/index.ts";
import {
  DEV_DATABASE,
  ROLE_PORTS,
  confirmationLink,
  databaseUrlFor,
  parseLocalDevArgs,
  parsePrompt,
  releaseFlagKeys,
  roleEnv,
} from "./local-dev.ts";

describe("CICD-04: pnpm local:dev — the whole app locally with one command", () => {
  it("takes only --fresh", () => {
    expect(parseLocalDevArgs([])).toEqual({ fresh: false });
    expect(parseLocalDevArgs(["--fresh"])).toEqual({ fresh: true });
    expect(() => parseLocalDevArgs(["--prod"])).toThrow(/unknown option/);
  });

  it("uses its own persistent database on the same server", () => {
    expect(databaseUrlFor("postgres://u:p@127.0.0.1:5432/willowsum", DEV_DATABASE)).toBe(
      "postgres://u:p@127.0.0.1:5432/ws_dev",
    );
  });

  it("gives each role its own port and only synthetic providers and in-process telemetry", () => {
    const env = roleEnv({
      role: "worker",
      databaseUrl: "postgres://u:p@127.0.0.1:5433/ws_dev",
      password: "pw",
      modules: ["identity", "feature-flags"],
      path: "/bin",
    });
    expect(env).toMatchObject({
      WS_PORT: String(ROLE_PORTS.worker),
      WS_DB_HOST: "127.0.0.1",
      WS_DB_PORT: "5433",
      WS_DB_NAME: "ws_dev",
      WS_DB_SSL: "false",
      WS_DB_PASSWORD_IDENTITY: "pw",
      WS_DB_PASSWORD_FEATURE_FLAGS: "pw",
      WS_PROVIDER_MODE: "test",
      WS_TELEMETRY: "test",
      WS_TELEMETRY_ENVIRONMENT: "local",
      WS_ALLOWED_ORIGINS: "http://localhost:5173",
      WS_WEB_ORIGIN: "http://localhost:5173",
    });
    expect(new Set(Object.values(ROLE_PORTS)).size).toBe(3);
    // The superuser's credentials never reach a role process.
    expect(JSON.stringify(env)).not.toContain("u:p");
    expect(env).not.toHaveProperty("DATABASE_URL");
  });

  it("turns on every release flag and no operational one", () => {
    const keys = releaseFlagKeys(FLAGS);
    expect(keys).toContain("identity.sign-in");
    expect(keys).not.toContain("household.core");
    expect(keys.every((k) => FLAGS[k as keyof typeof FLAGS].kind === "release")).toBe(true);
  });

  it("prints the confirmation link in the letter's format and reads the prompt", () => {
    expect(confirmationLink("a/b")).toBe("http://localhost:5173/#/verify?token=a%2Fb");
    expect(parsePrompt("  anna@example.com ")).toEqual({ kind: "confirm", email: "anna@example.com" });
    expect(parsePrompt("limits")).toEqual({ kind: "limits" });
    expect(parsePrompt("   ")).toEqual({ kind: "none" });
  });
});
