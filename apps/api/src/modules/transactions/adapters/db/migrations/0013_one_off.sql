-- BUD-06@PoC FR 8, AC 4 (FLW-38@PoC FR 4, AC 3): «Одноразова витрата» — the switch in the details of a transaction.
-- A marked expense stays in the fact of its period, but leaves the averages: the base «Середнє за 3 / 6 / 12 міс.» of
-- «Порівняння», the template «Створити за моїми витратами» and the average expenses of «Подушка безпеки».
--
-- Expand only: a column with a default; earlier code reads and writes the rows as before (its insert takes the
-- default, its update leaves the column as it is). No index: every read that looks at it already reads the row.
ALTER TABLE transactions ADD COLUMN one_off boolean NOT NULL DEFAULT false;
