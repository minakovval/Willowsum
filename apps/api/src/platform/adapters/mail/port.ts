import { defineProviderPort } from "../port.ts";

/**
 * Port of transactional mail (ARC-05, ADR-0005; NFR-17: the processor is named in the list of processors). It
 * sends one message to one address. The only outgoing fields are the sender, the recipient, the subject and the
 * text — the minimum a letter needs (FR 5). Messages hold no amounts (NFR-17) and are never logged: the address
 * and the text are personal data (ARC-09, NFR-10).
 */
export const MAIL_PORT = defineProviderPort("mail", {
  // Not safe to repeat: a retry after a timeout could deliver the letter twice.
  send: { idempotent: false, fields: ["from", "to", "subject", "text"], path: "emails" },
});

export interface MailMessage {
  /** One address (already checked by the caller). */
  readonly to: string;
  readonly subject: string;
  /** Plain text: links are written out in full. */
  readonly text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

const HEADER_UNSAFE = /[\r\n]/;

/** A message the port accepts: one address without spaces, a subject on one line, a bounded text. */
export function checkMailMessage(message: MailMessage): void {
  if (!/^[^\s@]+@[^\s@]+$/.test(message.to) || message.to.length > 254)
    throw new Error("A mail recipient is one address");
  if (message.subject.length === 0 || message.subject.length > 200 || HEADER_UNSAFE.test(message.subject))
    throw new Error("A mail subject is one line of 1–200 characters");
  if (message.text.length === 0 || message.text.length > 20_000)
    throw new Error("A mail text is 1–20 000 characters");
}
