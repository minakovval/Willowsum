import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseSignUpAllowlist } from "./config.ts";

/**
 * ACC-01@PoC FR 16 (#107): sign-up is open only to the family's addresses, a list the product owner keeps in the
 * server's configuration (`WS_SIGNUP_ALLOWLIST`, from the secret store; never in the repository, no screen). It is
 * optional locally and in CI (every address may sign up there) and required for the api role in staging and
 * production: without it the process does not start. Neither the list nor any address in it is ever echoed by a
 * configuration error. All addresses are synthetic.
 */
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
const LIST = "olena.synthetic@example.test, Taras.Synthetic@Example.TEST";

function failureOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("ACC-01 FR 16: WS_SIGNUP_ALLOWLIST — the family's addresses, required where the API is public", () => {
  for (const environment of ["staging", "production"]) {
    const deployed = { ...base, ...live, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off" };

    it(`${environment}: the api role refuses to start without the list; the error names the variable only`, () => {
      expect(failureOf(() => loadConfig(deployed, "api", ["identity"])).variables).toEqual([
        "WS_SIGNUP_ALLOWLIST",
      ]);
      // Set but empty (only separators) is the same as missing: no address could ever sign up by mistake of format.
      for (const empty of ["", " ", ",", " , \n"])
        expect(
          failureOf(() => loadConfig({ ...deployed, WS_SIGNUP_ALLOWLIST: empty }, "api", ["identity"]))
            .variables,
        ).toEqual(["WS_SIGNUP_ALLOWLIST"]);
    });

    it(`${environment}: with the list it starts; the addresses are normalised (trimmed, lower case)`, () => {
      const config = loadConfig({ ...deployed, WS_SIGNUP_ALLOWLIST: LIST }, "api", ["identity"]);
      expect([...config.identity.signUpAllowlist!].sort()).toEqual([
        "olena.synthetic@example.test",
        "taras.synthetic@example.test",
      ]);
    });

    it(`${environment}: the worker and scheduler roles do not need it`, () => {
      for (const role of ["worker", "scheduler"])
        expect(() =>
          loadConfig({ ...base, WS_TELEMETRY_ENVIRONMENT: environment, WS_TELEMETRY: "off" }, role, [
            "identity",
          ]),
        ).not.toThrow();
    });
  }

  it("locally and in CI it is optional: without it every address may sign up (no list in the configuration)", () => {
    expect(loadConfig(base, "api", ["identity"]).identity.signUpAllowlist).toBeUndefined();
    const config = loadConfig({ ...base, WS_SIGNUP_ALLOWLIST: LIST }, "api", ["identity"]);
    expect(config.identity.signUpAllowlist?.size).toBe(2);
  });

  it("an invalid entry stops the start; neither the entry nor any listed address is in the error", () => {
    for (const bad of [
      "olena.synthetic@example.test, not-an-address",
      "olena.synthetic@example.test;taras.synthetic@example.test",
      "олена@example.test",
      "olena.synthetic@example.test, a@b@example.test",
      `${"x".repeat(250)}@example.test`,
    ]) {
      const error = failureOf(() => loadConfig({ ...base, WS_SIGNUP_ALLOWLIST: bad }, "api", ["identity"]));
      expect(error.variables).toEqual(["WS_SIGNUP_ALLOWLIST"]);
      expect(error.message).not.toContain("olena");
      expect(error.message).not.toContain("example.test");
    }
  });
});

describe("ACC-01 FR 16: the format of the list", () => {
  it("commas, spaces and line breaks separate; duplicates and case collapse; whitespace at the ends is dropped", () => {
    expect([
      ...parseSignUpAllowlist(
        "  Olena@Example.test ,\n olena@example.TEST,taras@example.test\tdmytro@example.test,",
      )!,
    ]).toEqual(["olena@example.test", "taras@example.test", "dmytro@example.test"]);
  });

  it("nothing to list, or any entry that is not one plain ASCII address → no list", () => {
    for (const bad of ["", " , ", "olena", "@example.test", "olena@", "olena@example.test;x@example.test"])
      expect(parseSignUpAllowlist(bad), bad).toBeUndefined();
  });
});
