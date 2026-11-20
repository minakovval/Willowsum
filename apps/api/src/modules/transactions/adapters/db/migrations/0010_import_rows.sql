-- ws:contract 0009_imported.sql both new checks hold for every row the previous code writes: it never sets import_file_id, import_row or bank_description (new and null there)
-- IMP-01@PoC FR 11, IMP-04@PoC FR 7, AC9 (the apply step, part a; #637 items 1 and 5): what keeps one apply of a batch
-- from writing twice, whatever retries, crashes or concurrent requests come.
--
-- `import_file_id` and `import_row` name the batch file of module import-sessions and its row (from 1) an imported
-- transaction came from; with `import_batch_id` they are one row of one file of one batch: the unique index refuses a
-- second write of the same row. `bank_description` keeps the bank's text as the statement printed it (masked), apart
-- from the user-editable `description`, so the duplicate key of a later import still sees the bank's text after an
-- edit (#637 comment item 5).
-- `import_writes`: one row per batch written, in the same transaction as its transactions: a retried or concurrent
-- write finds it and writes nothing (`counts` — the plan's counts by outcome, numbers only, never row text).
--
-- Expand only for the previous code: nullable columns, a partial unique index on rows it never writes, a new table.
ALTER TABLE transactions ADD COLUMN import_file_id uuid;
ALTER TABLE transactions ADD COLUMN import_row integer;
ALTER TABLE transactions ADD COLUMN bank_description text;
ALTER TABLE transactions ADD CONSTRAINT transactions_import_row_check
  CHECK ((import_file_id IS NULL) = (import_row IS NULL)
         AND (import_file_id IS NULL OR (import_batch_id IS NOT NULL AND import_row >= 1)));
ALTER TABLE transactions ADD CONSTRAINT transactions_bank_description_check
  CHECK (char_length(bank_description) BETWEEN 1 AND 1000);
CREATE UNIQUE INDEX transactions_import_row
  ON transactions (household_id, import_batch_id, import_file_id, import_row) WHERE import_file_id IS NOT NULL;

CREATE TABLE import_writes (
  household_id uuid NOT NULL,
  -- The batch of module import-sessions (no foreign key across schemas).
  import_batch_id uuid NOT NULL,
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  written_by uuid NOT NULL,
  written_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, import_batch_id)
);
