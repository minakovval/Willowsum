import { Decimal as KernelDecimal } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { checkControls, readCardDebt, type StatementEvents, type StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * Security review of #643 (IMP-05@PoC FR 6, the credit card's debt basis): what a statement can make `readCardDebt`
 * do to the sign of money. Synthetic statements only.
 */
const Decimal = KernelDecimal.clone({ precision: 120 });
const enc = (s: string) => new TextEncoder().encode(s);
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines.join("\n")), { delimiter: ";" }, statement);
const account = (kind: string): StatementOptions => ({
  account: { currencies: ["EUR"], multiCurrency: false, kind },
});
const CREDIT = account("credit-card");
const amounts = (p: ReturnType<typeof parse>) => p.events.events.map((e) => e.legs[0]!.amount);
const balances = (p: ReturnType<typeof parse>) => p.events.events.map((e) => e.balance);
const codes = (p: ReturnType<typeof parse>) => p.checks.flags.map((f) => f.code);

/** The ordinary basis: the card holds the customer's own money (an overpaid card), a purchase is negative. */
const ORDINARY_ROWS = [
  "Вхідний залишок:;500,00",
  "Дата;Сума;Залишок;Опис",
  "01.03.2026;-50,00;450,00;Магазин",
  "02.03.2026;-20,00;430,00;Кафе",
  "03.03.2026;-30,00;400,00;Аптека",
  "04.03.2026;100,00;500,00;Поповнення",
  "Кінцевий залишок:;500,00",
];

const event = (row: number, amount: string | null, balance: string | null, date = "2026-03-01") => ({
  row,
  date,
  valueDate: null,
  currency: "EUR",
  legs: amount === null ? [] : [{ amount, currency: "EUR" }],
  fee: null,
  balance,
  original: null,
  rate: null,
  description: null,
  counterparty: null,
  reference: null,
  currencyMark: null,
  flags: [],
});
const figures = (opening: string | null, closing: string | null) => ({
  opening,
  closing,
  debitTotal: null,
  creditTotal: null,
  operations: null,
  period: null,
  currency: "EUR",
  rows: [],
});
const statement = (events: readonly ReturnType<typeof event>[]): StatementEvents =>
  ({ events, currencies: ["EUR"], country: null }) as StatementEvents;

