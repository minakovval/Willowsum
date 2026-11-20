import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { gridMonths } from "../domain/index.ts";
import type { BudgetDeps, StoredBudget } from "./budget.ts";
import { readPlanGrid } from "./plan-grid.ts";

/**
 * #623 (item 5 of the follow-ups of #626, from its security review): `readPlanGrid` reads the 12 months at once. Every read stays in the
 * caller's space and the budget's currency; a read that fails fails the grid — never a grid with a month left out.
 */
const eur = (a: string) => Money.of(a, "EUR");
const TODAY = "2026-11-18";
const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const budget: StoredBudget = {
  id: "22222222-2222-4222-8222-222222222222",
  currency: "EUR",
  firstPeriod: "2026-11",
  incomePlan: eur("5600"),
  createdOn: "2026-11-01",
  version: 1,
  firstDay: null,
};

interface Seen {
  readonly port: string;
  readonly householdId: string;
  readonly period: string | null;
  readonly currency: string;
}

function deps(over: { failIn?: { port: string; period: string }; delayMs?: number } = {}) {
  const seen: Seen[] = [];
  const flight = { now: 0, most: 0 };
  const read = async <T>(
    port: string,
    householdId: string,
    period: string | null,
    currency: string,
    value: T,
  ) => {
    seen.push({ port, householdId, period, currency });
    flight.now += 1;
    flight.most = Math.max(flight.most, flight.now);
    try {
      await new Promise((resolve) => setTimeout(resolve, over.delayMs ?? 1));
      if (over.failIn && over.failIn.port === port && over.failIn.period === period)
        throw new Error("synthetic read failure");
      return value;
    } finally {
      flight.now -= 1;
    }
  };
  const d: BudgetDeps = {
    newId: () => "33333333-3333-4333-8333-333333333333",
    today: () => TODAY,
    reportingCurrency: "EUR",
    reads: {} as BudgetDeps["reads"],
    planEnabled: async () => true,
    obligations: {
      month: (householdId, period, currency) =>
        read("obligations", householdId, period, currency, {
          recurring: [],
          debtMinimums: [{ accountId: "loan", amount: eur("300"), paid: false }],
          approximate: false,
        }),
    },
    planSources: {
      goals: (householdId, currency) => read("goals", householdId, null, currency, []),
      incomes: (householdId, period, currency) =>
        read("incomes", householdId, period, currency, [{ paymentId: "salary", amount: eur("3100") }]),
      extraPayments: (householdId, period, currency) =>
        // Each month its own amount (its number), so a month's figures in another month's place are seen.
        read("extra", householdId, period, currency, [
          { accountId: "loan", amount: eur(String(Number(period.slice(5)))) },
        ]),
    },
  };
  return { d, seen, flight };
}
const stored = { limits: [], cells: [] };

describe("#623: the grid's months read at once", () => {
  it("BUD-17@PoC AC5, FR 1: every read of the 12 months carries the caller's space, the budget's currency and its own month — once each", async () => {
    const { d, seen } = deps();
    const g = await readPlanGrid(d, HOUSEHOLD, budget, [], stored);
    const months = gridMonths(TODAY);
    expect(new Set(seen.map((s) => s.householdId))).toEqual(new Set([HOUSEHOLD]));
    expect(new Set(seen.map((s) => s.currency))).toEqual(new Set(["EUR"]));
    for (const port of ["incomes", "obligations", "extra"])
      expect(
        seen
          .filter((s) => s.port === port)
          .map((s) => s.period)
          .sort(),
        port,
      ).toEqual([...months].sort());
    expect(seen.filter((s) => s.port === "goals")).toHaveLength(1);
    // Each month has its own figures in its own place: the minimum 300 + the month's own extra payment.
    expect(g.income.totals).toEqual(months.map(() => eur("5600")));
    expect(g.income.other).toEqual(months.map(() => eur("2500")));
    expect(g.debts.totals).toEqual(months.map((p) => eur("300").plus(eur(String(Number(p.slice(5)))))));
  });

  it("BUD-17@PoC FR 1: a month whose read fails fails the whole grid — no grid with that month left out or empty", async () => {
    for (const port of ["incomes", "obligations", "extra"])
      for (const period of ["2026-11", "2027-03", "2027-10"]) {
        const { d } = deps({ failIn: { port, period } });
        await expect(readPlanGrid(d, HOUSEHOLD, budget, [], stored), `${port} ${period}`).rejects.toThrow(
          "synthetic read failure",
        );
      }
  });

  it("BUD-17@PoC FR 1: a month before the budget's first period is not read from the other modules", async () => {
    const { d, seen } = deps();
    const g = await readPlanGrid(d, HOUSEHOLD, { ...budget, firstPeriod: "2027-01" }, [], stored);
    expect(seen.some((s) => s.period === "2026-11" || s.period === "2026-12")).toBe(false);
    expect(g.income.totals.slice(0, 3)).toEqual([null, null, eur("5600")]);
  });
});
