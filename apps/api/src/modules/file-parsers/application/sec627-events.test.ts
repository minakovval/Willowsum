// Security review of #627 (head 83a13621): tests for the mutants the PR's tests let live, and two defects as
// `it.fails` until sec627-fix.patch; the fix is applied and they are plain tests now.
import { describe, expect, it } from "vitest";
import { isolatedStatementParser, StatementParseError } from "../adapters/isolation/run.ts";
import {
  analyzeTable,
  EVENT_LIMITS,
  readEvents,
  recognizeCurrency,
  type StatementOptions,
} from "../domain/index.ts";
import { parseStatement, readDelimitedFile } from "./index.ts";

const enc = (lines: readonly string[]) => new TextEncoder().encode(lines.join("\n"));
const parse = (lines: readonly string[], statement: StatementOptions = {}) =>
  parseStatement(enc(lines), {}, statement).events.events;
const UAH: StatementOptions = {
  account: { currencies: ["UAH"], multiCurrency: false },
};

describe("IMP-02@PoC b) security review: the leg rules", () => {
  it("IMP-02@PoC FR 6: an amount past 2^53 and an 18-decimal amount come out digit for digit (no JS number on the way)", () => {
    const events = parse([
      "Дата;Сума;Валюта;Опис",
      "01.03.2026;-9007199254740993,07;UAH;a",
      "02.03.2026;1,123456789012345678;ETH;b",
      "03.03.2026;0,30;UAH;c",
    ]);
    expect(events.map((e) => e.legs[0]!.amount)).toEqual([
      "-9007199254740993.07",
      "1.123456789012345678",
      "0.30",
    ]);
  });

  it("IMP-02@PoC FR 6: a zero amount carries no sign", () => {
    const events = parse(["Дата;Сума;Валюта;Опис", "01.03.2026;-0,00;EUR;a", "02.03.2026;-1,00;EUR;b"]);
    expect(events[0]!.legs).toEqual([{ amount: "0.00", currency: "EUR" }]);
  });

  it("IMP-02@PoC FR 5: the «invert» sign turns every amount over once, and the fee stays positive", () => {
    const { rows, headerRow } = readDelimitedFile(
      enc([
        "Дата;Сума;Комісія;Валюта;Опис",
        "01.03.2026;120,50;1,50;EUR;a",
        "02.03.2026;-20,00;-0,50;EUR;b",
        "03.03.2026;0,00;;EUR;c",
      ]),
    );
    const analysis = analyzeTable(rows, headerRow, 0);
    const inverted = {
      ...analysis,
      sign: {
        ...analysis.sign!,
        chosen: { ...analysis.sign!.chosen, value: "invert" as const },
      },
    };
    const { events } = readEvents(rows, headerRow, 0, inverted);
    expect(events.map((e) => [e.legs[0]!.amount, e.fee?.amount ?? null])).toEqual([
      ["-120.50", "1.50"],
      ["20.00", "0.50"],
      // A zero turned over carries no sign.
      ["0.00", null],
    ]);
  });

  it("IMP-02@PoC FR 5: with an indicator column «дт» is money out and «кт» money in", () => {
    const events = parse(
      ["Дата;Сума;Тип;Опис", "01.03.2026;10,00;дт;a", "02.03.2026;20,00;кт;b", "03.03.2026;30,00;дт;c"],
      UAH,
    );
    expect(events.map((e) => e.legs[0]!.amount)).toEqual(["-10.00", "20.00", "-30.00"]);
  });

  it("IMP-02@PoC FR 11: the fee and the original amount are held to their currency's decimals too", () => {
    const events = parse([
      "Дата;Сума;Комісія;Валюта;Сума у валюті операції;Валюта операції;Курс;Опис",
      "01.03.2026;-10,00;1,505;EUR;;;;a",
      "02.03.2026;-10,00;1,50;EUR;-1500,5;JPY;0,0066;b",
      "03.03.2026;-10,00;1,50;EUR;;;;c",
    ]);
    expect(events.map((e) => e.flags.includes("precision-exceeds-currency"))).toEqual([true, true, false]);
    // Flagged, never rounded.
    expect(events[0]!.fee).toEqual({ amount: "1.505", currency: "EUR" });
    expect(events[1]!.original).toEqual({ amount: "-1500.5", currency: "JPY" });
  });

  it("IMP-02@PoC FR 11: only a fiat currency is held to its decimals — BTC with 10 decimals is kept, no flag", () => {
    const events = parse(["Дата;Сума;Валюта;Опис", "01.03.2026;0,0000000001;BTC;a", "02.03.2026;1,5;BTC;b"]);
    expect(events[0]).toMatchObject({
      legs: [{ amount: "0.0000000001", currency: "BTC" }],
      flags: [],
    });
  });

  it("IMP-02@PoC FR 12: a difference under one minor unit of the settled currency is no mismatch; the same currency on both sides is not checked", () => {
    const events = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-0,03;EUR;1,00;UAH;0,0225",
      "02.03.2026;-22,50;EUR;22,50;EUR;5",
      "03.03.2026;-0,05;EUR;1,00;UAH;0,0225",
    ]);
    expect(events.map((e) => e.flags)).toEqual([[], [], ["rate-mismatch"]]);
  });
});

