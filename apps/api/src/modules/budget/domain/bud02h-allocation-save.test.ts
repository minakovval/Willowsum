import { describe, expect, it } from "vitest";
import { Money } from "@willowsum/domain-kernel";
import {
  allocationBalance,
  checkAllocation,
  defaultContribution,
  parseBudgetAmount,
  type AllocationLines,
  type AllocationRowInput,
} from "./index.ts";

/** BUD-02@PoC FR 15 (row 31, saving «Розподіл»): the typed rows checked against the balance, and the cells they make. */
const eur = (amount: string) => Money.of(amount, "EUR");
const money = (amount: string) => ({ amount, currency: "EUR" });
const parse = (field: string, m: { amount: string; currency: string }) => parseBudgetAmount(field, m, "EUR");
const balance = (income: string, limits: string) =>
  allocationBalance({
    incomePlan: eur(income),
    limits: [{ categoryId: "c", amount: eur(limits) }],
    obligations: { recurring: [], debtMinimums: [] },
  });
const lines: AllocationLines = {
  goals: [
    { goalId: "g1", required: eur("300"), lastPeriod: "2027-03" },
    { goalId: "g2", required: null, lastPeriod: null },
    { goalId: "g3", required: eur("50"), lastPeriod: "2026-11" },
  ],
  debtAccountIds: new Set(["d1"]),
};
const check = (b: ReturnType<typeof balance>, rows: AllocationRowInput[]) =>
  checkAllocation(b, "2026-12", rows, lines, parse);

describe("BUD-02@PoC FR 15: the rows of «Розподіл» saved with the budget", () => {
  it("BUD-02@PoC FR 15: a surplus's goal, debt and savings rows become the first period's cells; the rest may stay unallocated", () => {
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

  it("BUD-02@PoC AC7: «З цілі …» lowers the month's contribution; the deficit must be covered exactly", () => {
    const deficit = balance("3000", "3200");
    const ok = check(deficit, [{ kind: "from-goal", goalId: "g1", amount: money("200") }]);
    expect(ok.kind === "ok" && ok.value.cells[0]!.amount.equals(eur("100"))).toBe(true);
    expect(check(deficit, [{ kind: "from-goal", goalId: "g1", amount: money("199.99") }])).toEqual({
      kind: "invalid",
      issues: [{ field: "allocation", issue: "short" }],
    });
    expect(check(deficit, [])).toEqual({
      kind: "invalid",
      issues: [{ field: "allocation", issue: "short" }],
    });
    // A goal without a contribution this month (no date, or past it) has nothing to lower.
    for (const goalId of ["g2", "g3"])
      expect(check(deficit, [{ kind: "from-goal", goalId, amount: money("1") }])).toEqual({
        kind: "invalid",
        issues: [{ field: "allocation.0.goalId", issue: "no_contribution" }],
      });
  });

  it("BUD-02@PoC FR 15: nothing to allocate takes no row; a row of the other kind, an unknown goal or debt is refused", () => {
    expect(check(balance("400", "400"), [{ kind: "savings", amount: money("0") }])).toEqual({
      kind: "invalid",
      issues: [{ field: "allocation.0.kind", issue: "invalid" }],
    });
    expect(check(balance("400", "400"), []).kind).toBe("ok");
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
});
