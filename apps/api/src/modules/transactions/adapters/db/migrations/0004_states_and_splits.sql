-- FIN-03@PoC b) (wave 2 row 16a): «Очікує», hidden transactions and splits.
--
-- «Очікує» (FR 4, FR 24): a pending transaction has no journal event until it is posted. The old check allowed
-- «posted» only; it is dropped (a wider set breaks no earlier code) and the module checks the value
-- (domain TRANSACTION_STATUSES). Putting a check back is a contract step of a later release.
ALTER TABLE transactions DROP CONSTRAINT transactions_status_check;

-- «Приховати транзакцію» (FR 16–18): out of the list, the budget and the reports; the journal event (the balance) stays.
ALTER TABLE transactions ADD COLUMN hidden boolean NOT NULL DEFAULT false;

-- «Розділити» (BUD-01 FR 6, BUD-13 FR 6–8): the mode, and «потребує перегляду» once the amount changed after the split.
-- The parts are in transaction_parts; the journal is never touched by a split.
ALTER TABLE transactions ADD COLUMN split_mode text CHECK (split_mode IN ('categories', 'months'));
ALTER TABLE transactions ADD COLUMN split_needs_review boolean NOT NULL DEFAULT false;
-- For the «Стан: розділені» filter of the list (DAT-01 whitelists): derived, never written.
ALTER TABLE transactions ADD COLUMN is_split boolean GENERATED ALWAYS AS (split_mode IS NOT NULL) STORED;

-- The parts of a split, in order (the list's «Категорія» shows the first, FIN-03 FR 23): a category of the space's
-- tree (module categories, checked through its public directory) and a signed amount in the transaction's currency;
-- a share of «На кілька місяців» also its month. They summed to the transaction's amount when saved.
CREATE TABLE transaction_parts (
  household_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 59),
  category_id uuid NOT NULL,
  month date CHECK (month IS NULL OR extract(day FROM month) = 1),
  amount numeric(38, 18) NOT NULL CHECK (amount <> 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  PRIMARY KEY (household_id, transaction_id, position),
  FOREIGN KEY (household_id, transaction_id) REFERENCES transactions (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);
