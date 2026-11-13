-- Job queue and outbox of a module (ARC-04; apps/api/src/platform/queue). A module that publishes events or runs
-- background jobs adds this migration to its schema, verbatim. The runner adds the household row policy to both
-- tables: a job and an event are visible only inside the household they belong to.
--
-- outbox_events: an event is written in the same transaction as the change it reports (FR 2); the worker hands
-- it to the consumers' job queues and marks it dispatched. A rolled-back change leaves no event.
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  event_name text NOT NULL CHECK (char_length(event_name) BETWEEN 3 AND 128),
  event_version integer NOT NULL CHECK (event_version >= 1),
  payload jsonb NOT NULL,
  traceparent text CHECK (char_length(traceparent) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX outbox_events_pending ON outbox_events (household_id, created_at) WHERE dispatched_at IS NULL;

-- jobs: one row per job; (household_id, name, dedupe_key) makes enqueueing idempotent (FR 3). A worker takes a
-- job with a lease; a job whose worker died is taken again when its lease ends. After 8 attempts the job is
-- «dead» — the dead-letter queue (FR 4).
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 128),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  heavy boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_until timestamptz,
  last_error text CHECK (char_length(last_error) <= 64),
  traceparent text CHECK (char_length(traceparent) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (household_id, name, dedupe_key)
);
CREATE INDEX jobs_due ON jobs (household_id, run_after) WHERE state IN ('queued', 'running');

-- Ledger (ARC-11, issues #125 and #128): the tables above verbatim; below, what the ledger adds to them.
-- «Проводку записано» (`ledger.entry-recorded`) is written to outbox_events in the transaction of its entry
-- (journal.ts `write`, adapters/db/store.ts `recorded`).
--
-- No free text in the ledger schema (ARC-11 criterion «Тексти, описи або назви мерчантів у таблицях журналу» = 0;
-- schema-rules.ts `ledgerFreeTextProblems`): every text or JSON column carries a CHECK that limits it to a code (the
-- journal tables' own columns: 0005_ledger_codes.sql). The
-- payloads hold identifiers, codes and dates only (events.ts): every string in them is a code without spaces.
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_event_name_code CHECK (event_name ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  ADD CONSTRAINT outbox_events_payload_codes CHECK (
    jsonb_typeof(payload) = 'object'
    AND NOT jsonb_path_exists(payload, '$.** ? (@.type() == "string" && !(@ like_regex "^[A-Za-z0-9:._+-]{1,200}$"))')
  ),
  ADD CONSTRAINT outbox_events_traceparent_code
    CHECK (traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
ALTER TABLE jobs
  ADD CONSTRAINT jobs_name_code CHECK (name ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  ADD CONSTRAINT jobs_dedupe_key_code CHECK (dedupe_key ~ '^[A-Za-z0-9:._-]{1,200}$'),
  ADD CONSTRAINT jobs_payload_codes CHECK (
    NOT jsonb_path_exists(payload, '$.** ? (@.type() == "string" && !(@ like_regex "^[A-Za-z0-9:._+-]{1,200}$"))')
  ),
  ADD CONSTRAINT jobs_last_error_code CHECK (last_error ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'),
  ADD CONSTRAINT jobs_traceparent_code
    CHECK (traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');

-- Erasure of a space (NFR-12@PoC FR 3, ADR-0013): its queue rows go with its journal (adapters/db/erasure.ts).
GRANT SELECT, DELETE ON outbox_events, jobs TO ws_era_ledger;
