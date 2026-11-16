// Synthetic budgets (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// One budget per space (BUD-02@PoC FR 1) with limits of synthetic categories, a switched account and a finished
// period's snapshot, by opaque ids only; every hand-off job (its audit entry, ARC-04) is done; the module publishes no
// events: outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/budget/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const budgetOf = (householdId: string) => key(householdId, "budget", 0);

export const synthetic = [
  defineSyntheticTable({
    table: "budget.budgets",
    perHousehold: 1,
    // One budget per space (UNIQUE household_id).
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: budgetOf(household.id),
          currency: "EUR",
          first_period: "2025-01-01",
          income_plan: "3000",
          created_on: "2024-12-20",
        };
    },
  }),
  defineSyntheticTable({
    table: "budget.limits",
    perHousehold: 3,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          budget_id: budgetOf(household.id),
          category_id: rng.uuid(),
          amount: i === 0 ? "600" : "300",
          currency: "EUR",
        };
    },
  }),
  defineSyntheticTable({
    table: "budget.budget_accounts",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          account_id: rng.uuid(),
          budget_id: budgetOf(household.id),
          included: "false",
        };
    },
  }),
  defineSyntheticTable({
    table: "budget.period_snapshots",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          budget_id: budgetOf(household.id),
          // Finished months from the first period on, one per row (the key is the period).
          period: `${2025 + Math.floor(i / 12)}-${String(1 + (i % 12)).padStart(2, "0")}-01`,
          currency: "EUR",
          income_plan: "3000",
          planned_savings: "0",
          limits: JSON.stringify([{ categoryId: rng.uuid(), amount: "600", mandatory: true }]),
        };
    },
  }),
  defineSyntheticTable({
    table: "budget.idempotency_keys",
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
    table: "budget.jobs",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const budgetId = budgetOf(household.id);
        const changeId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "budget.hand-off",
          dedupe_key: `budget.budget:update:${budgetId}:${changeId}`,
          payload: JSON.stringify({
            entity: "budget.budget",
            entityId: budgetId,
            actorAccountId: rng.uuid(),
            action: "update",
            changeId,
            changes: [{ field: "incomePlan", before: "2500", after: "3000" }],
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
    table: "budget.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "budget.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ budgetId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
