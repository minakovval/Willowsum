import type { MailSender } from "../../../platform/adapters/mail/index.ts";
import { integrityAlertMessage, type IntegrityAlert } from "../application/index.ts";

/** The integrity letter through the app's mail adapter; its text holds only kinds and counts of findings. */
export function integrityAlertMail({ mail, to }: { mail: MailSender; to: string }): IntegrityAlert {
  return async (summary) => {
    await mail.send({ to, ...integrityAlertMessage(summary) });
  };
}
