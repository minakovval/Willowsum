import { describe, expect, it } from "vitest";
import { historyGap, readingFits } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * IMP-05@PoC part 1 (wave 2 row 42): the statement checked against its own figures, the history gap, the evidence of
 * another account, the signs, the clarifications and the batch's flags. Synthetic statements only; IBANs are built at
 * runtime (no bank has them).
 */
const enc = (s: string) => new TextEncoder().encode(s);
type Rest = Parameters<typeof parseStatement> extends [unknown, unknown, ...infer R] ? R : never;
/** Semicolon files with comma decimals, as a recipe reads them (the delimiter is the recipe's). */
const parse = (lines: readonly string[], options: Parameters<typeof parseStatement>[1] = {}, ...rest: Rest) =>
  parseStatement(enc(lines.join("\n")), { delimiter: ";", ...options }, ...rest);
const check = (p: ReturnType<typeof parseStatement>, kind: string) =>
  p.checks.controls.find((c) => c.kind === kind)!;
const IBAN = ["UA", "21", "322313", "0000026", "007233", "564821"].join("");
const ACCOUNT_IBAN = ["UA", "21", "322313", "0000026", "007233", "561190"].join("");

const EUR_STATEMENT = [
  "Вхідний залишок:;1 000,00 EUR",
  "Дата;Сума;Опис",
  "01.03.2026;500,00;Зарплата",
  "05.03.2026;-60,00;Кава",
  "Кінцевий залишок:;1 450,00 EUR",
];

describe("IMP-05@PoC FR 1: control figures against the parsed rows", () => {
  it("IMP-05@PoC FR 1: opening 1 000,00 + rows 440,00 against closing 1 450,00 is a mismatch of 10,00 EUR", () => {
    const p = parse(EUR_STATEMENT);
    expect(p.events.events.map((e) => e.legs[0]!.amount)).toEqual(["500.00", "-60.00"]);
    expect(p.checks.figures).toMatchObject({
      opening: "1000.00",
      closing: "1450.00",
      currency: "EUR",
      rows: [1, 5],
    });
    expect(check(p, "balance-equation")).toEqual({
      kind: "balance-equation",
      status: "mismatch",
      declared: "1450.00",
      computed: "1440.00",
      difference: "10.00",
    });
    expect(p.checks.currency).toBe("EUR");
  });

  it("IMP-05@PoC FR 1: totals, the count, the period and the balance chain are verified with declared, computed and difference", () => {
    const p = parse([
      "Період: 01.03.2026 - 31.03.2026",
      "Вхідний залишок:;100,00",
      "Дата;Дебет;Кредит;Залишок;Опис",
      "01.03.2026;;50,00;150,00;Повернення",
      "02.03.2026;20,00;;130,00;Кава",
      "03.03.2026;5,50;;124,50;Хліб",
      "Разом;25,50;50,00;;",
      "Кількість операцій:;3",
      "Кінцевий залишок:;124,50",
    ]);
    const statuses = Object.fromEntries(p.checks.controls.map((c) => [c.kind, c.status]));
    expect(statuses).toEqual({
      "opening-balance": "verified",
      "closing-balance": "verified",
      "balance-equation": "verified",
      "debit-total": "verified",
      "credit-total": "verified",
      operations: "verified",
      period: "verified",
      "balance-chain": "verified",
    });
    expect(check(p, "debit-total")).toMatchObject({
      declared: "25.50",
      computed: "25.50",
      difference: "0.00",
    });
    expect(check(p, "operations")).toMatchObject({ declared: "3", computed: "3", difference: "0" });
    expect(check(p, "period")).toMatchObject({
      declared: "2026-03-01/2026-03-31",
      computed: "2026-03-01/2026-03-03",
    });
    expect(p.events.events).toHaveLength(3);
    expect(p.checks.flags).toEqual([]);
    expect(p.checks.bounds).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
      opening: "100.00",
      closing: "124.50",
      currency: null,
    });
  });

  it("IMP-05@PoC FR 1: a broken chain names its first row and the difference; the newest-first order is read too", () => {
    const broken = parse([
      "Дата;Сума;Залишок;Опис",
      "01.03.2026;-10,00;90,00;А",
      "02.03.2026;-10,00;75,00;Б",
      "03.03.2026;-10,00;65,00;В",
    ]);
    expect(check(broken, "balance-chain")).toEqual({
      kind: "balance-chain",
      status: "mismatch",
      declared: "75.00",
      computed: "80.00",
      difference: "-5.00",
      row: 3,
      breaks: 1,
    });
    const newestFirst = parse([
      "Дата;Сума;Залишок;Опис",
      "03.03.2026;-10,00;70,00;В",
      "02.03.2026;-10,00;80,00;Б",
      "01.03.2026;-10,00;90,00;А",
    ]);
    expect(check(newestFirst, "balance-chain").status).toBe("verified");
    expect(newestFirst.checks.bounds).toMatchObject({ opening: "100.00", closing: "70.00" });
  });

  it("IMP-05@PoC FR 1: exact decimals at the currency's scale — JPY 0, KWD 3 — and a wrong count or period is a mismatch", () => {
    const jpy = parse([
      "Opening balance:;1000 JPY",
      "Date;Amount;Description",
      "01.03.2026;-300;A",
      "Closing balance:;650 JPY",
    ]);
    expect(check(jpy, "balance-equation")).toMatchObject({
      declared: "650",
      computed: "700",
      difference: "-50",
    });
    const kwd = parse([
      "Opening balance:;1,000.000 KWD",
      "Date;Amount;Description",
      "2026-03-01;0.125;A",
      "2026-03-02;1,000.250;B",
      "Number of transactions:;3",
      "Period:;2026-03-02 - 2026-03-31",
      "Closing balance:;2,000.370 KWD",
    ]);
    expect(check(kwd, "balance-equation")).toMatchObject({
      declared: "2000.370",
      computed: "2000.375",
      difference: "-0.005",
    });
    expect(check(kwd, "operations")).toMatchObject({ status: "mismatch", difference: "1" });
    expect(check(kwd, "period").status).toBe("mismatch");
  });
});

