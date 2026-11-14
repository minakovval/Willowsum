-- Owners' shares trigger: serialise the check per account (follow-up of #207, race of two concurrent writes).
CREATE OR REPLACE FUNCTION account_owner_shares_at_most_100() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  exceeded boolean;
BEGIN
  -- One check at a time per account: two transactions that each see only their own row (the check runs before the
  -- other commits) would both pass, 60 % + 60 %. The lock is held to the end of the transaction, so the second check
  -- runs after the first commit and sees its rows (READ COMMITTED takes a new snapshot per statement).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('accounts:owners'), pg_catalog.hashtext(NEW.household_id::text OPERATOR(pg_catalog.||) NEW.account_id::text));
  -- Checked as the caller (the row policy still applies), with the table named by its schema, not the search path.
  EXECUTE pg_catalog.format(
    'SELECT EXISTS (
       SELECT 1
         FROM (SELECT o.valid_from AS day FROM %1$I.account_owners o
                WHERE o.household_id = $1 AND o.account_id = $2
                  AND pg_catalog.daterange(o.valid_from, o.valid_to) OPERATOR(pg_catalog.&&)
                      pg_catalog.daterange($3, $4)
               UNION SELECT $3) d
        WHERE (SELECT pg_catalog.sum(x.share) FROM %1$I.account_owners x
                WHERE x.household_id = $1 AND x.account_id = $2
                  AND pg_catalog.daterange(x.valid_from, x.valid_to) OPERATOR(pg_catalog.@>) d.day) > 100)',
    TG_TABLE_SCHEMA) INTO exceeded USING NEW.household_id, NEW.account_id, NEW.valid_from, NEW.valid_to;
  IF exceeded THEN
    RAISE EXCEPTION 'the owners'' shares of an account exceed 100 %%' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
