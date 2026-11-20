-- IMP-01@PoC FR 11, IMP-04@PoC FR 7, AC9 (the apply step, part a; #637 comment item 1): the stored result of applying a
-- batch is written in two steps around the transactions' write, so a crash between them never leaves transactions
-- without a batch that owns them, and never a result without its transactions.
--
-- `in_progress`: the apply has started — the batch is «застосовано» from here (no decision, parse, cancel or delete
-- changes it), its transactions are being written by module transactions (once per batch, by its own key); the
-- result's counts come once they are written. A retried apply finds the row and finishes it.
-- `from_state`: the state the batch had before («розібрано» or «потребує перегляду»): an apply refused while writing
-- (a row the account cannot take, a plan too large) puts the batch back there, the row removed.
--
-- Expand only: the previous code inserts a finished result (the default false) and never reads the new columns.
ALTER TABLE batch_applications ADD COLUMN in_progress boolean NOT NULL DEFAULT false;
ALTER TABLE batch_applications ADD COLUMN from_state text CHECK (from_state IN ('parsed', 'needs-review'));
