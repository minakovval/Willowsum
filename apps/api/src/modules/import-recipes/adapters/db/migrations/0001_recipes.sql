-- Parsing recipes of a space (IMP-06@PoC FR 1, FR 2, FR 7; wave 2 row 40 part 2). A recipe is data checked by the
-- module's schema (version `schema_version`), never code; its JSON is at most 32 KB (checked before it is written).
-- The account binding's value (an IBAN, an account number or a mask; NFR-01 FR 6) is never in `recipe`: it is sealed
-- with the space's key (`account_value_sealed`), and only its last 4 characters are kept to show it masked.
-- `fingerprint` is the format fingerprint the recipe was made for (`fp1:` + SHA-256): a hash, never the signature text.
-- The name is the user's label: no control characters (#607 item 5). Row-level security on household_id is added by
-- the migration runner (ARC-03 FR 2).
CREATE TABLE recipes (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  recipe jsonb NOT NULL CHECK (jsonb_typeof(recipe) = 'object' AND octet_length(recipe::text) <= 65536),
  -- The account binding's value is only ever in `account_value_sealed`.
  CONSTRAINT recipes_no_account_value CHECK (NOT (recipe #> '{account}' ? 'value')),
  account_value_sealed text CHECK (char_length(account_value_sealed) BETWEEN 1 AND 16384),
  account_value_last4 text CHECK (char_length(account_value_last4) BETWEEN 1 AND 4),
  fingerprint text CHECK (fingerprint ~ '^fp1:[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  CHECK ((account_value_sealed IS NULL) = (account_value_last4 IS NULL))
);
CREATE INDEX recipes_recent ON recipes (household_id, created_at DESC, id DESC);
-- The recipes made for one format (FR 7: the next file of the same format).
CREATE INDEX recipes_by_format ON recipes (household_id, fingerprint) WHERE fingerprint IS NOT NULL;
