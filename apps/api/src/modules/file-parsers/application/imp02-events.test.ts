import { describe, expect, it } from "vitest";
import type { StatementEvent, StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./index.ts";

const enc = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\r\n"));
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines), {}, statement).events;
/** The normalised operation of an event: what is the same whichever file it came from. */
const operation = (event: StatementEvent) =>
  Object.fromEntries(Object.entries(event).filter(([key]) => key !== "row"));

describe("IMP-02@PoC b): statement rows read into events with a main leg and a fee leg", () => {
  it("IMP-02@PoC AC11: an operation with a bank fee of 1,50 EUR has a main leg and a separate fee leg", () => {
    const { events } = parse([
      "Дата;Сума;Комісія;Валюта;Опис",
      "01.03.2026;-120,50;1,50;EUR;Кава",
      "02.03.2026;-5,00;0,00;EUR;Хліб",
    ]);
    expect(events[0]!.legs).toEqual([{ amount: "-120.50", currency: "EUR" }]);
    expect(events[0]!.fee).toEqual({ amount: "1.50", currency: "EUR" });
    // FR 5: no fee charged — no fee leg.
    expect(events[1]!.fee).toBeNull();
  });

  it("IMP-02@PoC FR 5: a fee printed negative is still the fee charged (a positive fee leg), debit and credit columns give the signed leg", () => {
    const { events } = parse(
      ["Дата;Дебет;Кредит;Комісія;Опис", "01.03.2026;120,50;;-2,00;Кава", "02.03.2026;;1 000,00;;Зарплата"],
      { account: { currencies: ["UAH"], multiCurrency: false } },
    );
    expect(events.map((e) => e.legs[0]!.amount)).toEqual(["-120.50", "1000.00"]);
    expect(events[0]!.fee).toEqual({ amount: "2.00", currency: "UAH" });
    expect(events.every((e) => e.currency === "UAH")).toBe(true);
  });

  it("IMP-02@PoC FR 4: the original amount and currency, the rate, the value date and the bank's description as printed are kept", () => {
    const { events } = parse([
      "Дата;Дата валютування;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс;Опис",
      "01.03.2026;03.03.2026;-22,50;EUR;-1 000,00;UAH;0,0225;  GOOGLE *YouTube  g.co/help ",
      "02.03.2026;04.03.2026;-5,00;EUR;;;;Хліб",
    ]);
    expect(events[0]).toMatchObject({
      row: 2,
      date: "2026-03-01",
      valueDate: "2026-03-03",
      currency: "EUR",
      original: { amount: "-1000.00", currency: "UAH" },
      rate: "0.0225",
      description: "  GOOGLE *YouTube  g.co/help ",
      flags: [],
    });
    expect(events[1]!.original).toBeNull();
    expect(events[1]!.rate).toBeNull();
  });

  it("IMP-02@PoC AC5: 1 000 UAH at 0,0225 settled as 22,50 EUR is kept without a rate flag", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-22,50;EUR;1 000,00;UAH;0,0225",
      "02.03.2026;-22,51;EUR;1 000,00;UAH;0,0225",
    ]);
    expect(events[0]).toMatchObject({
      legs: [{ amount: "-22.50", currency: "EUR" }],
      original: { amount: "1000.00", currency: "UAH" },
      rate: "0.0225",
      flags: [],
    });
    // FR 12: within one minor unit of the settled currency.
    expect(events[1]!.flags).toEqual([]);
  });

  it("IMP-02@PoC AC6: 1 000 UAH at 0,0225 settled as 25,00 EUR is flagged «розбіжність курсу»", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-25,00;EUR;1 000,00;UAH;0,0225",
    ]);
    expect(events[0]!.flags).toEqual(["rate-mismatch"]);
    expect(events[0]!.legs[0]!.amount).toBe("-25.00");
  });

  it("IMP-02@PoC FR 12: a rate the other way round (settled × rate = original) is flagged as inverted", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-22,50;EUR;1 000,00;UAH;44,4444",
    ]);
    expect(events[0]!.flags).toEqual(["rate-inverted"]);
  });

  it("IMP-02@PoC FR 12: the 0,5 % tolerance holds for large amounts", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-1 002,00;EUR;44 444,44;UAH;0,0225",
      "02.03.2026;-1 010,00;EUR;44 444,44;UAH;0,0225",
    ]);
    expect(events.map((e) => e.flags)).toEqual([[], ["rate-mismatch"]]);
  });

  it("IMP-02@PoC AC4: a single-currency EUR account and a row in PLN — «валюта не належить рахунку»", () => {
    const { events } = parse(
      ["Дата;Сума;Валюта;Опис", "01.03.2026;-10,00;EUR;Кава", "02.03.2026;-20,00;PLN;Хліб"],
      { account: { currencies: ["EUR"], multiCurrency: false } },
    );
    expect(events.map((e) => e.flags)).toEqual([[], ["currency-not-in-account"]]);
    // FR 2: a multi-currency account takes every currency; its wallets are the batch's currencies.
    const multi = parse(
      ["Дата;Сума;Валюта;Опис", "01.03.2026;-10,00;EUR;Кава", "02.03.2026;-20,00;PLN;Хліб"],
      { account: { currencies: ["EUR"], multiCurrency: true } },
    );
    expect(multi.events.every((e) => e.flags.length === 0)).toBe(true);
    expect(multi.currencies).toEqual(["EUR", "PLN"]);
  });

  it("IMP-02@PoC FR 3: a row in its account's own currency is accepted, and a file without a currency takes the account's", () => {
    const { events } = parse(["Дата;Сума;Опис", "01.03.2026;-10,00;Кава", "02.03.2026;-20,00;Хліб"], {
      account: { currencies: ["UAH"], multiCurrency: false },
    });
    expect(events.map((e) => [e.currency, e.flags])).toEqual([
      ["UAH", []],
      ["UAH", []],
    ]);
  });

  it("IMP-02@PoC AC2: one file with EUR, UAH and PLN and three files, one per currency, give the same normalised operations", () => {
    const rows = {
      EUR: ["01.03.2026;-10,00;Кава", "03.03.2026;100,00;Повернення"],
      UAH: ["01.03.2026;-1 200,00;АТБ", "02.03.2026;-50,00;Метро"],
      PLN: ["02.03.2026;-35,90;Żabka"],
    } as const;
    const one = parse([
      "Дата;Сума;Валюта;Опис",
      ...Object.entries(rows).flatMap(([code, lines]) =>
        lines.map((l) => {
          const [d, a, t] = l.split(";");
          return `${d};${a};${code};${t}`;
        }),
      ),
    ]);
    const three = Object.entries(rows).flatMap(
      ([code, lines]) => parse([`Дата;Сума (${code});Опис`, ...lines]).events,
    );
    const key = (e: { currency: string | null; description: string | null }) =>
      `${e.currency}|${e.description}`;
    const sorted = <T extends { currency: string | null; description: string | null }>(
      events: readonly T[],
    ) => [...events].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(one.events).map(operation)).toEqual(sorted(three).map(operation));
    expect(one.currencies).toEqual(["EUR", "PLN", "UAH"]);
  });

  it("IMP-02@PoC FR 8: the same bytes give the same events, byte for byte", () => {
    const lines = ["Дата;Сума;Валюта;Опис", "01.03.2026;-10,00;EUR;Кава", "02.03.2026;-20,00;PLN;Хліб"];
    expect(JSON.stringify(parse(lines))).toBe(JSON.stringify(parse([...lines])));
  });

  it("IMP-02@PoC AC7: a currency column with the code «980» reads as UAH", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-10,00;980;Кава",
      "02.03.2026;-20,00;980;Хліб",
    ]);
    expect(events.map((e) => e.currency)).toEqual(["UAH", "UAH"]);
    expect(events.every((e) => e.flags.length === 0)).toBe(true);
  });

  it("IMP-02@PoC FR 9: ISO codes, numeric codes and unambiguous symbols are recognised; a local name is «невідома валюта»", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-10,00;eur;a",
      "02.03.2026;-10,00;985;b",
      "03.03.2026;-10,00;€;c",
      "04.03.2026;-10,00;₴;d",
      ...Array.from({ length: 6 }, (_, i) => `0${i + 1}.04.2026;-1,00;UAH;x`),
      "05.03.2026;-10,00;гривня;e",
      "06.03.2026;-10,00;Schweizer Franken;f",
    ]);
    expect(events.map((e) => e.currency)).toEqual([
      "EUR",
      "PLN",
      "EUR",
      "UAH",
      ...Array(6).fill("UAH"),
      null,
      null,
    ]);
    expect(events[10]).toMatchObject({
      flags: ["currency-unknown"],
      currencyMark: { text: "гривня", candidates: [] },
    });
    expect(events[11]!.flags).toEqual(["currency-unknown"]);
  });

  it("IMP-02@PoC AC8: rows with RUR are «невідома валюта», need the user's decision, and the amount is not converted", () => {
    const { events, currencies } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-1 500,00;RUR;Кава",
      "02.03.2026;-20,00;RUR;Хліб",
    ]);
    expect(events[0]).toMatchObject({
      currency: null,
      legs: [{ amount: "-1500.00", currency: null }],
      currencyMark: { text: "RUR", candidates: [] },
      flags: ["currency-unknown"],
    });
    expect(currencies).toEqual([]);
  });

  it("IMP-02@PoC FR 10: a withdrawn code (HRK) is «невідома валюта» too, never converted", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-75,00;HRK;Kava",
      "02.03.2026;-5,00;HRK;Kruh",
    ]);
    expect(events.map((e) => [e.currency, e.legs[0]!.amount, e.flags])).toEqual([
      [null, "-75.00", ["currency-unknown"]],
      [null, "-5.00", ["currency-unknown"]],
    ]);
  });

  it("IMP-02@PoC AC12: «kr» with no recipe symbol and no IBAN is ambiguous and needs a decision", () => {
    const { events, country } = parse([
      "Дата;Сума;Опис",
      "01.03.2026;-120,50 kr;Kaffe",
      "02.03.2026;-5,00 kr;Bröd",
    ]);
    expect(country).toBeNull();
    expect(events[0]).toMatchObject({
      currency: null,
      legs: [{ amount: "-120.50", currency: null }],
      currencyMark: { text: "kr", candidates: ["SEK", "NOK", "DKK", "ISK"] },
      flags: ["currency-ambiguous"],
    });
  });

  it("IMP-02@PoC EC1: a dollar sign without context is ambiguous; the IBAN's country or the recipe's symbol settles it", () => {
    const lines = ["Дата;Сума;Опис", "01.03.2026;$12.00;Coffee", "02.03.2026;$3.50;Bread"];
    expect(parse(lines).events[0]!.flags).toEqual(["currency-ambiguous"]);
    expect(parse(lines, { currencySymbols: { $: "CAD" } }).events[0]!.currency).toBe("CAD");
    expect(parse(lines, { country: "US" }).events[0]!.currency).toBe("USD");
    // FR 9: the IBAN in the file's preamble gives the country; only the country leaves the parse.
    const swedish = parse([
      "Рахунок:;SE45 5000 0000 0583 9825 7466",
      "Дата;Сума;Опис",
      "01.03.2026;-120,50 kr;Kaffe",
      "02.03.2026;-5,00 kr;Bröd",
    ]);
    expect(swedish.country).toEqual({ code: "SE", from: "file" });
    expect(swedish.events.map((e) => e.currency)).toEqual(["SEK", "SEK"]);
    expect(JSON.stringify(swedish)).not.toContain("5000");
  });

  it("IMP-02@PoC AC9: «1500,5» in JPY is flagged «точність перевищує валюту»", () => {
    const { events } = parse(["Дата;Сума;Валюта;Опис", "01.03.2026;1500,5;JPY;a", "02.03.2026;1500;JPY;b"]);
    expect(events.map((e) => e.flags)).toEqual([["precision-exceeds-currency"], []]);
    expect(events[0]!.legs[0]!.amount).toBe("1500.5");
  });

  it("IMP-02@PoC FR 11: KWD has 3 decimals, a crypto-asset up to 18 — kept exactly, no flag", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;12,345;KWD;a",
      "02.03.2026;0,000000000000000001;ETH;b",
      "03.03.2026;12,3456;KWD;c",
    ]);
    expect(events.map((e) => [e.legs[0]!.amount, e.flags])).toEqual([
      ["12.345", []],
      ["0.000000000000000001", []],
      ["12.3456", ["precision-exceeds-currency"]],
    ]);
  });

  it("IMP-02@PoC EC3: an empty currency cell in a column of one currency takes it, with no flag", () => {
    const { events } = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-10,00;EUR;a",
      "02.03.2026;-20,00;;b",
      "03.03.2026;-30,00;EUR;c",
    ]);
    expect(events.map((e) => [e.currency, e.flags])).toEqual([
      ["EUR", []],
      ["EUR", []],
      ["EUR", []],
    ]);
    // A column of two currencies cannot fill it: the row needs a decision.
    const two = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-10,00;EUR;a",
      "02.03.2026;-20,00;;b",
      "03.03.2026;-30,00;PLN;c",
    ]);
    expect(two.events[1]!.flags).toEqual(["currency-missing"]);
  });

  it("IMP-02@PoC FR 6: amounts stay exact decimal text, never a float", () => {
    const { events } = parse(["Дата;Сума;Валюта;Опис", "01.03.2026;0,10;EUR;a", "02.03.2026;0,20;EUR;b"]);
    expect(events.map((e) => e.legs[0]!.amount)).toEqual(["0.10", "0.20"]);
    expect(events.every((e) => typeof e.legs[0]!.amount === "string")).toBe(true);
  });
});
