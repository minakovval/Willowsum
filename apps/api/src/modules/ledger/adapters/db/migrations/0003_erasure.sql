-- Erasure of a space from the journal (NFR-12@PoC FR 3, ARC-11 «Видалення даних»; ADR-0013, option A — the owner's
-- decision of 2026-11-13). The journal stays append-only for every role but one: the module's erasure role
-- `ws_era_ledger`, which logs in only while the owner's erasure script runs, may DELETE, and only every row of the one
-- space it is bound to (the household policy limits it to that space; the statement triggers refuse a DELETE that
-- leaves rows of it). UPDATE and TRUNCATE stay refused for every role; integrity_alerts (no space) is not erasable.
GRANT SELECT, DELETE ON accounts, entries, postings TO ws_era_ledger;

CREATE OR REPLACE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'ws_era_' || TG_TABLE_SCHEMA AND TG_TABLE_NAME <> 'integrity_alerts' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'the ledger is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END $$;

-- After an erasure DELETE nothing of the bound space may remain in the table: a space is erased whole or not at all.
CREATE FUNCTION erased_whole_space() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  remaining boolean;
BEGIN
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM %I.%I)', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO remaining;
  IF remaining THEN
    RAISE EXCEPTION 'an erasure deletes the whole space: rows of it remain in %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER postings_erased_whole AFTER DELETE ON postings FOR EACH STATEMENT EXECUTE FUNCTION erased_whole_space();
CREATE TRIGGER entries_erased_whole AFTER DELETE ON entries FOR EACH STATEMENT EXECUTE FUNCTION erased_whole_space();
CREATE TRIGGER accounts_erased_whole AFTER DELETE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION erased_whole_space();