describe("IMP-05@PoC FR 2: a control mismatch is a batch flag of level «перегляд»", () => {
  it("IMP-05@PoC FR 2: «розбіжність контрольних сум» carries the difference; it is never accepted silently", () => {
    expect(parse(EUR_STATEMENT).checks.flags).toEqual([
      { code: "checksum-mismatch", severity: "review", check: "balance-equation", difference: "10.00" },
    ]);
  });
});

describe("IMP-05@PoC FR 3: the history gap against the previous statement", () => {
  it("IMP-05@PoC AC2: 2026-03-31 at 2 000,00 EUR, then 2026-04-15 at 2 300,00 EUR is a gap 2026-04-01 — 2026-04-14 of 300,00", () => {
    expect(
      historyGap(
        { end: "2026-03-31", closing: "2000.00", currency: "EUR" },
        { start: "2026-04-15", opening: "2300.00", currency: "EUR" },
      ),
    ).toEqual({
      status: "gap",
      range: { from: "2026-04-01", to: "2026-04-14" },
      previousClosing: "2000.00",
      newOpening: "2300.00",
      difference: "300.00",
      currency: "EUR",
    });
  });

  it("IMP-05@PoC FR 3: the next day with the same balance is continuous; another balance is a gap; no previous is unknown", () => {
    const prev = { end: "2026-02-28", closing: "10.00", currency: "EUR" };
    expect(historyGap(prev, { start: "2026-03-01", opening: "10.00", currency: "EUR" }).status).toBe(
      "continuous",
    );
    expect(historyGap(prev, { start: "2026-03-01", opening: "12.00", currency: "EUR" })).toMatchObject({
      status: "gap",
      range: null,
      difference: "2.00",
    });
    expect(historyGap(null, { start: "2026-03-01", opening: "10.00", currency: "EUR" }).status).toBe(
      "unknown",
    );
    expect(historyGap(prev, { start: null, opening: null, currency: "EUR" }).status).toBe("unknown");
  });

  it("IMP-05@PoC EC2: periods that overlap are «перекриття» with the days both cover", () => {
    expect(
      historyGap(
        { end: "2026-03-31", closing: "5", currency: "JPY" },
        { start: "2026-03-25", opening: "7", currency: "JPY" },
      ),
    ).toMatchObject({ status: "overlap", range: { from: "2026-03-25", to: "2026-03-31" }, difference: "2" });
  });

  it("IMP-05@PoC FR 3: the parse gives the bounds the next statement is compared with", () => {
    const p = parse(EUR_STATEMENT);
    expect(p.checks.bounds).toEqual({
      start: "2026-03-01",
      end: "2026-03-05",
      opening: "1000.00",
      closing: "1450.00",
      currency: "EUR",
    });
  });
});

