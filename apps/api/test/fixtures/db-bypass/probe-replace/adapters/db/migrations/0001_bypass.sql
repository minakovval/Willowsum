-- Review probe (PR #75, round 2): replacing the platform function that the household policy calls.
CREATE TABLE things (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), household_id uuid NOT NULL, label text NOT NULL);
CREATE OR REPLACE FUNCTION platform_context.current_household() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT nullif(current_setting('ws.h', true), '')::uuid $$;
