import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import { cashflowReport, type CashflowDeps, type CashflowFlowReads, type CashflowReads } from "./index.ts";

/** Security review of #642: survivors of the mutation run over the money joins. Synthetic data. */
const eur = (a: string) => Money.of(a, "EUR");

function deps(over: Partial<CashflowReads & CashflowFlowReads>): CashflowDeps {
  const reads: CashflowReads & CashflowFlowReads = {
    categories: async () => [
      { id: "interest", kind: "expense", state: "active", mergedInto: null, systemKey: "loan-interest" },
    ],
    accountIds: async () => ["current"],
    transactions: async () => [],
    categoriesOf: async () => new Map(),
    pendingTransferSides: async () => new Set(),
    // The rate of the test: 1 EUR = 40 UAH = 1 USD; an amount keeps its number only in EUR.
    convert: async (amounts) => ({
      values: amounts.map((a) =>
        a.amount.currency === "UAH"
          ? Money.of(a.amount.amount.div(40), "EUR")
          : Money.of(a.amount.amount, "EUR"),
      ),
      nearestRateCount: 0,
      unavailableCount: 0,
    }),
    investmentAccountIds: async () => new Set<string>(),
    transfers: async () => [],
    goalAccounts: async () => [],
    goalMarks: async () => [],
    goalSpends: async () => new Map(),
    loans: async () => [
      {
        accountId: "loan",
        currency: "EUR",
        ledgerAccountId: "loan-wallet",
        openedOn: "2026-01-01",
        rates: [{ validFrom: null, annualRate: "4.2" }],
      },
    ],
    loanOperations: async () => [],
    debtsAt: async (_h, _l, dates) => dates.map(() => eur("120000.00")),
    ...over,
  };
  return { reads, currency: "EUR", today: () => "2026-11-20" };
}

describe("BUD-08@PoC b: money joins (security review #642)", () => {
  it("BUD-08@PoC FR 7: an operation of the loan's account in another currency than the loan's is not a payment of it", async () => {
    const report = await cashflowReport(
      deps({
        loanOperations: async () => [
          {
            id: "p1",
            accountId: "loan",
            amount: Money.of("650.00", "USD"),
            date: "2026-09-05",
            source: "manual",
          },
        ],
      }),
      "space-1",
      ["2026-09"],
    );
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("0");
    expect(report.months[0]!.expenses.toDecimalString()).toBe("0");
  });

  it("BUD-08@PoC FR 5: a contribution by a transfer into a goal's account in another currency is what left the budget account", async () => {
    const report = await cashflowReport(
      deps({
        goalAccounts: async () => [
          { goalId: "g1", accountId: "trip", createdOn: "2026-01-01", closedOn: null },
        ],
        transfers: async () => [
          {
            outflow: { id: "o", accountId: "current", amount: eur("-300.00"), date: "2026-09-15" },
            // The bank credited 11 700 ₴ (its own rate 39), not 300 € × 40.
            inflow: { id: "i", accountId: "trip", amount: Money.of("11700.00", "UAH"), date: "2026-09-15" },
          },
        ],
      }),
      "space-1",
      ["2026-09"],
    );
    expect(report.monthFlows[0]!.goalContributions.toDecimalString()).toBe("300");
  });
});

describe("BUD-08@PoC b: loans (security review #642)", () => {
  it("BUD-08@PoC FR 7: two loans — each payment is split on its own loan's debt", async () => {
    const asked: string[] = [];
    const debt: Record<string, string> = { "wallet-a": "120000.00", "wallet-b": "10000.00" };
    const report = await cashflowReport(
      deps({
        categories: async () => [],
        loans: async () =>
          (["a", "b"] as const).map((k) => ({
            accountId: `loan-${k}`,
            currency: "EUR",
            ledgerAccountId: `wallet-${k}`,
            openedOn: "2026-01-01",
            rates: [{ validFrom: null, annualRate: "4.2" }],
          })),
        loanOperations: async () => [
          {
            id: "pa",
            accountId: "loan-a",
            amount: eur("650.00"),
            date: "2026-09-05",
            source: "manual" as const,
          },
          {
            id: "pb",
            accountId: "loan-b",
            amount: eur("100.00"),
            date: "2026-09-05",
            source: "manual" as const,
          },
        ],
        debtsAt: async (_h, ledgerAccountId, dates) => {
          asked.push(ledgerAccountId);
          return dates.map(() => eur(debt[ledgerAccountId]!));
        },
      }),
      "space-1",
      ["2026-09"],
    );
    // 120 000 × 0,35 % = 420,00 and 10 000 × 0,35 % = 35,00.
    expect(report.months[0]!.expenses.toDecimalString()).toBe("455");
    expect(report.monthFlows[0]!.debtRepayment.toDecimalString()).toBe("295");
    expect([...asked].sort()).toEqual(["wallet-a", "wallet-b"]);
  });
});
