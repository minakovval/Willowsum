import { describe, expect, it } from "vitest";
import type { StatementOptions } from "../domain/index.ts";
import { parseStatement } from "./parse-statement.ts";

/**
 * #703 money check on main cd0ef8c5: rows of one day were put in the chain's order greedily (the first row, in the
 * printed order, that starts where the chain is) and could dead-end although an order through every row exists —
 * a false «Підсумки не збігаються» (IMP-05@PoC FR 1, IMP-02@PoC FR 7) and the rows with a fee refused as
 * `fee-basis-unknown` (IMP-02@PoC FR 5). Synthetic rows only.
 */
const HEADER = ["Дата", "Опис", "Сума", "Комісія", "Залишок"];
type Row = readonly [date: string, details: string, amount: string, fee: string, balance: string];

const csv = (rows: readonly (readonly string[])[]) =>
  new TextEncoder().encode(rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n") + "\n");
const UAH: StatementOptions = { account: { currencies: ["UAH"], multiCurrency: false } };
/** Rows given oldest first; `newestFirst` prints them reversed, as many banks do. */
const parse = (rows: readonly Row[], newestFirst = false) =>
  parseStatement(csv([HEADER, ...(newestFirst ? [...rows].reverse() : rows)]), {}, UAH);
const chain = (p: ReturnType<typeof parse>) => p.checks.controls.find((c) => c.kind === "balance-chain")!;
const status = (p: ReturnType<typeof parse>, kind: string) =>
  p.checks.controls.find((c) => c.kind === kind)!.status;

// The repro: previous balance 100; A +50 → 150, B −50 → 100, C −30 → 70 on one day.
const PREVIOUS: Row = ["15.11.2026", "Надходження Тест", "100.00", "", "100.00"];
const A: Row = ["16.11.2026", "Повернення Тест", "50.00", "", "150.00"];
const B: Row = ["16.11.2026", "Покупка Тест", "-50.00", "", "100.00"];
const C: Row = ["16.11.2026", "Кава Тест", "-30.00", "", "70.00"];

describe("IMP-05@PoC FR 1: rows of one day are ordered as a path through their balances (#703 money check)", () => {
  it("IMP-05@PoC FR 1: printed C, A, B after the previous balance 100 — the chain is verified, no «Підсумки не збігаються»", () => {
    const p = parse([PREVIOUS, C, A, B]);
    expect(chain(p).status).toBe("verified");
    expect(status(p, "balance-equation")).toBe("verified");
    expect(p.checks.bounds.opening).toBe("0.00");
    expect(p.checks.bounds.closing).toBe("70.00");
    expect(p.checks.flags.map((f) => f.code)).not.toContain("checksum-mismatch");
  });

  it("IMP-05@PoC FR 1: every printed order of the day verifies, oldest first and newest first", () => {
    const orders = [
      [A, B, C],
      [A, C, B],
      [B, A, C],
      [B, C, A],
      [C, A, B],
      [C, B, A],
    ];
    for (const day of orders)
      for (const newestFirst of [false, true]) {
        const p = parse([PREVIOUS, ...day], newestFirst);
        expect(chain(p).status, `${day.map((r) => r[1]).join(", ")} newest first ${newestFirst}`).toBe(
          "verified",
        );
        expect(p.checks.bounds.closing).toBe("70.00");
      }
  });

  it("IMP-05@PoC FR 1: a file of that one day only, printed C, A, B — the chain is verified from its opening 100", () => {
    for (const newestFirst of [false, true]) {
      const p = parse([C, A, B], newestFirst);
      expect(chain(p).status).toBe("verified");
      expect(p.checks.bounds.opening).toBe("100.00");
      expect(p.checks.bounds.closing).toBe("70.00");
    }
  });

  it("IMP-05@PoC FR 1: the first day of a longer file, printed B first — the walk starts where one more row leaves than arrives", () => {
    const next: Row = ["17.11.2026", "Кава Тест", "-10.00", "", "60.00"];
    for (const day of [
      [B, A, C],
      [B, C, A],
    ])
      for (const newestFirst of [false, true]) {
        const p = parse([...day, next], newestFirst);
        expect(chain(p).status, `${day.map((r) => r[1]).join(", ")} newest first ${newestFirst}`).toBe(
          "verified",
        );
        expect(p.checks.bounds.opening).toBe("100.00");
        expect(p.checks.bounds.closing).toBe("60.00");
      }
  });

  it("IMP-05@PoC FR 1: a day with a real break still reports «розбіжність»", () => {
    const broken: Row = ["16.11.2026", "Покупка Тест", "-50.00", "", "101.00"];
    for (const newestFirst of [false, true]) {
      const p = parse([PREVIOUS, C, A, broken], newestFirst);
      expect(chain(p).status).toBe("mismatch");
      expect(chain(p).breaks).toBeGreaterThan(0);
    }
  });

  it("IMP-05@PoC FR 1: equal rows of one moment are ordered the same way on every reading", () => {
    const rows = [PREVIOUS, C, A, B, A, B, C];
    const twice: Row[] = [PREVIOUS, C, A, B, ["16.11.2026", "Повернення Тест", "50.00", "", "120.00"]];
    for (const r of [rows, twice]) {
      const first = parse(r).checks;
      expect(parse(r).checks).toEqual(first);
    }
    // C, A, B, A, B, C: 100 → 70 → 120 → 70 → 120 → 70 → 40 is a path through all six.
    const six: Row[] = [
      PREVIOUS,
      C,
      ["16.11.2026", "Повернення Тест", "50.00", "", "120.00"],
      ["16.11.2026", "Покупка Тест", "-50.00", "", "70.00"],
      ["16.11.2026", "Повернення Тест", "50.00", "", "120.00"],
      ["16.11.2026", "Покупка Тест", "-50.00", "", "70.00"],
      ["16.11.2026", "Кава Тест", "-30.00", "", "40.00"],
    ];
    const shuffled = [six[0]!, six[6]!, six[2]!, six[5]!, six[1]!, six[4]!, six[3]!];
    const p = parse(shuffled);
    expect(chain(p).status).toBe("verified");
    expect(p.checks.bounds.closing).toBe("40.00");
    expect(parse(shuffled).checks).toEqual(p.checks);
  });
});

describe("IMP-02@PoC FR 5: a purchase, its refund and another operation of one moment keep the fee's basis", () => {
  // Opening 1 000: purchase −200 (fee 1,00 in it) → 800, its refund +200 → 1 000, coffee −50 → 950.
  const OPEN: Row = ["15.11.2026", "Надходження Тест", "1000.00", "", "1000.00"];
  const PURCHASE: Row = ["16.11.2026", "Покупка Тест", "-200.00", "1.00", "800.00"];
  const REFUND: Row = ["16.11.2026", "Повернення Тест", "200.00", "", "1000.00"];
  const COFFEE: Row = ["16.11.2026", "Кава Тест", "-50.00", "", "950.00"];

  it("IMP-02@PoC FR 5: printed coffee, purchase, refund — the chain verifies and the fee row is read as included, not flagged", () => {
    for (const newestFirst of [false, true]) {
      const p = parse([OPEN, COFFEE, PURCHASE, REFUND], newestFirst);
      expect(chain(p).status).toBe("verified");
      expect(status(p, "balance-equation")).toBe("verified");
      const purchase = p.events.events.find((e) => e.description === "Покупка Тест")!;
      expect(purchase.fee).toEqual({ amount: "1.00", currency: "UAH" });
      expect(purchase.flags).not.toContain("fee-basis-unknown");
      expect(purchase.feeIncluded).toBe(true);
    }
  });

  it("IMP-02@PoC FR 5: the same moment with a real break — the chain is «розбіжність» and the basis is not guessed", () => {
    const refund: Row = ["16.11.2026", "Повернення Тест", "200.00", "", "1001.00"];
    for (const newestFirst of [false, true]) {
      const p = parse([OPEN, COFFEE, PURCHASE, refund], newestFirst);
      expect(chain(p).status).toBe("mismatch");
      // Neither reading of the fee verifies and the fee row sits on no unbroken link: flagged, never guessed.
      const purchase = p.events.events.find((e) => e.description === "Покупка Тест")!;
      expect(purchase.fee).toEqual({ amount: "1.00", currency: "UAH" });
      expect(purchase.flags).toContain("fee-basis-unknown");
      expect(purchase.feeIncluded).toBeUndefined();
    }
  });
});
