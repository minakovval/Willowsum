-- IMP-04@PoC a) (wave 2 row 43): the same file and the idempotent apply (FR 3, FR 7).
--
-- `batch_files.content_sha256`: the SHA-256 of an accepted file's bytes (file-storage computes it when it stores the
-- original), hex. A file is «the same file» as another of the space when their contents are equal byte for byte,
-- whatever its name or batch (FR 3); the index finds an applied one with the same content.
-- `batch_applications`: the stored result of applying a batch, one per batch (FR 7: applying it again returns this
-- result and creates nothing); it goes with its batch (ON DELETE CASCADE).
-- Expand only: a nullable column, a partial index and a new table; earlier code inserts files with the column null and
-- never reads the table. Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
ALTER TABLE batch_files ADD COLUMN content_sha256 text CHECK (content_sha256 ~ '^[0-9a-f]{64}$');
CREATE INDEX batch_files_by_content ON batch_files (household_id, content_sha256) WHERE content_sha256 IS NOT NULL;

CREATE TABLE batch_applications (
  household_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  -- Counts of the rows by outcome (duplicate-matching `ROW_OUTCOMES`) and what the apply step adds; never row text.
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, batch_id),
  -- Checked at commit: a load of whole tables in name order (the synthetic data) writes this table before batches.
  FOREIGN KEY (household_id, batch_id) REFERENCES batches (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
