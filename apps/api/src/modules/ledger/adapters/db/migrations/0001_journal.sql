-- The double-entry journal (FIN-04@PoC, ARC-11; ADR-0011). Append-only: the module role may only INSERT (without
-- the times the database sets) and SELECT; UPDATE, DELETE and TRUNCATE are refused by privileges and, for every
-- role, by triggers. Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
-- No names, descriptions, notes, merchants or categories here: an entry points to its source (module and id).

-- Chart of accounts: each ledger account has a type and one currency. An owner module's account (a cash account,
-- an asset, a liability) or one of the space's service accounts, made once per currency.
CREATE TABLE accounts (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  owner_module text CHECK (owner_module ~ '^[a-z][a-z0-9-]{0,62}$'),
  owner_id uuid,
  service_kind text CHECK (
    service_kind IN ('external-funds', 'revaluation-reserve', 'fx-difference', 'adjustment', 'realized-gain')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- The target of the postings' (account, currency) keys: a posting's currency is its accounts' currency.
  UNIQUE (household_id, id, currency),
  UNIQUE (household_id, owner_module, owner_id),
  UNIQUE (household_id, service_kind, currency),
  CHECK ((owner_module IS NOT NULL AND owner_id IS NOT NULL AND service_kind IS NULL)
      OR (owner_module IS NULL AND owner_id IS NULL AND service_kind IS NOT NULL))
);

-- One entry per event: the posting set of the event, or the reversal of an earlier entry. Two times: the date of
-- the operation (when it happened) and the time of recording (when the system learnt of it; set by the database).
CREATE TABLE entries (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  source_module text NOT NULL CHECK (source_module ~ '^[a-z][a-z0-9-]{0,62}$'),
  source_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9-]{0,62}$'),
  operation_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  rules_version integer NOT NULL CHECK (rules_version >= 1),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  reverses_entry_id uuid,
  is_reversal boolean GENERATED ALWAYS AS (reverses_entry_id IS NOT NULL) STORED,
  -- false when this entry reverses another, so the key below may only point at an entry that is not a reversal.
  reverses_target_is_reversal boolean
    GENERATED ALWAYS AS (CASE WHEN reverses_entry_id IS NULL THEN NULL ELSE false END) STORED,
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, is_reversal),
  -- A repeated event returns the entry it made (ARC-11: the source's event id is the key).
  UNIQUE (household_id, idempotency_key),
  -- An entry is reversed at most once; a reversal is never reversed (re-posting is a new entry).
  UNIQUE (household_id, reverses_entry_id),
  FOREIGN KEY (household_id, reverses_entry_id, reverses_target_is_reversal)
    REFERENCES entries (household_id, id, is_reversal),
  CHECK (reverses_entry_id IS NULL OR (event_type = 'reversal' AND reverses_entry_id <> id)),
  CHECK (reverses_entry_id IS NOT NULL OR event_type <> 'reversal')
);
CREATE INDEX entries_operation_date ON entries (household_id, operation_date);

-- A posting debits one account and credits another by the same positive amount in the accounts' common currency,
-- so every row, and with it every entry, is balanced per currency by the constraints alone (ADR-0011).
CREATE TABLE postings (
  household_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  seq smallint NOT NULL CHECK (seq BETWEEN 1 AND 1000),
  debit_account_id uuid NOT NULL,
  credit_account_id uuid NOT NULL,
  amount numeric(38, 18) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  PRIMARY KEY (household_id, entry_id, seq),
  FOREIGN KEY (household_id, entry_id) REFERENCES entries (household_id, id),
  FOREIGN KEY (household_id, debit_account_id, currency) REFERENCES accounts (household_id, id, currency),
  FOREIGN KEY (household_id, credit_account_id, currency) REFERENCES accounts (household_id, id, currency),
  CHECK (debit_account_id <> credit_account_id)
);
CREATE INDEX postings_debit ON postings (household_id, debit_account_id);
CREATE INDEX postings_credit ON postings (household_id, credit_account_id);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON accounts, entries, postings FROM ws_mod_ledger;
GRANT INSERT (household_id, id, type, currency, owner_module, owner_id, service_kind) ON accounts TO ws_mod_ledger;
-- recorded_at is always set by the database: module SQL cannot backdate the time of recording.
GRANT INSERT (household_id, id, source_module, source_id, event_type, operation_date, rules_version,
  idempotency_key, reverses_entry_id) ON entries TO ws_mod_ledger;
GRANT INSERT ON postings TO ws_mod_ledger;

CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only: % is not allowed', TG_OP USING ERRCODE = '42501';
END $$;
CREATE TRIGGER accounts_append_only BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER accounts_no_truncate BEFORE TRUNCATE ON accounts FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON entries FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON entries FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER postings_no_truncate BEFORE TRUNCATE ON postings FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
