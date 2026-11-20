-- IMP-04@PoC FR 8, IMP-16@PoC FR 1–5, FR 9 (wave 2 row 44): «Відкотити» an applied import batch.
--
-- Nothing is deleted. `rolled_back_at`: the transaction was rolled back with its batch — hidden, its journal event
-- reversed by its hand-off (a reversal entry, never a deletion), out of every list, the budget and the reports; the row
-- stays for the batch's history. `listed_hidden` is what the list «Транзакції» filters by («Стан: приховані»): a
-- rolled-back row is in neither the shown nor the hidden ones.
-- `import_rollbacks`: one row per batch rolled back, written in the same transaction as the rows: a retried or
-- concurrent rollback finds it and changes nothing (`counts` — numbers only; `kept` — the ids of the transactions kept
-- because the person changed them, at most 200, never row text).
--
-- Expand only: a nullable column, a generated column and a new table the previous code never reads or writes; the
-- previous code lists rows by `hidden` as before (a rolled-back row is hidden there).
ALTER TABLE transactions ADD COLUMN rolled_back_at timestamptz;
ALTER TABLE transactions ADD COLUMN listed_hidden boolean
  GENERATED ALWAYS AS (CASE WHEN rolled_back_at IS NULL THEN hidden END) STORED;

CREATE TABLE import_rollbacks (
  household_id uuid NOT NULL,
  -- The batch of module import-sessions (no foreign key across schemas).
  import_batch_id uuid NOT NULL,
  -- The mode of the first request: a crash before module import-sessions recorded it is finished with this one.
  mode text NOT NULL CHECK (mode IN ('keep-changed', 'all')),
  counts jsonb NOT NULL CHECK (jsonb_typeof(counts) = 'object'),
  kept uuid[] NOT NULL CHECK (cardinality(kept) <= 200),
  rolled_back_by uuid NOT NULL,
  rolled_back_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, import_batch_id)
);

-- Module import-sessions' daily recovery lists the rollbacks of the last days (a request that ended before it marked
-- its batch «відкочено» is finished with this record).
CREATE INDEX import_rollbacks_by_time ON import_rollbacks (household_id, rolled_back_at);
