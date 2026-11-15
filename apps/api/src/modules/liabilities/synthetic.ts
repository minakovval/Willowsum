// Synthetic liabilities (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Loans with a rate and a monthly payment, one per (synthetic, opaque) account id. Every liability's hand-off job (its
// audit entry, ARC-04) is done; the module publishes no events: outbox_events gets one dispatched row for the isolation
// check.
import { defineSyntheticTable } from "@willowsum/synthetic";

export const synthetic = [
  defineSyntheticTable({
    table: "liabilities.liabilities",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          account_id: rng.uuid(),
          kind: "loan",
          currency: "EUR",
          annual_rate: "4.2",
          monthly_payment: "650",
          credit_limit: null,
          grace_period_days: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "liabilities.jobs",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const liabilityId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "liabilities.hand-off",
          dedupe_key: `create:${liabilityId}`,
          payload: JSON.stringify({
            liabilityId,
            actorAccountId: rng.uuid(),
            action: "create",
            changeId: liabilityId,
            changes: [{ field: "annualRate", before: null, after: "4.2" }],
          }),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-30T10:00:02Z",
        };
      }
    },
  }),
  defineSyntheticTable({
    table: "liabilities.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "liabilities.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ liabilityId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
