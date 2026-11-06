-- Migration SQL tries to return to the migration (deployer) role.
RESET ROLE;
CREATE FUNCTION public.escaped() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
