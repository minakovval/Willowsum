import { Decimal, Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  EVENT_TYPES,
  MAX_POSTINGS,
  naturalBalance,
  postingsFor,
  refKey,
  reversalOf,
  type AccountRef,
  type LedgerEvent,
  type Posting,
} from "./index.ts";

/** FIN-04@PoC FR 2–6 and ARC-11 on the pure rules: posting sets, rules, reversals, balances. Synthetic ids. */

const eur = (amount: string) => Money.of(amount, "EUR");
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ASSET = "00000000-0000-4000-8000-0000000000a5";
const LIAB = "00000000-0000-4000-8000-00000000001b";
const INTEREST = "00000000-0000-4000-8000-0000000000e1";
const RENT = "00000000-0000-4000-8000-0000000000e2";
const USD_ACCOUNT = "00000000-0000-4000-8000-0000000000d1";

/** Every test account is in EUR except USD_ACCOUNT; service accounts take the posting's currency. */
const currencyOf = (ref: AccountRef) => ("account" in ref && ref.account === USD_ACCOUNT ? "USD" : "EUR");
const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
const p = (debit: string, credit: string, amount: string): Posting => ({
  debit: { account: debit },
  credit: { account: credit },
  amount: eur(amount),
});

/** Per account: debits minus credits. */
function net(postings: readonly Posting[]): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const add = (ref: AccountRef, v: Decimal) =>
    out.set(refKey(ref), (out.get(refKey(ref)) ?? new Decimal(0)).plus(v));
  for (const x of postings) {
    add(x.debit, x.amount.amount);
    add(x.credit, x.amount.amount.negated());
  }
  return out;
}
const shown = (postings: readonly Posting[]) =>
  postings.map((x) => [refKey(x.debit), refKey(x.credit), x.amount.toDecimalString()]);

describe("FIN-04 FR 2: a posting set is balanced per currency before anything is written", () => {
  it("a valid set passes", () => {
    expect(code(() => assertBalanced([p(A, B, "10.5"), p(B, A, "0.000000000000000001")], currencyOf))).toBe(
      "ok",
    );
  });

  it("an empty set, a zero or negative amount, or one account on both sides is refused", () => {
    expect(code(() => assertBalanced([], currencyOf))).toBe("EMPTY_POSTING_SET");
    expect(code(() => assertBalanced([p(A, B, "0")], currencyOf))).toBe("INVALID_POSTING");
    expect(code(() => assertBalanced([p(A, B, "-1")], currencyOf))).toBe("INVALID_POSTING");
    expect(code(() => assertBalanced([p(A, A, "1")], currencyOf))).toBe("INVALID_POSTING");
    expect(
      code(() =>
        assertBalanced(
          [{ debit: { service: "adjustment" }, credit: { service: "adjustment" }, amount: eur("1") }],
          currencyOf,
        ),
      ),
    ).toBe("INVALID_POSTING");
  });

  it("an account in another currency on either side would leave a currency unbalanced", () => {
    expect(code(() => assertBalanced([p(USD_ACCOUNT, B, "5")], currencyOf))).toBe("UNBALANCED");
    expect(code(() => assertBalanced([p(A, USD_ACCOUNT, "5")], currencyOf))).toBe("UNBALANCED");
    const usd: Posting = {
      debit: { account: USD_ACCOUNT },
      credit: { service: "external-funds" },
      amount: Money.of("5", "USD"),
    };
    expect(
      code(() => assertBalanced([usd, p(A, B, "5")], (r) => ("service" in r ? "USD" : currencyOf(r)))),
    ).toBe("ok");
  });

  it(`at most ${MAX_POSTINGS} postings`, () => {
    const many = Array.from({ length: MAX_POSTINGS + 1 }, () => p(A, B, "1"));
    expect(code(() => assertBalanced(many.slice(1), currencyOf))).toBe("ok");
    expect(code(() => assertBalanced(many, currencyOf))).toBe("TOO_MANY_POSTINGS");
  });
});

