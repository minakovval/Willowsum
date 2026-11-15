// Synthetic transactions (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Row n points to the synthetic account n of the accounts module (same derived ids); its journal event is not
// generated here (the ledger's own synthetic entries stand for the journal). Every transaction's hand-off job is done
// (ARC-04); the module publishes no events: outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "transactions.transactions",
    perHousehold: 20,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          account_id: key(household.id, "account", i % 3),
          subaccount_id: key(household.id, "subaccount", i % 3),
          amount: i % 4 === 0 ? `${1000 + i}.00` : `-${10 + i}.50`,
          currency: "EUR",
          occurred_on: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
          counterparty: `Синтетичний контрагент ${(i % 5) + 1}`,
          description: null,
          status: "posted",
          source: "manual",
          version: "1",
        };
    },
  }),
  defineSyntheticTable({
    table: "transactions.idempotency_keys",
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
  defineSyntheticTable({
    table: "transactions.jobs",
    perHousehold: 3,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++) {
        const transactionId = rng.uuid();
        yield {
          household_id: household.id,
          id: rng.uuid(),
          name: "transactions.hand-off",
          dedupe_key: `create:${transactionId}:1`,
          payload: JSON.stringify({
            transactionId,
            actorAccountId: key(household.id, "actor", i),
            action: "create",
            version: 1,
            audit: [{ field: "amount", before: null, after: `-${10 + i}.5`, sensitive: false }],
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
    table: "transactions.outbox_events",
    perHousehold: 1,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: rng.uuid(),
          event_name: "transactions.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ transactionId: rng.uuid() }),
          traceparent: null,
          dispatched_at: "2026-10-30T10:00:01Z",
        };
    },
  }),
];
