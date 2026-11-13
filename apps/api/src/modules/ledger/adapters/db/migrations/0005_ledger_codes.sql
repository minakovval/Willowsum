-- ws:contract 0001_journal.sql the previous code has no caller of ledger.post outside tests, and its tests use code keys only
-- No free text in the journal tables (ARC-11 criterion «Тексти, описи або назви мерчантів у таблицях журналу» = 0;
-- issue #128; schema-rules.ts `ledgerFreeTextProblems`): the two text columns of 0001_journal.sql without a code CHECK
-- get one. Contract step (ARC-03 FR 4): the previous code accepted any 1–200 characters as an idempotency key, but
-- nothing outside tests calls the ledger yet (no route, no consumer; the server is not deployed), and every key its
-- tests and synthetic data write fits the code shape.
--
-- The idempotency key is the source's event id: a code, not text (journal.ts `assertKey`).
ALTER TABLE entries
  ADD CONSTRAINT entries_idempotency_key_code CHECK (idempotency_key ~ '^[A-Za-z0-9:._-]{1,200}$');
-- A posting's currency is already its accounts' (the keys); its own CHECK makes the rule hold for the column alone.
ALTER TABLE postings ADD CONSTRAINT postings_currency_code CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$');
