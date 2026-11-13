-- Keys of spaces (ARC-06@PoC FR 1, FR 3, FR 5; ADR-0012). Envelope encryption: each space has its own 256-bit data
-- key, stored only wrapped by the master key, which never leaves the KMS. The KMS adapter wraps and unwraps; this
-- table never holds a key in the clear. Under the household policy like every customer-data table (the migration
-- runner enables and forces row-level security).
--
-- households.encryption_key_ref names the key: `dek:<key_id>` while it exists, `destroyed:<key_id>` once destroyed
-- (FR 5), `pending:<household_id>` for a space made before this migration until the daily key task gives it one.
CREATE TABLE space_keys (
  household_id uuid PRIMARY KEY REFERENCES households (household_id) ON DELETE CASCADE,
  key_id uuid NOT NULL UNIQUE,
  -- The master key version that wrapped it: the daily task rewraps keys of older versions (FR 3).
  master_key_version text NOT NULL CHECK (length(master_key_version) BETWEEN 1 AND 200),
  -- base64url of the KMS's ciphertext of the data key.
  wrapped_key text NOT NULL CHECK (length(wrapped_key) BETWEEN 16 AND 8192 AND wrapped_key ~ '^[A-Za-z0-9_-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rewrapped_at timestamptz
);
