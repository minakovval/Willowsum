-- Review probe (PR #75, round 2): a schema of its own outside the module, for a SECURITY DEFINER trigger function.
CREATE SCHEMA ops;
CREATE FUNCTION ops.copy_all() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
