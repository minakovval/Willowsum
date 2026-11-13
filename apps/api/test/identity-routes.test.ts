import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { apiOptions, apiRoutes } from "../src/api.ts";
import { registerApi } from "../src/platform/http/api.ts";
import { isPublic } from "../src/platform/http/route.ts";
import { fakeFlags, testWiring } from "./http.ts";
import { identityModule } from "../src/modules/identity/index.ts";

/**
 * Identity's public routes (ACC-01, ADR-0009) on the API pipeline without a database: behind the identity kill
 * switch and the flag `identity.sign-in` (evaluated for everyone), before their body is read.
 */
const routes = identityModule.routes ?? [];

async function serve(options: { killed?: string[]; flagOn?: boolean } = {}) {
  const flags = {
    ...fakeFlags({ killed: options.killed ?? [] }),
    isEnabledForAll: async () => options.flagOn ?? true,
  };
  const app = Fastify({ logger: false });
  registerApi(app, apiOptions({ ...testWiring(flags), flags }));
  await app.ready();
  return app;
}

describe("identity routes are public routes of the module, each behind identity.sign-in", () => {
  it("all twelve are public, owned by identity and name the flag", () => {
    expect(routes.map((r) => r.operationId)).toEqual([
      "signUp",
      "resendRegistrationEmail",
      "changeRegistrationEmail",
      "confirmEmail",
      "resendConfirmationEmail",
      "signIn",
      "getSession",
      "refreshSession",
      "signOut",
      "requestPasswordReset",
      "checkPasswordReset",
      "completePasswordReset",
    ]);
    for (const r of routes) {
      expect(r.module).toBe("identity");
      expect(isPublic(r.access) && r.access.flag).toBe("identity.sign-in");
    }
  });

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: kill switch of identity → 503 MODULE_UNAVAILABLE, whatever the body",
    async (_, route) => {
      const app = await serve({ killed: ["identity"] });
      const res = await app.inject({ method: route.method, url: route.path, payload: "{oops" });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("MODULE_UNAVAILABLE");
    },
  );

  it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "%s: flag off for everyone → the same 404 as an unknown path, whatever the body",
    async (_, route) => {
      const app = await serve({ flagOn: false });
      const res = await app.inject({ method: route.method, url: route.path, payload: "{oops" });
      const unknown = await app.inject({ method: route.method, url: "/v1/nothing-here" });
      expect(res.statusCode).toBe(404);
      expect(res.body.replace(/"supportId":"[0-9a-f]+",?/, "")).toBe(
        unknown.body.replace(/"supportId":"[0-9a-f]+",?/, ""),
      );
    },
  );

  it("without the identity services wired, nothing of identity runs (500, never an answer from defaults)", async () => {
    const app = await serve();
    const res = await app.inject({
      method: "POST",
      url: "/v1/email-confirmations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ token: "A".repeat(43) }),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("INTERNAL");
  });
});

describe("ACC-01 AC10, AC15, FR 1, FR 2: only email and password — no Google, Apple or sign-in link", () => {
  it("the API has no route for another way to sign up or sign in", () => {
    const text = JSON.stringify(apiRoutes.map((r) => [r.path, r.operationId, r.summary]));
    expect(text).not.toMatch(/google|apple|oauth|magic|passkey|otp|link-sign-in/i);
    const signIn = routes.find((r) => r.operationId === "signIn")!;
    const body = signIn.request!.body as unknown as { shape: Record<string, unknown> };
    expect(Object.keys(body.shape).sort()).toEqual(["captchaToken", "email", "password"]);
  });
});
