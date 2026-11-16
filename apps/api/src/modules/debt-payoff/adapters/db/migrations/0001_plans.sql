-- Saved debt payoff plans of a space (BUD-19@PoC FR 5, AC6; wave 2 row 33): «Зберегти план» keeps the scenario's
-- assumptions and its result, one plan per debt (saving again replaces it). The debt is a credit card or a loan of the
-- `accounts` module, by its opaque id (no foreign key across schemas); the liability's own terms are never written. Every
-- amount is in the plan's currency — the debt's. Row-level security on household_id is added by the migration runner
-- (ARC-03 FR 2).
CREATE TABLE plans (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  -- The month it was saved in (YYYY-MM): its month 1 is the next one, and the one-offs and the payoff month count from it.
  start_month text NOT NULL CHECK (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- The assumptions (FR 2, FR 4): balance, rate (percent a year), regular and extra monthly payment, one-off payments
  -- ([{ "month": "YYYY-MM", "amount": "<decimal>" }], at most 24).
  balance numeric(38, 18) NOT NULL CHECK (balance >= 0),
  annual_rate numeric(38, 18) NOT NULL CHECK (annual_rate >= 0 AND annual_rate <= 100),
  monthly_payment numeric(38, 18) NOT NULL CHECK (monthly_payment > 0),
  extra_monthly numeric(38, 18) NOT NULL CHECK (extra_monthly >= 0),
  one_offs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(one_offs) = 'array' AND jsonb_array_length(one_offs) <= 24),
  -- The result (FR 3): months to pay off, the interest over the whole term and the payoff month.
  months integer NOT NULL CHECK (months BETWEEN 0 AND 1200),
  total_interest numeric(38, 18) NOT NULL CHECK (total_interest >= 0),
  payoff_month text NOT NULL CHECK (payoff_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- «Додати до запланованих витрат» (FR 5): the extra payment is a planned expense up to the payoff month.
  add_to_planned_expenses boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, account_id)
);
