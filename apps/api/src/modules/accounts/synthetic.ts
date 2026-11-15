// Synthetic accounts (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Tables load in name order (account_owners, accounts, idempotency_keys, jobs, outbox_events, subaccounts) in one
// transaction; the keys to `accounts` are checked at commit. Row n of every table belongs to account n, so each account
// has one subaccount and one owner with 100 %, and its hand-off job is done (ARC-04). Numbers are only last-4 codes;
// nothing is sealed. The module publishes no events: outbox_events gets one dispatched row for the isolation check.
import { createHash } from "node:crypto";
import { defineSyntheticTable } from "@willowsum/synthetic";

function key(householdId: string, table: string, n: number): string {
  const h = createHash("sha256").update(`${householdId}/${table}/${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const synthetic = [
  defineSyntheticTable({
    table: "accounts.account_owners",
    perHousehold: 3,
    *rows({ household, rng, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          account_id: key(household.id, "account", i),
          owner_account_id: rng.uuid(),
          share: "100",
          valid_from: "2026-01-01",
          valid_to: null,
        };
    },
  }),
  defineSyntheticTable({
    table: "accounts.accounts",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "account", i),
          kind: "current",
          name: `Синтетичний рахунок ${i + 1}`,
          institution_name: "Синтетичний банк",
          institution_country: "UA",
          institution_key: "UA|синтетичний банк",
          number_last4: String(1000 + i),
          number_sealed: null,
          note: null,
          annual_rate: null,
          deposit_opened_on: null,
          deposit_matures_on: null,
          opened_on: "2026-01-01",
          status: "active",
          closed_on: null,
          source: "manual",
        };
    },
  }),
  defineSyntheticTable({
    table: "accounts.idempotency_keys",
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
    table: "accounts.jobs",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "job", i),
          name: "accounts.hand-off",
          dedupe_key: `credit-kind:${key(household.id, "account", i)}:${key(household.id, "change", i)}`,
          payload: JSON.stringify({
            kind: "credit-kind",
            accountId: key(household.id, "account", i),
            actorAccountId: key(household.id, "actor", i),
          }),
          heavy: "false",
          state: "done",
          attempts: "1",
          finished_at: "2026-06-30T10:00:02Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "accounts.outbox_events",
    perHousehold: 1,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "event", i),
          event_name: "accounts.synthetic-event",
          event_version: "1",
          payload: JSON.stringify({ accountId: key(household.id, "account", i) }),
          traceparent: null,
          dispatched_at: "2026-06-30T10:00:01Z",
        };
    },
  }),
  defineSyntheticTable({
    table: "accounts.subaccounts",
    perHousehold: 3,
    *rows({ household, count }) {
      for (let i = 0; i < count; i++)
        yield {
          household_id: household.id,
          id: key(household.id, "subaccount", i),
          account_id: key(household.id, "account", i),
          currency: "EUR",
          position: "0",
          ledger_account_id: key(household.id, "ledger-account", i),
          balance_date: "2026-01-01",
        };
    },
  }),
];
