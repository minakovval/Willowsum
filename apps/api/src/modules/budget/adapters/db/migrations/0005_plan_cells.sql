-- «Бюджет → План» (BUD-17@PoC a; wave 2 row 35): a month's own value of one line of the grid — an income source (a
-- regular income expected in the month: module recurring's opaque payment id; the nil id — «План доходу», the budget's
-- income plan, in a month without any regular income), the limit of an expense category (module categories' id), a
-- goal's planned contribution (module goals' id), «Заощадження без цілі» (the nil id). It acts on that month only and
-- wins over the budget-wide plan (FR 2); a cell whose line is no longer shown does not count (#613). `amount` null — back to the line's default; the row stays so its
-- `version` goes on (FR 3: every save carries the version the page saw). A past month's cells stay as they were; its
-- plan is the snapshot. Additive: a new table, so the code of row 36 runs on this schema unchanged.
CREATE TABLE plan_cells (
  household_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  period date NOT NULL CHECK (extract(day FROM period) = 1),
  kind text NOT NULL CHECK (kind IN ('income', 'limit', 'goal', 'savings')),
  line_id uuid NOT NULL,
  amount numeric(38, 18) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  version integer NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, budget_id, period, kind, line_id),
  FOREIGN KEY (household_id, budget_id) REFERENCES budgets (household_id, id) ON DELETE CASCADE
);