describe("IMP-05@PoC FR 4: another account's file", () => {
  const withIban = (iban: string) => ["Виписка", `IBAN: ${iban}`, "Дата;Сума;Опис", "01.03.2026;-1,00;А"];

  it("IMP-05@PoC FR 4: an IBAN that is not the account's is «блокування» with reasons masked to the last 4", () => {
    const p = parse(withIban(IBAN), {}, {}, { by: "iban", value: ACCOUNT_IBAN });
    expect(p.checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "iban", file: "…4821", account: "…1190" }],
    });
    expect(p.checks.flags).toContainEqual({ code: "foreign-account", severity: "block" });
    // Never more than the last 4 characters of either IBAN.
    const json = JSON.stringify(p.checks);
    expect(json).not.toContain(IBAN.slice(-5));
    expect(json).not.toContain(ACCOUNT_IBAN.slice(-5));
  });

  it("IMP-05@PoC FR 4: a card mask of another card is a reason «картка»; the account's own IBAN is a match", () => {
    const card = parse(
      ["Картка 5168 **** **** 4321", "Дата;Сума;Опис", "01.03.2026;-1,00;А"],
      {},
      {},
      {
        by: "mask",
        value: "**** 1234",
      },
    );
    expect(card.checks.account.reasons).toEqual([{ kind: "card", file: "…4321", account: "…1234" }]);
    const own = parse(withIban(IBAN), {}, {}, { by: "iban", value: IBAN });
    expect(own.checks.account).toEqual({ status: "match", reasons: [] });
    expect(own.checks.flags.map((f) => f.code)).not.toContain("foreign-account");
  });

  it("IMP-05@PoC EC3: a file in another currency than the account's is «чужий рахунок» with the reason «валюта»", () => {
    const p = parse(
      ["Дата;Сума;Валюта;Опис", "01.03.2026;-1,00;PLN;А"],
      {},
      {
        account: { currencies: ["EUR"], multiCurrency: false },
      },
    );
    expect(p.checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "currency", file: "PLN", account: "EUR" }],
    });
    expect(p.checks.flags).toContainEqual({ code: "foreign-account", severity: "block" });
  });
});

describe("IMP-05@PoC FR 5: the sign is not trusted without a basis", () => {
  const CARD = [
    "Дата;Сума;Опис",
    "01.03.2026;120,00;Магазин",
    "02.03.2026;35,50;Кафе",
    "03.03.2026;10,00;Таксі",
  ];
  const credit = { account: { currencies: ["EUR"], multiCurrency: false, kind: "credit-card" } };

  it("IMP-05@PoC AC4: a card statement without a balance column — signs held by card features are «знак не підтверджено», ≤ 0,6, a group of their own", () => {
    const p = parse(CARD, {}, credit);
    expect(p.checks.signs.rows.map((r) => [r.row, r.basis, r.confirmed])).toEqual([
      [2, "card", false],
      [3, "card", false],
      [4, "card", false],
    ]);
    expect(p.checks.signs.rows.every((r) => r.confidence <= 0.6)).toBe(true);
    expect(p.checks.signs.unconfirmed).toEqual([2, 3, 4]);
  });

  it("IMP-05@PoC FR 5: bases rank from the balance chain down; the chain and the debit/credit columns confirm a sign", () => {
    const chained = parse([
      "Дата;Сума;Залишок;Опис",
      "01.03.2026;10,00;110,00;А",
      "02.03.2026;5,00;115,00;Б",
    ]);
    // The oldest row links to an opening balance the file does not declare: only the majority holds it.
    expect(chained.checks.signs.rows.map((r) => [r.basis, r.confirmed])).toEqual([
      ["majority", false],
      ["balance-chain", true],
    ]);
    const columns = parse(["Дата;Дебет;Кредит;Опис", "01.03.2026;10,00;;А", "02.03.2026;;5,00;Б"]);
    expect(columns.checks.signs.rows.map((r) => r.basis)).toEqual(["debit-credit", "debit-credit"]);
    expect(columns.checks.signs.unconfirmed).toEqual([]);
    const totals = parse(EUR_STATEMENT.map((l) => l.replace("1 450,00", "1 440,00")));
    expect(totals.checks.signs.rows.map((r) => r.basis)).toEqual(["totals", "totals"]);
  });
});

