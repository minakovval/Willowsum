import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors.ts";
import { outgoingFieldViolations } from "../outgoing.ts";
import { jsonResponse, recordingFetch } from "../testing.ts";
import { httpMailSender, MAIL_IMPLEMENTATIONS, MAIL_PORT, mailSender, syntheticMailSender } from "./index.ts";

/** ARC-05: the mail port (NFR-17: Resend) — a synthetic outbox for local development and CI, a thin HTTP adapter. */
const MESSAGE = {
  to: "olena.synthetic@example.test",
  subject: "Підтвердьте email",
  text: "Посилання: https://x.test",
};
const KEY = ["re", "synthetic", "value"].join("_"); // built at run time: not a key-shaped literal

function live(answer: (r: Request) => Response | Promise<Response>) {
  const recorder = recordingFetch(answer);
  const sender = httpMailSender({
    baseUrl: "https://mail.test",
    apiKey: KEY,
    from: "Willowsum <no-reply@example.test>",
    fetch: recorder.fetch,
  });
  return { recorder, sender };
}

describe("ARC-05 port «mail»", () => {
  it("FR 2: ships both implementations; WS_PROVIDER_MODE picks the synthetic one unless live", () => {
    expect(typeof MAIL_IMPLEMENTATIONS.test).toBe("function");
    expect(typeof MAIL_IMPLEMENTATIONS.live).toBe("function");
    const chosen = mailSender("test", () => {
      throw new Error("live options are not read in test mode");
    });
    expect("sent" in chosen).toBe(true);
  });

  it("the synthetic outbox keeps the messages in memory only", async () => {
    const outbox = syntheticMailSender();
    await outbox.send(MESSAGE);
    expect(outbox.sent).toEqual([MESSAGE]);
    await expect(outbox.send({ ...MESSAGE, to: "two@example.test, three@example.test" })).rejects.toThrow(
      /one address/,
    );
    await expect(outbox.send({ ...MESSAGE, subject: "a\r\nBcc: x@example.test" })).rejects.toThrow(
      /one line/,
    );
  });

  it("the live adapter POSTs {from,to,subject,text} to /emails with the key as a bearer header; nothing else is sent", async () => {
    const { recorder, sender } = live(() => jsonResponse({ id: "synthetic-message-id" }));
    await sender.send(MESSAGE);
    expect(recorder.requests).toHaveLength(1);
    const request = recorder.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://mail.test/emails");
    expect(request.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.clone().json()).toEqual({
      from: "Willowsum <no-reply@example.test>",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
    expect(await outgoingFieldViolations(MAIL_PORT.operations.send, recorder.requests)).toEqual([]);
  });

  it("FR 3: no retry (a repeat could deliver twice); failures are provider errors without the message", async () => {
    const { recorder, sender } = live(() => new Response("no", { status: 503 }));
    const error = await sender.send(MESSAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("unavailable");
    expect(String((error as Error).message)).not.toContain(MESSAGE.to);
    expect(recorder.requests).toHaveLength(1);
    const rejected = live(() => new Response("bad", { status: 422 }));
    expect(((await rejected.sender.send(MESSAGE).catch((e: unknown) => e)) as ProviderError).kind).toBe(
      "rejected",
    );
  });
});
