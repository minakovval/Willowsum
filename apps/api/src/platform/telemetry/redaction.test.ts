import { Rng } from "@willowsum/synthetic";
import { describe, expect, it } from "vitest";
import { PII_KINDS, piiFragments, piiValue } from "./pii.test-helper.ts";
import {
  ATTRIBUTE_RULES,
  looksPersonal,
  REDACTED,
  redactAttributes,
  redactName,
  redactSpanName,
} from "./redaction.ts";

const KEYS = Object.keys(ATTRIBUTE_RULES);
const OTHER_KEYS = [
  "url.full",
  "url.query",
  "url.path",
  "http.request.body",
  "http.request.header.authorization",
  "client.address",
  "user.email",
  "account.name",
  "amount",
  "db.query.text",
  "exception.message",
  "exception.stacktrace",
  "enduser.id",
  "geo.location",
];

describe("ARC-09 FR 2 / NFR-10 FR 1: the redaction filter is an allow-list", () => {
  it("keeps technical values of listed keys", () => {
    const technical = {
      "http.request.method": "POST",
      "http.route": "/v1/accounts/:accountId/transactions",
      "http.response.status_code": 500,
      "ws.problem.code": "INTERNAL",
      "error.type": "DatabaseError",
      "db.system.name": "postgresql",
      "db.response.status_code": "23505",
      "ws.db.constraint": "accounts_household_id_name_key",
      "ws.db.table": "accounts",
      "ws.db.column": "balance_currency",
      "ws.db.schema": "wallets",
      "ws.module": "feature-flags",
      "ws.provider": "exchange-rates:http",
      "ws.provider.operation": "exchange-rates.ratesOn",
      "ws.provider.outcome": "circuit-open",
      "ws.provider.attempts": 3,
      "ws.job.name": "bank-sync",
      "ws.outcome": "failure",
      "service.version": "1.2.3",
    };
    expect(redactAttributes(technical)).toEqual(technical);
  });

  it("drops every key outside the list, whatever its value, and counts what it dropped", () => {
    const out = redactAttributes(Object.fromEntries(OTHER_KEYS.map((k) => [k, "x"])));
    expect(out).toEqual({ "ws.telemetry.redacted": OTHER_KEYS.length });
  });

  it("drops listed keys whose value does not fit the key's grammar (an amount in a status code, a URL as a route)", () => {
    expect(
      redactAttributes({
        "http.response.status_code": 1234.56,
        "http.route": "/v1/accounts/1234567890?email=a@b.c",
        "http.request.method": "get",
        "ws.db.table": "Картка Золота",
        "db.response.status_code": "duplicate key",
        "ws.provider.attempts": "3",
        "error.type": ["TypeError"],
      }),
    ).toEqual({ "ws.telemetry.redacted": 7 });
  });

  it("span names and log bodies are technical names, otherwise «redacted»", () => {
    expect(redactSpanName("GET /v1/me/features")).toBe("GET /v1/me/features");
    expect(redactSpanName("POST")).toBe("POST");
    expect(redactSpanName("db.transaction feature-flags")).toBe("db.transaction feature-flags");
    expect(redactSpanName("provider exchange-rates.ratesOn")).toBe("provider exchange-rates.ratesOn");
    expect(redactSpanName("GET /v1/accounts/4111111111111111")).toBe(REDACTED);
    expect(redactSpanName("sync of Картка Золота failed")).toBe(REDACTED);
    expect(redactSpanName("GET /v1/x?email=olha@example.com")).toBe(REDACTED);
    expect(redactName("api.server_error")).toBe("api.server_error");
    expect(redactName("insert failed for olha@example.com")).toBe(REDACTED);
    expect(redactName({ amount: "12.30" })).toBe(REDACTED);
  });

  it("the detectors recognise every kind of synthetic personal value", () => {
    const rng = new Rng("arc09-detectors");
    for (const kind of PII_KINDS) {
      // Account names and addresses are words: they are stopped by the grammars, not by the detectors.
      if (kind === "accountName" || kind === "address") continue;
      for (let i = 0; i < 50; i++) expect([kind, looksPersonal(piiValue(rng, kind))]).toEqual([kind, true]);
    }
    for (const fine of ["/v1/household-members/invitations", "notification-preferences", "23505", "GET"])
      expect([fine, looksPersonal(fine)]).toEqual([fine, false]);
  });

  it("property: random personal values under random keys (listed or not) never survive the filter", () => {
    const rng = new Rng("arc09-property-attributes");
    for (let round = 0; round < 500; round++) {
      const attributes: Record<string, string | number | string[]> = {};
      const planted: string[] = [];
      for (let i = 0; i < 8; i++) {
        const key = rng.int(0, 2) === 0 ? rng.pick(OTHER_KEYS) : rng.pick(KEYS);
        const value = piiValue(rng, rng.pick(PII_KINDS));
        planted.push(value);
        const embed = rng.int(0, 3);
        attributes[key] =
          embed === 0 ? value : embed === 1 ? `/v1/${value}` : embed === 2 ? [value] : `${value} failed`;
      }
      const text = JSON.stringify(redactAttributes(attributes));
      for (const value of planted)
        for (const fragment of piiFragments(value)) expect(text).not.toContain(fragment);
      const name = redactSpanName(`POST /v1/${planted[0]}`);
      for (const fragment of piiFragments(planted[0]!)) expect(name).not.toContain(fragment);
    }
  });
});
