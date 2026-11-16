-- BUD-13@PoC a) (wave 2 row 21): the attributes of a transaction — «Нотатка» and «Теги» (FR 1, FR 2, FR 5).
--
-- Expand only: a nullable column, a column with a default and a new table; earlier code reads and writes the rows as
-- before (its insert takes the defaults, its update leaves both columns as they are).

-- «Нотатка» (FR 1): up to 2 000 characters; never in the journal (ARC-11) nor in the audit log as text (masked).
ALTER TABLE transactions ADD COLUMN note text CHECK (char_length(note) BETWEEN 1 AND 2000);

-- «Теги» (FR 2): the space's tags of the transaction, in the order they were given; at most 20.
ALTER TABLE transactions ADD COLUMN tag_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(tag_ids) <= 20);
-- The filter «Теги» of the list (FR 2, FR 5) and the count of «Тег буде знято з N транзакцій» (AC6).
CREATE INDEX transactions_by_tag ON transactions USING gin (tag_ids);

-- The space's tags (FR 2): shared by the space, unique without regard to case (`name_key`: the trimmed name in lower
-- case, computed by the module), each up to 60 characters. Renaming one to the name of another merges them.
CREATE TABLE tags (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  name_key text NOT NULL CHECK (char_length(name_key) BETWEEN 1 AND 60),
  -- Each rename adds one: the key of its audit entry.
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, name_key)
);
