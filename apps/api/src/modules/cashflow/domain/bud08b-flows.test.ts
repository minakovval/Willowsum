import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import {
  monthFigures,
  monthFlows,
  periodFlows,
  periodTotals,
  splitLoanMonth,
  transferFlow,
  type CashflowCategory,
  type FlowLine,
  type GoalAccountSpan,
} from "./index.ts";

const eur = (a: string) => Money.of(a, "EUR");
const amounts = (splits: ReturnType<typeof splitLoanMonth>) =>
  splits.map((s) => [s.interest.toDecimalString(), s.principal.toDecimalString()]);

describe("BUD-08@PoC: a loan payment's interest and «Погашення боргу»", () => {
  it("BUD-08@PoC AC7: debt 120 000,00 €, rate 4,2 %, the month's first payment 650,00 € — interest 420,00 €, principal 230,00 €", () => {
    const splits = splitLoanMonth({
      payments: [{ date: "2026-09-05", amount: eur("650.00") }],
      annualRate: "4.2",
      debtBefore: eur("120000.00"),
      bankInterest: false,
    });
    expect(amounts(splits)).toEqual([["420", "230"]]);
  });

  it("BUD-08@PoC FR 7: only the first payment of the month carries interest; the others lower the debt in full", () => {
    const splits = splitLoanMonth({
      payments: [
        { date: "2026-09-05", amount: eur("650.00") },
        { date: "2026-09-20", amount: eur("100.00") },
      ],
      annualRate: "4.2",
      debtBefore: eur("120000.00"),
      bankInterest: false,
    });
    expect(amounts(splits)).toEqual([
      ["420", "230"],
      ["0", "100"],
    ]);
  });

  it("BUD-08@PoC FR 7: a payment less than the interest — the whole interest is spending, the unpaid part adds to the debt", () => {
    const splits = splitLoanMonth({
      payments: [{ date: "2026-09-05", amount: eur("300.00") }],
      annualRate: "4.2",
      debtBefore: eur("120000.00"),
      bankInterest: false,
    });
    expect(amounts(splits)).toEqual([["420", "-120"]]);
  });

  it("BUD-08@PoC FR 7: the interest is rounded to the cent half to even", () => {
    const split = (debt: string) =>
      splitLoanMonth({
        payments: [{ date: "2026-09-05", amount: eur("10.00") }],
        annualRate: "6",
        debtBefore: eur(debt),
        bankInterest: false,
      })[0]!.interest.toDecimalString();
    expect(split("1.00")).toBe("0"); // 0.005 → 0.00
    expect(split("3.00")).toBe("0.02"); // 0.015 → 0.02
    expect(split("100.10")).toBe("0.5"); // 0.5005 → 0.50
  });

  it("BUD-08@PoC EC2: without a rate no payment is split — all of it lowers the debt", () => {
    const splits = splitLoanMonth({
      payments: [{ date: "2026-09-05", amount: eur("650.00") }],
      annualRate: null,
      debtBefore: null,
      bankInterest: false,
    });
    expect(amounts(splits)).toEqual([["0", "650"]]);
  });

  it("BUD-08@PoC FR 7: a month with the bank's interest operation is not calculated — every payment lowers the debt", () => {
    const splits = splitLoanMonth({
      payments: [{ date: "2026-09-05", amount: eur("650.00") }],
      annualRate: "4.2",
      debtBefore: eur("120000.00"),
      bankInterest: true,
    });
    expect(amounts(splits)).toEqual([["0", "650"]]);
  });
});

