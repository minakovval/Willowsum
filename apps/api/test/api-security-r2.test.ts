/**
 * Security coverage for ARC-07, round 2 (review of PR #80 at d6da215): a route that is not literally under
 * /v1 but still matches /v1 requests (wildcard or parametric first segment) must be refused too.
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { apiOptions, mountApi } from "../src/api.ts";
import { guardApiRoutes, registerApi } from "../src/platform/http/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { testWiring } from "./http.ts";

const server = () =>
  buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => mountApi(a, testWiring()),
  });

describe("ARC-07 security: no raw route can answer a /v1 request", () => {
  it.each(["/v1*", "/V1*", "/v*", "/*", "*", "/:version/debug", "/:version", "/:v(^v1$)/x"])(
    "%s is refused when it is registered, before and after the mount",
    async (url) => {
      const before = Fastify({ logger: false });
      guardApiRoutes(before);
      expect(() => before.get(url, async () => ({ leak: true }))).toThrow(/registerApi/);
      const after = server();
      expect(() => after.get(url, async () => ({ leak: true }))).toThrow(/registerApi/);
    },
  );

  it("registerApi guards an app it did not build (no buildServer): a raw /v1 route after the mount is refused", () => {
    const app = Fastify({ logger: false });
    registerApi(app, apiOptions(testWiring()));
    expect(() => app.get("/v1/debug/households", async () => ({ leak: true }))).toThrow(/registerApi/);
  });

  it("a plugin prefixed /v1 cannot add a route either", async () => {
    const app = server();
    await expect(
      app
        .register(
          async (p) => {
            p.get("/debug", async () => ({ leak: true }));
          },
          { prefix: "/v1" },
        )
        .ready(),
    ).rejects.toThrow(/registerApi/);
  });

  it("the probes and other literal non-/v1 routes are still allowed", async () => {
    const app = server();
    app.get("/v10-not-api", async () => ({ ok: true }));
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/meta" })).statusCode).toBe(200);
  });
});
