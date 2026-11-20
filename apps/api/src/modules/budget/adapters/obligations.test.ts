import { describe, expect, it } from "vitest";
import { AmountOutOfRangeError, Money } from "@willowsum/domain-kernel";
import { createBudgetObligations } from "./obligations.ts";

/**
 * #567: the budget's adapter of `BudgetObligations` over fake ports — what it takes from recurring and the loans, the cap
 * on amounts and a rate that is missing. The live adapter: test/bud03a-obligations.it.test.ts.
 */
const eur = (a: string) => Money.of(a, "EUR");
type Charge = Awaited<
  ReturnType<Parameters<typeof createBudgetObligations>[0]["recurring"]["chargesIn"]>
>[number];

const charge = (dueOn: string, amount: Money, more: Partial<Charge> = {}): Charge => ({
  paymentId: "p",
  type: "expense",
  categoryId: null,
  dueOn,
  expected: amount,
  status: "expected",
  overdueDays: null,
  ...more,
});

function adapter(o: {
  charges?: Charge[];
  loans?: { accountId: string; kind?: "loan" | "credit-card"; payment: Money | null }[];
  paid?: string[];
  noRate?: boolean;
  fxError?: Error;
}) {
  const asked: unknown[] = [];
  const port = createBudgetObligations({
    recurring: {
      chargesIn: async (householdId, month) => {
        asked.push(["recurring", householdId, month]);
        return o.charges ?? [];
      },
    },
    credit: {
      list: async (householdId) => {
        asked.push(["credit", householdId]);
        return (o.loans ?? []).map((l) => ({
          accountId: l.accountId,
          kind: l.kind ?? "loan",
          name: "x",
          subaccounts: [],
        }));
      },
    },
    liabilities: {
      forAccount: async (_householdId, accountId) => {
        const l = o.loans?.find((x) => x.accountId === accountId);
        return l
          ? {
              id: `l-${accountId}`,
              accountId,
              kind: "loan",
              currency: "EUR",
              annualRate: "10",
              monthlyPayment: l.payment,
              creditLimit: null,
              gracePeriodDays: null,
            }
          : null;
      },
    },
    payments: {
      paidIn: async (householdId, ids, from, to) => {
        asked.push(["paidIn", householdId, ids, from, to]);
        return new Set(ids.filter((id) => o.paid?.includes(id)));
      },
    },
    fx: {
      total: async (amounts, currency) => {
        if (o.fxError) throw o.fxError;
        return {
          currency: currency ?? "EUR",
          total: null,
          approximate: false,
          nearestRateCount: 0,
          staleRateCount: 0,
          unavailableCount: 0,
          restricted: false,
          items: amounts.map((a) =>
            o.noRate && a.amount.currency !== "EUR"
              ? { kind: "rate-unavailable" as const, original: a.amount }
              : { kind: "reporting-currency" as const, original: a.amount, value: a.amount },
          ),
        };
      },
    },
  });
  return { port, asked };
}

