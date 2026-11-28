-- BUD-21@PoC c) (wave 2 row 235): the derivation of category rules from a confirmed history file (FR 10–15, FR 17).
--
-- Expand only: new tables; earlier code never reads them. Row-level security on household_id is added by the migration
-- runner (ARC-03 FR 2).

-- FR 10, EC10: a run of the derivation over a history batch of module import-sessions (by id) — who started it, its
-- state and «оброблено X з N рядків». One running derivation per batch: a second start shows the first one's progress.
-- `failed` — the batch's rows were gone (deleted or never confirmed) when the run took them.
CREATE TABLE history_derivations (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  batch_id uuid NOT NULL,
  actor_account_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  row_count integer NOT NULL CHECK (row_count >= 0),
  processed integer NOT NULL DEFAULT 0 CHECK (processed >= 0 AND processed <= row_count),
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  PRIMARY KEY (household_id, id)
);
CREATE UNIQUE INDEX history_derivations_one_running ON history_derivations (household_id, batch_id)
  WHERE status = 'running';
CREATE INDEX history_derivations_batch ON history_derivations (household_id, batch_id, created_at DESC);

-- FR 11–15, FR 17: the suggestions of a completed derivation in their order — conditions (the editor's fields), the
-- category, N and how many agree, the date of a change of habit, the tags, and the file's rows (row numbers only) that
-- are the evidence and the exceptions. No row of the file is kept here: dates, amounts and descriptions stay sealed
-- in module import-sessions and go with the batch.
CREATE TABLE history_suggestions (
  household_id uuid NOT NULL,
  derivation_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  kind text NOT NULL CHECK (kind IN ('confident', 'conflicting')),
  conditions jsonb NOT NULL,
  category_id uuid NOT NULL,
  matched integer NOT NULL CHECK (matched >= 1),
  agreeing integer NOT NULL CHECK (agreeing >= 1 AND agreeing <= matched),
  since date,
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  evidence_rows integer[] NOT NULL,
  exception_rows integer[] NOT NULL,
  PRIMARY KEY (household_id, derivation_id, ordinal),
  -- Deferred: the synthetic loader (tools/synthetic) writes tables by name, the suggestions before their derivation.
  FOREIGN KEY (household_id, derivation_id) REFERENCES history_derivations (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
