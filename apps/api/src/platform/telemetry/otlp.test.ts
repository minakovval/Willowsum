import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { logs, metrics, trace } from "@opentelemetry/api";
import { Rng } from "@willowsum/synthetic";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PII_KINDS, piiFragments, piiValue } from "./pii.test-helper.ts";
import { startTelemetry, TELEMETRY_SCOPE } from "./telemetry.ts";

/**
 * ARC-09 FR 1: the `otlp` mode sends traces, metrics and logs over OTLP/HTTP to the configured endpoint
 * with the configured Authorization header — the only Grafana Cloud specific part, and configuration only.
 * The collector here is a stand-in on this machine (tests never reach the network, ARC-05).
 */
interface Received {
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let server: Server;
let endpoint: string;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = request.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
      received.push({ path: request.url ?? "", headers: request.headers, body: body.toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/otlp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("ARC-09 FR 1: OTLP/HTTP exporter chosen by configuration only", () => {
  it("sends the three signals to <endpoint>/v1/{traces,metrics,logs} with the Authorization header, redacted", async () => {
    const authorization = "Basic c3ludGhldGljLWluc3RhbmNlOnN5bnRoZXRpYy10b2tlbg==";
    const telemetry = startTelemetry({
      mode: "otlp",
      role: "worker",
      environment: "ci",
      otlp: { endpoint, authorization },
      metricIntervalMs: 60_000,
    });
    const rng = new Rng("arc09-otlp");
    const planted = PII_KINDS.map((kind) => piiValue(rng, kind));
    const span = trace.getTracer(TELEMETRY_SCOPE).startSpan(`GET /v1/${planted[0]}`, {
      attributes: {
        "http.route": "/v1/things/:thingId",
        "url.full": planted[14]!,
        "user.email": planted[0]!,
      },
    });
    span.end();
    logs
      .getLogger(TELEMETRY_SCOPE)
      .emit({ body: `failed for ${planted[9]}`, attributes: { amount: planted[2]! } });
    metrics.getMeter(TELEMETRY_SCOPE).createCounter("ws.test.items").add(1, { iban: planted[3]! });
    await telemetry.forceFlush();
    await telemetry.shutdown();

    const paths = new Set(received.map((r) => r.path));
    expect(paths).toEqual(new Set(["/otlp/v1/traces", "/otlp/v1/metrics", "/otlp/v1/logs"]));
    for (const r of received) expect(r.headers.authorization).toBe(authorization);
    const everything = received.map((r) => r.body).join("\n");
    expect(everything).toContain("/v1/things/:thingId");
    expect(everything).toContain("ws.test.items");
    for (const value of planted)
      for (const fragment of piiFragments(value)) expect(everything).not.toContain(fragment);
    // The secret header is never part of what is exported.
    expect(everything).not.toContain(authorization);
  });
});
