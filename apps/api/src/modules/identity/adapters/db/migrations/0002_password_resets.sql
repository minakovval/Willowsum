-- Password reset links (ACC-01@PoC part b: FR 10, AC16, AC17; NFR-15 FR 3; ADR-0009). A link is valid 60 min and
-- works once; a newer link revokes the older ones. Like every identity table it has no household_id (an account
-- is a person's login, not data of a space) and only the identity module's role reaches it. The token is stored
-- only as its SHA-256 digest. The rows of the last hour are also the reset letters of the account, so the letter
-- limit (one per 60 s, 5 per hour) is counted on them.
CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX password_resets_account ON password_resets (account_id, created_at);

-- Pre-account squatting (owner decision 2026-11-12): a new sign-up with the address of an unconfirmed account
-- replaces its password and revokes its links. The «Перевірте пошту» tokens of the earlier sign-ups are marked
-- superseded: they answer exactly as before (closing them would tell their holder that the address had no
-- confirmed account), but they no longer send a letter or revoke a link.
ALTER TABLE registrations ADD COLUMN superseded_at timestamptz;
