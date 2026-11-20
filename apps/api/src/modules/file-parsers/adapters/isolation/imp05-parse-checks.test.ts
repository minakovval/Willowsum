import { describe, expect, it } from "vitest";
import { isolatedStatementParser } from "./run.ts";

describe("IMP-05@PoC FR 1: the checks come out of the isolated parse worker (ADR-0012, #607 item 3)", () => {
  it("IMP-05@PoC FR 1: the worker answers with the control checks and the batch's flags", async () => {
    const parse = await isolatedStatementParser().parse(
      new TextEncoder().encode(
        [
          "Вхідний залишок:;1 000,00 EUR",
          "Дата;Сума;Опис",
          "01.03.2026;500,00;Зарплата",
          "05.03.2026;-60,00;Кава",
          "Кінцевий залишок:;1 450,00 EUR",
        ].join("\n"),
      ),
      { delimiter: ";" },
    );
    expect(parse.checks.controls.find((c) => c.kind === "balance-equation")).toMatchObject({
      status: "mismatch",
      difference: "10.00",
    });
    expect(parse.checks.flags.map((f) => [f.code, f.severity])).toEqual([["checksum-mismatch", "review"]]);
  });
});
