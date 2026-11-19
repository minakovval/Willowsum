-- «Видалити» and the daily cleanup of unapplied batches (IMP-01@PoC FR 12, FR 20; IMP-19@PoC FR 6; wave 2 row 39 part 2).
-- A deletion marks the batch first (`deleting_at`), then removes its originals from file-storage, then its rows. A marked
-- batch is «not found» everywhere and takes no step; the daily cleanup finishes a deletion that stopped half-way.
-- Additive: the code before this migration reads and writes the same named columns and never sees the new one.
ALTER TABLE batches ADD COLUMN deleting_at timestamptz;
-- The daily cleanup's search: unapplied batches by their last action.
CREATE INDEX batches_idle ON batches (household_id, last_action_at) WHERE state NOT IN ('applied', 'rolled-back');
