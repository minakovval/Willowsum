-- Import batches of a space (IMP-01@PoC FR 1, FR 3, FR 6, FR 7, FR 10, FR 13; IMP-19@PoC FR 5; wave 2 row 39).
-- A batch is created by the Owner (its name optional) and takes files; each accepted file's original is stored by the
-- `file-storage` module, here only by its opaque id (no foreign key across schemas). A rejected file keeps its name and
-- the reason's code, never its bytes. `last_action_at` is the last action with the batch (FR 20: 30 days without one
-- delete an unapplied batch). Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE batches (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  name text CHECK (char_length(name) BETWEEN 1 AND 120),
  state text NOT NULL DEFAULT 'uploaded' CHECK (
    state IN ('uploaded', 'processing', 'parsed', 'needs-review', 'failed', 'applied', 'rolled-back', 'cancelled')
  ),
  created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id)
);
CREATE INDEX batches_recent ON batches (household_id, created_at DESC, id DESC);

CREATE TABLE batch_files (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  batch_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 1000),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  -- Accepted: the original in file-storage, its format and size. Rejected: the reason's code only.
  file_id uuid,
  format text CHECK (format IN ('csv', 'tsv', 'xlsx', 'xls')),
  size_bytes bigint CHECK (size_bytes > 0),
  rejection_code text CHECK (rejection_code ~ '^[A-Z][A-Z_]{2,39}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, batch_id, position),
  -- Checked at commit: a load of whole tables in name order (the synthetic data) writes this table before batches.
  FOREIGN KEY (household_id, batch_id) REFERENCES batches (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (file_id IS NOT NULL AND format IS NOT NULL AND size_bytes IS NOT NULL AND rejection_code IS NULL)
    OR (file_id IS NULL AND format IS NULL AND size_bytes IS NULL AND rejection_code IS NOT NULL)
  )
);
