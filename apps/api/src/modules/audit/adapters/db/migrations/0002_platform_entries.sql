-- Platform audit log, append-only (П-10, CICD-06): changes that belong to no household — feature flags and
-- module kill switches now, staff actions later. The same columns as `entries` without household_id: it
-- holds no customer data (schema-exemptions.json); identifiers are opaque UUIDs and values are settings.
-- The module role may only INSERT (without id and occurred_at) and SELECT; UPDATE, DELETE and TRUNCATE are
-- refused by privileges and, for every role, by the triggers of migration 0001's function.
CREATE TABLE platform_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('staff', 'system')),
  actor_id uuid,
  channel text NOT NULL CHECK (channel IN ('web', 'api', 'import', 'system')),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_.-]{0,62}$'),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  CHECK ((actor_kind = 'system') = (actor_id IS NULL))
);
CREATE INDEX platform_entries_entity ON platform_entries (entity_type, entity_id, occurred_at);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_entries FROM ws_mod_audit;
GRANT INSERT (actor_kind, actor_id, channel, entity_type, entity_id, action, changes) ON platform_entries TO ws_mod_audit;

CREATE TRIGGER platform_entries_append_only BEFORE UPDATE OR DELETE ON platform_entries FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER platform_entries_no_truncate BEFORE TRUNCATE ON platform_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
