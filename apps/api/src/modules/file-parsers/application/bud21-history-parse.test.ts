import { describe, expect, it } from "vitest";
import { parseHistory } from "./parse-history.ts";

/**
 * BUD-21@PoC «Правила з історії розбору», row 233: a history file read with the roles of the user's own columns. Every
 * name, amount and label is synthetic.
 */
const csv = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n") + "\r\n");

const FULL = csv([
  "Дата;Сума;Опис;Категорія;Підкатегорія;Тип;Теги;Рахунок",
  "01.03.2026;-120,50;SILPO 1234 KYIV;Їжа;Супермаркети;витрата;родина;Моно",
  "02.03.2026;-45,00;Кав'ярня «Вигадка»;Кав'ярні;;витрата;;Готівка",
  "03.03.2026;-1 000,00;На свою картку;;;переказ;;Моно",
  "04.03.2026;25 000,00;Зарплата ТОВ «Синтетика»;Дохід;Зарплата;дохід;робота;Моно",
  "05.03.2026;-60,00;Невідомо;;;витрата;;Моно",
]);

const roles = (p: ReturnType<typeof parseHistory>) => p.columns.map((c) => c.role.chosen.value);

describe("BUD-21@PoC FR 4: the structure and the roles of a history file", () => {
  it("BUD-21@PoC FR 4: the statement's roles and the user's own — category, subcategory, transfer mark, tags, account — each with evidence and alternatives", () => {
    const p = parseHistory(FULL);
    expect(p.reading.delimiter.chosen.delimiter).toBe(";");
    expect(p.dates!.chosen.value.order).toBe("dmy");
    expect(p.numbers!.chosen.value.decimalSeparator).toBe(",");
    expect(roles(p)).toEqual([
      "date",
      "amount",
      "description",
      "category",
      "subcategory",
      "transfer-flag",
      "tags",
      "account",
    ]);
    const category = p.columns[3]!.role;
    expect(category.evidence[0]).toMatchObject({ code: "header-word", column: 4, word: "категорія" });
    // The statement engine's own reading of the column stays an alternative.
    expect(category.alternatives.length).toBeGreaterThan(0);
    expect(category.chosen.examples[0]).toEqual({ cell: "Їжа", reads: "Їжа" });
    // «Тип» is a transfer column only because it holds a transfer mark.
    expect(p.columns[5]!.role.evidence.map((e) => e.code)).toContain("transfer-values");
    expect(p.missing).toEqual([]);
  });

  it("BUD-21@PoC FR 5: the rows as read — date, amount, description, category, subcategory, transfer mark, tags, account", () => {
    const p = parseHistory(FULL);
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0]).toMatchObject({
      row: 2,
      date: "2026-03-01",
      amount: "-120.50",
      description: "SILPO 1234 KYIV",
      category: "Їжа",
      subcategory: "Супермаркети",
      transferMark: "витрата",
      tags: "родина",
      account: "Моно",
    });
    expect(p.rows[2]).toMatchObject({ amount: "-1000.00", category: null, transferMark: "переказ" });
    // The user's columns never become a part of the bank's description.
    expect(p.rows[1]!.description).toBe("Кав'ярня «Вигадка»");
  });

  it("BUD-21@PoC FR 5: the values of the transfer column with their counts, those that mark a transfer suggested", () => {
    const p = parseHistory(FULL);
    expect(p.transfers).toEqual({
      values: [
        { value: "витрата", count: 3, transfer: false },
        { value: "дохід", count: 1, transfer: false },
        { value: "переказ", count: 1, transfer: true },
      ],
      more: false,
    });
  });

  it("BUD-21@PoC FR 4: a column headed «Переказ» marks transfers with «так»", () => {
    const p = parseHistory(
      csv([
        "Дата;Сума;Опис;Категорія;Переказ",
        "01.03.2026;-10,00;Кава;Кафе;",
        "02.03.2026;-500,00;Своя картка;;так",
      ]),
    );
    expect(roles(p)[4]).toBe("transfer-flag");
    expect(p.transfers.values).toEqual([{ value: "так", count: 1, transfer: true }]);
  });

  it("BUD-21@PoC AC3: a history file without a description and a counterparty column — rules cannot be derived, the description is missing", () => {
    const p = parseHistory(csv(["Дата;Сума;Категорія", "01.03.2026;-10,00;Кафе", "02.03.2026;-20,00;Кафе"]));
    expect(p.missing).toEqual(["description"]);
  });

  it("BUD-21@PoC AC4: date, amount and description but no category and no transfer mark — the user's categorisation is missing", () => {
    const p = parseHistory(csv(["Дата;Сума;Опис", "01.03.2026;-10,00;Кава", "02.03.2026;-20,00;Хліб"]));
    expect(roles(p)).toEqual(["date", "amount", "description"]);
    expect(p.missing).toEqual(["categories"]);
  });
});

describe("BUD-21@PoC FR 6: the user's corrections read the file again", () => {
  const US = csv([
    "Date;Amount;Description;Category",
    "01/02/2026;-10.00;Coffee;Cafe",
    "03/04/2026;-20.00;Bread;Groceries",
    "03/15/2026;-30.00;Fuel;Car",
  ]);

  it("BUD-21@PoC AC9: dates read as month-day, the user picks day-month — the rows are read again with it", () => {
    const read = parseHistory(US);
    expect(read.dates!.chosen.value.order).toBe("mdy");
    expect(read.rows.map((r) => r.date)).toEqual(["2026-01-02", "2026-03-04", "2026-03-15"]);
    const again = parseHistory(US, {}, { dateOrder: "dmy" });
    expect(again.dates!.chosen.value.order).toBe("dmy");
    expect(again.dates!.evidence[0]).toEqual({ code: "user-choice" });
    expect(again.rows.map((r) => r.date)).toEqual(["2026-02-01", "2026-04-03", null]);
    expect(again.rows[2]!.flags).toContain("date-unreadable");
  });

  it("BUD-21@PoC FR 6: a column's role changed by the user — a single role leaves the column that had it", () => {
    const p = parseHistory(FULL, {}, { columns: [{ column: 6, role: "category" }] });
    expect(roles(p)[3]).toBe("ignore");
    expect(roles(p)[5]).toBe("category");
    expect(p.columns[5]!.role.evidence[0]).toEqual({ code: "user-choice", column: 6 });
    expect(p.rows[0]!.category).toBe("витрата");
    expect(p.transfers.values).toEqual([]);
  });

  it("BUD-21@PoC FR 6: the decimal separator and the sign as the user chose them", () => {
    const inverted = parseHistory(FULL, {}, { sign: "invert" });
    expect(inverted.sign!.chosen.value).toBe("invert");
    expect(inverted.rows.map((r) => r.amount)).toEqual(["120.50", "45.00", "1000.00", "-25000.00", "60.00"]);
    const dot = parseHistory(FULL, {}, { decimalSeparator: "." });
    expect(dot.numbers!.chosen.value.decimalSeparator).toBe(".");
    expect(dot.rows[0]!.amount).not.toBe("-120.50");
  });
});
