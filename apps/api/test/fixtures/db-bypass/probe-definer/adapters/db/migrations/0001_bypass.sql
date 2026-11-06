-- Review probe (PR #75): a SECURITY DEFINER function outside the module schema, granted to the module role.
CREATE TABLE records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
CREATE FUNCTION public.all_records() RETURNS SETOF probe_definer.records LANGUAGE sql SECURITY DEFINER AS 'SELECT * FROM probe_definer.records';
GRANT EXECUTE ON FUNCTION public.all_records() TO ws_mod_probe_definer;