describe("IMP-05@PoC FR 6: a credit card with mostly positive rows", () => {
  it("IMP-05@PoC AC5: unconfirmed signs, most rows positive — the batch flag «знак картки» with the counts", () => {
    const p = parse(
      ["Дата;Сума;Опис", "01.03.2026;120,00;Магазин", "02.03.2026;35,50;Кафе", "03.03.2026;10,00;Таксі"],
      {},
      { account: { currencies: ["EUR"], multiCurrency: false, kind: "credit-card" } },
    );
    expect(p.checks.flags).toContainEqual({
      code: "card-sign",
      severity: "review",
      positive: 3,
      negative: 0,
    });
    const current = parse(
      ["Дата;Сума;Опис", "01.03.2026;120,00;Магазин"],
      {},
      {
        account: { currencies: ["EUR"], multiCurrency: false, kind: "current" },
      },
    );
    expect(current.checks.flags.map((f) => f.code)).not.toContain("card-sign");
  });
});

describe("IMP-05@PoC FR 7: ambiguous amounts need clarification", () => {
  it("IMP-05@PoC FR 7: «1.234» with no evidence in the file has both readings, 1,234 and 1 234", () => {
    const p = parse(["Дата;Сума;Опис", "13.03.2026;1.234;А", "14.03.2026;12.345;Б"]);
    expect(p.checks.clarifications).toEqual([
      {
        kind: "amount",
        row: 2,
        cell: "1.234",
        readings: [
          { decimal: ",", value: "1234" },
          { decimal: ".", value: "1.234" },
        ],
      },
      {
        kind: "amount",
        row: 3,
        cell: "12.345",
        readings: [
          { decimal: ",", value: "12345" },
          { decimal: ".", value: "12.345" },
        ],
      },
    ]);
  });

  it("IMP-05@PoC FR 7: a reading with more decimals than the currency has is rejected; then the currency settles it", () => {
    expect(readingFits("1.234", "EUR")).toBe(false);
    expect(readingFits("1234", "EUR")).toBe(true);
    expect(readingFits("1.234", "KWD")).toBe(true);
    expect(readingFits("1.5", "JPY")).toBe(false);
    const eur = parse(["Дата;Сума;Валюта;Опис", "13.03.2026;1.234;EUR;А"]);
    expect(eur.checks.clarifications).toEqual([]);
    const evidence = parse(["Дата;Сума;Опис", "13.03.2026;1.234;А", "14.03.2026;1.234,50;Б"]);
    expect(evidence.checks.clarifications).toEqual([]);
  });
});

describe("IMP-05@PoC FR 8: an order of day and month nothing settles", () => {
  it("IMP-05@PoC FR 8: dates read both ways are one clarification for the file with both readings", () => {
    const p = parse(["Дата;Сума;Опис", "01.03.2026;-1,00;А", "02.03.2026;-2,00;Б"]);
    expect(p.checks.clarifications).toEqual([
      {
        kind: "date-order",
        rows: 2,
        example: {
          cell: "01.03.2026",
          readings: [
            { order: "dmy", value: "2026-03-01" },
            { order: "mdy", value: "2026-01-03" },
          ],
        },
      },
    ]);
    expect(
      parse(["Дата;Сума;Опис", "13.03.2026;-1,00;А", "02.03.2026;-2,00;Б"]).checks.clarifications,
    ).toEqual([]);
  });
});

describe("IMP-05@PoC FR 9: other batch flags", () => {
  it("IMP-05@PoC FR 9: formula cells, no transactions, a balance not checked — each a flag of level «перегляд»", () => {
    const formulas = parse([
      "Дата;Сума;Опис",
      '13.03.2026;-1,00;=HYPERLINK("x")',
      "14.03.2026;-2,00;+SUM(A1)",
    ]);
    expect(formulas.checks.flags).toContainEqual({ code: "formula-cells", severity: "review", count: 2 });
    const empty = parse(["Дата;Сума;Опис"]);
    expect(empty.checks.flags.map((f) => [f.code, f.severity])).toEqual([
      ["balance-not-checked", "review"],
      ["no-transactions", "review"],
    ]);
  });
});

describe("IMP-05@PoC EC1: a statement without its figures", () => {
  it("IMP-05@PoC EC1: every check is «не перевірялося» and the batch has «залишок не перевірявся»", () => {
    const p = parse(["Дата;Сума;Опис", "13.03.2026;-1,00;А", "14.03.2026;-2,00;Б"]);
    expect(p.checks.controls.every((c) => c.status === "not-checked")).toBe(true);
    expect(p.checks.flags).toEqual([{ code: "balance-not-checked", severity: "review" }]);
  });
});
