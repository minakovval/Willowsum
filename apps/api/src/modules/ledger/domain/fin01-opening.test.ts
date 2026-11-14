import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES, postingsFor, refKey } from "./index.ts";

/**
 * FIN-01@PoC FR 7 on the pure rules: the opening balance of an account is one event «Початковий залишок»
 * (`opening-balance`) against «Зовнішні кошти», signed from the account holder's side (a debt is negative). Synthetic ids.
 */
const ACCOUNT = "00000000-0000-4000-8000-0000000000a1";
const shown = (event: Parameters<typeof postingsFor>[0]) =>
  postingsFor(event).map((x) => [refKey(x.debit), refKey(x.credit), x.amount.toDecimalString()]);

describe("FIN-01@PoC FR 7: «Початковий залишок» is one ledger event", () => {
  it("FIN-01@PoC FR 7: a cash balance debits the account against «Зовнішні кошти»", () => {
    expect(EVENT_TYPES).toContain("opening-balance");
    expect(shown({ type: "opening-balance", account: ACCOUNT, amount: Money.of("1000.00", "EUR") })).toEqual([
      [`a:${ACCOUNT}`, "s:external-funds", "1000"],
    ]);
  });

  it("FIN-01@PoC FR 7: a debt (credit card, loan) is negative: it credits the account, so its liability grows", () => {
    expect(shown({ type: "opening-balance", account: ACCOUNT, amount: Money.of("-1200", "EUR") })).toEqual([
      ["s:external-funds", `a:${ACCOUNT}`, "1200"],
    ]);
  });

  it("FIN-01@PoC FR 7: a zero opening balance moves nothing and is refused as an empty posting set", () => {
    expect(() =>
      postingsFor({ type: "opening-balance", account: ACCOUNT, amount: Money.zero("EUR") }),
    ).toThrow(expect.objectContaining({ code: "EMPTY_POSTING_SET" }));
  });
});
