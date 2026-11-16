-- The statuses of a regular payment's charges (BUD-07@PoC FR 8–12, FR 20, FR 21; wave 2 row 26 — part b1). A charge is a
-- projection of the payment's schedule matched to the space's transactions on every read (FR 17); only what the user
-- decides is stored here. Row-level security on household_id is added by the migration runner (ARC-03 FR 2). Old code
-- reads the payments as before: every new column is nullable and has no default it relies on.

-- FR 10 «Залишити»: misses are counted anew from this day.
ALTER TABLE payments ADD COLUMN kept_on date;
-- FR 11: the expected amount the charges have made it (null — the amount set, `expected_amount`). Written when a read
-- finds it changed, with the audit entry of the change from the system.
-- Its currency is the payment's (a charge in another currency changes nothing, FR 12).
ALTER TABLE payments
  ADD COLUMN current_amount numeric(38, 18) CHECK (current_amount IS NULL OR current_amount > 0),
  ADD COLUMN current_currency text CHECK (current_currency IS NULL OR current_currency = expected_currency),
  ADD CHECK ((current_amount IS NULL) = (current_currency IS NULL));

-- FR 21 «Позначити пропущеним» (`skipped`) and FR 20 «Зарахувати за <місяць>» (`settled`, with the user's transaction of
-- module transactions, by its opaque id): one mark per charge, the charge named by its date in the schedule.
CREATE TABLE charge_marks (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  payment_id uuid NOT NULL,
  due_on date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('skipped', 'settled')),
  transaction_id uuid,
  marked_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, payment_id, due_on),
  CHECK ((kind = 'settled') = (transaction_id IS NOT NULL)),
  FOREIGN KEY (household_id, payment_id) REFERENCES payments (household_id, id) ON DELETE CASCADE
);
-- FR 8 «Кожна транзакція оплачує одне списання»: a transaction settles one charge of the space.
CREATE UNIQUE INDEX charge_marks_by_transaction ON charge_marks (household_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
