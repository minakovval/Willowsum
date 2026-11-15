-- Bulk actions of a space (DAT-03@PoC FR 1, FR 3–11; wave 2 row 17). One action changes up to 500 records of one entity
-- (FR 7, NFR-15 FR 17) through the owning module's public interface; here are the action, its records in the order of
-- the selection, what each became and what «Відмінити» did. Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).
CREATE TABLE actions (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  -- The account that started it: only it sees the report, undoes and resumes (one person per space in PoC).
  actor_id uuid NOT NULL,
  -- `<entity>.<action>` of the handler, e.g. `transactions.add-tags`.
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$' AND char_length(action) <= 128),
  entity text NOT NULL CHECK (entity ~ '^[a-z][a-z0-9-]*$' AND char_length(entity) <= 64),
  -- The handler's parameters as validated (e.g. the category or the tags); erased with the space.
  params jsonb NOT NULL,
  -- FR 6: more than 50 records.
  background boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'undone')),
  -- FR 10: each «Продовжити» starts a new run over the records still pending.
  run integer NOT NULL DEFAULT 1 CHECK (run >= 1),
  record_count integer NOT NULL CHECK (record_count BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  -- The end of the last run (completed or interrupted): «Відмінити» is offered for 24 hours from it (FR 8).
  ended_at timestamptz,
  undone_at timestamptz,
  PRIMARY KEY (household_id, id),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);
-- FR 6, AC7: one running action per account at a time («Інша масова дія ще виконується»).
CREATE UNIQUE INDEX actions_one_running ON actions (household_id, actor_id) WHERE status = 'running';

CREATE TABLE items (
  household_id uuid NOT NULL,
  action_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 500),
  -- The record of the target module; never its name or text (AC5: skipped records are listed by id only).
  record_id uuid NOT NULL,
  -- The snapshot of a record to change: its version and the action's fields before and after (FR 9, FR 11).
  version_before integer,
  before jsonb,
  after jsonb,
  outcome text NOT NULL
    CHECK (outcome IN ('pending', 'changed', 'unavailable', 'unchanged', 'conflict', 'invalid')),
  -- «невалідний»: the code of the single edit's validation, never its text.
  issue text CHECK (issue ~ '^[a-z][a-z0-9_.]{0,62}$'),
  -- The record's version right after this action wrote it: «Відмінити» restores it only while it is still this one.
  version_after integer,
  run integer,
  undo text CHECK (undo IN ('restored', 'not_restored')),
  PRIMARY KEY (household_id, action_id, position),
  UNIQUE (household_id, action_id, record_id),
  FOREIGN KEY (household_id, action_id) REFERENCES actions (household_id, id) ON DELETE CASCADE,
  CHECK ((outcome = 'pending') <= (version_before IS NOT NULL AND after IS NOT NULL))
);
CREATE INDEX items_pending ON items (household_id, action_id, position) WHERE outcome = 'pending';
