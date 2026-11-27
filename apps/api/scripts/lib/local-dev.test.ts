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
  ROLES,
  localFiles,
  releaseFlagKeys,
  requiredOperationalFlagKeys,
  roleEnv,
} from "./local-dev.ts";

const LINK_KEY = Buffer.alloc(32, 7).toString("base64");

describe("CICD-04 FR 1: pnpm local:dev — the whole app locally with one command", () => {
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
      files: { kind: "directory", dir: "/state/files" },
      fileLinkKey: LINK_KEY,
      kmsKeyFile: "/home/owner/.config/willowsum/local-kms-key.json",
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

  it("every role gets the same file storage and link key: the API stores an import's original, the worker parses it", () => {
    const S3 = {
      WS_LOCAL_S3_PORT: "8333",
      WS_LOCAL_S3_REGION: "eu-local-1",
      WS_LOCAL_S3_BUCKET: "willowsum-files",
      WS_LOCAL_S3_ACCESS_KEY: "WSLOCALSYNTHETIC",
      WS_LOCAL_S3_SECRET_KEY: "synthetic-secret-value",
    };
    const filesOf = (files: ReturnType<typeof localFiles>) =>
      ROLES.map((_role, i) =>
        Object.fromEntries(
          Object.entries(
            roleEnv({
              port: 41000 + i,
              databaseUrl: "postgres://u:p@127.0.0.1:5433/ws_dev",
              password: "pw",
              modules: ["identity"],
              path: "/bin",
              files,
              fileLinkKey: LINK_KEY,
              kmsKeyFile: "/home/owner/.config/willowsum/local-kms-key.json",
            }),
          ).filter(([k]) => /^WS_(S3_|FILE)/.test(k)),
        ),
      );
    // With the S3 of `pnpm local:up`: every role on it, with the same key of signed links.
    const s3 = filesOf(localFiles(S3, "/state"));
    expect(s3[0]).toEqual({
      WS_S3_ENDPOINT: "http://127.0.0.1:8333",
      WS_S3_REGION: "eu-local-1",
      WS_S3_BUCKET: "willowsum-files",
      WS_S3_ACCESS_KEY_ID: "WSLOCALSYNTHETIC",
      WS_S3_SECRET_ACCESS_KEY: "synthetic-secret-value",
      WS_FILE_LINK_KEY: LINK_KEY,
    });
    expect(s3[1]).toEqual(s3[0]);
    expect(s3[2]).toEqual(s3[0]);
    // Without Docker: one directory of the run for every role, never each process's memory.
    const dir = filesOf(localFiles({}, "/state"));
    expect(dir[0]).toEqual({ WS_FILES_DIR: "/state/files", WS_FILE_LINK_KEY: LINK_KEY });
    expect(dir[1]).toEqual(dir[0]);
    expect(dir[2]).toEqual(dir[0]);
    // Half of the S3 settings is a mistake, said by name.
    expect(() => localFiles({ WS_LOCAL_S3_PORT: "8333" }, "/state")).toThrow(/WS_LOCAL_S3_SECRET_KEY/);
    expect(() => localFiles({ ...S3, WS_LOCAL_S3_PORT: "x" }, "/state")).toThrow(/WS_LOCAL_S3_PORT/);
  });

  it("turns on the operational flags a release flag requires (household.core under household.space-settings: GET /v1/space)", () => {
    const keys = requiredOperationalFlagKeys(FLAGS);
    expect(keys).toContain("household.core");
    expect(keys.every((k) => FLAGS[k as keyof typeof FLAGS].kind !== "release")).toBe(true);
    expect(
      requiredOperationalFlagKeys({
        a: { kind: "release", requires: "b" },
        b: { kind: "release", requires: "c" },
        c: { kind: "operational" },
        d: { kind: "operational" },
      }),
    ).toEqual(["c"]);
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
