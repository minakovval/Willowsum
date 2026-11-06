-- Review probe (PR #75): the module role becomes the owner of its table and could switch row security off.
CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
ALTER TABLE things OWNER TO ws_mod_probe_owner;
