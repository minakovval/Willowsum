import { describe, expect, it } from "vitest";
import { ACCOUNT_KINDS, accountName, fieldsForKind, groupOf, kindChange } from "./index.ts";

/** FIN-12@PoC FR 4–6 on the pure rules of «Основне»: the name, and the kind only within its group. */

describe("FIN-12@PoC FR 5: the kind changes only within its group", () => {
  it("FIN-12@PoC FR 5: every pair of kinds — the same group changes, another group is refused", () => {
    for (const from of ACCOUNT_KINDS)
      for (const to of ACCOUNT_KINDS) {
        const change = kindChange(from, to, 1).kind;
        if (from === to) expect(change).toBe("same");
        else if (groupOf(from) !== groupOf(to)) expect([from, to, change]).toEqual([from, to, "other-group"]);
        else expect([from, to, change]).toEqual([from, to, groupOf(to) === "credit" ? "credit" : "cash"]);
      }
  });

  it("FIN-12@PoC AC2: «Поточний» → «Кредитна картка» is refused as another group", () => {
    expect(kindChange("current", "credit-card", 1)).toEqual({ kind: "other-group" });
    expect(kindChange("loan", "savings", 1)).toEqual({ kind: "other-group" });
  });

  it("FIN-12@PoC FR 5: a multi-currency current account keeps its kind; one with a single currency changes", () => {
    expect(kindChange("current", "savings", 2)).toEqual({ kind: "multi-currency" });
    expect(kindChange("current", "savings", 1)).toEqual({ kind: "cash" });
    expect(kindChange("credit-card", "loan", 1)).toEqual({ kind: "credit", to: "loan" });
  });

  it("FIN-12@PoC FR 6: the kind's own fields — kept where the new kind has them, dropped elsewhere", () => {
    const deposit = { annualRate: "3.5", depositOpenedOn: "2025-01-01", depositMaturesOn: "2027-01-01" };
    expect(fieldsForKind("savings", deposit)).toEqual({
      annualRate: "3.5",
      depositOpenedOn: null,
      depositMaturesOn: null,
    });
    expect(fieldsForKind("current", deposit)).toEqual({
      annualRate: null,
      depositOpenedOn: null,
      depositMaturesOn: null,
    });
    expect(fieldsForKind("deposit", deposit)).toEqual(deposit);
  });
});

describe("FIN-12@PoC AC1: the new «Назва» as in «Новий рахунок»", () => {
  it("FIN-12@PoC AC1: the new name is trimmed, one line of 1–80 characters", () => {
    expect(accountName("  Сімейний поточний ")).toBe("Сімейний поточний");
    expect(accountName("")).toBeNull();
    expect(accountName("a\nb")).toBeNull();
    expect(accountName("я".repeat(80))).toBe("я".repeat(80));
    expect(accountName("я".repeat(81))).toBeNull();
  });
});
