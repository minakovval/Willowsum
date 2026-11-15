// Synthetic bulk actions (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data. One completed
// action per space over 3 synthetic records (ids derived as the transactions module's), its 3 records, its done jobs (the
// part and the group audit entry), one stored start response and one dispatched event for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "bulk_actions.actions",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "bulk-action", i),
          actor_id: key(household.id, "actor", 0),
          action: "transactions.add-tags",
          entity: "transactions",
          params: JSON.stringify({ tags: ["синтетичний"] }),
          background: "false",
          status: "completed",
          run: "1",
          record_count: "3",
          created_at: "2026-10-30T10:00:00Z",
          ended_at: "2026-10-30T10:00:01Z",
          undone_at: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "bulk_actions.items",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          action_id: key(household.id, "bulk-action", 0),
          position: String(i + 1),
          record_id: key(household.id, "transaction", i),
          version_before: i === 2 ? null : "1",
          before: i === 2 ? null : JSON.stringify({ tags: "" }),
          after: i === 2 ? null : JSON.stringify({ tags: "синтетичний" }),
          outcome: i === 2 ? "unchanged" : "changed",
          issue: null,
          version_after: i === 2 ? null : "2",
          run: i === 2 ? null : "1",
          undo: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "bulk_actions.idempotency_keys",
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
    table: "bulk_actions.jobs",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      const actionId = key(household.id, "bulk-action", 0);
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: i === 0 ? "bulk-actions.run-part" : "bulk-actions.audit",
          dedupe_key: i === 0 ? `run:${actionId}:1:${i + 1}` : `audit:${actionId}:run:${i}`,
          payload: JSON.stringify(
            i === 0 ? { actionId, run: 1, part: 1 } : { actionId, kind: "run", run: 1 },
          ),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-30T10:00:02Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "bulk_actions.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "bulk-actions.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ actionId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
