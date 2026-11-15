-- The category of a transaction (BUD-01@PoC FR 1, FR 4, FR 5, FR 9; wave 2 row 20): one row per transaction of the
-- `transactions` module that ever had a category (by its opaque id; no foreign key across schemas). A transaction
-- without a row, or with a null category and the source «none», is «Без категорії» (FR 1). The category is one of the
-- space's tree in module `categories` (FR 9, checked through its directory). The version grows with every change, so
-- a bulk action (DAT-03) writes only a row it read. Row-level security on household_id is added by the migration
-- runner (ARC-03 FR 2).
CREATE TABLE transaction_categories (
  household_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  category_id uuid,
  -- FR 4: «вручну», «за правилом», «як раніше», «з банку», «за словником»; «немає» — «Без категорії».
  source text NOT NULL CHECK (source IN ('manual', 'rule', 'merchant', 'bank', 'dictionary', 'none')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, transaction_id),
  CHECK ((category_id IS NULL) = (source = 'none'))
);
-- «Порожня» категорія (FR 12) and a merge (FR 8) look transactions up by their category.
CREATE INDEX transaction_categories_category ON transaction_categories (household_id, category_id)
  WHERE category_id IS NOT NULL;
