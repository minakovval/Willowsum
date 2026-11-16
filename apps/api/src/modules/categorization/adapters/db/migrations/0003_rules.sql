-- The category rules of a space (BUD-14@PoC FR 4, FR 5, FR 8, FR 10, FR 11, FR 13; wave 2 row 23). A rule is a set of
-- conditions that must all hold («І»), an optional list of accounts it is limited to («Лише для рахунків») and the
-- category it sets. `position` is its priority: 1 is the highest, the positions of a space are 1…n with no gaps (a move
-- renumbers them under the space's lock, adapters/db/rules.ts). `condition_key` is the canonical form of the conditions
-- and the accounts, for the warning about an identical rule (FR 11). Category and account ids name records of modules
-- categories and accounts by id only (no foreign key across schemas). Row-level security on household_id is added by
-- the migration runner (ARC-03 FR 2).
CREATE TABLE rules (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 1),
  conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions) = 'array'),
  account_ids uuid[] NOT NULL DEFAULT '{}',
  category_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  condition_key text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- A move swaps positions inside one transaction: checked at its end.
  CONSTRAINT rules_position UNIQUE (household_id, position) DEFERRABLE INITIALLY DEFERRED
);
-- FR 11: an identical rule is looked up by its conditions; FR 10: a merge of categories rewrites the rules of one.
CREATE INDEX rules_condition_key ON rules (household_id, condition_key);
CREATE INDEX rules_category ON rules (household_id, category_id);

-- FR 13, FR 8: the rule that set the category of a transaction (with the source «rule»; ignored with any other source).
-- Nullable and without a check, so the code before this migration keeps writing its rows (ARC-03 FR 4).
ALTER TABLE transaction_categories ADD COLUMN rule_id uuid;
CREATE INDEX transaction_categories_rule ON transaction_categories (household_id, rule_id)
  WHERE rule_id IS NOT NULL;
