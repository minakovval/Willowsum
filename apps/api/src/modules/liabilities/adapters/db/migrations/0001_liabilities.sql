-- Liabilities (FIN-01@PoC FR 2, FR 16; «зобов'язання — першокласна сутність»): the terms of a loan («Кредит») and of a
-- credit card, one row per account of the `accounts` module (by its opaque id; no foreign key across schemas). The
-- debt is the account's ledger balance, a time series in the journal; the owners and their shares are the account's.
-- Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE liabilities (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loan', 'credit-card')),
  -- Every amount of the terms is in the account's currency.
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  -- Percent per year, 0–100 with at most two decimals (FIN-01 FR 3).
  annual_rate numeric(38, 18) CHECK (annual_rate BETWEEN 0 AND 100 AND annual_rate = round(annual_rate, 2)),
  monthly_payment numeric(38, 18) CHECK (monthly_payment > 0),
  credit_limit numeric(38, 18) CHECK (credit_limit >= 0),
  grace_period_days integer CHECK (grace_period_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, account_id),
  -- A loan has its rate and monthly payment (FIN-01 FR 5) and no grace period; a card has no monthly payment.
  CHECK (kind <> 'loan' OR (annual_rate IS NOT NULL AND monthly_payment IS NOT NULL AND grace_period_days IS NULL)),
  CHECK (kind <> 'credit-card' OR monthly_payment IS NULL)
);
