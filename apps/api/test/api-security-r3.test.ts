/**
 * Security coverage for ARC-07, round 3 (review of PR #80 at 54a3e2b): the first-segment guard against
 * forged tokens, every registration form, and handlers that are not routes (a prefixed not-found handler).
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { mountApi } from "../src/api.ts";
import { buildServer } from "../src/platform/process/server.ts";
import { fakeDatabases } from "./http.ts";

const server = () =>
  buildServer({
    readiness: async () => ({ ready: true }),
    api: (a) => mountApi(a, { databases: fakeDatabases().databases, entitlements: "all-enabled" }),
  });
const leak = async () => ({ leak: true });

describe("ARC-07 security: the /v1 guard, round 3", () => {
  it("a route that claims to be an API route by its own config is still refused (only the private token counts)", () => {
    for (const apiRoute of [true, "willowsum-api-route", Symbol("willowsum-api-route")]) {
      expect(() =>
        server().route({ method: "GET", url: "/v1/debug", config: { apiRoute } as never, handler: leak }),
      ).toThrow(/registerApi/);
    }
  });

  it.each([
    [
      "app.route with several methods",
      (a: ReturnType<typeof server>) =>
        a.route({ method: ["GET", "POST", "OPTIONS"], url: "/v1/debug", handler: leak }),
    ],
    ["app.all", (a: ReturnType<typeof server>) => a.all("/v1/debug", leak)],
    ["app.head", (a: ReturnType<typeof server>) => a.head("/v1/debug", async () => "")],
    ["app.options on a wildcard", (a: ReturnType<typeof server>) => a.options("/*", leak)],
    ["duplicate leading slashes", (a: ReturnType<typeof server>) => a.get("//v1/debug", leak)],
    ["a URL without a leading slash", (a: ReturnType<typeof server>) => a.get("v1/debug", leak)],
  ])("%s is refused", (_, register) => {
    expect(() => register(server())).toThrow(/registerApi/);
  });

  it("a plugin whose prefix is a parameter cannot add a route", async () => {
    const app = server();
    await expect(
      app.register(async (p) => void p.get("/debug", leak), { prefix: "/:tenant" }).ready(),
    ).rejects.toThrow(/registerApi/);
  });

  it("an encoded /v1 (/%76%31/…) reaches only the checked API routes", async () => {
    const app = server();
    app.get("/%76%31/debug", leak);
    await app.ready();
    for (const url of ["/v1/debug", "/%76%31/debug", "/v1/me/permissions", "/%76%31/me/permissions"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body, url).not.toContain("leak");
    }
    expect((await app.inject({ method: "GET", url: "/%76%31/me/permissions" })).statusCode).toBe(401);
  });

  // Fails at 54a3e2b: a not-found handler in a plugin prefixed /v1 answers every unmatched /v1 request
  // (all methods) without the checks. Suggested fix: an onRegister hook in guardApiRoutes that refuses a
  // plugin whose prefix mayServeApiPath.
  it("a plugin prefixed /v1 cannot install its own handler for /v1 requests (not-found handler)", async () => {
    const app = server();
    await expect(
      app.register(async (p) => void p.setNotFoundHandler(leak), { prefix: "/v1" }).ready(),
    ).rejects.toThrow(/registerApi/);
  });

  it("guardApiRoutes is installed on a bare app too", () => {
    const app = Fastify({ logger: false });
    mountApi(app, { databases: fakeDatabases().databases, entitlements: "all-enabled" });
    expect(() => app.get("/:any", leak)).toThrow(/registerApi/);
  });
});
