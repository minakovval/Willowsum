import { selectImplementation, type ProviderImplementations, type ProviderMode } from "../port.ts";
import { httpMailSender, type HttpMailOptions } from "./http.ts";
import type { MailSender } from "./port.ts";
import { syntheticMailSender } from "./synthetic.ts";

export { checkMailMessage, MAIL_PORT } from "./port.ts";
export type { MailMessage, MailSender } from "./port.ts";
export { DEFAULT_MAIL_BASE_URL, httpMailSender } from "./http.ts";
export type { HttpMailOptions } from "./http.ts";
export { SYNTHETIC_OUTBOX_MAX, syntheticMailSender } from "./synthetic.ts";
export type { SyntheticMailSender } from "./synthetic.ts";

/** Both implementations of the port (ARC-05 FR 2). */
export const MAIL_IMPLEMENTATIONS: ProviderImplementations<MailSender, HttpMailOptions> = Object.freeze({
  test: syntheticMailSender,
  live: httpMailSender,
});

/** The implementation the configuration selects (`WS_PROVIDER_MODE`; `test` unless set to `live`). */
export function mailSender(mode: ProviderMode, liveOptions: () => HttpMailOptions): MailSender {
  return selectImplementation(mode, MAIL_IMPLEMENTATIONS, liveOptions);
}