describe("BUD-08@PoC: contributions to goals and investments", () => {
  const budget = new Set(["current", "card"]);
  const investment = new Set(["broker", "broker-2"]);
  const goals: GoalAccountSpan[] = [
    { goalId: "trip", accountId: "trip-account", createdOn: "2026-03-01", closedOn: null },
    { goalId: "old", accountId: "old-account", createdOn: "2026-01-01", closedOn: "2026-05-31" },
  ];
  const flow = (from: string, to: string, date = "2026-09-10") =>
    transferFlow({ fromAccountId: from, toAccountId: to, date }, budget, investment, goals);

  it("BUD-08@PoC FR 5: a transfer from a budget account to a goal's own account is a contribution to that goal", () => {
    expect(flow("current", "trip-account")).toEqual({ kind: "goal", goalId: "trip" });
    // Before the goal existed, or after it was closed, the account is not the goal's.
    expect(flow("current", "trip-account", "2026-02-15")).toBeNull();
    expect(flow("current", "old-account", "2026-05-31")).toEqual({ kind: "goal", goalId: "old" });
    expect(flow("current", "old-account", "2026-06-01")).toBeNull();
  });

  it("BUD-08@PoC AC4: a transfer to a savings account without a goal is no contribution", () => {
    expect(flow("current", "savings")).toBeNull();
    expect(flow("savings", "trip-account")).toBeNull(); // not out of a budget account
  });

  it("BUD-08@PoC FR 6: to a brokerage account — investment; back — a withdrawal; between brokerage accounts — neither", () => {
    expect(flow("current", "broker")).toEqual({ kind: "investment" });
    expect(flow("broker", "current")).toEqual({ kind: "withdrawal" });
    expect(flow("broker", "broker-2")).toBeNull();
    expect(flow("broker", "savings")).toBeNull();
  });
});

describe("BUD-08@PoC: «Залишилось на рахунках»", () => {
  const cats = new Map<string, CashflowCategory>([
    ["salary", { id: "salary", kind: "income", state: "active", mergedInto: null }],
    ["food", { id: "food", kind: "expense", state: "active", mergedInto: null }],
  ]);
  const line = (
    month: string,
    kind: FlowLine["kind"],
    amount: string,
    goalId: string | null = null,
  ): FlowLine => ({
    month,
    kind,
    amount: eur(amount),
    goalId,
  });

  it("BUD-08@PoC AC1, FR 4: income 6 000, spending 4 500, goals 500, brokerage 400 — net flow 1 500, 900 to goals and investments, 600 left", () => {
    const figures = monthFigures(
      ["2026-09"],
      [
        { month: "2026-09", categoryId: "salary", amount: eur("6000") },
        { month: "2026-09", categoryId: "food", amount: eur("-4500") },
      ],
      cats,
      "EUR",
    );
    const lines = [
      line("2026-09", "goal", "300", "trip"),
      line("2026-09", "goal", "200", "cushion"),
      line("2026-09", "investment", "400"),
      line("2026-09", "withdrawal", "150"),
    ];
    const [m] = monthFlows(figures, lines, "EUR");
    expect(figures[0]!.netFlow.toDecimalString()).toBe("1500");
    expect(m!.goalContributions.toDecimalString()).toBe("500");
    expect(m!.byGoal.map((g) => [g.goalId, g.amount.toDecimalString()])).toEqual([
      ["trip", "300"],
      ["cushion", "200"],
    ]);
    expect(m!.goalContributions.plus(m!.investmentContributions).toDecimalString()).toBe("900");
    // FR 6: the withdrawal is shown apart and not taken off.
    expect(m!.investmentWithdrawals.toDecimalString()).toBe("150");
    expect(m!.leftOnAccounts.toDecimalString()).toBe("600");
  });

  it("BUD-08@PoC FR 4: what is left may be negative; the period's flows add up its months", () => {
    const months = ["2026-08", "2026-09"];
    const figures = monthFigures(
      months,
      [
        { month: "2026-08", categoryId: "salary", amount: eur("1000") },
        { month: "2026-09", categoryId: "salary", amount: eur("1000") },
      ],
      cats,
      "EUR",
    );
    const lines = [
      line("2026-08", "debt", "1200"),
      line("2026-09", "goal", "100", "trip"),
      line("2026-09", "from-goals", "40"),
    ];
    const flows = monthFlows(figures, lines, "EUR");
    expect(flows.map((f) => f.leftOnAccounts.toDecimalString())).toEqual(["-200", "900"]);
    const period = periodFlows(periodTotals(figures, "EUR"), months, lines, "EUR");
    expect(period.leftOnAccounts.toDecimalString()).toBe("700");
    expect(period.debtRepayment.toDecimalString()).toBe("1200");
    expect(period.fromGoals.toDecimalString()).toBe("40");
  });
});
