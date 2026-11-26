import { describe, expect, it } from "vitest";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * #704 security review: the same-day order (`dayPath`) never hides a real break — every row stays in the chain, a
 * break that no order of the day removes is still «розбіжність», and large adversarial days stay within the time
 * bound. Synthetic rows only.
 */
const HEADER = ["Дата", "Опис", "Сума", "Комісія", "Залишок"];
type Row = readonly [date: string, details: string, amount: string, fee: string, balance: string];
const csv = (rows: readonly (readonly string[])[]) =>
  new TextEncoder().encode(rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n") + "\n");
const UAH: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };
const parse = (rows: readonly Row[], newestFirst = false) =>
  parseStatement(csv([HEADER, ...(newestFirst ? [...rows].reverse() : rows)]), {}, UAH);
const chain = (p: ReturnType<typeof parse>) => p.checks.controls.find((c) => c.kind === "balance-chain")!;

const PREVIOUS: Row = ["15.11.2026", "Надходження Тест", "100.00", "", "100.00"];
const UP: Row = ["16.11.2026", "Повернення Тест", "50.00", "", "150.00"];
const DOWN: Row = ["16.11.2026", "Покупка Тест", "-50.00", "", "100.00"];

describe("IMP-05@PoC FR 1 (#704 security): no same-day order hides a real break", () => {
  it("IMP-05@PoC FR 1: a cycle back to the balance reached and a row no link reaches — «розбіжність», the row kept", () => {
    const stray: Row = ["16.11.2026", "Кава Тест", "-20.00", "", "480.00"];
    for (const day of [
      [UP, DOWN, stray],
      [stray, UP, DOWN],
      [DOWN, stray, UP],
    ])
      for (const newestFirst of [false, true]) {
        const p = parse([PREVIOUS, ...day], newestFirst);
        expect(chain(p).status).toBe("mismatch");
        expect(p.events.events).toHaveLength(4);
      }
  });

  it("IMP-05@PoC FR 1: two rows that both start at the balance reached — «розбіжність» on every printed order", () => {
    const a: Row = ["16.11.2026", "Повернення Тест", "50.00", "", "150.00"];
    const b: Row = ["16.11.2026", "Кава Тест", "20.00", "", "120.00"];
    for (const day of [
      [a, b],
      [b, a],
    ])
      for (const newestFirst of [false, true])
        expect(chain(parse([PREVIOUS, ...day], newestFirst)).status).toBe("mismatch");
  });

  it("IMP-05@PoC FR 1: the same row printed twice where only one fits — «розбіжність»", () => {
    for (const newestFirst of [false, true])
      expect(chain(parse([PREVIOUS, UP, UP], newestFirst)).status).toBe("mismatch");
  });

  it("IMP-05@PoC FR 1: zero amounts and repeated balances of one moment in any order — verified, every row kept", () => {
    const zero: Row = ["16.11.2026", "Перевірка Тест", "0.00", "", "100.00"];
    const zero150: Row = ["16.11.2026", "Перевірка Тест", "0.00", "", "150.00"];
    const coffee: Row = ["16.11.2026", "Кава Тест", "-30.00", "", "70.00"];
    for (const day of [
      [coffee, zero150, DOWN, zero, UP],
      [zero, coffee, UP, zero150, DOWN],
    ])
      for (const newestFirst of [false, true]) {
        const p = parse([PREVIOUS, ...day], newestFirst);
        expect(chain(p).status).toBe("verified");
        expect(p.checks.bounds.closing).toBe("70.00");
        expect(p.events.events).toHaveLength(6);
      }
  });

  it("IMP-05@PoC FR 1: a break at the day boundary — «розбіжність», although the day alone is a path", () => {
    const later: Row[] = [
      ["16.11.2026", "Кава Тест", "-30.00", "", "170.00"],
      ["16.11.2026", "Повернення Тест", "50.00", "", "200.00"],
    ];
    for (const newestFirst of [false, true])
      expect(chain(parse([PREVIOUS, ...later], newestFirst)).status).toBe("mismatch");
  });
  it("IMP-05@PoC FR 1: a one-day file whose first row is printed in the middle — verified from the row no other row leads to", () => {
    const opening: Row = ["16.11.2026", "Надходження Тест", "100.00", "", "100.00"];
    const coffee: Row = ["16.11.2026", "Кава Тест", "-30.00", "", "70.00"];
    for (const newestFirst of [false, true]) {
      const p = parse([UP, opening, DOWN, coffee], newestFirst);
      expect(chain(p).status).toBe("verified");
      expect(p.checks.bounds.opening).toBe("0.00");
    }
  });

  it("IMP-05@PoC FR 1: where no order of the day holds, the break is reported at the row printed second, as printed", () => {
    const a: Row = ["16.11.2026", "Повернення Тест", "50.00", "", "150.00"];
    const b: Row = ["16.11.2026", "Кава Тест", "20.00", "", "120.00"];
    const p = parse([PREVIOUS, a, b]);
    expect(chain(p).status).toBe("mismatch");
    expect(chain(p).breaks).toBe(1);
    const row = p.events.events.find((e) => e.description === "Кава Тест")!.row;
    expect(chain(p).row).toBe(row);
  });
});

describe("IMP-05@PoC FR 1 (#704 security): large adversarial days stay within the time bound", () => {
  // The table limit counts the header row too: the opening row and ROWS rows of one date.
  const ROWS = 19_997;
  const money = (v: number) => (v / 100).toFixed(2);
  const row = (k: number, amount: number, after: number): Row => [
    "16.11.2026",
    `Синтетичний рядок ${k}`,
    money(amount),
    "",
    money(after),
  ];
  const open: Row = ["15.11.2026", "Надходження Тест", money(100_000), "", money(100_000)];

  it("IMP-05@PoC FR 1: 19 997 rows of one balance's cycles ending in a real break — «розбіжність» within 15 s", () => {
    const rows: Row[] = [open];
    for (let k = 0; k + 2 < ROWS; k += 2) rows.push(row(k, 5000, 105_000), row(k + 1, -5000, 100_000));
    rows.push(row(ROWS, -100, 1)); // breaks: 100 000 − 100 ≠ 1
    const started = performance.now();
    const p = parse(rows, true);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(chain(p).status).toBe("mismatch");
  }, 60_000);

  it("IMP-05@PoC FR 1: 19 997 zero and one-kopiyka rows at one balance and a deep walk — verified within 15 s", () => {
    const rows: Row[] = [open];
    let b = 100_000;
    for (let k = 0; k < ROWS; k++) {
      if (k % 2 === 0) rows.push(row(k, 0, b));
      else rows.push(row(k, -1, (b -= 1)));
    }
    const shuffled = [rows[0]!, ...rows.slice(1).reverse()];
    const started = performance.now();
    const p = parse(shuffled);
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(chain(p).status).toBe("verified");
    expect(p.events.events).toHaveLength(ROWS + 1);
  }, 60_000);
});
