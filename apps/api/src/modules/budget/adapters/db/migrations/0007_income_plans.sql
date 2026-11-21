-- «План доходу» by income category (BUD-02@PoC FR 21; owner decision 2026-11-21, option 2 а): the plan of each income
-- category of the space (module categories' opaque id, no foreign key across schemas), in the budget's currency. The
-- budget's `income_plan` stays the income plan and is written as the sum of these rows; a budget without rows has its
-- plan without categories. A finished period keeps the plan of each income category in its snapshot (FR 11):
-- `income_plans` [{ categoryId, amount }], amounts as decimal strings; null — a snapshot written before this migration.
-- Additive: a new table and a nullable column, so the code before this migration runs on this schema unchanged (it
-- never reads them and still finds the income plan in `budgets.income_plan`).
CREATE TABLE income_plans (
  household_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  category_id uuid NOT NULL,
  amount numeric(38, 18) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  PRIMARY KEY (household_id, budget_id, category_id),
  FOREIGN KEY (household_id, budget_id) REFERENCES budgets (household_id, id) ON DELETE CASCADE
);
-- BUD-01 FR 12 (an empty category) looks income plans up by their category.
CREATE INDEX income_plans_category ON income_plans (household_id, category_id);

ALTER TABLE period_snapshots
  ADD COLUMN income_plans jsonb CHECK (income_plans IS NULL OR jsonb_typeof(income_plans) = 'array');
