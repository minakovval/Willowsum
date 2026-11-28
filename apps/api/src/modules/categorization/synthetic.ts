// Synthetic categories of transactions (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real
// data. Each row refers to opaque (synthetic) ids of a transaction and a category of the space; half are «вручну»,
// one is «Без категорії» (a null category with the source «none»); two category rules (BUD-14 b). Every hand-off job (the audit entry, ARC-04) is done;
// the module publishes no events: outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const SOURCES = ["manual", "bank", "none", "dictionary"] as const;

export const synthetic = [
  defineSyntheticTable({
    table: "categorization.transaction_categories",
    perHousehold: 4,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const source = SOURCES[i % SOURCES.length]!;
        yield {
          household_id: household.id,
          transaction_id: rng.uuid(),
          category_id: source === "none" ? null : rng.uuid(),
          source,
          version: String(1 + (i % 2)),
        };
      }
    },
  }),
  defineSyntheticTable({
    // BUD-14 b: two category rules per space, positions 1 and 2; the second is off.
    table: "categorization.rules",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const value = `Synth merchant ${i + 1}`;
        yield {
          household_id: household.id,
          id: rng.uuid(),
          position: String(i + 1),
          conditions: JSON.stringify([{ field: "merchant", operator: "contains", value }]),
          account_ids: "{}",
          category_id: rng.uuid(),
          enabled: i === 0 ? "true" : "false",
          condition_key: JSON.stringify([[`merchant:contains:${value.toLowerCase()}`], []]),
          version: "1",
        };
      }
    },
  }),
  defineSyntheticTable({
    // BUD-14 b2: one completed run of «Застосувати до N наявних…» per space over 3 synthetic transactions.
    table: "categorization.rule_runs",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "rule-run", i),
          rule_id: key(household.id, "rule", i),
          actor_account_id: key(household.id, "actor", 0),
          undo_actor_account_id: null,
          category_id: key(household.id, "category", i),
          tags: "{синтетичний}",
          status: "completed",
          truncated: "false",
          item_count: "3",
          created_at: "2026-10-30T10:00:00Z",
          ended_at: "2026-10-30T10:00:01Z",
          undone_at: null,
        };
    },
  }),
  defineSyntheticTable({
    // The run's records: two changed (category and tags), the third left as set by hand.
    table: "categorization.rule_run_items",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++) {
        const changed = i % 3 !== 2;
        yield {
          household_id: household.id,
          run_id: key(household.id, "rule-run", 0),
          ordinal: String(i + 1),
          transaction_id: key(household.id, "transaction", i),
          result: changed ? "changed" : "manual",
          category_changed: changed ? "true" : "false",
          before_category_id: null,
          before_source: changed ? "none" : null,
          before_rule_id: null,
          after_version: changed ? "1" : null,
          tags_changed: changed ? "true" : "false",
          tags_before: changed ? "{}" : null,
          tags_after: changed ? "{синтетичний}" : null,
          before_tag_rule_id: null,
          undo_result: null,
        };
      }
    },
  }),
  defineSyntheticTable({
    // BUD-21 c: one completed derivation of rules from a synthetic history file per space.
    table: "categorization.history_derivations",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "history-derivation", i),
          batch_id: key(household.id, "history-batch", i),
          actor_account_id: key(household.id, "actor", 0),
          status: "completed",
          row_count: "6",
          processed: "6",
          created_at: "2026-10-30T10:00:00Z",
          ended_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
  defineSyntheticTable({
    // Its suggestions: «Мерчант дорівнює Синтетичний магазин» (5 of 6 rows) and «Опис містить синтетика».
    table: "categorization.history_suggestions",
    perHousehold: 2,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          derivation_id: key(household.id, "history-derivation", 0),
          ordinal: String(i + 1),
          kind: "confident",
          conditions: JSON.stringify([
            i === 0
              ? { field: "merchant", operator: "equals", value: "Синтетичний магазин" }
              : { field: "description", operator: "contains", value: "синтетика" },
          ]),
          category_id: key(household.id, "category", i),
          matched: i === 0 ? "6" : "3",
          agreeing: i === 0 ? "5" : "3",
          since: null,
          tags: "{}",
          evidence_rows: i === 0 ? "{1,2,3,4,5}" : "{7,8,9}",
          exception_rows: i === 0 ? "{6}" : "{}",
        };
    },
  }),
  defineSyntheticTable({
    // BUD-21 e: one rejected suggestion per space — «Опис містить синтетика» → its second category.
    table: "categorization.history_rejections",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          condition_key: JSON.stringify([["description:contains:синтетика"], []]),
          category_id: key(household.id, "category", 1),
          actor_account_id: key(household.id, "actor", 0),
          created_at: "2026-10-30T10:00:02Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "categorization.jobs",
    perHousehold: 2,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const transactionId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "categorization.hand-off",
          dedupe_key: `set:${transactionId}:1`,
          payload: JSON.stringify({
            transactionId,
            actorAccountId: rng.uuid(),
            version: 1,
            before: { categoryId: null, source: "none" },
            after: { categoryId: rng.uuid(), source: "manual" },
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
    table: "categorization.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "categorization.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ transactionId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
