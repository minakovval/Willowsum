-- The review of a batch's statements (IMP-05@PoC FR 2–4, FR 7, FR 10, FR 11; wave 2 row 42 part 2).
-- `file_checks`: one accepted file's checks from the parse (file-parsers `StatementChecks`: control figures, bounds, the
-- masked other-account evidence, signs, clarifications, flags), the account it is bound to or chosen for (accounts' id,
-- no foreign key across schemas), and the history gap found against the last applied statement of that account (FR 3).
-- Masked values only: IBAN and card numbers are kept as «…» and their last 4 characters.
-- `decisions`: the person's decisions on rows, groups, files and the batch, one per slot; a new decision in a slot
-- replaces the old one until the batch is applied (FR 10).
-- Additive: the code before this migration never reads or writes these tables. Both go with their batch (ON DELETE
-- CASCADE), so «Видалити» and the daily cleanup remove them too. Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).
CREATE TABLE file_checks (
  household_id uuid NOT NULL,
  batch_file_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  account_id uuid,
  account_currency text CHECK (account_currency ~ '^[A-Z0-9]{3,10}$'),
  suggested_account_id uuid,
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'object'),
  history jsonb NOT NULL CHECK (jsonb_typeof(history) = 'object'),
  previous_file_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, batch_file_id),
  -- Checked at commit: a load of whole tables in name order (the synthetic data) writes this table before batch_files.
  FOREIGN KEY (household_id, batch_file_id) REFERENCES batch_files (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX file_checks_batch ON file_checks (household_id, batch_id);
-- FR 3: the previous statement of an account.
CREATE INDEX file_checks_account ON file_checks (household_id, account_id) WHERE account_id IS NOT NULL;

CREATE TABLE decisions (
  household_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  slot text NOT NULL CHECK (slot ~ '^[a-z-]+:[0-9a-z-]+(:[0-9a-z-]+)?$' AND char_length(slot) <= 120),
  -- null: a decision for the whole batch.
  batch_file_id uuid,
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, batch_id, slot),
  FOREIGN KEY (household_id, batch_id) REFERENCES batches (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
