-- Review probe (PR #75): a customer-data table in public, without row security, granted to the module role.
CREATE TABLE public.notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, note text);
GRANT SELECT, INSERT ON public.notes TO ws_mod_probe_public;
