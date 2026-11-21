import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import {
  allocationBalance,
  checkAllocation,
  defaultContribution,
  parseBudgetAmount,
  plannedContributions,
  type AllocationLines,
  type AllocationRowInput,
} from "./index.ts";

/** BUD-02@PoC FR 15 (row 31, saving «Розподіл»): the typed rows checked against the balance, and the cells they make. */
const eur = (amount: string) => Money.of(amount, "EUR");
const money = (amount: string) => ({ amount, currency: "EUR" });
const parse = (field: string, m: { amount: string; currency: string }) => parseBudgetAmount(field, m, "EUR");
const lines: AllocationLines = {
  goals: [
    { goalId: "g1", required: eur("300"), lastPeriod: "2027-03" },
    { goalId: "g2", required: null, lastPeriod: null },
    { goalId: "g3", required: eur("50"), lastPeriod: "2026-11" },
  ],
  debtAccountIds: new Set(["d1"]),
};
/** Q5 а: the difference holds the goals' planned contributions of December — g1's 300 (g3 ends in November). */
const balance = (income: string, limits: string, goals: AllocationLines["goals"] = lines.goals) =>
  allocationBalance({
    incomePlan: eur(income),
    limits: [{ categoryId: "c", amount: eur(limits) }],
    obligations: { recurring: [], debtMinimums: [] },
    goalContributions: plannedContributions(goals, "2026-12", "EUR")!,
  });
const check = (b: ReturnType<typeof balance>, rows: AllocationRowInput[]) =>
  checkAllocation(b, "2026-12", rows, lines, parse);

