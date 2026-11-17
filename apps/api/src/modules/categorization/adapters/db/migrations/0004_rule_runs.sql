-- BUD-14@PoC b2) (wave 2 row 23): the tags action of a rule (FR 5), the rule that set a transaction's tags («Застосовано
-- правила: №…», FR 8) and «Застосувати до N наявних транзакцій» with its «Відмінити» (FR 7).
--
-- Expand only: a column with a default, a nullable column and new tables; earlier code reads and writes the rules and
-- the categories of transactions as before (its insert takes the defaults, its update leaves the new columns as they
-- are). Row-level security on household_id is added by the migration runner (ARC-03 FR 2).

-- FR 5: the tags a rule adds, by name (the space's transaction tags of module transactions; a tag missing is created).
ALTER TABLE rules ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20);

-- FR 8, AC3: the rule that set the transaction's tags (by id; null — none or gone), beside `rule_id` of its category.
ALTER TABLE transaction_categories ADD COLUMN tag_rule_id uuid;
CREATE INDEX transaction_categories_tag_rule ON transaction_categories (household_id, tag_rule_id)
  WHERE tag_rule_id IS NOT NULL;

-- FR 7: a run of «Застосувати до N наявних транзакцій» — the rule as it was when the run began (category and tags), the
-- account that started it, its state and counts. One run at a time in a space (`running` or `undoing`).
CREATE TABLE rule_runs (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  actor_account_id uuid NOT NULL,
  -- «Відмінити»: who undid it.
  undo_actor_account_id uuid,
  category_id uuid NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('running', 'completed', 'undoing', 'undone')),
  -- Only the newest transactions of the space were matched (the scan's bound).
  truncated boolean NOT NULL DEFAULT false,
  item_count integer NOT NULL CHECK (item_count >= 0),
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  undone_at timestamptz,
  PRIMARY KEY (household_id, id)
);
CREATE UNIQUE INDEX rule_runs_one_running ON rule_runs (household_id) WHERE status IN ('running', 'undoing');

-- FR 7, EC5: the transactions of a run in order, what the run found and left (category and tags), and what
-- «Відмінити» did. `result`: `pending`, `changed`, `unchanged`, `manual` (the category set by hand stays),
-- `unavailable` (gone, hidden, split, merged, a side of a transfer, or the rule deleted meanwhile).
CREATE TABLE rule_run_items (
  household_id uuid NOT NULL,
  run_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  transaction_id uuid NOT NULL,
  result text NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending', 'changed', 'unchanged', 'manual', 'unavailable')),
  category_changed boolean NOT NULL DEFAULT false,
  before_category_id uuid,
  before_source text,
  before_rule_id uuid,
  after_version integer,
  tags_changed boolean NOT NULL DEFAULT false,
  tags_before text[],
  tags_after text[],
  before_tag_rule_id uuid,
  -- «Відмінити»: `pending`, `restored`, `not_restored`; null — nothing to undo.
  undo_result text CHECK (undo_result IN ('pending', 'restored', 'not_restored')),
  PRIMARY KEY (household_id, run_id, ordinal),
  FOREIGN KEY (household_id, run_id) REFERENCES rule_runs (household_id, id) ON DELETE CASCADE
);
CREATE INDEX rule_run_items_pending ON rule_run_items (household_id, run_id, ordinal) WHERE result = 'pending';
