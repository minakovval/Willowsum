-- FIN-03@PoC FR 22 «Категорії» (BUD-01@PoC AC 20, BUD-02@PoC AC 19 «Показати транзакції»; plan row 222s): the list
-- «Транзакції» filtered by a category finds the split transactions with a part in it by the category, not by a scan of
-- the space's parts. The count «N транзакцій» of the dialog «Видалити категорію…» (BUD-02 FR 23) reads the same parts.
--
-- Expand only: one index, no column and no constraint; the previous code reads and writes the table as before.
CREATE INDEX transaction_parts_category ON transaction_parts (household_id, category_id);
