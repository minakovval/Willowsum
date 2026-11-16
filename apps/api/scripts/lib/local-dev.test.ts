import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { FLAGS } from "../../src/modules/feature-flags/index.ts";
import {
  DEV_DATABASE,
  LOCAL_DEV_PORTS,
  busyPortsMessage,
  isPortFree,
  makeStopper,
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

describe("CICD-04: stopping and busy ports", () => {
  it("watches the three role ports and the web port", () => {
    expect([...LOCAL_DEV_PORTS].sort()).toEqual([5173, 8080, 8081, 8082]);
  });

  it("a second stop waits for the first and returns only when it is done (a failed start never prints «running»)", async () => {
    const events: string[] = [];
    let finish!: () => void;
    const stop = makeStopper(async (code) => {
      events.push(`start ${code}`);
      await new Promise<void>((resolve) => (finish = resolve));
      events.push("done");
    });
    const first = stop(0);
    const second = stop(1).then(() => events.push("second returned"));
    await Promise.resolve();
    expect(events).toEqual(["start 0"]);
    finish();
    await Promise.all([first, second]);
    expect(events).toEqual(["start 0", "done", "second returned"]);
    expect(first).toBe(stop(2));
  });

  it("names every busy port in plain words and says nothing when all are free", async () => {
    expect(await busyPortsMessage([1, 2], async () => true)).toBe("");
    const message = await busyPortsMessage([8080, 5173, 8081], async (port) => port === 8081);
    expect(message).toMatch(/Port 8080 is in use by another program\. Close it/);
    expect(message).toMatch(/Port 5173 is in use/);
    expect(message).not.toMatch(/8081/);
  });

  it("detects a real listener", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    expect(await isPortFree(port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    expect(await isPortFree(port)).toBe(true);
  });
});
