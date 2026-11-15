import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { checkAddedCurrency, CURRENCIES_MAX, freePosition, removalIssue } from "./index.ts";

/** IMP-02@PoC FR 1, FR 15 on the rules of an account's currencies (wallets): adding one, removing one. */

const current = { kind: "current" as const, openedOn: "2026-01-10" };
const TODAY = "2026-11-15";
const add = (input: Partial<{ currency: string; amount: string; date: string }>, existing = ["EUR"]) =>
  checkAddedCurrency(
    current,
    existing,
    { currency: "PLN", amount: "0", date: "2026-11-01", ...input },
    TODAY,
  );

describe("IMP-02@PoC FR 15: «+ додати ще валюту» — the currency, its opening balance and date", () => {
  it("IMP-02@PoC FR 1: a current account in EUR takes PLN with its opening balance — a wallet in that currency", () => {
    expect(add({ amount: "250.40" })).toEqual({
      opening: { balance: Money.of("250.40", "PLN"), date: "2026-11-01" },
    });
    // An overdraft of a current account, as in the form of a new account.
    expect(add({ amount: "-12.5" })).toEqual({
      opening: { balance: Money.of("-12.5", "PLN"), date: "2026-11-01" },
    });
  });

  it("only a current account has several currencies (FIN-01 FR 12)", () => {
    for (const kind of ["savings", "deposit", "cash", "credit-card", "loan"] as const)
      expect(
        checkAddedCurrency(
          { kind, openedOn: "2026-01-10" },
          ["EUR"],
          { currency: "PLN", amount: "1", date: "2026-11-01" },
          TODAY,
        ),
      ).toEqual({ issues: [{ field: "currency", issue: "not_multi_currency" }] });
  });

  it.each([
    ["a currency the account has", { currency: "EUR" }, ["EUR"], { field: "currency", issue: "duplicate" }],
    ["not a currency code", { currency: "гривня" }, ["EUR"], { field: "currency", issue: "invalid" }],
    [
      "an 11th currency",
      { currency: "PLN" },
      ["EUR", "UAH", "USD", "GBP", "CHF", "CZK", "SEK", "NOK", "DKK", "HUF"],
      { field: "currency", issue: "too_many" },
    ],
    [
      "more decimals than the currency has",
      { amount: "1.234" },
      ["EUR"],
      { field: "balance", issue: "invalid" },
    ],
    [
      "a date before the account's opening",
      { date: "2026-01-09" },
      ["EUR"],
      { field: "date", issue: "before_opening" },
    ],
    ["a date after today", { date: "2026-11-16" }, ["EUR"], { field: "date", issue: "date_in_future" }],
    ["not a calendar date", { date: "2026-02-30" }, ["EUR"], { field: "date", issue: "invalid" }],
  ])("%s is refused", (_, input, existing, issue) => {
    expect(add(input, existing)).toEqual({ issues: [issue] });
  });

  it("the first free position: a removed currency's position is free again; none past the tenth", () => {
    expect(freePosition([0])).toBe(1);
    expect(freePosition([0, 2, 3])).toBe(1);
    expect(freePosition(Array.from({ length: CURRENCIES_MAX }, (_, i) => i))).toBeNull();
  });
});

describe("IMP-02@PoC FR 15: which currency can be removed", () => {
  it("IMP-02@PoC FR 15: a currency without transactions can be removed, one with transactions cannot; the main currency stays", () => {
    expect(removalIssue(1, false)).toBeNull();
    expect(removalIssue(1, true)).toBe("has_transactions");
    expect(removalIssue(0, false)).toBe("main_currency");
  });
});
