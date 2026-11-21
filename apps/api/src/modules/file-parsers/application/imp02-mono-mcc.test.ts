import { describe, expect, it } from "vitest";
import { analyzeTable, type Role, type StatementAnalysis } from "../domain/index.ts";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * A monobank-shaped card statement whose «Сума комісій» and «Сума кешбеку» hold `0.00` instead of «—» (#694): the amount
 * posted is always «Сума в валюті картки (UAH)», never the four-digit MCC code (IMP-02@PoC FR 4), a «—» rate is an empty
 * rate and the rate check runs (FR 12), and the banks' other layouts (Revolut, Raiffeisen UA, BBVA, as
 * tools/synthetic/src/family/statements.ts renders them) map as before. Synthetic rows only: invented merchants and
 * amounts, a balance chain that adds up, newest first.
 */
const HEADER = [
  "Дата i час операції",
  "Деталі операції",
  "MCC",
  "Сума в валюті картки (UAH)",
  "Сума в валюті операції",
  "Валюта",
  "Курс",
  "Сума комісій (UAH)",
  "Сума кешбеку (UAH)",
  "Залишок після операції",
];
/** Date, details, MCC, card amount, operation amount, currency, rate, cashback (or null), balance. */
const ROWS: readonly (readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
  string,
])[] = [
  ["20.11.2026 18:05:11", "Кав'ярня Тест", "5814", "-85.00", "-85.00", "UAH", "—", "0.85", "10559.60"],
  ["19.11.2026 12:00:00", "Поповнення з картки", "4829", "2000.00", "2000.00", "UAH", "—", null, "10644.60"],
  [
    "18.11.2026 09:15:42",
    "SYNTH SHOP ONLINE",
    "5732",
    "-415.00",
    "-10.00",
    "USD",
    "41.5000",
    null,
    "8644.60",
  ],
  [
    "17.11.2026 21:30:00",
    "Супермаркет Синтетик",
    "5411",
    "-512.40",
    "-512.40",
    "UAH",
    "—",
    "5.12",
    "9059.60",
  ],
  ["16.11.2026 08:00:00", "Метро", "4111", "-8.00", "-8.00", "UAH", "—", null, "9572.00"],
  ["15.11.2026 14:45:10", "SYNTH STORE EU", "5999", "-900.00", "-20.00", "EUR", "45.0000", null, "9580.00"],
  ["14.11.2026 10:10:10", "Аптека Тест", "0742", "-230.00", "-230.00", "UAH", "—", "2.30", "10480.00"],
  ["13.11.2026 16:20:00", "Переказ від Тест", "4829", "1500.00", "1500.00", "UAH", "—", null, "10710.00"],
];
const AMOUNTS = ["-85.00", "2000.00", "-415.00", "-512.40", "-8.00", "-900.00", "-230.00", "1500.00"];
const MONEY_ROLES: readonly Role[] = [
  "amount",
  "debit",
  "credit",
  "balance",
  "fee",
  "original-amount",
  "exchange-rate",
];

/** `empty` is what the bank prints for «no commission» and «no cashback»: «—» or `0.00`. */
const monobank = (empty: "—" | "0.00", rate?: (row: number, printed: string) => string) =>
  [
    HEADER,
    ...ROWS.map(([date, details, mcc, card, op, ccy, printedRate, cashback, balance], i) => [
      date,
      details,
      mcc,
      card,
      op,
      ccy,
      rate ? rate(i, printedRate) : printedRate,
      empty,
      cashback ?? empty,
      balance,
    ]),
  ] as const;
const csv = (rows: readonly (readonly string[])[]) =>
  new TextEncoder().encode(
    "﻿" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n",
  );
const UAH_ACCOUNT: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };
const parse = (rows: readonly (readonly string[])[]) => parseStatement(csv(rows), {}, UAH_ACCOUNT);
const roles = (a: StatementAnalysis) => a.columns.map((c) => c.role.chosen.value);
/**
 * BBVA as it maps on main before #694: the second «Divisa» is the original currency of «Disponible». #696 (IMP-02 FR 4):
 * the Spanish header words read «F.Valor» as the value date and «Fecha» as the date (by content alone the first date
 * column was the date).
 */
