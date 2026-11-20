-- The parse step of a batch's files (IMP-01@PoC FR 5, FR 6, FR 9, FR 10; IMP-19@PoC FR 4, FR 5; wave 2, the gap row
-- before rows 44–46). One row per accepted file of the batch: what the parse was asked with (the chosen recipe and
-- account, or none — the recipe is then matched by the file's format fingerprint), its state and, once parsed, the
-- parsed rows for the review and the apply step.
-- `rows_sealed` is the parse (the reading, the engine's analysis with its cell examples, the rows as events) sealed with
-- the space's key (household `SpaceKeys.sealBytes`, purpose `parse:<parse_id>`), as file-storage seals originals: the
-- rows are financial data and never stored in the clear. The checks go to `file_checks` (masked values only).
-- `refusal_code` is the reason a file could not be parsed (a code, never a value of the file).
-- A re-parse replaces the row with a new `parse_id`; a job of an older parse finds another id and does nothing.
-- Additive: the code before this migration never reads or writes this table. It goes with its file's batch (ON DELETE
-- CASCADE), so «Видалити» and the daily cleanup remove it too. Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).
CREATE TABLE file_parses (
  household_id uuid NOT NULL,
  batch_file_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  parse_id uuid NOT NULL,
  -- The recipe asked for (null: matched by the format, or none); the recipe the parse used (FR 9).
  recipe_id uuid,
  used_recipe_id uuid,
  -- IMP-06 FR 6: whether the file's format fingerprint matched the recipe's.
  recipe_format text CHECK (recipe_format IN ('match', 'changed', 'unknown')),
  account_id uuid,
  state text NOT NULL CHECK (state IN ('pending', 'parsed', 'failed')),
  refusal_code text CHECK (refusal_code ~ '^[A-Z][A-Z_]{1,39}$'),
  engine_version text NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 16),
  rows_sealed bytea CHECK (octet_length(rows_sealed) <= 33554432),
  row_count integer CHECK (row_count >= 0),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  parsed_at timestamptz,
  PRIMARY KEY (household_id, batch_file_id),
  CHECK ((state = 'failed') = (refusal_code IS NOT NULL)),
  CHECK ((state = 'parsed') = (rows_sealed IS NOT NULL)),
  -- The file of this batch, never another batch's. Checked at commit, like file_checks (a load in name order).
  FOREIGN KEY (household_id, batch_id, batch_file_id) REFERENCES batch_files (household_id, batch_id, id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX file_parses_batch ON file_parses (household_id, batch_id);
