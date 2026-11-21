import { describe, expect, it } from "vitest";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * A card statement whose amount column names the card's currency in its header («Сума в валюті картки (UAH)») and whose
 * bare «Валюта» column is the currency of the original operation (a purchase abroad in USD or EUR), as monobank
 * prints it. The amount posted to the account is the card's; the operation's amount and currency are the original
 * ones (IMP-02@PoC FR 4) and never make a single-currency account «another account» (IMP-05@PoC EC3). Synthetic rows
 * only: invented merchants and amounts, a balance chain that adds up, newest first.
 */
const header = (card: string) => [
  "Дата i час операції",
  "Деталі операції",
  "MCC",
  `Сума в валюті картки (${card})`,
  "Сума в валюті операції",
  "Валюта",
  "Курс",
  `Сума комісій (${card})`,
  `Сума кешбеку (${card})`,
  "Залишок після операції",
];
const ROWS: readonly (readonly string[])[] = [
  ["20.11.2026 18:05:11", "Кав'ярня Тест", "5814", "-85.00", "-85.00", "UAH", "—", "—", "0.85", "10559.60"],
  [
    "19.11.2026 12:00:00",
    "Поповнення з картки",
    "4829",
    "2000.00",
    "2000.00",
    "UAH",
    "—",
    "—",
    "—",
    "10644.60",
  ],
  [
    "18.11.2026 09:15:42",
    "SYNTH SHOP ONLINE",
    "5732",
    "-415.00",
    "-10.00",
    "USD",
    "41.5000",
    "—",
    "—",
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
    "—",
    "5.12",
    "9059.60",
  ],
  ["16.11.2026 08:00:00", "Метро", "4111", "-8.00", "-8.00", "UAH", "—", "—", "—", "9572.00"],
  [
    "15.11.2026 14:45:10",
    "SYNTH STORE EU",
    "5999",
    "-900.00",
    "-20.00",
    "EUR",
    "45.0000",
    "—",
    "—",
    "9580.00",
  ],
  ["14.11.2026 10:10:10", "Аптека Тест", "5912", "-230.00", "-230.00", "UAH", "—", "—", "2.30", "10480.00"],
  ["13.11.2026 16:20:00", "Переказ від Тест", "4829", "1500.00", "1500.00", "UAH", "—", "—", "—", "10710.00"],
  [
    "12.11.2026 19:00:00",
    "Ресторан Синтетик",
    "5812",
    "-640.00",
    "-640.00",
    "UAH",
    "—",
    "—",
    "6.40",
    "9210.00",
  ],
  ["11.11.2026 07:30:00", "Таксі Тест", "4121", "-150.00", "-150.00", "UAH", "—", "—", "—", "9850.00"],
];
const csv = (rows: readonly (readonly string[])[]) =>
  new TextEncoder().encode(
    "﻿" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n",
  );
const UAH_ACCOUNT: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };
const parse = (card = "UAH", statement: StatementOptions = UAH_ACCOUNT) =>
  parseStatement(csv([header(card), ...ROWS]), {}, statement);
const roleOf = (p: ReturnType<typeof parse>, column: number) =>
  p.analysis.columns.find((c) => c.column === column)!.role;

describe("IMP-02@PoC: the card currency of the amount column and the original currency of the operation", () => {
  it("IMP-02@PoC FR 4: the amount posted is the card's (UAH, named in its header); «Валюта» with «Сума в валюті операції» is the original currency", () => {
    const p = parse();
    // «Валюта» is the original operation's currency, not each row's; the file's currency is the header's.
    expect(roleOf(p, 6).chosen.value).toBe("original-currency");
    expect(roleOf(p, 6).alternatives.map((h) => h.value)).toContain("currency");
    expect(roleOf(p, 6).evidence).toContainEqual({ code: "currency-in-header", column: 4, word: "UAH" });
    expect(p.analysis.currency).toMatchObject({ mode: "file", code: "UAH" });
    const [, , abroad, , , euro] = p.events.events;
    expect(abroad).toMatchObject({
      currency: "UAH",
      legs: [{ amount: "-415.00", currency: "UAH" }],
      original: { amount: "-10.00", currency: "USD" },
      flags: [],
    });
    expect(euro).toMatchObject({
      currency: "UAH",
      legs: [{ amount: "-900.00", currency: "UAH" }],
      original: { amount: "-20.00", currency: "EUR" },
    });
    // The wallets the batch fills: the account's one currency only.
    expect(p.events.currencies).toEqual(["UAH"]);
    expect(p.events.events.every((e) => e.currency === "UAH" && e.flags.length === 0)).toBe(true);
  });

  it("IMP-02@PoC FR 7: the balance chain of the card currency is checked across the purchases abroad", () => {
    const p = parse();
    expect(p.checks.controls.find((c) => c.kind === "balance-chain")!.status).toBe("verified");
  });

  it("IMP-02@PoC FR 3: a file without an original amount keeps «Валюта» as each row's currency", () => {
    const p = parseStatement(
      new TextEncoder().encode(
        ["Дата;Сума (UAH);Валюта;Опис", "01.03.2026;-120,50;PLN;Кава", "02.03.2026;-5,00;PLN;Хліб"].join(
          "\n",
        ),
      ),
      { delimiter: ";" },
      UAH_ACCOUNT,
    );
    expect(p.analysis.columns[2]!.role.chosen.value).toBe("currency");
    expect(p.events.events.every((e) => e.currency === "PLN")).toBe(true);
    expect(p.events.events[0]!.flags).toContain("currency-not-in-account");
  });

  it("IMP-02@PoC FR 4: an amount column without a currency in its header keeps «Валюта» as the settled currency", () => {
    const p = parseStatement(
      new TextEncoder().encode(
        [
          "Дата;Сума;Сума в валюті операції;Валюта;Опис",
          "01.03.2026;-22,50;-1 000,00;EUR;Кава",
          "02.03.2026;-5,00;-5,00;EUR;Хліб",
        ].join("\n"),
      ),
      { delimiter: ";" },
      { account: { currencies: ["EUR"], multiCurrency: false } },
    );
    expect(p.analysis.columns[3]!.role.chosen.value).toBe("currency");
    expect(p.events.events.map((e) => e.legs[0])).toEqual([
      { amount: "-22.50", currency: "EUR" },
      { amount: "-5.00", currency: "EUR" },
    ]);
  });
});

