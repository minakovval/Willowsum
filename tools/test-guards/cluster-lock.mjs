// One integration run per PostgreSQL cluster (infra/local/README.md, «Limitation»): module login roles belong to the
// whole cluster and every integration run sets their passwords, so two runs on one cluster break each other.
// `pnpm db:test run` (tools/local-env) and the integration config's globalSetup (apps/api/test/cluster-lock.ts) take
// the same advisory lock. Advisory locks are per database, so both take it in the `postgres` database, which every
// cluster has. A run started by `pnpm db:test run` gets the backend pid of the lock session in HOLDER_PID_ENV; the
// globalSetup trusts it only when pg_locks shows that session holding the lock.

/** Key of the advisory lock that serializes integration runs on one cluster. */
export const LOCK_NAME = 'willowsum-integration-tests';
/** The database every lock session connects to. */
export const LOCK_DATABASE = 'postgres';
/** Environment variable with the pid of the session that holds the lock for this run. */
export const HOLDER_PID_ENV = 'WS_TEST_CLUSTER_LOCK_PID';

/** Same server and credentials, database LOCK_DATABASE. */
export function lockDatabaseUrl(url) {
  const u = new URL(url);
  u.pathname = `/${LOCK_DATABASE}`;
  return u.toString();
}

/** Blocks until this session holds the lock. Parameter $1: LOCK_NAME. */
export const LOCK_SQL = 'SELECT pg_advisory_lock(hashtext($1))';

/** One row when session $1 holds the lock $2 in this database (the key is the bigint of hashtext). */
export const HELD_BY_SQL = `SELECT 1 FROM pg_locks l JOIN pg_database d ON d.oid = l.database
  WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1 AND l.pid = $1 AND d.datname = current_database()
    AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext($2)::bigint`;
