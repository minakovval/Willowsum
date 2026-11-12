-- Spaces and who belongs to them (ACC-01@PoC part c: the first space «Родина <Прізвище>» on the first sign-in;
-- ADR-0010). ACC-08 adds the rest of the space (the owner person, the reporting currency, renaming).

-- One row per space: its own record, under the household policy like every customer-data table (the migration
-- runner enables and forces row-level security). The region and the key reference are fixed at creation
-- (ARC-03 FR 3); the key reference names no key until ARC-06 brings the keys of spaces.
CREATE TABLE households (
  household_id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  data_region platform_types.data_region NOT NULL,
  encryption_key_ref text NOT NULL CHECK (length(encryption_key_ref) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Login → spaces (ADR-0010): which spaces an account belongs to and with which role. It must be read before any
-- space is bound (a session has to find its space first), so it cannot sit under the household policy; like the
-- «login → region» directory of ARC-03 FR 3 it holds only opaque ids and the role, and only the household
-- module's role reaches it (schema-exemptions.json). The column is `space_id`, not household_id, because
-- household_id marks a table under the policy.
CREATE TABLE account_spaces (
  account_id uuid NOT NULL,
  space_id uuid NOT NULL REFERENCES households (household_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer', 'advisor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, space_id)
);
CREATE INDEX account_spaces_space ON account_spaces (space_id);
