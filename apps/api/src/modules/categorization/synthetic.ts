// Synthetic categories of transactions (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real
// data. Each row refers to opaque (synthetic) ids of a transaction and a category of the space; half are «вручну»,
// one is «Без категорії» (a null category with the source «none»); two category rules (BUD-14 b). Every hand-off job (the audit entry, ARC-04) is done;
// the module publishes no events: outbox_events gets one dispatched row for the isolation check.
import { defineSyntheticTable } from "@willowsum/synthetic";

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
