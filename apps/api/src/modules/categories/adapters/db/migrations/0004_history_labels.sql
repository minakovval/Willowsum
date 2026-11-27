-- The labels of history files (BUD-21@PoC FR 7, FR 25; wave 2 row 234). A file category without subcategories becomes
-- a category in the history group of its type: one custom group per type, found by `history_kind` (renamed or not).
-- Additive: the code before this migration never writes `history_kind` (null — any other group) and never reads or
-- writes the new table.
ALTER TABLE category_groups ADD COLUMN history_kind text
  CHECK (history_kind IS NULL OR (history_kind IN ('expense', 'income') AND history_kind = kind AND system_key IS NULL));
CREATE UNIQUE INDEX category_groups_history_kind ON category_groups (household_id, history_kind)
  WHERE history_kind IS NOT NULL;

-- FR 25: the matching of a label the user confirmed, offered again for the next history file; it stays when the file
-- goes (FR 24). The label is kept as the SHA-256 of its key (application `labelHash`: the file category and the
-- subcategory without case, diacritics and extra spaces) — the lookup needs no more, and no label of the file is kept
-- as text. `category_id` null — the label is a transfer (FR 8). A deleted category takes its matchings with it (BUD-01
-- FR 12); a merged one is followed to its target when read. Row-level security on household_id is added by the
-- migration runner (ARC-03 FR 2).
CREATE TABLE history_label_mappings (
  household_id uuid NOT NULL,
  label_hash text NOT NULL CHECK (label_hash ~ '^[0-9a-f]{64}$'),
  category_id uuid,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (household_id, label_hash),
  -- Checked at commit, like the categories' own keys (the synthetic loader goes in name order).
  FOREIGN KEY (household_id, category_id) REFERENCES categories (household_id, id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX history_label_mappings_category ON history_label_mappings (household_id, category_id)
  WHERE category_id IS NOT NULL;
