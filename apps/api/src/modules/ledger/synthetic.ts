// Synthetic journal (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Tables load in name order (accounts, entries, postings); the keys between them are derived from the space and the
// row number, so posting n belongs to entry n and moves money from account 2 to account 1. A run needs at least two
// accounts and no more postings than entries (the defaults below).
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
];
