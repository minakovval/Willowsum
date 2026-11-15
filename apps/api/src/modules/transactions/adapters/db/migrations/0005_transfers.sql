-- FIN-03@PoC b) (wave 2 row 16b): transfers between own accounts (FR 7–9, FR 18, FR 27, edge case 1).
--
-- A transfer is two transactions of the space marked as one movement: the debit (outflow) on one account and the
-- credit (inflow) on another. While marked, the journal has one transfer event (source `transactions` / the transfer's
-- id) instead of the two transactions' own events, and in one currency the outflow's own event is the fee (FR 8).
-- Expand only: a new table and a nullable column; earlier code reads and writes the rows as before.
CREATE TABLE transfers (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  outflow_id uuid NOT NULL,
  inflow_id uuid NOT NULL,
  -- Two currencies: 1 unit of the inflow's currency = rate units of the outflow's (the journal's fx-transfer), the
  -- official rate of the transfer's date or the nearest earlier one, with its date and source; null in one currency.
  rate numeric(38, 18) CHECK (rate > 0),
  rate_date date,
  rate_source text CHECK (rate_source ~ '^[A-Za-z][A-Za-z0-9._-]{0,31}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- A transaction is in one transfer at most.
  UNIQUE (household_id, outflow_id),
  UNIQUE (household_id, inflow_id),
  CHECK (outflow_id <> inflow_id),
  CHECK ((rate IS NULL) = (rate_date IS NULL) AND (rate IS NULL) = (rate_source IS NULL)),
  FOREIGN KEY (household_id, outflow_id) REFERENCES transactions (household_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, inflow_id) REFERENCES transactions (household_id, id) DEFERRABLE INITIALLY DEFERRED
);

-- The transfer a transaction is a side of: the «переказ» badge and the «Стан: переказ» filter of the list (FR 22, FR 23).
-- Written with the pair in one transaction and cleared before it is removed (application/transfers.ts); a key to
-- transfers would be an added constraint, which only a later contract step may add (ARC-03 FR 4).
ALTER TABLE transactions ADD COLUMN transfer_id uuid;
ALTER TABLE transactions ADD COLUMN is_transfer boolean GENERATED ALWAYS AS (transfer_id IS NOT NULL) STORED;
CREATE INDEX transactions_by_transfer ON transactions (household_id, transfer_id) WHERE transfer_id IS NOT NULL;
