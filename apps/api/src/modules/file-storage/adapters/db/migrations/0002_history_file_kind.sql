-- ws:contract 0001_files.sql the kind rule only widens (it now also allows 'history-file'); every kind the previous code can store still passes
-- The original of a history file with the user's categorisation (BUD-21@PoC FR 3, FR 24; Рішення ведучого (2026-11-27),
-- BUD-21 sweep): it is stored as a batch file is, with the same checks and ceilings, but of kind «файл історії», never
-- «виписка». The previous code never writes it and reads a file by its id only, so it runs on this schema unchanged.
ALTER TABLE files DROP CONSTRAINT files_kind_check;
ALTER TABLE files ADD CONSTRAINT files_kind_check CHECK (kind IN ('statement', 'history-file'));
