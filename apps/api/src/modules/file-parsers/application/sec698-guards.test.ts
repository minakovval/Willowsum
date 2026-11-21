import { describe, expect, it } from "vitest";
import { analyzeTable } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * Security review of #698 (IMP-02@PoC FR 4, FR 8, FR 12): the guards of #694 each have a test that fails without them.
 * Synthetic rows only: invented merchants and amounts.
 */
const UAH = { account: { currencies: ["UAH"], multiCurrency: false } } as const;
const parse = (lines: readonly string[]) =>
  parseStatement(new TextEncoder().encode(lines.join("\r\n") + "\r\n"), { delimiter: ";" }, UAH);
const roles = (lines: readonly string[]) => parse(lines).analysis.columns.map((c) => c.role.chosen.value);

describe("IMP-02@PoC FR 4: a debit or credit column is never chosen from its content alone once the amount is chosen", () => {
  // A debit/credit file without a header (date, details, debit, credit, a zero fee, balance): without the guard the
  // engine chose «debit-credit» on the fee and balance columns and imported the balances as the amounts, unflagged.
  const HEADERLESS = [
    "01.11.2026;Магазин Тест;1234,56;;0,00;8765,44",
    "03.11.2026;Зарплата Тест;;2000,00;0,00;10765,44",
    "05.11.2026;Аптека Тест;65,44;;0,00;10700,00",
    "08.11.2026;Кафе Тест;200,00;;0,00;10500,00",
    "12.11.2026;Переказ Тест;;500,00;0,00;11000,00",
  ];
  const BALANCES = ["8765.44", "10765.44", "10700.00", "10500.00", "11000.00"];

  it("IMP-02@PoC FR 4: a header-less file with four number columns gets no debit or credit role and no «debit-credit» sign", () => {
    const p = parse(HEADERLESS);
    const chosen = p.analysis.columns.map((c) => c.role.chosen.value);
    expect(chosen).not.toContain("debit");
    expect(chosen).not.toContain("credit");
    expect(p.analysis.sign!.chosen.value).not.toBe("debit-credit");
  });

  it("IMP-02@PoC FR 8: such a file is flagged, never imported with the balances as the amounts", () => {
    const p = parse(HEADERLESS);
    expect(p.events.events.map((e) => e.legs[0]?.amount)).not.toEqual(BALANCES);
    expect(p.analysis.sign!.flags).toContain("all-positive");
    expect(p.events.events.some((e) => e.flags.includes("amount-unreadable"))).toBe(true);
  });

  it("IMP-02@PoC FR 4: «Дебет» and «Кредит» with their header words keep the debit-credit sign", () => {
    const p = parse(["Дата;Опис;Дебет;Кредит;Комісія;Залишок", ...HEADERLESS]);
    expect(p.analysis.sign!.chosen.value).toBe("debit-credit");
    expect(p.events.events.map((e) => e.legs[0]!.amount)).toEqual([
      "-1234.56",
      "2000.00",
      "-65.44",
      "-200.00",
      "500.00",
    ]);
  });
});

describe("IMP-02@PoC FR 4: the code guard takes only integer codes", () => {
  it("IMP-02@PoC FR 4: a «Код» column of signed amounts with a fraction stays the amount", () => {
    expect(
      roles([
        "Дата;Опис;Код;Залишок",
        "01.11.2026;A;-12,50;987,50",
        "02.11.2026;B;-7,50;980,00",
        "03.11.2026;C;20,00;1000,00",
      ]),
    ).toEqual(["date", "description", "amount", "balance"]);
  });
});

describe("IMP-02@PoC FR 12: «–» (en dash) is an empty cell as «—» is", () => {
  it("IMP-02@PoC FR 12: a «Курс» column of «–» with one printed rate is the exchange-rate column", () => {
    const a = analyzeTable(
      [
        ["Дата", "Сума", "Курс"],
        ["01.03.2026", "-12.50", "–"],
        ["02.03.2026", "-415.00", "41.5000"],
        ["03.03.2026", "-3.00", "–"],
        ["04.03.2026", "-8.00", "–"],
      ],
      0,
    );
    expect(a.columns.map((c) => c.role.chosen.value)).toEqual(["date", "amount", "exchange-rate"]);
  });
});
