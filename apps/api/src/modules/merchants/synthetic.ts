// Synthetic merchants (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data. Each space gets
// merchants born from synthetic descriptions; one joined another («Об'єднати з…»), one is an intermediary
// («посередник»). Every hand-off job (the audit entry, ARC-04) is done; the module publishes no events: outbox_events
// gets one dispatched row for the isolation check.
import { defineSyntheticTable } from "@willowsum/synthetic";

const NAMES = ["Синтетичний маркет", "Кав'ярня Синтетика", "Синтетик Кава", "PayPal"] as const;

export const synthetic = [
  defineSyntheticTable({
    table: "merchants.merchants",
    perHousehold: NAMES.length,
    *rows({ household, rng, count }) {
      const ids = NAMES.map(() => rng.uuid());
      for (let i = 0; i < count; i++) {
        const name = NAMES[i % NAMES.length]!;
        yield {
          household_id: household.id,
          id: ids[i]!,
          match_key: name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "),
          name,
          intermediary: String(name === "PayPal"),
          // «Синтетик Кава» joined «Кав'ярня Синтетика».
          merged_into: i === 2 ? ids[1]! : null,
          version: String(i === 2 ? 2 : 1),
        };
      }
    },
  }),
  defineSyntheticTable({
    table: "merchants.jobs",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const merchantId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "merchants.hand-off",
          dedupe_key: `set:${merchantId}:2`,
          payload: JSON.stringify({
            merchantId,
            actorAccountId: rng.uuid(),
            version: 2,
            change: "merge",
            mergedInto: { before: null, after: rng.uuid() },
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
    table: "merchants.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "merchants.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ merchantId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
