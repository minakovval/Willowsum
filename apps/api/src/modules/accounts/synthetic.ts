// Synthetic accounts (ARC-03 FR 6) for tests and staging; loaded by tools/synthetic. Never real data.
// Tables load in name order (account_owners, accounts, idempotency_keys, subaccounts) in one transaction; the keys to
// `accounts` are checked at commit. Row n of every table belongs to account n, so each account has one subaccount and
// one owner with 100 %. Numbers are only last-4 codes; nothing is sealed.
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