const BBVA_ROLES: readonly Role[] = [
  "value-date",
  "date",
  "description",
  "description",
  "amount",
  "currency",
  "balance",
  "original-currency",
  "description",
];
const BBVA_SIGN = "as-printed";
const roleOf = (a: StatementAnalysis, column: number) => a.columns.find((c) => c.column === column)!.role;

describe("IMP-02@PoC FR 4: the card amount of a monobank file whatever it prints for no commission (#694)", () => {
  for (const empty of ["—", "0.00"] as const) {
    it(`IMP-02@PoC FR 4: with «${empty}» in commission and cashback the amounts come from «Сума в валюті картки (UAH)»`, () => {
      const p = parse(monobank(empty));
      expect(roleOf(p.analysis, 4).chosen.value).toBe("amount");
      expect(roleOf(p.analysis, 4).evidence).toContainEqual({
        code: "header-word",
        column: 4,
        word: "сума в валюті картки",
      });
      expect(p.analysis.sign!.chosen.value).toBe("as-printed");
      expect(roles(p.analysis)).not.toContain("debit");
      expect(roles(p.analysis)).not.toContain("credit");
      expect(p.events.events.map((e) => e.legs)).toEqual(
        AMOUNTS.map((amount) => [{ amount, currency: "UAH" }]),
      );
      // No commission is no fee leg, whether printed «—» or 0.00.
      expect(p.events.events.every((e) => e.fee === null)).toBe(true);
      expect(p.checks.controls.find((c) => c.kind === "balance-chain")!.status).toBe("verified");
    });
  }

  it("IMP-02@PoC FR 7: the balance chain of the card currency is verified with 0.00 and with «—» in commission and cashback", () => {
    for (const empty of ["—", "0.00"] as const)
      expect(parse(monobank(empty)).checks.controls.find((c) => c.kind === "balance-chain")!.status).toBe(
        "verified",
      );
  });

  it("IMP-02@PoC FR 4: the two files import the same events", () => {
    const strip = (rows: ReturnType<typeof parse>) =>
      rows.events.events.map(({ legs, original, rate, fee, balance }) => ({
        legs,
        original,
        rate,
        fee,
        balance,
      }));
    expect(strip(parse(monobank("0.00")))).toEqual(strip(parse(monobank("—"))));
  });

  it("IMP-02@PoC FR 4: an MCC column (four-digit codes, header «MCC») is never an amount column, even when it is the only free number column", () => {
    for (const empty of ["—", "0.00"] as const) {
      const mcc = roleOf(parse(monobank(empty)).analysis, 3);
      expect(mcc.chosen.value).toBe("ignore");
      expect(
        [mcc.chosen, ...mcc.alternatives].map((h) => h.value).filter((r) => MONEY_ROLES.includes(r)),
      ).toEqual([]);
    }
    // The same guard without the rest of the file: a «Код» column of 0000–9999 beside one amount.
    const a = analyzeTable(
      [
        ["Дата", "Код", "Сума"],
        ["01.03.2026", "5411", "-12.50"],
        ["02.03.2026", "0742", "-3.00"],
        ["03.03.2026", "4829", "100.00"],
      ],
      0,
    );
    expect(roles(a)).toEqual(["date", "ignore", "amount"]);
    expect(a.sign!.chosen.value).toBe("as-printed");
  });

  it("IMP-02@PoC FR 4: a number column whose header is not MCC or «код» keeps its amount roles", () => {
    const a = analyzeTable(
      [
        ["Дата", "Номер", "Сума"],
        ["01.03.2026", "5411", "-12.50"],
        ["02.03.2026", "742", "-3.00"],
      ],
      0,
    );
    expect(roleOf(a, 2).alternatives.map((h) => h.value)).toEqual(expect.arrayContaining(["debit"]));
    expect(roleOf(a, 3).chosen.value).toBe("amount");
  });

  it("IMP-02@PoC FR 4: the commission with 0.00 is the fee column; the card amount scores above it as the amount", () => {
    const a = parse(monobank("0.00")).analysis;
    expect(roleOf(a, 8).chosen.value).toBe("fee");
    const amountScore = (column: number) => {
      const r = roleOf(a, column);
      return [r.chosen, ...r.alternatives].find((h) => h.value === "amount")?.score ?? 0;
    };
    expect(amountScore(4)).toBeGreaterThan(amountScore(8));
    expect(amountScore(4)).toBeGreaterThan(amountScore(5));
  });

  it("IMP-02@PoC FR 4: cashback is ignored for the amount, with the header word as its evidence", () => {
    for (const empty of ["—", "0.00"] as const) {
      const cashback = roleOf(parse(monobank(empty)).analysis, 9);
      expect(cashback.chosen.value).toBe("ignore");
      expect(cashback.evidence).toContainEqual({ code: "header-word", column: 9, word: "сума кешбеку" });
    }
  });

  it("IMP-02@PoC FR 4: a fee with a value is a fee leg, «—» on the other rows", () => {
    const rows = monobank("—").map((r, i) => (i === 1 ? r.map((c, j) => (j === 7 ? "1.50" : c)) : r));
    const p = parse(rows);
    expect(roleOf(p.analysis, 8).chosen.value).toBe("fee");
    expect(p.events.events[0]!.fee).toEqual({ amount: "1.50", currency: "UAH" });
    expect(p.events.events.slice(1).every((e) => e.fee === null)).toBe(true);
  });
});

