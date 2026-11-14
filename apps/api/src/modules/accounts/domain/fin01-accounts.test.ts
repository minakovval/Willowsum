import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_KINDS,
  checkNewAccount,
  DEFAULT_ACCOUNT_KIND,
  depositAccrual,
  groupOf,
  institutionKey,
  ledgerTypeOf,
  maskedNumber,
  openingEventAmount,
  parseAccountNumber,
  sameNumber,
  shownBalance,
  type NewAccountInput,
} from "./index.ts";

/** FIN-01@PoC on the pure rules of accounts: kinds, the form's fields, numbers, duplicates, deposits. Synthetic data. */

const eur = (amount: string) => Money.of(amount, "EUR");
const base: NewAccountInput = {
  kind: "current",
  name: "Щоденний",
  institution: { name: "ПриватБанк", country: "UA" },
  balance: { amount: "1000.00", currency: "EUR" },
  balanceDate: "2026-11-01",
};
const issues = (input: Partial<NewAccountInput>) => {
  const result = checkNewAccount({ ...base, ...input });
  return "issues" in result ? result.issues : [];
};
/** A synthetic IBAN with a valid check (ISO 13616), ending in 1234. */
const IBAN = "UA113223130000026007233561234";

describe("FIN-01@PoC FR 1: the kinds of money accounts", () => {
  it("FIN-01@PoC FR 1: six kinds, «Поточний» by default; no brokerage account (FR 2)", () => {
    expect(ACCOUNT_KINDS).toEqual(["current", "savings", "deposit", "cash", "credit-card", "loan"]);
    expect(DEFAULT_ACCOUNT_KIND).toBe("current");
    expect(ACCOUNT_KINDS).not.toContain("brokerage");
  });

  it("FIN-01@PoC FR 2: credit cards and loans are «Кредитні» and liabilities in the ledger; the rest «Готівкові»", () => {
    expect(ACCOUNT_KINDS.map((k) => [k, groupOf(k), ledgerTypeOf(k)])).toEqual([
      ["current", "cash", "asset"],
      ["savings", "cash", "asset"],
      ["deposit", "cash", "asset"],
      ["cash", "cash", "asset"],
      ["credit-card", "credit", "liability"],
      ["loan", "credit", "liability"],
    ]);
  });
});

