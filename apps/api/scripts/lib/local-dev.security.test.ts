import { describe, expect, it } from "vitest";
import {
  ROLES,
  assertLocalServer,
  confirmationLink,
  parseLocalDevArgs,
  roleEnv,
  webEnv,
} from "./local-dev.ts";

const PW = "0123456789abcdef0123456789abcdef0123456789abcdef";
const ADMIN = "postgres://admin:supersecret@127.0.0.1:5432/ws_dev";

describe("CICD-04 security: pnpm local:dev role processes", () => {
  it.each(ROLES)(
    "%s: the run's password sits only under *_PASSWORD variables, no superuser credential",
    (role) => {
      const env = roleEnv({
        role,
        databaseUrl: ADMIN,
        password: PW,
        modules: ["identity", "household"],
        path: "/bin",
      });
      for (const [k, v] of Object.entries(env)) {
        if (v.includes(PW)) expect(k).toMatch(/^WS_DB_[A-Z_]*PASSWORD[A-Z_]*$/);
        expect(v).not.toContain("supersecret");
        expect(v).not.toContain("admin");
      }
      expect(Object.keys(env).some((k) => /DATABASE_URL|PGPASSWORD|PGUSER/.test(k))).toBe(false);
      expect(env["WS_PROVIDER_MODE"]).toBe("test");
      expect(env["WS_TELEMETRY"]).toBe("test");
      expect(env["WS_TELEMETRY_ENVIRONMENT"]).toBe("local");
    },
  );

  it("takes no option that could point it at another environment", () => {
    for (const a of ["--prod", "--database-url=x", "--host", "fresh", "--fresh=1"])
      expect(() => parseLocalDevArgs([a])).toThrow();
  });

  it("the token cannot add parameters or fragments to the printed link", () => {
    const link = new URL(confirmationLink("x&token=evil#y"));
    const q = new URLSearchParams(link.hash.split("?")[1]);
    expect(q.getAll("token")).toEqual(["x&token=evil#y"]);
    expect(link.origin).toBe("http://localhost:5173");
  });
});

describe("CICD-04 security: pnpm local:dev touches only a local server", () => {
  it("refuses a database server that is not on this machine", async () => {
    const lib = (await import("./local-dev.ts")) as Record<string, unknown>;
    const assertLocal = lib["assertLocalServer"] as ((u: string) => void) | undefined;
    expect(assertLocal).toBeTypeOf("function");
    for (const ok of [
      "postgres://postgres@127.0.0.1:5432/postgres",
      "postgres://u:p@localhost:5433/x",
      "postgres://u@[::1]/x",
    ])
      expect(() => assertLocal!(ok)).not.toThrow();
    for (const bad of [
      "postgres://u:p@db.example.com:5432/postgres",
      "postgres://u:p@10.0.0.5/postgres",
      "postgres://u:p@0.0.0.0/x",
    ])
      expect(() => assertLocal!(bad)).toThrow(/not a local/);
  });
});

describe("CICD-04 security: the guard looks at where pg really connects", () => {
  it("rejects a host or hostaddr query that overrides the authority, and unsafe socket forms", () => {
    for (const bad of [
      "postgres://u:p@127.0.0.1/x?host=evil.example.com",
      "postgres://u:p@127.0.0.1/x?hostaddr=10.0.0.5",
      "postgres://u@localhost/x?host=/tmp",
      "postgres:///x?host=evil.example.com",
      "postgres:///x?host=/tmp,evil",
      "postgres:///x?host=/tmp&hostaddr=10.0.0.5",
      "postgres:///x",
      "postgres:///x?host=/tmp&host=evil.example.com",
      "postgres:///x?host=evil.example.com&host=/tmp",
      " postgres://127.0.0.1/x",
      "postgres://127.0.0.1/x ",
    ])
      expect(() => assertLocalServer(bad), bad).toThrow(/not a local/);
  });

  it("accepts a Unix socket directory", () => {
    expect(() => assertLocalServer("postgres:///x?host=/tmp")).not.toThrow();
    expect(() => assertLocalServer("postgres:///x?host=/var/run/postgresql")).not.toThrow();
  });

  it("the web process gets only PATH, HOME and the API origin", () => {
    const env = webEnv({
      PATH: "/bin",
      HOME: "/h",
      DATABASE_URL: "postgres://a:b@x/y",
      WS_DB_PASSWORD: "s",
      AWS_SECRET: "z",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", WS_API_ORIGIN: "http://127.0.0.1:8080" });
  });
});
