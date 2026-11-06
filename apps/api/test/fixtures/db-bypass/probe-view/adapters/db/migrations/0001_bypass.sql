-- Review probe (PR #75): a view in public (owner rights, no row policy), granted to the module role.
CREATE TABLE records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
CREATE VIEW public.records_view AS SELECT * FROM probe_view.records;
GRANT SELECT ON public.records_view TO ws_mod_probe_view;