describe("IMP-05@PoC EC3: the file's currency against a single-currency account", () => {
  it("IMP-05@PoC EC3: purchases abroad on a UAH card file are no reason «валюта» for the UAH account", () => {
    const p = parse();
    expect(p.checks.account.reasons).toEqual([]);
    expect(p.checks.account.status).not.toBe("mismatch");
    expect(p.checks.flags.map((f) => f.code)).not.toContain("foreign-account");
  });

  it("IMP-05@PoC EC3: a USD card file on the UAH account is still «чужий рахунок» with the reason «валюта» USD against UAH", () => {
    const p = parse("USD");
    expect(p.events.currencies).toEqual(["USD"]);
    expect(p.checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "currency", file: "USD", account: "UAH" }],
    });
    expect(p.checks.flags.map((f) => f.code)).toContain("foreign-account");
    expect(p.events.events.every((e) => e.flags.includes("currency-not-in-account"))).toBe(true);
  });

  it("IMP-05@PoC EC3: the same UAH card file on a multi-currency account fills the UAH wallet only", () => {
    const p = parse("UAH", { account: { currencies: ["UAH", "USD", "EUR"], multiCurrency: true } });
    expect(p.events.currencies).toEqual(["UAH"]);
    expect(p.checks.account.reasons).toEqual([]);
  });
});

describe("IMP-02@PoC FR 4: «Валюта» and a separate original-currency column (security review #693)", () => {
  const file = (lines: string[]) => new TextEncoder().encode(lines.join("\n"));

  it("IMP-02@PoC FR 4: with «Валюта операції» present, the bare «Валюта» is not taken as the original currency", () => {
    const p = parseStatement(
      file([
        "Дата;Сума (UAH);Сума в валюті операції;Валюта операції;Валюта;Опис",
        "01.03.2026;-415,00;-10,00;USD;UAH;Кава",
        "02.03.2026;-5,00;-5,00;UAH;UAH;Хліб",
      ]),
      { delimiter: ";" },
      UAH_ACCOUNT,
    );
    expect(p.analysis.columns[3]!.role.chosen.value).toBe("original-currency");
    expect(p.analysis.columns[4]!.role.chosen.value).toBe("currency");
    expect(p.events.events[0]).toMatchObject({
      currency: "UAH",
      original: { amount: "-10.00", currency: "USD" },
    });
  });

  it("IMP-02@PoC FR 4: debit and credit columns that name the card currency make «Валюта» the original currency", () => {
    const p = parseStatement(
      file([
        "Дата;Дебет (UAH);Кредит (UAH);Сума в валюті операції;Валюта;Опис",
        "01.03.2026;415,00;;-10,00;USD;Кава",
        "02.03.2026;;500,00;500,00;UAH;Переказ",
      ]),
      { delimiter: ";" },
      UAH_ACCOUNT,
    );
    expect(p.analysis.columns[4]!.role.chosen.value).toBe("original-currency");
    expect(p.events.currencies).toEqual(["UAH"]);
    expect(p.checks.account.reasons).toEqual([]);
  });

  it("IMP-02@PoC FR 3: a currency only in the balance header leaves «Валюта» as each row's currency", () => {
    const p = parseStatement(
      file([
        "Дата;Сума;Сума в валюті операції;Валюта;Залишок (UAH);Опис",
        "01.03.2026;-22,50;-1 000,00;EUR;100,00;Кава",
        "02.03.2026;-5,00;-5,00;EUR;95,00;Хліб",
      ]),
      { delimiter: ";" },
      { account: { currencies: ["EUR"], multiCurrency: false } },
    );
    expect(p.analysis.columns[3]!.role.chosen.value).toBe("currency");
  });
});
