import { describe, expect, it } from "vitest";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * #698 owner report: a monobank card statement with commissions. «Сума в валюті картки (UAH)» is the card's movement
 * with the fee in it — a purchase in EUR prints original × rate + fee (100,00 EUR × 45,50 + 91,00 = 4 641,00), a UAH
 * transfer prints the same card and operation amounts with the fee beside them — and «Залишок після операції» follows
 * the card amounts. Rows of one moment may be printed in any order. Synthetic merchants and amounts only; the balance
 * chain adds up; newest first, as the bank prints it.
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
const OPENING = "50000.00";
/** Oldest first: date, details, MCC, card, operation, currency, rate, fee, cashback, balance after. */
const OPERATIONS = [
  [
    "01.11.2026 10:00:00",
    "Зарплата Синтетик",
    "4829",
    "30000.00",
    "30000.00",
    "UAH",
    "—",
    "—",
    "—",
    "80000.00",
  ],
  // UAH transfer: the card and the operation amounts are the same, the fee is printed beside them.
  [
    "02.11.2026 12:00:00",
    "Переказ на картку",
    "4829",
    "-10265.00",
    "-10265.00",
    "UAH",
    "—",
    "265.00",
    "—",
    "69735.00",
  ],
  // EUR purchase: 100,00 × 45,50 = 4 550,00 plus the fee 91,00.
  [
    "03.11.2026 08:30:00",
    "SYNTH SHOP EU",
    "5999",
    "-4641.00",
    "-100.00",
    "EUR",
    "45.5000",
    "91.00",
    "—",
    "65094.00",
  ],
  // Two operations of one moment.
  ["03.11.2026 09:00:00", "Кав'ярня Тест", "5814", "-50.00", "-50.00", "UAH", "—", "—", "—", "65044.00"],
  ["03.11.2026 09:00:00", "Пекарня Тест", "5462", "-30.00", "-30.00", "UAH", "—", "—", "—", "65014.00"],
  [
    "04.11.2026 18:00:00",
    "Банкомат Синтетик",
    "6011",
    "-2020.00",
    "-2000.00",
    "UAH",
    "—",
    "20.00",
    "—",
    "62994.00",
  ],
] as const;

/** Newest first; the two operations of 03.11 09:00 printed in the order that breaks the printed chain. */
function printed(): string[][] {
  const rows: string[][] = OPERATIONS.map((r) => [...r]).reverse();
  const a = rows.findIndex((r) => r[1] === "Кав'ярня Тест");
  const b = rows.findIndex((r) => r[1] === "Пекарня Тест");
  [rows[a], rows[b]] = [rows[b]!, rows[a]!];
  return [HEADER, ...rows];
}

const csv = (rows: readonly (readonly string[])[]) =>
  new TextEncoder().encode(
    // Mixed quoting, as the bank's export: text quoted, numbers bare.
    "﻿" +
      rows
        .map((r) =>
          r.map((c, i) => (i <= 2 || /[^0-9.\-—]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","),
        )
        .join("\r\n") +
      "\r\n",
  );
const UAH_ACCOUNT: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };
const parse = (rows: readonly (readonly string[])[]) => parseStatement(csv(rows), {}, UAH_ACCOUNT);
const byDetails = (p: ReturnType<typeof parse>, details: string) =>
  p.events.events.find((e) => e.description === details)!;
const status = (p: ReturnType<typeof parse>, kind: string) =>
  p.checks.controls.find((c) => c.kind === kind)!.status;

