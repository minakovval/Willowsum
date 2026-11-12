import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/platform/process/server.ts";

/**
 * Security review of PR #89: the PoC «alive» check (ARC-09@PoC FR 5, CICD-07@PoC FR 5) calls production
 * `/health/ready` from GitHub Actions, so the probe must be reachable from the internet. Probes are never
 * rate-limited (NFR-14 test) and each one runs the readiness check (a query on the probe pool of one
 * connection and the flag refresh). The probe's body stays a closed set; concurrent probes share one check.
 */
const servers: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("security review PR #89: public readiness probe", () => {
  it("the probe body is a closed set: status and a fixed reason, never an error message", async () => {
    const server = buildServer({
      readiness: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432 user=ws_probe");
      },
    });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "not-ready", reason: "database-unreachable" });
    expect(response.body).not.toMatch(/10\.0\.0\.5|ECONNREFUSED|ws_probe/);
  });

  it("a burst of 50 concurrent public probes runs the readiness check once, not 50 times (no DB amplification)", async () => {
    let calls = 0;
    const server = buildServer({
      readiness: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ready: true };
      },
    });
    servers.push(server);
    const answers = await Promise.all(
      Array.from({ length: 50 }, () => server.inject({ method: "GET", url: "/health/ready" })),
    );
    expect(new Set(answers.map((a) => a.statusCode))).toEqual(new Set([200]));
    expect(calls).toBe(1);
  });
});
