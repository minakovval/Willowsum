-- BUD-21@PoC FR 2, IMP-08@PoC FR 17 (wave 2 row 243): «Імпортувати як виписку» for a file of a statements' batch that
-- looks like a history file (it has a column of categories or of transfer marks). The person's answer is kept with the
-- file's parse: `as_statement` true — the columns of the user's own analysis (category, subcategory, transfer mark,
-- tags) are not read when the file is parsed, so none of them becomes a description or a category of a transaction.
-- A parse asked again without an answer keeps the one before.
--
-- Expand only: a column with a default; the previous code never reads it, and its rows are written with `false`.
ALTER TABLE file_parses ADD COLUMN as_statement boolean NOT NULL DEFAULT false;
