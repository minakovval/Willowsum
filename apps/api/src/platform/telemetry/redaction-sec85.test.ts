import { describe, expect, it } from "vitest";
import { looksPersonal, REDACTED, redactAttributes, redactSpanName } from "./redaction.ts";

/**
 * Security review of PR #85 (ARC-09 FR 2, NFR-10 FR 1): values that fit a key's grammar and are stopped only
 * by one detector, locale formats of amounts, and personal values hidden in allow-listed keys. Synthetic
 * credentials are built at run time so the secret scanner never sees a key-shaped literal.
 */
const join = (...parts: string[]) => parts.join("");

describe("sec85: amounts in every locale format are detected", () => {
  it.each([
    "1 234,56 грн",
    "1 234,56 ₴",
    "€1.234,56",
    "1.234,56 €",
    "$1,234.56",
    "-98765.43",
    "1234,5",
    "UAH 1500",
    "1500 EUR",
    "£20",
  ])("%s", (value) => expect(looksPersonal(value)).toBe(true));
});

describe("sec85: grammar-valid values stopped by a single detector", () => {
  it("an integer amount with a currency code inside a technical name is dropped (currency detector)", () => {
    expect(
      redactAttributes({ "ws.module": "fee-1500-uah", "ws.provider.operation": "transfer.eur-250" }),
    ).toEqual({ "ws.telemetry.redacted": 2 });
  });

  it("a short JWT inside a technical name is dropped (JWT detector)", () => {
    const jwt = join("tok.ey", "JhbGc.ey", "JzdWI.c2ln");
    expect(redactAttributes({ "ws.provider": jwt })).toEqual({ "ws.telemetry.redacted": 1 });
  });

  it("an Authorization value as a two-word span name is redacted (bearer / basic detector)", () => {
    expect(redactSpanName(join("bear", "er abc123"))).toBe(REDACTED);
    expect(redactSpanName(join("bas", "ic dxnlcjpwyxnz"))).toBe(REDACTED);
  });

  it("a credential by name inside a technical name is dropped (credential detector)", () => {
    const value = join("api", "_key:", "abc");
    expect(redactAttributes({ "ws.provider": value, "ws.job.name": join("pass", "word:", "x") })).toEqual({
      "ws.telemetry.redacted": 2,
    });
  });

  it("a route template never carries spaces, dots or @ (a concrete value, a file name or an email)", () => {
    expect(
      redactAttributes({
        "http.route": "/v1/accounts/family savings",
      }),
    ).toEqual({ "ws.telemetry.redacted": 1 });
    expect(redactAttributes({ "http.route": "/v1/files/statement.pdf" })).toEqual({
      "ws.telemetry.redacted": 1,
    });
    expect(redactAttributes({ "http.route": "/v1/users/olha@example" })).toEqual({
      "ws.telemetry.redacted": 1,
    });
  });
});

describe("sec85: personal values hidden in allow-listed keys", () => {
  it("phone numbers, IPs, user agents, coordinates, IBANs (lower case, grouped), household ids", () => {
    const hidden = {
      "http.route": "/v1/phones/380671234567",
      "ws.module": "ua213223130000026007233566001",
      "ws.provider": "client.192.168.1.20",
      "ws.provider.operation": "agent.mozilla/5.0",
      "ws.job.name": "geo.50.45010",
      "ws.db.table": "h_3b9d7f0e2c4a4e8b9a1d6f5e4c3b2a01",
      "error.type": "Iban4111111111111111",
      "ws.problem.code": "INTERNAL_4111111111111111",
      "ws.db.constraint": "accounts_4111111111111111_key",
      "db.response.status_code": "duplicate key value",
      "ws.provider.outcome": "olha@example.com",
    };
    expect(redactAttributes(hidden)).toEqual({ "ws.telemetry.redacted": Object.keys(hidden).length });
  });

  it("a pg constraint or column name repeating a value (Key (name)=(…)) is dropped", () => {
    expect(
      redactAttributes({
        "ws.db.constraint": "Key (name)=(Картка Золота)",
        "ws.db.column": "name=Картка",
        "ws.db.schema": "wallets;drop",
      }),
    ).toEqual({ "ws.telemetry.redacted": 3 });
  });

  // Review of PR #85, fixed (was Low): `service.version` / `telemetry.sdk.version` are «closed» grammars, so the detectors are
  // skipped and a pre-release part can carry any digits — a card number passes the filter.
  it("a version's pre-release part cannot carry a card number (closed grammar skips the detectors)", () => {
    expect(redactAttributes({ "service.version": "1.0.0-4111111111111111" })).toEqual({
      "ws.telemetry.redacted": 1,
    });
  });
});
