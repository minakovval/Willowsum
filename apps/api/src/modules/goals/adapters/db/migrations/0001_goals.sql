-- Savings goals of a space (BUD-05@PoC FR 2, FR 3, FR 6, FR 11; wave 2 row 27). A goal belongs to the space (no
-- personal goals in this release) and has exactly one part — «де лежать гроші» — kept in the goal's row: its own account
-- («Окремий рахунок цілі»: collected = the account's balance), an envelope on an account (a reserved part of its balance)
-- or marks only. Accounts are the `accounts` module's, by their opaque id (no foreign key across schemas). Row-level
-- security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE goals (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  -- «Подорож», «Покупка», «Подушка безпеки», «Власна» (FR 1).
  template text NOT NULL CHECK (template IN ('travel', 'purchase', 'emergency', 'custom')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- The target and every amount of the goal (start, contributions) are in this currency.
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  target_amount numeric(38, 18) NOT NULL CHECK (target_amount > 0),
  -- Optional (FR 2); without it the goal shows only progress and pace (FR 12).
  target_date date,
  -- «Скільки місяців витрат» of «Подушка безпеки» (FR 10); null for the other templates.
  emergency_months integer CHECK (emergency_months BETWEEN 1 AND 120),
  part_kind text NOT NULL CHECK (part_kind IN ('account', 'envelope', 'marks')),
  account_id uuid,
  -- The start amount of an envelope or of marks; an own account's collected is its balance, so 0 there.
  start_amount numeric(38, 18) NOT NULL DEFAULT 0 CHECK (start_amount >= 0),
  -- The day (Kyiv) the goal was created: the pace never looks before it (FR 7).
  created_on date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- «Поле "Рахунок" є лише в перших двох варіантах» (FR 2).
  CHECK ((part_kind = 'marks') = (account_id IS NULL)),
  CHECK (part_kind <> 'account' OR start_amount = 0),
  CHECK ((template = 'emergency') = (emergency_months IS NOT NULL))
);
-- «На одному рахунку — не більше однієї такої цілі» (FR 2).
CREATE UNIQUE INDEX goals_own_account ON goals (household_id, account_id) WHERE part_kind = 'account';
CREATE INDEX goals_by_account ON goals (household_id, account_id) WHERE account_id IS NOT NULL;

-- «Внести» — a manual mark of a contribution (FR 6); the product moves no money. An own account's goal has none: its
-- contributions are the growth of the account's balance. Deleted with the goal; the history stays in the audit log.
CREATE TABLE contributions (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  goal_id uuid NOT NULL,
  amount numeric(38, 18) NOT NULL CHECK (amount > 0),
  -- The day of the contribution (Kyiv): this month's contributions and the pace (FR 5, FR 7) go by it.
  contributed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  FOREIGN KEY (household_id, goal_id) REFERENCES goals (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX contributions_by_goal ON contributions (household_id, goal_id, contributed_on);
