-- Money accounts of a space (FIN-01@PoC FR 1–8, FR 12, FR 25; FIN-12@PoC FR 13). The balance is never stored here:
-- each currency of an account (a subaccount) has its ledger account, and «Початковий залишок» is a ledger event
-- (FIN-01 FR 7; balance on a date = the sum of its postings). Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).

-- One row per account: its kind, name, institution, the number kept sealed with the space's key (ARC-06 FR 2) and
-- only its last 4 characters in the clear, and the fields of its kind. Status and source are the model of FIN-01
-- FR 14, FR 15, FR 22 (closing comes with FIN-12, wave 2 row 13).
CREATE TABLE accounts (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('current', 'savings', 'deposit', 'cash', 'credit-card', 'loan')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  institution_name text CHECK (char_length(institution_name) BETWEEN 1 AND 100),
  institution_country text CHECK (institution_country ~ '^[A-Z]{2}$'),
  -- What «the same institution» compares (FIN-01 FR 25): country and the name without case and repeated spaces.
  institution_key text NOT NULL CHECK (char_length(institution_key) BETWEEN 1 AND 110),
  number_last4 text CHECK (number_last4 ~ '^[A-Z0-9]{4}$'),
  -- The full IBAN or account number, sealed (`ws1.` and base64url); never answered or logged in full.
  number_sealed text CHECK (number_sealed ~ '^ws1\.[A-Za-z0-9_-]+$' AND char_length(number_sealed) <= 8192),
  note text CHECK (char_length(note) BETWEEN 1 AND 1000),
  -- «Ощадний», «Депозит»: percent per year, 0–100 with two decimals. A loan's and a card's terms are liabilities'.
  annual_rate numeric(38, 18) CHECK (annual_rate BETWEEN 0 AND 100 AND annual_rate = round(annual_rate, 2)),
  deposit_opened_on date,
  deposit_matures_on date,
  -- The owners' shares run from this date (FIN-01 FR 6).
  opened_on date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_on date,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  CHECK ((institution_name IS NULL) = (institution_country IS NULL)),
  CHECK (number_sealed IS NULL OR number_last4 IS NOT NULL),
  CHECK (annual_rate IS NULL OR kind IN ('savings', 'deposit')),
  CHECK (kind = 'deposit' OR (deposit_opened_on IS NULL AND deposit_matures_on IS NULL)),
  CHECK (deposit_matures_on IS NULL OR deposit_opened_on IS NULL OR deposit_matures_on > deposit_opened_on),
  CHECK ((status = 'closed') = (closed_on IS NOT NULL))
);
-- The duplicate check (FIN-01 FR 25) looks accounts up by institution and last 4 characters.
CREATE INDEX accounts_duplicates ON accounts (household_id, institution_key, number_last4)
  WHERE number_last4 IS NOT NULL;

-- The keys to `accounts` are checked at commit (DEFERRABLE): rows of one transaction may come in any order (the
-- synthetic loader writes tables in name order).

-- A currency of an account (FIN-01 FR 12): position 0 is the main one; a multi-currency current account has more.
-- `ledger_account_id` is its account in the journal (ledger `openAccount`, owner `accounts` / this id).
CREATE TABLE subaccounts (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  ledger_account_id uuid NOT NULL,
  -- «На дату*» of its opening balance.
  balance_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, account_id, currency),
  UNIQUE (household_id, account_id, position),
  UNIQUE (household_id, ledger_account_id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

-- Owners of an account with shares and dates (FIN-01 business rule; FIN-12 FR 13): in this release one row, the
-- space's Owner with 100 % from the opening date; no API changes it. The owner is a member's account id (identity).
CREATE TABLE account_owners (
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  share numeric(38, 18) NOT NULL CHECK (share > 0 AND share <= 100),
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, account_id, owner_account_id, valid_from),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts (household_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- «Сума часток на кожну дату не перевищує 100 %»: the total share only changes where a period starts, so checking
-- the start of every period that overlaps the new or changed one covers every date. Checked at commit, so a
-- transaction may replace shares in any order.
CREATE FUNCTION account_owner_shares_at_most_100() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  exceeded boolean;
BEGIN
  -- Checked as the caller (the row policy still applies), with the table named by its schema, not the search path.
  EXECUTE pg_catalog.format(
    'SELECT EXISTS (
       SELECT 1
         FROM (SELECT o.valid_from AS day FROM %1$I.account_owners o
                WHERE o.household_id = $1 AND o.account_id = $2
                  AND pg_catalog.daterange(o.valid_from, o.valid_to) OPERATOR(pg_catalog.&&)
                      pg_catalog.daterange($3, $4)
               UNION SELECT $3) d
        WHERE (SELECT pg_catalog.sum(x.share) FROM %1$I.account_owners x
                WHERE x.household_id = $1 AND x.account_id = $2
                  AND pg_catalog.daterange(x.valid_from, x.valid_to) OPERATOR(pg_catalog.@>) d.day) > 100)',
    TG_TABLE_SCHEMA) INTO exceeded USING NEW.household_id, NEW.account_id, NEW.valid_from, NEW.valid_to;
  IF exceeded THEN
    RAISE EXCEPTION 'the owners'' shares of an account exceed 100 %%' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER account_owner_shares
  AFTER INSERT OR UPDATE ON account_owners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_owner_shares_at_most_100();
