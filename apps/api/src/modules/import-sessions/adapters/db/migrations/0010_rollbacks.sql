-- IMP-04@PoC FR 8, IMP-16@PoC FR 1, FR 3, FR 9 (wave 2 row 44): «Відкотити» an applied batch.
--
-- The rollback is kept with the batch's applied result: who and when, the choice («keep-changed» — «Залишити змінені»,
-- or «all» — «Відкотити все») and its result (counts and the ids of the transactions kept, never row text). The batch
-- is «відкочено» in the same transaction; a later «Відкотити» returns this and changes nothing (FR 3).
--
-- Expand only: nullable columns the previous code never reads or writes.
ALTER TABLE batch_applications ADD COLUMN rolled_back_by uuid;
ALTER TABLE batch_applications ADD COLUMN rolled_back_at timestamptz;
ALTER TABLE batch_applications ADD COLUMN rollback jsonb CHECK (jsonb_typeof(rollback) = 'object');
