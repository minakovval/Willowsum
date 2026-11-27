-- ws:contract 0017_transfer_dismissals.sql the new checks hold for every row the previous code writes: it never sets the three new columns (new and null there)
-- IMP-03@PoC d) (wave 2, row 139a): the one-sided transfer and the fee category of a pair.
--
-- FR 14, FR 15, FR 22: a one-sided transfer — a transaction whose other side is on an account outside Willowsum.
-- `one_sided` is null (none), `flagged` (the system's flag «односторонній переказ»: it still counts as usual), `marked`
-- («Це переказ»: neither income nor expense — out of the budget, like a side of a transfer) or `dismissed` («Це не
-- переказ»: the flag is gone and never set again). `one_sided_evidence` — why it was flagged (`transfer-words`,
-- `own-account-words`, `card-payment`), kept with the state; empty when the user marked it without a flag. Written with
-- the row's version and audit entry (application/one-sided.ts); a mark of a pair clears `flagged` and `marked`.
--
-- FR 21: `transfers.fee_category_id` — the category the budget counts the pair's fee or currency difference in, chosen
-- with «Змінити категорію»; null — the space's «Комісії банку» (FIN-03 FR 8, decision 11). The id is checked in module
-- categories when it is written; a category deleted later counts as null («Комісії банку»).
--
-- Expand only: three nullable columns; earlier code never reads them, its insert leaves them null and its update leaves
-- them as they are (it names its columns). No index: the reads that look at them already read the row.
ALTER TABLE transactions ADD COLUMN one_sided text
  CHECK (one_sided IS NULL OR one_sided IN ('flagged', 'marked', 'dismissed'));
ALTER TABLE transactions ADD COLUMN one_sided_evidence text[]
  CHECK (one_sided_evidence IS NULL OR (one_sided IS NOT NULL AND cardinality(one_sided_evidence) <= 8));
ALTER TABLE transfers ADD COLUMN fee_category_id uuid;
