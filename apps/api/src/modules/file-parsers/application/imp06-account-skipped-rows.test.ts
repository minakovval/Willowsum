import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse-statement.ts";

/** IMP-06@PoC EC3 for the account binding (wave 2 row 41 part 3). The IBAN is synthetic, built at runtime. */
const IBAN = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");

const file = (preamble: string[]): Uint8Array =>
  new TextEncoder().encode([...preamble, "Дата;Сума;Валюта;Опис", "01.03.2026;-120,50;EUR;Кава"].join("\n"));

describe("IMP-06@PoC EC3: rows the recipe skips are not read as the preamble", () => {
  it("IMP-06@PoC EC3: an IBAN in a row the recipe skips does not bind the statement; the same row unskipped does", () => {
    const bytes = file([`IBAN ${IBAN}`, "Виписка за березень"]);
    const binding = { by: "iban", value: IBAN } as const;
    expect(parseStatement(bytes, { skipRows: 1 }, {}, binding).account).toEqual({
      by: "iban",
      status: "not-found",
    });
    expect(parseStatement(bytes, {}, {}, binding).account).toEqual({ by: "iban", status: "match" });
  });
});