describe("IMP-02@PoC FR 9: a numeric currency code under a «код» header (review of #698)", () => {
  it("IMP-02@PoC FR 9: a «Код валюти» column of numeric ISO codes stays the currency column", () => {
    for (const h of ["Код валюти", "Валюта (код)"]) {
      const p = parseStatement(
        new TextEncoder().encode(
          `Дата;Сума;${h};Опис\n01.03.2026;-10,00;980;Кава\n02.03.2026;-20,00;840;Хліб\n03.03.2026;-30,00;978;Хліб\n`,
        ),
        { delimiter: ";" },
        { account: { currencies: ["UAH", "USD", "EUR"], multiCurrency: true } },
      );
      expect(roleOf(p.analysis, 3).chosen.value).toBe("currency");
      expect(p.events.events.map((e) => e.legs[0]!.currency)).toEqual(["UAH", "USD", "EUR"]);
    }
  });
});

describe("IMP-02@PoC FR 12: «—» in «Курс» is an empty rate", () => {
  it("IMP-02@PoC FR 12: «—» leaves the rate empty; the printed rates are kept and checked", () => {
    for (const empty of ["—", "0.00"] as const) {
      const p = parse(monobank(empty));
      expect(roleOf(p.analysis, 7).chosen.value).toBe("exchange-rate");
      expect(p.events.events.map((e) => e.rate)).toEqual([
        null,
        null,
        "41.5000",
        null,
        null,
        "45.0000",
        null,
        null,
      ]);
      expect(p.events.events.every((e) => e.flags.length === 0)).toBe(true);
    }
  });

  it("IMP-02@PoC FR 12: the rate check runs for a monobank file: a wrong rate is flagged «розбіжність курсу»", () => {
    const p = parse(monobank("—", (row, printed) => (row === 2 ? "45.0000" : printed)));
    expect(p.events.events[2]!.flags).toContain("rate-mismatch");
    expect(p.events.events.filter((e) => e.flags.length > 0)).toHaveLength(1);
  });
});

