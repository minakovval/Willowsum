-- Session timeout and refresh token rotation (ACC-04@PoC FR 1, 3; NFR-01@PoC FR 10–12; ADR-0009 «Сесії», decision log 2026-11-13-acc04-session-refresh).
-- Expand only: the previous code never reads the new column or table.
--
-- `end_reason` says why a session ended, so the next request of its browser can tell «Сесію завершено через
-- бездіяльність» from «Сесію завершено з іншого пристрою» (ACC-04 «Стани інтерфейсу»). Null on rows ended before
-- this migration (sign-out).
ALTER TABLE sessions ADD COLUMN end_reason text
  CHECK (end_reason IN ('signed-out', 'idle', 'expired', 'password-reset', 'token-reuse'));

-- Tokens a refresh replaced (NFR-01 FR 12): the SHA-256 of each earlier token of a session. Within 30 s of its
-- replacement a token still authenticates (other tabs' requests on their way); later its return ends the session
-- (it was copied). The rows go with their session (the daily task deletes sessions past their 12 h end; ADR-0010).
CREATE TABLE retired_session_tokens (
  token_digest bytea PRIMARY KEY CHECK (length(token_digest) = 32),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  retired_at timestamptz NOT NULL
);
CREATE INDEX retired_session_tokens_session ON retired_session_tokens (session_id);
