// Synthetic journal (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Tables load in name order (accounts, balance_versions, conversions, daily_balances, entries, jobs, outbox_events,
// postings), in one transaction (a rate's key to its entry is checked at commit). The keys between them are derived
// from the space and the row number, so posting n and rate n belong to entry n, and a posting moves money from
// account 2 to account 1. A run needs at least two accounts and no more postings or rates than entries (the defaults
// below). The balance cache covers only account 3, which has no postings: its cached totals are zero, so
// the cache agrees with the postings (the daily integrity check); the other accounts are answered from the postings
// until the rebuild command caches them.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "ledger.accounts",
    perHousehold: 4,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "account", i),
          type: "asset",
          currency: "EUR",
          owner_module: "accounts",
          owner_id: rng.uuid(),
          service_kind: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "ledger.balance_versions",
    perHousehold: 1,
    maxPerHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          account_id: key(household.id, "account", 2 + i),
          version: "1",
          last_recorded_at: null,
        };
    },
  }),
  // The rate of a cross-currency entry (FIN-04 EC1, migrations/0007_conversions.sql) on the first entries: 1 EUR =
  // 1.08 USD, a synthetic source; their EUR postings are among the rate's currencies, as the commit check asks.
  defineSyntheticTable({
    table: "ledger.conversions",
    perHousehold: 10,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          entry_id: key(household.id, "entry", i),
          seq: "1",
          currency: "EUR",
          amount: "10",
          entry_currency: "USD",
          entry_amount: "10.9",
          rate: "1.08",
          rate_date: "2026-01-01",
          rate_source: "synthetic",
          converted: "10.8",
        };
    },
  }),
  defineSyntheticTable({
    table: "ledger.daily_balances",
    perHousehold: 10,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          account_id: key(household.id, "account", 2),
          day: `2026-01-${String(i + 1).padStart(2, "0")}`,
          currency: "EUR",
          debits: "0",
          credits: "0",
        };
    },
  }),
  defineSyntheticTable({
    table: "ledger.entries",
    perHousehold: 100,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "entry", i),
          source_module: "transactions",
          source_id: rng.uuid(),
          event_type: "transfer",
          operation_date: `2026-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
          rules_version: "1",
          idempotency_key: `synthetic-${i}`,
          reverses_entry_id: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "ledger.postings",
    perHousehold: 100,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          entry_id: key(household.id, "entry", i),
          seq: "1",
          debit_account_id: key(household.id, "account", 0),
          credit_account_id: key(household.id, "account", 1),
          amount: `${rng.int(1, 5000)}.${String(rng.int(0, 99)).padStart(2, "0")}`,
          currency: "EUR",
        };
    },
  }),
  // The queue (ARC-04, migrations/0004_outbox.sql): one «проводку записано» event per entry, dispatched; the ledger
  // runs no jobs yet, so a few finished ones only show that the table is covered. Identifiers and codes only.
  defineSyntheticTable({
    table: "ledger.outbox_events",
    perHousehold: 100,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "event", i),
          event_name: "ledger.entry-recorded",
          event_version: "1",
          payload: JSON.stringify({
            entryId: key(household.id, "entry", i),
            sourceModule: "transactions",
            sourceId: rng.uuid(),
            eventType: "transfer",
            operationDate: "2026-06-30",
            recordedAt: "2026-06-30T10:00:00.000000Z",
            reversesEntryId: null,
          }),
          traceparent: null,
          dispatched_at: "2026-06-30T10:00:01Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "ledger.jobs",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "job", i),
          name: "ledger.synthetic-job",
          dedupe_key: key(household.id, "event", i),
          payload: JSON.stringify({ entryId: key(household.id, "entry", i) }),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-06-30T10:00:02Z",
        };
    },
  }),
];
