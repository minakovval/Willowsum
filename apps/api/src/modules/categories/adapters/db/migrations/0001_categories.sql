-- The category tree of a space (BUD-01@PoC FR 1–3, FR 8, FR 10, FR 11; wave 2 row 19): groups and their categories,
-- two levels. The system tree (domain/catalogue.ts) is written into each space the first time any of its categories
-- is read, so every system category has an id of that space; custom groups and categories sit beside it. Nothing is
-- deleted (FR 3): a category is hidden, or a custom one is taken out of use after a merge. Row-level security on
-- household_id is added by the migration runner (ARC-03 FR 2).
CREATE TABLE category_groups (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  -- The key of a system group (catalogue.ts); null for a custom group.
  system_key text CHECK (system_key ~ '^[a-z][a-z0-9-]{0,62}$'),
  -- «дохід» or «витрата» (FR 2); «service» only for the system group of «Переказ» and «Коригування».
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'service')),
  -- As shown: the standard name until renamed (FR 3), one line of 1–60 characters.
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  renamed boolean NOT NULL DEFAULT false,
  tone text NOT NULL CHECK (tone ~ '^#[0-9A-F]{6}$'),
  position integer NOT NULL CHECK (position >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  UNIQUE (household_id, id, kind),
  CHECK ((kind = 'service') <= (system_key IS NOT NULL))
);
-- The system tree is written once per space: a second writer adds nothing.
CREATE UNIQUE INDEX category_groups_system_key ON category_groups (household_id, system_key);
-- Group names are unique in the space, without case (lead decision, as category names, FR 2).
CREATE UNIQUE INDEX category_groups_name ON category_groups (household_id, lower(name));

CREATE TABLE categories (
  household_id uuid NOT NULL,
  id uuid NOT NULL,
  group_id uuid NOT NULL,
  -- The type of its group, kept here so a merge compares types (FR 8) and the key below holds it to the group.
  kind text NOT NULL CHECK (kind IN ('expense', 'income', 'service')),
  system_key text CHECK (system_key ~ '^[a-z][a-z0-9-]{0,62}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  renamed boolean NOT NULL DEFAULT false,
  -- FR 10: a Lucide icon on a coloured circle.
  icon text NOT NULL CHECK (icon ~ '^[a-z0-9]+(-[a-z0-9]+){0,5}$' AND char_length(icon) <= 64),
  color text NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
  -- FR 11: «обов'язкова» — expense categories only; null for income and service ones.
  essential boolean CHECK ((kind = 'expense') = (essential IS NOT NULL)),
  -- active; hidden (FR 3: out of the budget plan, shown again at will); retired (a custom category merged away).
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'hidden', 'retired')),
  -- The category its transactions, rules and limit went to (FR 8); kept flat: a later merge of the target moves it.
  merged_into uuid,
  position integer NOT NULL CHECK (position >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, id),
  -- Checked at commit (DEFERRABLE): rows of one transaction may come in any order (the synthetic loader).
  FOREIGN KEY (household_id, group_id, kind) REFERENCES category_groups (household_id, id, kind)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (household_id, merged_into) REFERENCES categories (household_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (merged_into IS NULL OR merged_into <> id),
  -- Only a custom category is taken out of use, and only by a merge (FR 3).
  CHECK ((state = 'retired') <= (system_key IS NULL AND merged_into IS NOT NULL)),
  -- «Переказ» and «Коригування» are never hidden (FR 3).
  CHECK (kind <> 'service' OR state = 'active')
);
CREATE UNIQUE INDEX categories_system_key ON categories (household_id, system_key);
-- «Назва категорії унікальна в просторі» (FR 2), without case; a category out of use frees its name.
CREATE UNIQUE INDEX categories_name ON categories (household_id, lower(name)) WHERE state <> 'retired';
CREATE INDEX categories_by_group ON categories (household_id, group_id, position);
CREATE INDEX categories_merged_into ON categories (household_id, merged_into) WHERE merged_into IS NOT NULL;
