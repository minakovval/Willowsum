import { defineProviderPort } from "../port.ts";

/**
 * Port of the CAPTCHA check (ARC-05, ADR-0005; ACC-01 FR 12; NFR-17: Cloudflare, named in the list of
 * processors). The browser widget gives the client a one-time token; the server asks the provider whether it
 * passed. Outgoing fields: the site secret and the token — nothing about the person (FR 5).
 */
export const CAPTCHA_PORT = defineProviderPort("captcha", {
  // A token is single use: repeating the check after a timeout would fail it, so no retries.
  verify: { idempotent: false, fields: ["secret", "response"], path: "siteverify" },
});

export interface CaptchaVerifier {
  /** Did this token pass? A missing, malformed, used or expired token is false. */
  verify(token: string): Promise<boolean>;
}

/** Tokens of the widget are at most 2 048 characters of printable ASCII. */
export const CAPTCHA_TOKEN_RE = /^[\x21-\x7e]{1,2048}$/;
