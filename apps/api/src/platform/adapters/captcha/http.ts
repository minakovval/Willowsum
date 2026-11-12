import { z } from "zod";
import { createProviderHttp, type FetchFn } from "../http.ts";
import { createProviderClient, type ProviderClientOptions } from "../provider-client.ts";
import { CAPTCHA_PORT, CAPTCHA_TOKEN_RE, type CaptchaVerifier } from "./port.ts";

/**
 * Working implementation over HTTP, without a provider SDK (ADR-0005): Cloudflare Turnstile's server check
 * (NFR-14 names its widget domain, NFR-17 lists Cloudflare for CAPTCHA): `POST <baseUrl>/siteverify` with
 * `{ secret, response }` → `{ success }`. The client's address is not sent (minimum fields, FR 5).
 */
export interface HttpCaptchaOptions {
  /** Default `https://challenges.cloudflare.com/turnstile/v0`. */
  readonly baseUrl?: string;
  /** The site's secret key (secret `WS_CAPTCHA_SECRET`). */
  readonly secret: string;
  readonly fetch?: FetchFn;
  readonly clock?: ProviderClientOptions["clock"];
  readonly policy?: ProviderClientOptions["policy"];
}

export const DEFAULT_CAPTCHA_BASE_URL = "https://challenges.cloudflare.com/turnstile/v0";

const answer = z.object({ success: z.boolean() });

export function httpCaptchaVerifier(options: HttpCaptchaOptions): CaptchaVerifier {
  const client = createProviderClient({
    provider: "captcha:turnstile",
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const http = createProviderHttp({
    baseUrl: options.baseUrl ?? DEFAULT_CAPTCHA_BASE_URL,
    client,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async verify(token) {
      // A token that cannot be one is refused without a call.
      if (!CAPTCHA_TOKEN_RE.test(token)) return false;
      const result = await http.postJson(
        CAPTCHA_PORT.operations.verify,
        {},
        { secret: options.secret, response: token },
        (body) => answer.parse(body),
      );
      return result.success;
    },
  };
}