describe("BUD-02@PoC FR 15: the rows of «Розподіл» saved with the budget", () => {
  it("BUD-02@PoC FR 15: a surplus's goal, debt and savings rows become the first period's cells; the rest may stay unallocated", () => {
    // 1 000 − 400 − g1's 300 = 300; the goal row 100 counts as −200 against its 300, so the rest is 439.75.
    const r = check(balance("1000", "400"), [
      { kind: "goal", goalId: "g1", amount: money("100") },
      { kind: "debt", accountId: "d1", amount: money("50.25") },
      { kind: "savings", amount: money("10") },
    ]);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.value.cells.map((c) => [c.kind, c.lineId, c.amount.toDecimalString()])).toEqual([
      ["goal", "g1", "100"],
      ["debt", "d1", "50.25"],
      ["savings", null, "10"],
    ]);
    expect(r.value.choice.status).toBe("short");
    expect(r.value.choice.rest.equals(eur("439.75"))).toBe(true);
  });

  it("BUD-02@PoC AC7: «З цілі …» lowers the month's contribution; a deficit covered in part or not at all («Лишити дефіцит») is saved with its rest", () => {
    // Q5 а: 3 300 − 3 200 − g1's 300 = a deficit of 200.
    const deficit = balance("3300", "3200");
    const ok = check(deficit, [{ kind: "from-goal", goalId: "g1", amount: money("200") }]);
    expect(ok.kind === "ok" && ok.value.cells[0]!.amount.equals(eur("100"))).toBe(true);
    expect(ok.kind === "ok" && ok.value.choice.status).toBe("exact");
    // FR 15, AC17 (owner decision 2026-11-21): «Створити бюджет» is active always — the uncovered part stays the deficit.
    const part = check(deficit, [{ kind: "from-goal", goalId: "g1", amount: money("199.99") }]);
    expect(part.kind).toBe("ok");
    if (part.kind === "ok") {
      expect(part.value.cells.map((c) => c.amount.toDecimalString())).toEqual(["100.01"]);
      expect(part.value.choice).toMatchObject({ status: "short", rest: eur("0.01") });
    }
    const left = check(deficit, []);
    expect(left.kind === "ok" && left.value.cells).toEqual([]);
    expect(left.kind === "ok" && left.value.choice.rest.equals(eur("200"))).toBe(true);
    // Over N is still refused.
    expect(check(deficit, [{ kind: "from-goal", goalId: "g1", amount: money("200.01") }])).toEqual({
      kind: "invalid",
      issues: [{ field: "allocation", issue: "over" }],
    });
    // A goal without a contribution this month (no date, or past it) has nothing to lower.
    for (const goalId of ["g2", "g3"])
      expect(check(deficit, [{ kind: "from-goal", goalId, amount: money("1") }])).toEqual({
        kind: "invalid",
        issues: [{ field: "allocation.0.goalId", issue: "no_contribution" }],
      });
  });

  it("BUD-02@PoC FR 15: nothing to allocate takes no row; a row of the other kind, an unknown goal or debt is refused", () => {
    // Q5 а: 700 − 400 − g1's 300 = 0.
    expect(check(balance("700", "400"), [{ kind: "savings", amount: money("0") }])).toEqual({
      kind: "invalid",
      issues: [{ field: "allocation.0.kind", issue: "invalid" }],
    });
    expect(check(balance("700", "400"), []).kind).toBe("ok");
    expect(
      check(balance("1000", "400"), [
        { kind: "goal", goalId: "elsewhere", amount: money("1") },
        { kind: "debt", accountId: "elsewhere", amount: money("1") },
        { kind: "savings", amount: money("1") },
        { kind: "savings", amount: money("1") },
      ]),
    ).toEqual({
      kind: "invalid",
      issues: [
        { field: "allocation.0.goalId", issue: "not_found" },
        { field: "allocation.1.accountId", issue: "not_found" },
        { field: "allocation.3.kind", issue: "duplicate" },
      ],
    });
  });

  it("BUD-02@PoC FR 15: a goal's default contribution is the required one up to the month of its date", () => {
    expect(defaultContribution(lines.goals[0]!, "2027-03")?.equals(eur("300"))).toBe(true);
    expect(defaultContribution(lines.goals[0]!, "2027-04")).toBeNull();
    expect(defaultContribution(lines.goals[1]!, "2026-12")).toBeNull();
  });

  it("BUD-02@PoC FR 15 (Q5 а): the difference subtracts the goals' planned contributions as «План» does; a dated goal without a rate — no figure", () => {
    const b = balance("1000", "400");
    expect(b.goalContributions.equals(eur("300"))).toBe(true);
    expect(b.difference.equals(eur("300"))).toBe(true);
    expect(plannedContributions(lines.goals, "2026-11", "EUR")?.equals(eur("350"))).toBe(true);
    expect(plannedContributions(lines.goals, "2027-04", "EUR")?.isZero()).toBe(true);
    expect(
      plannedContributions([{ goalId: "x", required: null, lastPeriod: "2027-03" }], "2026-12", "EUR"),
    ).toBeNull();
  });

  it("BUD-02@PoC FR 15 (Q4 а): a goal the wizard shows left without a row is saved as 0 € for the month and frees its contribution", () => {
    const goals: AllocationLines["goals"] = [
      ...lines.goals,
      // In another currency: the wizard does not show it, so it keeps its planned contribution.
      { goalId: "usd", required: eur("20"), lastPeriod: "2027-03", currency: "USD" },
    ];
    const b = balance("1000", "400", goals);
    expect(b.amount.equals(eur("280"))).toBe(true);
    const r = checkAllocation(
      b,
      "2026-12",
      [{ kind: "savings", amount: money("580") }],
      { ...lines, goals },
      parse,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // g2 has no contribution (no date), g3 ends in November: nothing to clear; g1 is saved as 0 €.
    expect(r.value.cells.map((c) => [c.kind, c.lineId, c.amount.toDecimalString()])).toEqual([
      ["savings", null, "580"],
      ["goal", "g1", "0"],
    ]);
    expect(r.value.choice.status).toBe("exact");
    expect(r.value.choice.rest.isZero()).toBe(true);
    // A deficit leaves the goals as they are: only «З цілі …» lowers one.
    const d = checkAllocation(
      balance("3300", "3200", goals),
      "2026-12",
      [{ kind: "from-goal", goalId: "g1", amount: money("220") }],
      { ...lines, goals },
      parse,
    );
    expect(d.kind === "ok" && d.value.cells.map((c) => [c.lineId, c.amount.toDecimalString()])).toEqual([
      ["g1", "80"],
    ]);
  });

  it("BUD-02@PoC FR 15 (Q4 а): on a deficit a goal without a row keeps its planned contribution — only «З цілі …» lowers one", () => {
    const goals: AllocationLines["goals"] = [
      { goalId: "g1", required: eur("300"), lastPeriod: "2027-03" },
      { goalId: "g4", required: eur("200"), lastPeriod: "2027-03" },
    ];
    // 3 500 − 3 200 − (300 + 200) = a deficit of 200.
    const b = balance("3500", "3200", goals);
    expect(b.kind).toBe("deficit");
    const r = checkAllocation(
      b,
      "2026-12",
      [{ kind: "from-goal", goalId: "g1", amount: money("200") }],
      { ...lines, goals },
      parse,
    );
    expect(r.kind === "ok" && r.value.cells.map((c) => [c.lineId, c.amount.toDecimalString()])).toEqual([
      ["g1", "100"],
    ]);
    expect(r.kind === "ok" && r.value.choice.status).toBe("exact");
  });

  it("BUD-02@PoC FR 15 (Q3 а): «Із заощаджень» and «У борг» are not saved in PoC — refused as `not_saved`", () => {
    const deficit = balance("3300", "3200");
    for (const kind of ["from-savings", "to-debt"] as const)
      expect(check(deficit, [{ kind, accountId: "d1", amount: money("200") }])).toEqual({
        kind: "invalid",
        issues: [{ field: "allocation.0.kind", issue: "not_saved" }],
      });
  });
});
