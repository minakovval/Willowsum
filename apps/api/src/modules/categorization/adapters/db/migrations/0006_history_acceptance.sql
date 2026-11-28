-- BUD-21@PoC e) (wave 2 row 237): the check on the history, the acceptance of suggestions into ordinary category
-- rules with «Застосувати до наявних» as one operation, and the permanent rejection (FR 18, FR 22, FR 23; BUD-14 FR 16).
--
-- Expand only: nullable columns and a new table; earlier code never reads the new columns (its inserts leave them
-- null) and never reads the new table. Row-level security on household_id is added by the migration runner (ARC-03
-- FR 2).

-- FR 18: «перевірка на історії» of a derivation — rules derived from the earlier 80 % of the rows (by date) applied to
-- the latest 20 %: `{ "status": "ready", "rows": n, "covered": c, "agreeing": a }`, or `{ "status": "too_short",
-- "rows": n }` under 50 rows. Counts only, nothing of the file. Null — derived before this migration.
ALTER TABLE history_derivations ADD COLUMN history_check jsonb;

-- BUD-14 FR 16, BUD-21 FR 22: the origin of a rule accepted from a suggestion («з історії»); null — made by hand.
ALTER TABLE rules ADD COLUMN origin text CHECK (origin IN ('history'));

-- FR 22: «Застосувати до наявних» of an acceptance is one run of several rules — each record names the rule that sets
-- its category (the first accepted rule by priority that matches) and the one that sets its tags. Null — the run's
-- own rule (a run of one rule, BUD-14 FR 7). `derivation_id` — the derivation whose suggestions were accepted.
ALTER TABLE rule_runs ADD COLUMN derivation_id uuid;
ALTER TABLE rule_run_items ADD COLUMN rule_id uuid;
ALTER TABLE rule_run_items ADD COLUMN category_id uuid;
ALTER TABLE rule_run_items ADD COLUMN tag_rule_id uuid;
ALTER TABLE rule_run_items ADD COLUMN tags text[];

-- FR 23, FR 24: «Відхилити» for good — the suggestion's conditions (their canonical key, as `rules.condition_key`)
-- and category; it is never shown again, also after the next file. Kept when the history file is deleted (no row of
-- the file here).
CREATE TABLE history_rejections (
  household_id uuid NOT NULL,
  condition_key text NOT NULL,
  category_id uuid NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, condition_key, category_id)
);
