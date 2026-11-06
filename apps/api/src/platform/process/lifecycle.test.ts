import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createLifecycle } from "./lifecycle.ts";
import { buildServer } from "./server.ts";

const ready = async () => ({ ready: true as const });

describe("ARC-02 FR 4: live and ready probes", () => {
  it("«живий» always answers; «готовий» reports the readiness check without details of the data", async () => {
    let state: { ready: true } | { ready: false; reason: string } = { ready: false, reason: "schema-behind" };
    const app = buildServer({ readiness: async () => state });
    expect((await app.inject("/health/live")).json()).toEqual({ status: "live" });
    const notReady = await app.inject("/health/ready");
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: "not-ready", reason: "schema-behind" });
    state = { ready: true };
    expect((await app.inject("/health/ready")).statusCode).toBe(200);
    await app.close();
  });

  it("«готовий» is 503 when the database cannot be reached, without the error text", async () => {
    const app = buildServer({
      readiness: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret");
      },
    });
    const res = await app.inject("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe(JSON.stringify({ status: "not-ready", reason: "database-unreachable" }));
    await app.close();
  });
});

describe("ARC-02 FR 5: graceful stop — the API finishes requests in flight", () => {
  it("a request in flight completes; new connections are refused after stop", async () => {
    const app = buildServer({ readiness: ready });
    app.get("/slow", async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { done: true };
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const lifecycle = createLifecycle(5_000);
    lifecycle.onStop(() => app.close());

    const inFlight = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 50));
    const outcome = lifecycle.stop();
    expect(await inFlight).toEqual({ done: true });
    expect(await outcome).toBe("clean");
    await expect(fetch(`http://127.0.0.1:${port}/health/live`)).rejects.toThrow();
  });

  it("stop gives up after the timeout and runs each hook once, last registered first", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle(100);
    lifecycle.onStop(async () => {
      order.push("first");
    });
    lifecycle.onStop(async () => {
      order.push("second");
      await new Promise((r) => setTimeout(r, 1_000));
    });
    const [a, b] = await Promise.all([lifecycle.stop(), lifecycle.stop()]);
    expect(a).toBe("timeout");
    expect(b).toBe("timeout");
    expect(order).toEqual(["second"]);
  });

  it("a failing hook does not stop the others", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle(1_000);
    lifecycle.onStop(async () => {
      order.push("db");
    });
    lifecycle.onStop(async () => {
      throw new Error("boom");
    });
    expect(await lifecycle.stop()).toBe("clean");
    expect(order).toEqual(["db"]);
  });
});
