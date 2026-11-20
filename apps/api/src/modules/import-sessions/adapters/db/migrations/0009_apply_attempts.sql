-- IMP-01@PoC FR 11, IMP-04@PoC FR 7 (the apply step, part b; #654): the attempt of an apply «in progress» and the
-- recovery of one stuck after a crash.
--
-- `attempt_id`: the id of the attempt that started the apply; every request that joins it writes under the same id, and
-- module transactions refuses a write of an attempt given up (its `import_voids`) — a refused apply, or one the daily
-- recovery found stuck, never leaves rows under a batch back in «розібрано». Null — started by the previous code: the
-- batch's id stands for it.
-- The partial index finds the applies still «in progress» of a space by their start (the daily recovery).
--
-- Expand only: a nullable column and an index; the previous code inserts the row without the column and never reads it.
ALTER TABLE batch_applications ADD COLUMN attempt_id uuid;
CREATE INDEX batch_applications_in_progress ON batch_applications (household_id, applied_at) WHERE in_progress;
