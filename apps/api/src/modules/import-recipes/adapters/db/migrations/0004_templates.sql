-- Templates of a space (IMP-07@PoC FR 1, FR 2, FR 3, FR 5, FR 6, FR 13; wave 2 row 49). A saved recipe is a template:
-- its scope is «рахунок» when `account_id` is set (the account of this space the template is for), else «простір».
-- `version` grows by one with every save and restore (FR 3: a save names the version it was made from); the last 20
-- versions are kept in `recipe_versions` (FR 2). `use_count` and `last_used_at` are the template's usage (FR 13);
-- `last_used_parse` is the parse that counted last, so a retried parse job counts once. Expand only: every column has
-- a default or is nullable, so the previous code still inserts and reads recipes (ARC-03 FR 4). The name's uniqueness
-- within a scope is checked by the module under the space's save lock, not by an index the previous code could break.
ALTER TABLE recipes
  ADD COLUMN account_id uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  ADD COLUMN last_used_at timestamptz,
  ADD COLUMN last_used_parse uuid;
UPDATE recipes SET updated_at = created_at;
-- FR 6: the space's templates of one format, the most recently updated first.
CREATE INDEX recipes_by_format_updated ON recipes (household_id, fingerprint, updated_at DESC, id DESC)
  WHERE fingerprint IS NOT NULL;

-- The kept versions of a template (FR 2: the last 20; a restored version becomes a new one). The same checks as the
-- template: never the account binding's value in `recipe`, only sealed. Row-level security on household_id is added by
-- the migration runner (ARC-03 FR 2).
CREATE TABLE recipe_versions (
  household_id uuid NOT NULL,
  recipe_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name !~ '[\x01-\x1f\x7f-\x9f  ]'),
  account_id uuid,
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  recipe jsonb NOT NULL CHECK (jsonb_typeof(recipe) = 'object' AND octet_length(recipe::text) <= 65536),
  CONSTRAINT recipe_versions_no_account_value CHECK (NOT (recipe #> '{account}' ? 'value')),
  account_value_sealed text CHECK (char_length(account_value_sealed) BETWEEN 1 AND 16384),
  account_value_last4 text CHECK (char_length(account_value_last4) BETWEEN 1 AND 4),
  fingerprint text CHECK (fingerprint ~ '^fp1:[0-9a-f]{64}$'),
  saved_by uuid NOT NULL,
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, recipe_id, version),
  FOREIGN KEY (household_id, recipe_id) REFERENCES recipes (household_id, id) ON DELETE CASCADE,
  CHECK ((account_value_sealed IS NULL) = (account_value_last4 IS NULL))
);
-- Every recipe saved before this migration is its own version 1.
INSERT INTO recipe_versions (household_id, recipe_id, version, name, account_id, schema_version, recipe,
  account_value_sealed, account_value_last4, fingerprint, saved_by, saved_at)
SELECT household_id, id, 1, name, NULL, schema_version, recipe, account_value_sealed, account_value_last4,
  fingerprint, created_by, created_at
FROM recipes;
