-- Transactions of a space entered by hand (FIN-03@PoC FR 1–3, FR 16, FR 20; wave 2 row 15). The money is never kept
-- only here: each transaction is one event of the journal (ledger `transaction`, source `transactions` / this id),
-- and an account's balance is the sum of its postings. This row holds what the journal must not (ARC-11: no free
-- text in the ledger): the counterparty and the description, with the amount, date and account repeated for the
-- list (DAT-01). Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE transactions (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  -- The money account (module accounts) and the subaccount of the amount's currency; both resolved through the
  -- accounts module's public interface, never by reading its tables.
  account_id uuid NOT NULL,
  subaccount_id uuid NOT NULL,
  -- Signed in the account's currency: plus — «надходження» (income), minus — «списання» (expense) (FR 2).
  amount numeric(38, 18) NOT NULL CHECK (amount <> 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  -- For the «Тип» filter and the «Сума від / до» filter (DAT-01 whitelists): derived, never written.
  direction text GENERATED ALWAYS AS (CASE WHEN amount > 0 THEN 'in' ELSE 'out' END) STORED,
  magnitude numeric(38, 18) GENERATED ALWAYS AS (abs(amount)) STORED,
  -- «Дата» of the form (FR 29): never after today.
  occurred_on date NOT NULL CHECK (occurred_on >= DATE '1900-01-01'),
  counterparty text CHECK (char_length(counterparty) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) BETWEEN 1 AND 1000),
  -- The text search of the list (FR 13): counterparty and description.
  search_text text GENERATED ALWAYS AS (coalesce(counterparty, '') || ' ' || coalesce(description, '')) STORED,
  -- FR 24: «Проведена» only in this part; «Очікує» comes with pending bank transactions (row 16).
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  -- Entered by hand; imported transactions come with the import of statements (IMP-*).
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  -- Each change adds one: the key of the journal correction is derived from the entry in effect, not from this.
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- «Дата і час»: the time a transaction entered by hand was recorded (the form has no time field).
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id)
);

-- The list (DAT-01): the default order «Дата і час», newest first, and the filter by account and period.
CREATE INDEX transactions_by_date ON transactions (household_id, occurred_on DESC, id);
CREATE INDEX transactions_by_account ON transactions (household_id, account_id, occurred_on);
