-- The merchants of a space (BUD-14@PoC FR 1–3; wave 2 row 22). A merchant is born once for each match key that the
-- counterparties (bank descriptions) of the space's transactions normalize to; every transaction with such a
-- description is its transaction, so no row per transaction is kept here and the descriptions — module transactions'
-- — are never changed. «Перейменувати мерчанта» changes `name`; «Об'єднати з…» points the merchant at the one it joined
-- (`merged_into`, always a merchant that joined none), «Роз'єднати» clears it. The version grows with every change and
-- keys its audit entry. Row-level security on household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE merchants (
  household_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- The normalized key of the descriptions (letters and digits, lower case); never changes.
  match_key text NOT NULL CHECK (char_length(match_key) BETWEEN 1 AND 200),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  -- FR 1: a payment intermediary without a visible recipient («посередник»).
  intermediary boolean NOT NULL DEFAULT false,
  merged_into uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, match_key),
  FOREIGN KEY (household_id, merged_into) REFERENCES merchants (household_id, id),
  CHECK (merged_into IS NULL OR merged_into <> id)
);
-- «Об'єднати з…» and «Роз'єднати» look merchants up by the one they joined.
CREATE INDEX merchants_merged_into ON merchants (household_id, merged_into) WHERE merged_into IS NOT NULL;
