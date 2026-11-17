import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { FLAGS } from "../../src/modules/feature-flags/index.ts";
import {
  DEV_DATABASE,
  WEB_PORT,
  busyPortsMessage,
  isPortFree,
  makeStopper,
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
      port: 41001,
      databaseUrl: "postgres://u:p@127.0.0.1:5433/ws_dev",
      password: "pw",
      modules: ["identity", "feature-flags"],
      path: "/bin",
    });
    expect(env).toMatchObject({
      WS_PORT: "41001",
      WS_HOST: "127.0.0.1",
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
    expect(await busyPortsMessage(undefined, async (port) => port !== WEB_PORT)).toMatch(
      /Порт 5173 зайнятий/,
    );
    const message = await busyPortsMessage([5174, 5173, 5175], async (port) => port === 5175);
    expect(message).toMatch(/Порт 5174 зайнятий іншою програмою\. Закрийте її/);
    expect(message).toMatch(/Порт 5173 зайнятий/);
    expect(message).not.toMatch(/5175/);
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
