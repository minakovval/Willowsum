import { Decimal, exchangeRate, Money, type ExchangeRate } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  conversionDifference,
  conversionsFor,
  EVENT_TYPES,
  postingsFor,
  refKey,
  reversalOf,
  type AccountRef,
  type LedgerEvent,
  type Posting,
} from "./index.ts";

/**
 * FIN-04@PoC EC1 and ARC-11 «Запис проводок» on the pure rules: an event in another currency than its account is split
 * into balanced pairs, one per currency, through the service account «Валютна різниця» of each currency; the actual
 * amounts are kept and the explicit dated rate converts the account's amount into the entry's currency. Synthetic ids.
 */

const EUR_ACCOUNT = "00000000-0000-4000-8000-00000000000e";
const USD_ACCOUNT = "00000000-0000-4000-8000-0000000000d1";
const eur = (amount: string) => Money.of(amount, "EUR");
const usd = (amount: string) => Money.of(amount, "USD");
/** 1 EUR = 1.08 USD on 2026-06-15, a synthetic source. */
const EUR_USD: ExchangeRate = exchangeRate({
  base: "EUR",
  quote: "USD",
  rate: "1.08",
  date: "2026-06-15",
  source: "synthetic",
});
const currencyOf = (ref: AccountRef, posting: Posting) =>
  "service" in ref ? posting.amount.currency : ref.account === USD_ACCOUNT ? "USD" : "EUR";
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
const shown = (postings: readonly Posting[]) =>
  postings.map((x) => [refKey(x.debit), refKey(x.credit), x.amount.toDecimalString(), x.amount.currency]);

const spending: LedgerEvent = {
  type: "fx-transaction",
  account: EUR_ACCOUNT,
  amount: usd("-100"),
  settled: eur("-93.10"),
  rate: EUR_USD,
};
const transfer: LedgerEvent = {
  type: "fx-transfer",
  from: USD_ACCOUNT,
  to: EUR_ACCOUNT,
  sent: usd("500"),
  received: eur("461.25"),
  rate: EUR_USD,
};

describe("FIN-04@PoC EC1: an event in another currency than the account is posted through «Валютна різниця»", () => {
  it("FIN-04@PoC EC1: a spending of 100 USD settled as 93.10 EUR — one balanced pair per currency, actual amounts kept", () => {
    const postings = postingsFor(spending);
    expect(shown(postings)).toEqual([
      ["s:fx-difference", `a:${EUR_ACCOUNT}`, "93.1", "EUR"],
      ["s:external-funds", "s:fx-difference", "100", "USD"],
    ]);
    // Every pair is in one currency on both sides, so the set passes the guard of the pair model as it is.
    expect(code(() => assertBalanced(postings, currencyOf))).toBe("ok");
  });

  it("FIN-04@PoC EC1: an income in another currency debits the account and «Зовнішні кошти» gets the event's amount", () => {
    const postings = postingsFor({ ...spending, amount: usd("200"), settled: eur("185") } as LedgerEvent);
    expect(shown(postings)).toEqual([
      [`a:${EUR_ACCOUNT}`, "s:fx-difference", "185", "EUR"],
      ["s:fx-difference", "s:external-funds", "200", "USD"],
    ]);
  });

  it("FIN-04@PoC EC1: a transfer from a USD account to a EUR account — sent and received both kept, each in its currency", () => {
    expect(shown(postingsFor(transfer))).toEqual([
      ["s:fx-difference", `a:${USD_ACCOUNT}`, "500", "USD"],
      [`a:${EUR_ACCOUNT}`, "s:fx-difference", "461.25", "EUR"],
    ]);
  });

  it("FIN-04@PoC EC1: the entry keeps the rate with its date and source, the converted amount and the difference", () => {
    const [c, ...rest] = conversionsFor(spending, "2026-06-15");
    expect(rest).toEqual([]);
    // The account's amount (EUR) converted into the entry's currency (USD) at 1 EUR = 1.08 USD: 100.548 USD.
    expect(c!.amount.toDecimalString()).toBe("93.1");
    expect(c!.amount.currency).toBe("EUR");
    expect(c!.entryAmount.toDecimalString()).toBe("100");
    expect(c!.entryAmount.currency).toBe("USD");
    expect(c!.converted.toDecimalString()).toBe("100.548");
    expect(c!.converted.currency).toBe("USD");
    expect(c!.rate.rate.toString()).toBe("1.08");
    expect([c!.rate.base, c!.rate.quote, c!.rate.date, c!.rate.source]).toEqual([
      "EUR",
      "USD",
      "2026-06-15",
      "synthetic",
    ]);
    // The conversion difference on «Валютна різниця», in the entry's currency.
    expect(conversionDifference(c!).toDecimalString()).toBe("0.548");
    const [t] = conversionsFor(transfer, "2026-06-16");
    // 461.25 EUR × 1.08 = 498.15 USD against 500 USD sent: −1.85 USD.
    expect(conversionDifference(t!).toDecimalString()).toBe("-1.85");
  });

  it("FIN-04@PoC EC1: exact decimals — the posted amounts as given, the converted one at the 18-decimal storage scale", () => {
    const rate = exchangeRate({
      base: "EUR",
      quote: "USD",
      rate: "1.123456789012345678",
      date: "2026-06-15",
      source: "NBU",
    });
    const event = { ...spending, amount: usd("-0.1"), settled: eur("-0.2"), rate } as LedgerEvent;
    expect(shown(postingsFor(event)).map((p) => p[2])).toEqual(["0.2", "0.1"]);
    const [c] = conversionsFor(event, "2026-06-15");
    // 0.2 × 1.123456789012345678 = 0.2246913578024691356: kept at the kernel's storage scale of 18 decimals (half to
    // even), the scale of every amount column; the actual amounts are never rounded.
    expect(c!.converted.toDecimalString()).toBe("0.224691357802469136");
  });

  it("FIN-04@PoC EC1: events in one currency keep no rate", () => {
    expect(
      conversionsFor(
        { type: "transfer", from: EUR_ACCOUNT, to: USD_ACCOUNT, amount: eur("1") },
        "2026-06-15",
      ),
    ).toEqual([]);
  });

  it("FIN-04@PoC EC1: the reversal swaps the pairs, so each currency's balances go back", () => {
    const postings = postingsFor(transfer);
    expect(shown(reversalOf(postings))).toEqual([
      [`a:${USD_ACCOUNT}`, "s:fx-difference", "500", "USD"],
      ["s:fx-difference", `a:${EUR_ACCOUNT}`, "461.25", "EUR"],
    ]);
  });

  it("FIN-04@PoC EC1: the rules know the two cross-currency events", () => {
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(["fx-transaction", "fx-transfer"]));
  });
});

