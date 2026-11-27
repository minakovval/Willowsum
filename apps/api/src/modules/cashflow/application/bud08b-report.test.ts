import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { CashflowCategory } from "../domain/index.ts";
import {
  cashflowReport,
  type CashflowDeps,
  type CashflowFlowReads,
  type CashflowLoan,
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
  /** Dated rates; default — `rate` since the registration. */
  rates?: CashflowLoan["rates"];
  /** A fixed journal debt; default — 120 000,00 less every operation of the loan up to the date (the journal). */
  debt?: Money;
  /** «Оновити залишок» on the loan's wallet: the journal's debt moves by `owed` from `date` on. */
  adjustment?: { date: string; owed: Money };
  /** A currency with no rate at all: its amounts convert to null («Курс недоступний»). */
  noRate?: string;
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
    convert: async (amounts) => {
      const values = amounts.map((a) => (a.amount.currency === w.noRate ? null : a.amount));
      return { values, nearestRateCount: 0, unavailableCount: values.filter((v) => v === null).length };
    },
    investmentAccountIds: async () => new Set(w.investment ?? []),
    transfers: async () => w.transfers ?? [],
    goalAccounts: async () => [],
    goalMarks: async () => w.marks ?? [],
    goalSpends: async (_h, ids) => new Map(Object.entries(w.spends ?? {}).filter(([id]) => ids.includes(id))),
    loans: async () => [
      {
        accountId: "loan",
        currency: "EUR",
        ledgerAccountId: "loan-wallet",
        openedOn: "2026-01-01",
        adjustedOn: w.adjustment?.date ?? null,
        rates: w.rates ?? [{ validFrom: null, annualRate: w.rate === undefined ? "4.2" : w.rate }],
      },
    ],
    loanOperations: async (_h, _ids, from, to) =>
      (w.loanOps ?? []).filter((o) => o.date >= from && o.date <= to),
    debtsAt: async (_h, _l, dates) => {
      calls.push(`debtsAt ${dates.join(",")}`);
      return dates.map(
        (d) =>
          w.debt ??
          (w.loanOps ?? [])
            .filter((o) => o.date <= d && o.amount.currency === "EUR")
            .reduce((t, o) => t.minus(o.amount), eur("120000.00"))
            .plus(w.adjustment && w.adjustment.date <= d ? w.adjustment.owed : eur("0")),
      );
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
  it("BUD-08@PoC AC1: income 6 000 €, spending 4 500 €, goals 500 €, no brokerage account — net flow 1 500 €, 25,0 %, 500 € to goals, 1 000 € left", async () => {
    const report = await cashflowReport(
      deps({
        transactions: [tx("pay", "6000", "2026-09-01"), tx("shop", "-4500", "2026-09-10")],
        categoriesOf: { pay: "salary", shop: "food" },
        marks: [{ goalId: "cushion", amount: eur("500"), date: "2026-09-12" }],
      }),
      H,
      ["2026-09"],
    );
    const m = report.months[0]!;
    const f = report.monthFlows[0]!;
    expect(m.netFlow.toDecimalString()).toBe("1500");
    expect(m.savingsRate?.toFixed(1)).toBe("25.0");
    expect(f.goalContributions.toDecimalString()).toBe("500");
    expect(f.investmentContributions.isZero()).toBe(true);
    expect(f.leftOnAccounts.toDecimalString()).toBe("1000");
    expect(report.periodFlows.leftOnAccounts.toDecimalString()).toBe("1000");
  });

  it("BUD-08@PoC FR 6: a transfer to a brokerage account counts as an investment contribution, one between brokerage accounts does not", async () => {
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
    expect(d.calls).toEqual(["debtsAt 2026-09-04"]);
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

  it("BUD-08@PoC FR 7: the interest of earlier months is in the debt — 120 000,00 € at 4,2 %, 650,00 € a month: October 419,20 €, November 418,39 €", async () => {
    const d = deps({
      loanOps: [
        loanOp("p9", "650.00", "2026-09-05"),
        loanOp("p10", "650.00", "2026-10-05"),
        loanOp("p11", "650.00", "2026-11-05"),
      ],
    });
    // September is before the period: it is calculated only for the debt it leaves.
    const report = await cashflowReport(d, H, ["2026-10", "2026-11"]);
    expect(report.months.map((m) => m.expenses.toDecimalString())).toEqual(["419.2", "418.39"]);
    expect(report.monthFlows.map((f) => f.debtRepayment.toDecimalString())).toEqual(["230.8", "231.61"]);
    expect(report.periodFlows.debtRepayment.toDecimalString()).toBe("462.41");
    // One journal read for the loan, every month's date in it.
    expect(d.calls).toEqual(["debtsAt 2026-09-04,2026-10-04,2026-11-04"]);
  });

  it("BUD-08@PoC FR 7: a payment less than the interest — the unpaid interest is added to the next month's debt", async () => {
    const report = await cashflowReport(
      deps({ loanOps: [loanOp("p9", "300.00", "2026-09-05"), loanOp("p10", "650.00", "2026-10-05")] }),
      H,
      ["2026-09", "2026-10"],
    );
    // September: interest 420, principal −120. October: (120 000 − 300 + 420) × 4,2 % ÷ 12 = 420,42.
    expect(report.months.map((m) => m.expenses.toDecimalString())).toEqual(["420", "420.42"]);
    expect(report.monthFlows.map((f) => f.debtRepayment.toDecimalString())).toEqual(["-120", "229.58"]);
  });

  it("BUD-08@PoC FR 7: a month with the bank's interest operation is not calculated — the interest calculated before it stays in the debt", async () => {
    const report = await cashflowReport(
      deps({
        loanOps: [
          loanOp("p9", "650.00", "2026-09-05"),
          loanOp("p10", "650.00", "2026-10-05"),
          loanOp("bank", "-419.20", "2026-10-31", "imported"),
          loanOp("p11", "650.00", "2026-11-05"),
        ],
        categoriesOf: { bank: "interest" },
      }),
      H,
      ["2026-10", "2026-11"],
    );
    // November: the journal (120 000 − 1 300 + 419,20 = 119 119,20) misses September's 420,00 paid out of a payment it
    // took in full as principal; the bank's October operation does not put it back: 119 539,20 × 4,2 % ÷ 12 = 418,39.
    expect(report.months.map((m) => m.expenses.toDecimalString())).toEqual(["419.2", "418.39"]);
    expect(report.monthFlows.map((f) => f.debtRepayment.toDecimalString())).toEqual(["650", "231.61"]);
  });

  it("BUD-08@PoC FR 7: «Оновити залишок» puts the real debt in the journal — the interest calculated before it is not added again", async () => {
    const report = await cashflowReport(
      deps({
        loanOps: [
          loanOp("p9", "650.00", "2026-09-05"),
          loanOp("p10", "650.00", "2026-10-05"),
          loanOp("p12", "650.00", "2026-12-05"),
        ],
        // The bank's debt on 19 November: 120 000 + 420,00 + 419,20 − 1 300 = 119 539,20; the journal had 118 700,00.
        adjustment: { date: "2026-11-19", owed: eur("839.20") },
      }),
      H,
      ["2026-12"],
    );
    // December: 119 539,20 × 4,2 % ÷ 12 = 418,3872 → 418,39 (not 120 378,40 → 421,32).
    expect(report.months[0]!.expenses.toDecimalString()).toBe("418.39");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("231.61");
  });

  it("BUD-08@PoC FR 7: interest calculated after «Оновити залишок» is still carried", async () => {
    const report = await cashflowReport(
      deps({
        loanOps: [
          loanOp("p9", "650.00", "2026-09-05"),
          loanOp("p10", "650.00", "2026-10-05"),
          loanOp("p12", "650.00", "2026-12-05"),
          loanOp("p1", "650.00", "2027-01-05"),
        ],
        adjustment: { date: "2026-11-19", owed: eur("839.20") },
      }),
      H,
      ["2027-01"],
    );
    // January: 119 539,20 − 650 + 418,39 = 119 307,59 × 4,2 % ÷ 12 = 417,576… → 417,58.
    expect(report.months[0]!.expenses.toDecimalString()).toBe("417.58");
  });

  it("BUD-08@PoC FR 7: an interest operation entered by hand does not cancel the calculation", async () => {
    const report = await cashflowReport(
      deps({
        loanOps: [loanOp("p1", "650.00", "2026-09-05"), loanOp("m", "-415.10", "2026-09-30")],
        debt: eur("120000.00"),
        categoriesOf: { m: "interest" },
      }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("420");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("230");
  });

  it("BUD-08@PoC FR 7: an outflow on the loan's account is no payment; the first payment is the first inflow", async () => {
    const report = await cashflowReport(
      deps({ loanOps: [loanOp("c", "-50.00", "2026-09-01"), loanOp("p1", "650.00", "2026-09-05")] }),
      H,
      ["2026-09"],
    );
    // The debt before it: 120 050,00 × 4,2 % ÷ 12 = 420,175 → 420,18.
    expect(report.months[0]!.expenses.toDecimalString()).toBe("420.18");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("229.82");
  });

  it("BUD-08@PoC FR 7: a rate changed in the middle of the month — the rate on the first payment's date", async () => {
    const report = await cashflowReport(
      deps({
        rates: [
          { validFrom: null, annualRate: "4.2" },
          { validFrom: "2026-09-10", annualRate: "6" },
        ],
        loanOps: [loanOp("p1", "650.00", "2026-09-05"), loanOp("p2", "100.00", "2026-09-20")],
      }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("420");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("330");
  });

  it("BUD-08@PoC EC2: a month with the bank's interest operation and no rate gives no «внесіть ставку» hint", async () => {
    const report = await cashflowReport(
      deps({
        rate: null,
        loanOps: [loanOp("p1", "650.00", "2026-09-05"), loanOp("bank", "-415.10", "2026-09-30", "imported")],
        categoriesOf: { bank: "interest" },
      }),
      H,
      ["2026-09"],
    );
    expect(report.loansWithoutRate).toEqual([]);
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("650");
  });

  it("BUD-08@PoC FR 7: an overpaid loan (the journal owes nothing) — no interest, the whole payment lowers the debt", async () => {
    const report = await cashflowReport(
      deps({ debt: eur("-500.00"), loanOps: [loanOp("p1", "650.00", "2026-09-05")] }),
      H,
      ["2026-09"],
    );
    expect(report.months[0]!.expenses.toDecimalString()).toBe("0");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("650");
  });

  it("BUD-08@PoC EC4: a «Внести» mark in a currency with no rate at all is left out of the goals and counted as unavailable", async () => {
    const report = await cashflowReport(
      deps({
        noRate: "USD",
        marks: [
          { goalId: "g1", amount: eur("200"), date: "2026-09-12" },
          { goalId: "g2", amount: Money.of("300", "USD"), date: "2026-09-12" },
        ],
      }),
      H,
      ["2026-09"],
    );
    expect(report.monthFlows[0]!.goalContributions.toDecimalString()).toBe("200");
    expect(report.monthFlows[0]!.byGoal.map((g) => g.goalId)).toEqual(["g1"]);
    expect(report.unavailableCount).toBe(1);
  });
});
