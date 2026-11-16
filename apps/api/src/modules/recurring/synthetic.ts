// Synthetic regular payments (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Each space gets payments added by hand and confirmed from proposals, and one rejected series; every hand-off job (the
// audit entry, ARC-04) is done; the module publishes no events: outbox_events gets one dispatched row for the isolation
// check.
import { defineSyntheticTable } from "@willowsum/synthetic";

const NAMES = ["Синтетична оренда", "Синтетичний стрімінг", "Синтетична зарплата"] as const;

export const synthetic = [
  defineSyntheticTable({
    table: "recurring.payments",
    perHousehold: NAMES.length,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const manual = i % 3 === 0;
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: `${NAMES[i % 3]} ${i + 1}`,
          type: i % 3 === 2 ? "income" : "expense",
          frequency: "month",
          expected_amount: i % 3 === 0 ? "650" : i % 3 === 1 ? "11.99" : "2400",
          currency: "EUR",
          anchor_date: "2026-10-05",
          end_date: null,
          category_id: null,
          account_id: null,
          subscription: String(i % 3 === 1),
          variable: "false",
          merchant_id: manual ? null : rng.uuid(),
          source: manual ? "manual" : "proposal",
          created_on: "2026-11-01",
        };
      }
    },
  }),
  defineSyntheticTable({
    table: "recurring.rejections",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          merchant_id: rng.uuid(),
          type: "expense",
          frequency: "week",
          variable: "false",
          expected_amount: "4.5",
          currency: "EUR",
          transaction_ids: `{${rng.uuid()},${rng.uuid()},${rng.uuid()}}`,
          created_on: "2026-11-02",
        };
    },
  }),
  defineSyntheticTable({
    table: "recurring.idempotency_keys",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          key: rng.uuid(),
          request_hash: "0".repeat(64),
          state: "pending",
          response_status: null,
          response_body: null,
          expires_at: "2026-12-31T00:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "recurring.jobs",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const paymentId = rng.uuid();
        const changeId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "recurring.hand-off",
          dedupe_key: `recurring.payment:create:${paymentId}:${changeId}`,
          payload: JSON.stringify({
            entity: "recurring.payment",
            entityId: paymentId,
            actorAccountId: rng.uuid(),
            action: "create",
            changeId,
            changes: [{ field: "amount", before: null, after: "650" }],
          }),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-11-01T10:00:02Z",
        };
      }
    },
  }),
  defineSyntheticTable({
    table: "recurring.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "recurring.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ paymentId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-11-01T10:00:01Z",
        };
    },
  }),
];
