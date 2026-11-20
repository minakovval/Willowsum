// Synthetic regular payments (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Each space gets payments added by hand and confirmed from proposals, and one rejected series; every hand-off job (the
// audit entry, ARC-04) is done; the module publishes no events: outbox_events gets one dispatched row for the isolation
// check. Tables load in name order (charge_marks before payments) in one transaction; the key of a mark to its payment
// is checked at commit. Payment n has the id `key(household, "payment", n)`; the first one has its October charge
// marked «Пропущено» (BUD-07 FR 21); the second is paused (FR 13).
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const NAMES = ["Синтетична оренда", "Синтетичний стрімінг", "Синтетична зарплата"] as const;

export const synthetic = [
  defineSyntheticTable({
    table: "recurring.charge_marks",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          payment_id: key(household.id, "payment", i),
          due_on: "2026-10-05",
          kind: "skipped",
          transaction_id: null,
          marked_on: "2026-11-01",
        };
    },
  }),
  defineSyntheticTable({
    // BUD-07 FR 13: the second payment (the streaming one) is paused until the end of January.
    table: "recurring.payment_holds",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          payment_id: key(household.id, "payment", 1),
          kind: "pause",
          starts_on: "2026-11-10",
          ends_on: "2027-01-31",
        };
    },
  }),
  defineSyntheticTable({
    table: "recurring.payments",
    perHousehold: NAMES.length,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const manual = i % 3 === 0;
        yield {
          household_id: household.id,
          id: key(household.id, "payment", i),
          name: `${NAMES[i % 3]} ${i + 1}`,
          type: i % 3 === 2 ? "income" : "expense",
          frequency: "month",
          expected_amount: i % 3 === 0 ? "650" : i % 3 === 1 ? "11.99" : "2400",
          expected_currency: "EUR",
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
          expected_currency: "EUR",
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