describe("IMP-02@PoC b) security review: the currency rules", () => {
  it("IMP-02@PoC FR 10: an account currency or a recipe symbol that is not a current code is never taken as the row's currency", () => {
    const rows = ["Дата;Сума;Опис", "01.03.2026;-1,00;a", "02.03.2026;-2,00;b"];
    expect(
      parse(rows, {
        account: { currencies: ["RUR"], multiCurrency: false },
      }).map((e) => [e.currency, e.flags]),
    ).toEqual([
      [null, ["currency-missing"]],
      [null, ["currency-missing"]],
    ]);
    const dollars = ["Дата;Сума;Валюта;Опис", "01.03.2026;-1,00;$;a", "02.03.2026;-2,00;$;b"];
    expect(parse(dollars, { currencySymbols: { $: "RUR" } }).map((e) => [e.currency, e.flags])).toEqual([
      [null, ["currency-ambiguous"]],
      [null, ["currency-ambiguous"]],
    ]);
  });

  it("IMP-02@PoC FR 3: a multi-currency account lends no currency to a file that names none", () => {
    const rows = ["Дата;Сума;Опис", "01.03.2026;-1,00;a", "02.03.2026;-2,00;b"];
    for (const currencies of [["EUR"], ["EUR", "UAH"]])
      expect(
        parse(rows, { account: { currencies, multiCurrency: true } }).map((e) => [e.currency, e.flags]),
      ).toEqual([
        [null, ["currency-missing"]],
        [null, ["currency-missing"]],
      ]);
  });

  it("IMP-02@PoC FR 9: a numeric code outside the table is «невідома валюта», and the IBAN's country settles a symbol only among its candidates", () => {
    expect(recognizeCurrency("999")).toEqual({
      status: "unknown",
      mark: "999",
    });
    expect(recognizeCurrency("kr", { country: "US" })).toMatchObject({
      status: "ambiguous",
    });
    expect(recognizeCurrency("$", { country: "SE" })).toMatchObject({
      status: "ambiguous",
    });
    expect(recognizeCurrency("$", { country: "__proto__" })).toMatchObject({
      status: "ambiguous",
    });
    const events = parse(["Дата;Сума;Валюта;Опис", "01.03.2026;-1,00;980;a", "02.03.2026;-2,00;999;b"]);
    expect(events.map((e) => [e.currency, e.flags])).toEqual([
      ["UAH", []],
      [null, ["currency-unknown"]],
    ]);
  });

  it("IMP-02@PoC FR 9: an unknown or ambiguous original currency is flagged, and its amount keeps no currency", () => {
    const file = (code: string) =>
      parse([
        "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
        `01.03.2026;-22,50;EUR;1 000,00;${code};0,0225`,
        `02.03.2026;-45,00;EUR;2 000,00;${code};0,0225`,
      ]).map((e) => [e.original, e.flags, e.currencyMark]);
    expect(file("RUR")[0]).toEqual([
      { amount: "1000.00", currency: null },
      ["currency-unknown"],
      { text: "RUR", candidates: [] },
    ]);
    expect(file("$")[1]).toEqual([
      { amount: "2000.00", currency: null },
      ["currency-ambiguous"],
      { text: "$", candidates: expect.arrayContaining(["USD", "CAD"]) },
    ]);
    expect(file("UAH")[0]).toEqual([{ amount: "1000.00", currency: "UAH" }, [], null]);
  });
});

