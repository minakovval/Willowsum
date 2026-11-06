import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFlagRuntime, LOAD_WAIT_MS } from "../src/modules/feature-flags/application/index.ts";
import { memoryFlagStore } from "../src/modules/feature-flags/application/memory-store.test-helper.ts";
import { assertRoutes } from "../src/platform/http/api.ts";
import { buildOpenApi } from "../src/platform/http/openapi.ts";
import { defineRoute, type ApiRoute } from "../src/platform/http/route.ts";
import { principalHeader, testApp } from "./http.ts";

/**
 * Security review, round 2 (PR #82 at fa5d9cb): the checks moved to onRequest, the stale-state bound and the
 * two-flag rule. Each test kills a mutant (or a defect) the PR's tests let through, named in the test.
 */

const createThing = defineRoute({
  module: "things",
  method: "POST",
  path: "/v1/things",
  operationId: "createThingR2",
  summary: "x",
  access: { permission: "things.write", feature: "things" },
  request: { body: z.object({ name: z.string() }) },
  response: { status: 201, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

const exportThings = defineRoute({
  module: "things",
  method: "GET",
  path: "/v1/things/export",
  operationId: "exportThingsR2",
  summary: "x",
  access: { permission: "things.read", feature: "things", flag: "things.export" },
  response: { status: 200, description: "x", schema: z.object({ ok: z.boolean() }) },
  handler: async () => ({ ok: true }),
});

/** Everything a client sees of a response except the clock. */
function visible(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
  const headers = { ...res.headers };
  delete headers["date"];
  return { status: res.statusCode, headers, body: res.body };
}

const bodies = [
  ["valid JSON", "application/json", JSON.stringify({ name: "a" })],
  ["malformed JSON", "application/json", "{"],
  ["empty JSON body", "application/json", ""],
  ["oversized JSON", "application/json", JSON.stringify({ name: "x".repeat(2_000_000) })],
  ["text/plain", "text/plain", "not json"],
  ["application/xml", "application/xml", "<a/>"],
] as const;

describe("DAT-05 FR 7: with any body, a hidden function answers exactly as a path that does not exist", () => {
  // Defect at fa5d9cb: the hidden route answers 404 before the body is read, but an unknown path still parses it
  // (400 MALFORMED_REQUEST / 413, `connection: close`). The PR's test compares with a bodyless unknown request.
  it.each(bodies)(
    "%s: the flag-off route and an unknown path give the same status, headers and body",
    async (_, type, payload) => {
      const app = await testApp([createThing], { checkFlag: async () => false });
      const send = (url: string) =>
        app.inject({ method: "POST", url, headers: { ...principalHeader(), "content-type": type }, payload });
      expect(visible(await send("/v1/things"))).toEqual(visible(await send("/v1/no-such-function")));
    },
  );
});

describe("CICD-06: a route with its own flag needs its feature's flag to exist too", () => {
  // Mutant: assertRoutes checks only the last of routeFlags (the route's own flag).
  it("a feature whose flag is unknown is refused at start, even when the route's own flag is known", () => {
    expect(() =>
      assertRoutes([exportThings as ApiRoute], {
        permissions: new Set(["things.read"]),
        features: new Set(["things"]),
        flags: new Set(["things.export"]),
      }),
    ).toThrow(/unknown flag things \(feature-flags\)/);
  });

  // Mutant: the contract lists only the most specific flag.
  it("the contract lists both flags of the route, the feature's first", () => {
    const doc = buildOpenApi([exportThings as ApiRoute]) as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(doc.paths["/v1/things/export"]!["get"]!["x-willowsum-access"]).toMatchObject({
      flags: ["things", "things.export"],
    });
  });
});

describe("CICD-06: a request waits for a hanging reload no longer than the documented 2 s", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Mutant: LOAD_WAIT_MS = 30_000 — the PR's test advances by LOAD_WAIT_MS itself.
  it("LOAD_WAIT_MS is 2 s, and a request answers from the state in force 2 s into a hanging reload", async () => {
    expect(LOAD_WAIT_MS).toBe(2_000);
    vi.useFakeTimers({ now: 0 });
    const store = memoryFlagStore();
    const load = store.snapshot.bind(store);
    const runtime = createFlagRuntime(store);
    expect(await runtime.isModuleAvailable("audit")).toBe(true);
    store.snapshot = () => new Promise(() => undefined);
    vi.setSystemTime(15_000);
    let answered: boolean | undefined;
    void runtime.isModuleAvailable("audit").then((a) => (answered = a));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(answered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toBe(true);
    store.snapshot = load;
  });
});