describe("IMP-02@PoC FR 5: a monobank row with a commission is read with its fee (#698)", () => {
  it("IMP-02@PoC FR 5: the card amount is the movement with the fee in it; the fee is its own leg", () => {
    const p = parse(printed());
    const transfer = byDetails(p, "Переказ на картку");
    expect(transfer.legs).toEqual([{ amount: "-10265.00", currency: "UAH" }]);
    expect(transfer.fee).toEqual({ amount: "265.00", currency: "UAH" });
    expect(transfer.feeIncluded).toBe(true);
    const atm = byDetails(p, "Банкомат Синтетик");
    expect(atm.fee).toEqual({ amount: "20.00", currency: "UAH" });
    expect(atm.feeIncluded).toBe(true);
    // «—» is no fee, and no flag.
    const coffee = byDetails(p, "Кав'ярня Тест");
    expect(coffee.fee).toBeNull();
    expect(coffee.feeIncluded).toBeUndefined();
    expect(p.events.events.flatMap((e) => e.flags)).toEqual([]);
  });

  it("IMP-02@PoC FR 12: original × rate + fee is the card amount — no «розбіжність курсу»", () => {
    const shop = byDetails(parse(printed()), "SYNTH SHOP EU");
    expect(shop.original).toEqual({ amount: "-100.00", currency: "EUR" });
    expect(shop.rate).toBe("45.5000");
    expect(shop.flags).toEqual([]);
  });

  it("IMP-02@PoC AC6: a rate that agrees neither with the card amount nor with it less the fee is still «розбіжність курсу»", () => {
    const rows = printed().map((r) =>
      r[1] === "SYNTH SHOP EU" ? r.map((c, i) => (i === 6 ? "47.0000" : c)) : r,
    );
    expect(byDetails(parse(rows), "SYNTH SHOP EU").flags).toEqual(["rate-mismatch"]);
  });

  it("IMP-05@PoC FR 1: rows of one moment printed out of the chain's order — the balance chain and the totals agree, no «Підсумки не збігаються»", () => {
    const p = parse(printed());
    expect(status(p, "balance-chain")).toBe("verified");
    expect(status(p, "balance-equation")).toBe("verified");
    expect(p.checks.bounds.opening).toBe(OPENING);
    expect(p.checks.bounds.closing).toBe("62994.00");
    expect(p.checks.flags.map((f) => f.code)).not.toContain("checksum-mismatch");
  });

  it("IMP-05@PoC FR 1: a real break is still a break with its difference", () => {
    const rows = printed().map((r) =>
      r[1] === "Банкомат Синтетик" ? r.map((c, i) => (i === 9 ? "62990.00" : c)) : r,
    );
    const p = parse(rows);
    const chain = p.checks.controls.find((c) => c.kind === "balance-chain")!;
    expect(chain.status).toBe("mismatch");
    expect(chain.difference).toBe("-4.00");
  });

  it("IMP-02@PoC FR 5: a fee cell that does not read is flagged, never taken as no fee", () => {
    const rows = printed().map((r) =>
      r[1] === "Банкомат Синтетик" ? r.map((c, i) => (i === 7 ? "20.00.00" : c)) : r,
    );
    const atm = parse(rows).events.events.find((e) => e.legs[0]?.amount === "-2020.00")!;
    expect(atm.fee).toBeNull();
    expect(atm.flags).toContain("fee-unreadable");
  });
});

