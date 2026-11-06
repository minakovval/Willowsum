-- Migration SQL tries to return to the migration role through dynamic SQL and SET SESSION AUTHORIZATION.
DO $$ BEGIN EXECUTE 'SET SESSION AUTHORIZATION DEFAULT'; END $$;
