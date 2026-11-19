import { describe, expect, it } from "vitest";
import { analyzeTable, type StatementAnalysis } from "./index.ts";

const table = (lines: readonly string[]) => lines.map((l) => l.split(";"));
const roleOf = (a: StatementAnalysis, column: number) => a.columns[column - 1]!.role;

describe("IMP-06@PoC: alternatives and evidence of the engine's decisions", () => {
  it("IMP-06@PoC AC8: an ambiguous date column gives «day-month» and «month-day» with scores, examples and the evidence of the choice", () => {
    const a = analyzeTable(
      table([
        "Дата;Сума;Опис",
        "01.03.2026;-120,50;Кава",
        "02.03.2026;-5,00;Хліб",
        "11.04.2026;100,00;Повернення",
      ]),
      0,
    );
    const dates = a.dates!;
    expect(dates.chosen.value).toEqual({ order: "dmy", format: "DD.MM.YYYY" });
    expect(dates.chosen.score).toBe(0.55);
    const mdy = dates.alternatives.find((h) => h.value.order === "mdy")!;
    expect(mdy.score).toBe(0.45);
    expect(mdy.label).toBe("DD.MM.YYYY".replace("DD.MM", "MM.DD"));
    expect(dates.chosen.examples[0]).toEqual({ cell: "01.03.2026", reads: "2026-03-01" });
    expect(mdy.examples[0]).toEqual({ cell: "01.03.2026", reads: "2026-01-03" });
    expect(dates.evidence).toEqual([{ code: "no-day-over-12", count: 3 }]);
  });

  it("IMP-06@PoC FR 12: a date column with no day over 12 is read day-month at 0.55 with «порядок дати припущено»", () => {
    const a = analyzeTable(table(["Date;Amount", "01/02/2026;1.00", "03/04/2026;2.00"]), 0);
    expect(a.dates!.chosen.value.order).toBe("dmy");
    expect(a.dates!.chosen.score).toBe(0.55);
    expect(a.dates!.flags).toEqual(["date-order-assumed"]);
  });

  it("IMP-06@PoC FR 12: a cell neither order reads (a «00.00.0000» placeholder) does not hide «порядок дати припущено»", () => {
    const a = analyzeTable(
      table([
        "Дата;Сума",
        "01.03.2026;1,50",
        "02.03.2026;2,00",
        "03.04.2026;3,00",
        "04.05.2026;4,00",
        "00.00.0000;5,00",
      ]),
      0,
    );
    expect(a.dates!.chosen.value.order).toBe("dmy");
    expect(a.dates!.chosen.score).toBe(0.55);
    expect(a.dates!.flags).toEqual(["date-order-assumed"]);
    expect(a.dates!.evidence).toEqual([{ code: "no-day-over-12", count: 5 }]);
  });

  it("IMP-06@PoC FR 8: a day over 12 decides the order, the evidence names it and the other order cannot read it", () => {
    const a = analyzeTable(table(["Date;Amount", "03/25/2026;1.00", "04/01/2026;2.00"]), 0);
    const dates = a.dates!;
    expect(dates.chosen.value).toEqual({ order: "mdy", format: "MM/DD/YYYY" });
    expect(dates.chosen.score).toBe(1);
    expect(dates.flags).toEqual([]);
    expect(dates.evidence[0]).toMatchObject({ code: "month-first", count: 1, of: 2, example: "03/25/2026" });
    const dmy = dates.alternatives.find((h) => h.value.order === "dmy")!;
    expect(dmy.score).toBe(0.5);
    expect(dmy.examples[0]).toEqual({ cell: "03/25/2026", reads: null });
  });

  it("IMP-06@PoC FR 8: ISO dates are read year first", () => {
    const a = analyzeTable(table(["Date;Amount", "2026-03-25 14:05;1.00", "2026-04-01 09:00;2.00"]), 0);
    expect(a.dates!.chosen.value).toEqual({ order: "ymd", format: "YYYY-MM-DD HH:mm" });
    expect(a.dates!.evidence[0]!.code).toBe("year-first");
  });

  it("IMP-06@PoC FR 8: the number format has alternatives with live readings and the evidence of its separators", () => {
    const a = analyzeTable(
      table(["Дата;Сума;Залишок", "01.03.2026;-120,50;1 000,00", "02.03.2026;-5,00;995,00"]),
      0,
    );
    const numbers = a.numbers!;
    expect(numbers.chosen.value).toEqual({ decimalSeparator: ",", thousandsSeparator: " " });
    expect(numbers.chosen.label).toBe("1 234,56");
    expect(numbers.chosen.score).toBe(1);
    expect(numbers.chosen.examples[0]).toEqual({ cell: "-120,50", reads: "-120.50" });
    const dot = numbers.alternatives[0]!;
    expect(dot.value.decimalSeparator).toBe(".");
    expect(dot.score).toBe(0);
    expect(dot.examples[0]).toEqual({ cell: "-120,50", reads: null });
    expect(numbers.evidence).toContainEqual({
      code: "decimal-separator",
      word: ",",
      count: 4,
      of: 4,
      example: "-120,50",
    });
    expect(numbers.evidence).toContainEqual(
      expect.objectContaining({ code: "thousands-separator", word: " " }),
    );
  });

  it("IMP-06@PoC FR 11: four «d,ddd» values, at least 75 % ending in «00», are thousands and flagged «неоднозначне ціле»", () => {
    const a = analyzeTable(
      table(["Date;Amount", "01.03.2026;1,200", "02.03.2026;2,500", "03.03.2026;3,100", "04.03.2026;4,000"]),
      0,
    );
    expect(a.numbers!.chosen.value).toEqual({ decimalSeparator: ".", thousandsSeparator: "," });
    expect(a.numbers!.flags).toEqual(["ambiguous-integer"]);
    expect(a.numbers!.chosen.examples[0]).toEqual({ cell: "1,200", reads: "1200" });
    expect(a.numbers!.evidence[0]).toMatchObject({ code: "ambiguous-integers", count: 4 });
  });

  it("IMP-06@PoC FR 8: every column's role has alternatives, examples read under it and the evidence of header and content", () => {
    const a = analyzeTable(
      table([
        "Дата операції;Дата валютування;Сума;Валюта;Призначення платежу;Залишок",
        "01.03.2026;02.03.2026;-120,50;UAH;Кава;1 000,00",
        "02.03.2026;03.03.2026;-5,00;UAH;Хліб;995,00",
      ]),
      0,
    );
    expect(a.columns.map((c) => c.role.chosen.value)).toEqual([
      "date",
      "value-date",
      "amount",
      "currency",
      "description",
      "balance",
    ]);
    const amount = roleOf(a, 3);
    expect(amount.chosen.examples[0]).toEqual({ cell: "-120,50", reads: "-120.50" });
    expect(amount.alternatives.length).toBeGreaterThan(0);
    expect(amount.evidence).toEqual([
      { code: "header-word", column: 3, word: "сума" },
      { code: "content", column: 3, word: "number", count: 2, of: 2 },
    ]);
    expect(roleOf(a, 2).evidence[0]).toEqual({ code: "header-word", column: 2, word: "дата валютування" });
    expect(a.currency).toEqual({
      mode: "column",
      code: "UAH",
      evidence: [{ code: "currency-column", column: 4, word: "UAH", count: 2 }],
    });
  });

  it("IMP-06@PoC FR 8: a role one column already took goes to the next column's next hypothesis, with the evidence", () => {
    const a = analyzeTable(table(["Сума;Сума;Опис", "1,00;2,00;a", "3,00;4,00;b"]), 0);
    expect(roleOf(a, 1).chosen.value).toBe("amount");
    expect(roleOf(a, 2).chosen.value).not.toBe("amount");
    expect(roleOf(a, 2).evidence).toContainEqual({ code: "role-taken", word: "amount", column: 1 });
  });

  it("IMP-06@PoC FR 8: the sign — printed negatives, debit and credit columns, an indicator column, all positive", () => {
    const printed = analyzeTable(table(["Date;Amount", "01.03.2026;-1,50", "02.03.2026;2,00"]), 0).sign!;
    expect(printed.chosen.value).toBe("as-printed");
    expect(printed.evidence[0]).toMatchObject({
      code: "negative-amounts",
      count: 1,
      of: 2,
      example: "-1,50",
    });
    expect(printed.alternatives[0]).toMatchObject({
      value: "invert",
      examples: [
        { cell: "-1,50", reads: "1.50" },
        { cell: "2,00", reads: "-2.00" },
      ],
    });

    const split = analyzeTable(table(["Дата;Дебет;Кредит", "01.03.2026;1,50;", "02.03.2026;;2,00"]), 0).sign!;
    expect(split.chosen.value).toBe("debit-credit");
    expect(split.chosen.examples[0]).toEqual({ cell: "1,50", reads: "-1.50" });
    expect(split.evidence[0]).toEqual({ code: "debit-credit-columns", column: 2, word: "3" });

    const marked = analyzeTable(
      table(["Дата;Сума;Тип", "01.03.2026;1,50;Дт", "02.03.2026;2,00;Кт"]),
      0,
    ).sign!;
    expect(marked.chosen.value).toBe("indicator");
    expect(marked.chosen.examples).toEqual([
      { cell: "Дт 1,50", reads: "-1.50" },
      { cell: "Кт 2,00", reads: "2.00" },
    ]);
    expect(marked.evidence[0]).toEqual({ code: "indicator-column", column: 3 });

    const positive = analyzeTable(table(["Дата;Сума", "01.03.2026;1,50", "02.03.2026;2,00"]), 0).sign!;
    expect(positive.chosen.value).toBe("as-printed");
    expect(positive.flags).toEqual(["all-positive"]);
    expect(positive.alternatives[0]!.value).toBe("invert");
  });

  it("IMP-06@PoC FR 8: the table and the currency are explained (header row, rows before it, data rows; a code in a header)", () => {
    const a = analyzeTable(
      table(["Рахунок:;UA00", "Дата;Сума (EUR);Опис", "01.03.2026;-1,50;a", "02.03.2026;2,00;b"]),
      1,
    );
    expect(a.table).toEqual({
      headerRow: 2,
      dataRows: 2,
      evidence: [
        { code: "header-row", row: 2, count: 3 },
        { code: "rows-before-header", count: 1 },
        { code: "data-rows", count: 2 },
      ],
    });
    expect(a.currency).toEqual({
      mode: "file",
      code: "EUR",
      evidence: [{ code: "currency-in-header", column: 2, word: "EUR" }],
    });
    const none = analyzeTable(table(["Дата;Сума", "01.03.2026;1,50", "02.03.2026;2,00"]), 0);
    expect(none.currency).toEqual({ mode: "unknown", code: null, evidence: [{ code: "no-currency" }] });
  });

  it("IMP-06@PoC FR 8: without a header row the roles come from content alone", () => {
    const a = analyzeTable(table(["01.03.2026;-1,50;Кава", "02.03.2026;2,00;Хліб"]), null);
    expect(a.table.headerRow).toBeNull();
    expect(a.table.evidence[0]).toEqual({ code: "no-header-row" });
    expect(a.columns.map((c) => c.role.chosen.value)).toEqual(["date", "amount", "description"]);
  });

  it("IMP-06@PoC FR 9: the same table gives the same analysis, byte for byte", () => {
    const rows = table(["Дата;Сума;Опис", "01.03.2026;-120,50;Кава", "02.03.2026;-5,00;Хліб"]);
    expect(JSON.stringify(analyzeTable(rows, 0))).toBe(
      JSON.stringify(analyzeTable(structuredClone(rows), 0)),
    );
  });
});
