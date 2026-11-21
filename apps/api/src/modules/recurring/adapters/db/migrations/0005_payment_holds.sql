-- «Призупинити», «Позначити скасованим» and «Відновити» of a regular payment (BUD-07@PoC FR 13; wave 2 row 26 — part
-- b2). A hold is a span of the payment's schedule: a charge of it without a payment is not shown, is no miss and is not
-- in «Можна витратити»; a paid one stays. Only the user's decision is stored; the charges stay projections (FR 17).
-- Row-level security on household_id is added by the migration runner (ARC-03 FR 2). Old code does not read this table.
CREATE TABLE payment_holds (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  payment_id uuid NOT NULL,
  -- `pause` — «Призупинити» (to a date, or open until «Відновити»); `cancel` — «Позначити скасованим» (a mark in the app
  -- only: the product never cancels anything at the provider), from the first day of its month, open until «Відновити».
  kind text NOT NULL CHECK (kind IN ('pause', 'cancel')),
  starts_on date NOT NULL,
  -- The last day held, included; null — open.
  ends_on date CHECK (ends_on IS NULL OR ends_on >= starts_on),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- Checked at commit (DEFERRABLE): rows of one transaction may come in any order (the synthetic loader, ARC-03 FR 6).
  FOREIGN KEY (household_id, payment_id) REFERENCES payments (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX payment_holds_by_payment ON payment_holds (household_id, payment_id, starts_on);
