-- ws:contract 0014_bank_fields.sql the new check holds for every row the previous code writes: it never sets the new column (new and null there)
-- IMP-02@PoC FR 5 (#698 owner report): the bank's fee in an imported transaction's amount — the fee charged, positive,
-- in the transaction's currency (monobank's «Сума комісій» is a part of «Сума в валюті картки»). The amount stays what
-- the account moved; the journal event of a row with a fee has the operation's main leg (amount + fee) and a separate
-- fee leg (module ledger, event `transaction` with `fee`). The apply step writes it; nothing else changes it. Rows
-- imported before keep null (no backfill: their apply refused a row with a fee).
--
-- Expand only: one nullable column and one check that every row of the previous code passes (it writes no fee). No
-- index: it is read only with its row.
ALTER TABLE transactions ADD COLUMN bank_fee numeric(38, 18);
ALTER TABLE transactions ADD CONSTRAINT transactions_bank_fee_check
  CHECK (bank_fee IS NULL OR (bank_fee > 0 AND import_file_id IS NOT NULL));
