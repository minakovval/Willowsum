-- Cross-currency entries (FIN-04@PoC EC1, ARC-11 «Запис проводок»; issue #127; ADR-0011). The pair model stays: every
-- posting is in its accounts' one currency, so each currency of an entry balances by the row constraints alone. An
-- event in another currency than its account is one pair per currency, bridged by the space's «Валютна різниця» of
-- each currency; this table keeps, on the entry, the explicit dated rate that links them: the actual amount on the
-- account (the rate's base currency), the entry's actual amount (its quote currency), the rate with its date and
-- source, and the account's amount converted into the entry's currency. Append-only like the journal; numbers, dates
-- and codes only (ARC-11: no free text). Row-level security on household_id is added by the migration runner.
CREATE TABLE conversions (
  household_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  seq smallint NOT NULL CHECK (seq BETWEEN 1 AND 1000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  amount numeric(38, 18) NOT NULL CHECK (amount > 0),
  entry_currency text NOT NULL CHECK (entry_currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  entry_amount numeric(38, 18) NOT NULL CHECK (entry_amount > 0),
  -- 1 unit of `currency` = `rate` units of `entry_currency` on `rate_date`, published by `rate_source`.
  rate numeric(38, 18) NOT NULL CHECK (rate > 0),
  rate_date date NOT NULL,
  rate_source text NOT NULL CHECK (rate_source ~ '^[A-Za-z][A-Za-z0-9._-]{0,31}$'),
  -- amount × rate at the storage scale (18 decimals): the nearest value, whichever way a tie is broken.
  converted numeric(38, 18) NOT NULL CHECK (converted > 0 AND abs(converted - amount * rate) <= 0.0000000000000000005),
  -- The conversion difference in the entry's currency: what «Валютна різниця» holds for this entry at its rate.
  difference numeric(38, 18) GENERATED ALWAYS AS (converted - entry_amount) STORED,
  PRIMARY KEY (household_id, entry_id, seq),
  -- Checked at commit, like the rest of an entry's rows (a rate is written with its entry in one transaction).
  FOREIGN KEY (household_id, entry_id) REFERENCES entries (household_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (currency <> entry_currency)
);

REVOKE UPDATE, DELETE, TRUNCATE ON conversions FROM ws_mod_ledger;
GRANT SELECT, INSERT ON conversions TO ws_mod_ledger;
-- The erasure role empties a space from it with the journal (NFR-12@PoC FR 3; erasure.ts; 0003_erasure.sql).
GRANT SELECT, DELETE ON conversions TO ws_era_ledger;

CREATE TRIGGER conversions_append_only BEFORE UPDATE OR DELETE ON conversions
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER conversions_no_truncate BEFORE TRUNCATE ON conversions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER conversions_erased_whole AFTER DELETE ON conversions
  FOR EACH STATEMENT EXECUTE FUNCTION erased_whole_space();

-- A rate is written with its entry, in the same transaction, and never added to an entry later (as a posting).
CREATE FUNCTION conversion_joins_new_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fresh boolean;
BEGIN
  EXECUTE pg_catalog.format(
    'SELECT EXISTS (SELECT 1 FROM %I.entries WHERE household_id = $1 AND id = $2 AND recorded_at = pg_catalog.now())',
    TG_TABLE_SCHEMA) INTO fresh USING NEW.household_id, NEW.entry_id;
  IF NOT fresh THEN
    RAISE EXCEPTION 'a rate can only be written with its entry, in the same transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER conversions_with_their_entry AFTER INSERT ON conversions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conversion_joins_new_entry();

-- At commit, an entry in more than one currency keeps its rate (ARC-11: a posting on an account in another currency
-- carries the rate, its date and source): every currency of its postings is a currency of its rates, and an entry
-- without rates is in one currency. Checked as the caller, so the row policy still applies. It runs for the entry and
-- for every posting of it: a session that makes the check IMMEDIATE (SET CONSTRAINTS) still meets it after its last
-- posting, when the entry's currencies are all known (rows are only added), so the check cannot be run too early.
CREATE FUNCTION entry_currencies_have_rates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  posted text[];
  rated text[];
  entry uuid := COALESCE(pg_catalog.to_jsonb(NEW) ->> 'entry_id', pg_catalog.to_jsonb(NEW) ->> 'id')::uuid;
BEGIN
  EXECUTE pg_catalog.format(
    'SELECT coalesce(array_agg(DISTINCT currency ORDER BY currency), ''{}'') FROM %I.postings
      WHERE household_id = $1 AND entry_id = $2', TG_TABLE_SCHEMA) INTO posted USING NEW.household_id, entry;
  EXECUTE pg_catalog.format(
    'SELECT coalesce(array_agg(DISTINCT c ORDER BY c), ''{}'') FROM %I.conversions,
            LATERAL (VALUES (currency), (entry_currency)) AS v(c)
      WHERE household_id = $1 AND entry_id = $2', TG_TABLE_SCHEMA) INTO rated USING NEW.household_id, entry;
  IF (pg_catalog.cardinality(rated) = 0 AND pg_catalog.cardinality(posted) > 1)
     OR (pg_catalog.cardinality(rated) > 0 AND NOT posted <@ rated) THEN
    RAISE EXCEPTION 'an entry in more than one currency needs the rate of each of them' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entries_rates_match_currencies AFTER INSERT ON entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entry_currencies_have_rates();
CREATE CONSTRAINT TRIGGER postings_rates_match_currencies AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entry_currencies_have_rates();