describe("sec643: a statement never flips the sign of money without a check the user sees", () => {
  it("sec643 IMP-05@PoC FR 6: a statement printed in the ordinary basis (purchases negative, the balance falls) is not inverted — «знак картки» (lead decision, #643)", () => {
    // The chain of this statement holds as printed, so the reading «everything negated» holds too: that is all the
    // chain says of it. It does not tell the debt basis from the ordinary one: nothing is inverted, «знак картки».
    const p = parse(ORDINARY_ROWS, CREDIT);
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(p)).toEqual(["-50.00", "-20.00", "-30.00", "100.00"]);
    expect(balances(p)).toEqual(["450.00", "430.00", "400.00", "500.00"]);
    expect(p.checks.figures).toMatchObject({ opening: "500.00", closing: "500.00" });
    // The chain and the totals confirm no sign then; the batch has «знак картки».
    for (const r of p.checks.signs.rows) expect(["balance-chain", "totals"]).not.toContain(r.basis);
    expect(codes(p)).toContain("card-sign");
  });

  it("sec643 IMP-05@PoC FR 6: one row with a declared opening and closing balance has no chain — nothing is inverted, «знак картки»", () => {
    const p = parse(
      [
        "Вхідний залишок:;100,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;150,00;Магазин",
        "Кінцевий залишок:;150,00",
      ],
      CREDIT,
    );
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(p)).toEqual(["50.00"]);
    expect(balances(p)).toEqual(["150.00"]);
    expect(p.checks.figures).toMatchObject({ opening: "100.00", closing: "150.00" });
    expect(codes(p)).toContain("card-sign");
    expect(p.checks.signs.rows.every((r) => !r.confirmed)).toBe(true);
  });

  it("sec643 IMP-05@PoC FR 6: a row without a balance leaves no chain — nothing is inverted, «знак картки»", () => {
    const p = parse(
      [
        "Вхідний залишок:;100,00",
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;150,00;Магазин",
        "02.03.2026;20,00;;Кафе",
        "03.03.2026;10,00;180,00;Кіно",
        "Кінцевий залишок:;180,00",
      ],
      CREDIT,
    );
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(p)).toEqual(["50.00", "20.00", "10.00"]);
    expect(codes(p)).toContain("card-sign");
  });

  it("sec643 IMP-05@PoC FR 6: a chain both readings satisfy (equal amounts) confirms nothing", () => {
    const p = parse(
      [
        "Дата;Сума;Залишок;Опис",
        "01.03.2026;50,00;100,00;А",
        "02.03.2026;50,00;150,00;Б",
        "03.03.2026;50,00;200,00;В",
      ],
      CREDIT,
    );
    expect(p.checks.cardDebt).toEqual({ status: "unconfirmed" });
    expect(amounts(p)).toEqual(["50.00", "50.00", "50.00"]);
    expect(balances(p)).toEqual(["100.00", "150.00", "200.00"]);
    expect(codes(p)).toContain("card-sign");
  });

  it("sec643 IMP-05@PoC FR 6: the account's kind decides, never the file — a card number in the file inverts nothing on another kind or with no kind", () => {
    const lines = [
      "Картка:;**** **** **** 4821",
      "Кредитна картка",
      ...ORDINARY_ROWS.slice(0, 1),
      "Дата;Сума;Залишок;Опис",
      "01.03.2026;50,00;550,00;Магазин",
      "02.03.2026;20,00;570,00;Кафе",
    ];
    for (const statementOptions of [
      account("debit-card"),
      account("current"),
      account("loan"),
      {},
      { account: { currencies: ["EUR"], multiCurrency: false } },
    ]) {
      const p = parse(lines, statementOptions);
      expect(p.checks.cardDebt).toBeNull();
      expect(amounts(p)).toEqual(["50.00", "20.00"]);
      expect(balances(p)).toEqual(["550.00", "570.00"]);
    }
    for (const kind of ["Credit-Card", "credit-card ", "creditcard", "", "__proto__"])
      expect(
        readCardDebt(
          statement([event(2, "50.00", "150.00"), event(3, "20.00", "170.00")]),
          figures("100.00", null),
          kind,
        ).debt,
      ).toBeNull();
  });

  it("sec643 IMP-05@PoC FR 6: cells of 64 characters are inverted exactly, digit for digit, and a difference in the last decimal breaks the confirmation", () => {
    const wide = (units: string) => `${"9".repeat(44)}${units}.${"1".repeat(17)}`;
    const a1 = `${"7".repeat(40)}.${"3".repeat(18)}`;
    const a2 = new Decimal(a1).plus("0.5").toFixed(18);
    const b0 = `1${"0".repeat(45)}.${"0".repeat(17)}1`;
    // The debt basis with purchases printed negative: the debt grows by each purchase.
    const b1 = new Decimal(b0).plus(a1).toFixed(18);
    const b2 = new Decimal(b1).plus(a2).toFixed(18);
    const exact = readCardDebt(
      statement([event(2, `-${wide("1")}`, b0), event(3, `-${a1}`, b1), event(4, `-${a2}`, b2)]),
      figures(null, b2),
      "credit-card",
    );
    expect(exact.debt).toEqual({ status: "inverted" });
    expect(exact.events.events.map((e) => e.balance)).toEqual([`-${b0}`, `-${b1}`, `-${b2}`]);
    expect(exact.events.events[1]!.legs[0]!.amount).toBe(`-${a1}`);
    expect(exact.figures.closing).toBe(`-${b2}`);
    // One unit of the 18th decimal off, 63 digits down: the chain is broken and nothing is inverted.
    const off = new Decimal(b1).plus("0.000000000000000001").toFixed(18);
    const broken = readCardDebt(
      statement([event(2, `-${wide("1")}`, b0), event(3, `-${a1}`, off), event(4, `-${a2}`, b2)]),
      figures(null, b2),
      "credit-card",
    );
    expect(broken.debt).toEqual({ status: "unconfirmed" });
    expect(broken.events.events.map((e) => e.balance)).toEqual([b0, off, b2]);
  });

  it("sec643 IMP-05@PoC FR 6: over random statements an inversion changes only the balances' signs, keeps the amounts and every other field, comes only from the debt basis with purchases printed negative and is confirmed by the checks; otherwise the reading is the input itself", () => {
    // A small deterministic generator (no clock, no Math.random).
    let seed = 643;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // The high bits: the low bits of a power-of-two LCG cycle too briefly to spread the shapes.
      return Math.floor(seed / 65_536) % n;
    };
    const cents = (n: number) => new Decimal(n).div(100).toFixed(2);
    let inverted = 0;
    let unconfirmed = 0;
    for (let round = 0; round < 3000; round++) {
      const shape = next(6);
      const length = 1 + next(6);
      let balance = 100 + next(100_000);
      const opening = balance;
      const events = [];
      for (let i = 0; i < length; i++) {
        const magnitude = next(5) === 0 ? 0 : 1 + next(20_000);
        const purchase = next(4) !== 0;
        // 0, 1: the debt basis, purchases printed positive / negative; 2: the ordinary basis; 3–5: noise.
        const printed =
          shape === 1
            ? purchase
              ? -magnitude
              : magnitude
            : shape === 2
              ? purchase
                ? -magnitude
                : magnitude
              : purchase
                ? magnitude
                : -magnitude;
        balance += shape === 2 ? printed : purchase ? magnitude : -magnitude;
        const noisy = shape >= 3 && next(3) === 0 ? balance + next(3) - 1 : balance;
        events.push(
          event(
            i + 2,
            shape === 5 && next(4) === 0 ? null : cents(printed),
            shape === 4 && next(5) === 0 ? null : cents(noisy),
            `2026-03-${String(1 + i).padStart(2, "0")}`,
          ),
        );
      }
      const input = statement(next(2) === 0 ? events : [...events].reverse());
      const declared = figures(next(2) === 0 ? cents(opening) : null, next(2) === 0 ? cents(balance) : null);
      const before = JSON.stringify([input, declared]);
      const read = readCardDebt(input, declared, "credit-card");
      expect(JSON.stringify([input, declared])).toBe(before);
      if (read.debt?.status !== "inverted") {
        expect(read.events).toBe(input);
        expect(read.figures).toBe(declared);
        if (read.debt) unconfirmed++;
        continue;
      }
      inverted++;
      // Only the debt basis with purchases printed negative is ever inverted: a chain that holds as printed (purchases
      // printed positive, the ordinary basis) confirms nothing.
      expect(shape).toBe(1);
      read.events.events.forEach((e, i) => {
        const was = input.events[i]!;
        expect({ ...e, balance: null, legs: [] }).toEqual({ ...was, balance: null, legs: [] });
        expect(e.balance === null ? null : new Decimal(e.balance).neg().toFixed(2)).toBe(
          was.balance === null ? null : new Decimal(was.balance).toFixed(2),
        );
        expect(e.legs.length).toBe(was.legs.length);
        e.legs.forEach((l, j) => {
          const printed = new Decimal(was.legs[j]!.amount);
          expect(l.amount).toBe(was.legs[j]!.amount);
          expect(new Decimal(l.amount).eq(printed)).toBe(true);
          expect(l.amount).not.toBe("-0.00");
          expect(l.currency).toBe(was.legs[j]!.currency);
        });
      });
      const checks = checkControls(read.figures, read.events).checks;
      const status = (kind: string) => checks.find((c) => c.kind === kind)!.status;
      expect(status("balance-chain")).toBe("verified");
      expect(status("opening-balance")).not.toBe("mismatch");
      expect(status("closing-balance")).not.toBe("mismatch");
      // No balance of the inverted reading is positive: the gate (no negative printed balance) holds.
      for (const e of read.events.events) expect(new Decimal(e.balance!).lte(0)).toBe(true);
    }
    expect(inverted).toBeGreaterThan(100);
    expect(unconfirmed).toBeGreaterThan(100);
  });
});
