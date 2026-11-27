-- Replacing the data keys of spaces made under the fixed-label test key (NFR-01@PoC FR 3, NFR-15@PoC FR 26; the
-- security review of #726). The one-time re-wrap moved such keys to the installation's key file, but a copy of the
-- database made before it still holds the old wrap, which the repository's fixed-label key opens, and that data key
-- kept opening every value sealed later. The command `kms:rotate-data-keys` gives each such space a new data key and
-- seals its values again with it (scripts/kms-rotate-data-keys.ts).
--
-- `space_keys.exposed`: the key may have been wrapped by the fixed-label key at some time. True for every key made
-- before this migration (whether it was is not recorded, so the safe answer), and for every key the previous code
-- inserts (the default); the module sets it false for a key first wrapped by another master key (the key file, OCI
-- Vault). A replaced key is never exposed.
--
-- `space_key_rotations`: a replacement in progress, one row per space, so a stopped run resumes with the same new key:
-- the new data key's id and its wrap by the installation's key (never the key itself), and the parts of the space's
-- data (the modules that hold its sealed values) already sealed again. Seal and open refuse the space while the row
-- exists (`SPACE_KEY_ROTATING`); the row goes when the space's key is replaced (the old wrap goes with it) or
-- destroyed. Additive: the previous code never reads it. Row-level security on household_id is added by the migration
-- runner (ARC-03 FR 2).
ALTER TABLE space_keys
  ADD COLUMN exposed boolean NOT NULL DEFAULT true;

CREATE TABLE space_key_rotations (
  household_id uuid PRIMARY KEY REFERENCES households (household_id) ON DELETE CASCADE,
  -- The key being replaced: the replacement finishes only while it is still the space's key.
  old_key_id uuid NOT NULL,
  new_key_id uuid NOT NULL UNIQUE,
  new_master_key_version text NOT NULL CHECK (length(new_master_key_version) BETWEEN 1 AND 200),
  new_wrapped_key text NOT NULL
    CHECK (length(new_wrapped_key) BETWEEN 16 AND 8192 AND new_wrapped_key ~ '^[A-Za-z0-9_-]+$'),
  -- Part names are the modules' constants (`ResealPart.name`), never input.
  done_parts text[] NOT NULL DEFAULT '{}' CHECK (cardinality(done_parts) <= 64),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_key_id <> new_key_id)
);
