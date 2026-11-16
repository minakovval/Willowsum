-- BUD-12@PoC a) (wave 2 row 24): «До розбору» — the space's one queue of transactions whose category is to be confirmed
-- (FR 2, FR 4, FR 8–10).
--
-- `review`: null — never in the queue (a transaction entered by hand, FR 8); `queued` — in the queue; `confirmed` —
-- its category confirmed («Підтвердити», «Змінити категорію»): out of the queue for good, whatever changes later
-- (business rules). Who confirmed and when is in the audit log only (FR 10).
--
-- Expand only: a nullable column and a partial index; earlier code reads and writes the rows as before (its insert
-- takes the default null, its update leaves the column as it is).
ALTER TABLE transactions ADD COLUMN review text CHECK (review IN ('queued', 'confirmed'));

-- The queue, oldest first (FR 2), and its counter on «Транзакції» (FR 2, AC9): shown transactions only.
CREATE INDEX transactions_review_queue ON transactions (household_id, occurred_on, created_at, id)
  WHERE review = 'queued' AND NOT hidden;