describe("FIN-01@PoC FR 3: the fields of «Новий рахунок»", () => {
  it("FIN-01@PoC AC1: type, institution, country, currency and balance on a date make an account", () => {
    const result = checkNewAccount(base);
    expect(result).toMatchObject({
      account: {
        kind: "current",
        name: "Щоденний",
        institution: { name: "ПриватБанк", country: "UA" },
        currencies: [{ balance: eur("1000"), date: "2026-11-01" }],
        openedOn: "2026-11-01",
        liability: null,
      },
    });
  });

  it("FIN-01@PoC AC2: without a name or a valid currency nothing is created", () => {
    expect(issues({ name: "  " })).toEqual([{ field: "name", issue: "invalid" }]);
    expect(issues({ balance: { amount: "10", currency: "" } })).toEqual([
      { field: "balance.currency", issue: "invalid" },
    ]);
    expect(issues({ balance: { amount: "10", currency: "HRK" } })).toEqual([
      { field: "balance.currency", issue: "invalid" },
    ]);
  });

  it("FIN-01@PoC FR 5: the balance and its date are required and valid", () => {
    expect(issues({ balance: { amount: "", currency: "EUR" } })).toEqual([
      { field: "balance.amount", issue: "invalid" },
    ]);
    expect(issues({ balanceDate: "2026-02-30" })).toEqual([{ field: "balanceDate", issue: "invalid" }]);
    expect(issues({ balance: { amount: "1.005", currency: "EUR" } })).toEqual([
      { field: "balance.amount", issue: "invalid" },
    ]);
  });

  it("FIN-01@PoC FR 3: a name is one line of at most 80 characters; a note at most 1 000", () => {
    expect(issues({ name: "Д".repeat(81) })).toEqual([{ field: "name", issue: "invalid" }]);
    expect(issues({ name: "Щоденний\nрахунок" })).toEqual([{ field: "name", issue: "invalid" }]);
    expect(issues({ name: "\u202Eкнаб" })).toEqual([{ field: "name", issue: "invalid" }]);
    expect(issues({ note: "н".repeat(1001) })).toEqual([{ field: "note", issue: "invalid" }]);
    expect(checkNewAccount({ ...base, note: "рядок 1\nрядок 2" })).toMatchObject({
      account: { note: "рядок 1\nрядок 2" },
    });
  });

  it("FIN-01@PoC FR 3: a field of another kind is refused, not dropped", () => {
    expect(issues({ monthlyPayment: "650" })).toEqual([{ field: "monthlyPayment", issue: "not_allowed" }]);
    expect(issues({ kind: "cash", annualRate: "2" })).toEqual([
      { field: "annualRate", issue: "not_allowed" },
    ]);
    expect(issues({ kind: "savings", depositMaturesOn: "2027-01-01" })).toEqual([
      { field: "depositMaturesOn", issue: "not_allowed" },
    ]);
  });

  it("FIN-01@PoC FR 3: only a current account may open below zero (an overdraft); a debt is typed positive", () => {
    expect(checkNewAccount({ ...base, balance: { amount: "-50.00", currency: "EUR" } })).toMatchObject({
      account: { currencies: [{ balance: eur("-50") }] },
    });
    for (const kind of ["savings", "deposit", "cash", "credit-card", "loan"] as const)
      expect(
        issues({
          kind,
          balance: { amount: "-1", currency: "EUR" },
          annualRate: "1",
          monthlyPayment: "1",
        }).map((i) => i.field),
        kind,
      ).toContain("balance.amount");
  });

  it("FIN-01@PoC FR 2: a loan carries its rate and monthly payment to the liability", () => {
    const result = checkNewAccount({
      ...base,
      kind: "loan",
      name: "Іпотека",
      balance: { amount: "120000.00", currency: "EUR" },
      annualRate: "4.2",
      monthlyPayment: "650.00",
    });
    expect(result).toMatchObject({
      account: {
        kind: "loan",
        liability: { kind: "loan", currency: "EUR", annualRate: "4.2", monthlyPayment: "650.00" },
      },
    });
  });

  it("FIN-01@PoC FR 8: a deposit has its rate, opening and maturity dates; maturity after opening", () => {
    const deposit = {
      ...base,
      kind: "deposit" as const,
      annualRate: "3.5",
      depositOpenedOn: "2026-01-01",
      depositMaturesOn: "2027-01-01",
    };
    expect(checkNewAccount(deposit)).toMatchObject({
      account: { annualRate: "3.5", depositOpenedOn: "2026-01-01", depositMaturesOn: "2027-01-01" },
    });
    // FR 6: the account opened when the deposit did.
    expect(checkNewAccount(deposit)).toMatchObject({ account: { openedOn: "2026-01-01" } });
    expect(issues({ ...deposit, depositMaturesOn: "2025-12-31" })).toEqual([
      { field: "depositMaturesOn", issue: "before_opening" },
    ]);
  });
});

describe("FIN-01@PoC FR 12: a multi-currency account is a current account with a subaccount per currency", () => {
  it("FIN-01@PoC FR 12: «+ додати ще валюту» adds a currency with its own balance and date", () => {
    const result = checkNewAccount({
      ...base,
      extraCurrencies: [{ amount: "4300.00", currency: "UAH", date: "2026-11-02" }],
    });
    expect(result).toMatchObject({
      account: {
        currencies: [
          { balance: eur("1000"), date: "2026-11-01" },
          { balance: Money.of("4300", "UAH"), date: "2026-11-02" },
        ],
      },
    });
  });

  it("FIN-01@PoC FR 12: only a current account; each currency once; at most 10", () => {
    const extra = [{ amount: "1", currency: "UAH", date: "2026-11-01" }];
    expect(issues({ kind: "savings", extraCurrencies: extra })).toEqual([
      { field: "extraCurrencies", issue: "not_allowed" },
    ]);
    expect(issues({ extraCurrencies: [{ amount: "1", currency: "EUR", date: "2026-11-01" }] })).toEqual([
      { field: "extraCurrencies.0.currency", issue: "duplicate" },
    ]);
    const ten = ["UAH", "USD", "PLN", "GBP", "CHF", "CZK", "SEK", "NOK", "DKK", "HUF"].map((currency) => ({
      amount: "1",
      currency,
      date: "2026-11-01",
    }));
    expect(issues({ extraCurrencies: ten })).toEqual([{ field: "extraCurrencies", issue: "too_many" }]);
  });
});

describe("FIN-01@PoC FR 7: «Початковий залишок» in the ledger", () => {
  it("FIN-01@PoC FR 7: money held is positive; the debt of a credit card or a loan is negative (it is owed)", () => {
    expect(openingEventAmount("current", eur("1000")).toDecimalString()).toBe("1000");
    expect(openingEventAmount("credit-card", eur("1200")).toDecimalString()).toBe("-1200");
    expect(openingEventAmount("loan", eur("120000")).toDecimalString()).toBe("-120000");
  });

  it("FIN-01@PoC FR 16: a credit card's ledger balance (the debt) is shown negative", () => {
    expect(shownBalance("credit-card", eur("1200")).toDecimalString()).toBe("-1200");
    expect(shownBalance("deposit", eur("10000")).toDecimalString()).toBe("10000");
  });
});

