-- Idempotency keys of a module's create routes (ARC-07 FR 4; apps/api/src/platform/http/idempotency.ts).
-- A module with create routes adds this table to its schema in a migration, verbatim. The runner adds the
-- household row policy; the stored response is visible only inside the household that sent the request.
CREATE TABLE idempotency_keys (
  household_id uuid NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (char_length(request_hash) = 64),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done')),
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, key)
);
