import { z } from "zod";
import { createProviderHttp, type FetchFn } from "../http.ts";
import { createProviderClient, type ProviderClientOptions } from "../provider-client.ts";
import { checkMailMessage, MAIL_PORT, type MailSender } from "./port.ts";

/**
 * Working implementation over HTTP, without a provider SDK (ADR-0005): the transactional mail API of the
 * processor named in NFR-17 (Resend): `POST <baseUrl>/emails` with `Authorization: Bearer <key>` and
 * `{ from, to, subject, text }` → `{ id }`. No retries (a repeat could deliver twice); the kit's time limit
 * and breaker apply.
 */
export interface HttpMailOptions {
  /** Default `https://api.resend.com`. */
  readonly baseUrl?: string;
  /** The API key (secret `WS_MAIL_API_KEY`). */
  readonly apiKey: string;
  /** The sender, e.g. `Willowsum <no-reply@example.org>` (`WS_MAIL_FROM`). */
  readonly from: string;
  readonly fetch?: FetchFn;
  readonly clock?: ProviderClientOptions["clock"];
  readonly policy?: ProviderClientOptions["policy"];
}

export const DEFAULT_MAIL_BASE_URL = "https://api.resend.com";

const answer = z.object({ id: z.string().min(1) });

export function httpMailSender(options: HttpMailOptions): MailSender {
  const client = createProviderClient({
    provider: "mail:resend",
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const http = createProviderHttp({
    baseUrl: options.baseUrl ?? DEFAULT_MAIL_BASE_URL,
    client,
    headers: { authorization: `Bearer ${options.apiKey}` },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    async send(message) {
      checkMailMessage(message);
      await http.postJson(
        MAIL_PORT.operations.send,
        {},
        { from: options.from, to: message.to, subject: message.subject, text: message.text },
        (body) => answer.parse(body),
      );
    },
  };
}
