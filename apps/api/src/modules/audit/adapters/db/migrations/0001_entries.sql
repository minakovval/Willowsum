-- Audit log, append-only (ARC-03 FR 5, П-10). One row per data change in a household. The module role may
-- only INSERT and SELECT; UPDATE, DELETE and TRUNCATE are refused by privileges and, for every role, by triggers.
-- Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'staff', 'system')),
  actor_id uuid,
  channel text NOT NULL CHECK (channel IN ('web', 'api', 'import', 'system')),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  CHECK ((actor_kind = 'system') = (actor_id IS NULL))
);
CREATE INDEX entries_entity ON entries (household_id, entity_type, entity_id, occurred_at);

REVOKE UPDATE, DELETE, TRUNCATE ON entries FROM ws_mod_audit;

CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END $$;
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON entries FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON entries FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
