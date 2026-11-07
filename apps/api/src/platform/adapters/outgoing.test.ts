import { describe, expect, it } from "vitest";
import { OutgoingFieldError } from "./errors.ts";
import { assertOutgoing, outgoingFieldViolations, payloadFields, undeclaredFields } from "./outgoing.ts";
import { defineProviderPort } from "./port.ts";

const port = defineProviderPort("mail-delivery", {
  send: { idempotent: false, fields: ["to", "template", "params.code", "attachments[].name"] },
});
const SEND = port.operations.send;

describe("ARC-05 FR 5: the fields sent to a provider are fixed in the adapter and checked", () => {
  it("lists the field paths of a payload: nested keys and array items", () => {
    expect(
      payloadFields({
        to: "a@example.test",
        params: { code: "1" },
        attachments: [{ name: "x" }, { name: "y", size: 1 }],
      }),
    ).toEqual(["to", "params.code", "attachments[].name", "attachments[].size"]);
    expect(payloadFields({ skipped: undefined, empty: {} })).toEqual(["empty"]);
  });

  it("ARC-05 FR 5: a payload with only declared fields passes", () => {
    expect(undeclaredFields(SEND, { to: "a@example.test", template: "t", params: { code: "1" } })).toEqual(
      [],
    );
    expect(() => assertOutgoing("mail:test", SEND, { to: "a@example.test" })).not.toThrow();
  });

  it("ARC-05 FR 5: an undeclared field is refused before sending; the error names fields, never values", () => {
    const payload = {
      to: "a@example.test",
      params: { code: "1", fullName: "Secret Person" },
      householdId: "h-1",
    };
    expect(undeclaredFields(SEND, payload)).toEqual(["householdId", "params.fullName"]);
    let error: unknown;
    try {
      assertOutgoing("mail:test", SEND, payload);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(OutgoingFieldError);
    expect((error as OutgoingFieldError).fields).toEqual(["householdId", "params.fullName"]);
    expect((error as Error).message).not.toContain("Secret Person");
    expect((error as Error).message).not.toContain("a@example.test");
  });

  it("ARC-05 FR 5: recorded HTTP requests are checked by query parameter names and JSON body fields", async () => {
    const ok = new Request("https://provider.test/send?to=a", {
      method: "POST",
      body: JSON.stringify({ template: "t", attachments: [{ name: "x" }] }),
    });
    const leak = new Request("https://provider.test/send?to=a&email=b", {
      method: "POST",
      body: JSON.stringify({ template: "t", attachments: [{ name: "x", content: "…" }] }),
    });
    const text = new Request("https://provider.test/send", { method: "POST", body: "raw" });
    expect(await outgoingFieldViolations(SEND, [ok])).toEqual([]);
    expect(await outgoingFieldViolations(SEND, [ok, leak, text])).toEqual([
      "<non-json body>",
      "attachments[].content",
      "email",
    ]);
  });

  it("a port declares well-formed, unique field paths and a kebab-case name", () => {
    expect(() => defineProviderPort("Stripe", { pay: { idempotent: false, fields: [] } })).toThrow(
      /kebab-case/,
    );
    expect(() => defineProviderPort("payments", { pay: { idempotent: false, fields: ["a b"] } })).toThrow(
      /field path/,
    );
    expect(() => defineProviderPort("payments", { pay: { idempotent: false, fields: ["a", "a"] } })).toThrow(
      /duplicate/,
    );
    expect(SEND).toEqual({ name: "mail-delivery.send", idempotent: false, fields: SEND.fields });
    expect(Object.isFrozen(SEND.fields)).toBe(true);
  });
});