describe("IMP-02@PoC b) security review: the bounds of the worker's answer", () => {
  it("ARC-06@PoC FR 4: a description, a counterparty and a reference past 2 000 characters come out cut and flagged; an unknown currency mark comes out as 16 characters", () => {
    const long = "D".repeat(EVENT_LIMITS.textChars + 1);
    const exact = "E".repeat(EVENT_LIMITS.textChars);
    const events = parse([
      "Дата;Сума;Валюта;Опис;Контрагент;Референс",
      `01.03.2026;-1,00;EUR;${long};${long};${long}`,
      `02.03.2026;-1,00;EUR;${exact};${exact};${exact}`,
    ]);
    for (const key of ["description", "counterparty", "reference"] as const) {
      expect(events[0]![key]).toBe("D".repeat(EVENT_LIMITS.textChars));
      expect(events[1]![key]).toBe(exact);
    }
    expect(events[0]!.flags).toEqual(["text-cut"]);
    expect(events[1]!.flags).toEqual([]);
    expect(recognizeCurrency("щ".repeat(200))).toEqual({
      status: "unknown",
      mark: "щ".repeat(16),
    });
  });

  it(
    "ARC-06@PoC FR 4: a file whose events pass 16 MiB is refused with a code and nothing of the file",
    { timeout: 60_000 },
    async () => {
      const lines = ["Дата;Сума;Валюта;Опис"];
      // A backslash is two characters in JSON: 5 000 × 2 000 of them is a 10 MB file and a 20 MiB answer.
      for (let i = 0; i < 5000; i++) lines.push(`01.03.2026;-1,00;EUR;${"\\".repeat(2000)}`);
      const error = await isolatedStatementParser()
        .parse(enc(lines))
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(StatementParseError);
      expect((error as StatementParseError).code).toBe("CORRUPTED");
      expect(
        JSON.stringify(error) + String((error as Error).message) + String((error as Error).stack),
      ).not.toContain("\\\\\\\\");
    },
  );

  it(
    "ARC-06@PoC FR 4: 7 000 rows with 2 100-character descriptions come back under 16 MiB, every description cut",
    { timeout: 60_000 },
    async () => {
      const lines = ["Дата;Сума;Валюта;Опис"];
      for (let i = 0; i < 7000; i++) lines.push(`01.03.2026;-1,00;EUR;${"D".repeat(2100)}`);
      const parsed = await isolatedStatementParser().parse(enc(lines));
      expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(parsed.events.events).toHaveLength(7000);
      expect(
        parsed.events.events.every((e) => e.description!.length === 2000 && e.flags.includes("text-cut")),
      ).toBe(true);
    },
  );
});

describe("IMP-02@PoC b) security review: defects (fixed by sec627-fix.patch)", () => {
  it("IMP-06@PoC FR 8: a row whose sign the engine cannot tell is flagged, never read as money in — an empty or unknown indicator, a minus under an indicator, a minus in a debit or credit column", () => {
    const byIndicator = parse(
      ["Дата;Сума;Тип;Опис", "01.03.2026;10,00;дт;a", "02.03.2026;20,00;кт;b", "03.03.2026;30,00;;c"],
      UAH,
    );
    expect(byIndicator.map((e) => e.flags)).toEqual([[], [], ["sign-unclear"]]);
    const late = ["Дата;Сума;Тип;Опис"];
    for (let i = 0; i < 1001; i++) late.push(`01.03.2026;10,00;${i % 2 ? "дт" : "кт"};a`);
    late.push("05.03.2026;55,00;storno;x", "05.03.2026;-77,00;кт;x");
    expect(
      parse(late, UAH)
        .slice(-2)
        .map((e) => e.flags),
    ).toEqual([["sign-unclear"], ["sign-unclear"]]);
    const columns = parse(
      ["Дата;Дебет;Кредит;Опис", "01.03.2026;10,00;;a", "02.03.2026;;2,00;b", "03.03.2026;-5,00;;storno"],
      UAH,
    );
    expect(columns.map((e) => e.flags)).toEqual([[], [], ["sign-unclear"]]);
  });

  it("IMP-02@PoC FR 10: an empty currency cell takes the column's currency only when the column holds nothing else — not beside RUR, «$» or a second code", () => {
    const beside = (other: string, statement: StatementOptions = {}) =>
      parse(
        [
          "Дата;Сума;Валюта;Опис",
          "01.03.2026;-1,00;USD;a",
          `02.03.2026;-2,00;${other};b`,
          "03.03.2026;-3,00;;c",
        ],
        statement,
      )[2]!;
    for (const other of ["RUR", "kr"])
      expect([other, beside(other).currency, beside(other).flags]).toEqual([
        other,
        null,
        ["currency-missing"],
      ]);
    // Two codes in the column: the account's currency is not lent to the empty cell either.
    expect([beside("EUR", UAH).currency, beside("EUR", UAH).flags]).toEqual([null, ["currency-missing"]]);
  });
});

