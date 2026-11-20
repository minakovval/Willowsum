import { describe, expect, it } from "vitest";
import { historyGap, reviewSigns, type StatementOptions } from "../domain/index.ts";
import { parseStatement, type OpenedAccountBinding } from "./parse-statement.ts";
import type { ReadOptions } from "./read-file.ts";

/**
 * Security review of PR #632 (IMP-05@PoC part 1), round 1: tests for the guards the PR's own tests did not hold
 * (mutation survivors) and for two defects. Synthetic statements only.
 */
const enc = (s: string) => new TextEncoder().encode(s);
const parse = (
  lines: readonly string[],
  options: ReadOptions = {},
  statement: StatementOptions = {},
  binding?: OpenedAccountBinding,
) => parseStatement(enc(lines.join("\n")), { delimiter: ";", ...options }, statement, binding);
const check = (p: ReturnType<typeof parseStatement>, kind: string) =>
  p.checks.controls.find((c) => c.kind === kind)!;
const codes = (p: ReturnType<typeof parseStatement>) => p.checks.flags.map((f) => f.code);

describe("IMP-05@PoC FR 1 (security, #632): a sum check is never «перевірено» without an exact sum", () => {
  it("IMP-05@PoC FR 1: rows in two currencies have no one sum — the balance equation is «не перевірялося»", () => {
    const p = parse([
      "Opening balance:;100.00",
      "Date;Amount;Currency;Description",
      "2026-03-01;10.00;EUR;A",
      "2026-03-02;20.00;USD;B",
      "Closing balance:;130.00",
    ]);
    expect(p.events.currencies).toEqual(["EUR", "USD"]);
    expect(check(p, "balance-equation").status).toBe("not-checked");
    expect(codes(p)).toContain("balance-not-checked");
  });

  it("IMP-05@PoC FR 1: a row whose amount cannot be read leaves the sum checks «не перевірялося», never «перевірено»", () => {
    const p = parse([
      "Opening balance:;100.00",
      "Date;Amount;Description",
      "2026-03-01;10.00;A",
      "2026-03-02;;B",
      "2026-03-03;-2.50;C",
      "2026-03-04;2.50;D",
      "Total credits:;12.50",
      "Total debits:;2.50",
      "Closing balance:;110.00",
    ]);
    expect(p.checks.figures).toMatchObject({ opening: "100.00", closing: "110.00", creditTotal: "12.50" });
    expect(p.events.events.some((e) => e.legs.length === 0)).toBe(true);
    for (const kind of ["balance-equation", "debit-total", "credit-total"])
      expect(check(p, kind).status).toBe("not-checked");
    expect(p.checks.signs.rows.every((r) => r.basis !== "totals")).toBe(true);
  });

  it("IMP-05@PoC FR 1: a difference smaller than the currency's minor unit is shown in full, never rounded away", () => {
    const p = parse([
      "Opening balance:;1.00 EUR",
      "Date;Amount;Description",
      "2026-03-01;0.0005;A",
      "Closing balance:;1.00 EUR",
    ]);
    expect(check(p, "balance-equation")).toMatchObject({
      status: "mismatch",
      computed: "1.0005",
      difference: "-0.0005",
    });
    expect(p.checks.flags).toContainEqual({
      code: "checksum-mismatch",
      severity: "review",
      check: "balance-equation",
      difference: "-0.0005",
    });
  });

  it("IMP-05@PoC FR 1: a row dated after the declared period is a period mismatch", () => {
    const p = parse([
      "Period:;2026-03-01 - 2026-03-31",
      "Date;Amount;Description",
      "2026-03-02;1.00;A",
      "2026-04-02;1.00;B",
    ]);
    expect(check(p, "period").status).toBe("mismatch");
    expect(codes(p)).toContain("checksum-mismatch");
  });

  it("IMP-05@PoC FR 1: a debit total printed with a minus is compared without its sign", () => {
    const p = parse([
      "Total debits:;-25.50",
      "Total credits:;50.00",
      "Date;Amount;Description",
      "2026-03-01;50.00;A",
      "2026-03-02;-25.50;B",
    ]);
    expect(check(p, "debit-total")).toMatchObject({ status: "verified", declared: "25.50" });
  });

  it("IMP-05@PoC FR 1: a row with a date is an operation even when its first cell starts with a figure's label", () => {
    const p = parse([
      "Opening balance:;100,00",
      "Опис;Дата;Сума",
      "Зарплата;01.03.2026;500,00",
      "Closing balance payment;05.03.2026;-60,00",
    ]);
    expect(p.events.events.map((e) => e.legs[0]?.amount)).toEqual(["500.00", "-60.00"]);
    expect(p.checks.figures.closing).toBeNull();
  });

  it("IMP-05@PoC FR 1: the chain needs every row's balance — one missing leaves it «не перевірялося»", () => {
    const p = parse([
      "Дата;Сума;Залишок;Опис",
      "01.03.2026;-10,00;90,00;А",
      "02.03.2026;-10,00;;Б",
      "03.03.2026;-10,00;70,00;В",
    ]);
    expect(check(p, "balance-chain").status).toBe("not-checked");
    expect(p.checks.signs.rows.every((r) => r.basis !== "balance-chain")).toBe(true);
  });
});

