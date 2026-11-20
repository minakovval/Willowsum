import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { CashflowCategory } from "../domain/index.ts";
import {
  cashflowReport,
  type CashflowDeps,
  type CashflowFlowReads,
  type CashflowLoanOperation,
  type CashflowReads,
  type CashflowTransaction,
} from "./index.ts";

/**
 * BUD-08@PoC b) over fake reads: what the real modules cannot yet give in PoC — a brokerage account (FIN-01@PoC FR 2 has
 * none), a loan without a rate, the bank's own interest operation, a proposed pair to a loan. Synthetic data.
 */
const eur = (a: string) => Money.of(a, "EUR");
const H = "space-1";

const categories: CashflowCategory[] = [
  { id: "salary", kind: "income", state: "active", mergedInto: null, systemKey: "salary" },
  { id: "food", kind: "expense", state: "active", mergedInto: null, systemKey: "groceries" },
  { id: "interest", kind: "expense", state: "active", mergedInto: null, systemKey: "loan-interest" },
];

interface World {
  transactions?: CashflowTransaction[];
  categoriesOf?: Record<string, string>;
  pending?: string[];
  transfers?: Awaited<ReturnType<CashflowFlowReads["transfers"]>>;
  investment?: string[];
  marks?: { goalId: string; amount: Money; date: string }[];
  spends?: Record<string, Money>;
  loanOps?: CashflowLoanOperation[];
  rate?: string | null;
  debt?: Money;
}

function deps(w: World): CashflowDeps & { calls: string[] } {
  const calls: string[] = [];
  const reads: CashflowReads & CashflowFlowReads = {
    categories: async () => categories,
    accountIds: async () => ["current"],
    transactions: async () => w.transactions ?? [],
    categoriesOf: async (_h, ids) =>
      new Map(Object.entries(w.categoriesOf ?? {}).filter(([id]) => ids.includes(id))),
    pendingTransferSides: async () => new Set(w.pending ?? []),
    convert: async (amounts) => ({
      values: amounts.map((a) => a.amount),
      nearestRateCount: 0,
      unavailableCount: 0,
    }),
    investmentAccountIds: async () => new Set(w.investment ?? []),
    transfers: async () => w.transfers ?? [],
    goalAccounts: async () => [],
    goalMarks: async () => w.marks ?? [],
    goalSpends: async (_h, ids) => new Map(Object.entries(w.spends ?? {}).filter(([id]) => ids.includes(id))),
    loans: async () => [{ accountId: "loan", currency: "EUR", ledgerAccountId: "loan-wallet" }],
    loanOperations: async () => w.loanOps ?? [],
    annualRate: async () => (w.rate === undefined ? "4.2" : w.rate),
    debtAt: async (_h, _l, date) => {
      calls.push(`debtAt ${date}`);
      return w.debt ?? eur("120000.00");
    },
  };
  return { reads, currency: "EUR", today: () => "2026-11-20", calls };
}

const tx = (id: string, amount: string, date: string): CashflowTransaction => ({
  id,
  amount: eur(amount),
  date,
  parts: null,
});
const side = (id: string, accountId: string, amount: string, date = "2026-09-15") => ({
  id,
  accountId,
  amount: eur(amount),
  date,
});
const loanOp = (
  id: string,
  amount: string,
  date: string,
  source: "manual" | "imported" = "manual",
): CashflowLoanOperation => ({ id, accountId: "loan", amount: eur(amount), date, source });

