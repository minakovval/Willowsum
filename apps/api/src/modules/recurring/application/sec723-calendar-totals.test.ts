import { Money } from "@willowsum/domain-kernel";
import { describe, expect, it } from "vitest";
import type { Tracking } from "../domain/index.ts";
import { buildCalendar, type CalendarDeps } from "./index.ts";
import type { StoredPayment } from "./payments.ts";

/**
 * Security review of PR #723 (money): the sums of `buildCalendar` the PR's tests left unguarded — a total with one
 * amount without a rate, «За рік» of a held or ended payment, a charge «Пропущено». Synthetic data; fixed day.
 */
const TODAY = "2026-11-18";
const eur = (amount: string) => Money.of(amount, "EUR");
const range = { from: "2026-11-01", to: "2026-11-30" };

const deps: CalendarDeps = {
  loans: {
    list: async () => [],
    inflows: async () => [],
    debt: async () => eur("0"),
  },
  // EUR as it is; any other currency has no rate at all.
  report: async (amounts) => ({
    values: amounts.map((a) => (a.currency === "EUR" ? a : null)),
    approximate: false,
  }),
  today: () => TODAY,
};

function payment(id: string, expected: Money, over: Partial<StoredPayment> = {}): StoredPayment {
  return {
    id,
    name: `Синтетичний платіж ${id}`,
    expected,
    frequency: "month",
    anchorDate: "2026-11-25",
    categoryId: null,
    accountId: null,
    endDate: null,
    type: "expense",
    subscription: false,
    variable: false,
    merchantId: null,
    source: "manual",
    createdOn: "2026-11-01",
    version: 1,
    current: null,
    keptOn: null,
    ...over,
  };
}

function tracking(expected: Money, over: Partial<Tracking> = {}): Tracking {
  return {
    charges: [],
    expected,
    amountChange: null,
    changes: [],
    missesInRow: 0,
    state: "active",
    approximate: false,
    used: [],
    holds: [],
    hold: null,
    ...over,
  };
}

const space = (entries: [StoredPayment, Tracking][]) => ({
  byPayment: new Map(entries.map(([p, t]) => [p.id, t])),
  used: new Map<string, string>(),
  history: new Map(),
});

describe("BUD-07@PoC FR 7: the calendar's sums (security review of PR #723)", () => {
  it("BUD-07@PoC FR 7: a total with one amount without any rate is no figure — never the sum of the others", async () => {
    const a = payment("a", eur("40"));
    const b = payment("b", Money.of("10", "USD"));
    const entries: [StoredPayment, Tracking][] = [
      [a, tracking(a.expected)],
      [b, tracking(b.expected)],
    ];
    const c = await buildCalendar(deps, "h", [a, b], space(entries), range, "EUR");
    expect(c.items).toHaveLength(2);
    expect([c.totals.expenses, c.totals.yearExpenses, c.period.remaining]).toEqual([null, null, null]);
    expect(c.period.charges).toBe(2);
  });

  it("BUD-07@PoC FR 7: «За рік» leaves out a paused payment and one that has ended", async () => {
    const active = payment("a", eur("40"));
    const paused = payment("p", eur("15"));
    const ended = payment("e", eur("7"), { anchorDate: "2026-10-10", endDate: "2026-11-10" });
    const entries: [StoredPayment, Tracking][] = [
      [active, tracking(active.expected)],
      [
        paused,
        tracking(paused.expected, {
          hold: "paused",
          holds: [{ kind: "pause", from: "2026-11-01", until: null }],
        }),
      ],
      [ended, tracking(ended.expected)],
    ];
    const c = await buildCalendar(deps, "h", [active, paused, ended], space(entries), range, "EUR");
    // 12 × 40: neither 12 × 15 of the paused one nor 12 × 7 of the ended one.
    expect(c.totals.yearExpenses?.toDecimalString()).toBe("480");
  });

  it("BUD-07@PoC FR 7, FR 19: a charge «Пропущено» is in no total and not left to pay, but is one of the M charges", async () => {
    const skipped = payment("s", eur("30"), { anchorDate: "2026-11-10" });
    const due = payment("d", eur("40"));
    const entries: [StoredPayment, Tracking][] = [
      [
        skipped,
        tracking(skipped.expected, {
          charges: [
            {
              dueOn: "2026-11-10",
              expected: eur("30"),
              status: "skipped",
              transactionId: null,
              paidOn: null,
              amount: null,
              overdueDays: null,
              markedOn: "2026-11-12",
              approximate: false,
              amountChange: null,
            },
          ],
        }),
      ],
      [due, tracking(due.expected)],
    ];
    const c = await buildCalendar(deps, "h", [skipped, due], space(entries), range, "EUR");
    expect(c.totals.expenses?.toDecimalString()).toBe("40");
    expect(c.period).toMatchObject({ charges: 2, paid: 0, overdue: 0 });
    expect(c.period.remaining?.toDecimalString()).toBe("40");
  });
});
