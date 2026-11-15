-- FIN-03@PoC b) (wave 2 row 16c): duplicates of a transaction (FR 10–12, FR 18, FR 27, edge case 4).
--
-- «Об'єднати»: the duplicate is merged into the transaction that stays — hidden (FR 18: hiding is for duplicates) and
-- pointing at it; its own journal event is reversed, so the pair counts once. «Роз'єднати» clears both and posts it
-- again. «Не дубль»: the pair is never marked «Можливий дубль» again.
-- Expand only: a nullable column and a new table; earlier code reads and writes the rows as before (an earlier process
-- sees a merged duplicate as a hidden transaction).
ALTER TABLE transactions ADD COLUMN merged_into uuid;
CREATE INDEX transactions_by_merged_into ON transactions (household_id, merged_into) WHERE merged_into IS NOT NULL;

-- The search of «Можливий дубль» (FR 12): the same account, amount and currency within days of each other.
CREATE INDEX transactions_duplicate_search ON transactions (household_id, account_id, currency, amount, occurred_on)
  WHERE NOT hidden AND transfer_id IS NULL;

-- «Не дубль» (FR 12): the pair in the order of its ids; gone with either transaction.
CREATE TABLE duplicate_dismissals (
  household_id uuid NOT NULL,
  first_id uuid NOT NULL,
  second_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, first_id, second_id),
  CHECK (first_id < second_id),
  FOREIGN KEY (household_id, first_id) REFERENCES transactions (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, second_id) REFERENCES transactions (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX duplicate_dismissals_by_second ON duplicate_dismissals (household_id, second_id);
