/**
 * Security coverage for ARC-07, PR #81 review: the onRegister guard refuses every plugin prefix that can
 * serve /v1 (not only the literal «/v1»), even when the plugin adds no route (a not-found or error handler).
 */
import { describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { testWiring } from "./http.ts";

const server = () =>
  buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => mountApi(a, testWiring()),
  });
const leak = async () => ({ leak: true });

describe("ARC-07 security: plugin prefixes that can serve /v1", () => {
  it.each(["/", "//", "/v1", "/V1", "/v1/", "//v1", "v1", "/:tenant", "/*", "/:v(^v1$)"])(
    "a plugin with prefix %s is refused even without routes (not-found handler)",
    async (prefix) => {
      const app = server();
      await expect(
        app.register(async (p) => void p.setNotFoundHandler(leak), { prefix }).ready(),
      ).rejects.toThrow(/Plugin prefix/);
    },
  );

  it("a plugin with prefix /v1 is refused for an error handler too, also when nested", async () => {
    await expect(
      server()
        .register(async (p) => void p.setErrorHandler(leak), { prefix: "/v1" })
        .ready(),
    ).rejects.toThrow(/Plugin prefix/);
    await expect(
      server()
        .register(async (outer) => {
          outer.register(async (p) => void p.setNotFoundHandler(leak), { prefix: "/v1" });
        })
        .ready(),
    ).rejects.toThrow(/Plugin prefix/);
  });

  it("literal prefixes that cannot serve /v1 stay allowed; their handlers never answer a /v1 request", async () => {
    const app = server();
    app.register(async (p) => void p.setNotFoundHandler(leak), { prefix: "/v10" });
    app.register(
      async (o) => {
        o.register(async (p) => void p.setNotFoundHandler(leak), { prefix: "/v1" });
      },
      { prefix: "/x" },
    );
    await app.ready();
    for (const url of ["/v1/unknown", "/v1/me/permissions/", "/v1//me/permissions", "/V1/unknown"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body, url).not.toContain("leak");
      expect(res.headers["content-type"], url).toMatch(/problem\+json/);
    }
  });
});
