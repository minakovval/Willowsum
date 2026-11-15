import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  buildSplit,
  monthAfter,
  monthShares,
  splitAuditFields,
  splitCategoryIds,
  type Split,
} from "./splits.ts";

/** FIN-03@PoC b) (wave 2 row 16a): the rules of «Розділити» (BUD-01@PoC FR 6, BUD-13@PoC FR 6–8), without I/O. */
const eur = (amount: string) => Money.of(amount, "EUR");
const amounts = (shares: readonly Money[] | null) => shares?.map((s) => s.toDecimalString());
const FOOD = "11111111-1111-4111-8111-111111111111";
const HOME = "22222222-2222-4222-8222-222222222222";
const PHARMACY = "33333333-3333-4333-8333-333333333333";

describe("BUD-13@PoC FR 6: «На кілька місяців» — equal shares, the rounding remainder in the last", () => {
  it("BUD-13@PoC AC5: −100,00 € on 3 months is −33,33 €, −33,33 € and −33,34 €", () => {
    expect(amounts(monthShares(eur("-100.00"), 3))).toEqual(["-33.33", "-33.33", "-33.34"]);
  });

  it("BUD-13@PoC EC2: 100,00 € / 3 — the 0,01 € remainder goes to the last share", () => {
    expect(amounts(monthShares(eur("100.00"), 3))).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("BUD-13@PoC AC8: −1 200,00 € on 36 months — shares 1–35 of 33,33 €, share 36 of 33,45 €", () => {
    const shares = monthShares(eur("-1200.00"), 36)!;
    expect(shares).toHaveLength(36);
    expect(new Set(amounts(shares.slice(0, 35)))).toEqual(new Set(["-33.33"]));
    expect(shares[35]!.toDecimalString()).toBe("-33.45");
    expect(shares.reduce((a, b) => a.plus(b)).equals(eur("-1200.00"))).toBe(true);
  });

  it("BUD-13@PoC FR 6: «Починаючи з» a month, «Місяців» 2–60, one category; the months run over the year's end", () => {
    const built = buildSplit(eur("-1200.00"), {
      mode: "months",
      startMonth: "2026-11",
      months: 6,
      categoryId: HOME,
    });
    expect("split" in built && built.split?.parts.map((p) => [p.month, p.amount.toDecimalString()])).toEqual([
      ["2026-11-01", "-200"],
      ["2026-12-01", "-200"],
      ["2027-01-01", "-200"],
      ["2027-02-01", "-200"],
      ["2027-03-01", "-200"],
      ["2027-04-01", "-200"],
    ]);
    expect(monthAfter("2026-03", 59)).toBe("2031-02-01");
    for (const months of [1, 61, 2.5])
      expect(
        buildSplit(eur("-10.00"), { mode: "months", startMonth: "2026-03", months, categoryId: HOME }),
      ).toEqual({
        problems: [{ field: "months", issue: "count" }],
      });
    expect(
      buildSplit(eur("-10.00"), { mode: "months", startMonth: "2026-13", months: 2, categoryId: HOME }),
    ).toEqual({
      problems: [{ field: "startMonth", issue: "invalid" }],
    });
    // A share below one cent would be 0: refused, not stored.
    expect(
      buildSplit(eur("-0.02"), { mode: "months", startMonth: "2026-03", months: 3, categoryId: HOME }),
    ).toEqual({
      problems: [{ field: "months", issue: "count" }],
    });
    // JPY has no minor units: 1 000 ¥ / 3 = 333 + 333 + 334.
    expect(amounts(monthShares(Money.of("-1000", "JPY"), 3))).toEqual(["-333", "-333", "-334"]);
  });
});

describe("BUD-01@PoC FR 6: «За категоріями» — 2–20 parts with the transaction's sign and precision, summing exactly", () => {
  const categories = (amount: string, parts: [string, string][]) =>
    buildSplit(eur(amount), {
      mode: "categories",
      parts: parts.map(([categoryId, a]) => ({ categoryId, amount: a })),
    });

  it("BUD-01@PoC AC3: 186 € in two parts that sum to it is saved; with a remainder left it is not", () => {
    const built = categories("-186.00", [
      [FOOD, "-120.00"],
      [HOME, "-66.00"],
    ]);
    expect(
      "split" in built && built.split?.parts.map((p) => [p.categoryId, p.amount.toDecimalString()]),
    ).toEqual([
      [FOOD, "-120"],
      [HOME, "-66"],
    ]);
    expect(
      categories("-186.00", [
        [FOOD, "-120.00"],
        [HOME, "-60.00"],
      ]),
    ).toEqual({ problems: [{ field: "parts", issue: "sum_mismatch" }] });
  });

  it("BUD-13@PoC AC3: −132,40 € as «Продукти» 85,00 € and «Дім» 35,00 € leaves 12,40 € — refused; with «Аптека» 12,40 € saved", () => {
    expect(
      categories("-132.40", [
        [FOOD, "-85.00"],
        [HOME, "-35.00"],
      ]),
    ).toEqual({ problems: [{ field: "parts", issue: "sum_mismatch" }] });
    const built = categories("-132.40", [
      [FOOD, "-85.00"],
      [HOME, "-35.00"],
      [PHARMACY, "-12.40"],
    ]);
    expect("split" in built && built.split?.mode).toBe("categories");
  });

  it("BUD-01@PoC FR 6: a part has the transaction's sign, at most the currency's minor units and is not 0; 2–20 parts; none cancels", () => {
    expect(
      categories("-10.00", [
        [FOOD, "-12.00"],
        [HOME, "2.00"],
      ]),
    ).toEqual({ problems: [{ field: "parts.1.amount", issue: "sign" }] });
    expect(
      categories("-10.00", [
        [FOOD, "-9.995"],
        [HOME, "-0.005"],
      ]),
    ).toEqual({
      problems: [
        { field: "parts.0.amount", issue: "invalid" },
        { field: "parts.1.amount", issue: "invalid" },
      ],
    });
    expect(
      categories("-10.00", [
        [FOOD, "-10.00"],
        [HOME, "0"],
      ]),
    ).toEqual({ problems: [{ field: "parts.1.amount", issue: "zero" }] });
    expect(categories("-10.00", [[FOOD, "-10.00"]])).toEqual({
      problems: [{ field: "parts", issue: "count" }],
    });
    const many = Array.from({ length: 21 }, () => [FOOD, "-1.00"] as [string, string]);
    expect(categories("-21.00", many)).toEqual({ problems: [{ field: "parts", issue: "count" }] });
    expect(categories("-20.00", many.slice(1))).toHaveProperty("split.parts.length", 20);
    // Exact Decimal sums: 0,10 + 0,20 is 0,30 (never a float).
    expect(
      categories("0.30", [
        [FOOD, "0.10"],
        [HOME, "0.20"],
      ]),
    ).toHaveProperty("split.mode", "categories");
    expect(categories("-10.00", [])).toEqual({ split: null });
  });

  it("BUD-01@PoC FR 6: each category is checked once; the audit entry names every part without free text", () => {
    expect(
      splitCategoryIds({
        mode: "categories",
        parts: [
          { categoryId: FOOD, amount: "-1" },
          { categoryId: FOOD, amount: "-2" },
          { categoryId: HOME, amount: "-3" },
        ],
      }),
    ).toEqual([FOOD, HOME]);
    const split: Split = {
      mode: "months",
      needsReview: true,
      parts: [
        { categoryId: HOME, month: "2026-03-01", amount: eur("-50") },
        { categoryId: HOME, month: "2026-04-01", amount: eur("-50") },
      ],
    };
    expect([...splitAuditFields(split)]).toEqual([
      ["split.mode", "months"],
      ["split.needsReview", "true"],
      ["split.part.1", `2026-03 ${HOME} -50`],
      ["split.part.2", `2026-04 ${HOME} -50`],
    ]);
    expect(splitAuditFields(null).size).toBe(0);
  });
});
