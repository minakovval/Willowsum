-- IMP-01@PoC FR 11, IMP-04@PoC FR 7 (the apply step, part b; #654): an attempt of module import-sessions to apply a
-- batch that is given up — refused, or found stuck «in progress» by the daily recovery — before it wrote anything.
--
-- The give-up is written under the import lock of the batch's accounts (the one every write takes), only when the batch
-- has no write record (`import_writes`); a write of that attempt that comes later (a request that joined it, or one
-- still on its way) finds it and writes nothing, so no row is ever written under a batch that went back to
-- «розібрано». Another attempt of the same batch (the next «Застосувати») has another id and writes as usual.
--
-- Expand only: a new table the previous code never reads. Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).
CREATE TABLE import_voids (
  household_id uuid NOT NULL,
  -- The batch of module import-sessions and the attempt's id there (no foreign key across schemas).
  import_batch_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  voided_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, import_batch_id, attempt_id)
);