describe("FIN-04 FR 3, FR 4: the posting rules", () => {
  it("FR 4: transfer — debit account B, credit account A", () => {
    expect(shown(postingsFor({ type: "transfer", from: A, to: B, amount: eur("100") }))).toEqual([
      [`a:${B}`, `a:${A}`, "100"],
    ]);
  });

  it("FR 4: purchase of an asset from an account — debit the asset (cost basis), credit the account", () => {
    expect(
      shown(postingsFor({ type: "asset-purchase", asset: ASSET, account: A, amount: eur("250000") })),
    ).toEqual([[`a:${ASSET}`, `a:${A}`, "250000"]]);
  });

  it("FR 4: revaluation up — debit the asset, credit «Резерв переоцінки»; down the other way", () => {
    expect(shown(postingsFor({ type: "asset-revaluation", asset: ASSET, change: eur("1200") }))).toEqual([
      [`a:${ASSET}`, "s:revaluation-reserve", "1200"],
    ]);
    expect(shown(postingsFor({ type: "asset-revaluation", asset: ASSET, change: eur("-300") }))).toEqual([
      ["s:revaluation-reserve", `a:${ASSET}`, "300"],
    ]);
  });

  it("FR 4: sale — debit the account, credit the asset and the realised gain; a loss is debited", () => {
    expect(
      shown(
        postingsFor({
          type: "asset-sale",
          asset: ASSET,
          account: A,
          proceeds: eur("1300"),
          basis: eur("1000"),
        }),
      ),
    ).toEqual([
      [`a:${A}`, `a:${ASSET}`, "1000"],
      [`a:${A}`, "s:realized-gain", "300"],
    ]);
    const loss = postingsFor({
      type: "asset-sale",
      asset: ASSET,
      account: A,
      proceeds: eur("800"),
      basis: eur("1000"),
    });
    expect(shown(loss)).toEqual([
      [`a:${A}`, `a:${ASSET}`, "800"],
      ["s:realized-gain", `a:${ASSET}`, "200"],
    ]);
    // The asset leaves at its whole basis either way.
    expect(net(loss).get(`a:${ASSET}`)!.toFixed()).toBe("-1000");
  });

  it("FR 4: mortgage payment — debit the liability (principal) and the interest expense, credit the account", () => {
    const event: LedgerEvent = {
      type: "mortgage-payment",
      liability: LIAB,
      interestExpense: INTEREST,
      account: A,
      principal: eur("800"),
      interest: eur("200"),
    };
    expect(shown(postingsFor(event))).toEqual([
      [`a:${LIAB}`, `a:${A}`, "800"],
      [`a:${INTEREST}`, `a:${A}`, "200"],
    ]);
    expect(shown(postingsFor({ ...event, interest: eur("0") }))).toEqual([[`a:${LIAB}`, `a:${A}`, "800"]]);
  });

  it("FR 4: rental income — debit the account, credit the asset's income", () => {
    expect(
      shown(postingsFor({ type: "rental-income", account: A, income: RENT, amount: eur("900") })),
    ).toEqual([[`a:${A}`, `a:${RENT}`, "900"]]);
  });

  it("FR 3: income and spending are one event against «Зовнішні кошти»; «Оновити залишок» against «Коригування»", () => {
    expect(shown(postingsFor({ type: "transaction", account: A, amount: eur("3150") }))).toEqual([
      [`a:${A}`, "s:external-funds", "3150"],
    ]);
    expect(shown(postingsFor({ type: "transaction", account: A, amount: eur("-42.17") }))).toEqual([
      ["s:external-funds", `a:${A}`, "42.17"],
    ]);
    expect(shown(postingsFor({ type: "balance-adjustment", account: A, amount: eur("-50") }))).toEqual([
      ["s:adjustment", `a:${A}`, "50"],
    ]);
  });

  it("an event that moves nothing, or a negative amount where only a positive one makes sense, is refused", () => {
    expect(code(() => postingsFor({ type: "transaction", account: A, amount: eur("0") }))).toBe(
      "EMPTY_POSTING_SET",
    );
    expect(code(() => postingsFor({ type: "transfer", from: A, to: B, amount: eur("-1") }))).toBe(
      "INVALID_EVENT",
    );
    expect(
      code(() =>
        postingsFor({ type: "asset-sale", asset: ASSET, account: A, proceeds: eur("1"), basis: eur("-1") }),
      ),
    ).toBe("INVALID_EVENT");
  });

  it("ARC-11: an event type without a rule is refused («невідомий тип події»), also an inherited key", () => {
    expect(code(() => postingsFor({ type: "gift" } as unknown as LedgerEvent))).toBe("UNKNOWN_EVENT_TYPE");
    expect(code(() => postingsFor({ type: "toString" } as unknown as LedgerEvent))).toBe(
      "UNKNOWN_EVENT_TYPE",
    );
    expect(EVENT_TYPES).not.toContain("reversal");
  });
});

