// Synthetic category trees (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Custom groups and categories only (the system tree is written by the module on first use); every category is in
// the space's first synthetic group. Tables load in name order in one transaction; the keys are checked at commit.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";
import { SYSTEM_TREE } from "./domain/index.ts";

/** The tone of the first system group (the colours are data, never UI literals). */
const TONE = SYSTEM_TREE[0]!.tone;

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "categories.categories",
    perHousehold: 6,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "category", i),
          group_id: key(household.id, "group", 0),
          kind: "expense",
          system_key: null,
          name: `Синтетична категорія ${i + 1}`,
          renamed: "false",
          icon: "shapes",
          color: TONE,
          essential: i % 3 === 0 ? "true" : "false",
          state: "active",
          merged_into: null,
          position: String(i),
          version: "1",
        };
    },
  }),
  defineSyntheticTable({
    table: "categories.category_groups",
    perHousehold: 2,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "group", i),
          system_key: null,
          kind: "expense",
          name: `Синтетична група ${i + 1}`,
          renamed: "false",
          tone: TONE,
          position: String(100 + i),
          version: "1",
        };
    },
  }),
  defineSyntheticTable({
    table: "categories.idempotency_keys",
    perHousehold: 2,
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
  // The queue (ARC-04, migrations/0003_outbox.sql): «категорію об'єднано» events, dispatched; no jobs run here yet.
  defineSyntheticTable({
    table: "categories.outbox_events",
    perHousehold: 2,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "event", i),
          event_name: "categories.merged",
          event_version: "1",
          payload: JSON.stringify({
            sourceId: key(household.id, "category", 10 + i),
            targetId: key(household.id, "category", 0),
            kind: "expense",
            mergedAt: "2026-10-01T10:00:00.000Z",
          }),
          traceparent: null,
          dispatched_at: "2026-10-01T10:00:01Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "categories.jobs",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "job", i),
          name: "categories.synthetic-job",
          dedupe_key: key(household.id, "event", i),
          payload: JSON.stringify({ eventId: key(household.id, "event", i) }),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-10-01T10:00:02Z",
        };
    },
  }),
  // BUD-21 FR 25 (migrations/0004_history_labels.sql): confirmed matchings of history-file labels — a hash of a
  // synthetic label, the space's first category or a transfer (null).
  defineSyntheticTable({
    table: "categories.history_label_mappings",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          label_hash: createHash("sha256").update(`${household.id}/label/${i}`).digest("hex"),
          category_id: i % 2 === 0 ? key(household.id, "category", 0) : null,
          confirmed_by: key(household.id, "member", 0),
          confirmed_at: "2026-11-27T10:00:00Z",
        };
    },
  }),
];
