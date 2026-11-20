import { describe, expect, it } from "vitest";
import { readCardDebt, type StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * IMP-05@PoC FR 6, Рішення власника (2026-11-20), п. 6: on an account of kind «кредитна картка» a positive printed
 * balance is the debt. The sign basis of the balances, the opening and the closing is inverted only when the balance
 * chain confirms it; the rows' amounts are never inverted (a reading that inverts them is the printed chain negated and
 * confirms nothing: Рішення ведучого (2026-11-20; власник не схвалював; #643)). Otherwise the batch gets «знак картки»
 * and the statement's totals and chain confirm no sign. Synthetic statements only.
 */
const enc = (s: string) => new TextEncoder().encode(s);
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines.join("\n")), { delimiter: ";" }, statement);
const account = (kind: string): StatementOptions => ({
  account: { currencies: ["EUR"], multiCurrency: false, kind },
});
const CREDIT = account("credit-card");
const amounts = (p: ReturnType<typeof parse>) => p.events.events.map((e) => e.legs[0]!.amount);
const balances = (p: ReturnType<typeof parse>) => p.events.events.map((e) => e.balance);
const status = (p: ReturnType<typeof parse>, kind: string) =>
  p.checks.controls.find((c) => c.kind === kind)!.status;
const codes = (p: ReturnType<typeof parse>) => p.checks.flags.map((f) => f.code);

/** Debt printed positive, purchases printed positive, a repayment negative: the chain holds as printed. */
const DEBT_POSITIVE_ROWS = [
  "Вхідний залишок:;100,00",
  "Дата;Сума;Залишок;Опис",
  "01.03.2026;50,00;150,00;Магазин",
  "02.03.2026;20,00;170,00;Кафе",
  "03.03.2026;-30,00;140,00;Погашення",
  "04.03.2026;0,00;140,00;Перевірка картки",
  "Кінцевий залишок:;140,00",
];

