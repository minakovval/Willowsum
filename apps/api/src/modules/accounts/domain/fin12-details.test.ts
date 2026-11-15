import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, checkDetails, detailFieldsOf, parseCardExpiry } from "./index.ts";

/**
 * FIN-12@PoC FR 4 «Реквізити» on the pure rules (wave 2 row 14): which fields each kind has, how they are checked, and
 * that the full number is parsed for sealing, never kept in the clear. Every value is synthetic.
 */

/** A synthetic IBAN with a valid ISO 13616 check (the last 4 characters «1234»). */
const IBAN = "UA113223130000026007233561234";

describe("FIN-12@PoC FR 4: «Реквізити» — the fields depend on the kind", () => {
  it("FIN-12@PoC FR 4: institution, number and note for every kind; card expiry only for a credit card; the rate only for «Ощадний» and «Депозит»", () => {
    for (const kind of ACCOUNT_KINDS) {
      const fields = detailFieldsOf(kind);
      expect(fields).toEqual(expect.arrayContaining(["institution", "number", "note"]));
      expect([kind, fields.includes("cardExpiry")]).toEqual([kind, kind === "credit-card"]);
      expect([kind, fields.includes("annualRate")]).toEqual([kind, kind === "savings" || kind === "deposit"]);
    }
  });

  it("FIN-12@PoC FR 4: a field of another kind is refused, not dropped", () => {
    expect(checkDetails("current", { cardExpiry: "2028-04" })).toEqual({
      issues: [{ field: "cardExpiry", issue: "not_allowed" }],
    });
    expect(checkDetails("credit-card", { annualRate: "36" })).toEqual({
      issues: [{ field: "annualRate", issue: "not_allowed" }],
    });
    expect(checkDetails("loan", { annualRate: "8.5" })).toEqual({
      issues: [{ field: "annualRate", issue: "not_allowed" }],
    });
  });

  it("FIN-12@PoC FR 4: only the fields sent change; null clears a field", () => {
    expect(checkDetails("savings", {})).toEqual({ change: {} });
    expect(
      checkDetails("savings", { note: null, number: null, institution: null, annualRate: null }),
    ).toEqual({
      change: { note: null, number: null, institution: null, annualRate: null },
    });
    expect(checkDetails("savings", { number: "  ", note: "" })).toEqual({
      change: { number: null, note: null },
    });
  });

  it("FIN-12@PoC FR 4, NFR-01@PoC FR 6: an IBAN is parsed for sealing with its last 4 characters; a full card number is never taken", () => {
    expect(checkDetails("current", { number: "ua11 3223 1300 0002 6007 2335 6123 4" })).toEqual({
      change: { number: { last4: "1234", full: IBAN } },
    });
    expect(checkDetails("credit-card", { number: "4421" })).toEqual({
      change: { number: { last4: "4421", full: null } },
    });
    // A synthetic card number with a valid Luhn check.
    expect(checkDetails("credit-card", { number: "4111 1111 1111 1111" })).toEqual({
      issues: [{ field: "number", issue: "card_number_not_allowed" }],
    });
    expect(checkDetails("current", { number: "UA113223130000026007233561235" })).toEqual({
      issues: [{ field: "number", issue: "invalid" }],
    });
  });

  it("FIN-12@PoC FR 4: the institution, the note and the rate follow the rules of «Новий рахунок»", () => {
    expect(checkDetails("deposit", { institution: { name: "  ПриватБанк ", country: "UA" } })).toEqual({
      change: { institution: { name: "ПриватБанк", country: "UA" } },
    });
    expect(checkDetails("deposit", { institution: { name: "Банк", country: "ua" } })).toEqual({
      issues: [{ field: "institution", issue: "invalid" }],
    });
    expect(checkDetails("deposit", { note: "x".repeat(1001) })).toEqual({
      issues: [{ field: "note", issue: "invalid" }],
    });
    expect(checkDetails("deposit", { note: "Рядок 1\nРядок 2" })).toEqual({
      change: { note: "Рядок 1\nРядок 2" },
    });
    expect(checkDetails("deposit", { annualRate: "100.01" })).toEqual({
      issues: [{ field: "annualRate", issue: "invalid" }],
    });
    expect(checkDetails("deposit", { annualRate: "3.50" })).toEqual({ change: { annualRate: "3.5" } });
  });
});

describe("FIN-12@PoC FR 4: «Строк дії» of a credit card", () => {
  it("FIN-12@PoC FR 4: month and year as YYYY-MM; anything else is refused", () => {
    expect(parseCardExpiry("2028-04")).toBe("2028-04");
    expect(parseCardExpiry("2000-01")).toBe("2000-01");
    for (const bad of ["2028-13", "2028-00", "28-04", "2028-4", "04/28", "1999-12", "2100-01", "2028-04-01"])
      expect([bad, parseCardExpiry(bad)]).toEqual([bad, null]);
    expect(checkDetails("credit-card", { cardExpiry: "04/28" })).toEqual({
      issues: [{ field: "cardExpiry", issue: "invalid" }],
    });
    expect(checkDetails("credit-card", { cardExpiry: null })).toEqual({ change: { cardExpiry: null } });
  });
});
