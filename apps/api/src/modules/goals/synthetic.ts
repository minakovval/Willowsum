// Synthetic goals (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Goals «без рахунку — лише позначки» (marks only) with manual contributions to the first goal and a spend of the
// second; every goal's hand-off
// job (its audit entry, ARC-04) is done; the module publishes no events: outbox_events gets one dispatched row for the
// isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/goals/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const NAMES = ["Синтетична відпустка", "Синтетичний диван", "Синтетична подушка"];

export const synthetic = [
  defineSyntheticTable({
    table: "goals.goals",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "goal", i),
          template: i % 3 === 2 ? "emergency" : i % 3 === 0 ? "travel" : "purchase",
          name: `${NAMES[i % 3]} ${i + 1}`,
          target_amount: "4000",
          target_currency: "EUR",
          target_date: i % 2 === 0 ? "2027-07-01" : null,
          emergency_months: i % 3 === 2 ? "3" : null,
          part_kind: "marks",
          account_id: null,
          start_amount: "1000",
          start_currency: "EUR",
          created_on: "2026-10-01",
        };
    },
  }),
  defineSyntheticTable({
    table: "goals.contributions",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      // Every contribution is of the first goal, which every household has.
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          goal_id: key(household.id, "goal", 0),
          amount: "334",
          currency: "EUR",
          contributed_on: "2026-10-15",
        };
    },
  }),
  defineSyntheticTable({
    table: "goals.spends",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      // «Витратити» (FR 8): a synthetic transaction of the second goal (it holds 1 000 €), by opaque ids only.
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          goal_id: key(household.id, "goal", 1),
          transaction_id: rng.uuid(),
          account_id: rng.uuid(),
          entry_id: rng.uuid(),
          amount: "250",
          currency: "EUR",
          spent_on: "2026-10-12",
        };
    },
  }),
  defineSyntheticTable({
    table: "goals.idempotency_keys",
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
    table: "goals.jobs",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const goalId = rng.uuid();
        const changeId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "goals.hand-off",
          dedupe_key: `goals.goal:create:${goalId}:${changeId}`,
          payload: JSON.stringify({
            entity: "goals.goal",
            entityId: goalId,
            actorAccountId: rng.uuid(),
            action: "create",
            changeId,
            changes: [{ field: "target", before: null, after: "4000" }],
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
    table: "goals.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "goals.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ goalId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
