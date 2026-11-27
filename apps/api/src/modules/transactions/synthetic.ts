// Synthetic transactions (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Row n points to the synthetic account n of the accounts module (same derived ids); its journal event is not
// generated here (the ledger's own synthetic entries stand for the journal). Transaction 0 is split «За категоріями»
// into two parts (transaction_parts loads first; its key to the row is checked at commit). Every transaction's hand-off job is done
// (ARC-04); the module publishes no events: outbox_events gets one dispatched row for the isolation check. One transfer
// pairs the outflow −11,50 € (transaction 1) with the inflow 1 000,00 € (transaction 0); its key to the rows is checked
// at commit, and the rows do not point back at it (the column is nullable). Transactions 1 and 2 are «Не дубль».
// Transaction 2 has a note and the two synthetic tags (BUD-13); transaction 3 is «Одноразова витрата» (BUD-06).
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
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "transaction", i),
          account_id: key(household.id, "account", i % 3),
          subaccount_id: key(household.id, "subaccount", i % 3),
          amount: i % 4 === 0 ? `${1000 + i}.00` : `-${10 + i}.50`,
          currency: "EUR",
          occurred_on: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`,
          counterparty: `Синтетичний контрагент ${(i % 5) + 1}`,
          description: null,
          status: i % 7 === 3 ? "pending" : "posted",
          source: "manual",
          hidden: i === 5 ? "true" : "false",
          split_mode: i === 0 ? "categories" : null,
          split_needs_review: "false",
          // BUD-13 FR 1, FR 2: transaction 2 has a note and both synthetic tags.
          note: i === 2 ? "Синтетична нотатка" : null,
          tag_ids: i === 2 ? `{${key(household.id, "tag", 0)},${key(household.id, "tag", 1)}}` : "{}",
          // BUD-06 FR 8: transaction 3 (an expense) is marked «Одноразова витрата».
          one_off: i === 3 ? "true" : "false",
          version: "1",
        };
    },
  }),
  defineSyntheticTable({
    table: "transactions.tags",
    perHousehold: 2,
    // The tags transaction 2 carries; another would be a tag no transaction has (allowed, but not needed).
    maxPerHousehold: 2,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "tag", i),
          name: `Синтетичний тег ${i + 1}`,
          name_key: `синтетичний тег ${i + 1}`,
          version: "1",
        };
    },
  }),
  defineSyntheticTable({
    table: "transactions.transaction_parts",
    perHousehold: 2,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          transaction_id: key(household.id, "transaction", 0),
          position: String(i),
          category_id: key(household.id, "category", i),
          month: null,
          amount: i === 0 ? "600.00" : "400.00",
          currency: "EUR",
        };
    },
  }),
  defineSyntheticTable({
    table: "transactions.transfers",
    perHousehold: 1,
    // Its rows point at transactions 1 and 0; another would point at rows the isolation check does not load.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "transfer", i),
          outflow_id: key(household.id, "transaction", 1 + 2 * i),
          inflow_id: key(household.id, "transaction", 4 * i),
          rate: null,
          rate_date: null,
          rate_source: null,
        };
    },
  }),
  // IMP-01 FR 11: the write record of an import batch (counts only; no transaction of it is generated here).
  defineSyntheticTable({
    table: "transactions.import_writes",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          import_batch_id: key(household.id, "batch", i),
          counts: JSON.stringify({ import: 2, duplicate: 1 }),
          written_by: key(household.id, "account", 0),
          written_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  // IMP-01 FR 11 (#654): a given-up attempt of applying another synthetic batch (ids only).
  defineSyntheticTable({
    table: "transactions.import_voids",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          import_batch_id: key(household.id, "batch", 100 + i),
          attempt_id: key(household.id, "attempt", i),
          voided_at: "2026-10-15T10:00:00Z",
        };
    },
  }),
  // IMP-16 FR 3 (wave 2 row 44): the rollback of another synthetic batch (counts and kept ids only, never row text).
  defineSyntheticTable({
    table: "transactions.import_rollbacks",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          import_batch_id: key(household.id, "batch", 200 + i),
          mode: i % 2 === 0 ? "keep-changed" : "all",
          counts: JSON.stringify({ rolledBack: 2, kept: 1, transfers: 0, restored: 0 }),
          kept: `{${key(household.id, "transaction", 1)}}`,
          rolled_back_by: key(household.id, "account", 0),
          rolled_back_at: "2026-10-16T10:00:00Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "transactions.duplicate_dismissals",
    perHousehold: 1,
    // «Не дубль» of transactions 1 and 2 (in the order of their ids); another would point at rows not loaded.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++) {
        const [first, second] = [
          key(household.id, "transaction", 1),
          key(household.id, "transaction", 2),
        ].sort();
        yield { household_id: household.id, first_id: first!, second_id: second! };
      }
    },
  }),
  defineSyntheticTable({
    table: "transactions.transfer_dismissals",
    perHousehold: 1,
    // «Не пара» of transactions 1 and 2; another would point at rows not loaded.
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          outflow_id: key(household.id, "transaction", 1),
          inflow_id: key(household.id, "transaction", 2),
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
