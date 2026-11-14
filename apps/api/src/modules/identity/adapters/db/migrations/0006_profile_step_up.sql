-- Profile and password change with step-up (ACC-05@PoC FR 1, 3, 5; NFR-01@PoC FR 12, 13; NFR-15@PoC FR 4; decision log
-- 2026-11-14-acc05-profile-password). Expand only: two nullable columns and one new table that the previous code
-- never reads; the new session end reasons `password-change` and `step-up-locked` need no change (0005 dropped the
-- end reason CHECK).

-- The format of dates and numbers (a BCP 47 tag, canonical, e.g. `uk-UA`) and the IANA time zone (`Europe/Kyiv`)
-- the browser sent at sign-up (ACC-05 FR 3). NULL for accounts made before, or by a client that sent none: the web
-- then uses the browser's own.
ALTER TABLE accounts
  ADD COLUMN locale text CHECK (locale ~ '^[A-Za-z0-9-]{1,35}$'),
  ADD COLUMN time_zone text CHECK (time_zone ~ '^[A-Za-z0-9_+/-]{1,64}$');

-- Step-up confirmations (NFR-01 FR 13, NFR-15 FR 4): the current password typed right before a sensitive action gives
-- a one-time token for that session and that action, valid 5 minutes. Only its SHA-256 is kept. A newer confirmation
-- of the same session and action replaces the older one; the rows go with their session (cascade, and the daily task
-- deletes sessions after their 12 h).
CREATE TABLE step_up_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('password-change')),
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX step_up_confirmations_session ON step_up_confirmations (session_id, action);
