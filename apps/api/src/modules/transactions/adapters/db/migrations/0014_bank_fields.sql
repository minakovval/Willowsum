-- ws:contract 0010_import_rows.sql both new checks hold for every row the previous code writes: it never sets the five new columns (new and null there)
-- IMP-02@PoC FR 4 (S-047 data): what an imported transaction keeps of its statement row besides the amount, the date
-- and the bank's description (`bank_description`, 0010_import_rows.sql): the original amount and its currency before
-- the bank's rate, the bank's rate, the value date and the bank's reference of the operation, as the file printed them
-- (the reference masked like the description). The apply step writes them where the file has them; nothing else
-- changes them, and the user's edits never touch them. Rows imported before this migration keep null (no backfill).
--
-- Expand only: five nullable columns and two checks that every row of the previous code passes (it writes none of
-- them). No index: every read of them is a read of the row by its key or of a page of the list.
ALTER TABLE transactions ADD COLUMN original_amount numeric(38, 18);
ALTER TABLE transactions ADD COLUMN original_currency text;
ALTER TABLE transactions ADD COLUMN exchange_rate numeric(38, 18);
ALTER TABLE transactions ADD COLUMN value_date date;
ALTER TABLE transactions ADD COLUMN bank_reference text;
ALTER TABLE transactions ADD CONSTRAINT transactions_original_check
  CHECK ((original_amount IS NULL) = (original_currency IS NULL)
         AND (original_currency IS NULL OR original_currency ~ '^[A-Z0-9]{2,10}$')
         AND (exchange_rate IS NULL OR exchange_rate > 0)
         AND (bank_reference IS NULL OR char_length(bank_reference) BETWEEN 1 AND 200));
ALTER TABLE transactions ADD CONSTRAINT transactions_bank_fields_check
  CHECK (import_file_id IS NOT NULL
         OR (original_amount IS NULL AND exchange_rate IS NULL AND value_date IS NULL AND bank_reference IS NULL));
