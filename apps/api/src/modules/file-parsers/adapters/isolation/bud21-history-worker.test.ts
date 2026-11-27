import { describe, expect, it } from "vitest";
import { isolatedStatementParser, StatementParseError } from "./run.ts";

const csv = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n") + "\r\n");

describe("BUD-21@PoC FR 3: a history file is read in the isolated parse worker, under the statement's ceilings", () => {
  it("BUD-21@PoC FR 4: the worker gives the history file's roles and rows, with the user's corrections", async () => {
    const bytes = csv([
      "Дата;Сума;Опис;Категорія;Підкатегорія",
      "01.03.2026;-10,00;Кава;Їжа;Кафе",
      "02.03.2026;-20,00;Хліб;Їжа;Продукти",
    ]);
    const parser = isolatedStatementParser();
    const parse = await parser.parseHistory(bytes);
    expect(parse.columns.map((c) => c.role.chosen.value)).toEqual([
      "date",
      "amount",
      "description",
      "category",
      "subcategory",
    ]);
    expect(parse.rows.map((r) => [r.date, r.amount, r.category, r.subcategory])).toEqual([
      ["2026-03-01", "-10.00", "Їжа", "Кафе"],
      ["2026-03-02", "-20.00", "Їжа", "Продукти"],
    ]);
    const again = await parser.parseHistory(bytes, {}, { dateOrder: "mdy" });
    expect(again.rows.map((r) => r.date)).toEqual(["2026-01-03", "2026-02-03"]);
  });

  it("BUD-21@PoC FR 3: more than 20 000 rows is refused with the ceiling, as a statement is", async () => {
    const lines = ["Дата;Сума;Опис;Категорія"];
    for (let i = 0; i < 20_001; i++) lines.push(`01.03.2026;-1,00;Кава ${i};Кафе`);
    const refusal = await isolatedStatementParser()
      .parseHistory(csv(lines))
      .catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(StatementParseError);
    expect(refusal).toMatchObject({ code: "TABLE_LIMIT", ceiling: "rows" });
  });
});
