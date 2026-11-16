-- BUD-05@PoC b) (wave 2 row 28): «Витратити» from a goal (FR 8, AC2, AC5, edge case 5) and closing a goal (FR 9, FR 12,
-- FR 13). Expand only: a nullable column, a narrower unique index and a new table; earlier code reads and writes the rows
-- as before (it never closes a goal, so every row it sees is open).

-- «Закрити ціль» (FR 9, FR 13 «Закрити без витрати»): the day (Kyiv) the goal was closed. A closed goal leaves the list
-- and the card (no archive in this release), reserves nothing on its account and keeps its spends in effect; its history
-- stays in the audit log.
ALTER TABLE goals ADD COLUMN closed_on date;

-- «На одному рахунку — не більше однієї такої цілі» (FR 2) holds for open goals: a closed own-account goal frees its
-- account. A wider set of rows breaks no earlier code (it closes nothing).
DROP INDEX goals_own_account;
CREATE UNIQUE INDEX goals_own_account ON goals (household_id, account_id)
  WHERE part_kind = 'account' AND closed_on IS NULL;

-- «Витратити» (FR 8): an outgoing transaction of the space written off from a goal — it no longer lowers «Можна
-- витратити» and shows «з цілі» in the comparison of expenses. The transaction is the `transactions` module's and its
-- journal entry the `ledger`'s, by their opaque ids (no foreign key across schemas). `entry_id` — the transaction's
-- journal event in effect when it was spent: once the journal reverses it (the transaction changed or deleted by hand or
-- by a repeated import), the spend is cancelled automatically and its amount goes back to the goal (AC5). A cancelled
-- spend is deleted; its history stays in the audit log.
CREATE TABLE spends (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  goal_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  -- The account of the transaction (`accounts`): the part's account, or any account for a goal of marks only.
  account_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  -- What the transaction took from the account, positive, in the goal's currency.
  amount numeric(38, 18) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  -- The transaction's date (its journal event's operation date).
  spent_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- A transaction is spent from one goal at most, once.
  UNIQUE (household_id, transaction_id),
  UNIQUE (household_id, entry_id),
  FOREIGN KEY (household_id, goal_id) REFERENCES goals (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX spends_by_goal ON spends (household_id, goal_id, spent_on);
