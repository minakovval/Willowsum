-- Regular payments of a space and the user's decisions on the proposals (BUD-07@PoC FR 4, FR 6; wave 2 row 25 — part
-- a2). The proposals themselves are not stored: they are found anew on every read. Categories, accounts and merchants
-- are other modules', by their opaque ids (no foreign key across schemas). Row-level security on household_id is added
-- by the migration runner (ARC-03 FR 2).
CREATE TABLE payments (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- FR 6 «тип (витрата або дохід)».
  type text NOT NULL CHECK (type IN ('expense', 'income')),
  frequency text NOT NULL CHECK (frequency IN ('week', 'two-weeks', 'month', 'quarter', 'year')),
  -- The expected amount, positive; the type gives its direction.
  expected_amount numeric(38, 18) NOT NULL CHECK (expected_amount > 0),
  expected_currency text NOT NULL CHECK (expected_currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  -- «Дата прив'язки»: the schedule is counted from it (a day the month lacks is its last day).
  anchor_date date NOT NULL,
  end_date date CHECK (end_date IS NULL OR end_date >= anchor_date),
  category_id uuid,
  account_id uuid,
  subscription boolean NOT NULL DEFAULT false,
  variable boolean NOT NULL DEFAULT false,
  -- The merchant (module merchants) of a confirmed proposal; null for a payment added by hand.
  merchant_id uuid,
  source text NOT NULL CHECK (source IN ('proposal', 'manual')),
  created_on date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  CHECK ((source = 'proposal') = (merchant_id IS NOT NULL))
);
-- FR 4: a merchant that is a regular payment gets no proposals — so one confirmed payment per merchant.
CREATE UNIQUE INDEX payments_by_merchant ON payments (household_id, merchant_id) WHERE merchant_id IS NOT NULL;
-- BUD-01 FR 12 (a category in use is not deleted) and FR 8 (a merge moves the payments).
CREATE INDEX payments_by_category ON payments (household_id, category_id) WHERE category_id IS NOT NULL;

-- FR 4 «Не регулярний»: a series the user rejected is not proposed again. Matched by the merchant, type, currency and
-- frequency and either a charge in common (`transaction_ids`, module transactions) or the same kind of amount — not by
-- the proposal's key, which changes once the series' first charge leaves the 430 days (#315, п. 8).
CREATE TABLE rejections (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('expense', 'income')),
  frequency text NOT NULL CHECK (frequency IN ('week', 'two-weeks', 'month', 'quarter', 'year')),
  variable boolean NOT NULL,
  expected_amount numeric(38, 18) NOT NULL CHECK (expected_amount > 0),
  expected_currency text NOT NULL CHECK (expected_currency ~ '^[A-Z][A-Z0-9]{2,9}$'),
  transaction_ids uuid[] NOT NULL CHECK (cardinality(transaction_ids) BETWEEN 1 AND 500),
  created_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id)
);
CREATE INDEX rejections_by_merchant ON rejections (household_id, merchant_id);