describe("IMP-02@PoC FR 5: whether the amount includes the fee is read from the file", () => {
  /** A generic bank: the amount without its fee, the balance after both (opening 1 000,00); the fee row on a link. */
  const GENERIC = [
    ["Дата", "Опис", "Сума", "Комісія", "Залишок"],
    ["01.03.2026", "Кава Тест", "-4.00", "", "996.00"],
    ["02.03.2026", "Переказ Тест", "-100.00", "1.50", "894.50"],
    ["03.03.2026", "Надходження Тест", "200.00", "", "1094.50"],
  ];

  it("IMP-02@PoC FR 5: the balances follow the amounts less the fee — the amount excludes it, and the checks count the fee", () => {
    const p = parse(GENERIC);
    const transfer = byDetails(p, "Переказ Тест");
    expect(transfer.legs).toEqual([{ amount: "-100.00", currency: "UAH" }]);
    expect(transfer.fee).toEqual({ amount: "1.50", currency: "UAH" });
    expect(transfer.feeIncluded).toBe(false);
    expect(status(p, "balance-chain")).toBe("verified");
    expect(p.checks.bounds.opening).toBe("1000.00");
  });

  it("IMP-02@PoC FR 5: without balances the amount excludes the fee (the operation as printed)", () => {
    const p = parse(GENERIC.map((r) => r.slice(0, 4)));
    expect(byDetails(p, "Переказ Тест").feeIncluded).toBe(false);
  });

  it("IMP-02@PoC FR 5: without balances an amount header that names the card's currency includes the fee", () => {
    const p = parse(printed().map((r) => r.slice(0, 9)));
    expect(byDetails(p, "Переказ на картку").feeIncluded).toBe(true);
  });

  /** Amounts with the fee in them (opening 1 000,00), one real break at 03.03 that has no fee. */
  const BROKEN = [
    ["Дата", "Опис", "Сума", "Комісія", "Залишок"],
    ["01.03.2026", "Переказ Тест", "-100.00", "1.50", "900.00"],
    ["02.03.2026", "Кава Тест", "-4.00", "", "896.00"],
    ["03.03.2026", "Надходження Тест", "200.00", "", "1090.00"],
    ["04.03.2026", "Платіж Тест", "-50.00", "2.00", "1040.00"],
  ];

  it("IMP-02@PoC FR 5: a real break elsewhere — the unbroken links of the fee rows decide the basis (#703)", () => {
    const p = parse(BROKEN);
    expect(status(p, "balance-chain")).toBe("mismatch");
    expect(byDetails(p, "Платіж Тест").feeIncluded).toBe(true);
    expect(byDetails(p, "Переказ Тест").feeIncluded).toBe(true);
    expect(p.events.events.flatMap((e) => e.flags)).toEqual([]);
  });

  it("IMP-02@PoC FR 5: balances that do not tell (the break at the only linked fee row) — the fee rows are flagged, never guessed (#703)", () => {
    const p = parse(BROKEN.map((r) => (r[1] === "Платіж Тест" ? [...r.slice(0, 4), "1030.00"] : r)));
    for (const details of ["Платіж Тест", "Переказ Тест"]) {
      const e = byDetails(p, details);
      expect(e.feeIncluded).toBeUndefined();
      expect(e.flags).toContain("fee-basis-unknown");
    }
    expect(byDetails(p, "Кава Тест").flags).toEqual([]);
  });

  it("IMP-02@PoC FR 5: balances that verify either way (the fee row first, on no link) — the card-currency header tells", () => {
    const rows = [
      HEADER,
      ["05.11.2026 10:00:00", "Кав'ярня Тест", "5814", "-50.00", "-50.00", "UAH", "—", "—", "—", "62944.00"],
      [
        "04.11.2026 18:00:00",
        "Банкомат Синтетик",
        "6011",
        "-2020.00",
        "-2000.00",
        "UAH",
        "—",
        "20.00",
        "—",
        "62994.00",
      ],
    ];
    const atm = byDetails(parse(rows), "Банкомат Синтетик");
    expect(atm.feeIncluded).toBe(true);
    expect(atm.flags).toEqual([]);
  });

  it("IMP-02@PoC FR 5: a real break and the fee row on no link — the card-currency header does not decide, the fee row is flagged (#703 review)", () => {
    const rows = [
      HEADER,
      ["05.11.2026 10:00:00", "Кав'ярня Тест", "5814", "-50.00", "-50.00", "UAH", "—", "—", "—", "62940.00"],
      [
        "04.11.2026 18:00:00",
        "Банкомат Синтетик",
        "6011",
        "-2020.00",
        "-2000.00",
        "UAH",
        "—",
        "20.00",
        "—",
        "62994.00",
      ],
    ];
    const atm = byDetails(parse(rows), "Банкомат Синтетик");
    expect(atm.feeIncluded).toBeUndefined();
    expect(atm.flags).toContain("fee-basis-unknown");
  });

  it("IMP-02@PoC FR 5: a real break, one fee row linked with its fee in the amount and one without — flagged, never guessed (#703 review)", () => {
    const p = parse([
      ["Дата", "Опис", "Сума", "Комісія", "Залишок"],
      ["01.03.2026", "Кава Тест", "-4.00", "", "996.00"],
      ["02.03.2026", "Переказ Тест", "-100.00", "1.50", "896.00"],
      ["03.03.2026", "Платіж Тест", "-50.00", "2.00", "844.00"],
    ]);
    expect(status(p, "balance-chain")).toBe("mismatch");
    for (const details of ["Переказ Тест", "Платіж Тест"]) {
      expect(byDetails(p, details).feeIncluded).toBeUndefined();
      expect(byDetails(p, details).flags).toContain("fee-basis-unknown");
    }
  });
});
