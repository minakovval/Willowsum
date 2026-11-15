-- An entry recorded once per key (ARC-04 FR 3; issue #210): a module whose change hands its audit entry over after
-- its own transaction commits (a job that may run again) passes a key, and the same key in the same space appends
-- nothing the second time. The key is a code (`<module>.<what>:<id>`), never free text; entries without one are as
-- before. The module role may set it on INSERT only; the log stays append-only (0001, 0003).
ALTER TABLE entries ADD COLUMN dedupe_key text CHECK (dedupe_key ~ '^[A-Za-z0-9:._-]{1,200}$');
CREATE UNIQUE INDEX entries_dedupe_key ON entries (household_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
GRANT INSERT (dedupe_key) ON entries TO ws_mod_audit;
