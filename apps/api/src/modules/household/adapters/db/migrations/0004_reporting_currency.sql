-- ACC-06@PoC FR 1, FR 2: the reporting currency is an attribute of the space. In this release it is EUR for every
-- space and any locale, with no choice: existing spaces get EUR, new ones are created with EUR. The column holds an
-- ISO 4217 code; the check keeps the PoC rule in the database too (a later release that lets the Owner choose
-- relaxes it in its own migration). Amounts never change with it: they stay in their own currency.
ALTER TABLE households
  ADD COLUMN reporting_currency text NOT NULL DEFAULT 'EUR'
    CONSTRAINT households_reporting_currency_eur CHECK (reporting_currency = 'EUR');
