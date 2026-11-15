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

-- Transactions (ARC-04 FR 2, FR 3; issue #240 item 4, #252 item 1; ADR-0015): the tables above verbatim. A create, an
-- edit and a delete of a transaction enqueue their hand-off job (`transactions.hand-off`: the journal event made to
-- match the row, then the audit entry) in the same transaction as the row; the job's payload holds identifiers, the
-- action, the row's version and the audit entry's values with the counterparty and the description already masked.
-- The module publishes no events yet (outbox_events stays empty).
