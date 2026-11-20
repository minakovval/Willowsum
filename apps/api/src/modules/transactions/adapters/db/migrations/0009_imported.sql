-- IMP-04@PoC a) (wave 2 row 43): what an imported transaction keeps for duplicates and idempotency (FR 1, FR 5, FR 6).
--
-- `source` takes «imported» (a row of a statement file); `import_batch_id` is the batch of module import-sessions that
-- created it (no foreign key across schemas), so a pair of imported transactions from different batches is told apart
-- (FR 5) and a pending row is known to come from a previous import (FR 6); `balance_after` is the balance after the
-- operation as the statement printed it, a part of the duplicate key when present (FR 1). The apply step writes them.
--
-- Expand only: the check on `source` is widened and two nullable columns are added; earlier code writes `manual` rows
-- with both null, as before, and reads the rows as before.
ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check CHECK (source IN ('manual', 'imported'));
ALTER TABLE transactions ADD COLUMN import_batch_id uuid;
ALTER TABLE transactions ADD COLUMN balance_after numeric(38, 18);
ALTER TABLE transactions ADD CONSTRAINT transactions_import_batch_check
  CHECK (import_batch_id IS NULL OR source = 'imported');
-- The window of one account that the duplicate plan reads is `transactions_by_account` (household, account, date).