describe("BUD-08@PoC b: the report", () => {
  it("BUD-08@PoC AC1: income 6 000 €, spending 4 500 €, goals 500 €, brokerage 400 € — net flow 1 500 €, 25,0 %, 900 € to goals and investments, 600 € left", async () => {
    const report = await cashflowReport(
      deps({
        transactions: [tx("pay", "6000", "2026-09-01"), tx("shop", "-4500", "2026-09-10")],
        categoriesOf: { pay: "salary", shop: "food" },
        marks: [{ goalId: "cushion", amount: eur("500"), date: "2026-09-12" }],
        investment: ["broker"],
        transfers: [
          { outflow: side("o1", "current", "-400"), inflow: side("i1", "broker", "400") },
          // Between brokerage accounts — neither.
          { outflow: side("o2", "broker", "-50"), inflow: side("i2", "broker-2", "50") },
        ],
      }),
      H,
      ["2026-09"],
    );
    const m = report.months[0]!;
    const f = report.monthFlows[0]!;
    expect(m.netFlow.toDecimalString()).toBe("1500");
    expect(m.savingsRate?.toFixed(1)).toBe("25.0");
    expect(f.goalContributions.plus(f.investmentContributions).toDecimalString()).toBe("900");
    expect(f.leftOnAccounts.toDecimalString()).toBe("600");
    expect(report.periodFlows.leftOnAccounts.toDecimalString()).toBe("600");
  });

  it("BUD-08@PoC FR 6: a withdrawal from a brokerage account is shown apart and not taken off the contributions", async () => {
    const report = await cashflowReport(
      deps({
        investment: ["broker"],
        transfers: [
          { outflow: side("o1", "current", "-400"), inflow: side("i1", "broker", "400") },
          { outflow: side("o2", "broker", "-100"), inflow: side("i2", "current", "100") },
        ],
      }),
      H,
      ["2026-09"],
    );
    expect(report.monthFlows[0]!.investmentContributions.toDecimalString()).toBe("400");
    expect(report.monthFlows[0]!.investmentWithdrawals.toDecimalString()).toBe("100");
  });

  it("BUD-08@PoC AC7: the first payment 650,00 € — 420,00 € spending in «Відсотки за кредитами», 230,00 € «Погашення боргу»; the debt read before the payment", async () => {
    const d = deps({
      transactions: [tx("pay", "6000", "2026-09-01")],
      categoriesOf: { pay: "salary" },
      loanOps: [loanOp("p1", "650.00", "2026-09-05")],
    });
    const report = await cashflowReport(d, H, ["2026-09"]);
    expect(report.months[0]!.expenses.toDecimalString()).toBe("420");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("230");
    // «Погашення боргу» does not lower the savings rate: (6 000 − 420) ÷ 6 000.
    expect(report.months[0]!.savingsRate?.toFixed(1)).toBe("93.0");
    expect(d.calls).toEqual(["debtAt 2026-09-04"]);
    expect(report.loansWithoutRate).toEqual([]);
  });

  it("BUD-08@PoC EC2: a loan without a rate — the whole payment is «Погашення боргу», and the loan is named for the hint", async () => {
    const report = await cashflowReport(
      deps({ rate: null, loanOps: [loanOp("p1", "650.00", "2026-09-05")] }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("0");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("650");
    expect(report.loansWithoutRate).toEqual(["loan"]);
  });

  it("BUD-08@PoC FR 7: the bank's imported interest operation of the month replaces the calculation; the payment lowers the debt in full", async () => {
    const report = await cashflowReport(
      deps({
        loanOps: [loanOp("p1", "650.00", "2026-09-05"), loanOp("bank", "-415.10", "2026-09-30", "imported")],
        categoriesOf: { bank: "interest" },
      }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("415.1");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("650");
  });

  it("BUD-08@PoC FR 7: a payment that is a side of a proposed pair is not split until the pair is confirmed", async () => {
    const report = await cashflowReport(
      deps({ pending: ["p1"], loanOps: [loanOp("p1", "650.00", "2026-09-05")] }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("0");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("0");
  });

  it("BUD-08@PoC EC3: a transfer to a brokerage account still awaiting its pair is no investment and is counted in «Перекази без пари»", async () => {
    const report = await cashflowReport(
      deps({ investment: ["broker"], transactions: [tx("o1", "-400", "2026-09-15")], pending: ["o1"] }),
      H,
      ["2026-09"],
    );
    expect(report.monthFlows[0]!.investmentContributions.toDecimalString()).toBe("0");
    expect(report.months[0]!.expenses.toDecimalString()).toBe("0");
    expect(report.unpairedTransfers).toBe(1);
  });

  it("BUD-08@PoC FR 10: spending paid from a goal stays in the month's spending and is its layer «з цілей»", async () => {
    const report = await cashflowReport(
      deps({
        transactions: [tx("trip", "-2900", "2026-07-10"), tx("shop", "-100", "2026-07-11")],
        categoriesOf: { trip: "food", shop: "food" },
        spends: { trip: eur("2900") },
      }),
      H,
      ["2026-07", "2026-08"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("3000");
    expect(report.monthFlows.map((f) => f.fromGoals.toDecimalString())).toEqual(["2900", "0"]);
  });
});
