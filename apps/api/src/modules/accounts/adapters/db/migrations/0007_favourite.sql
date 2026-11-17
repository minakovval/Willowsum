-- «Обране» (FIN-01@PoC FR 20; owner decision 2026-11-16, item 2а — docs/decisions/log/2026-11-16-owner-answers-413-417.md):
-- the star of an account, a display flag the user sets and clears (also on a closed account, FIN-12@PoC FR 8). Expand:
-- a new column with a constant default (PostgreSQL 11+ adds it without rewriting the table); the previous code never
-- names it, so its inserts get «not in Обране» and its reads and updates are unchanged.
ALTER TABLE accounts ADD COLUMN favourite boolean NOT NULL DEFAULT false;
