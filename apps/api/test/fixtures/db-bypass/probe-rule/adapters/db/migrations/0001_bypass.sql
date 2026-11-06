-- Review probe (PR #75, round 2): a rewrite rule runs with the table owner's rights.
CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
CREATE RULE leak AS ON INSERT TO things DO ALSO SELECT household_id, label FROM things;