/** A seeded generator of amounts as digit strings (never floats). */
function* randomEvents(seed: number, n: number): Generator<LedgerEvent> {
  let s = seed;
  const next = (m: number) => ((s = (s * 48271) % 2147483647), s % m);
  const amount = (signed: boolean) =>
    eur(`${signed && next(2) === 0 ? "-" : ""}${1 + next(99999)}.${String(next(100)).padStart(2, "0")}`);
  for (let i = 0; i < n; i++) {
    const kind = next(6);
    if (kind === 0) yield { type: "transaction", account: A, amount: amount(true) };
    else if (kind === 1) yield { type: "transfer", from: A, to: B, amount: amount(false) };
    else if (kind === 2) yield { type: "asset-revaluation", asset: ASSET, change: amount(true) };
    else if (kind === 3)
      yield { type: "asset-sale", asset: ASSET, account: A, proceeds: amount(false), basis: amount(false) };
    else if (kind === 4)
      yield {
        type: "mortgage-payment",
        liability: LIAB,
        interestExpense: INTEREST,
        account: B,
        principal: amount(false),
        interest: amount(false),
      };
    else yield { type: "balance-adjustment", account: B, amount: amount(true) };
  }
}

describe("ARC-11 criteria on random event sequences (property tests)", () => {
  it("FIN-04 FR 2: every posting set of every rule is balanced: debits equal credits, nothing left over", () => {
    for (const event of randomEvents(7, 500)) {
      const postings = postingsFor(event);
      expect(code(() => assertBalanced(postings, currencyOf))).toBe("ok");
      const total = [...net(postings).values()].reduce((a, b) => a.plus(b), new Decimal(0));
      expect(total.isZero()).toBe(true);
    }
  });

  it("FIN-04 FR 5: a reversal returns every account to where it was before the entry", () => {
    const all: Posting[] = [];
    for (const event of randomEvents(11, 300)) {
      const postings = postingsFor(event);
      const back = reversalOf(postings);
      expect(code(() => assertBalanced(back, currencyOf))).toBe("ok");
      for (const v of net([...postings, ...back]).values()) expect(v.isZero()).toBe(true);
      all.push(...postings, ...back);
    }
    for (const v of net(all).values()) expect(v.isZero()).toBe(true);
  });
});

describe("FIN-04 FR 6: a balance has the sign of its account type", () => {
  it("assets and expenses: debits minus credits; liabilities, equity and income: credits minus debits", () => {
    const d = eur("100");
    const c = eur("30.5");
    expect(naturalBalance("asset", d, c).toDecimalString()).toBe("69.5");
    expect(naturalBalance("expense", d, c).toDecimalString()).toBe("69.5");
    expect(naturalBalance("liability", d, c).toDecimalString()).toBe("-69.5");
    expect(naturalBalance("equity", d, c).toDecimalString()).toBe("-69.5");
    expect(naturalBalance("income", d, c).toDecimalString()).toBe("-69.5");
  });
});
