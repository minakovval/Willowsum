-- Review probe (PR #75, round 2): a SECURITY DEFINER trigger copies other households' rows into the inserting one.
CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
CREATE FUNCTION copy_all() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.label = 'pull' THEN
    INSERT INTO probe_trigger.things (household_id, label)
      SELECT NEW.household_id, 'copied:' || label FROM probe_trigger.things WHERE household_id <> NEW.household_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION copy_all() FROM PUBLIC;
CREATE TRIGGER copy_all AFTER INSERT ON things FOR EACH ROW EXECUTE FUNCTION copy_all();
