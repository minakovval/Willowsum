// Synthetic debt payoff plans (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// One saved plan per household for a synthetic loan (an opaque account id), its hand-off job done; the module
// publishes no events: outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/debt-payoff/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "debt_payoff.plans",
    perHousehold: 1,
    *rows({ household, count }) {
      // AC2: «Visa» 5 000 € at 24 % with 250 € and an extra 100 € a month — 17 months, 946,99 € of interest.
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "plan", i),
          account_id: key(household.id, "account", i),
          currency: "EUR",
          start_month: "2026-10",
          balance: "5000",
          annual_rate: "24",
          monthly_payment: "250",
          extra_monthly: "100",
          one_offs: "[]",
          months: "17",
          total_interest: "946.99",
          payoff_month: "2028-03",
          add_to_planned_expenses: "true",
        };
    },
  }),
  defineSyntheticTable({
    table: "debt_payoff.jobs",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          name: "debt-payoff.hand-off",
          dedupe_key: `debt-payoff.plan:create:${key(household.id, "plan", i)}:${rng.uuid()}`,
          payload: "{}",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "debt_payoff.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          id: rng.uuid(),
          household_id: household.id,
          event_name: "debt-payoff.synthetic-event",
          event_version: "1",
          payload: "{}",
          dispatched_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
];
