-- «Валюта категорії» (BUD-02@PoC FR 1, FR 24; owner decision 2026-11-26, Q3 а): a limit and an income category's plan
-- keep their own currency — `limits.currency` and `income_plans.currency` already hold it (the budget's until now). A
-- finished period converts them into the budget's currency at the rate of its last day and keeps that rate in its
-- snapshot (FR 11): `rates` [{ currency, rate, date, source }] — rate and date as text, null for a currency without any
-- rate (its lines count 0); null — a snapshot without lines of another currency (or written before this migration).
-- The lines of `limits` and `income_plans` in a snapshot keep their amount in the budget's currency and, for another
-- currency, gain `original` { amount, currency }.
-- Additive: one nullable column, so the code before this migration runs on this schema unchanged (it never reads it,
-- and the jsonb lines it reads keep the fields it knows).
ALTER TABLE period_snapshots
  ADD COLUMN rates jsonb CHECK (rates IS NULL OR jsonb_typeof(rates) = 'array');
