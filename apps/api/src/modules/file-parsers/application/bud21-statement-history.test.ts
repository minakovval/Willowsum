import { describe, expect, it } from "vitest";
import { looksLikeHistory } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * BUD-21@PoC FR 2, IMP-08@PoC FR 17 (wave 2 row 243): a file uploaded in the statements' wizard is recognised as a history
 * file — the same recognition of the user's own columns as an uploaded history file's — and, imported as a statement,
 * has those columns not read. Every name, amount and label is synthetic.
 */
const csv = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n") + "\r\n");

const HISTORY = csv([
  "Дата;Сума;Опис;Категорія;Підкатегорія;Тип;Теги",
  "01.03.2026;-120,50;SILPO 1234 KYIV;Їжа;Супермаркети;витрата;родина",
  "02.03.2026;-45,00;Кав'ярня «Вигадка»;Кав'ярні;;витрата;",
  "03.03.2026;-1 000,00;На свою картку;;;переказ;",
  "04.03.2026;-80,00;SILPO 0456 LVIV;Їжа;Супермаркети;витрата;родина",
]);

const STATEMENT = csv([
  "Дата;Сума;Опис операції;Залишок",
  "01.03.2026;-120,50;SILPO 1234 KYIV;9 879,50",
  "02.03.2026;-45,00;Кав'ярня «Вигадка»;9 834,50",
  "04.03.2026;-80,00;SILPO 0456 LVIV;9 754,50",
]);

/** Only «Переказ» with «так» / «ні»: a transfer mark and nothing else of the user's. */
const TRANSFER_ONLY = csv([
  "Дата;Сума;Опис;Переказ",
  "01.03.2026;-120,50;SILPO 1234 KYIV;ні",
  "03.03.2026;-1 000,00;На свою картку;так",
  "04.03.2026;-80,00;SILPO 0456 LVIV;ні",
]);

describe("BUD-21@PoC FR 2: the wizard recognises a history file", () => {
  it("BUD-21@PoC FR 2: a statement's parse names the columns of the user's analysis — category, subcategory, transfer mark, tags — by number and role", () => {
    const p = parseStatement(HISTORY);
    expect(p.checks.userColumns).toEqual([
      { column: 4, role: "category" },
      { column: 5, role: "subcategory" },
      { column: 6, role: "transfer-flag" },
      { column: 7, role: "tags" },
    ]);
    expect(looksLikeHistory(p.checks.userColumns!)).toBe(true);
    // Numbers and roles only: no label of the file is carried in this field.
    expect(JSON.stringify(p.checks.userColumns)).not.toMatch(/Їжа|Супермаркети|родина/u);
  });

  it("IMP-08@PoC FR 17: a transfer-mark column alone makes the file a history file", () => {
    const p = parseStatement(TRANSFER_ONLY);
    expect(p.checks.userColumns).toEqual([{ column: 4, role: "transfer-flag" }]);
    expect(looksLikeHistory(p.checks.userColumns!)).toBe(true);
  });

  it("BUD-21@PoC FR 2: a bank's statement without such columns is not asked about", () => {
    const p = parseStatement(STATEMENT);
    expect(p.checks.userColumns).toBeUndefined();
    // Tags alone are no analysis of the user's to ask about.
    expect(looksLikeHistory([{ column: 3, role: "tags" }])).toBe(false);
  });
});

describe("BUD-21@PoC FR 2: «імпортувати як виписку» does not read the user's analysis", () => {
  it("BUD-21@PoC FR 2: read as usual, the category column is a part of the description; imported as a statement, no cell of the user's columns is read", () => {
    const usual = parseStatement(HISTORY);
    expect(usual.events.events[0]!.description).toContain("Їжа");

    const p = parseStatement(HISTORY, {}, { userColumns: "ignore" });
    const roles = p.analysis.columns.map((c) => c.role.chosen.value);
    expect(roles.slice(3)).toEqual(["ignore", "ignore", "ignore", "ignore"]);
    expect(p.analysis.columns[3]!.role.evidence[0]).toMatchObject({ code: "user-choice", column: 4 });
    expect(p.events.events.map((e) => e.description)).toEqual([
      "SILPO 1234 KYIV",
      "Кав'ярня «Вигадка»",
      "На свою картку",
      "SILPO 0456 LVIV",
    ]);
    const text = JSON.stringify(p.events);
    for (const label of ["Їжа", "Супермаркети", "Кав'ярні", "витрата", "переказ", "родина"])
      expect(text).not.toContain(label);
    // The amounts and dates are read as before.
    expect(p.events.events.map((e) => e.legs[0]!.amount)).toEqual(
      usual.events.events.map((e) => e.legs[0]!.amount),
    );
    // The file is still named as a history file: the wizard does not ask again for a file already answered.
    expect(p.checks.userColumns).toHaveLength(4);
  });

  it("IMP-08@PoC FR 17: a statement without such columns reads the same with the flag", () => {
    const a = parseStatement(STATEMENT);
    const b = parseStatement(STATEMENT, {}, { userColumns: "ignore" });
    expect(b.events).toEqual(a.events);
    expect(b.analysis).toEqual(a.analysis);
  });
});