describe("FIN-01@PoC business rule: the IBAN or number is kept sealed and shown by its last 4 characters", () => {
  it("FIN-01@PoC AC7: an IBAN keeps its full value for the seal and shows «••1234»", () => {
    expect(parseAccountNumber("UA11 3223 1300 0002 6007 2335 6123 4")).toEqual({ last4: "1234", full: IBAN });
    expect(maskedNumber("1234")).toBe("••1234");
  });

  it("FIN-01@PoC AC7: only the last 4 characters may be given; an IBAN with a wrong check is refused", () => {
    expect(parseAccountNumber("1234")).toEqual({ last4: "1234", full: null });
    expect(parseAccountNumber("UA113223130000026007233561235")).toBe("invalid");
    expect(parseAccountNumber("12")).toBe("invalid");
  });

  it("FIN-01@PoC AC7: a full payment card number is never taken (FIN-12 FR 4)", () => {
    expect(parseAccountNumber("4111 1111 1111 1111")).toBe("card_number_not_allowed");
    expect(issues({ kind: "credit-card", number: "4111111111111111" })).toEqual([
      { field: "number", issue: "card_number_not_allowed" },
    ]);
  });
});

describe("FIN-01@PoC FR 25: a duplicate is the same institution, number or IBAN and currency", () => {
  it("FIN-01@PoC AC15: the same institution is the same name without case or repeated spaces, and country", () => {
    expect(institutionKey({ name: "ПриватБанк", country: "UA" })).toBe(
      institutionKey({ name: "приватбанк", country: "UA" }),
    );
    expect(institutionKey({ name: "Приват  Банк", country: "UA" })).toBe(
      institutionKey({ name: "Приват Банк", country: "UA" }),
    );
    expect(institutionKey({ name: "ПриватБанк", country: "UA" })).not.toBe(
      institutionKey({ name: "ПриватБанк", country: "PL" }),
    );
  });

  it("FIN-01@PoC FR 25: numbers compare in full when both are kept, otherwise by their last 4", () => {
    const full = { last4: "1234", full: IBAN };
    expect(sameNumber(full, { last4: "1234", full: IBAN })).toBe(true);
    expect(sameNumber(full, { last4: "1234", full: "PL61109010140000071219812874" })).toBe(false);
    expect(sameNumber(full, { last4: "1234", full: null })).toBe(true);
    expect(sameNumber({ last4: "1234", full: null }, { last4: "9999", full: null })).toBe(false);
  });
});

describe("FIN-01@PoC FR 9: the interest of a deposit, «розрахунково»", () => {
  const terms = { annualRate: "3.5", openedOn: "2026-01-01", maturesOn: "2027-01-01" };

  it("FIN-01@PoC AC3: 10 000 EUR at 3,5 % from 2026-01-01, today 2026-10-17: 277,12 EUR and 76 days left", () => {
    const accrual = depositAccrual(eur("10000"), terms, "2026-10-17")!;
    expect(accrual.days).toBe(289);
    expect(accrual.accrued.toDisplayDecimal().toFixed(2)).toBe("277.12");
    expect(accrual.daysToMaturity).toBe(76);
    expect(accrual.matured).toBe(false);
  });

  it("FIN-01@PoC FR 10: the worked example is exact Decimal arithmetic: 10 000 × 0,035 × 289 / 365", () => {
    const accrual = depositAccrual(eur("10000"), terms, "2026-10-17")!;
    expect(accrual.accrued.toDecimalString()).toBe("277.123287671232876712");
  });

  it("FIN-01@PoC FR 11: the card shows the days left to maturity", () => {
    expect(depositAccrual(eur("10000"), terms, "2026-12-31")!.daysToMaturity).toBe(1);
  });

  it("FIN-01@PoC EC2: without a rate or a maturity date no interest is calculated", () => {
    expect(depositAccrual(eur("10000"), { ...terms, annualRate: null }, "2026-10-17")).toBeNull();
    expect(depositAccrual(eur("10000"), { ...terms, maturesOn: null }, "2026-10-17")).toBeNull();
  });

  it("FIN-01@PoC EC3: after the maturity date the interest stops there and the term has ended", () => {
    const accrual = depositAccrual(eur("10000"), terms, "2027-03-01")!;
    expect(accrual.days).toBe(365);
    expect(accrual.accrued.toDecimalString()).toBe("350");
    expect(accrual.daysToMaturity).toBe(0);
    expect(accrual.matured).toBe(true);
  });
});
