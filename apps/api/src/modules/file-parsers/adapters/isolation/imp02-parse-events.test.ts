import { describe, expect, it } from "vitest";
import { isolatedStatementParser } from "./run.ts";

describe("IMP-02@PoC b): the events come out of the isolated parse worker", () => {
  it("IMP-02@PoC AC4: the account's currencies reach the worker and a row in another currency is flagged there", async () => {
    const parse = await isolatedStatementParser().parse(
      new TextEncoder().encode(
        [
          "Дата;Сума;Комісія;Валюта;Опис",
          "01.03.2026;-120,50;1,50;EUR;Кава",
          "02.03.2026;-20,00;;PLN;Хліб",
        ].join("\n"),
      ),
      {},
      { account: { currencies: ["EUR"], multiCurrency: false } },
    );
    expect(parse.events.events.map((e) => [e.legs, e.fee, e.flags])).toEqual([
      [[{ amount: "-120.50", currency: "EUR" }], { amount: "1.50", currency: "EUR" }, []],
      [[{ amount: "-20.00", currency: "PLN" }], null, ["currency-not-in-account"]],
    ]);
  });
});
