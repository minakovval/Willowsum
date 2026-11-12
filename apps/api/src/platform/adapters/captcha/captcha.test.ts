import { describe, expect, it } from "vitest";
import type { ProviderError } from "../errors.ts";
import { outgoingFieldViolations } from "../outgoing.ts";
import { jsonResponse, recordingFetch } from "../testing.ts";
import {
  CAPTCHA_IMPLEMENTATIONS,
  CAPTCHA_PORT,
  captchaVerifier,
  httpCaptchaVerifier,
  SYNTHETIC_CAPTCHA_PASS,
  syntheticCaptchaVerifier,
} from "./index.ts";

/** ARC-05: the CAPTCHA port (ACC-01 FR 12; NFR-14 and NFR-17: Cloudflare Turnstile). */
const SITE = ["site", "synthetic", "value"].join("-"); // built at run time: not a key-shaped literal

function live(answer: (r: Request) => Response | Promise<Response>) {
  const recorder = recordingFetch(answer);
  const verifier = httpCaptchaVerifier({
    baseUrl: "https://captcha.test/v0",
    secret: SITE,
    fetch: recorder.fetch,
  });
  return { recorder, verifier };
}

describe("ARC-05 port «captcha»", () => {
  it("FR 2: ships both implementations; the synthetic one passes only its fixed token", async () => {
    expect(typeof CAPTCHA_IMPLEMENTATIONS.live).toBe("function");
    const synthetic = syntheticCaptchaVerifier();
    expect(await synthetic.verify(SYNTHETIC_CAPTCHA_PASS)).toBe(true);
    expect(await synthetic.verify("anything-else")).toBe(false);
    expect(await synthetic.verify("")).toBe(false);
    const chosen = captchaVerifier("test", () => {
      throw new Error("live options are not read in test mode");
    });
    expect(await chosen.verify(SYNTHETIC_CAPTCHA_PASS)).toBe(true);
  });

  it("the live adapter POSTs {secret, response} to /siteverify — not the client's address — and reads success", async () => {
    const { recorder, verifier } = live(() => jsonResponse({ success: true, hostname: "app.example.test" }));
    expect(await verifier.verify("widget-token")).toBe(true);
    const request = recorder.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://captcha.test/v0/siteverify");
    expect(await request.clone().json()).toEqual({ secret: SITE, response: "widget-token" });
    expect(await outgoingFieldViolations(CAPTCHA_PORT.operations.verify, recorder.requests)).toEqual([]);
    const failed = live(() => jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await failed.verifier.verify("widget-token")).toBe(false);
  });

  it("a token that cannot be one is refused without a call; a broken answer or an outage is a provider error", async () => {
    const { recorder, verifier } = live(() => jsonResponse({ success: true }));
    expect(await verifier.verify("")).toBe(false);
    expect(await verifier.verify("x".repeat(2049))).toBe(false);
    expect(recorder.requests).toHaveLength(0);
    const broken = live(() => jsonResponse({ ok: 1 }));
    expect(((await broken.verifier.verify("t").catch((e: unknown) => e)) as ProviderError).kind).toBe(
      "invalid-response",
    );
    const down = live(() => new Response("", { status: 502 }));
    expect(((await down.verifier.verify("t").catch((e: unknown) => e)) as ProviderError).kind).toBe(
      "unavailable",
    );
    expect(down.recorder.requests).toHaveLength(1);
  });
});
