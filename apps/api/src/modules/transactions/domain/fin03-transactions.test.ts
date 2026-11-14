import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  checkDate,
  counterpartyText,
  descriptionText,
  parseSignedAmount,
  subaccountFor,
  typeOf,
  type PostingAccount,
} from "./transactions.ts";

/** FIN-03@PoC a): the rules of a transaction entered by hand, without I/O. */
describe("FIN-03@PoC FR 2, FR 3: a signed amount in the account's currency", () => {
  it("FIN-03@PoC FR 2: plus is «надходження», minus «списання»; Decimal, at most the currency's minor units, never 0", () => {
    const expense = parseSignedAmount("-45.50", "EUR");
    expect(expense).toBeInstanceOf(Money);
    expect((expense as Money).toDecimalString()).toBe("-45.5");
    expect(typeOf(expense as Money)).toBe("expense");
    expect(typeOf(parseSignedAmount("2500", "EUR") as Money)).toBe("income");
    // 0,1 + 0,2 stays exact (never a float).
    expect(
      (parseSignedAmount("0.1", "EUR") as Money)
        .plus(parseSignedAmount("0.2", "EUR") as Money)
        .toDecimalString(),
    ).toBe("0.3");
    expect(parseSignedAmount("0.00", "EUR")).toBe("zero");
    expect(parseSignedAmount("-0", "EUR")).toBe("zero");
    for (const [text, currency] of [
      ["-1.005", "EUR"],
      ["10.5", "JPY"],
      ["1e3", "EUR"],
      ["+5", "EUR"],
      ["1,50", "EUR"],
      ["", "EUR"],
      ["5", "XXX1"],
    ])
      expect(parseSignedAmount(text!, currency!), `${text} ${currency}`).toBe("invalid");
  });
});

describe("FIN-03@PoC EC2: the currency picks the subaccount", () => {
  const account: PostingAccount = {
    accountId: "a",
    status: "active",
    subaccounts: [
      { subaccountId: "eur", currency: "EUR", ledgerAccountId: "l-eur" },
      { subaccountId: "usd", currency: "USD", ledgerAccountId: "l-usd" },
    ],
  };

  it("FIN-03@PoC EC2: another currency than the account's is «Валюта не відповідає рахунку»; a multi-currency account takes the subaccount of that currency", () => {
    expect(subaccountFor(account, "USD")).toMatchObject({ subaccountId: "usd" });
    expect(subaccountFor(account, "UAH")).toBe("currency_mismatch");
    expect(subaccountFor({ ...account, subaccounts: account.subaccounts.slice(0, 1) }, "USD")).toBe(
      "currency_mismatch",
    );
  });
});

describe("FIN-03@PoC FR 28, FR 29: the fields of the form", () => {
  it("FIN-03@PoC FR 29: «Дата» — a calendar date up to today; never after it", () => {
    expect(checkDate("2026-10-17", "2026-10-17")).toBeNull();
    expect(checkDate("2026-10-16", "2026-10-17")).toBeNull();
    expect(checkDate("2026-10-18", "2026-10-17")).toBe("date_in_future");
    for (const bad of ["2026-02-30", "17.10.2026", "1899-12-31", "2026-1-5"])
      expect(checkDate(bad, "2026-10-17"), bad).toBe("invalid");
  });

  it("FIN-03@PoC FR 28: «Контрагент» is one line of up to 200 characters, «Опис» up to 1 000 with line feeds; empty — none", () => {
    expect(counterpartyText("  Сільпо  ")).toBe("Сільпо");
    expect(counterpartyText("")).toBeNull();
    expect(counterpartyText("а".repeat(200))).toHaveLength(200);
    expect(counterpartyText("а".repeat(201))).toBeUndefined();
    expect(counterpartyText("рядок\nдругий")).toBeUndefined();
    expect(counterpartyText("‮обман")).toBeUndefined();
    expect(descriptionText("перший\r\nдругий")).toBe("перший\nдругий");
    expect(descriptionText("   ")).toBeNull();
    expect(descriptionText("б".repeat(1001))).toBeUndefined();
    expect(descriptionText("a\u0007b")).toBeUndefined();
  });
});