describe("IMP-02@PoC FR 4: the other banks' layouts map as before (tools/synthetic family statements)", () => {
  it("IMP-02@PoC FR 4: Revolut — amount, fee 0.00, currency, state, balance", () => {
    const rows = [
      "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
      "CARD_PAYMENT,Current,2026-11-01 10:00:00,2026-11-02 10:00:00,Synth Cafe,-12.50,0.00,EUR,COMPLETED,987.50",
      "TOPUP,Current,2026-11-03 09:00:00,2026-11-03 09:00:00,Synth Salary,500.00,0.00,EUR,COMPLETED,1487.50",
      "CARD_PAYMENT,Current,2026-11-04 18:30:00,,Synth Shop,-40.00,0.00,EUR,REVERTED,",
      "TRANSFER,Current,2026-11-05 12:00:00,2026-11-05 12:00:00,To Synth,-87.50,0.00,EUR,COMPLETED,1400.00",
    ];
    const p = parseStatement(
      new TextEncoder().encode(rows.join("\n")),
      {},
      {
        account: { currencies: ["EUR"], multiCurrency: false },
      },
    );
    expect(roles(p.analysis)).toEqual([
      "description",
      "description",
      "date",
      "value-date",
      "description",
      "amount",
      "fee",
      "currency",
      "status",
      "balance",
    ]);
    expect(p.analysis.sign!.chosen.value).toBe("as-printed");
    expect(p.events.events.map((e) => e.legs[0]!.amount)).toEqual(["-12.50", "500.00", "-40.00", "-87.50"]);
  });

  it("IMP-02@PoC FR 4: Raiffeisen UA — debit and credit columns, «1 234,56» numbers", () => {
    const rows = [
      "Виписка по рахунку;UA000000000000000000000000000",
      "Період;01.11.2026 - 30.11.2026",
      "Валюта;UAH",
      "Вхідний залишок;10 000,00",
      "Дата операції;Дата проведення;Опис операції;Дебет;Кредит;Залишок",
      "01.11.2026;02.11.2026;Синтетичний магазин;1 234,56;;8 765,44",
      "03.11.2026;03.11.2026;Зарплата Тест;;2 000,00;10 765,44",
      "05.11.2026;06.11.2026;Аптека Тест;65,44;;10 700,00",
      "08.11.2026;08.11.2026;Кафе Тест;200,00;;10 500,00",
      "12.11.2026;13.11.2026;Переказ Тест;;500,00;11 000,00",
      "15.11.2026;15.11.2026;Комунальні Тест;1 000,00;;10 000,00",
      "20.11.2026;21.11.2026;Магазин Тест;300,00;;9 700,00",
      "25.11.2026;25.11.2026;Повернення Тест;;100,00;9 800,00",
      "Обороти;;;2 800,00;2 600,00;",
      "Вихідний залишок;;;;;9 800,00",
    ];
    const p = parseStatement(new TextEncoder().encode(rows.join("\r\n")), { delimiter: ";" }, UAH_ACCOUNT);
    expect(roles(p.analysis)).toEqual(["date", "value-date", "description", "debit", "credit", "balance"]);
    expect(p.analysis.sign!.chosen.value).toBe("debit-credit");
    expect(p.events.events.slice(0, 3).map((e) => e.legs[0]!.amount)).toEqual([
      "-1234.56",
      "2000.00",
      "-65.44",
    ]);
  });

  it("IMP-02@PoC FR 4: BBVA — «Importe», «Divisa», «Disponible» as the sheet's cells read", () => {
    const a = analyzeTable(
      [
        ["Últimos movimientos"],
        ["Cuenta", "ES00 0000 0000 0000 0000 0000"],
        ["Periodo", "01/11/2026 - 30/11/2026"],
        [],
        [
          "F.Valor",
          "Fecha",
          "Concepto",
          "Movimiento",
          "Importe",
          "Divisa",
          "Disponible",
          "Divisa",
          "Observaciones",
        ],
        [
          "21/11/2026",
          "20/11/2026",
          "Synth Cafe",
          "Pago con tarjeta",
          "-12.50",
          "EUR",
          "1987.50",
          "EUR",
          "Tarjeta 0000",
        ],
        ["19/11/2026", "18/11/2026", "Synth Nomina", "Nómina", "1500.00", "EUR", "2000.00", "EUR", ""],
        ["16/11/2026", "15/11/2026", "Synth Recibo", "Recibo", "-45.30", "EUR", "500.00", "EUR", ""],
      ],
      4,
    );
    expect(roles(a)).toEqual(BBVA_ROLES);
    expect(a.sign?.chosen.value ?? null).toBe(BBVA_SIGN);
  });
});
