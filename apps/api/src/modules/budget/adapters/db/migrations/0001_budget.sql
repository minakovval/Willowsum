-- The budget of a space (BUD-02@PoC a; wave 2 row 29). One budget per space (FR 1, edge case 6), in the space's
-- reporting currency when it was created; the period is the calendar month (FR 4, FR 6), the first one `first_period`
-- (the 1st of its month). The plan is kept as it is now — the income plan and the limits; a change acts from the
-- current period on (FR 7), and every finished period keeps its plan in `period_snapshots` (FR 11), written before any
-- change and on the first view of that period. Categories and accounts are the `categories` and `accounts` modules',
-- by their opaque ids (no foreign key across schemas). Row-level security on household_id is added by the migration
-- runner (ARC-03 FR 2).
CREATE TABLE budgets (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  first_period date NOT NULL CHECK (extract(day FROM first_period) = 1),
  income_plan numeric(38, 18) NOT NULL DEFAULT 0 CHECK (income_plan >= 0),
  -- The day (Kyiv) the budget was created.
  created_on date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- FR 1, edge case 6: «Бюджет уже існує».
  UNIQUE (household_id)
);

-- FR 7: the limit of an expense category, in the budget's currency; without a row the category is «Поза планом».
CREATE TABLE limits (
  household_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  category_id uuid NOT NULL,
  amount numeric(38, 18) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  PRIMARY KEY (household_id, budget_id, category_id),
  FOREIGN KEY (household_id, budget_id) REFERENCES budgets (household_id, id) ON DELETE CASCADE
);
-- FR 12 of BUD-01 (an empty category) looks limits up by their category.
CREATE INDEX limits_category ON limits (household_id, category_id);

-- FR 10: an account switched away from its default (current accounts, cards and cash are in by default). The key is
-- the account alone: «Один рахунок належить не більше ніж одному бюджету простору».
CREATE TABLE budget_accounts (
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  included boolean NOT NULL,
  PRIMARY KEY (household_id, account_id),
  FOREIGN KEY (household_id, budget_id) REFERENCES budgets (household_id, id) ON DELETE CASCADE
);

-- FR 11: the plan of a finished period — the limits with «обов'язкова», the income plan and the planned savings —
-- never changed by later changes of the plan. `limits`: [{ categoryId, amount, mandatory }], amounts as decimal strings.
CREATE TABLE period_snapshots (
  household_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  income_plan numeric(38, 18) NOT NULL CHECK (income_plan >= 0),
  planned_savings numeric(38, 18) NOT NULL CHECK (planned_savings >= 0),
  limits jsonb NOT NULL CHECK (jsonb_typeof(limits) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, budget_id, period),
  FOREIGN KEY (household_id, budget_id) REFERENCES budgets (household_id, id) ON DELETE CASCADE
);
