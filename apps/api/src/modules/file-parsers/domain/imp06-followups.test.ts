// Follow-ups of #619 in the parse engine (#624): mixed separators of FR 11, the header's currency code, the dictionary
// words with «ї».
import { describe, expect, it } from "vitest";
import { analyzeTable, headerCurrency } from "./index.ts";

const table = (lines: readonly string[]) => lines.map((l) => l.split(";"));

describe("IMP-06@PoC: follow-ups of the engine's decisions (#624)", () => {
  it("IMP-06@PoC FR 11: «1,200» and «2.500» in one column are not read as thousands by the first cell's separator", () => {
    const a = analyzeTable(
      table([
        "Дата;Сума",
        "01.03.2026;1,200",
        "02.03.2026;2.500",
        "03.03.2026;3,100",
        "04.03.2026;4,300",
        "05.03.2026;5,000",
      ]),
      0,
    );
    const numbers = a.numbers!;
    expect(numbers.flags).toEqual(["ambiguous-integer", "decimal-assumed"]);
    expect(numbers.evidence).toContainEqual({ code: "mixed-separators", count: 5, of: 5 });
    expect(numbers.chosen.value.decimalSeparator).toBe(",");
    expect(numbers.chosen.score).toBe(0.55);
    // One separator only: the FR 11 rule still applies (thousands, flagged).
    const b = analyzeTable(
      table(["Дата;Сума", "01.03.2026;1,200", "02.03.2026;2,500", "03.03.2026;3,100", "04.03.2026;4,300"]),
      0,
    );
    expect(b.numbers!.flags).toEqual(["ambiguous-integer"]);
    expect(b.numbers!.chosen.value.decimalSeparator).toBe(".");
  });

  it("IMP-06@PoC FR 8: a header's word that is an ISO code («ALL», «all») is not the file's currency; a bracketed or last code is", () => {
    expect(headerCurrency("ALL AMOUNTS")).toBeNull();
    expect(headerCurrency("Amount (all)")).toBeNull();
    expect(headerCurrency("ALL AMOUNT TOTAL")).toBeNull();
    expect(headerCurrency("Сума (UAH)")).toBe("UAH");
    expect(headerCurrency("Amount, EUR")).toBe("EUR");
    expect(headerCurrency("Залишок EUR")).toBe("EUR");
    expect(headerCurrency("AMOUNT [PLN]")).toBe("PLN");
    expect(headerCurrency("Сума (RUR)")).toBeNull();
    const a = analyzeTable(table(["Date;ALL AMOUNT", "01.03.2026;1,50", "02.03.2026;2,50"]), 0);
    expect(a.columns[1]!.role.chosen.value).toBe("amount");
    expect(a.currency).toEqual({ mode: "unknown", code: null, evidence: [{ code: "no-currency" }] });
  });

  it("IMP-06@PoC FR 8: dictionary words with «ї» match their header («Сума у валюті операції», «Валюта операції»)", () => {
    const a = analyzeTable(
      table([
        "Дата операції;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
        "01.03.2026;-22,50;EUR;1 000,00;UAH;0,0225",
      ]),
      0,
    );
    expect(a.columns.map((c) => c.role.chosen.value)).toEqual([
      "date",
      "amount",
      "currency",
      "original-amount",
      "original-currency",
      "exchange-rate",
    ]);
  });
});
