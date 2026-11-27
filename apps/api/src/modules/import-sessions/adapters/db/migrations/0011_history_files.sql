-- History files with the user's categorisation (BUD-21@PoC FR 1, FR 3–6, FR 24; Рішення ведучого (2026-11-27), BUD-21
-- sweep; wave 2 row 233). A history file is a batch of its own kind: never applied (the statement routes do not find
-- it), not in the history of imports, its original of kind «файл історії» in file-storage. Its one file's parse is here,
-- not in `file_parses`: the roles of the user's own columns (category, subcategory, transfer mark, tags, account) are a
-- part of this parse, never of a recipe.
-- Additive: the code before this migration never writes `kind` (every batch it creates is a statement's by default) and
-- never reads or writes the new table.
ALTER TABLE batches ADD COLUMN kind text NOT NULL DEFAULT 'statement' CHECK (kind IN ('statement', 'history'));

-- `options`: the user's corrections the file was read with (FR 6) — column numbers, roles and formats, never a value
-- of the file. `parse_sealed`: the parse (columns with their examples, the rows as read, the transfer column's values)
-- sealed with the space's key (household `SpaceKeys.sealBytes`, purpose `history:<batch file id><parse id>`), as
-- `file_parses.rows_sealed`. `missing`: what the file lacks for rules (codes). `answers_sealed`: the user's answers at
-- the confirmation (which values mark a transfer, which account a value is) — values of the file, so sealed too
-- (purpose `history-answers:<batch file id><parse id>`). A re-read replaces the row's `parse_id`; a job of an older
-- read finds another id and does nothing. It goes with its file's batch (ON DELETE CASCADE): «Видалити файл» and the
-- daily cleanup remove it. Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE history_parses (
  household_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  batch_file_id uuid NOT NULL,
  parse_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'parsed', 'failed')),
  refusal_code text CHECK (refusal_code ~ '^[A-Z][A-Z_]{1,39}$'),
  engine_version text NOT NULL CHECK (char_length(engine_version) BETWEEN 1 AND 16),
  options jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(options::text) <= 16384),
  parse_sealed bytea CHECK (octet_length(parse_sealed) <= 33554432),
  row_count integer CHECK (row_count >= 0),
  missing text[] NOT NULL DEFAULT '{}' CHECK (cardinality(missing) <= 8),
  answers_sealed bytea CHECK (octet_length(answers_sealed) <= 1048576),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  parsed_at timestamptz,
  confirmed_by uuid,
  confirmed_at timestamptz,
  PRIMARY KEY (household_id, batch_id),
  UNIQUE (household_id, batch_file_id),
  CHECK ((state = 'failed') = (refusal_code IS NOT NULL)),
  CHECK ((state = 'parsed') = (parse_sealed IS NOT NULL)),
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
  CHECK ((confirmed_at IS NULL) = (answers_sealed IS NULL)),
  CHECK (confirmed_at IS NULL OR state = 'parsed'),
  -- The file of this batch, never another batch's. Checked at commit, like file_parses (a load in name order).
  FOREIGN KEY (household_id, batch_id, batch_file_id) REFERENCES batch_files (household_id, batch_id, id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
