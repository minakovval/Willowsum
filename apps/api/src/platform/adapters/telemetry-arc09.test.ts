import { SpanKind } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { exportedText, testTelemetryForFile } from "../telemetry/testing.ts";
import { ProviderError } from "./errors.ts";
import { createProviderHttp } from "./http.ts";
import { defineProviderPort } from "./port.ts";
import { createProviderClient } from "./provider-client.ts";
import { jsonResponse, recordingFetch } from "./testing.ts";

/**
 * NFR-10 FR 3 (ADR-0006): calls to external providers and their failures are traced and logged without the
 * URL, the query parameters or the keys — only the adapter, the operation, the attempts and the outcome.
 */
const telemetry = testTelemetryForFile();

const PORT = defineProviderPort("geocoding", {
  lookup: { idempotent: true, fields: ["query", "country"], path: "search/{country}" },
});
// A distinctive, low-entropy synthetic value: it only has to be recognisable if it leaked.
const HEADER_VALUE = "synthetic-synthetic-synthetic";
const ADDRESS = "вул. Хрещатик, 22, кв. 7, Київ";

function geocoder(answer: () => Response) {
  const recorder = recordingFetch(answer);
  const client = createProviderClient({
    provider: "geocoding:http",
    random: () => 0,
    policy: { retry: { baseDelayMs: 1, maxDelayMs: 1 } },
  });
  const http = createProviderHttp({
    baseUrl: "https://geo.example/api/v2",
    client,
    fetch: recorder.fetch,
    headers: { "x-api-key": HEADER_VALUE },
  });
  return { recorder, http };
}

describe("NFR-10 FR 3: provider calls in telemetry without URL, parameters or keys", () => {
  it("a successful call: one client span and one count with the adapter, operation and outcome only", async () => {
    const { http, recorder } = geocoder(() => jsonResponse({ lat: "50.45010", lon: "30.52340" }));
    await http.getJson(PORT.operations.lookup, { query: ADDRESS, country: "ua" });
    expect(recorder.requests[0]!.url).toContain("search/ua?query=");
    const [span] = telemetry.memory.finishedSpans();
    expect(span!.kind).toBe(SpanKind.CLIENT);
    expect(span!.name).toBe("provider geocoding.lookup");
    expect(span!.attributes).toEqual({
      "ws.provider": "geocoding:http",
      "ws.provider.operation": "geocoding.lookup",
      "ws.provider.outcome": "ok",
      "ws.provider.attempts": 1,
    });
    const text = await exportedText(telemetry);
    for (const secret of [
      HEADER_VALUE,
      "Хрещатик",
      "geo.example",
      "search/ua",
      "query=",
      "50.45010",
      "30.52340",
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain("ws.provider.calls");
  });

  it("a failing call: the log event provider.failure has the kind and the HTTP status, never the request", async () => {
    const { http } = geocoder(() => jsonResponse({ error: `no match for ${ADDRESS}` }, 503));
    await expect(
      http.getJson(PORT.operations.lookup, { query: ADDRESS, country: "ua" }),
    ).rejects.toBeInstanceOf(ProviderError);
    const [span] = telemetry.memory.finishedSpans();
    expect(span!.attributes).toMatchObject({
      "ws.provider.outcome": "unavailable",
      "ws.provider.attempts": 3,
    });
    const [record] = telemetry.memory.logRecords();
    expect(record!.body).toBe("provider.failure");
    expect(record!.attributes).toEqual({
      "ws.provider": "geocoding:http",
      "ws.provider.operation": "geocoding.lookup",
      "ws.provider.outcome": "unavailable",
      "http.response.status_code": 503,
    });
    const text = await exportedText(telemetry);
    for (const secret of [HEADER_VALUE, "Хрещатик", "no match", "geo.example", "query="])
      expect(text).not.toContain(secret);
  });

  it("a transport failure is logged by the class of the error, not by its message (which may hold the URL)", async () => {
    const { http } = geocoder(() => {
      throw new TypeError(
        `fetch failed: https://geo.example/api/v2/search/ua?query=${ADDRESS}&key=${HEADER_VALUE}`,
      );
    });
    await expect(http.getJson(PORT.operations.lookup, { query: ADDRESS, country: "ua" })).rejects.toThrow();
    const records = telemetry.memory.logRecords();
    expect(records.map((r) => r.attributes["error.type"])).toEqual(["TypeError"]);
    const text = await exportedText(telemetry);
    for (const secret of [HEADER_VALUE, "Хрещатик", "fetch failed", "geo.example"])
      expect(text).not.toContain(secret);
  });
});
