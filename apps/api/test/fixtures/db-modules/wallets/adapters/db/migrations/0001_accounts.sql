-- NFR-10 acceptance 1 (test/telemetry-db.it.test.ts): an account table whose constraints a request can break.
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  name text NOT NULL,
  balance_amount numeric(38, 18) NOT NULL,
  balance_currency text NOT NULL,
  CONSTRAINT accounts_household_name_key UNIQUE (household_id, name),
  CONSTRAINT accounts_balance_not_negative CHECK (balance_amount >= 0)
);