describe("IMP-05@PoC FR 6: a credit card's positive balance is debt when the balance chain confirms it", () => {
  it("IMP-05@PoC FR 6: purchases printed positive — the chain holds as printed and confirms no debt basis: nothing is inverted, «знак картки»", () => {
    const p = parse(DEBT_POSITIVE_ROWS, CREDIT);
    expect(amounts(p)).toEqual(["50.00", "20.00", "-30.00", "0.00"]);
    expect(balances(p)).toEqual(["150.00", "170.00", "140.00", "140.00"]);
    expect(p.checks.figures).toMatchObject({ opening: "100.00", closing: "140.00" });
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    // Neither the chain nor the totals confirm a sign then; the column that prints both signs is a basis of its own.
    expect(p.checks.signs.rows.map((r) => r.basis)).toEqual([
      "printed-both-signs",
      "printed-both-signs",
      "printed-both-signs",
      "printed-both-signs",
    ]);
    expect(p.checks.flags).toContainEqual({
      code: "card-sign",
      severity: "review",
      positive: 2,
      negative: 1,
    });
  });

  it("IMP-05@PoC FR 6: a card that prints purchases negative and the debt positive keeps its amounts; the balances, opening and closing are inverted and the chain confirms every row", () => {
    const p = parse(
      [
        "Вхідний залишок:;100,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;-50,00;150,00;Магазин",
        "02.03.2026;-20,00;170,00;Кафе",
        "03.03.2026;30,00;140,00;Погашення",
        "04.03.2026;0,00;140,00;Перевірка картки",
        "Кінцевий залишок:;140,00",
      ],
      CREDIT,
    );
    expect(amounts(p)).toEqual(["-50.00", "-20.00", "30.00", "0.00"]);
    expect(balances(p)).toEqual(["-150.00", "-170.00", "-140.00", "-140.00"]);
    expect(p.checks.figures).toMatchObject({ opening: "-100.00", closing: "-140.00" });
    expect(p.checks.cardDebt).toEqual({ status: "inverted" });
    for (const kind of ["opening-balance", "closing-balance", "balance-equation", "balance-chain"])
      expect(status(p, kind)).toBe("verified");
    expect(p.checks.controls.find((c) => c.kind === "balance-equation")).toMatchObject({
      declared: "-140.00",
      computed: "-140.00",
      difference: "0.00",
    });
    expect(p.checks.bounds).toMatchObject({ opening: "-100.00", closing: "-140.00" });
    expect(p.checks.signs.rows.map((r) => [r.basis, r.confirmed])).toEqual([
      ["balance-chain", true],
      ["balance-chain", true],
      ["balance-chain", true],
      ["balance-chain", true],
    ]);
    expect(codes(p)).not.toContain("card-sign");
  });

  it("IMP-05@PoC FR 6: without a balance chain nothing is inverted — the totals confirm no sign and the batch has «знак картки» (#632 follow-up)", () => {
    const lines = [
      "Вхідний залишок:;100,00",
      "Дата;Сума;Опис",
      "01.03.2026;50,00;Магазин",
      "02.03.2026;20,00;Кафе",
      "Кінцевий залишок:;170,00",
    ];
    const p = parse(lines, CREDIT);
    expect(amounts(p)).toEqual(["50.00", "20.00"]);
    expect(p.checks.figures).toMatchObject({ opening: "100.00", closing: "170.00" });
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(p.checks.signs.rows.map((r) => [r.basis, r.confirmed])).toEqual([
      ["card", false],
      ["card", false],
    ]);
    expect(p.checks.signs.unconfirmed).toEqual([3, 4]);
    expect(p.checks.flags).toContainEqual({
      code: "card-sign",
      severity: "review",
      positive: 2,
      negative: 0,
    });
    // The same file on a current account: the totals confirm the printed signs, as before.
    const current = parse(lines, account("current"));
    expect(current.checks.cardDebt).toBeNull();
    expect(current.checks.signs.rows.map((r) => r.basis)).toEqual(["totals", "totals"]);
    expect(codes(current)).not.toContain("card-sign");
  });

  it("IMP-05@PoC FR 6: a broken chain confirms no row in the debt basis — «знак картки» whatever the majority", () => {
    const partly = parse(
      [
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;150,00;Магазин",
        "02.03.2026;20,00;170,00;Кафе",
        "03.03.2026;10,00;999,00;Таксі",
      ],
      CREDIT,
    );
    expect(partly.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(partly)).toEqual(["50.00", "20.00", "10.00"]);
    expect(balances(partly)).toEqual(["150.00", "170.00", "999.00"]);
    // The printed chain holds for row 3, but in the debt basis it confirms nothing.
    expect(partly.checks.signs.rows.map((r) => r.basis)).toEqual(["card", "card", "card"]);
    const negativeRows = parse(
      [
        "Вхідний залишок:;100,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;-50,00;150,00;Магазин",
        "02.03.2026;-20,00;999,00;Кафе",
      ],
      CREDIT,
    );
    expect(negativeRows.checks.flags).toContainEqual({
      code: "card-sign",
      severity: "review",
      positive: 0,
      negative: 2,
    });
    // Rows of zero satisfy both readings: the chain decides nothing.
    const zeros = parse(
      ["Дата;Сума;Залишок;Опис", "01.03.2026;0,00;50,00;А", "02.03.2026;0,00;50,00;Б"],
      CREDIT,
    );
    expect(zeros.checks.cardDebt).toEqual({ status: "unconfirmed" });
    // A declared opening against the chain's: the chain alone is not enough.
    const against = parse(
      [
        "Вхідний залишок:;10,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;150,00;Магазин",
        "02.03.2026;20,00;170,00;Кафе",
      ],
      CREDIT,
    );
    expect(against.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(against)).toEqual(["50.00", "20.00"]);
    const closingAgainst = parse(
      [
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;150,00;Магазин",
        "02.03.2026;20,00;170,00;Кафе",
        "Кінцевий залишок:;999,00",
      ],
      CREDIT,
    );
    expect(closingAgainst.checks.cardDebt).toEqual({ status: "unconfirmed" });
    const single = parse(["Дата;Сума;Залишок;Опис", "01.03.2026;50,00;150,00;Магазин"], CREDIT);
    expect(single.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(codes(single)).toContain("card-sign");
  });

  it("IMP-05@PoC FR 6: the rule applies only to a credit card with a positive printed balance and no negative one", () => {
    const debit = parse(DEBT_POSITIVE_ROWS, account("debit-card"));
    expect(debit.checks.cardDebt).toBeNull();
    expect(amounts(debit)).toEqual(["50.00", "20.00", "-30.00", "0.00"]);
    const assetBasis = parse(
      [
        "Вхідний залишок:;-100,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;-50,00;-150,00;Магазин",
        "02.03.2026;-20,00;-170,00;Кафе",
      ],
      CREDIT,
    );
    expect(assetBasis.checks.cardDebt).toBeNull();
    expect(amounts(assetBasis)).toEqual(["-50.00", "-20.00"]);
    expect(balances(assetBasis)).toEqual(["-150.00", "-170.00"]);
    expect(assetBasis.checks.signs.rows.map((r) => r.basis)).toEqual(["balance-chain", "balance-chain"]);
    const mixed = parse(
      ["Дата;Сума;Залишок;Опис", "01.03.2026;-50,00;20,00;Магазин", "02.03.2026;-30,00;-10,00;Кафе"],
      CREDIT,
    );
    expect(mixed.checks.cardDebt).toBeNull();
    const zero = parse(
      ["Дата;Сума;Залишок;Опис", "01.03.2026;10,00;0,00;А", "02.03.2026;-10,00;0,00;Б"],
      CREDIT,
    );
    expect(zero.checks.cardDebt).toBeNull();
  });

  it("IMP-05@PoC FR 6: balances are inverted exactly at their printed scale; a zero carries no sign; the amounts are kept", () => {
    const events = {
      events: [
        {
          row: 2,
          date: "2026-03-01",
          valueDate: null,
          currency: "KWD",
          legs: [{ amount: "-0.125", currency: "KWD" }],
          fee: null,
          balance: "0.125",
          original: null,
          rate: null,
          description: null,
          counterparty: null,
          reference: null,
          currencyMark: null,
          flags: [],
        },
        {
          row: 3,
          date: "2026-03-02",
          valueDate: null,
          currency: "KWD",
          legs: [{ amount: "0.125", currency: "KWD" }],
          fee: null,
          balance: "0.000",
          original: null,
          rate: null,
          description: null,
          counterparty: null,
          reference: null,
          currencyMark: null,
          flags: [],
        },
      ],
      currencies: ["KWD"],
      country: null,
    } as const;
    const figures = {
      opening: "0.000",
      closing: "0.000",
      debitTotal: null,
      creditTotal: null,
      operations: null,
      period: null,
      currency: "KWD",
      rows: [],
    };
    const read = readCardDebt(events, figures, "credit-card");
    expect(read.debt).toEqual({ status: "inverted" });
    expect(read.events.events.map((e) => [e.legs[0]!.amount, e.balance])).toEqual([
      ["-0.125", "-0.125"],
      ["0.125", "0.000"],
    ]);
    expect(read.figures).toMatchObject({ opening: "0.000", closing: "0.000" });
    // The input is not changed.
    expect(events.events[0]!.balance).toBe("0.125");
    expect(readCardDebt(events, figures, undefined).debt).toBeNull();
  });
});