describe("FIN-04@PoC EC1: a cross-currency event without a valid explicit dated rate is refused", () => {
  const bad = (patch: Record<string, unknown>) => ({ ...spending, ...patch }) as LedgerEvent;

  it("FIN-04@PoC EC1: the same currency on both sides is not a cross-currency event", () => {
    expect(code(() => postingsFor(bad({ settled: usd("-100") })))).toBe("INVALID_EVENT");
    expect(code(() => postingsFor({ ...transfer, received: usd("1") } as LedgerEvent))).toBe("INVALID_EVENT");
  });

  it("FIN-04@PoC EC1: amounts of different signs or a zero amount are refused; a transfer moves positive amounts", () => {
    expect(code(() => postingsFor(bad({ settled: eur("93.10") })))).toBe("INVALID_EVENT");
    expect(code(() => postingsFor(bad({ settled: eur("0") })))).toBe("INVALID_EVENT");
    expect(code(() => postingsFor(bad({ amount: usd("0") })))).toBe("INVALID_EVENT");
    expect(code(() => postingsFor({ ...transfer, sent: usd("-500") } as LedgerEvent))).toBe("INVALID_EVENT");
    expect(code(() => postingsFor({ ...transfer, received: eur("0") } as LedgerEvent))).toBe("INVALID_EVENT");
  });

  it("FIN-04@PoC EC1: the rate converts the account's currency into the entry's — another pair or direction is refused", () => {
    const usdEur = exchangeRate({
      base: "USD",
      quote: "EUR",
      rate: "0.93",
      date: "2026-06-15",
      source: "NBU",
    });
    const eurUah = exchangeRate({ base: "EUR", quote: "UAH", rate: "45", date: "2026-06-15", source: "NBU" });
    expect(code(() => postingsFor(bad({ rate: usdEur })))).toBe("INVALID_RATE");
    expect(code(() => postingsFor(bad({ rate: eurUah })))).toBe("INVALID_RATE");
  });

  it("FIN-04@PoC EC1: a missing, non-positive, float or over-precise rate is refused", () => {
    expect(code(() => postingsFor(bad({ rate: undefined })))).toBe("INVALID_RATE");
    for (const rate of [new Decimal(0), new Decimal(-1), 1.08, new Decimal("1.0000000000000000001")])
      expect(
        code(() => postingsFor(bad({ rate: { ...EUR_USD, rate } }))),
        String(rate),
      ).toBe("INVALID_RATE");
  });

  it("FIN-04@PoC EC1: the rate is dated — no date, a rate dated after the operation, or a source that is not a code is refused", () => {
    expect(code(() => postingsFor(bad({ rate: { ...EUR_USD, date: "15.06.2026" } })))).toBe("INVALID_RATE");
    expect(code(() => conversionsFor(spending, "2026-06-14"))).toBe("INVALID_RATE");
    expect(code(() => conversionsFor(spending, "2026-06-15"))).toBe("ok");
    for (const source of ["", "НБУ", "two words", "x".repeat(33)])
      expect(
        code(() => postingsFor(bad({ rate: { ...EUR_USD, source } }))),
        source,
      ).toBe("INVALID_RATE");
  });
});
