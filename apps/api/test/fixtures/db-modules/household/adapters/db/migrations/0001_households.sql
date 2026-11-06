-- The household table without its region and key reference (ARC-03 FR 3 check).
CREATE TABLE households (id uuid PRIMARY KEY, household_id uuid NOT NULL, name text NOT NULL);
