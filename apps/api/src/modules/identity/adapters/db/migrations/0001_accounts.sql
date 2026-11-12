-- Accounts, email confirmation, registrations, sessions and sign-in throttling (ACC-01@PoC part a; ADR-0009).
-- An account is a person's login, not data of a space: one login may later belong to several spaces, and it
-- exists before its first space (ACC-01 FR 7). So these tables have no household_id; they are reachable only by
-- the identity module's own role, and each is listed with its reason in schema-exemptions.json. Secrets are
-- never stored: passwords as argon2id hashes, every token as its SHA-256 digest.

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- As entered (trimmed); used only to address letters.
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  -- Lower case: the unique key of the login (one account per address).
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(email_normalized) AND length(email_normalized) BETWEEN 3 AND 254),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  -- PHC string of argon2id (`$argon2id$v=19$m=…`).
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%' AND length(password_hash) <= 512),
  -- Unconfirmed while NULL: such an account cannot sign in (ACC-01 FR 5).
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Email confirmation links (ACC-01 FR 4, 5, 14): valid 24 h, single use; a newer link revokes the older ones.
CREATE TABLE email_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX email_confirmations_account ON email_confirmations (account_id);

-- One sign-up as the «Перевірте пошту» screen knows it (ACC-01 FR 13): an opaque token that the screen's
-- «Надіслати ще раз» and «Змінити email» act on. `kind` says whether the sign-up created the account (`new`)
-- or found one with the address (`existing`, which it never changes); clients cannot tell the two apart.
CREATE TABLE registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('new', 'existing')),
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX registrations_account ON registrations (account_id);

-- Server-side sessions (ADR-0009): the browser holds only an opaque random token in a __Secure- cookie.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (length(token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Absolute end (NFR-01 FR 10: 12 h); idleness ends it earlier.
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_account ON sessions (account_id);

-- Sign-in throttling per typed email (ACC-01, NFR-14 FR 7), the same for an address without an account. The
-- key is the SHA-256 of the normalised address, never the address. Locked while locked_until is ahead; after a
-- lockout every attempt needs a CAPTCHA until a sign-in with the right password.
CREATE TABLE sign_in_guards (
  email_key bytea PRIMARY KEY CHECK (length(email_key) = 32),
  locked_until timestamptz,
  captcha_required boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Timed events of the sliding limits (ADR-0009): failed sign-ins (5 in 15 min), letters per address (one per 60 s,
-- 5 per hour), «Надіслати ще раз» per sign-up token, sign-ups per client address (5 in any hour). `scope` names the
-- limit; the key is a SHA-256 digest, never an address or a token.
CREATE TABLE throttle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('sign-in-failure', 'confirmation-mail', 'attempt-mail', 'registration-resend', 'sign-up')),
  subject_key bytea NOT NULL CHECK (length(subject_key) = 32),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX throttle_events_subject ON throttle_events (scope, subject_key, occurred_at);
