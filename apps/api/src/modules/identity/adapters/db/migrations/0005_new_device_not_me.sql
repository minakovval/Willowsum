-- Sign-in history, the new-device letter and «Це був не я» (ACC-04@PoC FR 4, 5, AC6, AC7; NFR-15@PoC FR 6, 7, 29;
-- decision log 2026-11-14-acc04-new-device-not-me). Expand only: the previous code never reads the new tables or
-- the new column, and the widened end reason is never written by it.

-- The devices an account has signed in from (NFR-15 FR 29: a device is its user agent). Only the SHA-256 of the
-- user agent is kept, never the text. The first successful sign-in of an account starts this history and sends no
-- letter; a later sign-in from a device not in it sends the new-device letter. The rows go with the account.
CREATE TABLE sign_in_devices (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_digest bytea NOT NULL CHECK (length(device_digest) = 32),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, device_digest)
);

-- «Це був не я» links of new-device letters (ACC-04 FR 5): the SHA-256 of a one-time token valid 7 days, and what the
-- confirmation page shows of the sign-in (S-004b): its time, the browser and system named from a fixed list, and
-- the client address already masked (never the full address). `signed_in_at` is also the time of the suspicious
-- sign-in that the parts of NFR-15 FR 7 without data in this release (factors, trusted devices, bank connections)
-- will act from. The daily task deletes used and expired links (they answer «Посилання недійсне» like unknown ones).
CREATE TABLE not_me_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  device_digest bytea NOT NULL CHECK (length(device_digest) = 32),
  signed_in_at timestamptz NOT NULL,
  device_browser text NOT NULL CHECK (device_browser IN ('chrome', 'edge', 'firefox', 'safari', 'opera', 'other')),
  device_os text NOT NULL CHECK (device_os IN ('windows', 'macos', 'ios', 'android', 'linux', 'chromeos', 'other')),
  address_masked text NOT NULL CHECK (length(address_masked) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX not_me_links_account ON not_me_links (account_id);

-- Set by «Це був не я»: every sign-in is refused until the password is changed (ACC-04 FR 5); a new password clears it.
ALTER TABLE accounts ADD COLUMN password_reset_required_at timestamptz;

-- A new end reason `not-me` (ACC-04 FR 5). Widening the check is a drop here; the code writes only the reasons of
-- `SessionEndReason`. A later contract step may add the wider check again (follow-up of this PR).
ALTER TABLE sessions DROP CONSTRAINT sessions_end_reason_check;
