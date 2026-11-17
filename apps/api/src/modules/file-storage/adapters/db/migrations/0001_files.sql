-- Stored files of a space (ARC-06@PoC FR 4, NFR-15@PoC FR 18, FR 31; wave 2 row 38). The bytes are not here: each
-- file is an object in the S3-compatible storage under `object_key` (ids only), encrypted with the space's key; a row
-- is written in the same transaction as its object, after the type check, so a rejected file has no row. The space's
-- total of `size_bytes` (the original sizes) is held under 100 GiB under the space's limits lock. The file name is
-- kept for the download only. Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE files (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('statement')),
  format text NOT NULL CHECK (format IN ('csv', 'tsv', 'xlsx', 'xls')),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 100),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (object_key)
);
-- Duplicates of a file are found by its SHA-256 within the space (IMP-01 «Бізнес-правила»).
CREATE INDEX files_sha256 ON files (household_id, sha256);