describe("IMP-05@PoC FR 5 (security, #632): what confirms a sign", () => {
  it("IMP-05@PoC FR 5: one total that agrees while the other does not confirms no sign", () => {
    const p = parse([
      "Total debits:;25.50",
      "Total credits:;999.00",
      "Date;Amount;Description",
      "2026-03-01;50.00;A",
      "2026-03-02;-25.50;B",
    ]);
    expect(check(p, "debit-total").status).toBe("verified");
    expect(check(p, "credit-total").status).toBe("mismatch");
    expect(p.checks.signs.rows.every((r) => r.basis !== "totals")).toBe(true);
    expect(codes(p)).toContain("checksum-mismatch");
  });

  it("IMP-05@PoC FR 5: under a direction column, a row with no known direction word is «знак не підтверджено»", () => {
    const p = parse([
      "Дата;Сума;Тип;Опис",
      "01.03.2026;10,00;дт;a",
      "02.03.2026;20,00;кт;b",
      "03.03.2026;30,00;;c",
    ]);
    expect(p.events.events.map((e) => e.flags.includes("sign-unclear"))).toEqual([false, false, true]);
    expect(p.checks.signs.rows.map((r) => [r.row, r.basis, r.confirmed])).toEqual([
      [2, "direction-word", true],
      [3, "direction-word", true],
      [4, "majority", false],
    ]);
    expect(p.checks.signs.unconfirmed).toEqual([4]);
  });

  it("IMP-05@PoC FR 5: a sign held only by the bank's profile is «знак не підтверджено» with confidence ≤ 0,6", () => {
    const p = parse(["Date;Amount;Description", "2026-03-01;50.00;A", "2026-03-02;25.50;B"]);
    const signs = reviewSigns(p.events, p.analysis, {
      chainRows: new Set(),
      totalsVerified: false,
      profile: true,
      card: false,
      creditCard: false,
    });
    expect(signs.rows.map((r) => r.basis)).toEqual(["profile", "profile"]);
    expect(signs.rows.every((r) => !r.confirmed && r.confidence <= 0.6)).toBe(true);
    expect(signs.unconfirmed).toEqual([2, 3]);
  });
});

describe("IMP-05@PoC FR 3 (security, #632): the history gap", () => {
  it("IMP-05@PoC FR 3: balances in different currencies are never subtracted", () => {
    const gap = historyGap(
      { end: "2026-03-31", closing: "2000.00", currency: "EUR" },
      { start: "2026-04-15", opening: "2300.00", currency: "USD" },
    );
    expect(gap.difference).toBeNull();
  });
});

describe("IMP-05@PoC, defects found by the security review of #632", () => {
  // Blocking 1. Decimal (precision 60) rounds a sum or a difference past 60 significant digits: a figure of 63 digits
  // swallows the rows' 400.00 and a file that does not add up is «перевірено».
  const huge = `1${"0".repeat(62)}`;
  it("IMP-05@PoC FR 1: figures of any printed size are compared exactly — rows that do not add up are a mismatch", () => {
    const p = parse([
      `Opening balance:;${huge}`,
      "Date;Amount;Description",
      "2026-03-01;400.00;A",
      `Closing balance:;${huge}`,
    ]);
    expect(check(p, "balance-equation").status).toBe("mismatch");
    expect(codes(p)).toContain("checksum-mismatch");
    expect(p.checks.signs.rows.every((r) => r.basis !== "totals")).toBe(true);
  });
  it("IMP-05@PoC FR 1: a balance chain that does not hold is never «перевірено» by rounding", () => {
    const balance = `1${"0".repeat(59)}`;
    const p = parse([
      "Date;Amount;Balance;Description",
      `2026-03-01;0.40;${balance};A`,
      `2026-03-02;0.40;${balance};B`,
      `2026-03-03;0.40;${balance};C`,
    ]);
    expect(check(p, "balance-chain").status).toBe("mismatch");
    expect(p.checks.signs.rows.every((r) => r.basis !== "balance-chain")).toBe(true);
  });
  it("IMP-05@PoC FR 3: the history difference of balances of any printed size is exact", () => {
    const gap = historyGap(
      { end: "2026-03-31", closing: huge, currency: "EUR" },
      { start: "2026-04-01", opening: `1${"0".repeat(59)}400`, currency: "EUR" },
    );
    expect(gap).toMatchObject({ status: "gap", difference: "400.00" });
  });

  // Blocking 2. The currency printed with the statement's own figures is not compared with the account: the rows
  // carry no currency, take the account's, and a EUR statement goes into a USD account with no «чужий рахунок».
  it("IMP-05@PoC EC3: the currency printed with the statement's balances, other than the account's, is «чужий рахунок»", () => {
    const p = parse(
      [
        "Вхідний залишок:;1 000,00 EUR",
        "Дата;Сума;Опис",
        "01.03.2026;500,00;Зарплата",
        "05.03.2026;-60,00;Кава",
        "Кінцевий залишок:;1 440,00 EUR",
      ],
      {},
      { account: { currencies: ["USD"], multiCurrency: false } },
    );
    expect(p.checks.account).toEqual({
      status: "mismatch",
      reasons: [{ kind: "currency", file: "EUR", account: "USD" }],
    });
    expect(p.checks.flags).toContainEqual({ code: "foreign-account", severity: "block" });
  });

  // Non-blocking. Rows that sum to zero: the equation holds under either sign, so it confirms none.
  it("IMP-05@PoC FR 6: a balance equation over rows that sum to zero confirms no sign — «знак картки» stays", () => {
    const p = parse([
      "Картка 5168 **** **** 4321",
      "Opening balance:;0,00",
      "Дата;Сума;Опис",
      "01.03.2026;50,00;Покупка",
      "02.03.2026;50,00;Покупка",
      "03.03.2026;-100,00;Погашення",
      "Closing balance:;0,00",
    ]);
    expect(p.checks.signs.rows.every((r) => r.basis !== "totals")).toBe(true);
  });
});