describe("#567: the adapter of BudgetObligations", () => {
  it("BUD-03@PoC FR 5: only «Очікується» and «Прострочено» are unpaid; incomes and charges before a proportional start are left out", async () => {
    const { port } = adapter({
      charges: [
        charge("2026-11-02", eur("1"), { status: "paid" }),
        charge("2026-11-03", eur("2"), { status: "paid-late" }),
        charge("2026-11-04", eur("3"), { status: "skipped" }),
        charge("2026-11-05", eur("4"), { status: "overdue", overdueDays: 13 }),
        charge("2026-11-20", eur("5"), { categoryId: "c" }),
        charge("2026-11-21", eur("6"), { type: "income" }),
      ],
    });
    const o = await port.month("h", "2026-11", "EUR");
    expect(o!.recurring.map((r) => [r.amount.toDecimalString(), r.paid, r.categoryId])).toEqual([
      ["1", true, null],
      ["2", true, null],
      ["3", true, null],
      ["4", false, null],
      ["5", false, "c"],
    ]);
    const from = await port.month("h", "2026-11", "EUR", "2026-11-18");
    expect(from!.recurring.map((r) => r.amount.toDecimalString())).toEqual(["5"]);
  });

  it("BUD-03@PoC FR 8: each charge of the list carries its payment, date and «Прострочено на N дн.»", async () => {
    const { port } = adapter({
      charges: [
        charge("2026-11-05", eur("4"), { paymentId: "late", status: "overdue", overdueDays: 13 }),
        charge("2026-11-20", eur("5"), { paymentId: "rent" }),
      ],
    });
    const o = await port.month("h", "2026-11", "EUR");
    expect(o!.recurring.map((r) => [r.paymentId, r.dueOn, r.overdueDays])).toEqual([
      ["late", "2026-11-05", 13],
      ["rent", "2026-11-20", null],
    ]);
  });

  it("BUD-03@PoC FR 3: the regular incomes still expected in the month are summed — not the ones received — and one without a rate leaves only that figure out", async () => {
    const income = (dueOn: string, amount: Money, more: Partial<Charge> = {}) =>
      charge(dueOn, amount, { type: "income", ...more });
    const { port } = adapter({
      charges: [
        income("2026-11-03", eur("900"), { status: "paid" }),
        income("2026-11-10", eur("100"), { status: "overdue", overdueDays: 8 }),
        income("2026-11-25", eur("1000")),
        charge("2026-11-20", eur("5")),
      ],
    });
    const o = await port.month("h", "2026-11", "EUR");
    expect(o!.incomeExpected!.toDecimalString()).toBe("1100");
    expect((await port.month("h", "2026-11", "EUR", "2026-11-18"))!.incomeExpected!.toDecimalString()).toBe(
      "1000",
    );
    const usd = adapter({
      charges: [income("2026-11-25", Money.of("10", "USD")), charge("2026-11-20", eur("5"))],
      noRate: true,
    });
    const without = await usd.port.month("h", "2026-11", "EUR");
    expect(without!.incomeExpected).toBeNull();
    expect(without!.recurring.map((r) => r.amount.toDecimalString())).toEqual(["5"]);
  });

  it("BUD-03@PoC FR 5: each loan with a monthly payment once, paid when the month has a payment to it; a credit card and a loan without the payment add nothing", async () => {
    const { port, asked } = adapter({
      loans: [
        { accountId: "a", payment: eur("250") },
        { accountId: "b", payment: eur("400") },
        { accountId: "c", payment: null },
        { accountId: "d", kind: "credit-card", payment: eur("50") },
      ],
      paid: ["b"],
    });
    const o = await port.month("h", "2026-02", "EUR", "2026-02-10");
    expect(o!.debtMinimums.map((d) => [d.accountId, d.amount.toDecimalString(), d.paid])).toEqual([
      ["a", "250", false],
      ["b", "400", true],
    ]);
    // The whole month, also for a proportional first period; bound to the space asked.
    expect(asked).toContainEqual(["paidIn", "h", ["a", "b"], "2026-02-01", "2026-02-28"]);
    expect(asked.every((a) => (a as unknown[])[1] === "h")).toBe(true);
  });

  it("#567 comment 7003240884: an amount over 15 integer digits gives no answer (null), never a 500 from an overflowing sum", async () => {
    const big = eur("12345678901234567890");
    expect(
      await adapter({ charges: [charge("2026-11-20", big), charge("2026-11-21", big)] }).port.month(
        "h",
        "2026-11",
        "EUR",
      ),
    ).toBeNull();
    expect(
      await adapter({ loans: [{ accountId: "a", payment: big }] }).port.month("h", "2026-11", "EUR"),
    ).toBeNull();
    const edge = await adapter({ charges: [charge("2026-11-20", eur("999999999999999.99"))] }).port.month(
      "h",
      "2026-11",
      "EUR",
    );
    expect(edge!.recurring[0]!.amount.toDecimalString()).toBe("999999999999999.99");
  });

  it("#567 boundaries: 16 integer digits is over the cap; a charge on the first day of a proportional period counts; a loan keeps its own amount after the charges", async () => {
    const over = adapter({ charges: [charge("2026-11-20", eur("1000000000000000"))] });
    expect(await over.port.month("h", "2026-11", "EUR")).toBeNull();
    const { port } = adapter({
      charges: [charge("2026-11-18", eur("7"))],
      loans: [{ accountId: "a", payment: eur("250") }],
    });
    const o = await port.month("h", "2026-11", "EUR", "2026-11-18");
    expect(o!.recurring.map((r) => r.amount.toDecimalString())).toEqual(["7"]);
    expect(o!.debtMinimums.map((d) => d.amount.toDecimalString())).toEqual(["250"]);
  });

  it("BUD-03@PoC EC4: an amount with no rate at all gives no answer — no figure beats a wrong one", async () => {
    const { port } = adapter({ charges: [charge("2026-11-20", Money.of("10", "USD"))], noRate: true });
    expect(await port.month("h", "2026-11", "EUR")).toBeNull();
  });

  it("BUD-03@PoC EC4: the rates' reader leaving the money type in its own sum gives no answer (null), any other failure is thrown (#588)", async () => {
    const charges = [
      charge("2026-11-20", eur("999999999999999.99")),
      charge("2026-11-21", eur("999999999999999.99")),
    ];
    expect(
      await adapter({ charges, fxError: new AmountOutOfRangeError() }).port.month("h", "2026-11", "EUR"),
    ).toBeNull();
    await expect(
      adapter({ charges, fxError: new Error("rates are down") }).port.month("h", "2026-11", "EUR"),
    ).rejects.toThrow("rates are down");
  });
});
