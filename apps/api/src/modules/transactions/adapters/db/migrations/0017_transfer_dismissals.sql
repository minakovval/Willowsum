-- IMP-03@PoC b) (wave 2 row 48): «Не пара» of a proposed transfer (FR 12) — the pair is never proposed again, even after
-- «Роз'єднати». Stored as (outflow, inflow): the debit and the credit of the pair, as module transfer-matching reads
-- the candidates (the search leaves these out); gone with either transaction.
-- Expand only: a new table; earlier code never reads or writes it (it proposes such a pair again, nothing else).
CREATE TABLE transfer_dismissals (
  household_id uuid NOT NULL,
  outflow_id uuid NOT NULL,
  inflow_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, outflow_id, inflow_id),
  CHECK (outflow_id <> inflow_id),
  FOREIGN KEY (household_id, outflow_id) REFERENCES transactions (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, inflow_id) REFERENCES transactions (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX transfer_dismissals_by_inflow ON transfer_dismissals (household_id, inflow_id);
