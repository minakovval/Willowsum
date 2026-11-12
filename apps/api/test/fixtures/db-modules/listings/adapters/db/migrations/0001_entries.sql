-- DAT-01@PoC (test/dat01-list.it.test.ts): a list table with amounts in several currencies, the bank's own rate
-- (never used by the totals) and JSONB type attributes. The migration runner puts it under the household policy.
CREATE TABLE entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  booked_on date NOT NULL,
  amount numeric(38, 18) NOT NULL,
  currency text NOT NULL,
  bank_rate numeric(38, 18),
  description text NOT NULL DEFAULT '',
  attributes jsonb NOT NULL DEFAULT '{}'
);
