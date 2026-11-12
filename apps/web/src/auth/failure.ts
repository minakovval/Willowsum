import type { MessageKey } from "@willowsum/i18n";
import { isUnavailable, type Outcome } from "./api.ts";

/** An error shown in the card: the message and the support code of the request (ARC-09 FR 3), if any. */
export interface Failure {
  readonly key: MessageKey;
  readonly code?: string | undefined;
}

/**
 * The common texts of a failed request (ACC-01@PoC «Стани інтерфейсу», AC12): no connection; too many attempts; the
 * function hidden by its flag (404 as an unknown path) or switched off (503) — said plainly, nothing breaks; and
 * anything else. Screens handle their own codes (wrong password, lockout, CAPTCHA) before this.
 */
export function failureOf(o: Exclude<Outcome<unknown>, { ok: true }>): Failure {
  if (o.kind === "network") return { key: "auth.error.network" };
  if (isUnavailable(o)) return { key: "auth.error.unavailable", code: o.supportId };
  if (o.problem.code === "RATE_LIMITED") return { key: "auth.error.tooMany", code: o.supportId };
  if (o.problem.code === "CAPTCHA_REQUIRED") return { key: "auth.error.captcha", code: o.supportId };
  return { key: "auth.error.generic", code: o.supportId };
}
