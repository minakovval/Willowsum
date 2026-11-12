import { checkMailMessage, type MailMessage, type MailSender } from "./port.ts";

/** How many messages the synthetic outbox keeps (oldest dropped first). */
export const SYNTHETIC_OUTBOX_MAX = 1_000;

/**
 * Test implementation (ARC-05 FR 2): no network; messages stay in this process's memory, where tests (and a
 * developer's debugger) read them. Nothing is written to logs: an address and a confirmation link are
 * personal data even in a synthetic run (ARC-09).
 */
export interface SyntheticMailSender extends MailSender {
  /** Messages sent so far, oldest first. */
  readonly sent: readonly MailMessage[];
  clear(): void;
}

export function syntheticMailSender(): SyntheticMailSender {
  const sent: MailMessage[] = [];
  return {
    sent,
    clear: () => {
      sent.length = 0;
    },
    async send(message) {
      checkMailMessage(message);
      sent.push(Object.freeze({ ...message }));
      if (sent.length > SYNTHETIC_OUTBOX_MAX) sent.shift();
    },
  };
}