describe("IMP-02@PoC b) security review, confirmation of 2f30651f: what the fix round left", () => {
  it("IMP-02@PoC FR 10: an amount header that names a code the engine does not hold («Сума (BGN)», «Amount, RUR») makes its rows «невідома валюта» — the account's currency is not lent to them", () => {
    for (const [header, mark] of [
      ["Сума (BGN)", "BGN"],
      ["Сума (RUR)", "RUR"],
      ["Сума ANG", "ANG"],
    ] as const)
      expect([
        header,
        ...parse(["Дата;" + header + ";Опис", "01.03.2026;-1,00;a", "02.03.2026;-2,00;b"], {
          account: { currencies: ["EUR"], multiCurrency: false },
        }).map((e) => [e.currency, e.legs[0]!.amount, e.flags, e.currencyMark?.text]),
      ]).toEqual([
        header,
        [null, "-1.00", ["currency-unknown"], mark],
        [null, "-2.00", ["currency-unknown"], mark],
      ]);
    // A current code in the header and a header with no code read as before.
    const eur: StatementOptions = { account: { currencies: ["EUR"], multiCurrency: false } };
    expect(
      parse(["Дата;Сума (EUR);Опис", "01.03.2026;-1,00;a", "02.03.2026;-2,00;b"], eur)[0]!.flags,
    ).toEqual([]);
    expect(
      parse(["Дата;Сума;Опис", "01.03.2026;-1,00;a", "02.03.2026;-2,00;b"], eur).map((e) => [
        e.currency,
        e.flags,
      ]),
    ).toEqual([
      ["EUR", []],
      ["EUR", []],
    ]);
  });

  it("IMP-02@PoC FR 10: an empty currency cell beside an unknown or ambiguous mark is never given the account's currency — with or without a code in the column", () => {
    const third = (first: string, second: string) =>
      parse(
        [
          "Дата;Сума;Валюта;Опис",
          `01.03.2026;-1,00;${first};a`,
          `02.03.2026;-2,00;${second};b`,
          "03.03.2026;-3,00;;c",
        ],
        UAH,
      )[2]!;
    for (const [first, second] of [
      ["USD", "RUR"],
      ["RUR", "RUR"],
      ["$", "$"],
    ] as const)
      expect([first, second, third(first, second).currency, third(first, second).flags]).toEqual([
        first,
        second,
        null,
        ["currency-missing"],
      ]);
  });

  it("IMP-02@PoC FR 10: ANG, the numeric code 975 and a recipe symbol that names BGN are «невідома валюта» too", () => {
    expect(recognizeCurrency("ANG")).toEqual({ status: "unknown", mark: "ANG" });
    expect(recognizeCurrency("975")).toEqual({ status: "unknown", mark: "975" });
    expect(recognizeCurrency("лв", { symbols: { лв: "BGN" } })).toEqual({ status: "unknown", mark: "лв" });
  });

  it("IMP-06@PoC FR 8: a minus in the credit column is flagged like a minus in the debit column", () => {
    const events = parse(
      ["Дата;Дебет;Кредит;Опис", "01.03.2026;10,00;;a", "02.03.2026;;2,00;b", "03.03.2026;;-5,00;storno"],
      UAH,
    );
    expect(events.map((e) => e.flags)).toEqual([[], [], ["sign-unclear"]]);
  });

  it("IMP-02@PoC FR 4: the original currency column wins over a mark printed with the original amount", () => {
    const events = parse([
      "Дата;Сума;Валюта;Сума у валюті операції;Валюта операції;Курс",
      "01.03.2026;-22,50;EUR;1 000,00 USD;UAH;0,0225",
      "02.03.2026;-22,50;EUR;1 000,00 USD;UAH;0,0225",
    ]);
    expect(events.map((e) => e.original)).toEqual([
      { amount: "1000.00", currency: "UAH" },
      { amount: "1000.00", currency: "UAH" },
    ]);
  });
});
