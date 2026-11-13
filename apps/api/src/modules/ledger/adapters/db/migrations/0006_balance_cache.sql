-- The daily balance cache (ARC-11 «Баланси і продуктивність»; issue #126). Derived from the postings, which stay the
-- source of truth: unlike the journal it is changed in place and can be rebuilt from them at any time (the rebuild
-- command). Numbers, dates and codes only (ARC-11: no free text in the ledger). Row-level security on household_id is
-- added by the migration runner (ARC-03 FR 2); the module role gets SELECT, INSERT, UPDATE and DELETE by default.

-- One row per account with a cache: its version (the version check of concurrent updates) and the latest time of
-- recording among the entries the cache holds («as known at» earlier than that is answered from the postings).
CREATE TABLE balance_versions (
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  last_recorded_at timestamptz,
  -- The transaction time of the last change; a posting on a cached account must come with one (trigger below).
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, account_id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts (household_id, id)
);

-- Per account and day with postings: the debit and credit totals of every posting dated up to that day inclusive.
-- The balance on a date is the row of the latest day up to it (no row: zero).
CREATE TABLE daily_balances (
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  day date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  debits numeric(38, 18) NOT NULL CHECK (debits >= 0),
  credits numeric(38, 18) NOT NULL CHECK (credits >= 0),
  PRIMARY KEY (household_id, account_id, day),
  FOREIGN KEY (household_id, account_id) REFERENCES balance_versions (household_id, account_id),
  FOREIGN KEY (household_id, account_id, currency) REFERENCES accounts (household_id, id, currency)
);

-- The erasure role empties a space from the cache with its journal (NFR-12@PoC FR 3; erasure.ts).
GRANT SELECT, DELETE ON balance_versions, daily_balances TO ws_era_ledger;

-- A stale cache is never written silently: at commit, a posting on an account that has a cache must come with a
-- change of that cache in the same transaction (an older code version or a direct INSERT that skips the cache is
-- refused). An account without a cache is answered from its postings. Checked as the caller, so the row policy
-- still applies.
CREATE FUNCTION posting_moves_cached_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stale boolean;
BEGIN
  EXECUTE pg_catalog.format(
    'SELECT EXISTS (SELECT 1 FROM %I.balance_versions WHERE household_id = $1 AND account_id IN ($2, $3)
                       AND changed_at <> pg_catalog.now())',
    TG_TABLE_SCHEMA) INTO stale USING NEW.household_id, NEW.debit_account_id, NEW.credit_account_id;
  IF stale THEN
    RAISE EXCEPTION 'a posting on an account with a balance cache must update the cache' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER postings_move_cached_balance AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION posting_moves_cached_balance();
